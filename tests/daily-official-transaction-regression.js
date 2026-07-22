'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const source=fs.readFileSync(path.join(__dirname,'..','functions','index.js'),'utf8');
const start=source.indexOf('async function runExistingSessionTransaction');
const end=source.indexOf('exports.claimDailyOfficialInvite',start);
assert(start>=0&&end>start,'서버 트랜잭션 래퍼 범위를 찾을 수 있어야 합니다.');
const helperSource=source.slice(start,end);

class TestHttpsError extends Error{
  constructor(code,message){super(message);this.code=code;}
}

const sandbox={HttpsError:TestHttpsError};
vm.createContext(sandbox);
vm.runInContext(`${helperSource}\nthis.runTransaction=runExistingSessionTransaction;`,sandbox);

function snapshot(hasSession){
  return {child:key=>({exists:()=>key==='session'&&hasSession})};
}

(async()=>{
  let getCalls=0;
  let transactionCalls=0;
  const coldRef={
    async get(){getCalls+=1;return snapshot(true);},
    async transaction(update){
      transactionCalls+=1;
      if(transactionCalls===1){update(null);return {committed:false};}
      const current={session:{id:'test'}};
      const next=update(current);
      return {committed:next!==undefined,snapshot:{val:()=>next}};
    }
  };
  const recovered=await sandbox.runTransaction(coldRef,current=>{current.applied=true;return current;});
  assert.strictEqual(recovered.result.committed,true,'첫 빈 캐시 뒤에는 서버 세션을 다시 읽고 트랜잭션을 완료해야 합니다.');
  assert.strictEqual(getCalls,2,'빈 캐시를 실제 세션 삭제로 단정하지 말고 한 번 다시 조회해야 합니다.');
  assert.strictEqual(transactionCalls,2,'빈 캐시 트랜잭션은 한 번 재시도해야 합니다.');

  let missingTransactionCalls=0;
  const missingRef={
    async get(){return snapshot(false);},
    async transaction(){missingTransactionCalls+=1;return {committed:false};}
  };
  const missing=await sandbox.runTransaction(missingRef,current=>current);
  assert.strictEqual(missing.missing,true,'서버 조회에서도 세션이 없을 때만 종료된 LIVE로 판단해야 합니다.');
  assert.strictEqual(missingTransactionCalls,0,'삭제된 LIVE에는 트랜잭션을 시작하면 안 됩니다.');

  let abortCalls=0;
  const abortRef={
    async get(){return snapshot(true);},
    async transaction(update){abortCalls+=1;update({session:{id:'test'}});return {committed:false};}
  };
  const aborted=await sandbox.runTransaction(abortRef,()=>undefined);
  assert.strictEqual(aborted.result.committed,false,'권한·상태 검증이 거절한 정상 중단을 유지해야 합니다.');
  assert.strictEqual(abortCalls,1,'실제 데이터에서 거절된 명령을 빈 캐시로 오인해 재시도하면 안 됩니다.');

  console.log('daily official transaction regression ok');
})().catch(error=>{console.error(error);process.exitCode=1;});
