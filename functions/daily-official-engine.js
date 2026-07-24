'use strict';

const crypto = require('crypto');
const {
  preparedPairing,
  replenishPrepared,
  recordCompletedMatchHistory
} = require('./daily-server-matchmaker');

const OFFICIAL_OPERATION_TTL_MS = 30 * 60 * 1000;
const MEMBER_STATUS_TTL_MS = 5 * 60 * 1000;
const OFFICIAL_UNDO_MS = 45 * 1000;
const RECEIPT_RETAIN_MS = 10 * 60 * 1000;
const AUTO_HANDOFF_WINDOW_MS = 2 * 60 * 1000;
const MATCH_MINUTES = 15;
const PARTNER_GAP_HARD = 3;
const TEAM_DIFF_LIMIT = 2;
const AGE_BONUS = Object.freeze({'20대':0,'30대':-0.2,'40대':-0.5,'50대':-1.2,'60대+':-2});

const SUPPORTED_TYPES = new Set([
  'official-player-arrival',
  'official-player-add',
  'official-player-status',
  'official-court-complete',
  'official-active-yield',
  'official-queue-enter-free',
  'official-queue-yield',
  'official-partner-reservation',
  'official-partner-cancel',
  'official-court-complete-undo',
  'official-operation-undo'
]);

const UNDOABLE_TYPES = new Set([
  'official-court-complete',
  'official-active-yield',
  'official-queue-enter-free',
  'official-queue-yield'
]);

const PAUSED_FLOW_TYPES = new Set([
  'official-player-arrival',
  'official-player-add',
  'official-player-status',
  'official-court-complete',
  'official-active-yield',
  'official-queue-enter-free',
  'official-queue-yield',
  'official-partner-reservation',
  'official-partner-cancel'
]);

function clone(value){
  if(value == null)return value;
  return JSON.parse(JSON.stringify(value));
}

function number(value, fallback = 0){
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value){
  return String(value == null ? '' : value);
}

function safeId(value){
  return text(value).replace(/[^a-zA-Z0-9_-]/g, '').slice(-80) || 'operation';
}

function canonicalJson(value){
  if(value === null || typeof value !== 'object')return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function grantSignature(encodedPayload, secret){
  return crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function issueOfficialGrant(payload, secret){
  const encodedPayload = Buffer.from(canonicalJson(payload), 'utf8').toString('base64url');
  return `${encodedPayload}.${grantSignature(encodedPayload, secret)}`;
}

function verifyOfficialGrant(token, secret, sessionId, now){
  if(!token)return {skip:true};
  if(!secret)return {reason:'서버 운영 보안키가 준비되지 않았습니다.'};
  try{
    const [encodedPayload, signature, extra] = text(token).split('.');
    if(!encodedPayload || !signature || extra)return {reason:'임원 운영 연결이 올바르지 않습니다.'};
    const expected = grantSignature(encodedPayload, secret);
    const actualBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if(actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)){
      return {reason:'임원 운영 연결이 올바르지 않습니다.'};
    }
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if(number(payload.v) !== 1 || text(payload.sid) !== text(sessionId))return {reason:'다른 민턴LIVE의 임원 운영 연결입니다.'};
    if(!number(payload.exp) || now >= number(payload.exp))return {reason:'임원 운영 연결 시간이 끝났습니다. 본인 이름을 다시 선택해 주세요.'};
    return {ok:true,payload};
  }catch(e){
    return {reason:'임원 운영 연결이 올바르지 않습니다.'};
  }
}

function normalizeStatus(value){
  if(value === 'lesson')return 'rest';
  if(value === 'last' || value === 'leaving')return 'done';
  return ['invited', 'planned', 'wait', 'playing', 'rest', 'done'].includes(value) ? value : 'wait';
}

function statusLabel(value){
  return ({invited:'등록 전',planned:'등록 전',wait:'참가',playing:'경기중',rest:'휴식',done:'종료'})[normalizeStatus(value)] || '';
}

function idsFingerprint(ids){
  return (ids || []).map(text).filter(Boolean).sort((a,b)=>a.localeCompare(b, 'ko')).join('|');
}

function teamsFingerprint(team1, team2){
  const team = ids => idsFingerprint(ids);
  const keys = [team(team1), team(team2)];
  return keys.some(key=>!key) ? '' : keys.sort((a,b)=>a.localeCompare(b, 'ko')).join(' VS ');
}

function queuePlayerIds(item){
  if(Array.isArray(item?.playerIds) && item.playerIds.length)return item.playerIds.map(text).filter(Boolean);
  return [...(item?.t1Ids || item?.team1 || []), ...(item?.t2Ids || item?.team2 || [])].map(text).filter(Boolean);
}

function queueTeam1Ids(item){
  return (item?.t1Ids || item?.team1 || []).map(text).filter(Boolean);
}

function queueTeam2Ids(item){
  return (item?.t2Ids || item?.team2 || []).map(text).filter(Boolean);
}

function activePlayerIds(match){
  if(Array.isArray(match?.playerIds) && match.playerIds.length)return match.playerIds.map(text).filter(Boolean);
  return [...(match?.t1Ids || match?.team1 || []), ...(match?.t2Ids || match?.team2 || [])].map(text).filter(Boolean);
}

function playerById(session, id){
  return (session.players || []).find(player=>text(player?.id) === text(id)) || null;
}

function effectiveLevel(player){
  const level = number(player?.level, 4);
  const female = player?.gender === 'F' || player?.gender === '여';
  const age = AGE_BONUS[player?.ageGroup] || 0;
  return Math.round((level - (female ? 0.5 : 0) + age) * 10) / 10;
}

function teamLevel(players){
  return players.reduce((sum, player)=>sum + effectiveLevel(player), 0);
}

function teamShape(players){
  const female = players.filter(player=>player?.gender === 'F' || player?.gender === '여').length;
  return female === 0 ? '남복' : female === 2 ? '여복' : '혼복';
}

function partnerGap(players){
  return players.length === 2 ? Math.abs(effectiveLevel(players[0]) - effectiveLevel(players[1])) : Infinity;
}

function queuePairingMetrics(session, team1Ids, team2Ids){
  const team1 = team1Ids.map(id=>playerById(session, id)).filter(Boolean);
  const team2 = team2Ids.map(id=>playerById(session, id)).filter(Boolean);
  if(team1.length !== 2 || team2.length !== 2 || teamShape(team1) !== teamShape(team2))return null;
  if(partnerGap(team1) >= PARTNER_GAP_HARD || partnerGap(team2) >= PARTNER_GAP_HARD)return null;
  const team1Level = Math.round(teamLevel(team1) * 10) / 10;
  const team2Level = Math.round(teamLevel(team2) * 10) / 10;
  const levelDiff = Math.round(Math.abs(team1Level - team2Level) * 10) / 10;
  if(levelDiff > TEAM_DIFF_LIMIT)return null;
  return {team1, team2, team1Level, team2Level, levelDiff, type:teamShape(team1)};
}

function writePreparedTeams(session, item, team1Ids, team2Ids, metrics){
  const team1 = team1Ids.map(id=>playerById(session, id)).filter(Boolean);
  const team2 = team2Ids.map(id=>playerById(session, id)).filter(Boolean);
  if(team1.length !== 2 || team2.length !== 2)return false;
  const team1Level = metrics?.team1Level ?? Math.round(teamLevel(team1) * 10) / 10;
  const team2Level = metrics?.team2Level ?? Math.round(teamLevel(team2) * 10) / 10;
  const type = metrics?.type || (teamShape(team1) === teamShape(team2) ? teamShape(team1) : '예외');
  item.t1Ids = [...team1Ids];
  item.t2Ids = [...team2Ids];
  item.team1 = [...team1Ids];
  item.team2 = [...team2Ids];
  item.playerIds = [...team1Ids, ...team2Ids];
  item.t1 = team1.map(player=>player.name || '선수');
  item.t2 = team2.map(player=>player.name || '선수');
  item.type = type;
  item.team1Level = team1Level;
  item.team2Level = team2Level;
  item.levelDiff = metrics?.levelDiff ?? Math.round(Math.abs(team1Level - team2Level) * 10) / 10;
  item.flexible = metrics?.flexible ?? type === '예외';
  item.strict = !item.flexible;
  if(metrics?.score != null)item.score = Math.round(metrics.score);
  if(metrics?.teamMode != null)item.teamMode = !!metrics.teamMode;
  return true;
}

function setPreparedTeams(session, item, team1Ids, team2Ids){
  const metrics = queuePairingMetrics(session, team1Ids, team2Ids);
  return metrics ? writePreparedTeams(session, item, team1Ids, team2Ids, metrics) : false;
}

function attachPartnerToPrepared(session, reservation){
  const pair = (reservation.team1 || []).map(text).filter(Boolean);
  if(pair.length !== 2)return null;
  let offset = 0;
  for(const key of ['next','expected','serverStandby']){
    const list = session.event[key];
    for(let index = 0; index < list.length; index += 1){
      const item = list[index];
      const ids = queuePlayerIds(item);
      if(!pair.every(id=>ids.includes(id)))continue;
      const originalTeam1 = queueTeam1Ids(item);
      const originalTeam2 = queueTeam2Ids(item);
      const sameSide = pair.every(id=>originalTeam1.includes(id)) || pair.every(id=>originalTeam2.includes(id));
      if(!sameSide){
        if(item.teamMode)return null;
        const others = ids.filter(id=>!pair.includes(id));
        if(others.length !== 2 || !setPreparedTeams(session, item, pair, others))return null;
      }
      item.reservationId = reservation.id;
      item.reservationLabel = reservation.label;
      item.reservationMode = reservation.mode || 'pair';
      item.reservationAttachedExisting = true;
      item.reservationOriginalTeam1Ids = [...originalTeam1];
      item.reservationOriginalTeam2Ids = [...originalTeam2];
      const queueIndex = offset + index + 1;
      reservation.statusText = key === 'next'
        ? `다음 대진 ${queueIndex}순위 반영`
        : key === 'expected'
          ? `예상 대진 ${queueIndex}순위 반영`
          : '예비 대진 반영';
      reservation.statusDetail = '기존 대진 순서 유지';
      reservation.statusClass = 'queued';
      reservation.ready = false;
      return {
        queueApplied:true,
        queueId:text(item.queueId || item.id),
        queueIndex,
        queueGroup:key,
        rearranged:!sameSide
      };
    }
    offset += list.length;
  }
  return null;
}

function detachPartnerFromPrepared(session, reservationId){
  ['next','expected','serverStandby'].forEach(key=>{
    session.event[key] = session.event[key].filter(item=>{
      if(text(item?.reservationId) !== reservationId)return true;
      if(item.reservationAttachedExisting){
        const originalTeam1 = (item.reservationOriginalTeam1Ids || []).map(text).filter(Boolean);
        const originalTeam2 = (item.reservationOriginalTeam2Ids || []).map(text).filter(Boolean);
        if(originalTeam1.length === 2 && originalTeam2.length === 2)writePreparedTeams(session, item, originalTeam1, originalTeam2);
        delete item.reservationId;
        delete item.reservationLabel;
        delete item.reservationMode;
        delete item.reservationAttachedExisting;
        delete item.reservationOriginalTeam1Ids;
        delete item.reservationOriginalTeam2Ids;
        return true;
      }
      return false;
    });
  });
}

function incrementPlayerCount(player, key, name){
  if(!player || !name)return;
  if(!player[key] || typeof player[key] !== 'object' || Array.isArray(player[key]))player[key] = {};
  player[key][name] = number(player[key][name]) + 1;
}

function incrementPlayerRelationship(player, key, other){
  if(!player || !other)return;
  incrementPlayerCount(player, `${key}ById`, text(other.id));
  if(other.name && !/[.#$\[\]\/]/.test(text(other.name)))incrementPlayerCount(player, key, other.name);
}

function ensureSession(raw){
  const session = clone(raw || {});
  session.players = Array.isArray(session.players) ? session.players : [];
  session.reservations = Array.isArray(session.reservations) ? session.reservations : [];
  session.arrivalCandidates = Array.isArray(session.arrivalCandidates) ? session.arrivalCandidates : [];
  session.event = session.event && typeof session.event === 'object' ? session.event : {};
  session.event.active = Array.isArray(session.event.active) ? session.event.active : [];
  session.event.next = Array.isArray(session.event.next) ? session.event.next : [];
  session.event.expected = Array.isArray(session.event.expected) ? session.event.expected : [];
  session.event.serverStandby = Array.isArray(session.event.serverStandby) ? session.event.serverStandby : [];
  session.event.queuePolicy = session.event.queuePolicy && typeof session.event.queuePolicy === 'object'
    ? session.event.queuePolicy
    : {};
  session.serverRuntime = session.serverRuntime && typeof session.serverRuntime === 'object'
    ? session.serverRuntime
    : {};
  session.serverRuntime.holds = session.serverRuntime.holds && typeof session.serverRuntime.holds === 'object'
    ? session.serverRuntime.holds
    : {};
  return session;
}

function operationalSnapshot(session){
  return clone({
    players: session.players,
    reservations: session.reservations,
    arrivalCandidates: session.arrivalCandidates,
    event: session.event,
    serverRuntime: session.serverRuntime
  });
}

function operationalFingerprint(session){
  const players = (session.players || []).map(player=>({
    id:text(player?.id),
    status:normalizeStatus(player?.status),
    currentMatchId:text(player?.currentMatchId),
    afterMatchStatus:text(player?.afterMatchStatus),
    games:number(player?.games),
    mixedGames:number(player?.mixedGames),
    typeTrackedGames:number(player?.typeTrackedGames),
    lastPlayedSeq:number(player?.lastPlayedSeq),
    lastStatusAt:number(player?.lastStatusAt),
    waitFrom:number(player?.waitFrom),
    partnerCountById:player?.partnerCountById || {},
    opponentCountById:player?.opponentCountById || {}
  })).sort((a,b)=>a.id.localeCompare(b.id, 'ko'));
  const reservations = (session.reservations || []).map(item=>({
    id:text(item?.id),
    mode:text(item?.mode),
    team1:(item?.team1 || []).map(text),
    team2:(item?.team2 || []).map(text)
  })).sort((a,b)=>a.id.localeCompare(b.id, 'ko'));
  const active = (session.event?.active || []).map(match=>({
    id:text(match?.id),
    court:number(match?.court),
    seq:number(match?.seq),
    startedAt:number(match?.startedAt),
    team1:queueTeam1Ids(match),
    team2:queueTeam2Ids(match)
  })).sort((a,b)=>a.court-b.court || a.id.localeCompare(b.id, 'ko'));
  const next = (session.event?.next || []).map(item=>({
    id:text(item?.queueId || item?.id),
    team1:queueTeam1Ids(item),
    team2:queueTeam2Ids(item),
    reservationId:text(item?.reservationId),
    restPass:item?.restPass || null
  }));
  const source = {
    players,
    reservations,
    active,
    next,
    completed:number(session.event?.completed),
    finishMode:!!session.event?.finishMode,
    serverRuntime:{
      holds:session.serverRuntime?.holds || {},
      nextSeq:number(session.serverRuntime?.nextSeq),
      fourCounts:session.serverRuntime?.fourCounts || {},
      exactCounts:session.serverRuntime?.exactCounts || {}
    }
  };
  return crypto.createHash('sha256').update(canonicalJson(source)).digest('hex');
}

function restoreSnapshot(session, snapshot){
  session.players = clone(snapshot.players || []);
  session.reservations = clone(snapshot.reservations || []);
  session.arrivalCandidates = clone(snapshot.arrivalCandidates || []);
  session.event = clone(snapshot.event || {});
  session.serverRuntime = clone(snapshot.serverRuntime || {holds:{}});
  return ensureSession(session);
}

function pruneReceipts(raw, now){
  const receipts = clone(raw || {});
  Object.keys(receipts).forEach(key=>{
    const receipt = receipts[key];
    const anchor = number(receipt?.undoneAt || receipt?.expiresAt || receipt?.createdAt);
    if(!anchor || now - anchor > RECEIPT_RETAIN_MS)delete receipts[key];
  });
  return receipts;
}

function timerInfo(match, now){
  const endAt = number(match?.endAt) || (number(match?.startedAt, now) + number(match?.expectedMinutes, MATCH_MINUTES) * 60000);
  const remain = Math.max(0, Math.ceil((endAt - now) / 60000));
  const state = remain <= 0 ? 'due' : remain <= 5 ? 'soon' : 'normal';
  return {endAt, remain, state};
}

function queueReady(session, item){
  const ids = queuePlayerIds(item);
  if(ids.length !== 4 || new Set(ids).size !== 4)return false;
  return ids.every(id=>{
    const player = playerById(session, id);
    return !!player && normalizeStatus(player.status) === 'wait' && !player.currentMatchId;
  });
}

function removeInvalidPrepared(session){
  const event = session.event;
  const permanentlyUnavailable = id=>{
    const player = playerById(session, id);
    return !player || ['rest', 'done', 'invited', 'planned'].includes(normalizeStatus(player.status));
  };
  ['next', 'expected', 'serverStandby'].forEach(key=>{
    event[key] = event[key].filter(item=>{
      const ids = queuePlayerIds(item);
      return ids.length === 4 && new Set(ids).size === 4 && !ids.some(permanentlyUnavailable);
    });
  });
}

function preparedLocations(session){
  const rows = [];
  ['next', 'expected', 'serverStandby'].forEach(key=>{
    (session.event[key] || []).forEach((item, index)=>rows.push({key, index, item}));
  });
  return rows;
}

function clearPreparedReservation(session, item){
  const reservationId = text(item?.reservationId);
  if(reservationId){
    session.reservations = session.reservations.filter(row=>text(row?.id) !== reservationId);
  }
  [
    'reservationId',
    'reservationLabel',
    'reservationMode',
    'reservationAttachedExisting',
    'reservationOriginalTeam1Ids',
    'reservationOriginalTeam2Ids'
  ].forEach(key=>delete item[key]);
}

function removePlayerReservations(session, playerId){
  const targetId = text(playerId);
  session.reservations = session.reservations.filter(item=>{
    const ids = [...(item?.team1 || []), ...(item?.team2 || [])].map(text);
    return !ids.includes(targetId);
  });
}

function replacementSourceRows(session, target){
  const rows = preparedLocations(session);
  const projected = rows.filter(row=>{
    if(row.item === target.item || row.item?.reservationId || row.item?.restPass)return false;
    if(target.key === 'next')return row.key === 'expected' || row.key === 'serverStandby';
    if(target.key === 'expected'){
      return (row.key === 'expected' && row.index > target.index) || row.key === 'serverStandby';
    }
    return row.key === 'serverStandby' && row.index > target.index;
  }).map(row=>({...row, source:row.key === 'expected' ? 'expected' : 'standby', sourcePenalty:row.key === 'expected' ? 120 : 180}));
  const tail = target.key === 'next'
    ? rows.filter(row=>row.key === 'next' && row.index > target.index && !row.item?.reservationId && !row.item?.restPass)
      .map(row=>({...row, source:'tail', sourcePenalty:240}))
    : [];
  return [...projected, ...tail];
}

function clearUnavailableRestPass(item, playerId){
  if(!item?.restPass)return;
  const ownerId = typeof item.restPass === 'object' ? text(item.restPass.playerId) : '';
  if(ownerId && ownerId !== text(playerId))return;
  item.restPass = false;
  item.restPassText = '';
}

function repairPreparedForUnavailablePlayer(session, playerId, now){
  const targetId = text(playerId);
  const locations = preparedLocations(session);
  const target = locations.find(row=>queuePlayerIds(row.item).includes(targetId));
  if(!target){
    removePlayerReservations(session, targetId);
    return {found:false, keptThree:false, queueRemoved:false};
  }

  const originalTeam1 = queueTeam1Ids(target.item);
  const originalTeam2 = queueTeam2Ids(target.item);
  const targetIds = [...originalTeam1, ...originalTeam2];
  const retainedIds = targetIds.filter(id=>id !== targetId);
  const activeIds = new Set();
  (session.event.active || []).forEach(match=>activePlayerIds(match).forEach(id=>activeIds.add(id)));
  const preparedIds = new Set();
  locations.forEach(row=>queuePlayerIds(row.item).forEach(id=>preparedIds.add(id)));
  const reservedIds = new Set();
  (session.reservations || []).forEach(row=>{
    [...(row?.team1 || []), ...(row?.team2 || [])].map(text).forEach(id=>reservedIds.add(id));
  });
  const candidates = [];
  (session.players || []).forEach(player=>{
    const id = text(player?.id);
    if(
      !id || id === targetId || retainedIds.includes(id) ||
      normalizeStatus(player?.status) !== 'wait' || player?.currentMatchId ||
      activeIds.has(id) || preparedIds.has(id) || reservedIds.has(id)
    )return;
    candidates.push({player, source:'free', sourcePenalty:0, sourceRow:null});
  });
  replacementSourceRows(session, target).forEach(sourceRow=>{
    const sourceIds = queuePlayerIds(sourceRow.item);
    if(sourceIds.some(id=>retainedIds.includes(id)))return;
    sourceIds.forEach(id=>{
      const player = playerById(session, id);
      if(!player || normalizeStatus(player.status) !== 'wait' || player.currentMatchId)return;
      candidates.push({
        player,
        source:sourceRow.source,
        sourcePenalty:sourceRow.sourcePenalty,
        sourceRow
      });
    });
  });

  let best = null;
  const seen = new Set();
  candidates.forEach(candidate=>{
    const candidateId = text(candidate.player?.id);
    if(!candidateId || seen.has(candidateId))return;
    seen.add(candidateId);
    const team1 = originalTeam1.map(id=>id === targetId ? candidateId : id);
    const team2 = originalTeam2.map(id=>id === targetId ? candidateId : id);
    const pairing = preparedPairing(session, team1, team2, {now, allowFlexible:true});
    if(!pairing)return;
    const strictRank = pairing.flexible ? 1 : 0;
    const score = number(pairing.score) + candidate.sourcePenalty;
    const tieKey = `${candidateId}|${candidate.source}`;
    if(
      !best ||
      strictRank < best.strictRank ||
      (strictRank === best.strictRank && score < best.score) ||
      (strictRank === best.strictRank && score === best.score && tieKey < best.tieKey)
    ){
      best = {...candidate, pairing, strictRank, score, tieKey};
    }
  });

  locations.forEach(row=>{
    if(row.item === target.item || !queuePlayerIds(row.item).includes(targetId))return;
    clearPreparedReservation(session, row.item);
    session.event[row.key] = session.event[row.key].filter(item=>item !== row.item);
  });
  clearPreparedReservation(session, target.item);
  removePlayerReservations(session, targetId);

  if(!best){
    session.event[target.key] = session.event[target.key].filter(item=>item !== target.item);
    return {
      found:true,
      keptThree:false,
      queueRemoved:true,
      queueId:text(target.item?.queueId || target.item?.id)
    };
  }

  if(best.sourceRow){
    session.event[best.sourceRow.key] = session.event[best.sourceRow.key].filter(item=>item !== best.sourceRow.item);
  }
  const team1Ids = best.pairing.team1.map(player=>text(player.id));
  const team2Ids = best.pairing.team2.map(player=>text(player.id));
  if(!writePreparedTeams(session, target.item, team1Ids, team2Ids, best.pairing)){
    session.event[target.key] = session.event[target.key].filter(item=>item !== target.item);
    return {
      found:true,
      keptThree:false,
      queueRemoved:true,
      queueId:text(target.item?.queueId || target.item?.id)
    };
  }
  clearUnavailableRestPass(target.item, targetId);
  target.item.replacementAt = now;
  target.item.replacedPlayerId = targetId;
  target.item.replacementPlayerId = text(best.player.id);
  target.item.replacementSource = best.source;
  return {
    found:true,
    keptThree:true,
    queueRemoved:false,
    queueId:text(target.item?.queueId || target.item?.id),
    replacementPlayerId:text(best.player.id),
    replacementSource:best.source
  };
}

function promotePrepared(session){
  removeInvalidPrepared(session);
  const event = session.event;
  const target = Math.max(0, number(event.nextTarget || event.queuePolicy?.official || event.next.length));
  const used = new Set();
  event.active.forEach(match=>activePlayerIds(match).forEach(id=>used.add(id)));
  event.next.forEach(item=>queuePlayerIds(item).forEach(id=>used.add(id)));

  while(event.next.length < target){
    let found = null;
    for(const key of ['expected', 'serverStandby']){
      const index = event[key].findIndex(item=>{
        const ids = queuePlayerIds(item);
        return queueReady(session, item) && !ids.some(id=>used.has(id));
      });
      if(index >= 0){
        found = event[key].splice(index, 1)[0];
        break;
      }
    }
    if(!found)break;
    found.expected = false;
    found.cueState = 'normal';
    event.next.push(found);
    queuePlayerIds(found).forEach(id=>used.add(id));
  }

  const expectedGoal = Math.max(0, number(event.serverExpectedGoal, event.expected.length));
  while(event.expected.length < expectedGoal && event.serverStandby.length){
    const item = event.serverStandby.shift();
    item.expected = true;
    item.cueState = 'expected';
    event.expected.push(item);
  }
}

function refreshEvent(session, now){
  const event = session.event;
  const timerNow = event.paused ? number(event.pausedAt, now) : now;
  const courts = Math.max(1, number(event.courts, 1));
  event.active = event.active.filter(match=>match && !match.completedAt && !match.cancelledAt);
  event.active.forEach(match=>{
    const info = timerInfo(match, timerNow);
    match.endAt = info.endAt;
    match.remain = info.remain;
    match.timerState = info.state;
  });
  event.active.sort((a,b)=>number(a.court)-number(b.court));

  const activeSorted = event.active.slice().sort((a,b)=>{
    const transition = Number(!!a.transitionStarted) - Number(!!b.transitionStarted);
    if(transition)return transition;
    return timerInfo(a, timerNow).endAt - timerInfo(b, timerNow).endAt || number(a.court) - number(b.court);
  });
  const usedCourts = new Set(event.active.map(match=>number(match.court)).filter(Boolean));
  const freeCourts = [];
  for(let court=1; court<=courts; court++)if(!usedCourts.has(court))freeCourts.push(court);

  let usable = 0;
  event.next.forEach((item, index)=>{
    item.idx = index + 1;
    item.expected = false;
    if(event.paused){
      item.cueState = 'paused';
      item.cue = '진행 일시 정지';
      item.cueDetail = '재개 후 순서 유지';
      item.targetCourt = null;
      item.targetMatchId = '';
      item.targetHoldId = '';
      return;
    }
    const restPass = !!item.restPass;
    if(restPass && usable < freeCourts.length){
      item.cueState = 'hold';
      item.cue = '조금 쉬고';
      item.cueDetail = '';
      item.targetCourt = null;
      item.targetMatchId = '';
      item.targetHoldId = '';
      return;
    }
    if(usable < freeCourts.length){
      const court = freeCourts[usable++];
      const hold = session.serverRuntime.holds[text(court)] || null;
      item.cueState = 'free';
      item.cue = `${court}코트`;
      item.cueDetail = '입장 가능';
      item.targetCourt = court;
      item.targetMatchId = '';
      item.targetHoldId = hold?.id || '';
      item.targetHoldAt = number(hold?.createdAt);
      return;
    }
    const match = activeSorted[usable++ - freeCourts.length];
    if(!match){
      item.cueState = 'normal';
      item.cue = '코트 배정 대기';
      item.cueDetail = '진행중 경기 없음';
      item.targetCourt = null;
      item.targetMatchId = '';
      item.targetHoldId = '';
      return;
    }
    const info = timerInfo(match, timerNow);
    item.targetCourt = match.court;
    item.targetMatchId = match.id;
    item.targetHoldId = '';
    if(match.transitionStarted){
      item.cueState = 'handoff';
      item.cue = `${match.court}코트`;
      item.cueDetail = '';
    }else if(info.state === 'due'){
      item.cueState = 'due';
      item.cue = `${match.court}코트`;
      item.cueDetail = '입장';
    }else if(info.state === 'soon'){
      item.cueState = 'soon';
      item.cue = `${match.court}코트`;
      item.cueDetail = `${info.remain}분`;
    }else{
      item.cueState = 'normal';
      item.cue = `${match.court}코트`;
      item.cueDetail = '경기 후';
    }
  });
  event.expected.forEach((item, index)=>{
    item.idx = event.next.length + index + 1;
    item.expected = true;
    item.cueState = 'expected';
    item.cue = '예상 대진';
    item.cueDetail = item.cueDetail || '예상 · 바뀔 수 있어요';
    item.targetCourt = null;
    item.targetMatchId = '';
    item.targetHoldId = '';
  });

  const queuedIds = new Set();
  [...event.next, ...event.expected].forEach(item=>queuePlayerIds(item).forEach(id=>queuedIds.add(id)));
  const waiting = session.players.filter(player=>normalizeStatus(player.status) === 'wait' && !player.currentMatchId);
  event.activeCount = event.active.length;
  event.queuePolicy.queued = event.next.length;
  event.queuePolicy.expected = event.expected.length;
  event.queuePolicy.eligible = waiting.length;
  event.queuePolicy.ready = waiting.filter(player=>!queuedIds.has(text(player.id))).length;
  event.queuePolicy.readyTotal = waiting.length;
  event.queuePolicy.finishComplete = !!(event.finishMode && !event.next.length);
  event.queuePolicy.detail = event.queuePolicy.finishComplete
    ? '마무리 완료 · 빈 코트는 자율게임'
    : event.next.length
      ? (event.finishMode ? `남은 대진 ${event.next.length}경기` : `다음 ${event.next.length}경기 준비됨`)
      : `미편성 ${event.queuePolicy.ready}명 · 대진 후보 ${waiting.length}명`;
  event.updatedAt = now;
  return session;
}

function validateCommon(session, request, now, options){
  if(session?.capabilities?.officialOpsServerV2 !== true)return {skip:true};
  if(!SUPPORTED_TYPES.has(request.type))return {reason:'지원하지 않는 임원 운영 요청입니다.'};
  const sessionId=text(session.serverSessionId||options?.checkinId);
  const grant=verifyOfficialGrant(request.officialGrantToken,options?.grantSecret,sessionId,now);
  if(grant.skip)return {skip:true};
  if(grant.reason)return {reason:grant.reason};
  if(grant.payload?.pid && text(grant.payload.pid) !== text(request.actorPlayerId)){
    return {reason:'운영 권한은 선택한 임원 본인만 사용할 수 있습니다.'};
  }
  const actor = playerById(session, request.actorPlayerId);
  if(!actor || !actor.isClubOfficial)return {reason:'현재 참가 중인 클럽 임원만 운영 지원을 사용할 수 있습니다.'};
  const createdAt = number(request.createdAt);
  const expiresAt = number(request.expiresAt, createdAt + OFFICIAL_OPERATION_TTL_MS);
  if(!createdAt || createdAt > now + 5 * 60 * 1000 || now > expiresAt || now - createdAt > OFFICIAL_OPERATION_TTL_MS){
    return {reason:'운영 요청 시간이 지나 현재 상태를 다시 확인해야 합니다.'};
  }
  if(number(session.expiresAt) && now >= number(session.expiresAt))return {reason:'종료된 민턴LIVE 링크입니다.'};
  if(session.event?.paused && PAUSED_FLOW_TYPES.has(request.type)){
    return {reason:'현재 진행이 일시 정지되어 있습니다. 재개 후 다시 처리해 주세요.'};
  }
  return {actor};
}

function applyArrival(session, request, now){
  const player = playerById(session, request.playerId);
  if(!player)return '참가 등록할 선수를 찾지 못했습니다.';
  if(!['invited', 'planned'].includes(text(player.status)))return '이미 참가 상태가 바뀐 선수입니다.';
  if(text(request.expectedStatus) !== text(player.status))return '선수 상태가 이미 바뀌었습니다.';
  if(number(request.expectedLastStatusAt) !== number(player.lastStatusAt))return '선수 상태가 이미 바뀌었습니다.';
  player.status = 'wait';
  player.statusLabel = statusLabel('wait');
  player.locked = false;
  player.currentMatchId = '';
  player.afterMatchStatus = '';
  player.joinedAt = now;
  player.waitFrom = now;
  player.lastStatusAt = now;
  player.restPausedMs = 0;
  player.arrivalConfirmedBy = request.actorPlayerId;
  player.arrivalConfirmedByName = request.actorPlayerName || '';
  player.arrivalConfirmedAt = now;
  player.arrivalConfirmedSource = 'club-official-arrival';
  session.arrivalCandidates = session.arrivalCandidates.filter(item=>text(item.candidateKey) !== text(request.candidateKey));
  return '';
}

function applyPlayerAdd(session, request, now){
  const candidate = session.arrivalCandidates.find(item=>text(item.candidateKey) === text(request.candidateKey) && item.kind === 'roster');
  if(!candidate || text(candidate.memberId) !== text(request.memberId))return '현재 클럽 명부에서 참가 등록할 선수를 찾지 못했습니다.';
  if(text(candidate.name).trim() !== text(request.expectedName).trim())return '클럽 명부 정보가 이미 바뀌었습니다.';
  if(playerById(session, request.playerId) || session.players.some(player=>text(player.memberId) === text(request.memberId))){
    return '이미 오늘 명단에 있는 선수입니다.';
  }
  const player = {
    id: request.playerId,
    memberId: candidate.memberId || request.memberId || '',
    name: candidate.name || request.playerName || '',
    grade: candidate.grade || 'C',
    level: number(candidate.level, 4),
    gender: candidate.gender === 'F' || candidate.gender === '여' ? 'F' : 'M',
    ageGroup: candidate.ageGroup || '40대',
    club: candidate.club || '',
    status: 'wait',
    statusLabel: statusLabel('wait'),
    games: 0,
    mixedGames: 0,
    typeTrackedGames: 0,
    partnerCountById: {},
    opponentCountById: {},
    isGuest: false,
    isClubOfficial: !!candidate.isClubOfficial,
    locked: false,
    currentMatchId: '',
    afterMatchStatus: '',
    joinedAt: now,
    waitFrom: now,
    lastStatusAt: now,
    restPausedMs: 0,
    arrivalConfirmedBy: request.actorPlayerId,
    arrivalConfirmedByName: request.actorPlayerName || '',
    arrivalConfirmedAt: now,
    arrivalConfirmedSource: 'club-official-arrival'
  };
  session.players.push(player);
  session.arrivalCandidates = session.arrivalCandidates.filter(item=>text(item.candidateKey) !== text(request.candidateKey));
  return '';
}

function applyPlayerStatus(session, request, now, operation){
  const player = playerById(session, request.playerId);
  if(!player)return '상태를 바꿀 선수를 찾지 못했습니다.';
  const rawStatus = text(request.status);
  if(!['wait', 'rest', 'done'].includes(rawStatus))return '알 수 없는 선수 상태입니다.';
  const nextStatus = rawStatus;
  if(['invited', 'planned'].includes(normalizeStatus(player.status)))return '지각 선수는 참가 등록에서 처리해 주세요.';
  const playing = normalizeStatus(player.status) === 'playing' || !!player.currentMatchId;
  if(playing){
    if(!['rest', 'done'].includes(nextStatus))return '경기중에는 경기 후 휴식 또는 종료만 표시할 수 있습니다.';
    if(text(request.expectedStatus) !== 'playing')return '선수의 진행 상태를 다시 확인해 주세요.';
    if(!text(request.expectedCurrentMatchId) || text(request.expectedCurrentMatchId) !== text(player.currentMatchId))return '선수의 진행 경기가 이미 바뀌었습니다.';
    if(!Object.prototype.hasOwnProperty.call(request, 'expectedLastStatusAt') || number(request.expectedLastStatusAt) !== number(player.lastStatusAt))return '선수 상태가 이미 바뀌었습니다.';
    player.afterMatchStatus = nextStatus;
    player.lastStatusAt = now;
    const queueRepair = repairPreparedForUnavailablePlayer(session, player.id, now);
    promotePrepared(session);
    if(operation)operation.result = {playerStatus:{playerId:text(player.id), status:nextStatus, afterMatch:true, queueRepair}};
    return '';
  }
  if(!Object.prototype.hasOwnProperty.call(request, 'expectedLastStatusAt') || number(request.expectedLastStatusAt) !== number(player.lastStatusAt))return '선수 상태가 이미 바뀌었습니다.';
  if(normalizeStatus(player.status) === 'done' && nextStatus === 'rest')return '운동 종료 선수는 먼저 복귀로 처리해 주세요.';
  player.status = nextStatus;
  player.statusLabel = statusLabel(nextStatus);
  player.locked = false;
  player.currentMatchId = '';
  player.afterMatchStatus = '';
  player.lastStatusAt = now;
  player.restPausedMs = 0;
  if(nextStatus === 'wait')player.waitFrom = now;
  const queueRepair = nextStatus !== 'wait'
    ? repairPreparedForUnavailablePlayer(session, player.id, now)
    : {found:false, keptThree:false, queueRemoved:false};
  promotePrepared(session);
  if(operation)operation.result = {playerStatus:{playerId:text(player.id), status:nextStatus, afterMatch:false, queueRepair}};
  return '';
}

function preparedQueueItem(raw){
  const item = clone(raw || {});
  ['idx','expected','cue','cueDetail','cueState','targetCourt','targetMatchId','targetHoldId','targetHoldAt'].forEach(key=>delete item[key]);
  item.restPass = false;
  item.restPassText = '';
  return item;
}

function preparedQueueSyncItem(raw){
  const item = clone(raw || {});
  ['idx','expected','cue','cueDetail','cueState','targetCourt','targetMatchId','targetHoldId','targetHoldAt'].forEach(key=>delete item[key]);
  if(!item.restPass){
    item.restPass = null;
    item.restPassText = '';
  }
  return item;
}

function preparedQueueSync(session){
  return {
    nextTarget:Math.max(0, number(session.event?.nextTarget)),
    next:(session.event?.next || []).map(preparedQueueSyncItem)
  };
}

function queueResult(item, queueIndex){
  return {
    queue:preparedQueueItem(item),
    queueId:text(item?.queueId || item?.id),
    queueIndex:number(queueIndex),
    playerIds:queuePlayerIds(item),
    team1Ids:queueTeam1Ids(item),
    team2Ids:queueTeam2Ids(item)
  };
}

function startPreparedItem(session, item, index, court, now, requestId, options = {}){
  const event = session.event;
  if(index < 0 || event.next[index] !== item || event.active.some(match=>number(match.court) === number(court)) || !queueReady(session, item))return null;
  const runtime = session.serverRuntime;
  const maxSeq = event.active.reduce((max, match)=>Math.max(max, number(match.seq)), number(event.completed));
  runtime.nextSeq = Math.max(number(runtime.nextSeq), maxSeq + 1);
  const matchId = options.autoHandoff
    ? `sm_${safeId(requestId)}`
    : text(options.matchId) || `sm_${safeId(requestId)}`;
  const team1Ids = queueTeam1Ids(item);
  const team2Ids = queueTeam2Ids(item);
  const ids = queuePlayerIds(item);
  const names = list=>list.map(id=>playerById(session, id)?.name || '선수');
  const reservation = item.reservationId
    ? session.reservations.find(row=>text(row?.id) === text(item.reservationId)) || null
    : null;
  const queueSnapshot = preparedQueueItem(item);
  const playerStates = ids.map(id=>{
    const player=playerById(session,id);
    return player?clone({
      id,
      status:player.status,
      statusLabel:player.statusLabel,
      locked:player.locked,
      currentMatchId:player.currentMatchId,
      afterMatchStatus:player.afterMatchStatus,
      waitFrom:player.waitFrom,
      lastStatusAt:player.lastStatusAt
    }):{id,status:'wait',statusLabel:statusLabel('wait'),locked:false,currentMatchId:'',afterMatchStatus:'',waitFrom:now,lastStatusAt:now};
  });
  event.next.splice(index, 1);
  const match = {
    id:matchId,
    court:number(court),
    seq:runtime.nextSeq++,
    type:item.type || '예외',
    teamMode:!!item.teamMode,
    labelA:item.labelA || 'A팀',
    labelB:item.labelB || 'B팀',
    t1:item.t1 || names(team1Ids),
    t2:item.t2 || names(team2Ids),
    t1Ids:team1Ids,
    t2Ids:team2Ids,
    playerIds:ids,
    startedAt:now,
    expectedMinutes:MATCH_MINUTES,
    endAt:now + MATCH_MINUTES * 60000,
    remain:MATCH_MINUTES,
    timerState:'normal',
    transitionStarted:false,
    reservationId:item.reservationId || null,
    reservationLabel:item.reservationLabel || reservation?.label || null,
    reservationMode:item.reservationMode || reservation?.mode || null,
    serverStartedBy:options.actorPlayerId || '',
    serverRequestId:requestId
  };
  if(options.autoHandoff){
    match.autoHandoffAt = now;
    match.autoHandoffExpiresAt = now + AUTO_HANDOFF_WINDOW_MS;
    match.autoHandoffSource = options.autoHandoffSource || 'official-complete';
    match.autoHandoffSourceMatchId = options.sourceMatchId || '';
    match.autoHandoffSourceRequestId = requestId;
    match.autoHandoffQueueIndex = number(options.queueIndex, index + 1);
    match.autoHandoffQueue = queueSnapshot;
    match.autoHandoffPlayerStates = playerStates;
    if(reservation)match.autoHandoffReservation = clone(reservation);
  }
  event.active.push(match);
  ids.forEach(id=>{
    const player = playerById(session, id);
    player.status = 'playing';
    player.statusLabel = statusLabel('playing');
    player.locked = true;
    player.currentMatchId = matchId;
    player.afterMatchStatus = '';
    player.lastStatusAt = now;
    player.restPausedMs = 0;
  });
  if(item.reservationId)session.reservations = session.reservations.filter(row=>text(row.id) !== text(item.reservationId));
  delete runtime.holds[text(court)];
  promotePrepared(session);
  refreshEvent(session, now);
  return match;
}

function applyComplete(session, request, now, requestId, operation){
  refreshEvent(session, now);
  const event = session.event;
  const index = event.active.findIndex(match=>text(match.id) === text(request.matchId));
  if(index < 0)return '종료할 진행중 경기를 찾지 못했습니다.';
  const match = event.active[index];
  if(number(request.expectedStartedAt) !== number(match.startedAt))return '코트의 진행 경기가 이미 바뀌었습니다.';
  if((request.expectedPlayerIds || []).length !== 4 || idsFingerprint(request.expectedPlayerIds) !== idsFingerprint(activePlayerIds(match))){
    return '코트의 선수 구성이 이미 바뀌었습니다.';
  }
  const autoHandoffEnabled = session.capabilities?.officialAutoHandoffV1 === true;
  const team1 = queueTeam1Ids(match).map(id=>playerById(session,id)).filter(Boolean);
  const team2 = queueTeam2Ids(match).map(id=>playerById(session,id)).filter(Boolean);
  event.active.splice(index, 1);
  activePlayerIds(match).forEach(id=>{
    const player = playerById(session, id);
    if(!player)return;
    const nextStatus = ['rest', 'done'].includes(normalizeStatus(player.afterMatchStatus))
      ? normalizeStatus(player.afterMatchStatus)
      : 'wait';
    player.games = number(player.games) + 1;
    player.typeTrackedGames = number(player.typeTrackedGames) + 1;
    if(text(match.type) === '혼복')player.mixedGames = number(player.mixedGames) + 1;
    player.lastPlayedSeq = number(match.seq);
    player.status = nextStatus;
    player.statusLabel = statusLabel(nextStatus);
    player.locked = false;
    player.currentMatchId = '';
    player.afterMatchStatus = '';
    player.lastStatusAt = now;
    if(nextStatus === 'wait')player.waitFrom = now;
    else repairPreparedForUnavailablePlayer(session, player.id, now);
  });
  if(team1.length === 2){
    incrementPlayerRelationship(team1[0], 'partnerCount', team1[1]);
    incrementPlayerRelationship(team1[1], 'partnerCount', team1[0]);
  }
  if(team2.length === 2){
    incrementPlayerRelationship(team2[0], 'partnerCount', team2[1]);
    incrementPlayerRelationship(team2[1], 'partnerCount', team2[0]);
  }
  team1.forEach(a=>team2.forEach(b=>{
    incrementPlayerRelationship(a, 'opponentCount', b);
    incrementPlayerRelationship(b, 'opponentCount', a);
  }));
  event.completed = number(event.completed) + 1;
  recordCompletedMatchHistory(session, match);
  const court = number(match.court || request.court);
  if(court){
    session.serverRuntime.holds[text(court)] = {
      id: `${text(match.id)}:${now}`,
      court,
      sourceMatchId: match.id,
      createdAt: now,
      actorPlayerId: request.actorPlayerId
    };
  }
  promotePrepared(session);
  replenishPrepared(session, {now, requestId});
  refreshEvent(session, now);
  let autoEntered = null;
  if(autoHandoffEnabled && court && !event.active.some(row=>number(row.court) === court)){
    const nextIndex = event.next.findIndex(item=>number(item.targetCourt) === court && item.cueState === 'free' && queueReady(session, item) && !item.restPass);
    const item = nextIndex >= 0 ? event.next[nextIndex] : null;
    if(item){
      autoEntered = startPreparedItem(session, item, nextIndex, court, now, requestId, {
        actorPlayerId:request.actorPlayerId,
        autoHandoff:true,
        autoHandoffSource:'official-complete',
        sourceMatchId:match.id,
        queueIndex:nextIndex + 1
      });
    }
  }
  if(operation){
    operation.result = {
      completedMatchId:text(match.id),
      court,
      autoEntered:!!autoEntered,
      ...(autoEntered?{autoEnter:{
        ...queueResult(autoEntered.autoHandoffQueue, autoEntered.autoHandoffQueueIndex),
        matchId:autoEntered.id,
        court:autoEntered.court,
        startedAt:autoEntered.startedAt,
        expiresAt:autoEntered.autoHandoffExpiresAt,
        sourceMatchId:text(match.id),
        reservation:autoEntered.autoHandoffReservation || null,
        playerStates:autoEntered.autoHandoffPlayerStates || []
      }}:{})
    };
  }
  return '';
}

function applyQueueEnter(session, request, now, requestId){
  refreshEvent(session, now);
  const event = session.event;
  const index = event.next.findIndex(item=>text(item.queueId || item.id) === text(request.queueId));
  if(index < 0)return '입장할 다음 대진을 찾지 못했습니다.';
  const item = event.next[index];
  const ids = queuePlayerIds(item);
  if((request.expectedPlayerIds || []).length !== 4)return '다음 대진 선수 구성을 다시 확인해 주세요.';
  if((request.expectedTeam1Ids || []).length !== 2 || (request.expectedTeam2Ids || []).length !== 2){
    return '다음 대진 팀 구성을 다시 확인해 주세요.';
  }
  if(!Object.prototype.hasOwnProperty.call(request, 'expectedQueueIndex') || number(request.expectedQueueIndex) !== index + 1){
    return '다음 대진 순서가 이미 바뀌었습니다.';
  }
  if(ids.length !== 4 || idsFingerprint(request.expectedPlayerIds) !== idsFingerprint(ids))return '다음 대진 선수가 이미 바뀌었습니다.';
  if(teamsFingerprint(request.expectedTeam1Ids, request.expectedTeam2Ids) !== teamsFingerprint(queueTeam1Ids(item), queueTeam2Ids(item))){
    return '다음 대진 팀 구성이 이미 바뀌었습니다.';
  }
  const court = number(request.court);
  if(item.cueState !== 'free' || number(item.targetCourt) !== court)return '입장할 빈 코트가 이미 바뀌었습니다.';
  if(text(request.expectedHoldId) !== text(item.targetHoldId))return '입장할 코트의 종료 연결이 이미 바뀌었습니다.';
  if(event.active.some(match=>number(match.court) === court))return '선택한 코트에서 이미 다른 경기가 진행 중입니다.';
  if(text(request.newMatchId) && event.active.some(match=>text(match.id) === text(request.newMatchId)))return '이미 사용 중인 경기 번호입니다.';
  if(!queueReady(session, item))return '다음 대진 선수 상태가 바뀌었습니다.';

  return startPreparedItem(session, item, index, court, now, requestId, {
    matchId:request.newMatchId,
    actorPlayerId:request.actorPlayerId
  }) ? '' : '입장할 다음 대진 상태가 이미 바뀌었습니다.';
}

function applyActiveYield(session, request, now, requestId, operation){
  refreshEvent(session, now);
  const event = session.event;
  if(session.capabilities?.officialAutoHandoffV1 !== true)return '자동 투입된 경기만 이번만 뒤로 보낼 수 있습니다.';
  const matchIndex = event.active.findIndex(match=>text(match.id) === text(request.matchId));
  if(matchIndex < 0)return '뒤로 보낼 진행중 경기를 찾지 못했습니다.';
  const match = event.active[matchIndex];
  if(!number(match.autoHandoffAt) || !number(match.autoHandoffExpiresAt) || now >= number(match.autoHandoffExpiresAt)){
    return '이번만 뒤로 처리할 수 있는 2분이 지났습니다.';
  }
  if(number(request.expectedStartedAt) !== number(match.startedAt) || number(request.expectedAutoHandoffAt) !== number(match.autoHandoffAt)){
    return '코트의 진행 경기가 이미 바뀌었습니다.';
  }
  const ids = activePlayerIds(match);
  if((request.expectedPlayerIds || []).length !== 4 || idsFingerprint(request.expectedPlayerIds) !== idsFingerprint(ids)){
    return '코트의 선수 구성이 이미 바뀌었습니다.';
  }
  if(teamsFingerprint(request.expectedTeam1Ids, request.expectedTeam2Ids) !== teamsFingerprint(match.t1Ids, match.t2Ids)){
    return '코트의 팀 구성이 이미 바뀌었습니다.';
  }
  if(ids.some(id=>{
    const player=playerById(session,id);
    return !player || text(player.currentMatchId) !== text(match.id) || !!player.afterMatchStatus;
  }))return '선수 상태가 이미 바뀌어 대진을 그대로 뒤로 보낼 수 없습니다.';

  const deferred = preparedQueueItem(match.autoHandoffQueue);
  if(queuePlayerIds(deferred).length !== 4 || idsFingerprint(queuePlayerIds(deferred)) !== idsFingerprint(ids)){
    return '방금 자동 투입된 대진 정보를 복원하지 못했습니다.';
  }
  const court = number(match.court || request.court);
  const savedStateRows = Array.isArray(match.autoHandoffPlayerStates) ? match.autoHandoffPlayerStates : [];
  const savedStates = new Map(savedStateRows.map(row=>[text(row?.id),row]));
  event.active.splice(matchIndex, 1);
  ids.forEach(id=>{
    const player=playerById(session,id);
    const saved=savedStates.get(text(id))||{};
    player.status=normalizeStatus(saved.status||'wait');
    player.statusLabel=saved.statusLabel||statusLabel(player.status);
    player.locked=!!saved.locked;
    player.currentMatchId=text(saved.currentMatchId);
    player.afterMatchStatus=text(saved.afterMatchStatus);
    if(Object.prototype.hasOwnProperty.call(saved,'waitFrom'))player.waitFrom=saved.waitFrom;
    if(Object.prototype.hasOwnProperty.call(saved,'lastStatusAt'))player.lastStatusAt=saved.lastStatusAt;
  });
  if(match.autoHandoffReservation && !session.reservations.some(row=>text(row.id) === text(match.autoHandoffReservation.id))){
    session.reservations.push(clone(match.autoHandoffReservation));
  }
  deferred.yieldedAt=now;
  deferred.yieldedBy=request.actorPlayerId;
  deferred.yieldedSource='server-club-official-active-yield';
  deferred.yieldedCount=number(deferred.yieldedCount)+1;
  deferred.restPass=false;
  deferred.restPassText='';
  promotePrepared(session);
  replenishPrepared(session, {now, requestId, excludeIds:ids});
  refreshEvent(session,now);
  const replacementIndex = event.next.findIndex(item=>number(item.targetCourt) === court && item.cueState === 'free' && !item.restPass && queueReady(session,item));
  if(replacementIndex < 0)return '바로 투입할 다음 대진이 없어 이번 경기를 뒤로 보낼 수 없습니다.';
  const replacement = event.next[replacementIndex];
  const replacementId = text(replacement.queueId || replacement.id);
  const target=replacementIndex+2;
  deferred.yieldedToIndex=target;
  event.next.splice(target-1,0,deferred);
  const nextIndex=event.next.findIndex(item=>text(item.queueId || item.id) === replacementId);
  const replacementItem=nextIndex>=0?event.next[nextIndex]:null;
  const autoEntered=replacementItem?startPreparedItem(session,replacementItem,nextIndex,court,now,requestId,{
    actorPlayerId:request.actorPlayerId,
    autoHandoff:true,
    autoHandoffSource:'official-active-yield',
    sourceMatchId:match.id,
    queueIndex:replacementIndex+1
  }):null;
  if(!autoEntered)return '대체할 다음 대진 상태가 이미 바뀌었습니다.';
  const deferredIndex=event.next.findIndex(item=>text(item.queueId || item.id) === text(deferred.queueId || deferred.id));
  if(operation){
    operation.result={
      cancelledMatchId:text(match.id),
      court,
      deferred:queueResult(deferred,deferredIndex+1),
      deferredReservation:match.autoHandoffReservation || null,
      autoEntered:true,
      autoEnter:{
        ...queueResult(autoEntered.autoHandoffQueue,autoEntered.autoHandoffQueueIndex),
        matchId:autoEntered.id,
        court:autoEntered.court,
        startedAt:autoEntered.startedAt,
        expiresAt:autoEntered.autoHandoffExpiresAt,
        sourceMatchId:text(match.id),
        reservation:autoEntered.autoHandoffReservation || null,
        playerStates:autoEntered.autoHandoffPlayerStates || []
      }
    };
  }
  return '';
}

function applyQueueYield(session, request, now){
  refreshEvent(session, now);
  const list = session.event.next;
  const index = list.findIndex(item=>text(item.queueId || item.id) === text(request.queueId));
  if(index < 0)return '뒤로 보낼 다음 대진을 찾지 못했습니다.';
  const item = list[index];
  if(number(request.expectedQueueIndex) !== index + 1)return '다음 대진 순서가 이미 바뀌었습니다.';
  if(idsFingerprint(request.expectedPlayerIds) !== idsFingerprint(queuePlayerIds(item)))return '다음 대진 선수가 이미 바뀌었습니다.';
  if(teamsFingerprint(request.expectedTeam1Ids, request.expectedTeam2Ids) !== teamsFingerprint(queueTeam1Ids(item), queueTeam2Ids(item))){
    return '다음 대진 팀 구성이 이미 바뀌었습니다.';
  }
  const target = index + 2;
  if(target > list.length)return '뒤에 보낼 다음 대진이 없습니다.';
  if(Object.prototype.hasOwnProperty.call(request, 'targetQueueIndex') && number(request.targetQueueIndex) !== target){
    return '이번만 뒤로는 한 순번만 이동할 수 있습니다.';
  }
  if(Object.prototype.hasOwnProperty.call(request, 'expectedCueState')){
    if(text(request.expectedCueState) !== text(item.cueState))return '빈 코트 입장 순서가 이미 바뀌었습니다.';
    if(item.cueState === 'free'){
      if(number(request.expectedTargetCourt) !== number(item.targetCourt))return '입장 대기 코트가 이미 바뀌었습니다.';
      if(text(request.expectedHoldId) !== text(item.targetHoldId))return '입장할 코트의 종료 연결이 이미 바뀌었습니다.';
    }
  }
  list.splice(index, 1);
  item.yieldedAt = now;
  item.yieldedBy = request.actorPlayerId;
  item.yieldedSource = 'server-club-official-queue-yield';
  item.yieldedCount = number(item.yieldedCount) + 1;
  item.yieldedFromIndex = index + 1;
  item.yieldedToIndex = target;
  item.yieldedSteps = 1;
  item.restPass = false;
  item.restPassText = '';
  list.splice(target - 1, 0, item);
  refreshEvent(session, now);
  return '';
}

function reservationIds(reservation){
  return [...(reservation?.team1 || []), ...(reservation?.team2 || [])].map(text).filter(Boolean);
}

function applyPartnerReservation(session, request, now, requestId, operation){
  const ids = (request.playerIds || []).map(text).filter(Boolean);
  if(ids.length !== 2 || new Set(ids).size !== 2)return '파트너 접수 선수 두 명을 다시 확인해야 합니다.';
  if(session.event.finishMode)return '마무리 중에는 새 파트너 요청을 받지 않습니다.';
  const players = ids.map(id=>playerById(session, id));
  if(players.some(player=>!player))return '파트너 접수 선수가 현재 명단에 없습니다.';
  if(players.some(player=>['invited','planned','done'].includes(normalizeStatus(player.status))))return '현재 운동 중인 선수만 파트너로 접수할 수 있습니다.';
  if(partnerGap(players) >= PARTNER_GAP_HARD)return '두 선수의 실력 차가 커서 공정한 자동 대진으로 편성하기 어렵습니다.';
  if(ids.some(id=>session.reservations.some(reservation=>reservationIds(reservation).includes(id))))return '이미 다른 게임신청에 포함된 선수가 있습니다.';
  const names = players.map(player=>player.name || '선수');
  const statusText = players.some(player=>normalizeStatus(player.status) === 'playing')
    ? '현재 경기 후 반영 대기'
    : players.some(player=>normalizeStatus(player.status) === 'rest')
      ? '복귀 후 반영 대기'
      : '대진 반영 대기';
  const reservation = {
    id:`sr_${safeId(requestId)}`,
    mode:'pair',
    team1:ids,
    team2:[],
    label:`${names.join('·')} 같은 편`,
    statusText,
    statusDetail:'기존 대진 순서 유지',
    statusClass:'queued',
    ready:true,
    createdAt:request.createdAt || now,
    source:'club-official-request',
    preserveOrder:true,
    createdByPlayerId:text(request.actorPlayerId),
    serverRequestId:requestId
  };
  session.reservations.push(reservation);
  const prepared = attachPartnerToPrepared(session, reservation);
  if(operation)operation.result = {
    reservationId:reservation.id,
    queueApplied:!!prepared,
    ...(prepared || {})
  };
  return '';
}

function applyPartnerCancel(session, request, now){
  const index = session.reservations.findIndex(item=>text(item.id) === text(request.reservationId) && item.mode !== 'match');
  if(index < 0)return '취소할 파트너 접수를 찾지 못했습니다.';
  const reservation = session.reservations[index];
  if(idsFingerprint(request.expectedPlayerIds) !== idsFingerprint(reservation.team1 || []))return '파트너 접수 선수가 이미 바뀌었습니다.';
  const reservationId = text(reservation.id);
  session.reservations.splice(index, 1);
  detachPartnerFromPrepared(session, reservationId);
  promotePrepared(session);
  refreshEvent(session, now);
  return '';
}

function applyUndo(session, request, receipts, now){
  const token = text(request.token);
  const receipt = receipts[token];
  if(!token || !receipt || !receipt.before)return {reason:'되돌릴 수 있는 운영 기록이 없습니다.'};
  if(receipt.undoneAt)return {reason:'이미 되돌린 운영 기록입니다.'};
  if(now > number(receipt.expiresAt))return {reason:'되돌릴 수 있는 시간이 지났습니다.'};
  if(number(session.serverRevision) !== number(receipt.afterRevision))return {reason:'이후 운영 상태가 바뀌어 안전하게 되돌릴 수 없습니다.'};
  if(receipt.afterFingerprint && receipt.afterFingerprint !== operationalFingerprint(session)){
    return {reason:'이후 관리자 운영 상태가 바뀌어 안전하게 되돌릴 수 없습니다.'};
  }
  const pauseControl = clone({
    paused:!!session.event?.paused,
    pausedAt:number(session.event?.pausedAt),
    pauseReason:text(session.event?.pauseReason),
    pauseRevision:number(session.event?.pauseRevision),
    resumedAt:number(session.event?.resumedAt)
  });
  session = restoreSnapshot(session, receipt.before);
  Object.assign(session.event, pauseControl);
  receipt.undoneAt = now;
  receipt.undoneBy = request.actorPlayerId;
  return {session};
}

function applyByType(session, request, now, requestId, operation){
  switch(request.type){
    case 'official-player-arrival': return applyArrival(session, request, now);
    case 'official-player-add': return applyPlayerAdd(session, request, now);
    case 'official-player-status': return applyPlayerStatus(session, request, now, operation);
    case 'official-court-complete': return applyComplete(session, request, now, requestId, operation);
    case 'official-active-yield': return applyActiveYield(session, request, now, requestId, operation);
    case 'official-queue-enter-free': return applyQueueEnter(session, request, now, requestId);
    case 'official-queue-yield': return applyQueueYield(session, request, now);
    case 'official-partner-reservation': return applyPartnerReservation(session, request, now, requestId, operation);
    case 'official-partner-cancel': return applyPartnerCancel(session, request, now);
    default: return '지원하지 않는 임원 운영 요청입니다.';
  }
}

function applyOfficialRequest(rawSession, rawRequest, options = {}){
  let session = ensureSession(rawSession);
  const request = clone(rawRequest || {});
  const now = number(options.now, Date.now());
  const requestId = text(options.requestId || request.key || request.operationId || `op_${now}`);
  const common = validateCommon(session, request, now, options);
  if(common.skip)return {status:'skipped', session:rawSession, serverOps:options.serverOps || {}};
  if(common.reason)return {status:'rejected', reason:common.reason, session:rawSession, serverOps:options.serverOps || {}};

  const receipts = pruneReceipts(options.serverOps, now);
  const beforeRevision = number(session.serverRevision);
  if(['official-court-complete-undo', 'official-operation-undo'].includes(request.type)){
    const undone = applyUndo(session, request, receipts, now);
    if(undone.reason)return {status:'rejected', reason:undone.reason, session:rawSession, serverOps:receipts};
    session = undone.session;
    session.serverRevision = beforeRevision + 1;
    session.serverUpdatedAt = now;
    session.serverLastRequestId = requestId;
    session.updatedAt = now;
    refreshEvent(session, now);
    return {
      status:'applied',
      session,
      serverOps:receipts,
      revision:session.serverRevision,
      operation:'undo',
      result:{queueSync:preparedQueueSync(session)}
    };
  }

  const before = UNDOABLE_TYPES.has(request.type) && request.token ? operationalSnapshot(session) : null;
  const operation = {result:null};
  const reason = applyByType(session, request, now, requestId, operation);
  if(reason)return {status:'rejected', reason, session:rawSession, serverOps:receipts};
  replenishPrepared(session, {now, requestId});
  session.serverRevision = beforeRevision + 1;
  session.serverUpdatedAt = now;
  session.serverLastRequestId = requestId;
  session.updatedAt = now;
  refreshEvent(session, now);
  operation.result = {
    ...(operation.result || {}),
    queueSync:preparedQueueSync(session)
  };
  if(before){
    receipts[text(request.token)] = {
      token:text(request.token),
      type:request.type,
      requestId,
      actorPlayerId:request.actorPlayerId,
      createdAt:now,
      expiresAt:now + OFFICIAL_UNDO_MS,
      afterRevision:session.serverRevision,
      afterFingerprint:operationalFingerprint(session),
      before
    };
  }
  return {status:'applied', session, serverOps:receipts, revision:session.serverRevision, operation:request.type, result:operation.result};
}

function applyMemberStatusRequest(rawSession, rawRequest, options = {}){
  const session = ensureSession(rawSession);
  const request = clone(rawRequest || {});
  const now = number(options.now, Date.now());
  const requestId = text(options.requestId || request.key || request.operationId || `member_${now}`);
  if(session?.capabilities?.memberStatusServerV1 !== true || number(session.commandProtocol) < 2){
    return {status:'skipped', session:rawSession};
  }
  if(request.type !== 'member-player-status'){
    return {status:'rejected', reason:'지원하지 않는 회원 요청입니다.', session:rawSession};
  }
  if(!text(request.actorPlayerId) || text(request.actorPlayerId) !== text(request.playerId)){
    return {status:'rejected', reason:'본인 상태만 변경할 수 있습니다.', session:rawSession};
  }
  const createdAt = number(request.createdAt);
  const expiresAt = number(request.expiresAt, createdAt + MEMBER_STATUS_TTL_MS);
  if(!createdAt || createdAt > now + 60 * 1000 || now > expiresAt || now - createdAt > MEMBER_STATUS_TTL_MS){
    return {status:'rejected', reason:'요청 시간이 지나 현재 상태를 다시 확인해야 합니다.', session:rawSession};
  }
  if(number(session.expiresAt) && now >= number(session.expiresAt)){
    return {status:'rejected', reason:'종료된 민턴LIVE 링크입니다.', session:rawSession};
  }
  if(session.event?.paused){
    return {status:'rejected', reason:'현재 진행이 일시 정지되어 있습니다. 재개 후 다시 눌러 주세요.', session:rawSession};
  }
  const player = playerById(session, request.playerId);
  if(!player)return {status:'rejected', reason:'상태를 바꿀 선수를 찾지 못했습니다.', session:rawSession};
  if(request.playerName && text(request.playerName).trim() !== text(player.name).trim()){
    return {status:'rejected', reason:'선택한 선수 정보가 이미 바뀌었습니다.', session:rawSession};
  }
  if(['invited', 'planned'].includes(normalizeStatus(player.status))){
    return {status:'rejected', reason:'지각 선수는 클럽 임원이 참가 등록해 주세요.', session:rawSession};
  }
  if(normalizeStatus(player.status) === 'playing' || player.currentMatchId){
    return {status:'rejected', reason:'경기중에는 경기 종료 후 상태를 변경해 주세요.', session:rawSession};
  }
  if(!['wait', 'rest', 'done'].includes(text(request.status))){
    return {status:'rejected', reason:'알 수 없는 선수 상태입니다.', session:rawSession};
  }
  if(
    !Object.prototype.hasOwnProperty.call(request, 'expectedStatus') ||
    text(request.expectedStatus) !== text(player.status) ||
    !Object.prototype.hasOwnProperty.call(request, 'expectedCurrentMatchId') ||
    text(request.expectedCurrentMatchId) !== text(player.currentMatchId) ||
    !Object.prototype.hasOwnProperty.call(request, 'expectedLastStatusAt') ||
    number(request.expectedLastStatusAt) !== number(player.lastStatusAt)
  ){
    return {status:'rejected', reason:'선수 상태가 이미 바뀌었습니다. 화면을 확인한 뒤 다시 눌러 주세요.', session:rawSession};
  }
  if(normalizeStatus(player.status) === normalizeStatus(request.status)){
    return {status:'rejected', reason:'이미 같은 상태입니다.', session:rawSession};
  }

  const beforeRevision = number(session.serverRevision);
  const operation = {result:null};
  const reason = applyPlayerStatus(session, request, now, operation);
  if(reason)return {status:'rejected', reason, session:rawSession};
  replenishPrepared(session, {now, requestId});
  session.serverRevision = beforeRevision + 1;
  session.serverUpdatedAt = now;
  session.serverLastRequestId = requestId;
  session.updatedAt = now;
  refreshEvent(session, now);
  const result = {
    ...(operation.result || {}),
    queueSync:preparedQueueSync(session)
  };
  return {
    status:'applied',
    session,
    revision:session.serverRevision,
    operation:request.type,
    result
  };
}

module.exports = {
  OFFICIAL_OPERATION_TTL_MS,
  MEMBER_STATUS_TTL_MS,
  OFFICIAL_UNDO_MS,
  AUTO_HANDOFF_WINDOW_MS,
  applyOfficialRequest,
  applyMemberStatusRequest,
  refreshEvent,
  queuePlayerIds,
  idsFingerprint,
  teamsFingerprint,
  canonicalJson,
  issueOfficialGrant,
  verifyOfficialGrant
};
