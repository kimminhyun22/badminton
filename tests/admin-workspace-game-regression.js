'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const {handle}=require('../functions/admin-workspace-game');
const W=require('../functions/admin-workspace');
const NOW=1840000000000,SECRET='e2e-local-only',device='e2e_device_00000001',other='e2e_device_00000002';
const auth=uid=>({uid,token:{email_verified:true,firebase:{sign_in_provider:'google.com'}}});
const rows=new Map(),clone=x=>JSON.parse(JSON.stringify(x)),snap=x=>({val:()=>clone(x??null)});
function valid(x){if(Array.isArray(x))return x.forEach(valid);if(x&&typeof x==='object')for(const [k,v] of Object.entries(x)){assert(!/[.$#[\]/]/.test(k),'invalid RTDB key '+k);assert.notStrictEqual(v,undefined);valid(v);}}
function rtdb(value){
 if(value===null||value===undefined)return null;
 if(Array.isArray(value)){const rows=value.map(rtdb);while(rows.length&&rows.at(-1)===null)rows.pop();return rows.length?rows:null;}
 if(typeof value==='object'){const rows=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rtdb(v)]).filter(([,v])=>v!==null));return Object.keys(rows).length?rows:null;}
 return value;
}
const db={ref(k){return {async once(){return snap(rows.get(k));},async transaction(fn){const next=fn(clone(rows.get(k)??null));if(next===undefined)return {committed:false,snapshot:snap(rows.get(k))};valid(next);rows.set(k,rtdb(clone(next)));return {committed:true,snapshot:snap(rows.get(k))};},async update(v){rows.set(k,{...rows.get(k),...v});}};}};
let seq=0;
const request=(mode,id,command,d=device)=>({action:'command',mode,id,device:d,command:{createdAt:NOW,expiresAt:NOW+1800000,operationId:'e2e_command_'+String(++seq).padStart(9,'0'),...command}});
async function setup(uid){await W.handle(db,auth(uid),{action:'import',device,operationId:'e2e_import_00000001',createdAt:NOW,values:{}},NOW);}
(async()=>{
 let attempts=0;const coldRef={once:async()=>snap({owner:'cold'}),transaction:async fn=>{const next=fn(++attempts===1?null:{owner:'cold'});return {committed:next!==undefined,snapshot:snap(next||{owner:'cold'})};}};
 const warmed=await require('../functions/workspace-transaction').transaction(coldRef,old=>{assert(old);return {...old,ok:true};});assert(warmed.ok);assert.equal(attempts,2,'cold-cache null retries while preserving existing owner');
 const {authorize}=require('../functions/workspace-pilot-access');const env={MINTON_WORKSPACE_PILOT_UIDS:'A,B',MINTON_WORKSPACE_PILOT_UNTIL:new Date(NOW+1800000).toISOString(),MINTON_WORKSPACE_PILOT_RUN:'e2e_run_0001'};
 await assert.rejects(authorize(db,auth('A'),{action:'read'},'workspace',{},NOW),{code:'permission-denied'});
 await assert.rejects(authorize(db,auth('C'),{action:'read'},'workspace',env,NOW),{code:'permission-denied'});
 await assert.rejects(authorize(db,auth('A'),{action:'read'},'workspace',env,NOW+1800000),{code:'permission-denied'});
 await authorize(db,auth('A'),{action:'read'},'workspace',env,NOW);assert.equal(rows.get('adminWorkspacePilot/e2e_run_0001').calls,1);
 rows.set('adminWorkspacePilot/e2e_run_0001',{calls:1499,commands:199});await authorize(db,auth('A'),{action:'command'},'game',env,NOW);await assert.rejects(authorize(db,auth('B'),{action:'read'},'workspace',env,NOW),{code:'resource-exhausted'});assert.equal(rows.get('adminWorkspacePilot/e2e_run_0001').calls,1500);
 await setup('A');await setup('B');
 const names=Array.from({length:8},(_,i)=>'E2E'+i),state={kind:'teamLive',isTeam:false,courts:2,members:{all:names.map((n,i)=>({id:'p'+i,n,l:3,g:'M'}))},matches:[{num:1,round:1,court:1,t1:names.slice(0,2),t2:names.slice(2,4)},{num:2,round:1,court:2,t1:names.slice(4,6),t2:names.slice(6,8)}]};
 const create={action:'create',mode:'team',device,operationId:'e2e_create_00000001',revision:1,state};
 const created=await handle(db,auth('A'),create,SECRET,NOW),id=created.id;
 // Run the real viewer's subscription against the generated path and the frozen public-read pattern.
 // Checking only the authenticated owner endpoint misses anonymous member-link compatibility.
 const rules=JSON.parse(fs.readFileSync(path.join(__dirname,'../database.rules.json'),'utf8'));
 const publicPattern=vm.runInNewContext(rules.rules.live.$sessionId['.read'].match(/matches\((\/.*\/)\)/)[1]);
 const viewerSource=fs.readFileSync(path.join(__dirname,'../js/live-view.js'),'utf8');
 let memberState,memberPath;
 const viewer={URLSearchParams,location:{search:'?id='+id},localStorage:{getItem:()=>null},document:{getElementById:()=>({innerHTML:''})},FB_CONFIG:{},setInterval:()=>1,render:s=>{memberState=s;},firebase:{initializeApp:()=>({}),database:()=>({ref:k=>{memberPath=k;assert(publicPattern.test(k.slice(5)),'anonymous team link must match the frozen live read rule');return {on:(_event,cb)=>cb(snap(rows.get(k)))}}})}};
 vm.runInNewContext(viewerSource.slice(viewerSource.indexOf('const params=new URLSearchParams'),viewerSource.indexOf('/* AI 브리핑')),viewer);
 assert.equal(memberPath,'live/'+id,'member viewer must read the exact stored game path');
 assert.deepEqual(memberState.matches,state.matches,'anonymous member gets the published matches');
 assert.equal((await handle(db,auth('A'),{...create,device:other},SECRET,NOW)).id,id,'concurrent creates share one binding');
 assert(!JSON.stringify(W.project(rows.get('adminWorkspaces/A')).games).includes('seed'));
 await assert.rejects(handle(db,auth('B'),{action:'read',mode:'team',id},SECRET,NOW),{code:'permission-denied'});
 const first=request('team',id,{type:'team-official-result',matchNum:1,expectedWin:'',win:'t1'});
 const second=request('team',id,{type:'team-official-result',matchNum:2,expectedWin:'',win:'t2'},other);
 const results=await Promise.all([handle(db,auth('A'),first,SECRET,NOW+1),handle(db,auth('A'),second,SECRET,NOW+1)]);
 assert(results.every(r=>r.receipt.status==='applied'));assert.deepEqual(results[1].state.matches.map(m=>m.win),['t1','t2']);
 const duplicate=await handle(db,auth('A'),first,SECRET,NOW+2);assert.equal(duplicate.receipt.status,'applied');assert.equal(Object.keys(rows.get('live/'+id).accountOps).length,2);
 const raced=await handle(db,auth('A'),request('team',id,{type:'team-official-result',matchNum:1,expectedWin:'',win:'t2'},other),SECRET,NOW+2);assert.equal(raced.receipt.status,'rejected');assert.equal(raced.state.matches[0].win,'t1');
 await assert.rejects(handle(db,auth('A'),{...first,command:{...first.command,win:'t2'}},SECRET,NOW+2),{code:'already-exists'});
 const stale=await handle(db,auth('A'),request('team',id,{type:'team-admin-edit',state,expectedRevision:created.revision}),SECRET,NOW+2);assert.equal(stale.receipt.status,'rejected');assert.equal(stale.state.matches[1].win,'t2');
 await assert.rejects(handle(db,auth('A'),first,SECRET,NOW+86400001));
 // Execute real multi-court fixtures through the authenticated endpoint, not a copied reducer.
 const fixture=fs.readFileSync(path.join(__dirname,'daily-multi-official-concurrency-regression.js'),'utf8');
 const sandbox={require:p=>require(p.startsWith('../')?path.join(__dirname,p):p),console,Date,Buffer};vm.createContext(sandbox);vm.runInContext(fixture.slice(0,fixture.indexOf('function storedCommand'))+'\nglobalThis.fixture=root();',sandbox);
 const dailyState=clone(sandbox.fixture.session),revision=rows.get('adminWorkspaces/A').revision;
 const daily=await handle(db,auth('A'),{action:'create',mode:'daily',device,operationId:'e2e_create_daily_001',revision,state:dailyState},SECRET,NOW);
 const complete=(m,d=device)=>request('daily',daily.id,{type:'official-court-complete',matchId:m.id,court:m.court,expectedStartedAt:m.startedAt,expectedPlayerIds:m.playerIds,token:'e2e_token_'+seq},d);
 const d1=complete(daily.state.event.active[0]),d2=complete(daily.state.event.active[1],other);
 const [r1,r2]=await Promise.all([handle(db,auth('A'),d1,SECRET,NOW+3),handle(db,auth('A'),d2,SECRET,NOW+3)]);
 assert.equal(r1.receipt.status,'applied');assert.equal(r2.receipt.status,'applied');assert.equal(r2.state.completedLog.length,2);assert.equal(r2.state.event.active.length,3);
 const dAgain=await handle(db,auth('A'),d1,SECRET,NOW+4);assert.equal(dAgain.state.completedLog.length,2);
 const clash=await handle(db,auth('A'),complete(daily.state.event.active[0],other),SECRET,NOW+4);assert.equal(clash.receipt.status,'rejected');assert.equal(clash.state.completedLog.length,2);assert.equal(clash.state.event.active.length,3);
 await assert.rejects(handle(db,auth('B'),d1,SECRET,NOW+4),{code:'permission-denied'});
 const pause=await handle(db,auth('A'),request('daily',daily.id,{type:'account-pause',paused:true,expectedPaused:false,expectedPauseRevision:0}),SECRET,NOW+5);assert.equal(pause.state.event.paused,true);
 const pauseRace=await handle(db,auth('A'),request('daily',daily.id,{type:'account-pause',paused:true,expectedPaused:false,expectedPauseRevision:0},other),SECRET,NOW+6);assert.equal(pauseRace.receipt.status,'rejected');
 const resume=await handle(db,auth('A'),request('daily',daily.id,{type:'account-pause',paused:false,expectedPaused:true,expectedPauseRevision:1}),SECRET,NOW+1005);assert.equal(resume.state.event.paused,false);assert.equal(resume.state.event.pauseRevision,2);
 const closeRequest=request('daily',daily.id,{type:'account-close',expectedRevision:resume.revision});const closed=await handle(db,auth('A'),closeRequest,SECRET,NOW+1006);assert(closed.closed);assert(!closed.games.daily);assert.equal(closed.state.completedLog.length,2);assert(!rows.get('live/checkin_'+daily.id).session,'closed member link has no roster');
 const repeatedClose=await handle(db,auth('A'),closeRequest,SECRET,NOW+1007);assert.equal(repeatedClose.receipt.status,'applied');assert.equal(repeatedClose.state.completedLog.length,2);assert.equal(Object.keys(rows.get('adminWorkspaces/A').gameArchives).length,1);
 const reopened=await handle(db,auth('A'),{action:'create',mode:'daily',device,operationId:'e2e_new_day_0000001',revision:rows.get('adminWorkspaces/A').revision,state:dailyState},SECRET,NOW+1008);assert.notEqual(reopened.id,daily.id);assert(!rows.get('live/checkin_'+daily.id).session);
 console.log('account game endpoint: UID binding, concurrent create, independent court results, same-game conflicts, receipt replay, stale snapshot block, expiry, real daily engine completion/3 courts PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
