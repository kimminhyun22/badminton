'use strict';

const {applyOfficialRequest} = require('./daily-official-engine');

function applyCommandTransaction(current, input){
  const {
    storedCommand,
    engineCommand,
    operationId,
    payloadHash,
    clientId,
    now,
    checkinId,
    grantSecret
  } = input;
  if(!current?.session){
    return {action:'abort',failureCode:'not-found',failureMessage:'종료되었거나 아직 게시되지 않은 민턴LIVE입니다.'};
  }
  const claim = current.officialClaims?.[clientId];
  if(!claim || now >= Number(claim.expiresAt || 0)){
    return {action:'abort',failureCode:'permission-denied',failureMessage:'임원 운영 연결 시간이 끝났습니다. 임원 운영 링크로 다시 열어 주세요.'};
  }
  current.serverCommands = current.serverCommands || {};
  const previous = current.serverCommands[operationId];
  if(previous){
    if(previous.payloadHash !== payloadHash){
      return {action:'abort',failureCode:'already-exists',failureMessage:'같은 운영 명령 번호에 다른 내용이 들어와 차단했습니다.'};
    }
    return {action:'duplicate',terminal:previous};
  }

  const applied = applyOfficialRequest(current.session, engineCommand, {
    now,
    requestId:operationId,
    checkinId,
    grantSecret,
    serverOps:current.serverOps || {}
  });
  if(applied.status === 'skipped'){
    return {action:'abort',failureCode:'failed-precondition',failureMessage:'서버 운영 준비 상태를 다시 확인해 주세요.'};
  }

  const requestRow = {...storedCommand,createdByClientId:clientId};
  current.requests = current.requests || {};
  current.serverOps = applied.serverOps || current.serverOps || {};
  let terminal;
  if(applied.status === 'rejected'){
    requestRow.serverRejectedAt = now;
    requestRow.serverReason = applied.reason || '현재 상태에서 처리할 수 없습니다.';
    requestRow.serverProcessedBy = 'cloud-function-v2';
    current.requests[operationId] = requestRow;
    terminal = current.serverCommands[operationId] = {
      status:'rejected',payloadHash,reason:requestRow.serverReason,
      observedRevision:Number(current.session.serverRevision || 0),
      resultRevision:Number(current.session.serverRevision || 0),createdAt:now
    };
  }else{
    current.session = applied.session;
    requestRow.serverAppliedAt = now;
    requestRow.serverRevision = applied.revision || 0;
    requestRow.serverProcessedBy = 'cloud-function-v2';
    requestRow.serverReconcilePending = true;
    current.requests[operationId] = requestRow;
    terminal = current.serverCommands[operationId] = {
      status:'applied',payloadHash,observedRevision:Number(applied.revision || 1)-1,
      resultRevision:Number(applied.revision || 0),createdAt:now
    };
    current.updatedAt = now;
  }
  return {action:'commit',current,terminal};
}

module.exports = {applyCommandTransaction};
