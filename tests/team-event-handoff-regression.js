'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm'),E=require('../js/team-event-skill'),B=require('../js/club-skill-batch');
const ui=fs.readFileSync('js/team-event-ui.js','utf8'),team=fs.readFileSync('js/team.js','utf8'),clone=v=>JSON.parse(JSON.stringify(v));
const cut=(a,b)=>{const i=team.indexOf(a),j=team.indexOf(b,i+a.length);assert(i>=0&&j>i,a);return team.slice(i,j);};
function data({bracket=false}={}){
  const values=new Map(),events=[],storage={failContext:false,failRoster:false,getItem:k=>values.get(k)??null,setItem(k,v){if((this.failContext&&k.startsWith('kokmatch_team_skill_event_v1:'))||(this.failRoster&&k==='badminton_rosters_v1'))throw Error('E2E 저장 실패');events.push('write:'+k);values.set(k,String(v));},removeItem(k){events.push('remove:'+k);values.delete(k);}};
  const members=Array.from({length:4},(_,i)=>({memberId:'m'+i,name:'E2E등록'+i,grade:'C',gender:'남',ageGroup:'40대',skillStep:0,level:4,skillRating:3.5}));
  const state={clubs:[{id:'club',name:'E2E클럽',members:clone(members)}]},players=members.map(m=>({...clone(m),clubId:'club',club:'E2E클럽'}));
  players.push({memberId:'guest',name:'E2E게스트',grade:'C',gender:'남',ageGroup:'40대',skillStep:0,level:4,skillRating:3.5,isGuest:true});
  const profile=p=>({...clone(p),memberKey:E.key(p)}),context={id:'E2E-team',title:'E2E신청자전',clubId:'club',clubName:'E2E클럽',players:players.map(profile),evaluators:[{memberKey:'["club","officer"]',name:'E2E임원'}],bindings:Object.fromEntries(players.filter(p=>!p.isGuest).map((p,i)=>[E.key(p),{clubId:'club',memberId:p.memberId,name:p.name,original:clone(members[i])}])),draft:{players:clone(players),teamAssignment:null,captains:{},partners:[],hasBracket:bracket,courts:'2',gamesPerPlayer:'4'}};
  const bridge=E.create(storage);bridge.saveContext(context);bridge.updateAssessment(context.id,{id:'E2E-review',key:'E2E-key',createdAt:100,scopeSignature:bridge.signature(context)});
  const ps=context.players.map((p,i)=>({...clone(p),id:'p'+i,base:3.5})),session={id:'E2E-review',event:{id:context.id,revision:1},players:ps,evaluators:clone(context.evaluators),resultRevision:'result-1',proposals:ps.map((p,i)=>({id:p.id,name:p.name,step:0,skillRating:i===4?4.3:4.1,ready:i===0||i===4,basis:clone(p),eventRevision:1}))};
  bridge.stageResults(context.id,session);storage.setItem('badminton_rosters_v1',JSON.stringify(state));storage.setItem('kokmatch_team_rsvp_id',context.id);
  const saved={settings:{rsvpId:context.id,skillScoresFrozen:true},matches:[{matchNumber:1}],directPlayers:clone(players),participants:[]};if(bracket)storage.setItem('badminton_team_bracket_v7',JSON.stringify(saved));events.length=0;
  return {storage,values,events,state,players,context,session,shared:{players:clone(players)},saved};
}
function load(x,options={}){
  const nodes=new Map(),listeners={},timers=[],calls={fetch:0,clear:0,sync:0,commit:0,save:0,restore:0},element=tag=>({tag,children:[],value:'',textContent:'',classList:{add(){},remove(){}},setAttribute(){},append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},after(n){nodes.set(n.id,n);}});
  for(const [id,value] of [['courts','2'],['gamesPerPlayer','4'],['autoFlowCard',''],['resultArea',''],['teamListWrap','']]){const n=element('div');n.id=id;n.value=value;nodes.set(id,n);}
  const bridge=E.create(x.storage),ctx={console,Date,Math,JSON,Map,Set,Object,Array,Number,String,URL,URLSearchParams,AbortSignal,structuredClone:clone,localStorage:x.storage,
    location:{href:'https://example.test/team.html?skillEvent='+x.context.id,search:'?skillEvent='+x.context.id},history:{replaceState(a,b,url){ctx.location.href=String(url);ctx.location.search=new URL(String(url)).search;}},
    document:{getElementById:id=>nodes.get(id)||null,createElement:element,addEventListener:(event,fn)=>listeners[event]=fn},setTimeout:fn=>timers.push(fn),
    KokTeamEventSkill:{...bridge,commitApplied(value){calls.commit++;x.events.push('commit');if(options.failCommit)x.storage.failContext=true;return bridge.commitApplied(value);}},KokSkillBatch:B,
    _rsvpId:x.context.id,_teamParticipantSourceRsvpId:x.context.id,_directPlayers:clone(x.players),teamAssignment:null,captains:{},_partners:[],currentMatches:[],currentParticipants:[],currentSettings:{},
    _liveOn:false,_liveId:null,_liveMatchStartedAt:null,_teamFinishedAt:null,_teamAssignmentBusy:false,_rsvpSyncingImportedPlayers:false,winOverride:{},_teamModeOverride:null,_teamWanted:true,temporaryOperators:[],
    RSVP_KEY:'kokmatch_team_rsvp_id',SAVE_KEY:'badminton_team_bracket_v7',ROSTER_KEY:'badminton_rosters_v1',LV_VERSION:1,RSVP_DIRECT_VALUE:'direct',rosters:clone(x.state),
    _currentBracketRsvpId:()=>ctx.currentSettings.rsvpId||ctx._teamParticipantSourceRsvpId||null,_teamStoredLiveId:()=>'',_isMatchDone:()=>false,
    _rsvpMemberId:p=>p.memberId||'derived:'+p.name,_rsvpSelectedSource:()=> 'club',
    _rsvpClubs:()=>{ctx.rosters=JSON.parse(x.storage.getItem('badminton_rosters_v1'));return ctx.rosters.clubs;},
    _teamEnsureMemberId:p=>p.memberId,effLevel:p=>p.skillRating??p.level-.5,levelToGrade:()=> 'C',gradeToLevel:()=>4,
    _teamRosterBridge:()=>({load:()=>clone(x.shared),save(mode,players){x.shared={players:clone(players)};return x.shared;},resolveMember(clubs,p){const club=clubs.find(c=>c.id===p.clubId);const member=club?.members.find(m=>m.memberId===p.memberId);return member?{...member,clubId:club.id,club:club.name}:null;}}),
    _teamSaveRosterBridge(){x.shared={players:clone(ctx._directPlayers)};},syncDirectToPaste(){},updateTeamModeBadge(){},scheduleSave(){},renderTeamList(){},renderResults(){},updateScores(){},pushLiveState(){},showWarn(){},hideErr(){},_resetScoreboard(){},
    rsvpSyncRosterChange(){calls.sync++;x.events.push('rsvp-sync');},rsvpPushEventState(){},_captureUndoSnapshot(){calls.clear++;},_teamUsesFixedTeams:()=>true,
    _teamSyncGeneratedProfilesFromDirectPlayers:()=>false,renderClubList(){},renderDirectPlayerList(){ctx._rsvpSyncImportedPlayersFromRoster();},
    saveState(){calls.save++;ctx._teamSaveRosterBridge();},restoreState(){calls.restore++;const s=JSON.parse(x.storage.getItem(ctx.SAVE_KEY));ctx.currentMatches=clone(s.matches);ctx.currentSettings=clone(s.settings);ctx._directPlayers=clone(s.directPlayers);},
    showErr:message=>x.events.push('error:'+message),confirm:()=>options.confirm!==false,doTeamAssignFromUI(){},
    fetch:async(url,request)=>{calls.fetch++;assert.equal(JSON.parse(request.body).data.action,'read');if(options.onFetch)await options.onFetch(ctx,x);return {ok:true,json:async()=>({result:clone(x.session)})};}
  };
  ctx.window=ctx;Object.assign(ctx,options.globals||{});vm.createContext(ctx);
  vm.runInContext(cut('function _rsvpSyncImportedPlayersFromRoster(){','function renderDirectPlayerList(){')+cut('function saveRosters(){','function addClub(){')+cut('function _rsvpClearUnstartedBracket(){','function rsvpImportAttendees(){'),ctx);
  vm.runInContext(options.source||ui,ctx);
  const idle=async()=>{for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));};
  async function start(){listeners.DOMContentLoaded();while(timers.length)timers.shift()();await idle();}
  const notice=()=>nodes.get('teamEventSkillNotice'),button=()=>notice()?.children.find(n=>n.tag==='button');
  return {ctx,calls,start,idle,notice,button,bridge};
}
(async()=>{
  {
    const x=data(),f=load(x);await f.start();assert.equal(f.calls.fetch,1);assert.equal(f.calls.commit,1);assert.equal(f.calls.sync,1);
    const state=JSON.parse(x.storage.getItem('badminton_rosters_v1'));assert.equal(state.clubs[0].members[0].skillRating,4.1);assert.equal(state.clubs[0].members[1].skillRating,3.5);
    assert.equal(f.ctx._directPlayers[0].skillRating,4.1,'real saveRosters synchronizes registered players before generation');
    assert.equal(f.ctx._directPlayers[4].skillRating,3.5,'guest raw input remains unchanged');assert.equal(f.ctx.teamEventSkillPlayer(f.ctx._directPlayers[4]).skillRating,4.3,'guest receives event-only generation overlay');
    assert.equal(f.ctx.teamEventSkillPlayer(f.ctx._directPlayers[0]).skillRating,4.1);assert(!f.bridge.readContext(x.context.id).pending);assert(!f.ctx.location.search.includes('skillEvent'));
    assert(x.events.findIndex(e=>e==='write:badminton_rosters_v1')<x.events.indexOf('commit'),'official write precedes context commit');
    assert(x.events.indexOf('rsvp-sync')<x.events.indexOf('commit'),'normal roster sync completes before commit');
  }
  {
    const x=data({bracket:true}),f=load(x);await f.start();assert.equal(f.calls.fetch,0);assert.equal(f.calls.clear,0);assert(f.bridge.readContext(x.context.id).pending);
    assert(f.button().textContent.includes('미진행 대진 정리'));await f.button().onclick();await f.idle();assert.equal(f.calls.clear,1);assert.equal(f.calls.commit,1);assert.equal(f.ctx.currentMatches.length,0);assert(!x.storage.getItem(f.ctx.SAVE_KEY));
  }
  {
    const x=data({bracket:true}),f=load(x,{confirm:false});await f.start();const before=x.storage.getItem('badminton_rosters_v1');await f.button().onclick();await f.idle();assert.equal(f.calls.clear,0);assert.equal(f.calls.fetch,0);assert.equal(x.storage.getItem('badminton_rosters_v1'),before);assert(f.bridge.readContext(x.context.id).pending);
  }
  for(const globals of [{_liveOn:true},{_liveMatchStartedAt:123},{_teamFinishedAt:123},{_teamAssignmentBusy:true},{_isMatchDone:()=>true,currentMatches:[{}]}]){
    const x=data(),f=load(x,{globals});await f.start();assert.equal(f.calls.fetch,0,'progress blocks '+JSON.stringify(globals));assert.equal(f.calls.commit,0);assert(f.bridge.readContext(x.context.id).pending);
  }
  {
    const x=data(),f=load(x,{onFetch:ctx=>{ctx._liveMatchStartedAt=999;}});await f.start();assert.equal(f.calls.commit,0,'start during server read blocks saving');assert(f.bridge.readContext(x.context.id).pending);
  }
  {
    const x=data(),f=load(x,{onFetch:(ctx,x)=>{x.shared.players[4].grade='B';}});await f.start();assert.equal(f.calls.commit,0,'same-ID profile edit during server read is preserved');assert.equal(x.shared.players[4].grade,'B');assert(f.bridge.readContext(x.context.id).pending);
  }
  for(const bracket of [false,true]){
    const x=data({bracket}),f=load(x,{failCommit:true});await f.start();if(bracket){await f.button().onclick();await f.idle();}
    assert.equal(f.calls.commit,1);assert(f.bridge.readContext(x.context.id).pending,'failed commit preserves pending');assert.equal(JSON.parse(x.storage.getItem('badminton_rosters_v1')).clubs[0].members[0].skillRating,4.1);
    x.storage.failContext=false;const retry=load(x);await retry.start();if(retry.button()?.textContent.includes('미진행 대진 정리')){await retry.button().onclick();await retry.idle();}
    assert.equal(retry.calls.commit,1,'reload retries after clear/write/commit failure (bracket='+bracket+'): '+retry.notice()?.children.map(n=>n.textContent).join(' / '));assert(!retry.bridge.readContext(x.context.id).pending);assert.equal(JSON.parse(x.storage.getItem('badminton_rosters_v1')).clubs[0].members[0].skillRating,4.1);
  }
  for(const bracket of [false,true]){
    const x=data({bracket}),f=load(x);x.storage.failRoster=true;await f.start();if(bracket){await f.button().onclick();await f.idle();}
    assert.equal(f.calls.commit,0);assert.equal(f.calls.clear,0,'roster write failure must preserve the original bracket');assert(f.bridge.readContext(x.context.id).pending);assert.equal(JSON.parse(x.storage.getItem('badminton_rosters_v1')).clubs[0].members[0].skillRating,3.5);
    if(bracket){assert(x.storage.getItem(f.ctx.SAVE_KEY));assert.equal(f.ctx.currentMatches.length,1);}
    x.storage.failRoster=false;const retry=load(x);await retry.start();if(bracket){await retry.button().onclick();await retry.idle();}assert.equal(retry.calls.commit,1,'retry after official storage failure succeeds');
  }
  {
    const x=data(),f=load(x);await f.start();const old={...clone(x.players[0]),skillRating:3.5};f.ctx.currentSettings={};f.ctx.currentMatches=[{team1A:old,team1B:old,team2C:old,team2D:old}];f.ctx.currentParticipants=[old];
    vm.runInContext(cut('function _teamApplyDirectProfileToPlayer(','function saveState(){'),f.ctx);
    assert(f.ctx.teamEventProtectsBracket(),'official protected source is found through the real helper source ledger');assert.equal(f.ctx._teamSyncGeneratedProfilesFromDirectPlayers(),false);assert.equal(old.skillRating,3.5,'existing bracket retains its saved score even when the source roster is newer');
  }
  {
    const start=team.indexOf('    currentParticipants=state.participants.map'),end=team.indexOf('    _teamParticipantSourceRsvpId=currentSettings?.rsvpId||null;',start),restore=team.slice(start,end);
    const raw=Array.from({length:4},(_,i)=>({name:'E2E복원게스트'+i,memberId:'g'+i,gender:'M',grade:'C',ageGroup:'40대',skillRating:3.5,level:4,isGuest:true}));
    const ps=raw.map(p=>({...p,skillRating:4.3,level:4.8})),state={settings:{skillScoresFrozen:true},participants:ps,matches:[{round:1,court:1,team1A:ps[0],team1B:ps[1],team2C:ps[2],team2D:ps[3],team1Level:8.6,team2Level:8.6,levelDiff:0}]};
    function run(code){const c={state:clone(state),_directPlayers:clone(raw),currentParticipants:[],currentMatches:[],currentSettings:{},teamAssignment:null,window:{teamEventProtectsBracket:()=>false},_attachPartnerNames(){},_restoreJoinerGoals(){},_teamAutoFormatSettings:s=>s,_teamGenderCode:g=>g,effLevel:p=>p.skillRating,levelToGrade:()=> 'C',gradeToLevel:()=>4};vm.createContext(c);vm.runInContext(cut('function _teamApplyDirectProfileToPlayer(','function saveState(){')+code,c);return c;}
    assert(run(restore).currentParticipants.every(p=>p.skillRating===4.3),'actual restore block preserves guest event scores before direct-profile synchronization');
    const mutant=restore.replace('currentSettings=_teamAutoFormatSettings(state.settings,currentParticipants);\n    const profileChanged=_teamSyncGeneratedProfilesFromDirectPlayers();','const profileChanged=_teamSyncGeneratedProfilesFromDirectPlayers();\n    currentSettings=_teamAutoFormatSettings(state.settings,currentParticipants);');
    assert.notEqual(mutant,restore);assert(run(mutant).currentParticipants.every(p=>p.skillRating===3.5),'mutation exposes the old guest-restore reset');
  }
  console.log('PASS event handoff: real callbacks/helper/roster-sync, explicit bracket clear, start/profile races, official-before-context order, preserved pending and reload recovery, registered refresh and guest-only overlay');
})().catch(error=>{console.error(error);process.exitCode=1;});
