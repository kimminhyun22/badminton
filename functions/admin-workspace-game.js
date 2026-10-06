'use strict';
// Account authorization surrounds the same live transactions used by anonymous member links.
const crypto=require('crypto');
const W=require('./admin-workspace');
const {canonicalJson,issueOfficialGrant}=require('./daily-official-engine');
const {applyCommandTransaction}=require('./daily-official-command');
const {applyTeamOfficialRequest}=require('./team-official-engine');
const {flushPendingArchives}=require('./daily-archive');
const clone=x=>JSON.parse(JSON.stringify(x));
const hash=x=>crypto.createHash('sha256').update(canonicalJson(x)).digest('hex');
const fail=(message,code='failed-precondition')=>{throw Object.assign(Error(message),{code});};
const cleanId=x=>{if(!/^[a-zA-Z0-9_-]{16,100}$/.test(x||''))fail('요청 번호를 확인해 주세요.');return x;};
function publicGames(games){return Object.fromEntries(Object.entries(games||{}).filter(([,v])=>!v.closed).map(([k,v])=>[k,{id:v.id,createdAt:v.createdAt}]));}
function teamValid(s){
 if(!s||!Array.isArray(s.matches)||!s.matches.length||s.matches.length>2000||!Number.isInteger(Number(s.courts))||s.courts<1||s.courts>20)fail('팀전 대진과 코트 수를 확인해 주세요.');
 const nums=new Set(),slots=new Set(),players=new Set();
 for(const m of s.matches){
  if(!Number.isInteger(Number(m.num))||nums.has(m.num))fail('경기 번호가 중복되었습니다.');nums.add(m.num);
  if(!Number.isInteger(Number(m.court))||m.court<1||m.court>20||!Number.isInteger(Number(m.round))||m.round<1)fail('경기 코트와 라운드를 확인해 주세요.');
  const names=[...(m.t1||[]),...(m.t2||[])];if(names.length!==4||names.some(n=>typeof n!=='string'||!n)||new Set(names).size!==4)fail('한 경기의 선수 4명을 확인해 주세요.');
  if(m.voided)continue;
  const slot=m.round+':'+m.court;if(slots.has(slot))fail('같은 코트에 경기가 겹칩니다.');slots.add(slot);
  for(const name of names){const key=m.round+':'+name;if(players.has(key))fail('같은 선수가 한 라운드에 중복 배정되었습니다.');players.add(key);}
 }
}
function dailyValid(s){if(!s||!Array.isArray(s.players)||!s.players.length||!s.event||s.players.length>500)fail('민턴LIVE 명단을 확인해 주세요.');const ids=s.players.map(p=>p.id);if(new Set(ids).size!==ids.length||ids.some(id=>!id))fail('선수 번호를 확인해 주세요.');}
const {transaction}=require('./workspace-transaction');
function view(binding,root,mode,since,now=Date.now()){
 if(root?.closed)return {id:binding.id,closed:true,closedAt:root.closedAt,revision:hash(root),...(binding.finalJSON?{state:JSON.parse(binding.finalJSON)}:{})};
 const state=mode==='daily'?root?.session:root;if(!state)fail('종료되었거나 없는 경기입니다.','not-found');
 const revision=hash(state),undo=mode==='daily'?Object.values(root.serverOps||{}).filter(r=>!r.undoneAt&&r.expiresAt>now&&Number(r.afterRevision)===Number(state.serverRevision)).sort((a,b)=>b.createdAt-a.createdAt)[0]:null;
 return {id:binding.id,revision,...(revision!==since?{state}:{}),...(mode==='daily'?{inviteToken:binding.inviteToken,undo:undo?{token:undo.token,type:undo.type,expiresAt:undo.expiresAt,createdAt:undo.createdAt}:null}:{})};
}
function teamEdit(current,command){
 // Remaining legacy administrator edits have an explicit whole-view precondition.
 // An official's concurrent update is never overwritten by a stale browser snapshot.
 if(command.expectedRevision!==hash(current))return {status:'rejected',reason:'다른 기기에서 경기가 변경되었습니다. 최신 화면에서 다시 선택해 주세요.',session:current};
 const allowed=['title','eventLabel','bracketKey','members','officials','isTeam','matchMode','teamBlue','teamWhite','matches','courts','pointSystem','quality','gamesPerPlayer'];
 const next=clone(current);for(const key of allowed)if(Object.hasOwn(command.state||{},key))next[key]=clone(command.state[key]);
 if(command.state?.matches)next.matches=next.matches.map(m=>({...current.matches.find(old=>old.num===m.num),...m}));
 teamValid(next);
 let blue=0,white=0;for(const m of next.matches){if(m.win==='t1')blue++;else if(m.win==='t2')white++;else if(m.win)fail('승패를 확인해 주세요.');}
 next.blueWins=blue;next.whiteWins=white;next.currentRound=Math.min(...next.matches.filter(m=>!m.win&&!m.voided).map(m=>Number(m.round)))||0;if(!Number.isFinite(next.currentRound))next.currentRound=0;
 return {status:'applied',reason:'',session:next};
}
function dailyAccountEdit(current,command,now){
 const next=clone(current),s=next.session,e=s.event;
 if(command.type==='account-pause'){
  if(!!e.paused!==!!command.expectedPaused||Number(e.pauseRevision||s.pauseRevision||0)!==Number(command.expectedPauseRevision||0))return {next:current,receipt:{status:'rejected',reason:'다른 기기에서 진행 상태가 바뀌었습니다.'}};
  if(!e.operationStarted)return {next:current,receipt:{status:'rejected',reason:'대진 게시 후 일시 정지할 수 있습니다.'}};
  if(command.paused){e.paused=true;e.pausedAt=now;e.pauseReason='운영자 일시 정지';e.resumedAt=0;}
  else{
   const since=Number(e.pausedAt)||now,duration=Math.max(0,now-since);
   for(const m of e.active||[]){if(Number(m.endAt))m.endAt+=duration;if(Number(m.autoHandoffExpiresAt))m.autoHandoffExpiresAt+=duration;}
   for(const p of s.players||[]){if(p.status==='wait'&&Number(p.waitFrom))p.waitFrom+=duration;if(p.status==='rest')p.restPausedMs=Number(p.restPausedMs||0)+duration;if(Number(p.deferUntil)>since)p.deferUntil+=duration;}
   e.paused=false;e.pausedAt=0;e.pauseReason='';e.resumedAt=now;
  }
  e.pauseRevision=Number(e.pauseRevision||s.pauseRevision||0)+1;s.pauseRevision=e.pauseRevision;
 }else{
  if(command.expectedRevision!==hash(s))return {next:current,receipt:{status:'rejected',reason:'명부 후보 변경 전에 경기가 바뀌었습니다. 다시 확인해 주세요.'}};
  if(!Array.isArray(command.candidates)||command.candidates.length>500||typeof command.club!=='string')fail('명부 후보를 확인해 주세요.');
  s.arrivalCandidates=clone(command.candidates);s.arrivalClub=command.club;
 }
 s.updatedAt=now;e.updatedAt=now;s.serverRevision=Number(s.serverRevision||0)+1;s.serverLastRequestId=command.operationId;
 return {next,receipt:{status:'applied',reason:''}};
}
async function handle(db,auth,data,secret,now=Date.now()){
 const uid=W.identity(auth);if(!data||Buffer.byteLength(JSON.stringify(data))>1250000)fail('요청 용량을 초과했습니다.');
 const mode=data.mode;if(!['daily','team'].includes(mode))fail('경기 종류를 확인해 주세요.');
 const workspace=db.ref('adminWorkspaces/'+uid);let doc=(await workspace.once('value')).val();if(!doc||doc.owner!==uid)fail('계정 자료를 먼저 연결해 주세요.','permission-denied');
 let binding=doc.games?.[mode];
 if(data.action==='create'){
  cleanId(data.device);cleanId(data.operationId);
  if(!binding||binding.closed){
   if(data.revision!==doc.revision)fail('명부와 설정을 먼저 동기화해 주세요.','aborted');
   const state=clone(data.state);state.createdAt=state.createdAt||now;state.expiresAt=state.expiresAt||now+48*3600000;if(mode==='team')state.matchStartedAt=state.matchStartedAt||now;if(mode==='daily')dailyValid(state);else teamValid(state);
   const id=mode==='daily'?'D'+Array.from(crypto.randomBytes(7),n=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n%31]).join(''):crypto.randomBytes(9).toString('hex');
   const inviteToken=crypto.randomBytes(24).toString('base64url');
   if(mode==='daily'){state.serverSessionId=id;state.serverRevision=1;state.serverLastRequestId='';state.officialInvite={tokenHash:crypto.createHash('sha256').update(inviteToken).digest('hex'),expiresAt:now+48*3600000,maxClaims:20};state.commandProtocol=2;state.capabilities={...state.capabilities,...Object.fromEntries(['officialOpsV1','officialOpsServerV2','memberStatusServerV1','temporaryOfficialV1','officialArrivalV1','officialRosterSetupV1','officialLiveAdditionCancelV1','officialPartnerOpsV1','officialQueueYieldV1','officialQueueYieldOneStepV1','officialQueueHoldV1','officialQueueCardOpsV1','officialAutoHandoffV1','officialOperationStartV1','officialSessionRolloverV1','officialOperationUndoV1','pauseV1','afterPartyV1'].map(key=>[key,true]))};}
   const next={id,createdAt:now,seed:JSON.stringify(state),...(mode==='daily'?{inviteToken}:{})};
   doc=await transaction(workspace,old=>{if(!old||old.owner!==uid)fail('계정을 확인해 주세요.','permission-denied');if(old.games?.[mode]&&!old.games[mode].closed)return old;if(old.revision!==data.revision)fail('명부와 설정이 변경되었습니다. 다시 확인해 주세요.','aborted');return {...old,games:{...old.games,[mode]:next},revision:old.revision+1};});binding=doc.games[mode];
  }
  const live=db.ref('live/'+(mode==='daily'?'checkin_':'')+binding.id);
  const proof=crypto.createHmac('sha256',secret).update(uid+':'+mode+':'+binding.id).digest('hex');
  const root=await transaction(live,old=>{if(old){if(old.accountBinding!==proof)fail('경기 연결이 일치하지 않습니다.','permission-denied');return old;}if(binding.ready)fail('종료된 경기는 다시 게시하지 않습니다.','not-found');return {...(mode==='daily'?{session:JSON.parse(binding.seed)}:JSON.parse(binding.seed)),accountBinding:proof};});
  await transaction(workspace,old=>{if(old?.games?.[mode]?.id!==binding.id)fail('다른 경기가 연결되었습니다.','aborted');return {...old,games:{...old.games,[mode]:{...old.games[mode],ready:true}}};});
  return {...view(binding,root,mode,undefined,now),games:publicGames(doc.games)};
 }
 if(!binding||data.id!==binding.id)fail('이 계정에 연결된 경기가 아닙니다.','permission-denied');
 const live=db.ref('live/'+(mode==='daily'?'checkin_':'')+binding.id);
 if(data.action==='read')return view(binding,(await live.once('value')).val(),mode,data.sinceRevision,now);
 if(data.action!=='command')fail('지원하지 않는 경기 요청입니다.');
 const device=cleanId(data.device),operationId=cleanId(data.command?.operationId),command=clone(data.command),fingerprint=hash(command);
 if(!Number.isFinite(command.createdAt)||command.createdAt>now+60000||now-command.createdAt>86400000)fail('오래된 요청입니다. 최신 경기에서 다시 선택해 주세요.');
 if(Buffer.byteLength(JSON.stringify(command))>(command.type==='team-admin-edit'?1200000:24576))fail('경기 요청 용량을 초과했습니다.');
 let receipt;
 if(command.type==='account-close'){
  const source=(await live.once('value')).val();
  if(!source?.closed){
   const state=mode==='daily'?source?.session:source;
   if(!state||hash(state)!==command.expectedRevision)fail('경기가 변경되었습니다. 최신 화면에서 종료해 주세요.','aborted');
   await transaction(workspace,old=>{if(old?.owner!==uid||old.games?.[mode]?.id!==binding.id)fail('경기 연결이 바뀌었습니다.','permission-denied');const archives={...(old.gameArchives||{}),[operationId]:{mode,id:binding.id,at:now,stateJSON:JSON.stringify(state)}};const order=Object.keys(archives).sort((a,b)=>archives[a].at-archives[b].at);while(order.length>6)delete archives[order.shift()];return {...old,gameArchives:archives};});
  }
 }
 const root=await transaction(live,current=>{
  if(!current)fail('종료되었거나 없는 경기입니다.','not-found');
  const receiptKey=hash(uid+':'+device+':'+operationId),prior=current.accountOps?.[receiptKey];
  if(prior){if(prior.fingerprint!==fingerprint)fail('같은 요청 번호의 내용이 다릅니다.','already-exists');receipt=prior;return current;}
  if(current.closed)fail('종료된 경기입니다.','not-found');
  if(!Number.isFinite(command.expiresAt)||now>command.expiresAt||command.expiresAt>command.createdAt+1800000)fail('요청 시간이 지났습니다. 최신 경기에서 다시 선택해 주세요.');
  const stored={...command,actorPlayerId:'',actorPlayerName:'관리자'};
  let next,outcome;
  if(stored.type==='account-close'){const state=mode==='daily'?current.session:current;if(hash(state)!==stored.expectedRevision)fail('그 사이 경기가 변경되었습니다. 다시 확인해 주세요.','aborted');next={closed:true,closedAt:now,accountBinding:current.accountBinding};receipt={status:'applied',reason:''};
  }else if(mode==='daily'&&['account-pause','account-arrival-candidates'].includes(stored.type)){const edited=dailyAccountEdit(current,stored,now);next=edited.next;receipt=edited.receipt;
  }else if(mode==='daily'){
   const clientId='account_'+hash(uid+':'+device).slice(0,40),nonce=hash(uid+':'+binding.id).slice(0,32),inviteHash=current.session.officialInvite?.tokenHash||'';
   current.officialClaims={...current.officialClaims,[clientId]:{clientId,claimMode:'invite',officialPlayerId:'',claimNonce:nonce,expiresAt:now+3600000,inviteHash}};
   const token=issueOfficialGrant({v:1,sid:binding.id,cid:clientId,cn:nonce,iat:now,exp:now+3600000},secret);
   outcome=applyCommandTransaction(current,{storedCommand:stored,engineCommand:{...stored,officialGrantToken:token},operationId,payloadHash:hash(stored),clientId,grantPlayerId:'',grantClaimNonce:nonce,now,checkinId:binding.id,grantSecret:secret});
   if(outcome.action==='abort')fail(outcome.failureMessage,outcome.failureCode);
   next=outcome.current||current;receipt={...outcome.terminal};
  }else{
   if(stored.type==='team-admin-undo'){
    if(stored.expectedRevision!==hash(current)||current.accountLastOperation?.type!=='team-admin-edit'||!current.accountEditUndo)outcome={status:'rejected',reason:'이후 경기가 바뀌어 되돌릴 수 없습니다.'};
    else outcome={status:'applied',reason:'',session:{...JSON.parse(current.accountEditUndo),accountOps:current.accountOps||{}}};
   }else if(stored.type==='team-admin-edit'){
    outcome=teamEdit(current,stored);
    if(outcome.status==='applied'){const before=clone(current);delete before.accountOps;delete before.accountEditUndo;outcome.session.accountEditUndo=JSON.stringify(before);}
   }
   else outcome=applyTeamOfficialRequest(current,stored,{now,adminClaim:true});
   next=outcome.status==='applied'?outcome.session:current;if(outcome.status==='applied')next.accountLastOperation={id:operationId,type:stored.type};receipt={status:outcome.status,reason:outcome.reason||'',result:outcome.result||null};
  }
  receipt={...receipt,fingerprint,at:now};next.accountOps={...current.accountOps,[receiptKey]:receipt};
  for(const [key,row] of Object.entries(next.accountOps))if(now-row.at>2700000)delete next.accountOps[key];
  if(Object.keys(next.accountOps).length>2000)fail('요청이 많습니다. 잠시 후 다시 시도해 주세요.','resource-exhausted');
  return next;
 });
 if(root.closed){doc=await transaction(workspace,old=>{if(old.games?.[mode]?.id!==binding.id||old.games[mode].closed)return old;return {...old,games:{...old.games,[mode]:{...old.games[mode],closed:true,finalJSON:old.gameArchives?.[operationId]?.stateJSON||'null'}},revision:old.revision+1};});}
 if(mode==='daily'&&!root.closed)try{await flushPendingArchives(db,'checkin_'+binding.id,root.pendingArchives);}catch(e){/* Existing pending archive is retained for the next retry. */}
 return {...view(root.closed?doc.games[mode]:binding,root,mode,undefined,now),receipt,...(root.closed?{games:publicGames(doc.games)}:{})};
}
module.exports={handle,hash,teamValid,teamEdit,publicGames};
