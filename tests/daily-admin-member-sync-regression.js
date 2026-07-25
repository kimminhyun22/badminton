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
assert(publishSource.includes('remoteSessionId!==_dailyCheckinId'),'다른 세션 ID의 내용을 현재 링크로 덮어쓰면 안 됩니다.');
const listenerSource=sourceBetween('dailyStartCheckinListener','_dailyStopCheckinListener');
assert(listenerSource.includes("'/session/serverRevision'")&&listenerSource.includes("'/session/serverLastRequestId'"),'관리자 앱은 회원 서버의 최신 대진 리비전을 직접 감지해야 합니다.');
assert(listenerSource.includes('_dailyObserveRemoteServerHead'),'서버 대진이 바뀌면 관리자 원본 재동기화를 즉시 예약해야 합니다.');
const queueSyncSource=sourceBetween('_dailyApplyServerQueueSync','_dailyPrepareServerQueueRequest');
assert(queueSyncSource.includes('_dailyQueueCapacity().target')&&queueSyncSource.includes('sync.next.slice(0,syncLimit)'),'구버전 서버의 초과 대진을 복원해도 관리자 표시 코트 수로 정리해야 합니다.');

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
let _dailyCheckinIdentityPending=false;
let _dailyCheckinOwnershipVerified=true;
let _dailyRemoteCheckinExpiresAt=0;
let _dailyServerRevision=1;
let _dailyServerLastRequestId='op1';
let _dailyPauseRevision=0;
let _dailyServerReconcileError='';
let _dailyServerSyncBusy=false;
let _dailyServerSyncQueued=false;
let _dailyServerSyncRetryId=null;
let _dailyCheckinPublishRetryId=null;
let _dailyCheckinPublishRetryDelay=1200;
let localMatchCompleted=true;
let currentSession={serverRevision:2,serverLastRequestId:'op2',event:{pauseRevision:0},matchCompleted:false};
let transactionFailures=0;
let transactionCount=0;
let reconcileCalls=0;
let pauseAdoptions=0;
let renderCalls=0;
let heartbeatCalls=0;
let timers=[];

function clone(value){return JSON.parse(JSON.stringify(value));}
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
function _dailyPushOperatorHeartbeat(){heartbeatCalls++;}
const _fbDb={
  ref(path){
    return {
      update(){return Promise.resolve();},
      transaction(handler){
        transactionCount++;
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
    };
  }
};
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
}
this.api={
  reset,
  push:dailyPushCheckinSession,
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

  console.log('daily admin member sync regression ok');
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
