'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const root=path.join(__dirname,'..');
const engine=require('../functions/daily-server-matchmaker');
const browser={};vm.createContext(browser);vm.runInContext(fs.readFileSync(path.join(root,'js/match-quality.js'),'utf8'),browser);
const quality=browser.KokMatchQuality;
const p=(level,id,gender='M')=>({id,name:'선수'+id,level:level+(gender==='F'?0.5:0),gender,ageGroup:'20대',status:'wait',games:0,waitFrom:1000,joinedAt:1000,partnerCount:{},opponentCount:{}});
for(let a=0;a<=7;a+=.5)for(let b=0;b<=7;b+=.5)for(const [c,d] of [[2,2],[3,5],[.3,3.3]]){
 const first=[p(a,'a'),p(b,'b')],second=[p(c,'c'),p(d,'d')];
 const server=engine.pairBalance(first,second);
 assert.deepStrictEqual(JSON.parse(JSON.stringify(quality.dailyPairBalance(first,second))),server);
 assert.deepStrictEqual(engine.pairBalance(second,first),server,'팀 방향에 따라 결과가 달라지면 안 됩니다.');
}
const four=[.3,3.3,2.8,2].map((level,i)=>p(level,String(i),'F'));
const s={players:four,event:{teamMode:false},serverRuntime:{}};
assert.equal(engine.pairBalance(four.slice(0,2),four.slice(2)).adjustedDiff,1.97);
assert.equal(engine.preparedPairing(s,['0','1'],['2','3'],{fairnessCorrection:true}),null,'보정이어도 합산 열세+파트너 격차 열세를 함께 허용하지 않습니다.');
const compensated=[p(1,'a'),p(4,'b'),p(2,'c'),p(2,'d')];
assert(engine.pairBalance(compensated.slice(0,2),compensated.slice(2)).allowed,'큰 파트너 격차를 합산 우세로 상쇄한 대진은 허용합니다.');
const levels=[6.5,1,1,1,1,1,1,1,5,5,4.5,4.5];
function fixture(manual=false){
 const players=levels.map((v,i)=>p(v,String(i)));players[0].fairExpected=2;
 const next={id:'prepared',serverGenerated:true,manualComposed:manual,t1Ids:['8','10'],t2Ids:['9','11'],playerIds:['8','10','9','11'],type:'남복'};
 return {players,event:{courts:3,operationStarted:true,active:[],next:[next],expected:[],serverStandby:[],queuePolicy:{auto:true}},serverRuntime:{},reservations:[]};
}
const rescued=fixture();engine.replenishPrepared(rescued,{now:2000,requestId:'balance-rescue'});
assert(rescued.event.next.some(q=>engine.queueIds(q).includes('0')),'희소 선수의 파트너가 자동 대기 대진에 묶이면 재탐색해야 합니다.');
assert.equal(new Set(rescued.event.next.flatMap(engine.queueIds)).size,rescued.event.next.length*4);
for(const q of rescued.event.next){
 const team=ids=>ids.map(id=>rescued.players.find(p=>p.id===id));
 assert(engine.pairBalance(team(q.t1Ids),team(q.t2Ids)).allowed);
}
for(const marker of ['manualComposed','reservationId','notifiedAt']){
 const protectedSession=fixture();protectedSession.event.next[0][marker]=marker==='reservationId'?'reservation':true;
 const original=JSON.stringify(protectedSession.event.next[0]);
 engine.replenishPrepared(protectedSession,{now:2000,requestId:'protected'});
 assert.equal(JSON.stringify(protectedSession.event.next.find(q=>q.id==='prepared')),original,'수동/신청/통보 대진은 보정 재탐색에서 유지합니다.');
}
console.log('PASS pair disadvantage: 675 parity cases, correction rejection, compensated team, scarce-player rescue, protected queue');
