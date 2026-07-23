'use strict';

const crypto = require('crypto');

function text(value){
  return String(value == null ? '' : value);
}

function number(value, fallback = 0){
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sha256(value){
  return crypto.createHash('sha256').update(text(value)).digest('hex');
}

function sameHex(a, b){
  try{
    const left = Buffer.from(text(a), 'hex');
    const right = Buffer.from(text(b), 'hex');
    return left.length === 32 && right.length === 32 && crypto.timingSafeEqual(left, right);
  }catch(e){return false;}
}

function abort(failureCode, failureMessage){
  return {action:'abort',failureCode,failureMessage};
}

function applyOfficialClaimTransaction(current, input){
  const {clientId, inviteToken, requestedPlayerId, now, maxGrantMs} = input;
  if(!current?.session){
    return abort('not-found', '종료되었거나 아직 게시되지 않은 민턴LIVE입니다.');
  }
  const session = current.session;
  if(session.capabilities?.officialOpsServerV2 !== true || number(session.commandProtocol) < 2){
    return abort('failed-precondition', '아직 서버 운영이 준비되지 않은 민턴LIVE입니다.');
  }

  const invite = session.officialInvite || {};
  const inviteExpiresAt = number(invite.expiresAt || session.expiresAt);
  if(!inviteExpiresAt || now >= inviteExpiresAt){
    return abort('permission-denied', '민턴LIVE 운영 연결 시간이 끝났습니다.');
  }

  let officialPlayer = null;
  let claimMode = 'invite';
  if(requestedPlayerId){
    claimMode = 'roster';
    officialPlayer = (session.players || []).find(player=>text(player?.id) === text(requestedPlayerId)) || null;
    if(!officialPlayer?.isClubOfficial){
      return abort('permission-denied', '현재 명부에서 클럽 임원으로 등록된 본인 이름을 선택해 주세요.');
    }
  }else if(!inviteToken || !sameHex(invite.tokenHash, sha256(inviteToken))){
    return abort('permission-denied', '임원 운영 연결이 올바르지 않습니다.');
  }
  if(officialPlayer && ['invited','planned'].includes(text(officialPlayer.status))){
    return abort('failed-precondition', '관리자가 현장 참가를 등록한 뒤 임원 운영을 사용할 수 있습니다.');
  }

  current.officialClaims = current.officialClaims || {};
  Object.keys(current.officialClaims).forEach(key=>{
    if(now >= number(current.officialClaims[key]?.expiresAt))delete current.officialClaims[key];
  });
  const existing = current.officialClaims[clientId];
  const maxClaims = Math.max(1, Math.min(20, number(invite.maxClaims, 4)));
  const officialPlayerId = text(officialPlayer?.id);
  if(!existing && Object.keys(current.officialClaims).length >= maxClaims){
    const sameOfficialClaim = officialPlayerId
      ? Object.keys(current.officialClaims)
        .filter(key=>text(current.officialClaims[key]?.officialPlayerId) === officialPlayerId)
        .sort((a,b)=>number(current.officialClaims[a]?.refreshedAt || current.officialClaims[a]?.claimedAt)-number(current.officialClaims[b]?.refreshedAt || current.officialClaims[b]?.claimedAt))[0]
      : '';
    if(sameOfficialClaim)delete current.officialClaims[sameOfficialClaim];
  }
  if(!existing && Object.keys(current.officialClaims).length >= maxClaims){
    return abort('resource-exhausted', '임원 운영 연결 가능 인원을 초과했습니다. 잠시 후 다시 시도해 주세요.');
  }

  const sameActor = !officialPlayerId || text(existing?.officialPlayerId) === officialPlayerId;
  const grantExpiresAt = Math.min(inviteExpiresAt, now + maxGrantMs);
  current.officialClaims[clientId] = {
    clientId,
    claimedAt:sameActor && existing?.claimedAt ? existing.claimedAt : now,
    refreshedAt:now,
    expiresAt:grantExpiresAt,
    claimMode,
    ...(claimMode === 'invite'?{inviteHash:text(invite.tokenHash)}:{}),
    ...(officialPlayerId?{
      officialPlayerId,
      officialPlayerName:text(officialPlayer.name)
    }:{})
  };
  return {
    action:'commit',
    current,
    grantExpiresAt,
    officialPlayerId,
    officialPlayerName:text(officialPlayer?.name)
  };
}

module.exports = {applyOfficialClaimTransaction};
