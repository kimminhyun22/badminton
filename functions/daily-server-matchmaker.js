'use strict';

const crypto = require('crypto');

const PARTNER_GAP_OK = 1.25;
const PARTNER_GAP_CAUTION = 2.25;
const PARTNER_GAP_HARD = 3;
const TEAM_DIFF_TARGET = 1.5;
const TEAM_DIFF_LIMIT = 2;
const RECENT_SOFT_MIN = 6;
const RECENT_RECOVERY_MIN = 12;
const LATE_GRACE_MIN = 5;
const LATE_PRIORITY_GAMES = 2;
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

function partnerRepeatPenalty(count){
  const value = Math.max(0, Math.floor(number(count)));
  return value === 0 ? 0 : value === 1 ? 140 : value === 2 ? 1200 : 1e9;
}

function opponentRepeatPenalty(count){
  const value = Math.max(0, Math.floor(number(count)));
  const base = value === 0 ? 0 : value === 1 ? 2 : value === 2 ? 15 : value === 3 ? 80 : 1e9;
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

function partnerSelectionValid(players){
  return players.every(player=>!player.partnerName || players.some(other=>other.name === player.partnerName));
}

function partnerTeamsValid(team1, team2){
  const all = [...team1, ...team2];
  return all.every(player=>{
    if(!player.partnerName)return true;
    const partner = all.find(other=>other.name === player.partnerName);
    return !!partner && team1.includes(player) === team1.includes(partner);
  });
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

function priorityScore(session, player, now){
  const wait = minutesSince(player?.waitFrom || player?.joinedAt, now);
  return number(player?.games) * 170 - Math.min(wait, 60) * 4 - latePriorityBonus(session, player, now);
}

function mixedTargetRange(games){
  const total = Math.max(0, number(games));
  return {min:Math.floor(total / 4), max:Math.floor(total / 4) * 2 + Math.min(2, total % 4)};
}

function mixedQuotaPenalty(player, mixed){
  const nextGames = Math.max(1, number(player?.typeTrackedGames) + 1);
  const nextMixed = Math.max(0, number(player?.mixedGames) + (mixed ? 1 : 0));
  const range = mixedTargetRange(nextGames);
  const ideal = nextGames * 0.375;
  let penalty = Math.abs(nextMixed - ideal) * 35;
  if(nextMixed < range.min)penalty += (range.min - nextMixed) * 3600;
  if(nextMixed > range.max)penalty += (nextMixed - range.max) * 3600;
  if(nextGames >= 3 && nextMixed === 0)penalty += 640;
  return Math.min(600, penalty);
}

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
  let mixedTotal = 0;
  all.forEach(player=>{
    score += (number(player.games) - minGames) * 170;
    score -= Math.min(minutesSince(player.waitFrom || player.joinedAt, now), 60) * 4;
    score += recentRecoveryPenalty(session, player, reference, now);
    lateTotal += latePriorityBonus(session, player, now);
    mixedTotal += mixedQuotaPenalty(player, pairing.type === '혼복');
  });
  score -= Math.min(360, lateTotal);
  score += Math.min(1200, mixedTotal);
  [pairing.team1, pairing.team2].forEach(team=>{
    if(team[0].partnerName !== team[1].name)score += partnerRepeatPenalty(countAgainst(team[0], 'partnerCount', team[1]));
    score += partnerGapPenalty(team);
  });
  score += levelSpreadPenalty(all);
  pairing.team1.forEach(first=>pairing.team2.forEach(second=>{
    score += opponentRepeatPenalty(countAgainst(first, 'opponentCount', second));
  }));
  const runtime = session.serverRuntime || {};
  score += number(runtime.fourCounts?.[fourKeyFromIds(all.map(playerId))]) * 1600;
  score += exactRepeatPenalty(number(runtime.exactCounts?.[pairingKey(pairing)]));
  score -= all.filter(player=>player.partnerName && all.some(other=>other.name === player.partnerName)).length * 325;
  if(maxGames - minGames >= 2)score -= all.filter(player=>number(player.games) === minGames).length * 90;
  if(!strict)score += 260;
  if(reservation)score -= 1200;
  return score;
}

function pairingFor(session, team1, team2, reference, now, strict, reservation){
  if(!partnerTeamsValid(team1, team2))return null;
  const teamMode = !!session.event?.teamMode;
  if(!validTeamModePairing(team1, team2, teamMode))return null;
  const type = strict ? strictMatchType(team1, team2) : '예외';
  if(strict && !type)return null;
  const diff = teamDiff(team1, team2);
  if(diff > TEAM_DIFF_LIMIT || partnerGap(team1) >= PARTNER_GAP_HARD || partnerGap(team2) >= PARTNER_GAP_HARD)return null;
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
    teamMode
  };
  pairing.score = scorePairing(session, pairing, reference, now, strict, reservation);
  return pairing;
}

function bestPairingForFour(session, four, reference, now, strict, reservation){
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
      reservation
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

function bestGeneratedPairing(session, available, reference, now){
  const ranked = available
    .slice()
    .sort((a,b)=>priorityScore(session, a, now)-priorityScore(session, b, now) ||
      number(a.waitFrom)-number(b.waitFrom) ||
      playerId(a).localeCompare(playerId(b), 'ko'))
    .slice(0, MAX_CANDIDATES);
  const passes = ranked.length >= 8 ? [true, false] : [false];
  for(const avoidFourRepeat of passes){
    let strictBest = null;
    let flexibleBest = null;
    forEachFour(ranked, four=>{
      if(!partnerSelectionValid(four))return;
      const fourCount = number(session.serverRuntime?.fourCounts?.[fourKeyFromIds(four.map(playerId))]);
      if(avoidFourRepeat && fourCount > 0)return;
      const strict = bestPairingForFour(session, four, reference, now, true, null);
      if(strict && (!strictBest || strict.score < strictBest.score || (strict.score === strictBest.score && pairingKey(strict) < pairingKey(strictBest))))strictBest = strict;
      if(!strict){
        const flexible = bestPairingForFour(session, four, reference, now, false, null);
        if(flexible && (!flexibleBest || flexible.score < flexibleBest.score || (flexible.score === flexibleBest.score && pairingKey(flexible) < pairingKey(flexibleBest))))flexibleBest = flexible;
      }
    });
    if(strictBest || flexibleBest)return strictBest || flexibleBest;
  }
  return null;
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
    score:Math.round(pairing.score),
    reservationId:reservation?.id || null,
    reservationLabel:reservation?.label || null,
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
  const spare = Math.max(0, maxGames - official);
  const extra = spare >= 4 ? 2 : spare >= 2 ? 1 : 0;
  const goal = Math.min(courts + 2, official + extra);
  const target = Math.min(goal, maxGames);
  event.nextTarget = target;
  event.queuePolicy = event.queuePolicy && typeof event.queuePolicy === 'object' ? event.queuePolicy : {};
  event.queuePolicy.official = official;
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
  PARTNER_GAP_HARD,
  TEAM_DIFF_LIMIT,
  effectiveLevel,
  fourKeyFromIds,
  exactKeyFromTeams,
  queueIds,
  replenishPrepared,
  recordCompletedMatchHistory
};
