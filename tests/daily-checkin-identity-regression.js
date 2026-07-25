const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js','daily.js'),'utf8');

function between(start,end){
  const from=src.indexOf(start);
  const to=src.indexOf(end,from+start.length);
  assert(from>=0&&to>from,`${start} 함수 범위를 찾을 수 있어야 합니다.`);
  return src.slice(from,to);
}

const loadSource=between('function dailyLoad()','function dailyApplyReviewSample');
const newDaySource=between('function _dailyLoadAsNewDay(s)','function dailyLoad()');
const persistSource=between('function _dailyPersistServerIdentity()','function _dailyCapabilityToken');
const capabilitySource=between('async function _dailyEnsureOfficialCapability()','function _dailyAdminGrantKey');
const writeSource=between('function _dailyWriteCheckinPayload(path)','function dailyPushCheckinSession');
const publishSource=between('async function dailyPublishCheckinSession(silent)','async function dailyShareCheckinLink');
const resumeSource=between('async function dailyResumeCheckin()','function _dailyObserveRemoteServerHead');
const expireSource=between('function _dailyExpireCheckinLink(silent)','function _dailyCheckinUrl');
const expirySource=between('function _dailyLocalCheckinExpiresAt()','function _dailyCheckinExpired');
const safeRemoveSource=between('function _dailyRemoveOwnedCheckin(path,identity,requireExpired,expectedPublishId)','function _dailyExpireCheckinLink');

assert(!loadSource.includes('_dailyCheckinId=s.checkinId||'),'저장 본문의 오래된 ID가 현재 회원 링크로 되살아나면 안 됩니다.');
assert(loadSource.includes("localStorage.getItem(DAILY_CHECKIN_KEY)"),'별도 회원 링크 키를 현재 ID의 기준으로 사용해야 합니다.');
assert(loadSource.includes('sameCheckinIdentity'),'ID가 일치할 때만 운영 토큰과 서버 리비전을 복원해야 합니다.');
assert(!loadSource.includes('_dailyExpireCheckinLink(true)'),'앱 로드 중 소유권 확인 전에 원격 회원 링크를 만료시키면 안 됩니다.');
assert(!newDaySource.includes(".remove()"),'날짜가 바뀌었다는 이유만으로 검증하지 않은 원격 링크를 삭제하면 안 됩니다.');
assert(persistSource.includes('state.checkinId=_dailyCheckinId'),'현재 회원 링크 ID를 저장 본문에도 즉시 맞춰야 합니다.');
assert(persistSource.includes('state.checkinCreatedAt=_dailyCheckinCreatedAt'),'현재 회원 링크 생성 시각을 저장 본문에도 즉시 맞춰야 합니다.');
assert(capabilitySource.includes('_dailyCapabilityEpoch!==capabilityEpoch'),'이전 ID의 늦은 토큰 계산 결과를 새 ID에 저장하면 안 됩니다.');
assert(capabilitySource.includes('_dailyCapabilityPromise===promise'),'이전 토큰 작업이 새 ID의 진행 중 작업을 지우면 안 됩니다.');
assert(writeSource.includes('remoteInviteHash!==payloadInviteHash'),'다른 운영 토큰의 세션을 같은 ID로 덮어쓰면 안 됩니다.');
assert(writeSource.includes('remoteSessionId!==identity.id'),'다른 세션 ID를 현재 회원 링크에 덮어쓰면 안 됩니다.');
assert(writeSource.includes('identityStale:!_dailyIdentityCurrent(identity)'),'완료가 늦은 이전 ID 게시가 현재 ID 상태를 바꾸면 안 됩니다.');
assert(writeSource.includes('_dailyRemoveOwnedCheckin(path,identity,false,publishId)'),'이미 완료된 이전 ID 게시도 자기 쓰기 표식이 일치할 때만 정리해야 합니다.');
assert(writeSource.includes('payloadExpiresAt&&_dailyNow()>=payloadExpiresAt'),'이미 만료된 새 세션을 저장 성공으로 처리하면 안 됩니다.');
assert(publishSource.includes("ownership==='mismatch'"),'공유 전에 이전 ID 소유권 불일치를 검사해야 합니다.');
assert(publishSource.includes('if(result?.committed)'),'Firebase 세션 저장 성공 뒤에만 링크를 열어야 합니다.');
assert(resumeSource.includes('_dailyDetachStaleCheckinIdentity()'),'앱 재실행 시 이전 ID가 감지되면 자동 분리해야 합니다.');
assert(resumeSource.includes('_dailyStoredIdentity(storedCheckinId)'),'다른 탭의 새 ID를 채택할 때 그 ID의 토큰 묶음도 함께 복원해야 합니다.');
assert(resumeSource.includes('const capabilityChanged=')&&resumeSource.includes('_dailyCrossTabIdentityPending=true'),'같은 ID의 토큰 묶음이 다른 탭에서 갱신돼도 함께 복원해야 합니다.');
assert(resumeSource.indexOf('_dailyReadCheckinOwnership()')<resumeSource.indexOf('_dailyCheckinExpired()'),'만료 판단보다 서버 소유권을 먼저 확인해야 합니다.');
assert(expireSource.includes('_dailyRemoveOwnedCheckin(path,identity,true)'),'만료 삭제도 토큰과 세션 ID를 다시 확인해야 합니다.');
assert(expirySource.includes('Math.max(startedAt||0,_dailyCheckinCreatedAt||0)'),'늦게 새 링크를 만든 진행 기록에 이미 만료된 시각을 쓰면 안 됩니다.');

const ownershipSource=between('function _dailyRemoteCheckinOwnership(session,localCapabilityValid,identity)','function _dailyAdminClientId');
const ownershipSandbox={};
vm.createContext(ownershipSandbox);
vm.runInContext(`
let _dailyCheckinId='DLOCAL';
let _dailyOfficialInviteToken='local-token';
let _dailyOfficialInviteHash='local-hash';
let _dailyCapabilityEpoch=1;
function _dailyNow(){return 100;}
function _dailyLocalCheckinExpiresAt(){return 0;}
function _dailyIdentitySnapshot(){
  return {id:_dailyCheckinId,token:_dailyOfficialInviteToken,hash:_dailyOfficialInviteHash,epoch:_dailyCapabilityEpoch};
}
${ownershipSource}
this.check=_dailyRemoteCheckinOwnership;
`,ownershipSandbox);
assert.strictEqual(
  ownershipSandbox.check({serverSessionId:'DLOCAL',officialInvite:{tokenHash:'local-hash'}}),
  'owned',
  '같은 운영 토큰 해시는 기존 라이브를 이어가야 합니다.'
);
assert.strictEqual(
  ownershipSandbox.check({serverSessionId:'DLOCAL',officialInvite:{tokenHash:'other-hash'}}),
  'mismatch',
  '다른 운영 토큰 해시는 이전 링크로 판정해야 합니다.'
);
assert.strictEqual(
  ownershipSandbox.check({serverSessionId:'DOTHER',officialInvite:{tokenHash:'local-hash'}}),
  'mismatch',
  '토큰이 같아도 세션 ID가 다르면 현재 라이브로 간주하면 안 됩니다.'
);
assert.strictEqual(
  ownershipSandbox.check({serverSessionId:'DLOCAL',expiresAt:99,officialInvite:{tokenHash:'local-hash'}}),
  'expired',
  '소유권이 맞아도 만료된 원격 라이브를 되살리면 안 됩니다.'
);
assert.strictEqual(ownershipSandbox.check('foreign'),'mismatch','비정상 원격 세션 값을 새 링크로 덮어쓰면 안 됩니다.');
assert.strictEqual(ownershipSandbox.check(null),'missing','서버 세션이 없으면 새 세션을 만들 수 있어야 합니다.');

const safeRemoveSandbox={};
vm.createContext(safeRemoveSandbox);
vm.runInContext(`
let now=100;
let root=null;
let transactionCount=0;
function _dailyNow(){return now;}
const _fbDb={
  ref(){
    return {
      transaction(handler){
        transactionCount++;
        const next=handler(root===null?null:JSON.parse(JSON.stringify(root)));
        if(next===undefined)return Promise.resolve({committed:false,snapshot:{val:()=>root}});
        root=next;
        return Promise.resolve({committed:true,snapshot:{val:()=>root}});
      }
    };
  }
};
${safeRemoveSource}
this.api={
  set(value){root=JSON.parse(JSON.stringify(value));},
  remove:(identity,expired,publishId)=>_dailyRemoveOwnedCheckin('live/checkin_'+identity.id,identity,expired,publishId),
  root:()=>root===null?null:JSON.parse(JSON.stringify(root)),
  count:()=>transactionCount
};
`,safeRemoveSandbox);

const capabilitySandbox={};
vm.createContext(capabilitySandbox);
vm.runInContext(`
let _dailyCheckinId='DA';
let _dailyOfficialInviteToken='';
let _dailyOfficialInviteHash='';
let _dailyCapabilityPromise=null;
let _dailyCapabilityEpoch=1;
let persisted=[];
let waiters={};
function _dailyCapabilityToken(){return _dailyCheckinId==='DA'?'token-a':'token-b';}
function _dailyCapabilityDigest(token){
  return new Promise(resolve=>{
    if(!waiters[token])waiters[token]=[];
    waiters[token].push(resolve);
  });
}
function _dailyPersistServerIdentity(){
  persisted.push({id:_dailyCheckinId,token:_dailyOfficialInviteToken,hash:_dailyOfficialInviteHash});
}
${capabilitySource}
this.api={
  ensure:_dailyEnsureOfficialCapability,
  rotate(){
    _dailyCheckinId='DB';
    _dailyOfficialInviteToken='';
    _dailyOfficialInviteHash='';
    _dailyCapabilityPromise=null;
    _dailyCapabilityEpoch++;
  },
  resolve(token,hash){
    const resolve=(waiters[token]||[]).shift();
    if(resolve)resolve(hash);
  },
  state:()=>({
    id:_dailyCheckinId,
    token:_dailyOfficialInviteToken,
    hash:_dailyOfficialInviteHash,
    persisted:[...persisted]
  })
};
`,capabilitySandbox);

const sandbox={};
vm.createContext(sandbox);
vm.runInContext(`
let _dailyPlayers=[{id:'p1',name:'테스트'}];
let _dailyCheckinId='DOLD';
let _dailyCheckinCreatedAt=100;
let _dailyOfficialInviteToken='old-token';
let _dailyOfficialInviteHash='old-hash';
let _dailyCapabilityEpoch=1;
let _dailyCheckinIdentityPending=true;
let _dailyCheckinOwnershipVerified=false;
let _dailyRemoteCheckinExpiresAt=0;
let _dailyCrossTabIdentityPending=false;
let _dailyServerReconcileError='';
let mode='stale';
let rotations=0;
let writes=[];
let updates=[];
let listenerStarts=0;
let heartbeatStarts=0;
let renderCalls=0;
let reconcileCalls=0;
let alerts=[];
let ownedWriteCount=0;
const DAILY_CHECKIN_KEY='daily-checkin-id';
const localStorage={getItem(){return null;}};

function dailyEnsureCheckinId(forceNew){
  if(forceNew){
    rotations++;
    _dailyCapabilityEpoch++;
    _dailyCheckinId='DNEW'+rotations;
    _dailyCheckinCreatedAt=200+rotations;
    _dailyOfficialInviteToken='';
    _dailyOfficialInviteHash='';
  }
  return _dailyCheckinId;
}
async function _dailyReadCheckinOwnership(){
  let status='owned';
  if(mode==='unknown')status='unknown';
  if(mode==='stale')status=_dailyCheckinId==='DOLD'?'mismatch':'missing';
  if(mode==='write-mismatch')status=_dailyCheckinId==='DOWNED'?'owned':'missing';
  if(mode==='stale-write')status=_dailyCheckinId==='DOWNED'?'owned':'missing';
  return {
    status,
    session:status==='owned'?{serverSessionId:_dailyCheckinId,createdAt:100,expiresAt:999,officialInvite:{tokenHash:_dailyOfficialInviteHash}}:null
  };
}
async function _dailyEnsureOfficialCapability(){
  if(!_dailyOfficialInviteToken)_dailyOfficialInviteToken='fresh-token';
  if(!_dailyOfficialInviteHash)_dailyOfficialInviteHash='fresh-hash';
  return true;
}
function _dailyRemoteCheckinOwnership(session){
  if(!session)return 'missing';
  return session.officialInvite?.tokenHash===_dailyOfficialInviteHash?'owned':'mismatch';
}
function _dailyIdentitySnapshot(){
  return {id:_dailyCheckinId,token:_dailyOfficialInviteToken,hash:_dailyOfficialInviteHash,epoch:_dailyCapabilityEpoch};
}
function _dailyIdentityCurrent(identity){
  return !!identity&&identity.id===_dailyCheckinId&&identity.token===_dailyOfficialInviteToken
    &&identity.hash===_dailyOfficialInviteHash&&identity.epoch===_dailyCapabilityEpoch;
}
async function _dailyWriteCheckinPayload(path){
  writes.push(path);
  if(mode==='stale-write'&&_dailyCheckinId==='DOWNED'){
    const identity=_dailyIdentitySnapshot();
    dailyEnsureCheckinId(true);
    return {committed:true,identityStale:true,identity,snapshot:{val:()=>({officialInvite:{tokenHash:identity.hash}})}};
  }
  if(mode==='owned-reconcile'&&ownedWriteCount++===0){
    return {committed:false,snapshot:{val:()=>({officialInvite:{tokenHash:_dailyOfficialInviteHash}})}};
  }
  if(mode==='write-mismatch'&&_dailyCheckinId==='DOWNED'){
    return {committed:false,snapshot:{val:()=>({officialInvite:{tokenHash:'other-hash'}})}};
  }
  if(mode==='blocked'){
    return {committed:false,snapshot:{val:()=>({officialInvite:{tokenHash:_dailyOfficialInviteHash}})}};
  }
  return {committed:true,snapshot:{val:()=>({officialInvite:{tokenHash:_dailyOfficialInviteHash}})}};
}
async function _dailyPullServerReconcile(){
  reconcileCalls++;
  return mode!=='blocked';
}
function _fbInit(){return true;}
const _fbDb={ref(path){return {update(value){updates.push({path,value});return Promise.resolve();}};}};
function _dailyCheckinPath(){return 'live/checkin_'+_dailyCheckinId;}
function _dailyFirstMatchStartedAt(){return 0;}
function _dailyCheckinExpiresAt(){return 999;}
function _dailyCheckinExpired(){return false;}
function _dailyNow(){return 300;}
function _dailyPersistServerIdentity(){}
function _dailyPersistCheckinIdentity(){}
function dailyStartCheckinListener(){listenerStarts++;}
function _dailyStartOperatorHeartbeat(){heartbeatStarts++;}
function dailyRenderCheckinRequests(){renderCalls++;}
function alert(message){alerts.push(message);}
async function dailyResumeCheckin(){return false;}
const console={warn(){}};
${publishSource}
function reset(nextMode,id){
  mode=nextMode;
  _dailyCheckinId=id;
  _dailyCheckinCreatedAt=100;
  _dailyOfficialInviteToken='local-token';
  _dailyOfficialInviteHash='local-hash';
  _dailyCapabilityEpoch++;
  _dailyCheckinIdentityPending=true;
  _dailyCheckinOwnershipVerified=false;
  _dailyRemoteCheckinExpiresAt=0;
  _dailyServerReconcileError='';
  rotations=0;
  writes=[];
  updates=[];
  listenerStarts=0;
  heartbeatStarts=0;
  renderCalls=0;
  reconcileCalls=0;
  alerts=[];
  ownedWriteCount=0;
}
this.api={
  reset,
  publish:dailyPublishCheckinSession,
  state:()=>({
    id:_dailyCheckinId,
    error:_dailyServerReconcileError,
    rotations,
    writes:[...writes],
    updates:[...updates],
    listenerStarts,
    heartbeatStarts,
    renderCalls,
    reconcileCalls,
    alerts:[...alerts]
  })
};
`,sandbox);

(async()=>{
  const activeRoot={session:{serverSessionId:'DOWNED',expiresAt:200,officialInvite:{tokenHash:'owned-hash'}},requests:{r1:{}}};
  safeRemoveSandbox.api.set(activeRoot);
  assert.strictEqual(await safeRemoveSandbox.api.remove({id:'DOWNED',hash:'owned-hash'},true),false,'갱신되어 아직 유효한 세션을 만료 삭제하면 안 됩니다.');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(safeRemoveSandbox.api.root())),activeRoot,'거절한 만료 삭제는 원격 루트를 그대로 보존해야 합니다.');
  safeRemoveSandbox.api.set({session:{serverSessionId:'DOWNED',expiresAt:90,officialInvite:{tokenHash:'other-hash'}}});
  assert.strictEqual(await safeRemoveSandbox.api.remove({id:'DOWNED',hash:'owned-hash'},true),false,'다른 토큰의 만료 세션을 삭제하면 안 됩니다.');
  safeRemoveSandbox.api.set({session:{serverSessionId:'DOWNED',expiresAt:90,officialInvite:{tokenHash:'owned-hash'}},party:{p1:{}}});
  assert.strictEqual(await safeRemoveSandbox.api.remove({id:'DOWNED',hash:'owned-hash'},true),true,'같은 토큰의 실제 만료 세션만 삭제해야 합니다.');
  assert.strictEqual(safeRemoveSandbox.api.root(),null,'안전한 만료 삭제는 해당 링크 루트 전체를 정리해야 합니다.');
  safeRemoveSandbox.api.set({session:{serverSessionId:'DOWNED',expiresAt:200,clientPublishId:'newer-write',officialInvite:{tokenHash:'owned-hash'}}});
  assert.strictEqual(await safeRemoveSandbox.api.remove({id:'DOWNED',hash:'owned-hash'},false,'stale-write'),false,'더 최신 게시 표식이 있는 세션을 이전 트랜잭션 정리로 삭제하면 안 됩니다.');

  const oldCapability=capabilitySandbox.api.ensure();
  capabilitySandbox.api.rotate();
  const newCapability=capabilitySandbox.api.ensure();
  capabilitySandbox.api.resolve('token-b','hash-b');
  assert.strictEqual(await newCapability,true,'새 ID의 운영 토큰 생성은 정상 완료되어야 합니다.');
  capabilitySandbox.api.resolve('token-a','hash-a');
  assert.strictEqual(await oldCapability,false,'이전 ID의 늦은 토큰 계산은 폐기해야 합니다.');
  const capabilityState=capabilitySandbox.api.state();
  assert.strictEqual(capabilityState.id,'DB');
  assert.strictEqual(capabilityState.token,'token-b');
  assert.strictEqual(capabilityState.hash,'hash-b');
  assert.strictEqual(capabilityState.persisted.length,1,'새 ID의 운영 토큰만 저장해야 합니다.');

  sandbox.api.reset('stale','DOLD');
  let id=await sandbox.api.publish(false);
  let state=sandbox.api.state();
  assert.strictEqual(id,'DNEW1','오래된 ID 대신 새 회원 링크 ID를 반환해야 합니다.');
  assert.strictEqual(state.rotations,1,'소유권이 다른 ID는 한 번 분리해야 합니다.');
  assert.strictEqual(state.writes.join(','),'live/checkin_DNEW1','새 ID의 세션만 Firebase에 저장해야 합니다.');
  assert.strictEqual(state.listenerStarts,1,'세션 저장 성공 뒤에만 회원 요청 수신을 시작해야 합니다.');
  assert.strictEqual(state.heartbeatStarts,1,'세션 저장 성공 뒤에만 운영 상태 전송을 시작해야 합니다.');

  sandbox.api.reset('owned-reconcile','DOWNED');
  id=await sandbox.api.publish(false);
  state=sandbox.api.state();
  assert.strictEqual(id,'DOWNED','소유권이 맞는 진행 중 라이브는 같은 링크를 유지해야 합니다.');
  assert.strictEqual(state.rotations,0,'정상 라이브 ID를 불필요하게 교체하면 안 됩니다.');
  assert.strictEqual(state.reconcileCalls,1,'서버가 앞선 정상 라이브는 먼저 운영 기록을 합쳐야 합니다.');
  assert.strictEqual(state.writes.length,2,'운영 기록을 합친 뒤 세션 저장을 다시 확인해야 합니다.');

  sandbox.api.reset('write-mismatch','DOWNED');
  id=await sandbox.api.publish(false);
  state=sandbox.api.state();
  assert.strictEqual(id,'DNEW1','게시 직전 ID 충돌도 새 링크로 자동 복구해야 합니다.');
  assert.strictEqual(state.rotations,1,'게시 트랜잭션의 소유권 충돌도 한 번 분리해야 합니다.');
  assert.strictEqual(state.updates[0].path,'live/checkin_DNEW1','충돌한 이전 경로의 상위 메타데이터를 갱신하면 안 됩니다.');

  sandbox.api.reset('stale-write','DOWNED');
  id=await sandbox.api.publish(false);
  state=sandbox.api.state();
  assert.strictEqual(id,'DNEW1','완료가 늦은 이전 ID 게시 결과 대신 현재 ID를 다시 게시해야 합니다.');
  assert.strictEqual(state.updates.length,1,'이전 ID의 늦은 완료 결과로 운영 메타데이터를 쓰면 안 됩니다.');
  assert.strictEqual(state.updates[0].path,'live/checkin_DNEW1','현재 ID의 저장 완료만 회원 링크로 확정해야 합니다.');

  sandbox.api.reset('unknown','DOWNED');
  id=await sandbox.api.publish(false);
  state=sandbox.api.state();
  assert.strictEqual(id,null,'서버 확인 실패를 링크 생성 성공으로 표시하면 안 됩니다.');
  assert.strictEqual(state.writes.length,0,'소유권을 확인하지 못한 경로에는 세션을 쓰면 안 됩니다.');
  assert.strictEqual(state.listenerStarts,0,'저장하지 못한 링크의 수신기를 시작하면 안 됩니다.');
  assert(state.alerts.length===1&&state.error.includes('서버 연결'),'사용자에게 재시도 가능한 연결 오류를 알려야 합니다.');

  sandbox.api.reset('blocked','DOWNED');
  id=await sandbox.api.publish(false);
  state=sandbox.api.state();
  assert.strictEqual(id,null,'트랜잭션 미완료 링크를 공유하면 안 됩니다.');
  assert.strictEqual(state.updates.length,0,'세션 저장 실패 시 상위 링크 메타데이터도 성공처럼 쓰면 안 됩니다.');
  assert.strictEqual(state.listenerStarts,0,'세션 저장 실패 시 회원 요청 수신을 시작하면 안 됩니다.');

  console.log('daily checkin identity regression ok');
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
