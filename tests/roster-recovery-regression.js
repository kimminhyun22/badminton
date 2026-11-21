'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const code=fs.readFileSync('js/roster-recovery.js','utf8');
const core=require('../js/roster-recovery');
const member={name:'E2E가',gender:'여',grade:'E',level:1.8,skillStep:4,isClubOfficial:true};
const incoming={_lvVersion:2,clubs:[{id:'restored',name:'E2E클럽',members:[member]}]};
const current={_lvVersion:2,clubs:[{id:'keep-id',name:'E2E클럽',members:[]},{id:'other',name:'E2E다른클럽',members:[]}]};
const merged=core.merge(current,incoming);
assert.equal(merged.clubs.length,2);assert.equal(merged.clubs[0].id,'keep-id');
assert.equal(merged.clubs[0].members[0].skillStep,4);assert.equal(current.clubs[0].members.length,0);
assert.throws(()=>core.validate({...incoming,_lvVersion:1}));
assert.throws(()=>core.validate({...incoming,clubs:[...incoming.clubs,...incoming.clubs]}));
const map=new Map([['badminton_rosters_v1',JSON.stringify(current)]]);
const storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
const old=storage.getItem('badminton_rosters_v1');
assert.throws(()=>core.save(storage,incoming,'stale'));assert.equal(storage.getItem('badminton_rosters_v1'),old);
core.save(storage,incoming,old);assert.equal(storage.getItem('badminton_rosters_v1_before_recovery'),old);
assert.equal(JSON.parse(storage.getItem('badminton_rosters_v1')).clubs[0].members[0].level,1.8);
const broken={getItem:()=>old,setItem:()=>{throw Error('quota');}};
assert.throws(()=>core.save(broken,incoming,old),/quota/);
const sandbox={module:{exports:{}}};vm.runInNewContext(code.replace("if(raw!==expected)throw Error('명부가 변경됐습니다. 다시 확인해 주세요.');",''),sandbox);
assert.doesNotThrow(()=>sandbox.module.exports.save(storage,incoming,'stale'),'mutation removes concurrency guard');
assert(code.includes('crypto.subtle.decrypt'));assert(code.includes("history.replaceState"));
for(const file of ['index.html','team.html'])assert(fs.readFileSync(file,'utf8').includes('openRosterRecovery()'));
console.log('roster recovery: validation, merge, adjustment/role preservation, local backup, stale/failed writes and mutation passed');
async function changedLink(source){
  const input={},status={},button={},close={},dialog={
    style:{},querySelector:s=>({input,'[role=status]':status,'[data-read]':button,'[data-close]':close}[s]),
    showModal(){},close(){this.onclose();},remove(){}
  };
  const document={createElement:()=>dialog,body:{append(){}}};
  const origin='https://example.test',local=new Map(),reads=[],expiry=Date.now()+60000;
  const pack=name=>({ok:true,json:async()=>({kind:'roster-recovery',expiresAt:expiry,
    iv:'AA',ciphertext:Buffer.from(JSON.stringify({expiresAt:expiry,roster:{_lvVersion:2,clubs:[{id:name,name,members:[member]}]}})).toString('base64')})});
  const context={window:{document},document,location:{origin,hash:''},URL,AbortController,atob,Uint8Array,TextDecoder,
    fetch:()=>new Promise(resolve=>reads.push(resolve)),crypto:{subtle:{importKey:async()=>({}),decrypt:async(_,__,bytes)=>bytes}},
    localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v)}};
  vm.runInNewContext(source,context);context.window.openRosterRecovery();
  input.value=origin+'/badminton/#roster-recovery=rsvp_AAAAAAAAAAAA.'+'A'.repeat(43);input.oninput();
  const first=button.onclick();
  input.value=input.value.replace('rsvp_A','rsvp_B');input.oninput();const second=button.onclick();
  reads[1](pack('E2E신규'));await second;
  reads[0](pack('E2E이전'));await first;
  assert(status.textContent.includes('E2E신규')&&!status.textContent.includes('E2E이전'),'new link owns the preview');
  assert.equal(local.size,0,'read is a preview');
  await button.onclick();
  assert.deepEqual(JSON.parse(local.get('badminton_rosters_v1')).clubs.map(c=>c.name),['E2E신규']);
}
(async()=>{
  await changedLink(code);
  const mutation=code.replace('if(request.signal.aborted)return;\n        incoming=validate','incoming=validate');
  assert.notEqual(code,mutation);await assert.rejects(changedLink(mutation),/new link owns the preview/);
  console.log('recovery link replacement: latest preview only, confirmed local save and mutation passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
