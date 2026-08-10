'use strict';

const crypto = require('crypto');
const admin = require('firebase-admin');
const {onCall, HttpsError} = require('firebase-functions/v2/https');
const {applyTeamOfficialRequest} = require('./team-official-engine');
const {onSchedule} = require('firebase-functions/v2/scheduler');
const {defineSecret} = require('firebase-functions/params');
const {
  canonicalJson,
  issueOfficialGrant,
  verifyOfficialGrant
} = require('./daily-official-engine');
const {applyCommandTransaction} = require('./daily-official-command');
const {applyMemberCommandTransaction} = require('./daily-member-command');
const {applyOfficialClaimTransaction} = require('./daily-official-claim');

admin.initializeApp();

const OFFICIAL_GRANT_SECRET = defineSecret('OFFICIAL_GRANT_SECRET');
const REGION = 'us-central1';
const MAX_GRANT_MS = 48 * 60 * 60 * 1000;
const MAX_COMMAND_BYTES = 24 * 1024;
const FUNCTION_OPTIONS = {
  region:REGION,
  secrets:[OFFICIAL_GRANT_SECRET],
  maxInstances:10,
  timeoutSeconds:20,
  memory:'256MiB'
};
const MEMBER_FUNCTION_OPTIONS = {
  region:REGION,
  maxInstances:10,
  timeoutSeconds:20,
  memory:'256MiB'
};

function cleanCheckinId(value){
  const id = String(value || '').trim().toUpperCase();
  if(!/^D[A-Z2-9]{7}$/.test(id))throw new HttpsError('invalid-argument', '민턴LIVE 링크를 다시 확인해 주세요.');
  return id;
}

function cleanClientId(value){
  const id = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  if(id.length < 16)throw new HttpsError('invalid-argument', '임원 기기 연결 정보를 다시 확인해 주세요.');
  return id;
}

function cleanOptionalPlayerId(value){
  const id = String(value || '').trim();
  if(!id)return '';
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw new HttpsError('invalid-argument', '선택한 임원 정보를 다시 확인해 주세요.');
  return id;
}

function cleanMemberPlayerId(value){
  const id = String(value || '').trim();
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw new HttpsError('invalid-argument', '선택한 선수 정보를 다시 확인해 주세요.');
  return id;
}

function safeOperationId(value){
  const id = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
  if(id.length < 12)throw new HttpsError('invalid-argument', '운영 명령 번호를 다시 확인해 주세요.');
  return id;
}

function sha256(value){
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function publicCommand(raw, operationId){
  const command = JSON.parse(JSON.stringify(raw || {}));
  delete command.officialGrantToken;
  command.operationId = operationId;
  command.commandProtocol = 2;
  return command;
}

function publicMemberStatusCommand(raw, operationId){
  const command = raw || {};
  return {
    type:String(command.type || ''),
    operationId,
    commandProtocol:2,
    actorPlayerId:String(command.actorPlayerId || ''),
    playerId:String(command.playerId || ''),
    playerName:String(command.playerName || '').trim().slice(0, 80),
    status:String(command.status || ''),
    expectedStatus:String(command.expectedStatus || ''),
    expectedCurrentMatchId:String(command.expectedCurrentMatchId || ''),
    expectedLastStatusAt:Number(command.expectedLastStatusAt || 0),
    createdAt:Number(command.createdAt || 0),
    expiresAt:Number(command.expiresAt || 0),
    source:'member-checkin-server'
  };
}

function holdReferenceValue(ref){
  return new Promise((resolve,reject)=>{
    let settled=false;
    const onValue=snapshot=>{
      if(settled)return;
      settled=true;
      resolve({snapshot,release:()=>ref.off('value',onValue)});
    };
    const onCancel=error=>{
      if(settled)return;
      settled=true;
      reject(error);
    };
    ref.on('value',onValue,onCancel);
  });
}

async function runExistingSessionTransaction(ref, update){
  for(let attempt=0;attempt<2;attempt+=1){
    const observed=await holdReferenceValue(ref);
    try{
      if(!observed.snapshot.child('session').exists())return {missing:true,result:null};
      let sawEmptyCache=false;
      const result=await ref.transaction(current=>{
        if(current==null){sawEmptyCache=true;return;}
        return update(current);
      }, undefined, false);
      if(!sawEmptyCache||result.committed)return {missing:false,result};
    }finally{
      observed.release();
    }
  }
  throw new HttpsError('aborted', '서버 상태를 다시 확인한 뒤 한 번 더 눌러 주세요.');
}

exports.claimDailyOfficialInvite = onCall(FUNCTION_OPTIONS, async request=>{
  const checkinId = cleanCheckinId(request.data?.checkinId);
  const inviteToken = String(request.data?.inviteToken || '');
  const requestedPlayerId = cleanOptionalPlayerId(request.data?.playerId);
  const clientId = cleanClientId(request.data?.clientId);
  if(!requestedPlayerId && inviteToken && !/^[a-f0-9]{48}$/i.test(inviteToken))throw new HttpsError('invalid-argument', '임원 운영 연결을 다시 확인해 주세요.');
  if(!inviteToken && !requestedPlayerId)throw new HttpsError('invalid-argument', '명부에서 임원 본인 이름을 선택해 주세요.');

  const now = Date.now();
  const requestedClaimNonce = crypto.randomBytes(12).toString('hex');
  const ref = admin.database().ref(`live/checkin_${checkinId}`);
  let outcome = null;
  let grantExpiresAt = 0;
  let claimNonce = '';
  let officialPlayerId = '';
  let officialPlayerName = '';
  const transaction = await runExistingSessionTransaction(ref,current=>{
    outcome = applyOfficialClaimTransaction(current, {
      clientId,inviteToken,requestedPlayerId,now,maxGrantMs:MAX_GRANT_MS,claimNonce:requestedClaimNonce
    });
    grantExpiresAt = Number(outcome.grantExpiresAt || 0);
    claimNonce = String(outcome.claimNonce || '');
    officialPlayerId = String(outcome.officialPlayerId || '');
    officialPlayerName = String(outcome.officialPlayerName || '');
    return outcome.action === 'commit' ? outcome.current : undefined;
  });

  if(transaction.missing)throw new HttpsError('not-found', '종료되었거나 아직 게시되지 않은 민턴LIVE입니다.');
  if(!transaction.result.committed)throw new HttpsError(outcome?.failureCode || 'permission-denied', outcome?.failureMessage || '임원 운영 연결을 만들지 못했습니다.');
  const secret = OFFICIAL_GRANT_SECRET.value();
  const grantToken = issueOfficialGrant({
    v:1,sid:checkinId,cid:clientId,iat:now,exp:grantExpiresAt,
    ...(claimNonce?{cn:claimNonce}:{}),
    ...(officialPlayerId?{pid:officialPlayerId}:{})
  }, secret);
  return {ok:true,grantToken,expiresAt:grantExpiresAt,playerId:officialPlayerId,playerName:officialPlayerName};
});

exports.submitDailyOfficialRequest = onCall(FUNCTION_OPTIONS, async request=>{
  const checkinId = cleanCheckinId(request.data?.checkinId);
  const operationId = safeOperationId(request.data?.command?.operationId);
  const grantToken = String(request.data?.grantToken || '');
  const now = Date.now();
  const secret = OFFICIAL_GRANT_SECRET.value();
  const verified = verifyOfficialGrant(grantToken, secret, checkinId, now);
  if(!verified.ok)throw new HttpsError('permission-denied', verified.reason || '임원 운영 연결을 확인하지 못했습니다.');
  const clientId = cleanClientId(verified.payload.cid);
  const grantPlayerId = cleanOptionalPlayerId(verified.payload.pid);
  const grantClaimNonce = String(verified.payload.cn || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  const storedCommand = publicCommand(request.data?.command, operationId);
  const canonicalCommand = canonicalJson(storedCommand);
  if(Buffer.byteLength(canonicalCommand, 'utf8') > MAX_COMMAND_BYTES){
    throw new HttpsError('invalid-argument', '운영 명령 내용이 너무 큽니다. 화면을 새로 연 뒤 다시 처리해 주세요.');
  }
  const payloadHash = sha256(canonicalCommand);
  const engineCommand = {...storedCommand, officialGrantToken:grantToken};
  const ref = admin.database().ref(`live/checkin_${checkinId}`);
  let failureCode = '';
  let failureMessage = '';
  let terminal = null;

  const transaction = await runExistingSessionTransaction(ref,current=>{
    const outcome = applyCommandTransaction(current, {
      storedCommand,engineCommand,operationId,payloadHash,clientId,grantPlayerId,grantClaimNonce,now,checkinId,grantSecret:secret
    });
    failureCode = outcome.failureCode || '';
    failureMessage = outcome.failureMessage || '';
    terminal = outcome.terminal || null;
    return outcome.action === 'commit' ? outcome.current : undefined;
  });

  if(transaction.missing)throw new HttpsError('not-found', '종료되었거나 아직 게시되지 않은 민턴LIVE입니다.');
  if(!transaction.result.committed){
    if(terminal)return {ok:terminal.status==='applied',requestId:operationId,...terminal};
    throw new HttpsError(failureCode || 'aborted', failureMessage || '운영 요청을 처리하지 못했습니다.');
  }
  return {ok:terminal?.status==='applied',requestId:operationId,...terminal};
});

exports.submitDailyMemberStatusRequest = onCall(MEMBER_FUNCTION_OPTIONS, async request=>{
  const checkinId = cleanCheckinId(request.data?.checkinId);
  const operationId = safeOperationId(request.data?.command?.operationId);
  const storedCommand = publicMemberStatusCommand(request.data?.command, operationId);
  const playerId = cleanMemberPlayerId(storedCommand.playerId);
  const actorPlayerId = cleanMemberPlayerId(storedCommand.actorPlayerId);
  if(playerId !== actorPlayerId)throw new HttpsError('permission-denied', '본인 상태만 변경할 수 있습니다.');
  const canonicalCommand = canonicalJson(storedCommand);
  if(Buffer.byteLength(canonicalCommand, 'utf8') > MAX_COMMAND_BYTES){
    throw new HttpsError('invalid-argument', '회원 요청 내용이 너무 큽니다. 화면을 새로 연 뒤 다시 처리해 주세요.');
  }
  const payloadHash = sha256(canonicalCommand);
  const now = Date.now();
  const ref = admin.database().ref(`live/checkin_${checkinId}`);
  let failureCode = '';
  let failureMessage = '';
  let terminal = null;

  const transaction = await runExistingSessionTransaction(ref,current=>{
    const outcome = applyMemberCommandTransaction(current, {
      storedCommand,operationId,payloadHash,now,checkinId
    });
    failureCode = outcome.failureCode || '';
    failureMessage = outcome.failureMessage || '';
    terminal = outcome.terminal || null;
    return outcome.action === 'commit' ? outcome.current : undefined;
  });

  if(transaction.missing)throw new HttpsError('not-found', '종료되었거나 아직 게시되지 않은 민턴LIVE입니다.');
  if(!transaction.result.committed){
    if(terminal)return {ok:terminal.status==='applied',requestId:operationId,...terminal};
    throw new HttpsError(failureCode || 'aborted', failureMessage || '회원 요청을 처리하지 못했습니다.');
  }
  return {ok:terminal?.status==='applied',requestId:operationId,...terminal};
});

exports.getDailyOfficialReconcile = onCall(FUNCTION_OPTIONS, async request=>{
  const checkinId = cleanCheckinId(request.data?.checkinId);
  const sinceRevision = Math.max(0, Math.floor(Number(request.data?.sinceRevision || 0)));
  const lastRequestId = String(request.data?.lastRequestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
  const now = Date.now();
  const secret = OFFICIAL_GRANT_SECRET.value();
  const verified = verifyOfficialGrant(String(request.data?.grantToken || ''), secret, checkinId, now);
  if(!verified.ok)throw new HttpsError('permission-denied', verified.reason || '임원 운영 연결을 확인하지 못했습니다.');
  const clientId = cleanClientId(verified.payload.cid);
  const snapshot = await admin.database().ref(`live/checkin_${checkinId}`).once('value');
  const current = snapshot.val();
  if(!current?.session)throw new HttpsError('not-found', '종료되었거나 아직 게시되지 않은 민턴LIVE입니다.');
  const claim = current.officialClaims?.[clientId];
  if(!claim || now >= Number(claim.expiresAt || 0)){
    throw new HttpsError('permission-denied', '임원 운영 연결 시간이 끝났습니다. 본인 이름을 다시 선택해 주세요.');
  }
  if(claim.inviteHash && claim.inviteHash !== String(current.session.officialInvite?.tokenHash || '')){
    throw new HttpsError('permission-denied', '임원 본인 이름을 다시 선택해 운영 권한을 연결해 주세요.');
  }
  const grantPlayerId = cleanOptionalPlayerId(verified.payload.pid);
  const claimPlayerId = cleanOptionalPlayerId(claim.officialPlayerId);
  if(Boolean(grantPlayerId) !== Boolean(claimPlayerId) || (grantPlayerId && claimPlayerId !== grantPlayerId)){
    throw new HttpsError('permission-denied', '선택한 임원 본인 정보를 다시 확인해 주세요.');
  }
  if(String(verified.payload.cn || '') !== String(claim.claimNonce || '')){
    throw new HttpsError('permission-denied', '운영 권한 연결이 갱신되었습니다. 본인 이름을 다시 선택해 주세요.');
  }
  const serverRevision = Math.max(0, Number(current.session.serverRevision || 0));
  const serverLastRequestId = String(current.session.serverLastRequestId || '');
  const replayLatest = sinceRevision === serverRevision
    && serverLastRequestId
    && lastRequestId !== serverLastRequestId;
  const revisionFloor = replayLatest ? Math.max(0, serverRevision - 1) : sinceRevision;
  const commands = Object.entries(current.requests || {})
    .map(([key,row])=>({key,...row}))
    .filter(row=>row.serverAppliedAt && Number(row.serverRevision || 0) > revisionFloor)
    .sort((a,b)=>Number(a.serverRevision || 0)-Number(b.serverRevision || 0));
  return {ok:true,serverRevision,serverLastRequestId,commands};
});

/* ── 만료 세션 정리 ──────────────────────────────────────────────
   예전에는 클라이언트가 live 전체를 내려받아 청소했습니다. 그러려면 모든 클럽의
   세션을 읽을 수 있어야 해서, 링크를 모르는 사람도 남의 명단을 볼 수 있었습니다.
   청소를 서버로 옮기고 클라이언트의 전체 읽기 경로는 없앴습니다(2026-08-03).
   보관 기간이 지난 세션만 지웁니다. 관리자 화면의 운영 기록은 기기에 따로 있어
   여기서 지워도 영향이 없습니다. */
const LIVE_RETAIN_AFTER_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const LIVE_RETAIN_WITHOUT_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * 팀전 임원 운영 요청 (운영자 2026-08-13 "임원 운영을 중심으로 서버 동기화").
 * 팀전 라이브는 `live/<liveId>` 에 페이로드가 통째로 들어갑니다(민턴LIVE 처럼
 * `session` 하위가 아님) — 그래서 전용 트랜잭션을 씁니다.
 *
 * 신원은 아직 **이름 기준**입니다: 게시된 임원 명단(officials)에 있는 이름만
 * 통과합니다. 팀전에는 아직 서명된 권한(grant)이 없어, 민턴LIVE 수준의 위조
 * 방지는 다음 단계입니다. 그래도 클라이언트가 대진을 직접 덮어쓰던 것보다는
 * 안전합니다 — 규칙 검사를 화면에서 지울 수 없습니다.
 */
exports.submitTeamOfficialRequest = onCall(FUNCTION_OPTIONS, async request=>{
  const liveId = String(request.data?.liveId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  if(!liveId)throw new HttpsError('invalid-argument', '팀전 링크를 확인하지 못했습니다.');
  const operationId = safeOperationId(request.data?.command?.operationId);
  const command = request.data?.command || {};
  const canonicalCommand = canonicalJson(command);
  if(Buffer.byteLength(canonicalCommand, 'utf8') > MAX_COMMAND_BYTES){
    throw new HttpsError('invalid-argument', '운영 요청 내용이 너무 큽니다.');
  }
  const now = Date.now();
  const ref = admin.database().ref(`live/${liveId}`);
  let terminal = null;
  let alreadyDone = null;

  const result = await ref.transaction(current=>{
    if(current == null)return;
    // 같은 요청을 두 번 눌러도 한 번만 적용합니다(재시도·중복 탭 대비).
    const prior = current.officialOps && current.officialOps[operationId];
    if(prior){ alreadyDone = prior; return current; }
    const outcome = applyTeamOfficialRequest(current, {...command, operationId}, {now});
    terminal = {status:outcome.status, reason:outcome.reason, result:outcome.result};
    const next = outcome.status === 'applied' ? outcome.session : {...current};
    next.officialOps = {...(current.officialOps || {}), [operationId]:{
      at:now,
      status:outcome.status,
      reason:outcome.reason || '',
      type:String(command.type || ''),
      by:String(command.actorPlayerName || '')
    }};
    return next;
  }, undefined, false);

  if(!result.committed)throw new HttpsError('aborted', '서버 상태를 다시 확인한 뒤 한 번 더 눌러 주세요.');
  if(!result.snapshot.exists())throw new HttpsError('not-found', '종료되었거나 없는 팀전입니다.');
  if(alreadyDone){
    return {ok:alreadyDone.status === 'applied', requestId:operationId,
      status:alreadyDone.status, reason:alreadyDone.reason || '', repeated:true};
  }
  if(!terminal)throw new HttpsError('aborted', '요청을 처리하지 못했습니다.');
  return {ok:terminal.status === 'applied', requestId:operationId, ...terminal};
});

exports.cleanupExpiredLive = onSchedule({
  region:REGION,
  schedule:'every 6 hours',
  timeoutSeconds:120,
  memory:'256MiB',
  maxInstances:1
}, async ()=>{
  const now = Date.now();
  const snapshot = await admin.database().ref('live').once('value');
  const all = snapshot.val() || {};
  const dead = [];
  for(const id of Object.keys(all)){
    const node = all[id] || {};
    const session = node.session && typeof node.session === 'object' ? node.session : node;
    const expiresAt = Number(session.expiresAt || node.expiresAt || 0);
    const touchedAt = Number(session.updatedAt || node.updatedAt || session.createdAt || node.createdAt || 0);
    const expiredLongEnough = expiresAt > 0 && now - expiresAt > LIVE_RETAIN_AFTER_EXPIRY_MS;
    const staleWithoutExpiry = expiresAt <= 0 && touchedAt > 0 && now - touchedAt > LIVE_RETAIN_WITHOUT_EXPIRY_MS;
    // 만료 시각도 갱신 시각도 없는 노드는 판단 근거가 없으므로 건드리지 않습니다.
    if(expiredLongEnough || staleWithoutExpiry) dead.push(id);
  }
  for(const id of dead){
    await admin.database().ref('live/' + id).remove();
  }
  console.info('민턴LIVE 만료 세션 정리', {검사:Object.keys(all).length, 삭제:dead.length});
});
