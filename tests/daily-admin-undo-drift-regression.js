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
