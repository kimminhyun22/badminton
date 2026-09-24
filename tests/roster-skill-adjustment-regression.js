'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const team=read('js/team.js'),daily=read('js/daily.js'),storage=read('js/storage.js');
const cut=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i+a.length);assert(i>=0&&j>i);return s.slice(i,j);};
const ctx={};vm.createContext(ctx);
vm.runInContext(cut(team,'function gradeToLevel(','function setInputMode(')+cut(storage,'function rosterSkillStep(','const LIVE_ROSTER_BRIDGE_KEYS')+read('js/match-quality.js'),ctx);
const engine=require('../functions/daily-server-matchmaker');
for(const gender of ['남','여'])for(const grade of ['E','D','C','B','A','S']){
  const base=ctx.gradeToLevel(grade,gender);
  for(const step of [-2,-1,0,1,2]){
    const member={grade,gender,skillStep:step,ageGroup:'40대'};
    const level=ctx.rosterSkillLevel(member);
    assert.equal(level,Math.round((base+step*0.2)*10)/10);
    assert.equal(ctx.rosterSkillLevel({...member,level}),level,'No double application');
    assert.equal(ctx.KokMatchQuality.effectiveLevel({...member,level}),engine.effectiveLevel({...member,level}),'Browser/server parity');
  }
  assert.equal(ctx.rosterSkillLevel({grade,gender}),base,'Legacy default unchanged');
}
for(const bad of [8,-3,1.5,'invalid'])assert.equal(ctx.rosterSkillStep(bad),0);
const player={name:'E2E회원',club:'E2E클럽',level:4,grade:'C',gender:'M'};
Object.assign(ctx,{_dailyPlayers:[player],_rsvpMemberId:p=>p.name+'|'+p.club,_dailyGender:()=> 'M',dailySave(){},dailyRender(){},_dailyCheckinId:null});
vm.runInContext(cut(daily,'function _dailyPropagateMemberEdit(','/* ── 회원 편집 ── */'),ctx);
ctx._dailyPropagateMemberEdit({name:'E2E클럽'},player.name,{...player,level:4.4});
assert.equal(player.level,4.4,'Roster correction reaches registered players');
vm.runInContext(cut(daily,'function _dailyArrivalCandidatesHash(','async function _dailySyncArrivalCandidates('),ctx);
assert.notEqual(ctx._dailyArrivalCandidatesHash([{level:4}]),ctx._dailyArrivalCandidatesHash([{level:4.4}]),'Arrival candidate sync detects correction');
for(const file of ['index.html','team.html']){
  const html=read(file);assert(html.includes('id="memberSkill"'));for(const n of [-2,-1,0,1,2])assert(html.includes(`value="${n}"`));
}
for(const src of [daily,team]){
  const save=cut(src,'function saveMember(','function deleteMember(');
  assert(save.includes('rosterSkillLevel('));assert(save.includes('level,skillStep,'));
  assert(src.includes('selectMemberSkill(m.skillStep)'));
}
console.log('roster skill adjustment: 60 grade/gender/step cases, server parity, propagation and sync passed');
