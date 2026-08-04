'use strict';
/**
 * 파트너는 예약(게임신청) 한 곳에만 삽니다.
 *
 * 예전에는 관리자 화면이 선수에게 partnerName 을 직접 박고, 임원 화면은
 * session.reservations 로 접수했습니다. 두 갈래가 같은 선수를 서로 다른 짝으로
 * 잡으면 그 선수는 어느 쪽으로도 편성되지 못했습니다(2026-08-02 실측: 세 명이
 * 통째로 대진에서 빠짐). 방어 코드로 막아 두었던 그 충돌을, 갈래를 하나로
 * 합쳐서 없앴습니다.
 *
 * 여기서 지키는 것:
 *   1) 예약으로 접수한 짝은 같은 편으로 편성된다
 *   2) 낡은 세션에 partnerName 이 남아 있어도 편성을 흔들지 않는다
 *   3) 겹치지 않는 예약 둘은 둘 다 편성된다
 */
const path = require('path');
const REPO = process.env.SIM_ENGINE_ROOT || path.join(__dirname, '..');
const {refreshEvent} = require(`${REPO}/functions/daily-official-engine`);
const {replenishPrepared} = require(`${REPO}/functions/daily-server-matchmaker`);

const NOW = 1_830_000_000_000;

function player(id, name, gender, level, extra = {}){
  return {
    id, name, gender, level, ageGroup:'40대', grade:'C',
    status:'wait', statusLabel:'wait', locked:false, currentMatchId:'', afterMatchStatus:'',
    games:0, fairExpected:0, mixedGames:0, typeTrackedGames:0, lastPlayedSeq:0,
    partnerCount:{}, opponentCount:{}, partnerCountById:{}, opponentCountById:{},
    joinedAt:NOW, waitFrom:NOW, lastStatusAt:NOW-1000, restPausedMs:0,
    preArrivalVisible:false, registrationCancelled:false,
    isClubOfficial:false, isTemporaryOfficial:false, isGuest:false,
    ...extra
  };
}

function makeSession(players, reservations, courts){
  const target = courts || 1;
  return {
    serverSessionId:'DPARTNER', commandProtocol:2, serverRevision:0, matchStartedAt:NOW,
    expiresAt:NOW+48*3600_000,
    capabilities:{officialOpsServerV2:true, memberStatusServerV1:true, officialPartnerOpsV1:true},
    players, reservations:reservations||[], arrivalCandidates:[],
    serverRuntime:{holds:{}, nextSeq:1, fourCounts:{}, exactCounts:{}},
    event:{courts:target, nextTarget:target, serverExpectedGoal:0, completed:0, finishMode:false,
      operationStarted:true, queuePolicy:{official:target, auto:true},
      active:[], next:[], expected:[], serverStandby:[]}
  };
}

const assert = require('assert');

function pair(id, a, b){
  return {id, mode:'pair', team1:[a, b], team2:[], label:`${a} · ${b}`};
}

function run(label, players, reservations, courts){
  const session = makeSession(players, reservations, courts);
  replenishPrepared(session, {now:NOW, requestId:'partner_'+label});
  refreshEvent(session, NOW);
  const nameOf = id => (session.players.find(p=>p.id===id)||{}).name || id;
  const items = session.event.next || [];
  console.log(`\n【${label}】`);
  items.forEach(item=>{
    console.log(`  [${item.type}] ${(item.t1Ids||[]).map(nameOf).join('+')} vs ${(item.t2Ids||[]).map(nameOf).join('+')}`
      + (item.reservationId ? ` (신청 ${item.reservationId})` : ''));
  });
  if(!items.length)console.log('  생성된 대진 없음');
  return {session, items};
}

// 두 선수가 같은 대진의 같은 편에 들어갔는지 확인합니다.
function assertSameSide(items, a, b, label){
  const hit = items.find(item=>{
    const first = (item.t1Ids || []).map(String);
    const second = (item.t2Ids || []).map(String);
    return (first.includes(a) && first.includes(b)) || (second.includes(a) && second.includes(b));
  });
  assert(hit, `${label}: 접수한 짝이 같은 편으로 편성되지 않았습니다.`);
  return hit;
}

function assertPlaced(items, ids, label){
  const placed = new Set(items.flatMap(item=>(item.playerIds || []).map(String)));
  ids.forEach(id=>assert(placed.has(id), `${label}: ${id} 선수가 대진에서 빠졌습니다.`));
}

const base = () => [
  player('a','가선수','M',4), player('b','나선수','M',4),
  player('c','다선수','M',4), player('d','라선수','M',4),
  player('e','마선수','M',4), player('f','바선수','M',4),
  player('g','사선수','M',4), player('h','아선수','M',4)
];

// 1) 접수한 짝은 같은 편으로 붙습니다.
{
  const label = '예약으로 접수한 A+B';
  const {items} = run(label, base(), [pair('res1','a','b')]);
  assertSameSide(items, 'a', 'b', label);
  assertPlaced(items, ['a','b'], label);
}

// 2) 낡은 세션에 남은 partnerName 은 아무 힘이 없어야 합니다.
//    이 필드를 다시 읽기 시작하면 그때 예전 충돌이 되살아납니다.
{
  const label = '낡은 partnerName 이 남아 있어도 예약이 이깁니다';
  const ps = base();
  ps[0].partnerName = '나선수'; ps[0].partnerId = 'pair1';   // 예전 관리자 묶기 잔재
  ps[1].partnerName = '가선수'; ps[1].partnerId = 'pair1';
  const {items} = run(label, ps, [pair('res1','a','c')]);
  assertSameSide(items, 'a', 'c', label);
  assertPlaced(items, ['a','c'], label);
}

// 3) 겹치지 않는 예약 둘은 둘 다 편성됩니다.
{
  const label = '예약 A+B 와 C+D';
  const {items} = run(label, base(), [pair('res1','a','b'), pair('res2','c','d')], 2);
  assertSameSide(items, 'a', 'b', label);
  assertSameSide(items, 'c', 'd', label);
  assertPlaced(items, ['a','b','c','d'], label);
}

console.log('\npartner unification regression ok');
