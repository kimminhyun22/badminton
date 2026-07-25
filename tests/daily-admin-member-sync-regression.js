const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js','daily.js'),'utf8');

function sourceBetween(startName,endName){
  const start=src.indexOf(`function ${startName}`);
  const regularEnd=src.indexOf(`function ${endName}`,start+1);
  const asyncEnd=src.indexOf(`async function ${endName}`,start+1);
  const end=asyncEnd>=0?asyncEnd:regularEnd;
  assert(start>=0&&end>start,`${startName} 함수 범위를 찾을 수 있어야 합니다.`);
  return src.slice(start,end);
}

const publishSource=sourceBetween('_dailyScheduleServerReconcile','dailyPublishCheckinSession');
const ownershipSource=sourceBetween('_dailyRemoteCheckinOwnership','_dailyAdminClientId');
assert(publishSource.includes('_dailyScheduleServerReconcile()'),'서버가 더 최신이면 관리자 원본과 다시 맞춰야 합니다.');
assert(publishSource.includes('_dailyScheduleCheckinPublishRetry(0)'),'일시정지 리비전만 앞서도 최신 상태로 회원 화면을 다시 게시해야 합니다.');
assert(!publishSource.includes('_dailyWriteCheckinPayload(path).catch(()=>{})'),'관리자 게시 오류를 조용히 버리면 안 됩니다.');
assert(publishSource.includes('remoteInviteHash!==payloadInviteHash'),'다른 운영 링크의 세션을 같은 ID로 덮어쓰면 안 됩니다.');
assert(publishSource.includes('remoteSessionId!==identity.id'),'다른 세션 ID의 내용을 현재 링크로 덮어쓰면 안 됩니다.');
assert(publishSource.includes('_dailyCheckinPublishPromise'),'연속 상태 변경은 한 번에 하나씩 게시해 이전 상태가 최신 상태를 덮지 못하게 해야 합니다.');
assert(publishSource.includes('localPublishRevision'),'게시 완료 시점에 해당 스냅샷의 로컬 순번을 비교해야 합니다.');
assert(!publishSource.includes('payload.clientStateRevision')&&!publishSource.includes('payload.clientWriterId'),'Firebase 기존 세션 스키마에 없는 게시 메타 필드를 원격 payload에 추가하면 안 됩니다.');
const listenerSource=sourceBetween('dailyStartCheckinListener','_dailyStopCheckinListener');
assert(listenerSource.includes("'/session/serverRevision'")&&listenerSource.includes("'/session/serverLastRequestId'"),'관리자 앱은 회원 서버의 최신 대진 리비전을 직접 감지해야 합니다.');
assert(listenerSource.includes('_dailyObserveRemoteServerHead'),'서버 대진이 바뀌면 관리자 원본 재동기화를 즉시 예약해야 합니다.');
const resumeSource=sourceBetween('dailyResumeCheckin','_dailyObserveRemoteServerHead');
assert(resumeSource.includes('_fbDb.goOnline()'),'관리자 앱이 다시 활성화되면 Firebase 실시간 연결을 즉시 깨워야 합니다.');
assert(
  resumeSource.includes('if(_dailyCheckinNeedsPublish||_dailyCheckinPublishQueued)')
  &&resumeSource.includes('await dailyPushCheckinSession()'),
  '앱 복귀 중 발생한 첫 경기 종료도 소실하지 않고 연결 확인 직후 게시해야 합니다.'
);
assert(resumeSource.includes('_dailyRemoteHeadNeedsReconcile(ownershipResult.session)'),'앱 복귀 시 서버 운영 기록을 먼저 확인한 뒤 관리자 조작을 열어야 합니다.');
assert(resumeSource.includes('_dailyRecoverCurrentAdminPublish'),'이미 생긴 관리자·임원 상태 충돌은 현재 관리자 화면 기준 복구 경로를 제공해야 합니다.');
const completeSource=sourceBetween('dailyCompleteMatch','dailyCancelMatch');
assert(completeSource.includes('_dailyCheckinIdentityPending||_dailyServerSyncBusy'),'복귀 동기화 중에는 관리자 경기 종료를 먼저 실행하면 안 됩니다.');
assert(completeSource.includes('!options.syncReplay'),'서버 명령을 관리자 원본에 재생할 때는 동기화 잠금을 통과해야 합니다.');
const queueSyncSource=sourceBetween('_dailyApplyServerQueueSync','_dailyPrepareServerQueueRequest');
assert(queueSyncSource.includes('_dailyQueueCapacity().target')&&queueSyncSource.includes('sync.next.slice(0,syncLimit)'),'구버전 서버의 초과 대진을 복원해도 관리자 표시 코트 수로 정리해야 합니다.');
const officialErrorSource=sourceBetween('_dailyOfficialRequestError','_dailyRecordOfficialArrival');
assert(officialErrorSource.includes('!req.serverAppliedAt&&'),'서버가 이미 승인한 임원 요청은 관리자 재접속이 늦어도 TTL 만료로 거절하면 안 됩니다.');
const processSource=sourceBetween('dailyProcessCheckinRequests','dailyApproveCheckinRequest');
assert(processSource.includes('preserveLocalQueue')&&processSource.includes('_dailyCheckinNeedsPublish'),'임원 상태 처리와 겹친 최신 관리자 대진 편집을 서버 대진 전체로 덮어쓰면 안 됩니다.');
assert(processSource.includes('req.serverResult?.alreadyCovered'),'같은 경기에서 이미 충족된 두 번째 파트너 요청을 중복 예약으로 재생하면 안 됩니다.');
const serverHeadSource=sourceBetween('_dailyServerHeadPending','_dailyBlockServerSync');
assert(serverHeadSource.includes('_dailyObservedServerRevision>_dailyServerRevision'),'관찰된 임원 서버 리비전이 앞설 때 관리자 편집을 잠시 잠가야 합니다.');
[
  'dailyDeleteQueueItem',
  'dailyAddPlayer',
  'dailyImportDirect',
  'dailyConfirmPair',
  'dailyClearPair',
  'dailyAddReservation',
  'dailyDeleteReservation',
  'dailyPromoteReservation',
  'dailyRemovePlayer',
  'dailyToggleAutoAssign',
  'dailyFinishLiveTransition',
  'dailyRegenerateQueueItem',
  'dailyApproveReservationRequest',
  'importDailySelected'
].forEach(name=>{
  const guarded=new RegExp(`(?:async\\s+)?function\\s+${name}\\([^)]*\\)\\s*\\{[\\s\\S]{0,180}_dailyBlockServerSync\\(`);
  assert(guarded.test(src),`${name} 관리자 변경은 최신 임원 처리를 먼저 동기화해야 합니다.`);
});

const ttlSandbox={
  DAILY_OFFICIAL_OPERATION_TTL_MS:1000,
  _dailyPaused:false,
  _dailyNow:()=>10_000,
  _dailyPlayer:id=>id==='official'?{id,isClubOfficial:true}:null,
  _dailyFlowOperationType:()=>false
};
vm.createContext(ttlSandbox);
vm.runInContext(`${officialErrorSource};this.check=_dailyOfficialRequestError;`,ttlSandbox);
assert.strictEqual(
  ttlSandbox.check({type:'unsupported',actorPlayerId:'official',createdAt:1,expiresAt:2,serverAppliedAt:5000}),
  '지원하지 않는 임원 운영 요청입니다.',
  '서버 적용 완료 요청은 오래됐다는 이유만으로 관리자 병합을 막으면 안 됩니다.'
);
assert.strictEqual(
  ttlSandbox.check({type:'unsupported',actorPlayerId:'official',createdAt:1,expiresAt:2}),
  '운영 요청 시간이 지나 현재 상태를 다시 확인해야 합니다.',
  '아직 서버가 승인하지 않은 오래된 요청은 계속 거절해야 합니다.'
);

const headSandbox={};
vm.createContext(headSandbox);
vm.runInContext(`
let _dailyObservedServerRevision=0;
let _dailyObservedServerLastRequestId='';
let _dailyServerRevision=1;
let _dailyServerLastRequestId='op1';
let _dailyOfficialInviteHash='official-hash';
let reconcileCalls=0;
function _dailyScheduleServerReconcile(){reconcileCalls++;}
${sourceBetween('_dailyObserveRemoteServerHead','dailyStartCheckinListener')}
this.api={
  observe:_dailyObserveRemoteServerHead,
  reset(localRevision,lastRequestId,hash){
    _dailyObservedServerRevision=localRevision;
    _dailyObservedServerLastRequestId=lastRequestId;
    _dailyServerRevision=localRevision;
    _dailyServerLastRequestId=lastRequestId;
    _dailyOfficialInviteHash=hash;
    reconcileCalls=0;
  },
  calls:()=>reconcileCalls
};
`,headSandbox);
headSandbox.api.observe({revision:2});
assert.strictEqual(headSandbox.api.calls(),1,'서버 리비전이 앞서면 관리자 앱이 즉시 재동기화해야 합니다.');
headSandbox.api.reset(2,'op1','official-hash');
headSandbox.api.observe({lastRequestId:'op2'});
assert.strictEqual(headSandbox.api.calls(),1,'같은 리비전이라도 최근 명령이 다르면 관리자 앱이 다시 확인해야 합니다.');
headSandbox.api.reset(2,'op2','');
headSandbox.api.observe({revision:3,lastRequestId:'op3'});
assert.strictEqual(headSandbox.api.calls(),0,'운영 연결이 없는 화면은 서버 원본을 임의로 덮어쓰면 안 됩니다.');

const sandbox={};
vm.createContext(sandbox);
vm.runInContext(`
let _dailyCheckinId='DADMINSYNC';
let _dailyOfficialInviteToken='official-token';
let _dailyOfficialInviteHash='official-hash';
let _dailyCapabilityEpoch=1;
let _dailyCheckinIdentityPending=false;
let _dailyCheckinOwnershipVerified=true;
let _dailyRemoteCheckinExpiresAt=0;
let _dailyCrossTabIdentityPending=false;
let _dailyServerRevision=1;
let _dailyServerLastRequestId='op1';
let _dailyPauseRevision=0;
let _dailyServerReconcileError='';
let _dailyServerSyncBusy=false;
let _dailyServerSyncQueued=false;
let _dailyServerSyncRetryId=null;
let _dailyCheckinPublishRetryId=null;
let _dailyCheckinPublishRetryDelay=1200;
let _dailyCheckinPublishPromise=null;
let _dailyCheckinPublishQueued=false;
let _dailyCheckinNeedsPublish=false;
let _dailyClientStateRevision=1;
let localMatchCompleted=true;
let currentSession={serverRevision:2,serverLastRequestId:'op2',event:{pauseRevision:0},matchCompleted:false};
let transactionFailures=0;
let transactionCount=0;
let reconcileCalls=0;
let pauseAdoptions=0;
let renderCalls=0;
let heartbeatCalls=0;
let timers=[];
let heldTransactionCount=0;
let heldTransactions=[];
let _dailyRecoveryPromptKey='';
let confirmResult=true;
let confirmCalls=0;

function clone(value){return JSON.parse(JSON.stringify(value));}
function _dailyIdentitySnapshot(){
  return {id:_dailyCheckinId,token:_dailyOfficialInviteToken,hash:_dailyOfficialInviteHash,epoch:_dailyCapabilityEpoch};
}
function _dailyIdentityCurrent(identity){
  return !!identity&&identity.id===_dailyCheckinId&&identity.token===_dailyOfficialInviteToken
    &&identity.hash===_dailyOfficialInviteHash&&identity.epoch===_dailyCapabilityEpoch;
}
function setTimeout(fn,delay){
  const timer={fn,delay:Number(delay)||0,cancelled:false};
  timers.push(timer);
  return timer;
}
function clearTimeout(timer){if(timer)timer.cancelled=true;}
function _dailyCheckinPayload(){
  return {
    serverSessionId:_dailyCheckinId,
    serverRevision:_dailyServerRevision,
    serverLastRequestId:_dailyServerLastRequestId,
    event:{pauseRevision:_dailyPauseRevision},
    officialInvite:{tokenHash:_dailyOfficialInviteHash},
    matchCompleted:localMatchCompleted
  };
}
function _dailyPersistServerIdentity(){}
function confirm(){confirmCalls++;return confirmResult;}
function _dailyAdoptRemotePauseEvent(event){
  pauseAdoptions++;
  _dailyPauseRevision=Math.max(_dailyPauseRevision,Number(event?.pauseRevision||0));
}
function _dailyPullServerReconcile(){
  reconcileCalls++;
  _dailyServerRevision=Number(currentSession.serverRevision||0);
  _dailyServerLastRequestId=String(currentSession.serverLastRequestId||'');
  return dailyPushCheckinSession();
}
function _dailyCheckinExpired(){return false;}
function _dailyExpireCheckinLink(){}
function dailyRenderCheckinRequests(){renderCalls++;}
function _dailyEnsureOfficialCapability(){return Promise.resolve(true);}
function _dailyCheckinPath(){return 'live/checkin_'+_dailyCheckinId;}
function _dailyNow(){return 123456;}
function _dailyLocalCheckinExpiresAt(){return 0;}
function _dailyPushOperatorHeartbeat(){heartbeatCalls++;}
const _fbDb={
  ref(path){
    return {
      update(){return Promise.resolve();},
      transaction(handler){
        transactionCount++;
        if(heldTransactionCount>0){
          heldTransactionCount--;
          return new Promise((resolve,reject)=>{
            heldTransactions.push(()=>{
              runTransaction(handler).then(resolve,reject);
            });
          });
        }
        return runTransaction(handler);
      }
    };
  }
};
function runTransaction(handler){
        if(transactionFailures>0){
          transactionFailures--;
          return Promise.reject(new Error('offline'));
        }
        const next=handler(clone(currentSession));
        if(next===undefined){
          return Promise.resolve({committed:false,snapshot:{val:()=>clone(currentSession)}});
        }
        currentSession=clone(next);
        return Promise.resolve({committed:true,snapshot:{val:()=>clone(currentSession)}});
}
${ownershipSource}
${publishSource}
function reset(options){
  _dailyServerRevision=Number(options.localRevision||0);
  _dailyServerLastRequestId=String(options.localLastRequestId||'');
  _dailyPauseRevision=Number(options.localPauseRevision||0);
  _dailyServerReconcileError='';
  _dailyServerSyncBusy=false;
  _dailyServerSyncQueued=false;
  _dailyServerSyncRetryId=null;
  _dailyCheckinPublishRetryId=null;
  _dailyCheckinPublishRetryDelay=1200;
  _dailyCheckinPublishPromise=null;
  _dailyCheckinPublishQueued=false;
  _dailyCheckinNeedsPublish=false;
  _dailyClientStateRevision=Math.max(1,Number(options.clientRevision||1));
  localMatchCompleted=true;
  currentSession=clone(options.remote);
  if(!currentSession.serverSessionId)currentSession.serverSessionId=_dailyCheckinId;
  if(!currentSession.officialInvite)currentSession.officialInvite={tokenHash:_dailyOfficialInviteHash};
  transactionFailures=Number(options.failures||0);
  transactionCount=0;
  reconcileCalls=0;
  pauseAdoptions=0;
  renderCalls=0;
  heartbeatCalls=0;
  timers=[];
  heldTransactionCount=0;
  heldTransactions=[];
  _dailyRecoveryPromptKey='';
  confirmResult=true;
  confirmCalls=0;
}
this.api={
  reset,
  push:dailyPushCheckinSession,
  setIdentityPending(value){_dailyCheckinIdentityPending=!!value;},
  setLocal(completed,revision){
    localMatchCompleted=!!completed;
    _dailyClientStateRevision=Math.max(0,Number(revision||0));
  },
  setNeedsPublish(value){_dailyCheckinNeedsPublish=!!value;},
  recover:(remote,forcePrompt)=>_dailyRecoverCurrentAdminPublish(remote,'live/checkin_'+_dailyCheckinId,forcePrompt),
  holdTransactions(count){heldTransactionCount=Math.max(0,Number(count||0));},
  releaseTransaction(){
    const release=heldTransactions.shift();
    if(release)release();
    return !!release;
  },
  runTimers(){
    const batch=timers.splice(0);
    batch.forEach(timer=>{if(!timer.cancelled)timer.fn();});
    return batch.length;
  },
  state:()=>({
    currentSession:clone(currentSession),
    transactionCount,
    reconcileCalls,
    pauseAdoptions,
    renderCalls,
    heartbeatCalls,
    pendingTimers:timers.filter(timer=>!timer.cancelled).length,
    heldTransactions:heldTransactions.length,
    needsPublish:_dailyCheckinNeedsPublish,
    publishQueued:_dailyCheckinPublishQueued,
    confirmCalls,
    localServerRevision:_dailyServerRevision,
    localLastRequestId:_dailyServerLastRequestId,
    error:_dailyServerReconcileError,
    retryDelay:_dailyCheckinPublishRetryDelay
  })
};
`,sandbox);

async function settle(){
  for(let i=0;i<6;i++){
    await Promise.resolve();
    await new Promise(resolve=>setImmediate(resolve));
  }
}

(async()=>{
  sandbox.api.reset({
    localRevision:1,
    localLastRequestId:'op1',
    localPauseRevision:0,
    remote:{serverRevision:2,serverLastRequestId:'op2',event:{pauseRevision:0},matchCompleted:false}
  });
  assert.strictEqual(await sandbox.api.push(),false,'오래된 관리자 게시를 서버 위에 바로 덮어쓰면 안 됩니다.');
  assert.strictEqual(sandbox.api.state().pendingTimers,1,'서버 최신 기록을 자동으로 다시 합쳐야 합니다.');
  sandbox.api.runTimers();
  await settle();
  let state=sandbox.api.state();
  assert.strictEqual(state.reconcileCalls,1,'서버 리비전이 앞서면 재동기화를 실행해야 합니다.');
  assert.strictEqual(state.transactionCount,2,'재동기화 후 관리자 종료 결과를 회원 화면에 다시 게시해야 합니다.');
  assert.strictEqual(state.currentSession.matchCompleted,true,'관리자 경기 종료 결과가 최종 회원 세션에 남아야 합니다.');

  sandbox.api.reset({
    localRevision:4,
    localLastRequestId:'op4',
    localPauseRevision:1,
    remote:{serverRevision:4,serverLastRequestId:'op4',event:{pauseRevision:2},matchCompleted:false}
  });
  assert.strictEqual(await sandbox.api.push(),false,'일시정지 상태가 오래된 게시도 먼저 보류해야 합니다.');
  assert.strictEqual(sandbox.api.state().pauseAdoptions,1,'서버의 최신 일시정지 상태를 관리자 원본에 반영해야 합니다.');
  sandbox.api.runTimers();
  await settle();
  state=sandbox.api.state();
  assert.strictEqual(state.reconcileCalls,0,'일시정지 리비전만 앞선 경우 전체 운영 재조정은 불필요합니다.');
  assert.strictEqual(state.transactionCount,2,'최신 일시정지를 반영한 뒤 회원 세션을 다시 게시해야 합니다.');
  assert.strictEqual(state.currentSession.matchCompleted,true,'일시정지 충돌 뒤에도 관리자 종료 결과가 회원 화면에 반영되어야 합니다.');

  sandbox.api.reset({
    localRevision:7,
    localLastRequestId:'op7',
    localPauseRevision:3,
    remote:{serverRevision:7,serverLastRequestId:'op7',event:{pauseRevision:3},matchCompleted:false},
    failures:1
  });
  assert.strictEqual(await sandbox.api.push(),false,'네트워크 오류 시 완료된 것처럼 보고하면 안 됩니다.');
  state=sandbox.api.state();
  assert(state.error.includes('회원 화면 게시 연결'),'관리자에게 회원 화면 게시 오류 상태를 남겨야 합니다.');
  assert.strictEqual(state.pendingTimers,1,'네트워크 오류는 자동 재시도해야 합니다.');
  sandbox.api.runTimers();
  await settle();
  state=sandbox.api.state();
  assert.strictEqual(state.transactionCount,2,'네트워크 복구 후 게시를 자동으로 다시 시도해야 합니다.');
  assert.strictEqual(state.currentSession.matchCompleted,true,'재시도한 관리자 종료 결과가 회원 화면 세션에 반영되어야 합니다.');
  assert.strictEqual(state.error,'','게시 성공 후 오류 안내를 자동으로 해제해야 합니다.');

  sandbox.api.reset({
    localRevision:9,
    localLastRequestId:'op9',
    localPauseRevision:3,
    clientRevision:10,
    remote:{serverRevision:9,serverLastRequestId:'op9',event:{pauseRevision:3},matchCompleted:false}
  });
  sandbox.api.setIdentityPending(true);
  assert.strictEqual(await sandbox.api.push(),false,'앱 복귀 인증 중에는 확인되지 않은 링크에 바로 게시하면 안 됩니다.');
  state=sandbox.api.state();
  assert.strictEqual(state.transactionCount,0,'링크 확인 전에는 원격 상태를 건드리지 않아야 합니다.');
  assert.strictEqual(state.needsPublish,true,'복귀 중 발생한 첫 변경은 게시 대기로 반드시 남겨야 합니다.');
  sandbox.api.setIdentityPending(false);
  assert.strictEqual(await sandbox.api.push(),true,'링크 확인 직후 대기 중이던 첫 변경을 게시해야 합니다.');
  state=sandbox.api.state();
  assert.strictEqual(state.currentSession.matchCompleted,true,'앱 복귀 직후 첫 경기 종료가 회원 화면 세션에 남아야 합니다.');
  assert.strictEqual(state.needsPublish,false,'최신 상태 게시 후 대기 플래그를 정리해야 합니다.');

  sandbox.api.reset({
    localRevision:11,
    localLastRequestId:'op11',
    localPauseRevision:4,
    clientRevision:20,
    remote:{serverRevision:11,serverLastRequestId:'op11',event:{pauseRevision:4},matchCompleted:false}
  });
  sandbox.api.setLocal(false,20);
  sandbox.api.holdTransactions(1);
  const firstPublish=sandbox.api.push();
  await settle();
  assert.strictEqual(sandbox.api.state().heldTransactions,1,'첫 게시를 지연해 연속 동작 경쟁을 재현해야 합니다.');
  sandbox.api.setLocal(true,21);
  const latestPublish=sandbox.api.push();
  sandbox.api.releaseTransaction();
  assert.strictEqual(await firstPublish,true,'첫 게시 작업은 최신 상태까지 연속으로 비워야 합니다.');
  assert.strictEqual(await latestPublish,true,'진행 중 들어온 최신 게시 요청도 같은 완료 신호를 받아야 합니다.');
  state=sandbox.api.state();
  assert.strictEqual(state.transactionCount,2,'진행 중 상태가 바뀌면 최신 스냅샷을 한 번 더 게시해야 합니다.');
  assert.strictEqual(state.currentSession.matchCompleted,true,'연속 종료 처리의 최종 상태가 회원 화면에 남아야 합니다.');

  sandbox.api.reset({
    localRevision:3,
    localLastRequestId:'op3',
    localPauseRevision:0,
    clientRevision:30,
    remote:{serverRevision:7,serverLastRequestId:'op7',event:{pauseRevision:0},matchCompleted:false}
  });
  sandbox.api.setLocal(true,30);
  sandbox.api.setNeedsPublish(true);
  const recovered=await sandbox.api.recover(sandbox.api.state().currentSession,true);
  assert.strictEqual(recovered?.committed,true,'자동 병합이 막힌 경우 확인 후 현재 관리자 상태를 회원 세션에 복구할 수 있어야 합니다.');
  state=sandbox.api.state();
  assert.strictEqual(state.confirmCalls,1,'관리자 기준 강제 복구는 명시적 확인을 한 번 받아야 합니다.');
  assert.strictEqual(state.localServerRevision,7,'복구한 관리자 원본은 서버 명령 리비전을 보존해야 합니다.');
  assert.strictEqual(state.localLastRequestId,'op7','복구한 관리자 원본은 마지막 서버 명령 ID를 보존해야 합니다.');
  assert.strictEqual(state.currentSession.matchCompleted,true,'복구 시 로컬에 저장된 경기 종료 결과가 회원 세션에 반영되어야 합니다.');

  console.log('daily admin member sync regression ok');
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
