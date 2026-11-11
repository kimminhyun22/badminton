'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const B=require('../js/club-skill-batch'),C=require('../functions/skill-calibration-core'),{project}=require('../functions/skill-calibration');
const members=Array.from({length:4},(_,i)=>({memberId:'E2E-member-'+i,name:'E2Esource'+i,grade:'C',gender:'남',ageGroup:'20대',skillStep:0,skillRating:4,level:4}));
const players=C.players(members),questions=C.pairs(players),answers=Object.fromEntries(questions.map(q=>[q.id,'a']));
const session={id:'old-review',clubId:'E2Eclub',clubName:'E2E',players,questions,votes:{e0:answers,e1:answers,e2:answers},assessmentVersion:2,expiresAt:9999999999999};
const own={id:session.id,clubId:session.clubId,createdAt:10,snapshots:members};
const initial={clubs:[{id:session.clubId,name:'E2E',members},{id:'E2Eother',members:[{name:'E2Euntouched'}]}]};
const all=project(session,'owner').proposals;
const items=all.filter(p=>p.ready).map(p=>({id:p.id,clubId:session.clubId,original:members[Number(p.id.slice(1))],step:0,skillRating:p.skillRating}));
const old=B.prepare(initial,session.clubId,items,session.id,'old-batch',20,{kind:'club',createdAt:10}).state;
const eventItems=old.clubs[0].members.slice(0,2).map((m,i)=>({id:'p'+i,clubId:session.clubId,original:m,step:0,skillRating:m.skillRating+(i?-.2:.2)}));
const before=JSON.stringify(old),event=B.prepare(old,session.clubId,eventItems,'event-review','event-batch',100,{kind:'team-event',createdAt:30}).state;
assert.equal(JSON.stringify(old),before,'plans do not mutate their input');
assert.deepEqual(event.clubs[1],initial.clubs[1]);
assert.equal(B.reviewBaselines(own,event.clubs[0]).some(p=>p.id==='p0'),false,'refresh cannot promote an old survey over an event update');
assert.equal(B.reviewBaselines(own,event.clubs[0]).some(p=>p.id==='p2'),true,'unaffected members remain reviewable');
assert(B.sourceConflict(event.clubs[0],event.clubs[0].members[0],own.id,{createdAt:10}));
// Reproduce the previous bypass: the old read has fresh current-profile basis,
// but unchanged old evidence still proposes the pre-event official value.
const forceCurrent=event.clubs[0].members.map((m,i)=>({id:'p'+i,...m}));
const refreshed=project(session,'owner',forceCurrent);
assert(refreshed.proposals[0].ready);
const stale=refreshed.proposals.filter(p=>p.ready).map(p=>({id:p.id,original:p.basis,step:0,skillRating:p.skillRating}));
assert.throws(()=>B.prepare(event,session.clubId,stale,own.id,'old-again',110,{kind:'club',createdAt:10}),/다른 평가/);
assert.throws(()=>B.prepare(event,session.clubId,stale,own.id,'missing-origin',110),/다른 평가/);
assert.throws(()=>B.prepare(old,session.clubId,eventItems,'bad-event','invalid',100,{kind:'team-event'}),/최초 생성/);

const follow=[{id:'p0',original:event.clubs[0].members[0],step:0,skillRating:event.clubs[0].members[0].skillRating+.1}];
const same=B.prepare(event,session.clubId,follow,'event-review','event-follow',120,{kind:'team-event',createdAt:30}).state;
assert.equal(same.clubs[0].members[0].skillRating,follow[0].skillRating,'same event adds evidence to an absolute proposal');
assert.throws(()=>B.prepare(same,session.clubId,[{...follow[0],original:same.clubs[0].members[0]}],'event-review','duplicate',121,{kind:'team-event',createdAt:30}),/이미 적용/);
const freshOwn={...own,id:'fresh-review',createdAt:130};
assert(B.reviewBaselines(freshOwn,same.clubs[0]).some(p=>p.id==='p0'),'a later assessment can use the updated score');
const fresh=B.prepare(same,session.clubId,[{...follow[0],original:same.clubs[0].members[0],skillRating:4.7}],freshOwn.id,'fresh-batch',140,{kind:'club',createdAt:130}).state;
assert.equal(fresh.clubs[0].skillReview.sources['id:E2E-member-0'].protected,true,'protection survives a later ordinary assessment');
assert(B.sourceConflict(fresh.clubs[0],fresh.clubs[0].members[0],'event-review',{createdAt:30}));
const mixed=[{id:'p2',original:fresh.clubs[0].members[2],step:0,skillRating:3.9},{id:'p0',original:fresh.clubs[0].members[0],step:0,skillRating:4.2}];
const mixedBefore=JSON.stringify(fresh);
assert.throws(()=>B.prepare(fresh,session.clubId,mixed,'old-review','mixed',150,{createdAt:10}),/다른 평가/);
assert.equal(JSON.stringify(fresh),mixedBefore,'a conflict does not partially commit other members');

const source=event.clubs[0].skillReview.sources['id:E2E-member-0'];
assert.notStrictEqual(source,event.clubs[0].skillReview.latest.entries[0].afterSource,'undo evidence owns its source snapshot');
const undone=B.undo(event,session.clubId,'event-batch',160);
assert.equal(undone.count,2);assert.equal(undone.state.clubs[0].members[0].skillRating,old.clubs[0].members[0].skillRating);
const undoSource=undone.state.clubs[0].skillReview.sources['id:E2E-member-0'];
assert.equal(undoSource.reviewId,'event-review');assert.equal(undoSource.protected,true);assert.equal(undoSource.undone,true);assert.equal(undoSource.revision,source.revision+1);
assert(B.sourceConflict(undone.state.clubs[0],undone.state.clubs[0].members[0],own.id,{createdAt:10}),'undo must not reopen the old-survey overwrite path');
assert(!B.sourceConflict(undone.state.clubs[0],undone.state.clubs[0].members[0],'after-undo',{createdAt:170}));
const aba=structuredClone(event);
for(const record of Object.values(aba.clubs[0].skillReview.sources)){record.reviewId='another-review';record.revision++;}
assert.throws(()=>B.undo(aba,session.clubId,'event-batch',180),/되돌릴 회원/,'matching numeric values do not authorize undo after another source wrote them');

for(const identified of [false,true]){
  const special={...members[0],name:'E2E.가/#$[]%2E'};
  if(identified)special.memberId='E2E.id/#$[]%2E';else delete special.memberId;
  const raw={clubs:[{id:'special',members:[special]}]},changed=B.prepare(raw,'special',[{id:'p0',original:special,step:0,skillRating:4.2}],'event-special','special-batch',100,{kind:'team-event',createdAt:30}).state;
  const serialized=JSON.parse(JSON.stringify(changed)),club=serialized.clubs[0],keys=Object.keys(club.skillReview.sources);
  assert.equal(keys.length,1);assert(!/[.#$\[\]/\u0000-\u001f\u007f]/.test(keys[0]),'cloud source map keys must be Firebase-safe');
  assert(B.currentSource(club,club.members[0]).protected);assert(B.sourceConflict(club,club.members[0],'old',{createdAt:1}));
  const restored=B.undo(serialized,'special','special-batch',120);
  assert.equal(restored.state.clubs[0].members[0].skillRating,4);assert(B.currentSource(restored.state.clubs[0],restored.state.clubs[0].members[0]).protected);
  const lookalike={...club.members[0]};if(identified)lookalike.memberId=lookalike.memberId.replace('.','%2E');else lookalike.name=lookalike.name.replace('.','%2E');
  assert.equal(B.currentSource(club,lookalike),null,'literal escaped-looking text cannot alias a different identity');
  delete club.skillReview.sources[keys[0]];assert.equal(B.currentSource(club,club.members[0]),null,'encoded lookup follows the actual source record');
}

const noticeSource=fs.readFileSync('js/club-skill-notice.js','utf8'),requests=[],values=new Map(),nodes=[];
const links=[{id:'event-notice',eventId:'event',clubId:'E2Eclub',clubName:'E2E',key:'secret',createdAt:Date.now(),readyCount:9}];
values.set('kokmatch_club_skill_links_v1',JSON.stringify(links));values.set('badminton_rosters_v1',JSON.stringify(initial));
const context={window:{KokSkillBatch:{...B,reviewBaselines(){throw Error('event reads must not ask for dynamic baselines');}},addEventListener(){}},
  localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)},location:{pathname:'/team.html'},Date,URLSearchParams,AbortSignal:{timeout:()=>null},setInterval(){},setTimeout(){},
  document:{hidden:false,getElementById:()=>null,addEventListener(){},createElement:tag=>{nodes.push(tag);return {style:{},setAttribute(){},replaceChildren(){}};},querySelector:()=>({after(){}})},
  fetch:async(url,opts)=>{requests.push(JSON.parse(opts.body).data);return {ok:true,json:async()=>({result:{event:{id:'event'},reviewedAt:0,proposals:[]}})};}};
vm.createContext(context);vm.runInContext(noticeSource.replace('  setInterval(refresh,60000);','  window.testRefresh=refresh; window.testPaint=paint;'),context);
(async()=>{
  await context.window.testRefresh();assert.equal(requests.length,1);assert(!Object.hasOwn(requests[0],'baselines'));assert.equal(nodes.length,0,'event readiness is not advertised as a club-wide notice');
  assert(noticeSource.includes("{kind:'club',createdAt:own.createdAt}"),'ordinary save hands its assessment creation context to the shared guard');
  const src=fs.readFileSync('js/club-skill-batch.js','utf8'),mutant={module:{exports:{}}};
  vm.runInNewContext(src.replace('if(!source?.protected||source.reviewId===reviewId)return null;','return null;'),mutant);
  const broken=mutant.module.exports.prepare(event,session.clubId,stale,own.id,'mutant',110,{kind:'club',createdAt:10});
  assert.notEqual(broken.state.clubs[0].members[0].skillRating,event.clubs[0].members[0].skillRating,'removing the source guard reproduces the exact stale overwrite');
  console.log('PASS skill source revisions: stale survey reread/prepare blocked, new/same assessment allowed, atomic conflict, protected undo ownership/ABA, event notice isolation and mutation');
})().catch(e=>{console.error(e);process.exitCode=1;});
