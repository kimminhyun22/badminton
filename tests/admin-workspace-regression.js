'use strict';
const assert=require('node:assert/strict');
const {handle,change,identity,LEASE_MS}=require('../functions/admin-workspace');
const C=require('../js/admin-workspace-core');
const auth=uid=>({uid,token:{email_verified:true,firebase:{sign_in_provider:'google.com'}}});
const device='device_aaaaaaaaaaaa',other='device_bbbbbbbbbbbb';
const values={'badminton_rosters_v1':JSON.stringify({clubs:[{id:'test',name:'E2E클럽',members:[]}]}),'kokmatch_daily_v1':JSON.stringify({courts:3,players:[{name:'E2E가'}],matches:[]})};
const data=new Map(),snapshot=v=>({val:()=>structuredClone(v??null)});
const db={ref(path){return {async once(){return snapshot(data.get(path));},async transaction(fn){const value=fn(structuredClone(data.get(path)??null));if(value===undefined)return {committed:false,snapshot:snapshot(data.get(path))};data.set(path,structuredClone(value));return {committed:true,snapshot:snapshot(value)};}};}};
function memory(){const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),key:i=>[...m.keys()][i]??null,get length(){return m.size}};}
(async()=>{
 assert.throws(()=>identity(null),{code:'unauthenticated'});assert.throws(()=>identity({...auth('A'),token:{email_verified:true,firebase:{sign_in_provider:'anonymous'}}}),{code:'unauthenticated'});
 assert.throws(()=>change({owner:'B'},'A',{action:'acquire',device},0),{code:'permission-denied'});
 let r=await handle(db,auth('A'),{action:'acquire',device},100);
 assert.equal(r.revision,0);
 const save={action:'save',device,revision:0,operationId:'operation_00000001',values};
 r=await handle(db,auth('A'),save,200);assert.equal(r.revision,1);
 assert.equal((await handle(db,auth('A'),save,300)).revision,1);
 await assert.rejects(handle(db,auth('A'),{...save,values:{}},300));
 assert.deepEqual((await handle(db,auth('B'),{action:'read',uid:'A'})).values,{});
 await assert.rejects(handle(db,auth('B'),save,300),{code:'aborted'});
 await assert.rejects(handle(db,auth('A'),{action:'acquire',device:other},300),{code:'aborted'});
 await handle(db,auth('A'),{action:'request-transfer',device:other},400);
 assert.equal((await handle(db,auth('A'),{action:'renew',device},500)).transfer.device,other);
 await handle(db,auth('A'),{action:'release',device},600);
 r=await handle(db,auth('A'),{action:'acquire',device:other},700);assert.deepEqual(r.values,values);
 await assert.rejects(handle(db,auth('A'),{...save,revision:1,operationId:'operation_00000002'},800),{code:'aborted'});
 const requests=[2,3].map(n=>handle(db,auth('A'),{...save,device:other,revision:1,operationId:'operation_0000000'+n,values:{...values,kokmatch_daily_v1:JSON.stringify({courts:n})}},900));
 const results=await Promise.allSettled(requests);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected')[0].reason.code,'aborted');
 await assert.rejects(handle(db,auth('A'),{action:'renew',device:other},700+LEASE_MS+1),{code:'aborted'});
 r=await handle(db,auth('A'),{action:'acquire',device},700+LEASE_MS+2);assert.equal(r.revision,2);
 assert.equal(data.get('adminWorkspaces/A').history.length,2);
 // Atomic UID caches; login/logout never modifies guest originals or member identity.
 const raw=memory();for(const [k,v] of Object.entries(values))raw.setItem(k,v);raw.setItem('kokmatch_member_identity','private-member');
 assert(!C.collect(raw).kokmatch_member_identity);
 const a=C.createStore(raw,'A'),b=C.createStore(raw,'B');a.replace(values,1);assert.equal(b.storage.getItem('kokmatch_daily_v1'),null);
 a.storage.setItem('kokmatch_daily_v1','{"courts":4}');assert.equal(raw.getItem('kokmatch_daily_v1'),values.kokmatch_daily_v1);
 a.backup('offline');a.meta({pending:save});assert.equal(C.createStore(raw,'A').read().pending.operationId,save.operationId);
 a.lock();assert.throws(()=>a.storage.setItem('kokmatch_daily_v1','lost'));assert.equal(b.storage.getItem('kokmatch_daily_v1'),null);
 assert.throws(()=>b.storage.setItem(C.PREFIX+'A','inject'));assert.equal(b.storage.getItem(C.PREFIX+'A'),null);
 assert(raw.getItem(C.PREFIX+'A:backups').includes('courts'));assert.equal(raw.getItem('badminton_rosters_v1'),values.badminton_rosters_v1);
 // Delayed UI/timer writes cannot pass after logout, timeout, or handoff.
 let allowed=true,writes=0,resolveWrite;const inflight=new Set();
 class Ref{set(){writes++;return new Promise(r=>{resolveWrite=r;});}update(){writes++;return Promise.resolve();}push(){writes++;return Promise.resolve();}}
 const functions={httpsCallable:()=>async()=>{writes++;return {};}};
 C.guardNetwork({database:{Reference:Ref},functions:()=>functions},()=>allowed,inflight);
 const ref=new Ref(),pendingWrite=ref.set({});assert.equal(inflight.size,1);allowed=false;
 await assert.rejects(ref.update({}));await assert.rejects(ref.push({}));await assert.rejects(functions.httpsCallable('game')({}));assert.equal(writes,1);
 resolveWrite();await pendingWrite;assert.equal(inflight.size,0);
 console.log('admin workspace: Google identity, UID isolation, atomic leases, handoff, stale/offline writers, CAS race, retries, history, cache backup and guest preservation PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
