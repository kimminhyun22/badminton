'use strict';
const fs=require('fs'),assert=require('assert'),vm=require('vm'),crypto=require('crypto');
const storage=fs.readFileSync('js/storage.js','utf8'),team=fs.readFileSync('js/team.js','utf8'),daily=fs.readFileSync('js/daily.js','utf8');
const B=require('../js/club-skill-batch'),C=require('../functions/skill-calibration-core'),S=require('../functions/skill-calibration');
const ctx={window:{}};vm.runInNewContext(storage,ctx);const bridge=ctx.window.KokMatchRosterBridge;
const id=m=>'m_'+m.club+'_'+m.name;
const member=(score)=>({name:'E2E공통회원',grade:'C',gender:'남',ageGroup:'40대',level:score+.5,skillStep:0,skillRating:score});
const clubs=[{id:'club-a',name:'E2E A클럽',members:[member(4.1)]},{id:'club-b',name:'E2E B클럽',members:[member(2.9)]}];
const player=(club)=>({...member(club==='club-a'?4.1:2.9),clubId:club,club:clubs.find(c=>c.id===club).name,memberId:id({name:member(0).name,club:clubs.find(c=>c.id===club).name})});
assert.equal(bridge.resolveMember(clubs,player('club-a'),'',id).skillRating,4.1);
assert.equal(bridge.resolveMember(clubs,player('club-b'),'',id).skillRating,2.9);
assert.equal(bridge.resolveMember([clubs[1]],player('club-a'),'',id),null,'missing original club must not inherit another club by name');
assert.equal(bridge.resolveMember(clubs,{name:member(0).name},'',id),null,'ambiguous legacy name never guesses a club');
assert.equal(bridge.resolveMember(clubs,{...player('club-a'),clubId:undefined},'',id).skillRating,4.1,'legacy club-name scope retained');
assert.equal(bridge.normalizePlayer(player('club-a')).clubId,'club-a','handoff retains club scope');
const own={clubId:'club-a',snapshots:clubs[0].members};assert.equal(B.reviewBaselines(own,clubs[0]).length,1);assert.deepEqual(B.reviewBaselines(own,clubs[1]),[],'rebase cannot use the same person from a different club');
const state={clubs:structuredClone(clubs)};const applied=B.prepare(state,'club-a',[{id:'p0',original:state.clubs[0].members[0],step:0,skillRating:4.25}],'review-a','batch-a');
const identical={clubs:[{id:'club-a',members:[member(3.5)]},{id:'club-b',members:[member(3.5)]}]};assert.throws(()=>B.prepare(identical,'club-b',[{clubId:'club-a',id:'p0',original:member(3.5),step:0,skillRating:4.1}],'review-a','batch-wrong'),'even identical profiles cannot receive another club correction');
assert.deepEqual(applied.state.clubs[1],state.clubs[1]);assert.equal(applied.state.clubs[0].members[0].skillRating,4.25,'only selected club roster changes');
function cut(src,name){const start=src.indexOf('function '+name+'('),end=src.indexOf('\nfunction ',start+1);assert(start>=0&&end>start);return src.slice(start,end);}
function runTeam(source=team){
 const p=player('club-a'),c={window:ctx.window,_directPlayers:[p],_rsvpSyncingImportedPlayers:false,currentMatches:[],_rsvpClubs:()=>[clubs[1]],_rsvpSelectedSource:()=>'',RSVP_DIRECT_VALUE:'direct',_teamRosterBridge:()=>bridge,_rsvpMemberId:id,_rsvpNameKey:n=>n.trim().toLowerCase(),gradeToLevel:()=>4,levelToGrade:()=> 'C',_partners:[],teamAssignment:null,scheduleSave(){},syncDirectToPaste(){},updateTeamModeBadge(){},_liveOn:false,_teamSaveRosterBridge(){},saveState(){},rsvpSaveLocal(){}};
 vm.createContext(c);vm.runInContext(cut(source,'_rsvpSyncImportedPlayersFromRoster'),c);c._rsvpSyncImportedPlayersFromRoster();assert.equal(c._directPlayers[0].skillRating,4.1,'team must preserve original club correction if source member is missing');return c;
}
runTeam();assert.throws(()=>runTeam(team.replace("const roster=_teamRosterBridge()?.resolveMember(clubs,p,selectedClub?.id||'',_rsvpMemberId);",'const roster=clubs.flatMap(c=>c.members).find(m=>m.name===p.name);')),assert.AssertionError,'mutation detects cross-club fallback');
const d={window:ctx.window,_dailyPlayers:[player('club-a')],rosters:{clubs:[clubs[1]]},_rsvpMemberId:id,_rsvpNameKey:n=>n.toLowerCase(),_dailyGender:()=> 'M',_dailyGenderLabel:()=> '남',gradeToLevel:()=>4,dailySave(){},dailyRender(){}};
vm.createContext(d);vm.runInContext(cut(daily,'_dailySyncPlayerRolesFromRoster'),d);d._dailySyncPlayerRolesFromRoster();assert.equal(d._dailyPlayers[0].skillRating,4.1,'daily correction cannot transfer across clubs');
const generated={...player('club-a')},profileCtx={_teamGenderCode:()=> 'M',gradeToLevel:()=>4,levelToGrade:()=> 'C'};vm.createContext(profileCtx);vm.runInContext(cut(team,'_teamApplyDirectProfileToPlayer'),profileCtx);assert.equal(profileCtx._teamApplyDirectProfileToPlayer(generated,new Map([[generated.name,player('club-b')]])),false);assert.equal(generated.skillRating,4.1,'generated match profile does not absorb another club correction');
const slimCtx={};vm.runInNewContext(team.match(/function slim\(p\)\{[^\n]+/)[0],slimCtx);assert.equal(slimCtx.slim(player('club-a')).clubId,'club-a');assert.equal(slimCtx.slim(player('club-b')).skillRating,2.9,'persisted match profile retains club-specific rating');
function checkEditor(source){const e={_editDirIdx:0,_directPlayers:[{name:'E2E공통',clubId:'club-a',club:'E2E A클럽',grade:'C',gender:'남',ageGroup:'40대',level:4.6,skillStep:3}],_editDirGrade:'C',_editDirGender:'남',_editDirAge:'30대',document:{getElementById:()=>({value:'E2E이름수정'})},gradeToLevel:()=>4,rosterSkillLevel:ctx.rosterSkillLevel,_teamEnsureMemberId(){},temporaryOperators:[],closeEditDirectModal(){},renderDirectPlayerList(){},syncDirectToPaste(){},saveState(){},_liveOn:false,rsvpSyncRosterChange(){}};vm.createContext(e);vm.runInContext(cut(source,'saveEditDirectPlayer'),e);e.saveEditDirectPlayer();assert.equal(e._directPlayers[0].level,4.6,'rename/age edit preserves existing club correction');assert.equal(e._directPlayers[0].clubId,'club-a');assert.equal(e._directPlayers[0].skillStep,3);}
checkEditor(team);checkEditor(daily);assert.throws(()=>checkEditor(team.replace('sameSkillProfile&&previous.level!=null','false&&previous.level!=null')),assert.AssertionError,'legacy correction-loss mutation detected');
const Qctx={};vm.runInNewContext(fs.readFileSync('js/match-quality.js','utf8'),Qctx);assert.equal(Qctx.KokMatchQuality.effectiveLevel(bridge.normalizePlayer(player('club-a'))),4.1);assert.equal(Qctx.KokMatchQuality.effectiveLevel(bridge.normalizePlayer(player('club-b'))),2.9,'match engine receives independently corrected club scores');
const values={},db={ref(path){return {async once(){return {val:()=>structuredClone(values[path]??null)};},async transaction(fn){const next=fn(structuredClone(values[path]??null));if(next!==undefined)values[path]=next;return {committed:next!==undefined,snapshot:{val:()=>structuredClone(values[path]??null)}};}};}};
(async()=>{const ids=['1'.repeat(32),'2'.repeat(32)],keys=['3'.repeat(32),'4'.repeat(32)];const profiles=Array.from({length:4},(_,i)=>({...member(3.5),name:'E2E회원'+i,skillRating:undefined,level:4}));
 for(let i=0;i<2;i++)await S.handle(db,{action:'create',id:ids[i],key:keys[i],clubId:clubs[i].id,clubName:clubs[i].name,invites:['5','6','7'].map(x=>x.repeat(32)),players:profiles},'local-'+i);
 const a=values['skillCalibration/'+ids[0]],b=values['skillCalibration/'+ids[1]];a.votes={e0:{p0_p1:'a'}};assert.equal(S.project(a,'owner').count,1);assert.equal(S.project(b,'owner').count,0);assert(S.project(b,'owner').proposals.every(p=>!p.ready),'identical IDs in another club do not import responses');
 assert(C.pairs(a.players).every(q=>a.players.some(p=>p.id===q.a)&&a.players.some(p=>p.id===q.b)),'questions remain inside one club assessment');
 await assert.rejects(S.handle(db,{action:'read',id:ids[0],key:keys[0],clubId:clubs[1].id,baselines:a.players},'local'),'wrong club cannot rebase an assessment');
 assert.equal((await S.handle(db,{action:'read',id:ids[0],key:keys[0],clubId:clubs[0].id},'local')).clubId,clubs[0].id);
 console.log('club scope: same person independent ratings, missing/ambiguous source safe, legacy source, isolated rebase/apply/questions/votes, daily/team/handoff/match delivery and mutation passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
