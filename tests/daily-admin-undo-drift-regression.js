'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=process.env.MINTON_ADMIN_DRIFT_ROOT||path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js/daily.js'),'utf8');
function fn(name){const start=source.indexOf('function '+name+'(');assert(start>=0,name);const end=source.slice(start+1).search(/\n(?:async )?function /);return source.slice(start,end<0?undefined:start+1+end);}
// Same waiting pool as the production E2E: 20 present, 12 playing, 8 waiting.
// Compare the actual client capacity with the actual server policy across pool sizes.
const server=fs.readFileSync(path.join(__dirname,'../functions/daily-server-matchmaker.js'),'utf8');
const start=server.indexOf('function desiredNextTarget('),end=server.indexOf('\nfunction ',start+1);
const c={number:(v,d)=>Number.isFinite(Number(v))?Number(v):d,_dailyReservations:[],_dailyEligible:()=>Array(c.waiting).fill({}),_dailyQueueTarget:()=>c.courts};
vm.createContext(c);vm.runInContext(fn('_dailyQueueCapacity')+'\n'+server.slice(start,end),c);
for(const courts of [1,2,3,4])for(let waiting=0;waiting<=36;waiting++)for(const reservation of [false,true]){
 c.courts=courts;c.waiting=waiting;c._dailyReservations=reservation?[{id:'r'}]:[];
 const s={event:{courts,queuePolicy:{official:courts}},reservations:c._dailyReservations};
 assert.equal(c._dailyQueueCapacity().target,c.desiredNextTarget(s,waiting),`capacity drift ${courts}/${waiting}/${reservation}`);
}
const players=Array.from({length:9},(_,i)=>({id:'p'+i,status:i<8?'playing':'wait'}));
const matches=[{id:'m1',team1:['p0','p1'],team2:['p2','p3']},{id:'m2',team1:['p4','p5'],team2:['p6','p7']}];
Object.assign(c,{_dailyNow:()=>100,_dailyPlayer:id=>players.find(p=>p.id===id),_dailyActiveMatches:()=>matches,_dailyQueue:[],_dailyCancelReservationsForPlayer:()=>{},_dailyMarkFourCacheDirty:()=>{},_dailyQueueIds:q=>[...q.team1,...q.team2]});
vm.runInContext(['_dailyFourKey','_dailyExactKey','_dailyMatchFourKey','_dailyMatchExactKey','_dailyApplyActiveReplaceLocal'].map(fn).join('\n'),c);
for(const m of matches){m.fourKey=c._dailyMatchFourKey(m);m.exactKey=c._dailyMatchExactKey(m);}
c._dailyApplyActiveReplaceLocal(matches[0],'p0','p8',101);
function currentKeys(m){assert.equal(c._dailyMatchFourKey(m),c._dailyFourKey([...m.team1,...m.team2].map(c._dailyPlayer)));assert.equal(c._dailyMatchExactKey(m),c._dailyExactKey(m.team1,m.team2));}
currentKeys(matches[0]);assert(!matches[0].fourKey.includes('p0'));
c._dailyApplyActiveReplaceLocal(matches[0],'p1','p4',102);matches.forEach(currentKeys);
assert(matches[1].fourKey.includes('p1'));assert(!matches[1].fourKey.includes('p4'));
console.log('PASS actual client/server queue capacity parity (296 cases), substitution and both swapped match history keys');
// Exercise the actual replay dispatcher: guard must include the final queueSync.
const replay={_dailyCheckinApplying:false,_dailyCheckinNeedsPublish:false,_dailyAutoAssign:true,_dailyPaused:false,_dailyServerRevision:0,_dailyServerLastRequestId:'',_dailyServerReconcileError:'',_dailyOfficialInviteHash:'hash',_dailyLastCompleteUndo:null,
 _dailyNow:()=>200,_dailyServerOperationAlreadyApplied:()=>false,_dailyPrepareServerQueueRequest:()=>true,_dailyOfficialRequestError:()=>'',_dailyApplyServerAutoEntries:()=>true,_dailyStartServerAutoEnter:()=>true,_dailyCheckinRequestRef:()=>null,
 dailyEnsureQueue:()=>{},_dailyPromoteReadyReservations:()=>{},dailySave:()=>{},dailyRender:()=>{},dailyMaybeAutoAssign:()=>{}};
replay.queue='before';replay._dailyCompleteUndoGuard=()=>replay.queue;
replay.dailyCompleteMatch=()=>{replay.queue='intermediate';replay._dailyLastCompleteUndo={token:'undo',guard:''};return true;};
replay._dailyApplyServerQueueSync=()=>{replay.queue='server-final';return true;};
replay._dailyCheckinRequests=[{type:'official-court-complete',token:'undo',serverAppliedAt:100,serverRevision:1,operationId:'complete',serverResult:{queueSync:{next:[]}}}];
vm.createContext(replay);vm.runInContext(fn('dailyProcessCheckinRequests'),replay);replay.dailyProcessCheckinRequests();
assert.equal(replay._dailyServerRevision,1);assert.equal(replay._dailyLastCompleteUndo.guard,'server-final','undo guard must follow server queue adoption');
console.log('PASS actual admin dispatcher captures undo guard after final server queue sync');
// Server replay must consume its two confirmed entries before any local queue rebuild.
const pp=Array.from({length:8},(_,i)=>({id:'s'+i,name:'E2E'+i,status:'wait',partnerCount:{},opponentCount:{}}));
const q1={id:'q1',team1:['s0','s1'],team2:['s2','s3']},q2={id:'q2',team1:['s4','s5'],team2:['s6','s7']};
const r={_dailyQueue:[q1,q2],_dailyMatches:[],_dailyReservations:[],_dailySeq:1,_dailyPointSystem:25,_dailyFinishMode:false,_dailyWaveStarts:2,_dailyTeamMode:false,_dailyTeamLocked:false,
 _dailyBlockServerSync:()=>false,_dailyBlockPaused:()=>false,_dailyNow:()=>1000,_dailyCourtAvailable:()=>true,_dailyQueueItemValid:()=>true,_dailyQueueItemStartable:()=>true,_dailyQueueRestPassActive:()=>false,_dailyReleaseCourtEntryHold:()=>{},_dailyMarkOperationStarted:()=>{},_dailyGameMinutes:()=>15,_dailyApplyFairOpportunity:()=>{},_dailyMarkFourCacheDirty:()=>{},_dailyCourtCount:()=>3,
 _dailyPlayer:id=>pp.find(p=>p.id===id),_dailyFourKey:ps=>ps.map(p=>p.id).sort().join('|'),
 _dailyQueueMatch:q=>({team1A:pp.find(p=>p.id===q.team1[0]),team1B:pp.find(p=>p.id===q.team1[1]),team2C:pp.find(p=>p.id===q.team2[0]),team2D:pp.find(p=>p.id===q.team2[1]),type:'남복'}),
 dailyEnsureQueue:()=>{throw Error('local queue rebuild during confirmed server replay');},dailyRebuildQueue:()=>{throw Error('wave regeneration during server replay');},dailySave:()=>{throw Error('intermediate replay publish');},dailyRender:()=>{throw Error('intermediate replay render');}};
vm.createContext(r);vm.runInContext(fn('dailyStartQueueItem'),r);
assert(r.dailyStartQueueItem('q1',{syncReplay:true,silent:true,strictCourt:true,court:1,matchId:'a'}));
assert(r.dailyStartQueueItem('q2',{syncReplay:true,silent:true,strictCourt:true,court:2,matchId:'b'}));
assert.deepEqual(Array.from(r._dailyMatches,m=>m.court),[1,2]);assert.equal(r._dailyQueue.length,0);
Object.assign(r,{_dailyCheckinId:null,_dailyCaptureCompleteUndo:()=>{},_dailyConsumeDeferredStatusRequest:()=>'',_dailyNormalizeStatus:s=>s,_dailyInc:()=>{},_dailyClearQueueRestPasses:()=>{}});
vm.runInContext(fn('dailyCompleteMatch'),r);assert(r.dailyCompleteMatch('a',null,{syncReplay:true,awaitOfficialEntry:true,operationAt:2000}));
assert(pp.slice(0,4).every(p=>p.status==='wait'&&p.games===1));
console.log('PASS actual start/complete replay consumes two server entries without local regeneration or intermediate publication');
// A live follower must not independently occupy a court while a server command fills it.
const follower={_dailyPaused:false,_dailyCheckinId:'DTEST',_dailyServerRevision:15,_dailyAutoBusy:false,_dailyNaturalAutoInfo:()=>{throw Error('live admin generated an independent auto match');}};
vm.createContext(follower);vm.runInContext(fn('dailyMaybeAutoAssign'),follower);assert.equal(follower.dailyMaybeAutoAssign(),0);
let localChecked=false;follower._dailyCheckinId=null;follower._dailyNaturalAutoInfo=()=>{localChecked=true;return {auto:false}};follower.dailyEnsureQueue=()=>{};assert.equal(follower.dailyMaybeAutoAssign(),0);assert(localChecked,'offline automatic path remains available');
console.log('PASS live follower cannot race server auto entry; offline flow preserved');
// Starting from an already-linked admin must use the same server operation path.
(async()=>{
 const start={_dailyCheckinId:'DTEST',_dailyServerRevision:1,_dailyBlockServerSync:()=>false,_dailyStartedPoolCount:()=>20,_dailyActiveMatches:()=>[],_dailyStartedPoolPlayers:()=>Array(20),document:{getElementById:()=>null},_dailyManualActiveDraft:{ids:[]},_dailyManualActiveRegisteredMatches:()=>[],closeDailyManualActiveModal:()=>{},_dailySendAdminCommand:async command=>{assert.equal(command.type,'official-operation-start');start.sent=true;return {ok:true}}};
 vm.createContext(start);vm.runInContext('async '+fn('dailyFinishLiveTransition'),start);await start.dailyFinishLiveTransition(true);assert(start.sent);
 console.log('PASS linked admin starts through the server command');
})().catch(e=>{console.error(e);process.exitCode=1});
