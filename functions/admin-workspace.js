'use strict';
const crypto=require('crypto');
const MAX_BYTES=1200000,LEASE_MS=45000;
const fail=(message,code='failed-precondition')=>{const e=Error(message);e.code=code;throw e;};
function identity(auth){if(!auth?.uid||auth.token?.email_verified!==true||auth.token?.firebase?.sign_in_provider!=='google.com')fail('Google 계정으로 로그인해 주세요.','unauthenticated');return auth.uid;}
function clean(values){
  if(!values||Array.isArray(values)||typeof values!=='object')fail('저장 자료를 확인해 주세요.');
  const result={};
  for(const [key,value] of Object.entries(values)){
    if(!/^(badminton_|kokmatch_)[a-zA-Z0-9_-]{1,120}$/.test(key)||typeof value!=='string')fail('지원하지 않는 저장 항목입니다.');
    result[key]=value;
  }
  if(Object.keys(result).length>150||Buffer.byteLength(JSON.stringify(result))>MAX_BYTES)fail('저장 용량을 초과했습니다. 기기 백업을 보관해 주세요.');
  return result;
}
function change(old,uid,data,now){
  const doc=old||{owner:uid,revision:0,values:{},history:[]};
  if(doc.owner!==uid)fail('계정이 다릅니다.','permission-denied');
  if(!/^[a-zA-Z0-9_-]{16,100}$/.test(data.device||''))fail('기기 연결을 확인해 주세요.');
  const lease=doc.lease,held=lease&&lease.until>now,mine=held&&lease.device===data.device;
  if(data.action==='acquire'){
    if(doc.transfer&&doc.transfer.device!==data.device&&doc.transfer.at+90000>now)fail('다른 기기로 운영을 넘기는 중입니다.','aborted');
    if(held&&!mine)fail('다른 기기에서 운영 중입니다.','aborted');
    return {...doc,lease:{device:data.device,until:now+LEASE_MS},transfer:null};
  }
  if(data.action==='request-transfer'){
    if(!held||mine)return doc;
    return {...doc,transfer:{device:data.device,at:now}};
  }
  if(!mine)fail('다른 기기로 운영이 넘어갔습니다.','aborted');
  if(data.action==='renew')return {...doc,lease:{...lease,until:now+LEASE_MS}};
  if(data.action==='release')return {...doc,lease:null};
  if(data.action!=='save')fail('지원하지 않는 요청입니다.');
  const values=clean(data.values);
  if(!/^[a-zA-Z0-9_-]{16,100}$/.test(data.operationId||''))fail('요청 번호를 확인해 주세요.');
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify({revision:data.revision,values})).digest('hex');
  const receipt=doc.receipt;
  if(receipt?.id===data.operationId){if(receipt.fingerprint!==fingerprint)fail('중복 요청의 내용이 다릅니다.');return doc;}
  if(data.revision!==doc.revision)fail('서버에 더 최신 자료가 있습니다. 기기 자료는 백업됩니다.','aborted');
  return {...doc,values,revision:doc.revision+1,updatedAt:now,
    history:[...(doc.history||[]),{values:doc.values,revision:doc.revision,updatedAt:doc.updatedAt||0}].slice(-3),
    receipt:{id:data.operationId,fingerprint}};
}
function project(doc){return doc?{revision:doc.revision,values:doc.values,updatedAt:doc.updatedAt||0,lastOperationId:doc.receipt?.id||null,lease:doc.lease||null,transfer:doc.transfer||null}:{revision:0,values:{},lease:null,transfer:null};}
async function handle(db,auth,data,now=Date.now()){
  const uid=identity(auth);
  if(!data||Buffer.byteLength(JSON.stringify(data))>MAX_BYTES+4000)fail('요청 크기를 확인해 주세요.');
  // No caller-provided UID/path; this private subtree inherits root deny rules.
  const ref=db.ref('adminWorkspaces/'+uid);
  if(data.action==='read'){const doc=(await ref.once('value')).val();if(doc&&doc.owner!==uid)fail('계정이 다릅니다.','permission-denied');return {...project(doc),serverNow:now};}
  let error;const result=await ref.transaction(old=>{try{error=null;return change(old,uid,data,now);}catch(e){error=e;return;}});
  if(error)throw error;if(!result.committed)fail('저장하지 못했습니다. 다시 연결해 주세요.','aborted');
  const output=project(result.snapshot.val());if(data.action==='renew')delete output.values;
  return {...output,serverNow:now};
}
module.exports={handle,change,clean,identity,LEASE_MS};
