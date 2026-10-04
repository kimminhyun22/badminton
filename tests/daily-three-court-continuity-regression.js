'use strict';
// Synthetic fixture only. Run the real transaction/engine; no Firebase or production data.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert'),{createRequire}=require('module');
const fixturePath=path.join(__dirname,'daily-multi-official-concurrency-regression.js');
const source=fs.readFileSync(fixturePath,'utf8').split('const orders=')[0];
const fixtureRequire=createRequire(fixturePath);
const ctx={require:name=>process.env.MINTON_CONTINUITY_FUNCTIONS&&name.startsWith('../functions/')?require(path.join(process.env.MINTON_CONTINUITY_FUNCTIONS,path.basename(name))):fixtureRequire(name),console};vm.createContext(ctx);
vm.runInContext(source+'\nthis.fixture={root,submit,completeCommand,assertInvariants,NOW,OFFICIALS,clone};',ctx);
const {root,submit,completeCommand,assertInvariants,NOW,OFFICIALS,clone}=ctx.fixture;
let checks=0;
function three(state){assert.equal(state.session.event.courts,3);assert.deepStrictEqual(Array.from(state.session.event.active,m=>m.court).sort(),[1,2,3],'each of three courts must be refilled, not merely active <= 3');assertInvariants(state.session);checks++;}
for(const order of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]){
 let s=root();const cmds=['m1','m2','m3'].map((id,i)=>completeCommand(s,id,'continuity_'+order.join('')+'_'+i,'token_'+order.join('')+'_'+i));
 order.forEach((i,step)=>{const r=submit(s,OFFICIALS[i],cmds[i],NOW+step+1000);assert.equal(r.outcome.terminal.status,'applied');s=r.state;three(s)});
}
for(const order of [[0,1],[1,0]]){
 let s=root();const cmds=[0,1].map(i=>completeCommand(s,'m1','double_'+i,'double_token_'+i));const outcomes=[];
 for(const i of order){const r=submit(s,OFFICIALS[i],cmds[i],NOW+2000+i);outcomes.push(r.outcome.terminal.status);s=r.state;three(s)}
 assert.deepStrictEqual(outcomes.sort(),['applied','rejected']);
}
{
 let s=root();const cmd=completeCommand(s,'m1','undo_seed','undo_token');let r=submit(s,OFFICIALS[0],cmd,NOW+3000);s=r.state;three(s);
 r=submit(s,OFFICIALS[0],{type:'official-court-complete-undo',operationId:'undo_step',token:'undo_token'},NOW+3001);assert.equal(r.outcome.terminal.status,'applied');s=r.state;three(s);assert(s.session.event.active.some(m=>m.id==='m1'));
 const again=completeCommand(s,'m1','after_undo_complete','after_undo_token');r=submit(s,OFFICIALS[1],again,NOW+3002);assert.equal(r.outcome.terminal.status,'applied');s=r.state;three(s);
 const duplicate=submit(s,OFFICIALS[1],again,NOW+3002);assert.equal(duplicate.outcome.action,'duplicate');three(duplicate.state);assert.equal(duplicate.state.session.serverRevision,s.session.serverRevision);
}
{
 let s=root();let r=submit(s,OFFICIALS[0],completeCommand(s,'m2','rapid_first','rapid_token'),NOW+5000);s=r.state;three(s);
 const fresh=s.session.event.active.find(m=>m.court===2);assert.notEqual(fresh.id,'m2');
 r=submit(s,OFFICIALS[1],completeCommand(s,fresh.id,'rapid_second','rapid_token_second'),NOW+8000);assert.equal(r.outcome.terminal.status,'applied');s=r.state;three(s);
}
{
 let s=root();const cancel={...completeCommand(s,'m1','explicit_cancel','cancel_token'),type:'official-court-cancel'};
 let r=submit(s,OFFICIALS[0],cancel,NOW+9000);assert.equal(r.outcome.terminal.status,'applied');s=r.state;
 assert.equal(s.session.event.courts,3);assert.equal(s.session.event.active.length,2,'explicit match cancellation deliberately holds the empty court until next operation');assert(s.session.event.next.length>0);checks++;
 r=submit(s,OFFICIALS[1],completeCommand(s,'m2','after_cancel','after_cancel_token'),NOW+9001);assert.equal(r.outcome.terminal.status,'applied');three(r.state);
}
{
 let s=root();s.session.players.filter(p=>p.status==='wait').forEach(p=>p.status='rest');s.session.players.filter(p=>['p1','p2','p3','p4'].includes(p.id)).forEach(p=>p.afterMatchStatus='done');
 const r=submit(s,OFFICIALS[0],completeCommand(s,'m1','shortage_complete','shortage_token'),NOW+4000);assert.equal(r.outcome.terminal.status,'applied');s=r.state;
 assert.equal(s.session.event.courts,3);assert.equal(s.session.event.active.length,2,'without four ready players, an empty court is legitimate');assert.equal(s.session.event.next.length,0);checks++;
 for(let i=13;i<=16;i++){
  const p=s.session.players.find(p=>p.id==='p'+i);p.level=3;p.gender='M';
  const r=submit(s,OFFICIALS[1],{type:'official-player-status',operationId:'return_'+i,playerId:p.id,playerName:p.name,status:'wait',expectedStatus:p.status,expectedCurrentMatchId:p.currentMatchId||'',expectedLastStatusAt:p.lastStatusAt},NOW+4100+i);assert.equal(r.outcome.terminal.status,'applied');s=r.state;
 }
 three(s);
}
console.log('PASS three-court continuity: '+checks+' state checks; all six finish orders, duplicate finish, undo/re-finish, rapid new-match finish, explicit cancellation, justified shortage and automatic refill');
