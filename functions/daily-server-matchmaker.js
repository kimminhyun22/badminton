'use strict';

const crypto = require('crypto');

const PARTNER_GAP_OK = 1.25;
const PARTNER_GAP_CAUTION = 2.25;
const PARTNER_GAP_HARD = 3;
const PARTNER_GAP_CORRECTION_LIMIT = 4.5;
const PARTNER_GAP_SYMMETRY_LIMIT = 1.5;
const TEAM_DIFF_TARGET = 1.5;
const TEAM_DIFF_LIMIT = 2;
const RECENT_SOFT_MIN = 6;
const RECENT_RECOVERY_MIN = 12;
const LATE_GRACE_MIN = 5;
const LATE_PRIORITY_GAMES = 2;
const FAIR_PRIORITY_GAP = 0.75;
const FAIR_FORCE_GAP = 1;
const FAIR_CORRECTION_GAP = 1.5;
const MAX_CANDIDATES = 22;
const AGE_BONUS = Object.freeze({'20대':0,'30대':-0.2,'40대':-0.5,'50대':-1.2,'60대+':-2});

function number(value, fallback = 0){
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value){
  return String(value == null ? '' : value);
}

function status(value){
  if(value === 'lesson')return 'rest';
  if(value === 'last' || value === 'leaving')return 'done';
  return ['invited','planned','wait','playing','rest','done'].includes(value) ? value : 'wait';
}

function playerId(player){
  return text(player?.id);
}

function playerById(session, id){
  return (session.players || []).find(player=>playerId(player) === text(id)) || null;
}

function queueIds(item){
  if(Array.isArray(item?.playerIds) && item.playerIds.length)return item.playerIds.map(text).filter(Boolean);
  return [...(item?.t1Ids || item?.team1 || []), ...(item?.t2Ids || item?.team2 || [])].map(text).filter(Boolean);
}

function activeIds(match){
  if(Array.isArray(match?.playerIds) && match.playerIds.length)return match.playerIds.map(text).filter(Boolean);
  return [...(match?.t1Ids || match?.team1 || []), ...(match?.t2Ids || match?.team2 || [])].map(text).filter(Boolean);
}

function team1Ids(item){
  return (item?.t1Ids || item?.team1 || []).map(text).filter(Boolean);
}

function team2Ids(item){
  return (item?.t2Ids || item?.team2 || []).map(text).filter(Boolean);
}

function effectiveLevel(player){
  const level = number(player?.level, 4);
  const female = player?.gender === 'F' || player?.gender === '여';
  return Math.round((level - (female ? 0.5 : 0) + (AGE_BONUS[player?.ageGroup] || 0)) * 10) / 10;
}

function teamLevel(team){
  return team.reduce((sum, player)=>sum + effectiveLevel(player), 0);
}

function teamDiff(team1, team2){
  return Math.round(Math.abs(teamLevel(team1) - teamLevel(team2)) * 10) / 10;
}

function teamDiffPenalty(diff){
  const value = Math.max(0, number(diff));
  let penalty = value * 360;
  if(value > TEAM_DIFF_TARGET)penalty += (value - TEAM_DIFF_TARGET) * 1600;
  if(value > TEAM_DIFF_LIMIT)penalty += 50000 + (value - TEAM_DIFF_LIMIT) * 12000;
  return penalty;
}

function partnerGap(team){
  return team.length === 2 ? Math.abs(effectiveLevel(team[0]) - effectiveLevel(team[1])) : Infinity;
}

function partnerGapPenalty(team){
  const gap = partnerGap(team);
  if(gap <= PARTNER_GAP_OK)return 0;
  let penalty = (gap - PARTNER_GAP_OK) * 900;
  if(gap > PARTNER_GAP_CAUTION)penalty += 1200 + (gap - PARTNER_GAP_CAUTION) * 2200;
  if(gap >= PARTNER_GAP_HARD)penalty += 4200 + (gap - PARTNER_GAP_HARD) * 3200;
  return penalty;
}

function partnerGapAllowed(team, fairnessCorrection){
  const gap = partnerGap(team);
  return fairnessCorrection
    ? gap <= PARTNER_GAP_CORRECTION_LIMIT
    : gap < PARTNER_GAP_HARD;
}

function partnerGapSymmetry(team1, team2){
  return Math.abs(partnerGap(team1) - partnerGap(team2));
}

function partnerGapSymmetryAllowed(team1, team2, options = {}){
  if(options.fairnessCorrection || options.reservation)return true;
  if([...team1, ...team2].some(player=>fairGap(player) >= FAIR_FORCE_GAP))return true;
  return partnerGapSymmetry(team1, team2) <= PARTNER_GAP_SYMMETRY_LIMIT;
}

// js/match-quality.js 와 같은 값을 씁니다(서버·클라이언트 동일 판단).
// 예전 값은 "경기 수 1경기 차이"(170점)보다 싸서 같은 사람끼리 계속 붙는
// 편이 점수상 이득이었습니다.
function partnerRepeatPenalty(count){
  const value = Math.max(0, Math.floor(number(count)));
  return value === 0 ? 0 : value === 1 ? 240 : value === 2 ? 1400 : 1e9;
}

function opponentRepeatPenalty(count){
  const value = Math.max(0, Math.floor(number(count)));
  const base = value === 0 ? 0 : value === 1 ? 8 : value === 2 ? 50 : value === 3 ? 190 : 1e9;
  return base * 4;
}

function exactRepeatPenalty(count){
  const value = Math.max(0, Math.floor(number(count)));
  return value === 0 ? 0 : value === 1 ? 5000 : value === 2 ? 50000 : 1e9;
}

function gender(player){
  return player?.gender === 'F' || player?.gender === '여' ? 'F' : 'M';
}

function teamShape(team){
  const female = team.filter(player=>gender(player) === 'F').length;
  return female === 0 ? '남복' : female === 2 ? '여복' : '혼복';
}

function strictMatchType(team1, team2){
  const first = teamShape(team1);
  return first === teamShape(team2) ? first : '';
}

function teamSide(player){
  return text(player?.team);
}

function validTeamModePairing(team1, team2, teamMode){
  if(!teamMode)return true;
  const side1 = teamSide(team1[0]);
  const side2 = teamSide(team2[0]);
  return !!side1 && !!side2 && side1 !== side2 &&
    team1.every(player=>teamSide(player) === side1) &&
    team2.every(player=>teamSide(player) === side2);
}

function countByName(player, key, name){
  const map = player?.[key];
  return map && typeof map === 'object' && !Array.isArray(map) ? number(map[name]) : 0;
}

function countAgainst(player, key, other){
  const byId = player?.[`${key}ById`];
  if(byId && typeof byId === 'object' && !Array.isArray(byId)){
    const value = byId[playerId(other)];
    if(value != null)return number(value);
  }
  return countByName(player, key, other?.name);
}

function minutesSince(timestamp, now){
  if(!number(timestamp))return 0;
  return Math.max(0, Math.floor((now - number(timestamp)) / 60000));
}

function recoveryPoolStrength(session, reference){
  const count = reference.length;
  const courts = Math.max(1, number(session.event?.courts, 1));
  if(count >= courts * 6)return 'plenty';
  if(count >= courts * 4)return 'normal';
  return 'tight';
}

function recentRecoveryMinutes(player, now){
  if(!number(player?.lastPlayedSeq))return Infinity;
  const from = number(player?.waitFrom || player?.lastStatusAt);
  return from ? minutesSince(from, now) : 0;
}

function recentRecoveryPenalty(session, player, reference, now){
  if(!number(player?.lastPlayedSeq))return 0;
  const currentSeq = Math.max(
    number(session.serverRuntime?.nextSeq),
    ...(session.event?.active || []).map(match=>number(match?.seq) + 1),
    number(session.event?.completed) + 1
  );
  const seqGap = Math.max(0, currentSeq - number(player.lastPlayedSeq));
  const elapsed = recentRecoveryMinutes(player, now);
  const strength = recoveryPoolStrength(session, reference);
  if(strength === 'tight'){
    return seqGap <= 1 && elapsed < RECENT_SOFT_MIN
      ? 70 + Math.max(0, RECENT_SOFT_MIN - elapsed) * 18
      : 0;
  }
  let penalty = 0;
  if(seqGap <= 1)penalty += strength === 'plenty' ? 520 : 320;
  else if(seqGap === 2)penalty += strength === 'plenty' ? 180 : 80;
  if(elapsed < RECENT_SOFT_MIN)penalty += (RECENT_SOFT_MIN - elapsed) * (strength === 'plenty' ? 85 : 50);
  if(strength === 'plenty' && elapsed < RECENT_RECOVERY_MIN)penalty += (RECENT_RECOVERY_MIN - elapsed) * 18;
  return penalty;
}

function latePriorityBonus(session, player, now){
  const startedAt = number(session.matchStartedAt);
  const joinedAt = number(player?.joinedAt);
  const lateMinutes = startedAt && joinedAt > startedAt ? Math.floor((joinedAt - startedAt) / 60000) : 0;
  const games = number(player?.games);
  const remaining = Math.max(0, LATE_PRIORITY_GAMES - games);
  if(lateMinutes < LATE_GRACE_MIN || !remaining)return 0;
  if(games > 0 && recentRecoveryMinutes(player, now) < RECENT_RECOVERY_MIN)return 0;
  const raw = (games === 0 ? 180 : 90) + Math.min(lateMinutes, 30) * 2;
  return Math.min(raw, games === 0 ? 240 : 150);
}

function fairActual(player){
  return number(player?.games) + ((status(player?.status) === 'playing' || player?.currentMatchId) ? 1 : 0);
}

function fairExpected(player){
  const expected = Number(player?.fairExpected);
  return Number.isFinite(expected) ? Math.max(0, expected) : fairActual(player);
}

function fairGap(player){
  return fairExpected(player) - fairActual(player);
}

function fairPriorityBonus(player){
  const gap = Math.max(0, fairGap(player));
  if(gap < FAIR_PRIORITY_GAP)return 0;
  return Math.min(2800, Math.round((gap - 0.5) * 700));
}

function priorityScore(session, player, now){
  const wait = minutesSince(player?.waitFrom || player?.joinedAt, now);
  return number(player?.games) * 170
    - Math.min(wait, 60) * 4
    - latePriorityBonus(session, player, now)
    - fairPriorityBonus(player);
}

// ── 종목 선호: 남복·여복 우선 ────────────────────────────────────────
// 운영자 방침(2026-08-02): 회원들이 동성복식을 선호합니다.
// 혼복은 "동성복식으로 짜면 문제가 생길 때"만 나오면 됩니다.
//  - 같은 파트너가 또 걸릴 때 / 같은 얼굴만 계속 만날 때
//  - 실력 균형이 안 맞을 때
//  - 출전 차례가 밀린 사람을 넣어야 할 때
//
// 그래서 시계(마무리·후반 판정)를 쓰지 않습니다. 대신 혼복에 고정 감점을 두고,
// 동성복식 최선안이 그만큼 나쁘면 혼복이 자동으로 이깁니다.
// 즉 이 값은 "얼마나 문제여야 혼복으로 넘어가는가"의 문턱입니다.
//
// 값은 같은 점수판 위의 다른 감점에 맞춰 잡았습니다.
//   파트너 2회 반복 1,400 · 같은 상대 4번째 760 · 팀 실력차 1.8 약 1,130
// 문턱 3,200 = "이런 문제가 두세 개 겹치면 혼복으로 푼다".
//
// 더 낮추고 싶었지만(1,200이면 파트너 반복 한 번만으로 혼복) 안 됩니다.
// 혼복이 늘면 **혼복에 낄 수 없는 최상급 선수**의 출전 기회가 깎입니다.
// S급(유효 6.5)은 파트너 실력차 3.0 제한 때문에 짝이 될 수 있는 여성이
// 사실상 없어서, 혼복 코트가 늘수록 설 자리가 줄어듭니다.
// 실측: 1,200~3,000 전부 `daily-36p-150m-regression`(늦게 온 S급도 2경기)
// 실패, 3,200에서만 통과.
const MIXED_PENALTY = 3200;

function fourKeyFromIds(ids){
  return ids.map(text).filter(Boolean).sort((a,b)=>a.localeCompare(b, 'ko')).join('|');
}

function exactKeyFromTeams(first, second){
  const key = ids=>ids.map(text).filter(Boolean).sort((a,b)=>a.localeCompare(b, 'ko')).join('|');
  return [key(first), key(second)].sort((a,b)=>a.localeCompare(b, 'ko')).join(' VS ');
}

function pairingKey(pairing){
  return exactKeyFromTeams(pairing.team1.map(playerId), pairing.team2.map(playerId));
}

function levelSpreadPenalty(players){
  const levels = players.map(effectiveLevel);
  const spread = Math.max(...levels) - Math.min(...levels);
  return Math.max(0, spread - 3) * 120 + Math.max(0, spread - 4) * 360;
}

function scorePairing(session, pairing, reference, now, strict, reservation){
  const all = [...pairing.team1, ...pairing.team2];
  const minGames = reference.length ? Math.min(...reference.map(player=>number(player.games))) : 0;
  const maxGames = reference.length ? Math.max(...reference.map(player=>number(player.games))) : 0;
  let score = teamDiffPenalty(pairing.levelDiff);
  let lateTotal = 0;
  let fairTotal = 0;
  all.forEach(player=>{
    score += (number(player.games) - minGames) * 170;
    score -= Math.min(minutesSince(player.waitFrom || player.joinedAt, now), 60) * 4;
    score += recentRecoveryPenalty(session, player, reference, now);
    lateTotal += latePriorityBonus(session, player, now);
    fairTotal += fairPriorityBonus(player);
  });
  score -= Math.min(360, lateTotal);
  score -= Math.min(5600, fairTotal);
  // 출전이 밀린 사람이 끼어 있을수록 문턱을 낮춥니다. 한 경기 이상 밀렸으면 0.
  // "출전 차례가 밀린 것"도 혼복으로 풀어야 할 문제 중 하나입니다.
  // (경기 수 균등은 항상 종목 선호보다 먼저입니다.)
  if(pairing.type === '혼복'){
    const behind = Math.max(0, ...all.map(player=>fairGap(player)));
    score += MIXED_PENALTY * (1 - Math.min(1, behind / FAIR_FORCE_GAP));
  }
  [pairing.team1, pairing.team2].forEach(team=>{
    score += partnerRepeatPenalty(countAgainst(team[0], 'partnerCount', team[1]));
    score += partnerGapPenalty(team);
  });
  score += levelSpreadPenalty(all);
  pairing.team1.forEach(first=>pairing.team2.forEach(second=>{
    score += opponentRepeatPenalty(countAgainst(first, 'opponentCount', second));
  }));
  const runtime = session.serverRuntime || {};
  score += number(runtime.fourCounts?.[fourKeyFromIds(all.map(playerId))]) * 1600;
  score += exactRepeatPenalty(number(runtime.exactCounts?.[pairingKey(pairing)]));
  if(maxGames - minGames >= 2)score -= all.filter(player=>number(player.games) === minGames).length * 90;
  if(!strict)score += 260;
  if(reservation)score -= 1200;
  return score;
}

function pairingFor(session, team1, team2, reference, now, strict, reservation, fairnessCorrection = false){
  const teamMode = !!session.event?.teamMode;
  if(!validTeamModePairing(team1, team2, teamMode))return null;
  const type = strict ? strictMatchType(team1, team2) : '예외';
  if(strict && !type)return null;
  const diff = teamDiff(team1, team2);
  if(
    diff > TEAM_DIFF_LIMIT ||
    !partnerGapAllowed(team1, fairnessCorrection) ||
    !partnerGapAllowed(team2, fairnessCorrection) ||
    !partnerGapSymmetryAllowed(team1, team2, {fairnessCorrection, reservation})
  )return null;
  let first = team1;
  let second = team2;
  if(teamMode && teamSide(first[0]) === '홍팀' && teamSide(second[0]) === '청팀'){
    first = team2;
    second = team1;
  }
  const pairing = {
    team1:first,
    team2:second,
    type,
    levelDiff:diff,
    team1Level:Math.round(teamLevel(first) * 10) / 10,
    team2Level:Math.round(teamLevel(second) * 10) / 10,
    flexible:!strict,
    fairnessCorrection:!!fairnessCorrection,
    correctionReason:fairnessCorrection ? 'fairness-partner-gap' : '',
    teamMode
  };
  pairing.score = scorePairing(session, pairing, reference, now, strict, reservation);
  return pairing;
}

function bestPairingForFour(session, four, reference, now, strict, reservation, fairnessCorrection = false){
  const layouts = [[0,1,2,3],[0,2,1,3],[0,3,1,2]];
  let best = null;
  layouts.forEach(layout=>{
    const pairing = pairingFor(
      session,
      [four[layout[0]], four[layout[1]]],
      [four[layout[2]], four[layout[3]]],
      reference,
      now,
      strict,
      reservation,
      fairnessCorrection
    );
    if(!pairing)return;
    const key = pairingKey(pairing);
    if(!best || pairing.score < best.score || (pairing.score === best.score && key < pairingKey(best)))best = pairing;
  });
  return best;
}

function eligiblePlayers(session){
  const teamMode = !!session.event?.teamMode;
  return (session.players || []).filter(player=>
    status(player?.status) === 'wait' &&
    !player?.currentMatchId &&
    (!teamMode || !!teamSide(player))
  );
}

function preparedPairing(session, team1Ids, team2Ids, options = {}){
  const team1 = (team1Ids || []).map(id=>playerById(session, id)).filter(Boolean);
  const team2 = (team2Ids || []).map(id=>playerById(session, id)).filter(Boolean);
  if(team1.length !== 2 || team2.length !== 2 || new Set([...team1, ...team2].map(playerId)).size !== 4)return null;
  if([...team1, ...team2].some(player=>status(player?.status) !== 'wait' || player?.currentMatchId))return null;
  const reference = eligiblePlayers(session);
  const now = number(options.now, Date.now());
  const fairnessCorrection = !!options.fairnessCorrection;
  const reservation = options.reservation || (options.reservationId ? {id:text(options.reservationId)} : null);
  const strict = !!strictMatchType(team1, team2);
  if(strict)return pairingFor(session, team1, team2, reference, now, true, reservation, fairnessCorrection);
  if(options.allowFlexible === false)return null;
  return pairingFor(session, team1, team2, reference, now, false, reservation, fairnessCorrection);
}

function forEachFour(players, callback){
  for(let a=0;a<players.length-3;a++){
    for(let b=a+1;b<players.length-2;b++){
      for(let c=b+1;c<players.length-1;c++){
        for(let d=c+1;d<players.length;d++)callback([players[a],players[b],players[c],players[d]]);
      }
    }
  }
}

function attachedReservationIds(session){
  const attached = new Set();
  ['next','expected','serverStandby'].forEach(key=>{
    (session.event?.[key] || []).forEach(item=>{
      if(item?.reservationId)attached.add(text(item.reservationId));
    });
  });
  return attached;
}

function reservationPlayerIds(reservation){
  return [...(reservation?.team1 || []), ...(reservation?.team2 || [])].map(text).filter(Boolean);
}

function bestReservationPairing(session, reservation, available, reference, now){
  const requested = (reservation.team1 || []).map(id=>playerById(session, id)).filter(Boolean);
  if(requested.length !== 2 || requested.some(player=>!available.some(row=>playerId(row) === playerId(player))))return null;
  if(partnerGap(requested) >= PARTNER_GAP_HARD)return null;
  if(reservation.mode === 'match'){
    const opponents = (reservation.team2 || []).map(id=>playerById(session, id)).filter(Boolean);
    if(opponents.length !== 2 || new Set([...requested, ...opponents].map(playerId)).size !== 4)return null;
    if(opponents.some(player=>!available.some(row=>playerId(row) === playerId(player))))return null;
    return pairingFor(session, requested, opponents, reference, now, true, reservation);
  }
  const reservedElsewhere = new Set();
  (session.reservations || []).forEach(other=>{
    if(text(other?.id) === text(reservation.id))return;
    reservationPlayerIds(other).forEach(id=>reservedElsewhere.add(id));
  });
  const candidates = available
    .filter(player=>!requested.some(row=>playerId(row) === playerId(player)) && !reservedElsewhere.has(playerId(player)))
    .sort((a,b)=>number(a.games)-number(b.games) || number(a.waitFrom)-number(b.waitFrom) || playerId(a).localeCompare(playerId(b), 'ko'))
    .slice(0, 20);
  let best = null;
  for(let first=0;first<candidates.length-1;first++){
    for(let second=first+1;second<candidates.length;second++){
      const pairing = pairingFor(session, requested, [candidates[first], candidates[second]], reference, now, true, reservation);
      if(!pairing)continue;
      if(!best || pairing.score < best.score || (pairing.score === best.score && pairingKey(pairing) < pairingKey(best)))best = pairing;
    }
  }
  return best;
}

function bestUrgentGeneratedPairing(session, urgent, available, reference, now){
  if(!urgent)return null;
  const urgentId = playerId(urgent);
  const peers = available.filter(player=>playerId(player) !== urgentId);
  const passes = available.length >= 8 ? [true, false] : [false];
  let correctionFallback = null;
  for(const avoidFourRepeat of passes){
    let strictBest = null;
    let flexibleBest = null;
    for(let a=0;a<peers.length-2;a++){
      for(let b=a+1;b<peers.length-1;b++){
        for(let c=b+1;c<peers.length;c++){
          const four = [urgent, peers[a], peers[b], peers[c]];
          const fourCount = number(session.serverRuntime?.fourCounts?.[fourKeyFromIds(four.map(playerId))]);
          if(avoidFourRepeat && fourCount > 0)continue;
          const strict = bestPairingForFour(session, four, reference, now, true, null);
          if(strict && (!strictBest || strict.score < strictBest.score || (strict.score === strictBest.score && pairingKey(strict) < pairingKey(strictBest))))strictBest = strict;
          if(!strict){
            const flexible = bestPairingForFour(session, four, reference, now, false, null);
            if(flexible && (!flexibleBest || flexible.score < flexibleBest.score || (flexible.score === flexibleBest.score && pairingKey(flexible) < pairingKey(flexibleBest))))flexibleBest = flexible;
            if(fairGap(urgent) >= FAIR_CORRECTION_GAP){
              const correction = bestPairingForFour(session, four, reference, now, true, null, true);
              if(
                correction &&
                (
                  !correctionFallback ||
                  correction.score < correctionFallback.score ||
                  (correction.score === correctionFallback.score && pairingKey(correction) < pairingKey(correctionFallback))
                )
              )correctionFallback = correction;
            }
          }
        }
      }
    }
    const best = strictBest || flexibleBest;
    if(best)return best;
  }
  return correctionFallback;
}

function bestGeneratedPairing(session, available, reference, now){
  const urgent = available
    .slice()
    .sort((a,b)=>fairGap(b)-fairGap(a) ||
      priorityScore(session, a, now)-priorityScore(session, b, now) ||
      number(a.waitFrom)-number(b.waitFrom) ||
      playerId(a).localeCompare(playerId(b), 'ko'))
    .find(player=>fairGap(player) >= FAIR_FORCE_GAP) || null;
  const urgentBest = bestUrgentGeneratedPairing(session, urgent, available, reference, now);
  if(urgentBest)return urgentBest;
  const ranked = available
    .slice()
    .sort((a,b)=>priorityScore(session, a, now)-priorityScore(session, b, now) ||
      number(a.waitFrom)-number(b.waitFrom) ||
      playerId(a).localeCompare(playerId(b), 'ko'))
    .slice(0, MAX_CANDIDATES);
  const passes = ranked.length >= 8 ? [true, false] : [false];
  let fallback = null;
  for(const avoidFourRepeat of passes){
    let strictBest = null;
    let flexibleBest = null;
    forEachFour(ranked, four=>{
      const fourCount = number(session.serverRuntime?.fourCounts?.[fourKeyFromIds(four.map(playerId))]);
      if(avoidFourRepeat && fourCount > 0)return;
      const strict = bestPairingForFour(session, four, reference, now, true, null);
      if(strict && (!strictBest || strict.score < strictBest.score || (strict.score === strictBest.score && pairingKey(strict) < pairingKey(strictBest))))strictBest = strict;
      if(!strict){
        const flexible = bestPairingForFour(session, four, reference, now, false, null);
        if(flexible && (!flexibleBest || flexible.score < flexibleBest.score || (flexible.score === flexibleBest.score && pairingKey(flexible) < pairingKey(flexibleBest))))flexibleBest = flexible;
      }
    });
    const normalBest = strictBest || flexibleBest;
    if(!fallback && normalBest)fallback = normalBest;
    if(normalBest)return normalBest;
  }
  return fallback;
}

function queueId(requestId, pairing, index){
  const seed = `${text(requestId)}|${index}|${pairingKey(pairing)}`;
  return `sq_${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 18)}`;
}

function queueItem(session, pairing, now, requestId, index, reservation){
  const firstIds = pairing.team1.map(playerId);
  const secondIds = pairing.team2.map(playerId);
  const id = queueId(requestId, pairing, index);
  return {
    id,
    queueId:id,
    createdAt:now,
    serverGenerated:true,
    serverGeneratedAt:now,
    serverGeneratedBy:text(requestId),
    type:pairing.type,
    teamMode:pairing.teamMode,
    labelA:pairing.teamMode ? (session.event?.teamBlue || '청팀') : 'A팀',
    labelB:pairing.teamMode ? (session.event?.teamWhite || '홍팀') : 'B팀',
    t1:pairing.team1.map(player=>player.name || '선수'),
    t2:pairing.team2.map(player=>player.name || '선수'),
    t1Ids:firstIds,
    t2Ids:secondIds,
    team1:firstIds,
    team2:secondIds,
    playerIds:[...firstIds, ...secondIds],
    team1Level:pairing.team1Level,
    team2Level:pairing.team2Level,
    levelDiff:pairing.levelDiff,
    flexible:pairing.flexible,
    strict:!pairing.flexible,
    fairnessCorrection:!!pairing.fairnessCorrection,
    correctionReason:pairing.correctionReason || '',
    partnerGapLimit:pairing.fairnessCorrection ? PARTNER_GAP_CORRECTION_LIMIT : PARTNER_GAP_HARD,
    score:Math.round(pairing.score),
    reservationId:reservation?.id || null,
    reservationLabel:reservation?.label || null,
    reservationMode:reservation?.mode || null,
    restPass:false,
    restPassText:''
  };
}

function desiredNextTarget(session, waitingCount){
  const event = session.event || {};
  const courts = Math.max(1, number(event.courts, 1));
  const official = Math.max(0, Math.min(courts, number(event.queuePolicy?.official, courts)));
  if(!official)return 0;
  const maxGames = Math.floor(waitingCount / 4);
  const target = Math.min(official, maxGames);
  event.nextTarget = target;
  event.queuePolicy = event.queuePolicy && typeof event.queuePolicy === 'object' ? event.queuePolicy : {};
  event.queuePolicy.official = official;
  event.queuePolicy.extra = 0;
  return target;
}

function dropProjectedConflicts(session, ids){
  const conflicts = new Set(ids);
  ['expected','serverStandby'].forEach(key=>{
    session.event[key] = (session.event[key] || []).filter(item=>!queueIds(item).some(id=>conflicts.has(id)));
  });
}

function replenishPrepared(session, options = {}){
  const now = number(options.now, Date.now());
  const requestId = text(options.requestId || `server_${now}`);
  if(
    session.event?.finishMode ||
    session.event?.operationStarted === false ||
    session.event?.queuePolicy?.auto === false
  )return {generated:[]};
  const reference = eligiblePlayers(session);
  const target = desiredNextTarget(session, reference.length);
  const used = new Set();
  (session.event?.active || []).forEach(match=>activeIds(match).forEach(id=>used.add(id)));
  (session.event?.next || []).forEach(item=>queueIds(item).forEach(id=>used.add(id)));
  (options.excludeIds || []).map(text).filter(Boolean).forEach(id=>used.add(id));
  const generated = [];
  const attached = attachedReservationIds(session);
  let guard = 0;
  while(session.event.next.length < target && guard++ < target + 4){
    const available = reference.filter(player=>!used.has(playerId(player)));
    if(available.length < 4)break;
    let pairing = null;
    let reservation = null;
    for(const row of (session.reservations || []).slice().sort((a,b)=>number(a?.createdAt)-number(b?.createdAt))){
      if(attached.has(text(row?.id)))continue;
      if(reservationPlayerIds(row).some(id=>used.has(id)))continue;
      pairing = bestReservationPairing(session, row, available, reference, now);
      if(pairing){
        reservation = row;
        break;
      }
    }
    if(!pairing){
      const held = new Set();
      (session.reservations || []).forEach(row=>{
        if(attached.has(text(row?.id)))return;
        reservationPlayerIds(row).forEach(id=>held.add(id));
      });
      pairing = bestGeneratedPairing(session, available.filter(player=>!held.has(playerId(player))), reference, now);
    }
    if(!pairing)break;
    const item = queueItem(session, pairing, now, requestId, generated.length, reservation);
    session.event.next.push(item);
    queueIds(item).forEach(id=>used.add(id));
    dropProjectedConflicts(session, queueIds(item));
    if(reservation)attached.add(text(reservation.id));
    generated.push(item);
  }
  return {generated};
}

function recordCompletedMatchHistory(session, match){
  session.serverRuntime = session.serverRuntime && typeof session.serverRuntime === 'object' ? session.serverRuntime : {};
  session.serverRuntime.fourCounts = session.serverRuntime.fourCounts && typeof session.serverRuntime.fourCounts === 'object'
    ? session.serverRuntime.fourCounts
    : {};
  session.serverRuntime.exactCounts = session.serverRuntime.exactCounts && typeof session.serverRuntime.exactCounts === 'object'
    ? session.serverRuntime.exactCounts
    : {};
  const ids = activeIds(match);
  const first = team1Ids(match);
  const second = team2Ids(match);
  if(ids.length === 4){
    const key = fourKeyFromIds(ids);
    session.serverRuntime.fourCounts[key] = number(session.serverRuntime.fourCounts[key]) + 1;
  }
  if(first.length === 2 && second.length === 2){
    const key = exactKeyFromTeams(first, second);
    session.serverRuntime.exactCounts[key] = number(session.serverRuntime.exactCounts[key]) + 1;
  }
}

module.exports = {
  FAIR_FORCE_GAP,
  FAIR_CORRECTION_GAP,
  PARTNER_GAP_HARD,
  PARTNER_GAP_CORRECTION_LIMIT,
  PARTNER_GAP_SYMMETRY_LIMIT,
  TEAM_DIFF_LIMIT,
  effectiveLevel,
  partnerGapSymmetry,
  partnerGapSymmetryAllowed,
  fourKeyFromIds,
  exactKeyFromTeams,
  queueIds,
  preparedPairing,
  replenishPrepared,
  recordCompletedMatchHistory
};
