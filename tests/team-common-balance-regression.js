'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js/team.js'),'utf8');
const policy=fs.readFileSync(path.join(root,'js/match-quality.js'),'utf8');
const server=require('../functions/daily-server-matchmaker');
const cut=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)+start.length));
function build(shared){
 const ctx={};vm.createContext(ctx);
 if(shared)vm.runInContext(policy,ctx);
 vm.runInContext(source.split('let _currentRound=1;')[0]+cut('function _matchGenderErrorCount(', 'function _matchStructureErrorCount(')+cut('function formTeams(', '\nfunction updatePlayerRecords'),ctx);
 return ctx;
}
const player=(level,i)=>({id:String(i),name:'E2E'+i,level,gender:'M',ageGroup:'20대',team:i<2?'청팀':'홍팀',partnerCount:{},opponentCount:{}});
for(const shared of [true,false]){
 const ctx=build(shared);
 for(let a=0;a<=7;a+=.5)for(let b=0;b<=7;b+=.5)for(const [c,d] of [[2,2],[3,5],[.3,3.3]]){
  const ps=[a,b,c,d].map(player);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx._teamPairBalance(ps.slice(0,2),ps.slice(2)))),server.pairBalance(ps.slice(0,2),ps.slice(2)));
 }
 const ps=[.3,3.3,2.8,2].map(player);
 assert.equal(ctx.formTeams(ps,true,'men',2),null,'청홍 고정 팀의 복합 열세를 일반 대진에서 거절');
 assert.equal(ctx.formTeams(ps,false,'men',2),null,'자유 대진에서도 같은 불균형 기준 사용');
 const fallback=ctx.formTeams(ps,true,'men',99);
 assert(fallback,'고정 팀에서 불가피한 경기는 출전 누락 대신 경고');
 assert.equal(ctx._balanceQualityStats([fallback]).hardCount,1,'품질점검에서 보정 기준 위반을 숨기지 않음');
 assert.equal(ctx._balanceQualityStats([fallback]).maxLD,1.97);
 const safe=[1,4,2,2].map(player);
 assert(ctx.formTeams(safe,true,'men',2),'합산 우세로 파트너 격차가 상쇄되는 후보 유지');
}
const ctx=build(true);
assert.equal(ctx.KokMatchQuality.pairBalance,ctx.KokMatchQuality.dailyPairBalance,'구버전 호환 별칭도 같은 함수');
console.log('PASS shared team/daily/server balance: 1350 parity cases, fixed/free generation, unavoidable warning, fallback parity');
