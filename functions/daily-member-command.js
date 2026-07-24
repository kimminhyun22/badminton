'use strict';

const {applyMemberStatusRequest} = require('./daily-official-engine');

function applyMemberCommandTransaction(current, input){
  const {
    storedCommand,
    operationId,
    payloadHash,
    now,
    checkinId
  } = input;
  if(!current?.session){
    return {action:'abort', failureCode:'not-found', failureMessage:'종료되었거나 아직 게시되지 않은 민턴LIVE입니다.'};
  }
  current.serverCommands = current.serverCommands || {};
  const previous = current.serverCommands[operationId];
  if(previous){
    if(previous.payloadHash !== payloadHash){
      return {action:'abort', failureCode:'already-exists', failureMessage:'같은 회원 요청 번호에 다른 내용이 들어와 차단했습니다.'};
    }
    return {action:'duplicate', terminal:previous};
  }

  const applied = applyMemberStatusRequest(current.session, storedCommand, {
    now,
    requestId:operationId,
    checkinId
  });
  if(applied.status === 'skipped'){
    return {action:'abort', failureCode:'failed-precondition', failureMessage:'회원 즉시 처리 준비 상태를 다시 확인해 주세요.'};
  }

  const requestRow = {...storedCommand};
  current.requests = current.requests || {};
  let terminal;
  if(applied.status === 'rejected'){
    requestRow.serverRejectedAt = now;
    requestRow.serverReason = applied.reason || '현재 상태에서 처리할 수 없습니다.';
    requestRow.serverProcessedBy = 'cloud-function-member-v1';
    current.requests[operationId] = requestRow;
    terminal = current.serverCommands[operationId] = {
      status:'rejected',
      payloadHash,
      reason:requestRow.serverReason,
      observedRevision:Number(current.session.serverRevision || 0),
      resultRevision:Number(current.session.serverRevision || 0),
      createdAt:now
    };
  }else{
    current.session = applied.session;
    const serverResult = applied.result && typeof applied.result === 'object' ? applied.result : null;
    requestRow.serverAppliedAt = now;
    requestRow.serverRevision = applied.revision || 0;
    requestRow.serverProcessedBy = 'cloud-function-member-v1';
    requestRow.serverReconcilePending = true;
    if(serverResult)requestRow.serverResult = serverResult;
    current.requests[operationId] = requestRow;
    terminal = current.serverCommands[operationId] = {
      status:'applied',
      payloadHash,
      observedRevision:Number(applied.revision || 1) - 1,
      resultRevision:Number(applied.revision || 0),
      createdAt:now,
      ...(serverResult ? {serverResult} : {})
    };
    current.updatedAt = now;
  }
  return {action:'commit', current, terminal};
}

module.exports = {applyMemberCommandTransaction};
