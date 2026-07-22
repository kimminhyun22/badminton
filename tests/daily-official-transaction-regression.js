'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const source=fs.readFileSync(path.join(__dirname,'..','functions','index.js'),'utf8');
const start=source.indexOf('function holdReferenceValue');
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
  let observerActive=false;
  let onCalls=0;
  let offCalls=0;
  let transactionCalls=0;
  const coldRef={
    on(event,callback){
      assert.strictEqual(event,'value');
      onCalls+=1;
      observerActive=true;
      callback(snapshot(true));
    },
    off(event){
      assert.strictEqual(event,'value');
      offCalls+=1;
      observerActive=false;
    },
    async transaction(update){
      transactionCalls+=1;
      assert.strictEqual(observerActive,true,'서버 값 리스너를 유지한 상태에서 트랜잭션을 시작해야 합니다.');
      const current={session:{id:'test'}};
      const next=update(current);
      return {committed:next!==undefined,snapshot:{val:()=>next}};
    }
  };
  const recovered=await sandbox.runTransaction(coldRef,current=>{current.applied=true;return current;});
  assert.strictEqual(recovered.result.committed,true,'서버 세션을 구독한 상태에서 트랜잭션을 완료해야 합니다.');
  assert.strictEqual(onCalls,1,'트랜잭션 전에 서버 값을 한 번 구독해야 합니다.');
  assert.strictEqual(transactionCalls,1,'서버 값이 준비되면 한 번의 트랜잭션으로 완료해야 합니다.');
  assert.strictEqual(offCalls,1,'트랜잭션이 끝나면 서버 값 리스너를 해제해야 합니다.');
  assert.strictEqual(observerActive,false,'완료 뒤 서버 값 리스너가 남으면 안 됩니다.');

  let missingTransactionCalls=0;
  let missingOffCalls=0;
  const missingRef={
    on(event,callback){callback(snapshot(false));},
    off(){missingOffCalls+=1;},
    async transaction(){missingTransactionCalls+=1;return {committed:false};}
  };
  const missing=await sandbox.runTransaction(missingRef,current=>current);
  assert.strictEqual(missing.missing,true,'서버 조회에서도 세션이 없을 때만 종료된 LIVE로 판단해야 합니다.');
  assert.strictEqual(missingTransactionCalls,0,'삭제된 LIVE에는 트랜잭션을 시작하면 안 됩니다.');
  assert.strictEqual(missingOffCalls,1,'삭제된 LIVE를 확인한 뒤에도 서버 값 리스너를 해제해야 합니다.');

  let abortCalls=0;
  let abortOffCalls=0;
  const abortRef={
    on(event,callback){callback(snapshot(true));},
    off(){abortOffCalls+=1;},
    async transaction(update){abortCalls+=1;update({session:{id:'test'}});return {committed:false};}
  };
  const aborted=await sandbox.runTransaction(abortRef,()=>undefined);
  assert.strictEqual(aborted.result.committed,false,'권한·상태 검증이 거절한 정상 중단을 유지해야 합니다.');
  assert.strictEqual(abortCalls,1,'실제 데이터에서 거절된 명령을 빈 캐시로 오인해 재시도하면 안 됩니다.');
  assert.strictEqual(abortOffCalls,1,'거절된 명령도 서버 값 리스너를 해제해야 합니다.');

  console.log('daily official transaction regression ok');
})().catch(error=>{console.error(error);process.exitCode=1;});
