/* Private account binding, durable command outbox and authoritative live-state hydration. */
(function(){
'use strict';
const workspace=()=>window.MintonAdminWorkspace;
const enabled=()=>!!workspace()?.connected;
const clone=x=>JSON.parse(JSON.stringify(x));
let applying=false,working=null;const heads={},receipts=new Map();
const mode=()=>location.pathname.endsWith('team.html')?'team':'daily';
const notice=message=>{const el=document.querySelector('#accountBar span');if(el)el.textContent=message;};
function dailyAdopt(out){
 const s=out.state;if(!s||typeof _dailyPlayers==='undefined')return;
 _dailyCheckinId=out.id;_dailyCheckinCreatedAt=Number(s.createdAt)||Date.now();_dailyOfficialInviteToken=out.inviteToken||_dailyOfficialInviteToken;_dailyOfficialInviteHash=s.officialInvite?.tokenHash||'';
 _dailyCheckinIdentityPending=false;_dailyCheckinOwnershipVerified=true;_dailyCheckinNeedsPublish=false;
 // The public completed log is also the source for a newly opened administrator device.
 const lookup=name=>s.players.find(p=>p.name===name)?.id||('archive_'+name);
 const previous=_dailyMatches.slice(),log=s.completedLog||[],sameDay=Number(s.event?.operationStartedAt||0)===Number(_dailyOperationStartedAt||0),oldest=Math.min(...log.map(row=>Number(row.seq)));
 const earlier=sameDay&&log.length>=80?previous.filter(m=>m.completedAt&&Number(m.seq)<oldest):[];
 _dailyMatches=[...earlier,...log.map(row=>{
  const old=previous.find(m=>Number(m.seq)===Number(row.seq)&&Number(m.completedAt)===Number(row.endAt));
  return {...old,id:old?.id||'account_done_'+row.seq+'_'+row.endAt,seq:row.seq,court:row.court,type:row.type,team1:(row.t1||[]).map(lookup),team2:(row.t2||[]).map(lookup),startedAt:row.startAt,completedAt:row.endAt};
 })];
 _dailyAdoptServerSnapshot(s,{rollover:false});_dailyOperationStarted=!!s.event?.operationStarted;_dailyOperationStartedAt=Number(s.event?.operationStartedAt)||0;
 _dailyLastCompleteUndo=out.undo?{...out.undo,state:{},source:out.undo.type==='official-queue-enter-free'?'club-official-queue-enter':'account-server'}:null;
 _dailyPersistCheckinIdentity();dailySave({preserveServerQueue:true});_dailyCheckinNeedsPublish=false;dailyRender();
}
function teamAdopt(out){
 const s=out.state;if(!s||typeof currentMatches==='undefined')return;
 _liveApplyingServer=true;
 try{
  const member=(p,team)=>({memberId:p.id||'',name:p.n||p.name||'',level:Number(p.l??p.level)||3,grade:p.gr||p.grade||'C',gender:p.g||p.gender||'M',ageGroup:p.a||p.ageGroup||'40대',team,isGuest:!!p.isGuest,isClubOfficial:!!p.isClubOfficial,partnerName:p.partnerName||''});
  teamNames={blue:s.teamBlue||'청 팀',white:s.teamWhite||'홍 팀'};
  const blue=(s.members?.blue||[]).map(p=>member(p,teamNames.blue)),white=(s.members?.red||[]).map(p=>member(p,teamNames.white));
  currentParticipants=s.isTeam?[...blue,...white]:(s.members?.all||[]).map(p=>member(p,''));teamAssignment=s.isTeam?{blue,white}:null;
  const byName=name=>currentParticipants.find(p=>p.name===name)||{name,level:3,grade:'C',gender:'M'};
  currentMatches=(s.matches||[]).map(m=>({matchNumber:m.num,round:m.round,court:m.court,type:m.type,isFiller:!!m.isFiller,voided:!!m.voided,team1A:byName(m.t1[0]),team1B:byName(m.t1[1]),team2C:byName(m.t2[0]),team2D:byName(m.t2[1])}));
  currentSettings={...(currentSettings||{}),courts:s.courts,gamesPerPlayer:s.gamesPerPlayer||4,teamMode:!!s.isTeam};
  _directPlayers=currentParticipants.map(p=>({...p}));_liveId=out.id;_liveOn=!s.finishedAt;_teamFinishedAt=s.finishedAt||null;_liveMatchStartedAt=s.matchStartedAt||null;
  _liveLate=s.late||{};_liveParty=s.party||{};_liveResultInputs=s.resultInputs||{};_liveResultConflicts=s.resultConflicts||{};temporaryOperators=_teamNormalizeTemporaryOperators(s.officials?.temporaryOperators);
  Object.keys(winOverride).forEach(k=>delete winOverride[k]);Object.keys(liveWinAt).forEach(k=>delete liveWinAt[k]);(s.matches||[]).forEach((m,i)=>{if(m.win)winOverride[i]=m.win;if(m.winAt)liveWinAt[i]=m.winAt;});
  document.getElementById('courts').value=s.courts;_pointSystem=s.pointSystem||25;
  renderDirectPlayerList();renderResults(currentMatches,currentParticipants,currentSettings);_updateLiveUI();saveState();
 }finally{_liveApplyingServer=false;}
}
function adopt(which,out){
 if(!workspace()?.active)throw Error('계정이 변경되었습니다.');
 if(out.games)workspace().setGames(out.games);
 if(out.closed){
  applying=true;try{if(out.state){if(which==='daily')dailyAdopt(out);else teamAdopt(out);}}finally{applying=false;}
  workspace().store.meta({closedSeen:{...workspace().store.read().closedSeen,[which]:out.id}});
  const current={...workspace().games};delete current[which];workspace().setGames(current);delete heads[which];
  applying=true;try{if(which==='daily'&&typeof _dailyCheckinId!=='undefined'){_dailyCheckinId=null;_dailyCheckinCreatedAt=0;_dailyOfficialInviteToken='';_dailyOfficialInviteHash='';_dailyCheckinNeedsPublish=false;_dailyPersistCheckinIdentity();dailySave({preserveServerQueue:true});dailyRender();}else if(which==='team'&&typeof _liveId!=='undefined'){_teamResetLocalLiveState(out.id);_teamFinishedAt=Number(out.closedAt)||Date.now();saveState();renderAutoFlowDashboard();}}finally{applying=false;}return;
 }
 heads[which]={...heads[which],...out};if(!out.state)return;
 applying=true;try{if(which==='daily')dailyAdopt(out);else teamAdopt(out);}finally{applying=false;}
}
async function drain(){
 if(working)return working;
 working=(async()=>{
  const w=workspace();if(!w?.active)return;
  let pending=w.store.read().gamePending||[];
  for(const item of pending){
   if(!w.active)return;
   if(w.games[item.mode]?.id!==item.id){notice('다른 운동의 대기 요청입니다 · 계정 자료에 보관');return;}
   try{
    const out=await w.gameCall(item);adopt(item.mode,out);receipts.set(item.command.operationId,out.receipt);
    w.store.meta({gamePending:(w.store.read().gamePending||[]).filter(row=>row.command.operationId!==item.command.operationId)});
    if(out.receipt.status!=='applied'){w.store.meta({gameConflict:{at:Date.now(),command:item.command,reason:out.receipt.reason}});notice(out.receipt.reason||'경기 변경 충돌 · 최신 화면에서 확인');}
   }catch(e){
    if(/failed-precondition|permission-denied|not-found|already-exists|aborted|invalid-argument/.test(e.code||'')){
     w.store.backup('처리하지 못한 경기 요청');w.store.meta({gameConflict:{at:Date.now(),command:item.command,reason:e.message},gamePending:(w.store.read().gamePending||[]).filter(row=>row.command.operationId!==item.command.operationId)});receipts.set(item.command.operationId,{status:'rejected',reason:e.message});continue;
    }
    notice('경기 요청을 기기에 보관 · 연결되면 재전송');throw e;
   }
  }
 })().finally(()=>{working=null;});return working;
}
async function refresh(){
 if(!enabled()||applying||!workspace().active)return;
 await drain();const which=mode(),binding=workspace().games[which];if(!binding){const closed=workspace().closedGames[which];if(closed&&workspace().store.read().closedSeen?.[which]!==closed.id){const out=await workspace().gameCall({action:'read',mode:which,id:closed.id});adopt(which,out);}return;}
 const out=await workspace().gameCall({action:'read',mode:which,id:binding.id,sinceRevision:heads[which]?.revision});adopt(which,out);
}
async function command(which,input){
 const w=workspace(),binding=w.games[which];if(!w.active||!binding)throw Error('경기 연결을 먼저 확인해 주세요.');
 const now=Date.now(),operationId=input.operationId||crypto.randomUUID().replace(/-/g,''),cmd={createdAt:now,expiresAt:now+30*60000,...input,operationId};
 const pending=w.store.read().gamePending||[];if(pending.length>=50)throw Error('대기 요청이 많습니다. 연결 후 다시 선택해 주세요.');
 if(!pending.some(p=>p.command.operationId===operationId))w.store.meta({gamePending:[...pending,{action:'command',mode:which,id:binding.id,device:w.device,command:cmd}]});
 try{await drain();}catch(e){return {live:true,ok:false,queued:true,reason:'기기에 요청을 보관했습니다. 연결되면 한 번만 처리합니다.'};}
 const receipt=receipts.get(operationId);return {live:true,ok:receipt?.status==='applied',receipt,operationId,reason:receipt?.reason};
}
async function publish(which){
 const w=workspace();await w.flush();if(w.store.read().conflicts?.length||w.store.read().pending)throw Error('설정 동기화를 먼저 마쳐 주세요.');
 const state=which==='daily'?_dailyCheckinPayload():_buildLiveState();
 const out=await w.gameCall({action:'create',mode:which,revision:w.store.read().revision,state,operationId:crypto.randomUUID().replace(/-/g,'')});
 w.setGames(out.games);adopt(which,out);return which==='daily'?_dailyCheckinUrl():out.id;
}
async function editTeam(){
 if(applying||!heads.team)return;
 const result=await command('team',{type:'team-admin-edit',expectedRevision:heads.team.revision,state:_buildLiveState()});if(!result.ok&&!result.queued)alert(result.reason||'다른 기기의 변경을 확인해 주세요.');return result;
}
function guardWrite(ref){
 if(!enabled())return;
 const path=String(ref),bindings=workspace().games;
 if(Object.entries(bindings).some(([which,b])=>path.includes('/live/'+(which==='daily'?'checkin_':'')+b.id)))return Promise.reject(Error('계정 경기는 서버 명령으로 저장해야 합니다.'));
}
async function syncCandidates(){
 const head=heads.daily;if(!enabled()||applying||workspace().hydrating||!head?.state)return false;
 const candidates=_dailyOfficialArrivalCandidates(),club=String(_dailyOfficialArrivalRoster()?.name||'');
 if(MintonWorkspaceMerge.same(candidates,head.state.arrivalCandidates||[])&&club===(head.state.arrivalClub||''))return true;
 const result=await command('daily',{type:'account-arrival-candidates',expectedRevision:head.revision,candidates,club});return result.ok;
}
async function close(which){const head=heads[which];if(!head)throw Error('경기를 먼저 동기화해 주세요.');return command(which,{type:'account-close',expectedRevision:head.revision});}
window.MintonAccountGames={close,guardWrite,syncCandidates,enabled,get applying(){return applying;},heads,refresh,publish,command,editTeam};
})();
