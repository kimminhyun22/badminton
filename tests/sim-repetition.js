'use strict';
// 32명 · 3시간(15분×12파동) 자동 운영 시뮬레이션.
// 목적: "중복 상대·파트너가 많다"는 현장 컴플레인이 실제로 어느 정도인지 재고,
// 무작위 배정 기준선과 비교해 적정한지 판정한다.
// 개입(수동 편성·순서 변경 등)은 넣지 않는다 — 엔진의 순수 자동 성능을 본다.
const crypto = require('crypto');
const path = require('path');
const REPO = '/Users/gimminhyeon/Documents/Codex/2026-06-09/new-chat-2/badminton';
const {canonicalJson, issueOfficialGrant, refreshEvent} = require(path.join(REPO,'functions/daily-official-engine'));
const {replenishPrepared} = require(path.join(REPO,'functions/daily-server-matchmaker'));
const {applyCommandTransaction} = require(path.join(REPO,'functions/daily-official-command'));

const BASE_NOW = 1_830_000_000_000;
const MATCH_MIN = 15;
const COURTS = parseInt(process.argv[2]||'4',10);
const HEADCOUNT = parseInt(process.env.HEADCOUNT||'32',10);
const WAVES  = parseInt(process.argv[3]||'12',10);
const CHECKIN_ID='DSIM32', CLIENT_ID='sim32_client';
const SECRET='sim32-secret-string-at-least-32-bytes!!';
const ACTOR='운영임원';

// 28명 시뮬과 같은 방식: 클럽 실분포의 성별·급수 비율을 유지한 32명.
// 남20/여12, S1 A5 B6 C9 D10 E1.
const FEMALES=Math.round(HEADCOUNT*12/32);
const ROSTER=[];
(function build(){
  // 인원 수에 맞춰 급수 비율(S1 A5 B6 C9 D10 E1 = 32명)을 축소합니다.
  const base=[['S',1],['A',5],['B',6],['C',9],['D',10],['E',1]];
  const scale=HEADCOUNT/32;
  const spec=base.map(([g,n])=>[g,Math.max(g==='S'||g==='E'?(HEADCOUNT>=25?1:0):1,Math.round(n*scale))]);
  while(spec.reduce((a,[,n])=>a+n,0)>HEADCOUNT){const t=spec.slice().sort((a,b)=>b[1]-a[1])[0];t[1]--;}
  while(spec.reduce((a,[,n])=>a+n,0)<HEADCOUNT){const t=spec.find(([g])=>g==='C');t[1]++;}
  let i=0, female=0;
  spec.forEach(([grade,n])=>{
    for(let k=0;k<n;k++){
      i++;
      // 여성 12명을 급수 전반에 고르게 흩뿌립니다(상위권 여성 포함).
      const gender=(female<FEMALES && i%3===1)?'F':'M';
      if(gender==='F')female++;
      ROSTER.push([`${grade}${String(i).padStart(2,'0')}`,gender,grade]);
    }
  });
  // 부족분은 C·D에서 여성으로 채워 남20/여12를 맞춥니다.
  for(let j=0;female<FEMALES&&j<ROSTER.length;j++){
    if(ROSTER[j][1]==='M'&&['C','D'].includes(ROSTER[j][2])){ROSTER[j][1]='F';female++;}
  }
  ROSTER[5][0]=ACTOR;   // 임원 한 명
})();
const GRADE_LEVEL={S:7,A:6,B:5,C:4,D:3,E:2};
// 나이대 다양성 스위치: 실제 명부는 나이대가 섞여 있어 유효 실력이 더 흩어집니다.
const AGES=process.argv[4]==='mixed'?['20대','30대','40대','50대','60대+']:['40대'];
const hash=v=>crypto.createHash('sha256').update(canonicalJson(v)).digest('hex');

function buildContext(){
  const players=ROSTER.map(([name,gender,grade],i)=>({
    id:'p'+String(i+1).padStart(2,'0'), memberId:'m'+i, name, gender, grade,
    level:Math.max(1,GRADE_LEVEL[grade]-(gender==='F'?1:0)), ageGroup:AGES[i%AGES.length], isGuest:false,
    status:'wait',statusLabel:'wait',preArrivalVisible:false,registrationCancelled:false,
    locked:false,currentMatchId:'',afterMatchStatus:'',games:0,fairExpected:0,
    mixedGames:0,typeTrackedGames:0,lastPlayedSeq:0,
    partnerCount:{},opponentCount:{},partnerCountById:{},opponentCountById:{},
    joinedAt:BASE_NOW,waitFrom:BASE_NOW,lastStatusAt:BASE_NOW-1000,restPausedMs:0,
    isClubOfficial:name===ACTOR,isTemporaryOfficial:false
  }));
  const actor=players.find(p=>p.name===ACTOR);
  const grant=issueOfficialGrant({v:1,sid:CHECKIN_ID,cid:CLIENT_ID,pid:actor.id,
    iat:BASE_NOW-1000,exp:BASE_NOW+48*3600_000},SECRET);
  const state={session:{
    serverSessionId:CHECKIN_ID,commandProtocol:2,serverRevision:0,matchStartedAt:BASE_NOW,
    expiresAt:BASE_NOW+48*3600_000,
    officialInvite:{tokenHash:'a'.repeat(64),expiresAt:BASE_NOW+48*3600_000},
    capabilities:{officialOpsServerV2:true,officialAutoHandoffV1:true,memberStatusServerV1:true},
    players,reservations:[],arrivalCandidates:[],
    serverRuntime:{holds:{},nextSeq:1,fourCounts:{},exactCounts:{}},
    event:{courts:COURTS,nextTarget:COURTS,serverExpectedGoal:0,completed:0,finishMode:false,
      operationStarted:true,queuePolicy:{official:COURTS,auto:true},
      active:[],next:[],expected:[],serverStandby:[]}
  },officialClaims:{[CLIENT_ID]:{clientId:CLIENT_ID,expiresAt:BASE_NOW+48*3600_000,
    claimMode:'roster',officialPlayerId:actor.id}}};
  return {actorId:actor.id,grant,operationIndex:0,state,matches:[]};
}
function submit(ctx,extra,now,label){
  const operationId=`sim_${label}_${String(ctx.operationIndex++).padStart(5,'0')}`;
  const stored={actorPlayerId:ctx.actorId,actorPlayerName:ACTOR,createdAt:now,
    expiresAt:now+30*60_000,source:'sim32',operationId,...extra};
  const outcome=applyCommandTransaction(ctx.state,{
    storedCommand:stored,engineCommand:{...stored,officialGrantToken:ctx.grant},
    operationId,payloadHash:hash(stored),clientId:CLIENT_ID,grantPlayerId:ctx.actorId,
    now,checkinId:CHECKIN_ID,grantSecret:SECRET});
  if(outcome.action!=='commit'||outcome.terminal.status!=='applied'){
    return {ok:false,reason:outcome.terminal?.reason||outcome.failureMessage||outcome.action};
  }
  ctx.state=outcome.current;
  return {ok:true};
}
const S=ctx=>ctx.state.session;

// ── 진행 ──────────────────────────────────────────────────────────────
const ctx=buildContext();
replenishPrepared(S(ctx),{now:BASE_NOW,requestId:'init'});
refreshEvent(S(ctx),BASE_NOW);
for(let i=0;i<COURTS;i++){
  refreshEvent(S(ctx),BASE_NOW);
  const item=S(ctx).event.next.find(r=>r.cueState==='free'&&r.targetCourt);
  if(!item)break;
  submit(ctx,{type:'official-queue-enter-free',token:`init_${i}`,queueId:item.queueId||item.id,
    court:item.targetCourt,newMatchId:`init_m${i}`,
    expectedQueueIndex:S(ctx).event.next.indexOf(item)+1,
    expectedHoldId:item.targetHoldId||'',
    expectedPlayerIds:[...item.playerIds],
    expectedTeam1Ids:[...item.t1Ids],expectedTeam2Ids:[...item.t2Ids]},BASE_NOW,`init_${i}`);
}
for(let wave=1;wave<=WAVES;wave++){
  const now=BASE_NOW+wave*MATCH_MIN*60_000;
  const final=wave===WAVES;
  if(final)S(ctx).event.finishMode=true;
  const matches=S(ctx).event.active.slice().sort((a,b)=>a.court-b.court);
  if(!final&&wave>1&&matches.length<COURTS)ctx.idle=(ctx.idle||0)+(COURTS-matches.length);
  for(const m of matches){
    ctx.matches.push({wave,t1:[...m.t1Ids],t2:[...m.t2Ids]});
    submit(ctx,{type:'official-court-complete',token:`c_${wave}_${m.court}`,matchId:m.id,
      court:m.court,expectedStartedAt:m.startedAt,expectedPlayerIds:[...m.playerIds]},
      now,`done_w${wave}_c${m.court}`);
  }
}

// ── 집계 ──────────────────────────────────────────────────────────────
const players=S(ctx).players;
const nameOf=id=>players.find(p=>p.id===id)?.name||id;
const partner=new Map(), opponent=new Map(), games=new Map();
const key=(a,b)=>[a,b].sort().join('|');
const bump=(map,k)=>map.set(k,(map.get(k)||0)+1);
ctx.matches.forEach(m=>{
  [...m.t1,...m.t2].forEach(id=>bump(games,id));
  bump(partner,key(m.t1[0],m.t1[1]));
  bump(partner,key(m.t2[0],m.t2[1]));
  m.t1.forEach(a=>m.t2.forEach(b=>bump(opponent,key(a,b))));
});
const g=[...games.values()];
const played=players.filter(p=>games.has(p.id)).length;
const hist=map=>{const h={};[...map.values()].forEach(v=>{h[v]=(h[v]||0)+1;});return h;};
const pHist=hist(partner), oHist=hist(opponent);
const pairsSeen=partner.size, oppSeen=opponent.size;
const repeatPartnerPairs=[...partner.values()].filter(v=>v>=2).length;
const repeatOppPairs=[...opponent.values()].filter(v=>v>=2).length;
// 선수 1인 기준 평균: 같은 사람과 2번 이상 만난 횟수
const perPlayerRepeat=map=>{
  const m=new Map();
  map.forEach((v,k)=>{ if(v>=2)k.split('|').forEach(id=>m.set(id,(m.get(id)||0)+1)); });
  return m;
};
const pRep=perPlayerRepeat(partner), oRep=perPlayerRepeat(opponent);
// 인당 '전체 경기 중 파트너가 반복된 경기'의 비율(운영자 2026-08-13).
// 시간 순으로 훑어 그 선수에게 '이미 뛴 적 있는 파트너'면 반복 1회로 셉니다.
const seenPartner=new Map();   // playerId -> Set(partnerId)
const repeatGames=new Map();   // playerId -> 반복 경기 수
ctx.matches.forEach(m=>{
  [[m.t1[0],m.t1[1]],[m.t1[1],m.t1[0]],[m.t2[0],m.t2[1]],[m.t2[1],m.t2[0]]].forEach(([me,mate])=>{
    if(!seenPartner.has(me))seenPartner.set(me,new Set());
    const set=seenPartner.get(me);
    if(set.has(mate))repeatGames.set(me,(repeatGames.get(me)||0)+1);
    else set.add(mate);
  });
});
const rateRows=players.map(p=>({name:p.name,g:games.get(p.id)||0,r:repeatGames.get(p.id)||0}))
  .filter(r=>r.g>0);
const totalG=rateRows.reduce((a,r)=>a+r.g,0), totalR=rateRows.reduce((a,r)=>a+r.r,0);
const worstRate=rateRows.slice().sort((a,b)=>(b.r/b.g)-(a.r/a.g)||b.r-a.r).slice(0,3);
const avg=a=>a.length?(a.reduce((x,y)=>x+y,0)/a.length):0;
const perP=players.map(p=>pRep.get(p.id)||0), perO=players.map(p=>oRep.get(p.id)||0);

// 무작위 배정 기준선(같은 경기 수일 때 기대되는 중복)
const N=players.length, gpp=avg(g);
const expPartnerRepeatPerPlayer=(gpp*(gpp-1)/2)/(N-1);
const expOppRepeatPerPlayer=((2*gpp)*(2*gpp-1)/2)/(N-1);

console.log(`\n=== ${ROSTER.length}명 · ${COURTS}코트 · ${WAVES}파동(${WAVES*MATCH_MIN}분) 자동 운영 ===`);
console.log(`빈 코트 누적 ${ctx.idle||0}회`);
console.log(`경기 수 ${ctx.matches.length} · 뛴 인원 ${played}/${N}`);
console.log(`1인 경기 수: 최소 ${Math.min(...g)} · 최대 ${Math.max(...g)} · 평균 ${gpp.toFixed(2)}`);
console.log(`\n[파트너] 서로 다른 조합 ${pairsSeen}쌍 · 2회 이상 만난 쌍 ${repeatPartnerPairs}쌍`);
console.log(`  분포(만난 횟수:쌍 수) ${JSON.stringify(pHist)}`);
console.log(`  1인당 '또 만난 파트너' 평균 ${avg(perP).toFixed(2)}명 (최대 ${Math.max(...perP)}명)`);
console.log(`  무작위 배정이면 ${expPartnerRepeatPerPlayer.toFixed(2)}명 예상`);
console.log(`\n[파트너 반복률] 전체 ${totalR}/${totalG}경기 = ${(100*totalR/totalG).toFixed(1)}%`);
console.log(`  1인당 평균 ${(totalR/rateRows.length).toFixed(2)}회 반복 / ${(totalG/rateRows.length).toFixed(2)}경기`);
console.log(`  가장 심한 선수: ${worstRate.map(r=>`${r.name} ${r.r}/${r.g}(${Math.round(100*r.r/r.g)}%)`).join(' · ')}`);
console.log(`\n[상대] 서로 다른 조합 ${oppSeen}쌍 · 2회 이상 만난 쌍 ${repeatOppPairs}쌍`);
console.log(`  분포(만난 횟수:쌍 수) ${JSON.stringify(oHist)}`);
console.log(`  1인당 '또 만난 상대' 평균 ${avg(perO).toFixed(2)}명 (최대 ${Math.max(...perO)}명)`);
console.log(`  무작위 배정이면 ${expOppRepeatPerPlayer.toFixed(2)}명 예상`);
const worstP=[...partner.entries()].filter(([,v])=>v>=3).map(([k,v])=>`${k.split('|').map(nameOf).join('+')}×${v}`);
const worstO=[...opponent.entries()].filter(([,v])=>v>=3).map(([k,v])=>`${k.split('|').map(nameOf).join(' vs ')}×${v}`);
if(worstP.length)console.log(`\n  파트너 3회 이상: ${worstP.join(', ')}`);
if(worstO.length)console.log(`  상대 3회 이상: ${worstO.slice(0,12).join(', ')}${worstO.length>12?` 외 ${worstO.length-12}`:''}`);
