'use strict';
/**
 * 관리자 파트너 묶기(partnerName)와 임원 파트너 접수(session.reservations)가
 * 같은 선수를 서로 다른 짝으로 잡아도 아무도 굶지 않아야 합니다.
 * 방어선이 없으면 세 명이 통째로 대진에서 빠집니다(2026-08-02 실측).
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
    partnerName:'', partnerId:'', ...extra
  };
}

function makeSession(players, reservations){
  return {
    serverSessionId:'DCONFLICT', commandProtocol:2, serverRevision:0, matchStartedAt:NOW,
    expiresAt:NOW+48*3600_000,
    capabilities:{officialOpsServerV2:true, memberStatusServerV1:true, officialPartnerOpsV1:true},
    players, reservations:reservations||[], arrivalCandidates:[],
    serverRuntime:{holds:{}, nextSeq:1, fourCounts:{}, exactCounts:{}},
    event:{courts:1, nextTarget:1, serverExpectedGoal:0, completed:0, finishMode:false,
      operationStarted:true, queuePolicy:{official:1, auto:true},
      active:[], next:[], expected:[], serverStandby:[]}
  };
}

const assert = require('assert');

function run(label, players, reservations, watch){
  const session = makeSession(players, reservations);
  replenishPrepared(session, {now:NOW, requestId:'conflict_'+label});
  refreshEvent(session, NOW);
  const nameOf = id => (session.players.find(p=>p.id===id)||{}).name || id;
  const queued = (session.event.next||[]).map(item=>
    `[${item.type}] ${(item.t1Ids||[]).map(nameOf).join('+')} vs ${(item.t2Ids||[]).map(nameOf).join('+')}`);
  const placed = new Set((session.event.next||[]).flatMap(i=>i.playerIds||[]));
  console.log(`\n【${label}】`);
  console.log(`  생성된 대진 ${queued.length}건: ${queued.join(' / ') || '없음'}`);
  watch.forEach(id=>{
    const p = session.players.find(x=>x.id===id);
    console.log(`  ${p.name}: ${placed.has(id) ? '대진에 들어감' : '★ 대진에 못 들어감'}`
      + (p.partnerName ? ` (관리자 묶임: ${p.partnerName})` : ''));
  });
  // 아무도 굶으면 안 됩니다.
  watch.forEach(id=>{
    const p = session.players.find(x=>x.id===id);
    assert(placed.has(id), `${label}: ${p.name} 선수가 대진에서 빠졌습니다. 파트너 지정/접수 충돌을 확인하세요.`);
  });
  return {session, placed};
}

const base = () => [
  player('a','가선수','M',4), player('b','나선수','M',4),
  player('c','다선수','M',4), player('d','라선수','M',4),
  player('e','마선수','M',4), player('f','바선수','M',4),
  player('g','사선수','M',4), player('h','아선수','M',4)
];

// 1) 정상: 관리자만 A+B 묶음
{
  const ps = base();
  ps[0].partnerName='나선수'; ps[0].partnerId='pair1';
  ps[1].partnerName='가선수'; ps[1].partnerId='pair1';
  run('관리자만 A+B 묶음', ps, [], ['a','b']);
}

// 2) 정상: 임원만 A+C 접수
{
  const ps = base();
  run('임원만 A+C 접수', ps, [{id:'res1', mode:'partner', team1:['a','c'], team2:[], label:'가선수 · 다선수'}], ['a','c']);
}

// 3) 충돌: 관리자 A+B 묶음 + 임원 A+C 접수
{
  const ps = base();
  ps[0].partnerName='나선수'; ps[0].partnerId='pair1';
  ps[1].partnerName='가선수'; ps[1].partnerId='pair1';
  run('★충돌★ 관리자 A+B 묶음 + 임원 A+C 접수', ps,
      [{id:'res1', mode:'partner', team1:['a','c'], team2:[], label:'가선수 · 다선수'}], ['a','b','c']);
}

// 4) 충돌: 관리자 A+B 묶음 + 임원 C+D 접수 (겹치는 선수 없음)
{
  const ps = base();
  ps[0].partnerName='나선수'; ps[0].partnerId='pair1';
  ps[1].partnerName='가선수'; ps[1].partnerId='pair1';
  run('관리자 A+B + 임원 C+D (안 겹침)', ps,
      [{id:'res1', mode:'partner', team1:['c','d'], team2:[], label:'다선수 · 라선수'}], ['a','b','c','d']);
}

console.log('\npartner conflict regression ok');
