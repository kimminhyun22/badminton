/* Pure field-level reconciliation, shared by the callable and browser. */
(function(root){
'use strict';
const clone=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const collections=new Set(['clubs','members','players','directPlayers','participants']);
const volatile=new Set(['savedAt','clientStateRevision','checkinNeedsPublish']);
function key(row){return row&&typeof row==='object'?(row.id?'id:'+row.id:row.memberId?'member:'+row.memberId:row.name?'name:'+row.name:null):null;}
function pack(v,field='',depth=0){
 if(Array.isArray(v)&&collections.has(field)&&v.every(row=>key(row))&&new Set(v.map(key)).size===v.length)return {$list:true,$rows:Object.fromEntries(v.map((row,i)=>[key(row),{$position:i,$value:pack(row,'',depth+1)}]))};
 if(Array.isArray(v))return v.map(x=>pack(x,'',depth+1));
 if(object(v))return Object.fromEntries(Object.entries(v).filter(([k])=>depth!==0||!volatile.has(k)).map(([k,x])=>[k,pack(x,k,depth+1)]));
 return v;
}
function unpack(v){
 if(object(v)&&v.$list===true&&object(v.$rows))return Object.entries(v.$rows).sort((a,b)=>(a[1].$position-b[1].$position)||a[0].localeCompare(b[0])).map(([,x])=>unpack(x.$value));
 if(Array.isArray(v))return v.map(unpack);
 return object(v)?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,unpack(x)])):v;
}
function decode(values){const out={};for(const [k,v] of Object.entries(values||{})){try{out[k]={json:pack(JSON.parse(v))};}catch(e){out[k]={text:v};}}return out;}
function encode(doc,old={},now=Date.now()){
 const out={};for(const [k,v] of Object.entries(doc||{})){if(Object.hasOwn(v,'text'))out[k]=v.text;else{const data=unpack(v.json);if(['kokmatch_daily_v1','badminton_team_bracket_v7','badminton_bracket_v7'].includes(k)&&object(data))data.savedAt=now;out[k]=JSON.stringify(data);}}
 return out;
}
const missing={present:false};
function at(doc,path){let value=doc;for(const k of path){if(!object(value)||!Object.hasOwn(value,k))return missing;value=value[k];}return {present:true,value};}
function put(doc,path,value){if(path.some(k=>['__proto__','constructor','prototype'].includes(k)))throw Error('잘못된 경로입니다.');let node=doc;for(const k of path.slice(0,-1)){if(!object(node[k]))node[k]={};node=node[k];}if(value.present)node[path.at(-1)]=clone(value.value);else delete node[path.at(-1)];}
function bracketShape(state,key){
 const s=state?.json||{};
 if(key==='kokmatch_daily_v1')return s.matches||[];
 const sides=s.teamAssignment||{};
 return {matches:(s.matches||[]).map(m=>[m.matchNumber,m.round,m.court,m.team1A?.name,m.team1B?.name,m.team2C?.name,m.team2D?.name]),blue:(sides.blue||[]).map(p=>p.name).sort(),white:(sides.white||[]).map(p=>p.name).sort()};
}
function diff(base,next,path=[]){
 if(same(base,next))return [];
 // A generated bracket depends on the entire setup it was computed from.
 // Keep independent form fields mergeable, but never attach an old bracket to new participants.
 if(path.length===1&&['badminton_team_bracket_v7','kokmatch_daily_v1'].includes(path[0])&&base?.json&&next?.json&&!same(bracketShape(base,path[0]),bracketShape(next,path[0])))return [{path,before:{present:true,value:clone(base)},after:{present:true,value:clone(next)},derived:true}];
 if(object(base)&&object(next)){
  const changes=[];
  for(const k of new Set([...Object.keys(base),...Object.keys(next)])){
   if(k==='$position'&&Object.hasOwn(base,k)&&Object.hasOwn(next,k))continue;
   if(!Object.hasOwn(base,k)||!Object.hasOwn(next,k))changes.push({path:[...path,k],before:Object.hasOwn(base,k)?{present:true,value:clone(base[k])}:missing,after:Object.hasOwn(next,k)?{present:true,value:clone(next[k])}:missing});
   else changes.push(...diff(base[k],next[k],[...path,k]));
  }return changes;
 }
 return [{path,before:{present:true,value:clone(base)},after:{present:true,value:clone(next)}}];
}
function validate(ops){
 if(!Array.isArray(ops)||ops.length>1500)throw Error('변경 항목 수를 확인해 주세요.');
 for(const op of ops)if(!op||!Array.isArray(op.path)||!op.path.length||op.path.length>24||op.path.some(k=>typeof k!=='string'||k.length>200||['__proto__','constructor','prototype'].includes(k))||typeof op.before?.present!=='boolean'||typeof op.after?.present!=='boolean'||(op.before.present&&!Object.hasOwn(op.before,'value'))||(op.after.present&&!Object.hasOwn(op.after,'value')))throw Error('변경 요청 형식이 잘못되었습니다.');
}
function apply(doc,ops){
 validate(ops);const next=clone(doc),conflicts=[];
 for(const op of ops){const current=at(doc,op.path);if(!same(current,op.before)&&!same(current,op.after))conflicts.push({...op,current});else put(next,op.path,op.after);}
 return {doc:next,conflicts};
}
function rebase(base,local,remote){
 const edits=diff(base,local),next=clone(remote),conflicts=[];
 for(let op of edits){
  // A deleted parent must not reappear as a malformed fragment of a player/club.
  for(let n=1;n<op.path.length;n++){const parent=op.path.slice(0,n);if(!at(remote,parent).present&&at(base,parent).present){op={path:parent,before:at(base,parent),after:at(local,parent)};break;}}
  if(conflicts.some(row=>same(row.path,op.path)))continue;
  const current=at(remote,op.path);if(!same(current,op.before)&&!same(current,op.after))conflicts.push({...op,current});put(next,op.path,op.after);
 }
 return {doc:next,conflicts};
}
const api={clone,same,decode,encode,diff,apply,rebase,at,put,validate,pack,unpack};if(typeof module==='object'&&module.exports)module.exports=api;else root.MintonWorkspaceMerge=api;
})(typeof window==='undefined'?globalThis:window);
