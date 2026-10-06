'use strict';
// Retain a live reference during CAS. An initial null callback can be an empty SDK cache,
// not evidence that a UID workspace or live game was deleted.
async function transaction(ref,update){
 const listener=()=>{};if(ref.on)ref.on('value',listener);
 try{
  for(let attempt=0;attempt<2;attempt++){
   const observed=(await ref.once('value')).val();let error,sawEmptyCache=false;
   const result=await ref.transaction(current=>{
    if(current==null&&observed!=null){sawEmptyCache=true;return;}
    try{error=null;return update(current);}catch(e){error=e;return;}
   },undefined,false);
   if(sawEmptyCache&&!result.committed)continue;
   if(error)throw error;
   if(result.committed)return result.snapshot.val();
   break;
  }
  throw Object.assign(Error('다른 변경이 먼저 저장되었습니다. 최신 상태를 확인해 주세요.'),{code:'aborted'});
 }finally{if(ref.off)ref.off('value',listener);}
}
module.exports={transaction};
