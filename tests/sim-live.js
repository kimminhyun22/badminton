'use strict';
// 실전형 시뮬레이션 (운영자 2026-08-13):
//   · 코트는 동시에 비지 않고 **순차 종료·교체**된다 (경기 길이가 코트마다 다름)
//   · 30명 신청이지만 늦게 오고 먼저 가는 사람이 있어 **상시 25~30명**
// 목적: 대기표 깊이(다음 대진 개수) 정책별로 파트너 반복률과 빈 코트를 비교해
//       적정값을 고른다.
//
//   node tests/sim-live.js [코트수] [정책] [시드]
//     정책: current(기본) | none | minus2 | fixed1
const path = require('path');
const crypto = require('crypto');
const REPO = path.join(__dirname, '..');
const {canonicalJson, issueOfficialGrant, refreshEvent} = require(path.join(REPO,'functions/daily-official-engine'));
const matchmaker = require(path.join(REPO,'functions/daily-server-matchmaker'));
const {replenishPrepared} = matchmaker;
const {applyCommandTransaction} = require(path.join(REPO,'functions/daily-official-command'));

const COURTS = parseInt(process.argv[2]||'3',10);
const POLICY = process.argv[3]||'current';
const SEED   = parseInt(process.argv[4]||'7',10);
const SESSION_MIN = 180;
const BASE_NOW = 1_830_000_000_000;
const CHECKIN_ID='DSIMLIVE', CLIENT_ID='simlive_client';
const SECRET='sim-live-secret-string-at-least-32-bytes!!';
const ACTOR='운영임원';

// 재현 가능한 난수(시드 고정) — 같은 시나리오로 정책만 바꿔 비교합니다.
let _s = SEED >>> 0;
function rnd(){ _s = (_s*1664525 + 1013904223) >>> 0; return _s / 4294967296; }
const pick = (min,max)=>min + Math.floor(rnd()*(max-min+1));

// 30명 신청 · 실분포 비율 유지(남19/여11, S1 A5 B5 C9 D9 E1)
const SPEC=[['S',1],['A',5],['B',5],['C',9],['D',9],['E',1]];
const GRADE_LEVEL={S:7,A:6,B:5,C:4,D:3,E:2};
const AGES=['20대','30대','40대','50대','60대+'];
const ROSTER=[];
(function build(){
  let i=0, female=0;
  SPEC.forEach(([grade,n])=>{
    for(let k=0;k<n;k++){
      i++;
      const gender=(female<11 && i%3===1)?'F':'M';
      if(gender==='F')female++;
      ROSTER.push([`${grade}${String(i).padStart(2,'0')}`,gender,grade]);
    }
  });
  ROSTER[5][0]=ACTOR;
})();

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
  // 늦게 오는 5명은 '도착 전'으로 시작합니다.
  const lateIdx=[7,13,19,24,28];
  lateIdx.forEach(i=>{ if(players[i]){players[i].status='planned';players[i].statusLabel='planned';players[i].preArrivalVisible=true;} });
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
  return {actorId:actor.id,grant,operationIndex:0,state,matches:[],idle:0,queueLens:[],
    lateIdx,leftIds:new Set()};
}
function submit(ctx,extra,now,label){
  const operationId=`live_${label}_${String(ctx.operationIndex++).padStart(5,'0')}`;
  const stored={actorPlayerId:ctx.actorId,actorPlayerName:ACTOR,createdAt:now,
    expiresAt:now+30*60_000,source:'sim-live',operationId,...extra};
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

function enterFreeCourts(ctx,now,tag){
  // 빈 코트가 있으면 준비된 대진을 넣습니다. 없으면 '빈 코트'로 셉니다.
  for(let guard=0; guard<COURTS+2; guard++){
    refreshEvent(S(ctx),now);
    const busy=new Set(S(ctx).event.active.map(m=>Number(m.court)));
    const freeCourt=[...Array(COURTS)].map((_,i)=>i+1).find(c=>!busy.has(c));
    if(!freeCourt)return;
    const item=S(ctx).event.next.find(r=>r.cueState==='free'&&r.targetCourt);
    if(!item){ ctx.idle++; return; }
    const ok=submit(ctx,{type:'official-queue-enter-free',token:`e_${tag}_${guard}`,
      queueId:item.queueId||item.id,court:item.targetCourt,newMatchId:`m_${tag}_${guard}`,
      expectedQueueIndex:S(ctx).event.next.indexOf(item)+1,
      expectedHoldId:item.targetHoldId||'',
      expectedPlayerIds:[...item.playerIds],
      expectedTeam1Ids:[...item.t1Ids],expectedTeam2Ids:[...item.t2Ids]},now,`enter_${tag}_${guard}`);
    if(!ok.ok){ ctx.idle++; return; }
  }
}

// ── 진행: 코트별로 끝나는 시각이 다른 순차 교체 ───────────────────────────
const ctx=buildContext();
replenishPrepared(S(ctx),{now:BASE_NOW,requestId:'init'});
enterFreeCourts(ctx,BASE_NOW,'init');
// 코트별 종료 예정(분) — 13~17분으로 흩어 순차 종료를 만듭니다.
const endAt=new Map();
S(ctx).event.active.forEach(m=>endAt.set(String(m.id), pick(12,17)));
// 늦게 오는 사람의 도착 시각, 먼저 가는 사람의 귀가 시각
const arriveAt=ctx.lateIdx.map(()=>pick(10,55));
const leavers=[3,11,17].map(i=>({idx:i, at:pick(105,155)}));

let clock=0, step=0;
while(clock < SESSION_MIN){
  // 가장 먼저 끝나는 코트로 시계를 옮깁니다.
  const actives=S(ctx).event.active;
  if(!actives.length){ clock+=5; enterFreeCourts(ctx,BASE_NOW+clock*60_000,`t${step++}`); continue; }
  let soonest=null;
  actives.forEach(m=>{
    const t=endAt.get(String(m.id));
    if(t==null)return;
    if(!soonest||t<soonest.t)soonest={m,t};
  });
  if(!soonest)break;
  clock=soonest.t;
  if(clock>=SESSION_MIN)break;
  const now=BASE_NOW+clock*60_000;

  // 이 시점에 도착·귀가 처리
  ctx.lateIdx.forEach((pi,k)=>{
    if(arriveAt[k]!=null && clock>=arriveAt[k]){
      const p=S(ctx).players[pi];
      if(p&&['planned','invited'].includes(p.status)){
        submit(ctx,{type:'official-player-arrival',playerId:p.id,
          candidateKey:`player:${p.id}`,status:'wait'},now,`arrive_${k}`);
      }
      arriveAt[k]=null;
    }
  });
  leavers.forEach(l=>{
    if(l.at!=null && clock>=l.at){
      const p=S(ctx).players[l.idx];
      if(p&&p.status==='wait'&&!p.currentMatchId){
        submit(ctx,{type:'official-player-status',playerId:p.id,status:'done',
          expectedStatus:p.status,expectedCurrentMatchId:'',
          expectedLastStatusAt:p.lastStatusAt},now,`leave_${l.idx}`);
        ctx.leftIds.add(p.id);
        l.at=null;
      }
    }
  });

  // 그 코트만 종료 → 교체
  const m=soonest.m;
  ctx.matches.push({at:clock,t1:[...m.t1Ids],t2:[...m.t2Ids]});
  const live=S(ctx).players.filter(p=>['wait','playing'].includes(p.status)||p.currentMatchId).length;
  ctx.queueLens.push({at:clock,live,queue:S(ctx).event.next.length});
  endAt.delete(String(m.id));
  submit(ctx,{type:'official-court-complete',token:`c_${step}`,matchId:m.id,court:m.court,
    expectedStartedAt:m.startedAt,expectedPlayerIds:[...m.playerIds]},now,`done_${step}`);
  enterFreeCourts(ctx,now,`t${step}`);
  S(ctx).event.active.forEach(mm=>{ if(!endAt.has(String(mm.id)))endAt.set(String(mm.id), clock+pick(12,17)); });
  step++;
}

// ── 집계 ──────────────────────────────────────────────────────────────
const players=S(ctx).players;
const games=new Map(), seen=new Map(), rep=new Map();
ctx.matches.forEach(m=>{
  [...m.t1,...m.t2].forEach(id=>games.set(id,(games.get(id)||0)+1));
  [[m.t1[0],m.t1[1]],[m.t1[1],m.t1[0]],[m.t2[0],m.t2[1]],[m.t2[1],m.t2[0]]].forEach(([a,b])=>{
    if(!seen.has(a))seen.set(a,new Set());
    if(seen.get(a).has(b))rep.set(a,(rep.get(a)||0)+1); else seen.get(a).add(b);
  });
});
const rows=players.map(p=>({name:p.name,g:games.get(p.id)||0,r:rep.get(p.id)||0})).filter(r=>r.g>0);
const totalG=rows.reduce((a,r)=>a+r.g,0), totalR=rows.reduce((a,r)=>a+r.r,0);
const gv=rows.map(r=>r.g);
const liveAvg=ctx.queueLens.reduce((a,q)=>a+q.live,0)/(ctx.queueLens.length||1);
const qAvg=ctx.queueLens.reduce((a,q)=>a+q.queue,0)/(ctx.queueLens.length||1);
const worst=rows.slice().sort((a,b)=>(b.r/b.g)-(a.r/a.g)||b.r-a.r).slice(0,3);
console.log(`\n=== 실전형 · ${COURTS}코트 · ${SESSION_MIN}분 · 정책 ${POLICY} (시드 ${SEED}) ===`);
console.log(`상시 인원 평균 ${liveAvg.toFixed(1)}명 · 총 ${ctx.matches.length}경기 · 뛴 인원 ${rows.length}명`);
console.log(`다음 대진 평균 ${qAvg.toFixed(2)}개 · 빈 코트 ${ctx.idle}회`);
console.log(`1인 경기 수: 최소 ${Math.min(...gv)} · 최대 ${Math.max(...gv)} · 평균 ${(totalG/rows.length).toFixed(2)}`);
console.log(`파트너 반복률 ${totalR}/${totalG} = ${(100*totalR/totalG).toFixed(1)}%`);
console.log(`  가장 심한 선수: ${worst.map(r=>`${r.name} ${r.r}/${r.g}`).join(' · ')}`);
