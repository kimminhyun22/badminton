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

admin.initializeApp();

const OFFICIAL_GRANT_SECRET = defineSecret('OFFICIAL_GRANT_SECRET');
const REGION = 'us-central1';
const MAX_GRANT_MS = 48 * 60 * 60 * 1000;
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

function safeOperationId(value){
  const id = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
  if(id.length < 12)throw new HttpsError('invalid-argument', '운영 명령 번호를 다시 확인해 주세요.');
  return id;
}

function sha256(value){
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function sameHex(a, b){
  try{
    const left = Buffer.from(String(a || ''), 'hex');
    const right = Buffer.from(String(b || ''), 'hex');
    return left.length === 32 && right.length === 32 && crypto.timingSafeEqual(left, right);
  }catch(e){return false;}
}

function publicCommand(raw, operationId){
  const command = JSON.parse(JSON.stringify(raw || {}));
  delete command.officialGrantToken;
  command.operationId = operationId;
  command.commandProtocol = 2;
  return command;
}

async function runExistingSessionTransaction(ref, update){
  for(let attempt=0;attempt<2;attempt+=1){
    const snapshot=await ref.get();
    if(!snapshot.child('session').exists())return {missing:true,result:null};
    let sawEmptyCache=false;
    const result=await ref.transaction(current=>{
      if(current==null){sawEmptyCache=true;return;}
      return update(current);
    }, undefined, false);
    if(!sawEmptyCache||result.committed)return {missing:false,result};
  }
  throw new HttpsError('aborted', '서버 상태를 다시 확인한 뒤 한 번 더 눌러 주세요.');
}

exports.claimDailyOfficialInvite = onCall(FUNCTION_OPTIONS, async request=>{
  const checkinId = cleanCheckinId(request.data?.checkinId);
  const inviteToken = String(request.data?.inviteToken || '');
  const clientId = cleanClientId(request.data?.clientId);
  if(!/^[a-f0-9]{48}$/i.test(inviteToken))throw new HttpsError('invalid-argument', '임원 운영 링크를 다시 확인해 주세요.');

  const now = Date.now();
  const ref = admin.database().ref(`live/checkin_${checkinId}`);
  let failure = '';
  let failureCode = 'permission-denied';
  let grantExpiresAt = 0;
  const transaction = await runExistingSessionTransaction(ref,current=>{
    failure = '';
    failureCode = 'permission-denied';
    if(!current?.session){failureCode='not-found';failure='종료되었거나 아직 게시되지 않은 민턴LIVE입니다.';return;}
    const session=current.session;
    if(session.capabilities?.officialOpsServerV2 !== true || Number(session.commandProtocol || 0) < 2){
      failureCode='failed-precondition';failure='아직 서버 운영이 준비되지 않은 민턴LIVE입니다.';return;
    }
    const invite=session.officialInvite||{};
    if(!sameHex(invite.tokenHash,sha256(inviteToken))){failure='임원 운영 링크가 올바르지 않습니다.';return;}
    const inviteExpiresAt=Number(invite.expiresAt||session.expiresAt||0);
    if(!inviteExpiresAt||now>=inviteExpiresAt){failure='임원 운영 링크 시간이 끝났습니다.';return;}
    current.officialClaims=current.officialClaims||{};
    Object.keys(current.officialClaims).forEach(key=>{
      if(now>=Number(current.officialClaims[key]?.expiresAt||0))delete current.officialClaims[key];
    });
    const existing=current.officialClaims[clientId];
    const maxClaims = Math.max(1, Math.min(20, Number(invite.maxClaims || 4)));
    if(!existing&&Object.keys(current.officialClaims).length>=maxClaims){
      failure='임원 운영 연결 가능 인원을 초과했습니다. 관리자에게 임원 링크를 다시 요청해 주세요.';
      return;
    }
    grantExpiresAt=Math.min(inviteExpiresAt,now+MAX_GRANT_MS);
    current.officialClaims[clientId]={
      clientId,
      claimedAt:existing?.claimedAt || now,
      refreshedAt:now,
      expiresAt:grantExpiresAt,
      inviteHash:String(invite.tokenHash || '')
    };
    return current;
  });

  if(transaction.missing)throw new HttpsError('not-found', '종료되었거나 아직 게시되지 않은 민턴LIVE입니다.');
  if(!transaction.result.committed)throw new HttpsError(failureCode, failure || '임원 운영 연결을 만들지 못했습니다.');
  const secret = OFFICIAL_GRANT_SECRET.value();
  const grantToken = issueOfficialGrant({v:1,sid:checkinId,cid:clientId,iat:now,exp:grantExpiresAt}, secret);
  return {ok:true,grantToken,expiresAt:grantExpiresAt};
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
  const storedCommand = publicCommand(request.data?.command, operationId);
  const payloadHash = sha256(canonicalJson(storedCommand));
  const engineCommand = {...storedCommand, officialGrantToken:grantToken};
  const ref = admin.database().ref(`live/checkin_${checkinId}`);
  let failureCode = '';
  let failureMessage = '';
  let terminal = null;

  const transaction = await runExistingSessionTransaction(ref,current=>{
    const outcome = applyCommandTransaction(current, {
      storedCommand,engineCommand,operationId,payloadHash,clientId,now,checkinId,grantSecret:secret
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
    throw new HttpsError('permission-denied', '임원 운영 연결 시간이 끝났습니다. 임원 운영 링크로 다시 열어 주세요.');
  }
  if(claim.inviteHash && claim.inviteHash !== String(current.session.officialInvite?.tokenHash || '')){
    throw new HttpsError('permission-denied', '새 임원 운영 링크로 다시 연결해 주세요.');
  }
  const serverRevision = Math.max(0, Number(current.session.serverRevision || 0));
  const commands = Object.entries(current.requests || {})
    .map(([key,row])=>({key,...row}))
    .filter(row=>row.serverAppliedAt && Number(row.serverRevision || 0) > sinceRevision)
    .sort((a,b)=>Number(a.serverRevision || 0)-Number(b.serverRevision || 0));
  return {ok:true,serverRevision,commands};
});
