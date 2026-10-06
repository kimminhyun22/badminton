'use strict';
const crypto=require('crypto'),M=require('./workspace-merge');
const MAX_BYTES=1200000;
const fail=(message,code='failed-precondition')=>{const e=Error(message);e.code=code;throw e;};
function identity(auth){if(!auth?.uid||auth.token?.email_verified!==true||auth.token?.firebase?.sign_in_provider!=='google.com')fail('Google 계정으로 로그인해 주세요.','unauthenticated');return auth.uid;}
function clean(values){
 if(!values||Array.isArray(values)||typeof values!=='object')fail('저장 자료를 확인해 주세요.');
 const result={};for(const [key,value] of Object.entries(values)){if(!/^(badminton_|kokmatch_)[a-zA-Z0-9_-]{1,120}$/.test(key)||typeof value!=='string')fail('지원하지 않는 저장 항목입니다.');result[key]=value;}
 if(Object.keys(result).length>150||Buffer.byteLength(JSON.stringify(result))>MAX_BYTES)fail('저장 용량을 초과했습니다.');return result;
}
function invariant(values){
 for(const key of ['kokmatch_daily_v1','badminton_team_bracket_v7']){if(!values[key])continue;let s;try{s=JSON.parse(values[key]);}catch(e){fail('설정 자료를 읽지 못했습니다.');}
  const courts=Number(s.courts);if(!Number.isInteger(courts)||courts<1||courts>20)fail('코트 수는 1~20개입니다.');
  const ids=new Set();for(const row of s.players||s.directPlayers||[]){const id=row.id||row.memberId||row.name;if(ids.has(id))fail('같은 선수가 중복 등록되었습니다.');ids.add(id);}
 }
}
function project(doc){return doc?{revision:doc.revision,values:doc.values||{},updatedAt:doc.updatedAt||0,closedGames:Object.fromEntries(Object.entries(doc.games||{}).filter(([,v])=>v.closed).map(([k,v])=>[k,{id:v.id}])),games:Object.fromEntries(Object.entries(doc.games||{}).filter(([,v])=>!v.closed).map(([k,v])=>[k,{id:v.id,createdAt:v.createdAt}]))}:{revision:0,values:{},updatedAt:0,games:{},closedGames:{}};}
function change(old,uid,data,now){
 const doc=old?{...old,values:old.values||{},history:old.history||[],receipts:old.receipts||{}}:{owner:uid,revision:0,values:{},history:[],receipts:{}};
 if(doc.owner!==uid)fail('계정이 다릅니다.','permission-denied');
 if(!/^[a-zA-Z0-9_-]{16,100}$/.test(data.device||'')||!/^[a-zA-Z0-9_-]{16,100}$/.test(data.operationId||''))fail('요청 번호를 확인해 주세요.');
 const receiptKey=data.device+':'+data.operationId,fingerprint=crypto.createHash('sha256').update(JSON.stringify({action:data.action,values:data.values,changes:data.changes})).digest('hex');
 const prior=doc.receipts?.[receiptKey];if(prior){if(prior.fingerprint!==fingerprint)fail('중복 요청의 내용이 다릅니다.');return {doc,receipt:{...prior,conflicts:JSON.parse(prior.conflictsJSON||'[]')}};}
 let values,conflicts=[];
 if(data.action==='import'){
  if(doc.revision!==0||Object.keys(doc.values).length)fail('계정에 기존 자료가 있습니다. 자동으로 덮어쓰지 않습니다.','aborted');values=clean(data.values);
 }else if(data.action==='patch'){
  const ops=data.changes;M.validate(ops);
  // Published game state is authoritative in its game transaction, never in a cache patch.
  for(const op of ops){const mode=op.path[0]==='kokmatch_daily_v1'?'daily':op.path[0]==='badminton_team_bracket_v7'?'team':null;if(mode&&doc.games?.[mode]&&!doc.games[mode].closed)fail('진행 중인 경기는 경기 명령으로 변경해 주세요.','failed-precondition');}
  const result=M.apply(M.decode(doc.values),ops);conflicts=result.conflicts;values=clean(M.encode(result.doc,doc.values,now));
 }else fail('지원하지 않는 요청입니다.');
 invariant(values);
 const changed=data.action==='import'||!M.same(M.decode(values),M.decode(doc.values));
 const revision=doc.revision+(changed?1:0),receipt={fingerprint,status:conflicts.length?'conflict':'applied',revision,conflicts,at:now};
 const receipts={...(doc.receipts||{}),[receiptKey]:{...receipt,conflictsJSON:JSON.stringify(conflicts)}};delete receipts[receiptKey].conflicts;
 // Keep interleaved device receipts. Expired requests must never be replayed as new operations.
 for(const [key,r] of Object.entries(receipts))if(now-r.at>86400000)delete receipts[key];
 if(Object.keys(receipts).length>2000)fail('요청 기록이 많습니다. 잠시 후 다시 사용해 주세요.','resource-exhausted');
 return {doc:{...doc,values,revision,updatedAt:now,receipts,history:!changed?doc.history:[...(doc.history||[]),{values:doc.values,revision:doc.revision,updatedAt:doc.updatedAt||0}].slice(-3)},receipt};
}
async function handle(db,auth,data,now=Date.now()){
 const uid=identity(auth);if(!data||Buffer.byteLength(JSON.stringify(data))>MAX_BYTES+10000)fail('요청 크기를 확인해 주세요.');
 const ref=db.ref('adminWorkspaces/'+uid);
 if(data.action==='read'){const doc=(await ref.once('value')).val();if(doc&&doc.owner!==uid)fail('계정이 다릅니다.','permission-denied');const out=project(doc);if(data.sinceRevision===out.revision)delete out.values;return {...out,serverNow:now};}
 if(!Number.isFinite(data.createdAt)||data.createdAt>now+60000||now-data.createdAt>86400000)fail('오래된 요청입니다. 최신 자료를 확인해 주세요.','failed-precondition');
 let receipt;const value=await require('./workspace-transaction').transaction(ref,old=>{const next=change(old,uid,data,now);receipt=next.receipt;return next.doc;});
 return {...project(value),receipt,serverNow:now};
}
module.exports={handle,change,clean,identity,project,invariant};
