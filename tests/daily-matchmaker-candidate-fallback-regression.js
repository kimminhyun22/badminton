'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {applyOfficialRequest, issueOfficialGrant} = require('../functions/daily-official-engine');

const now = Date.now();
const sid = 'DPOOL001';
const secret = 'local-fake-grant-for-candidate-regression';
const officialGrantToken = issueOfficialGrant({v:1,sid,cid:'test',pid:'P01',iat:now-1000,exp:now+60000},secret);
const scripts = ['match-quality.js','daily.js'].map(file=>new vm.Script(
  fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),{filename:file}
));

function roster(count){
  return Array.from({length:count},(_,i)=>({
    id:'P'+String(i+1).padStart(2,'0'),name:'시험'+(i+1),level:4,gender:'M',
    games:0,status:'wait',waitFrom:now-60000,joinedAt:now-60000,
    isClubOfficial:i===0,partnerCount:{},opponentCount:{}
  }));
}

function browserQueue(players,reservations,teamMode){
  const storage={getItem:()=>null,setItem(){}};
  const context=vm.createContext({
    players,reservations,teamMode,localStorage:storage,sessionStorage:storage,
    window:{addEventListener(){}},navigator:{},
    document:{getElementById:id=>id==='dailyCourts'?{value:'1'}:null,addEventListener(){}}
  });
  for(const script of scripts)script.runInContext(context);
  return vm.runInContext(`
    _dailyOperationStarted=true;
    _dailyPlayers=players;_dailyReservations=reservations;_dailyTeamMode=teamMode;
    _dailyFirstStartableQueueForCourt(1);
  `,context);
}

function serverQueue(players,reservations,teamMode){
  const prep={serverSessionId:sid,commandProtocol:2,expiresAt:now+60000,
    capabilities:{officialOpsServerV2:true,officialOperationStartV1:true},
    players,reservations,event:{courts:1,active:[],next:[],operationStarted:false,teamMode}
  };
  function command(session,request){
    const result=applyOfficialRequest(session,{
      actorPlayerId:'P01',actorPlayerName:players[0].name,createdAt:now,expiresAt:now+60000,
      operationId:'test-'+request.type,commandProtocol:2,officialGrantToken,...request
    },{now,grantSecret:secret,checkinId:sid});
    assert.equal(result.status,'applied',result.reason);
    return result.session;
  }
  const published=command(prep,{type:'official-operation-start'});
  const q=published.event.next[0];
  if(!q)return null;
  const started=command(published,{
    type:'official-queue-enter-free',queueId:q.queueId,court:1,expectedHoldId:q.targetHoldId,
    expectedPlayerIds:q.playerIds,expectedTeam1Ids:q.t1Ids,expectedTeam2Ids:q.t2Ids,expectedQueueIndex:1
  });
  assert.deepEqual(started.event.active[0].playerIds,q.playerIds);
  return q;
}

for(const queue of [serverQueue,browserQueue]){
  const name=queue.name;
  const sides=roster(23);
  sides.forEach((p,i)=>p.team=i<21?'청팀':'홍팀');
  const balanced=queue(sides,[],true);
  assert.ok(balanced,name+' needs both red players, including priority 23');
  assert.deepEqual(Array.from(balanced.team2),['P22','P23']);
  assert.deepEqual(Array.from(balanced.team1),['P01','P02']);

  const crowded=roster(30);
  crowded.forEach((p,i)=>p.team=i<28?'청팀':'홍팀');
  const afterLimit=queue(crowded,[],true);
  assert.deepEqual(Array.from(afterLimit?.team2||[]),['P29','P30'],name+' must include a minority team beyond the full retry window');

  const women=roster(23);
  for(const i of [0,1,21,22])women[i].gender='F';
  const pair={id:'partner',mode:'pair',team1:['P01','P02'],createdAt:now-1000};
  const requested=queue(women,[pair],false);
  assert.equal(requested?.reservationId,'partner',name+' must find the last eligible opponent');
  assert.deepEqual(Array.from(requested.team2),['P22','P23']);

  women[22].status='rest';
  const resting=queue(women,[pair],false);
  assert.notEqual(resting?.reservationId,pair.id,name+' cannot fill a reservation with a resting opponent');
  women[22].status='wait';
  const secondPair={...pair,id:'second',team1:['P03','P23']};
  const held=queue(women,[pair,secondPair],false);
  assert.notEqual(held?.reservationId,pair.id,name+' cannot borrow another reservation’s player');

  const six=roster(6);
  six.forEach((p,i)=>p.team=i<4?'청팀':'홍팀');
  const legal=queue(six,[pair],true);
  assert.equal(legal?.reservationId,'partner',name+' queue must reach a free court');
  assert.deepEqual(Array.from(legal.team2),['P05','P06']);
  const invalid={...pair,mode:'match',team2:['P03','P04']};
  assert.equal(queue(six,[invalid],true),null,name+' must not accept a same-side opponent');

  const all=roster(23);
  const first=queue(all,[pair],false);
  assert.deepEqual(Array.from(first.team2),['P03','P04'],name+' must keep the existing priority window');
}
console.log('Daily server court entry and local queue pass truncated pool, partner request and team-side cases.');
