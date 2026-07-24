'use strict';

const crypto = require('crypto');
const admin = require('firebase-admin');
const {onCall, HttpsError} = require('firebase-functions/v2/https');
const {defineSecret} = require('firebase-functions/params');
const {
  canonicalJson,
  issueOfficialGrant,
  verifyOfficialGrant
} = require('./daily-official-engine');
const {applyCommandTransaction} = require('./daily-official-command');
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
  const ref = admin.database().ref(`live/checkin_${checkinId}`);
  let outcome = null;
  let grantExpiresAt = 0;
  let officialPlayerId = '';
  let officialPlayerName = '';
  const transaction = await runExistingSessionTransaction(ref,current=>{
    outcome = applyOfficialClaimTransaction(current, {
      clientId,inviteToken,requestedPlayerId,now,maxGrantMs:MAX_GRANT_MS
    });
    grantExpiresAt = Number(outcome.grantExpiresAt || 0);
    officialPlayerId = String(outcome.officialPlayerId || '');
    officialPlayerName = String(outcome.officialPlayerName || '');
    return outcome.action === 'commit' ? outcome.current : undefined;
  });

  if(transaction.missing)throw new HttpsError('not-found', '종료되었거나 아직 게시되지 않은 민턴LIVE입니다.');
  if(!transaction.result.committed)throw new HttpsError(outcome?.failureCode || 'permission-denied', outcome?.failureMessage || '임원 운영 연결을 만들지 못했습니다.');
  const secret = OFFICIAL_GRANT_SECRET.value();
  const grantToken = issueOfficialGrant({
    v:1,sid:checkinId,cid:clientId,iat:now,exp:grantExpiresAt,
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
      storedCommand,engineCommand,operationId,payloadHash,clientId,grantPlayerId,now,checkinId,grantSecret:secret
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
