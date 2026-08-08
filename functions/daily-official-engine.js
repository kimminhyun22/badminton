'use strict';

const crypto = require('crypto');
const {
  FAIR_CORRECTION_GAP,
  PARTNER_GAP_HARD,
  PARTNER_GAP_CORRECTION_LIMIT,
  partnerGapSymmetryAllowed,
  TEAM_DIFF_LIMIT,
  preparedPairing,
  replenishPrepared,
  recordCompletedMatchHistory
} = require('./daily-server-matchmaker');

const OFFICIAL_OPERATION_TTL_MS = 30 * 60 * 1000;
const MEMBER_STATUS_TTL_MS = 5 * 60 * 1000;
const OFFICIAL_UNDO_MS = 45 * 1000;
const RECEIPT_RETAIN_MS = 10 * 60 * 1000;
// 처리 끝난 요청·명령 원장은 링크 노드에 계속 쌓이면 안 됩니다.
// 이 노드는 명령 한 건마다 통째로 트랜잭션(다운로드→병합→업로드)되고,
// 임원·회원 화면 모두가 /requests 를 on('value')로 통째 구독하므로
// 정리하지 않으면 운동 후반에 회원 화면 전송이 먼저 무너집니다.
const REQUEST_DONE_RETAIN_MS = 15 * 60 * 1000;
const REQUEST_STALE_RETAIN_MS = 2 * OFFICIAL_OPERATION_TTL_MS;
// 중복 차단 원장은 클라이언트 재전송 창(명령 TTL 30분)보다 조금만 길면 충분합니다.
const COMMAND_LEDGER_RETAIN_MS = OFFICIAL_OPERATION_TTL_MS + 15 * 60 * 1000;
const MAX_REQUEST_ROWS = 200;
const MAX_COMMAND_LEDGER_ROWS = 200;
const AUTO_HANDOFF_WINDOW_MS = 2 * 60 * 1000;
const MATCH_MINUTES = 15;
const TEMPORARY_OFFICIAL_LIMIT = 4;
const AGE_BONUS = Object.freeze({'20대':0,'30대':-0.2,'40대':-0.5,'50대':-1.2,'60대+':-2});

const SUPPORTED_TYPES = new Set([
  'official-player-arrival',
  'official-player-add',
  'official-player-add-cancel',
  'official-player-status',
  'official-court-complete',
  'official-active-yield',
  'official-queue-enter-free',
  'official-queue-yield',
  'official-queue-hold',
  'official-queue-resume',
  'official-queue-replace',
  'official-partner-reservation',
  'official-partner-cancel',
  'official-temporary-grant',
  'official-temporary-revoke',
  'official-settings-update',
  'official-court-cancel',
  'official-manual-match',
  'official-active-replace',
  'official-player-remove',
  'official-player-rename',
  'official-player-create',
  'official-queue-delete',
  'official-queue-regenerate',
  'official-reservation-promote',
  'official-finish-mode',
  'official-court-complete-undo',
  'official-operation-undo'
]);

const UNDOABLE_TYPES = new Set([
  'official-court-complete',
  'official-active-yield',
  'official-queue-enter-free',
  'official-queue-yield',
  'official-queue-hold',
  'official-queue-resume'
]);

const PAUSED_FLOW_TYPES = new Set([
  'official-player-arrival',
  'official-player-add',
  'official-player-add-cancel',
  'official-player-status',
  'official-court-complete',
  'official-active-yield',
  'official-queue-enter-free',
  'official-queue-yield',
  'official-queue-hold',
  'official-queue-resume',
  'official-queue-replace',
  'official-partner-reservation',
  'official-partner-cancel',
  'official-court-cancel',
  'official-manual-match',
  'official-active-replace',
  'official-player-remove',
  'official-player-create',
  'official-queue-delete',
  'official-queue-regenerate',
  'official-reservation-promote'
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
  return ({invited:'도착 전',planned:'도착 전',wait:'참가',playing:'경기중',rest:'휴식',done:'종료'})[normalizeStatus(value)] || '';
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

function isLiveOperator(player){
  return !!(player && (player.isClubOfficial || player.isTemporaryOfficial));
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

function fairnessCorrectionEligible(session, ids){
  return (ids || []).some(id=>{
    const player = playerById(session, id);
    return player && ensureFairExpected(player) - fairActual(player) >= FAIR_CORRECTION_GAP;
  });
}

function queuePairingMetrics(session, team1Ids, team2Ids, options = {}){
  const team1 = team1Ids.map(id=>playerById(session, id)).filter(Boolean);
  const team2 = team2Ids.map(id=>playerById(session, id)).filter(Boolean);
  if(team1.length !== 2 || team2.length !== 2 || teamShape(team1) !== teamShape(team2))return null;
  const fairnessCorrection = !!options.fairnessCorrection;
  const partnerLimit = fairnessCorrection ? PARTNER_GAP_CORRECTION_LIMIT : PARTNER_GAP_HARD;
  const gap1 = partnerGap(team1);
  const gap2 = partnerGap(team2);
  if(fairnessCorrection ? gap1 > partnerLimit || gap2 > partnerLimit : gap1 >= partnerLimit || gap2 >= partnerLimit)return null;
  if(!partnerGapSymmetryAllowed(team1, team2, {
    fairnessCorrection,
    reservation:options.reservation || options.reservationId
  }))return null;
  const team1Level = Math.round(teamLevel(team1) * 10) / 10;
  const team2Level = Math.round(teamLevel(team2) * 10) / 10;
  const levelDiff = Math.round(Math.abs(team1Level - team2Level) * 10) / 10;
  if(levelDiff > TEAM_DIFF_LIMIT)return null;
  if(
    fairnessCorrection &&
    (
      text(options.correctionReason) !== 'fairness-partner-gap' ||
      !fairnessCorrectionEligible(session, [...team1Ids, ...team2Ids])
    )
  )return null;
  return {team1, team2, team1Level, team2Level, levelDiff, type:teamShape(team1)};
}

function preparedQualityValid(session, item){
  const team1Ids = queueTeam1Ids(item);
  const team2Ids = queueTeam2Ids(item);
  const team1 = team1Ids.map(id=>playerById(session, id)).filter(Boolean);
  const team2 = team2Ids.map(id=>playerById(session, id)).filter(Boolean);
  if(team1.length !== 2 || team2.length !== 2)return false;
  const fairnessCorrection = !!item?.fairnessCorrection;
  const partnerLimit = fairnessCorrection ? PARTNER_GAP_CORRECTION_LIMIT : PARTNER_GAP_HARD;
  const gap1 = partnerGap(team1);
  const gap2 = partnerGap(team2);
  if(fairnessCorrection ? gap1 > partnerLimit || gap2 > partnerLimit : gap1 >= partnerLimit || gap2 >= partnerLimit)return false;
  if(!partnerGapSymmetryAllowed(team1, team2, {
    fairnessCorrection,
    reservation:item?.reservationId
  }))return false;
  if(Math.abs(teamLevel(team1) - teamLevel(team2)) > TEAM_DIFF_LIMIT)return false;
  if(fairnessCorrection && (item?.flexible || teamShape(team1) !== teamShape(team2)))return false;
  if(item?.teamMode){
    const firstSides = new Set(team1.map(player=>text(player?.team)).filter(Boolean));
    const secondSides = new Set(team2.map(player=>text(player?.team)).filter(Boolean));
    if(firstSides.size !== 1 || secondSides.size !== 1 || [...firstSides][0] === [...secondSides][0])return false;
  }
  if(
    fairnessCorrection &&
    (
      text(item?.correctionReason) !== 'fairness-partner-gap' ||
      !fairnessCorrectionEligible(session, [...team1Ids, ...team2Ids])
    )
  )return false;
  return true;
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

function setPreparedTeams(session, item, team1Ids, team2Ids, options = {}){
  const metrics = queuePairingMetrics(session, team1Ids, team2Ids, {
    fairnessCorrection:!!item?.fairnessCorrection,
    correctionReason:item?.correctionReason,
    reservation:options.reservation || item?.reservationId
  });
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
      if(item.reservationId && text(item.reservationId) !== text(reservation.id))continue;
      const originalTeam1 = queueTeam1Ids(item);
      const originalTeam2 = queueTeam2Ids(item);
      const sameSide = pair.every(id=>originalTeam1.includes(id)) || pair.every(id=>originalTeam2.includes(id));
      if(!sameSide){
        if(item.teamMode)return null;
        const others = ids.filter(id=>!pair.includes(id));
        if(others.length !== 2 || !setPreparedTeams(session, item, pair, others, {reservation}))return null;
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
  session.players.forEach(ensureFairExpected);
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

function fairActual(player){
  return number(player?.games) + ((normalizeStatus(player?.status) === 'playing' || text(player?.currentMatchId)) ? 1 : 0);
}

function ensureFairExpected(player){
  if(!player)return 0;
  if(!Object.prototype.hasOwnProperty.call(player, 'fairExpected') || !Number.isFinite(Number(player.fairExpected))){
    player.fairExpected = fairActual(player);
  }else{
    player.fairExpected = Math.max(0, Number(player.fairExpected));
  }
  return player.fairExpected;
}

function applyFairOpportunity(session, match){
  if(!session || !match)return;
  const pool = session.players.filter(player=>normalizeStatus(player?.status) === 'wait' && !text(player?.currentMatchId));
  if(!pool.length)return;
  const slots = Math.max(1, activePlayerIds(match).length || 4);
  const amount = slots / pool.length;
  match.fairExpectedDeltas = pool.map(player=>{
    player.fairExpected = ensureFairExpected(player) + amount;
    return {id:text(player.id), amount};
  });
}

function rollbackFairOpportunity(session, match, now){
  if(!session || !match || !Array.isArray(match.fairExpectedDeltas) || match.fairExpectedRolledBackAt)return;
  match.fairExpectedDeltas.forEach(row=>{
    const player = playerById(session, row?.id);
    if(!player)return;
    player.fairExpected = Math.max(0, ensureFairExpected(player) - Math.max(0, number(row?.amount)));
  });
  match.fairExpectedRolledBackAt = now;
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
    fairExpected:ensureFairExpected(player),
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
  const prepared = items=>(items || []).map(item=>({
    id:text(item?.queueId || item?.id),
    team1:queueTeam1Ids(item),
    team2:queueTeam2Ids(item),
    reservationId:text(item?.reservationId),
    restPass:item?.restPass || null
  }));
  const next = prepared(session.event?.next);
  const source = {
    players,
    reservations,
    arrivalCandidates:session.arrivalCandidates || [],
    active,
    next,
    expected:prepared(session.event?.expected),
    serverStandby:prepared(session.event?.serverStandby),
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

function requestSettled(row){
  return !!(number(row?.appliedAt) || number(row?.ignoredAt) || number(row?.serverAppliedAt) || number(row?.serverRejectedAt));
}

// 상한을 넘으면 오래된 것부터 버리되, 아직 처리되지 않은 요청은 마지막까지 남깁니다.
function capOldest(map, limit, settledFirst){
  const keys = Object.keys(map);
  if(keys.length <= limit)return;
  keys
    .sort((a, b)=>{
      if(settledFirst){
        const rank = requestSettled(map[a]) === requestSettled(map[b]) ? 0 : requestSettled(map[a]) ? -1 : 1;
        if(rank)return rank;
      }
      return number(map[a]?.createdAt) - number(map[b]?.createdAt);
    })
    .slice(0, keys.length - limit)
    .forEach(key=>{ delete map[key]; });
}

// 링크 노드에서 더 이상 쓰이지 않는 요청·명령 원장을 제거합니다.
// 임원·회원 화면 모두 처리 완료분은 걸러내고 쓰므로 지워도 화면 동작은 같습니다.
// serverCommands 는 재전송 중복 차단용이라 클라이언트 재시도 창(최대 30분)보다 넉넉히 남깁니다.
function pruneCommandLedger(current, now){
  if(!current || typeof current !== 'object')return current;
  const at = number(now, Date.now());
  const requests = current.requests;
  if(requests && typeof requests === 'object'){
    Object.keys(requests).forEach(key=>{
      const row = requests[key];
      const age = at - number(row?.createdAt);
      if(!number(row?.createdAt)){
        delete requests[key];
        return;
      }
      if(requestSettled(row) ? age > REQUEST_DONE_RETAIN_MS : age > REQUEST_STALE_RETAIN_MS){
        delete requests[key];
      }
    });
    capOldest(requests, MAX_REQUEST_ROWS, true);
  }
  const ledger = current.serverCommands;
  if(ledger && typeof ledger === 'object'){
    Object.keys(ledger).forEach(key=>{
      const createdAt = number(ledger[key]?.createdAt);
      if(!createdAt || at - createdAt > COMMAND_LEDGER_RETAIN_MS)delete ledger[key];
    });
    capOldest(ledger, MAX_COMMAND_LEDGER_ROWS, false);
  }
  return current;
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
      return ids.length === 4 && new Set(ids).size === 4 && !ids.some(permanentlyUnavailable) && preparedQualityValid(session, item);
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

function clearPreparedReservation(session, item, options = {}){
  const reservationId = text(item?.reservationId);
  if(reservationId && !options.preserveReservation){
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
    const pairing = preparedPairing(session, team1, team2, {
      now,
      allowFlexible:true,
      fairnessCorrection:!!target.item?.fairnessCorrection,
      reservationId:target.item?.reservationId || ''
    });
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
    const rowReservation = session.reservations.find(item=>text(item?.id) === text(row.item?.reservationId));
    const preserveReservation = !!(rowReservation && !reservationIds(rowReservation).includes(targetId));
    clearPreparedReservation(session, row.item, {preserveReservation});
    session.event[row.key] = session.event[row.key].filter(item=>item !== row.item);
  });
  const targetReservation = session.reservations.find(item=>text(item?.id) === text(target.item?.reservationId));
  const preserveTargetReservation = !!(targetReservation && !reservationIds(targetReservation).includes(targetId));
  if(!preserveTargetReservation)clearPreparedReservation(session, target.item);
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
  if(preserveTargetReservation && target.item.reservationAttachedExisting){
    target.item.reservationOriginalTeam1Ids = (target.item.reservationOriginalTeam1Ids || [])
      .map(id=>text(id) === targetId ? text(best.player.id) : id);
    target.item.reservationOriginalTeam2Ids = (target.item.reservationOriginalTeam2Ids || [])
      .map(id=>text(id) === targetId ? text(best.player.id) : id);
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
      const officialHold = typeof item.restPass === 'object' && !!item.restPass.officialHold;
      item.cueState = 'hold';
      item.cue = officialHold ? '일시정지' : '조금 쉬고';
      item.cueDetail = officialHold ? '재시작을 누르면 투입' : '';
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
  event.queuePolicy.finishComplete = !!(event.finishMode && !event.next.length && !event.active.length);
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
  const temporaryRoleCommand = ['official-temporary-grant','official-temporary-revoke'].includes(request.type);
  // 수동 경기 등록(official-manual-match)은 임원에게도 열었습니다(운영자 2026-08-10
  // "임원이 새로운 게임을 생성할 수 있는 권한"). 임원의 게임 설정 자유는 최대로
  // 보장하고, 시스템은 그 이후의 균형·보충을 책임진다는 원칙입니다.
  const adminOnlyCommand = [
    'official-settings-update',
    'official-court-cancel',
    'official-player-remove',
    'official-player-rename',
    'official-player-create',
    'official-queue-delete',
    'official-queue-regenerate',
    'official-reservation-promote',
    'official-finish-mode'
  ].includes(request.type);
  const actor = playerById(session, request.actorPlayerId);
  // 관리자는 세션을 만든 주체라 명단에 선수로 들어 있지 않습니다. 초대 토큰으로 확인한
  // 관리자 연결(선수에 묶이지 않은 invite claim)이면 '임원 본인' 확인 대신 그 자격으로 받습니다.
  // 관리자 화면의 쓰기를 전부 이 명령 경로로 옮기려면 운영 명령 전체가 열려 있어야 합니다.
  const adminClaim = options?.adminClaim === true && !grant.payload?.pid;
  // 코트 수·운영 시간·자동 진행은 관리자 설정입니다. 임원 연결로는 못 바꿉니다.
  if(adminOnlyCommand && !adminClaim)return {reason:'이 운영 동작은 관리자만 할 수 있습니다.'};
  // 관리자 전용 확장 옵션. 임원 연결로 보내면 기본 규칙을 우회하게 되므로 막습니다.
  // 대기 경기의 '이 선수로'(inPlayerId) 지정은 임원에게도 열었습니다(운영자 2026-08-10
  // "다음 대진도 동일하게") — 진행 경기 지정 교체(2026-08-08)와 같은 신뢰입니다.
  // 현장에서 보고 지목한 것이라 균형 점수 하한을 건너뛰는 것까지 동일합니다.
  if(!adminClaim && request.allowFreeMove === true){
    return {reason:'대진 순서 임의 이동은 관리자만 할 수 있습니다.'};
  }
  if(!adminClaim && !isLiveOperator(actor)){
    return {reason:'현재 운영 권한이 있는 회원만 운영 지원을 사용할 수 있습니다.'};
  }
  if(!adminClaim && ['invited','planned','done'].includes(normalizeStatus(actor?.status))){
    return {reason:'현장 참가 중인 임원 또는 운영 도우미만 운영 지원을 사용할 수 있습니다.'};
  }
  if(temporaryRoleCommand && !adminClaim && !actor?.isClubOfficial){
    return {reason:'운영 도우미 지정은 관리자 또는 정식 클럽 임원만 할 수 있습니다.'};
  }
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

function applyTemporaryOfficial(session, request, now, operation, enabled){
  const player = playerById(session, request.playerId);
  if(!player)return '운영 도우미로 지정할 회원을 찾지 못했습니다.';
  if(player.isGuest)return '클럽 회원만 운영 도우미로 지정할 수 있습니다.';
  if(player.isClubOfficial)return '정식 클럽 임원은 운영 도우미 지정이 필요하지 않습니다.';
  if(enabled && ['invited','planned','done'].includes(normalizeStatus(player.status))){
    return '현장 참가가 확인된 회원만 운영 도우미로 지정할 수 있습니다.';
  }
  if(Object.prototype.hasOwnProperty.call(request, 'expectedIsTemporaryOfficial')
    && !!request.expectedIsTemporaryOfficial !== !!player.isTemporaryOfficial){
    return '운영 도우미 상태가 이미 바뀌었습니다. 화면을 확인해 주세요.';
  }
  if(enabled){
    if(player.isTemporaryOfficial)return '이미 운영 도우미로 지정된 회원입니다.';
    const currentCount = session.players.filter(item=>item?.isTemporaryOfficial && !item.isClubOfficial).length;
    if(currentCount >= TEMPORARY_OFFICIAL_LIMIT){
      return `운영 도우미는 최대 ${TEMPORARY_OFFICIAL_LIMIT}명까지 지정할 수 있습니다.`;
    }
    player.isTemporaryOfficial = true;
    player.temporaryOfficialGrantedAt = now;
    player.temporaryOfficialGrantedBy = request.actorPlayerId || 'system-admin';
    player.temporaryOfficialGrantedByName = request.actorPlayerName || '관리자';
  }else{
    if(!player.isTemporaryOfficial)return '이미 운영 도우미 권한이 해제된 회원입니다.';
    player.isTemporaryOfficial = false;
    delete player.temporaryOfficialGrantedAt;
    delete player.temporaryOfficialGrantedBy;
    delete player.temporaryOfficialGrantedByName;
  }
  if(operation){
    operation.result = {
      temporaryOfficial:{
        playerId:text(player.id),
        enabled:!!enabled,
        updatedAt:now
      }
    };
  }
  return '';
}

function markLiveAddition(session, player, request, now, origin, operationId){
  if(!session.event?.operationStarted || !player)return;
  player.registrationCancelled = false;
  player.liveAddedAt = now;
  player.liveAddedBy = request.actorPlayerId || 'system-admin';
  player.liveAddedByName = request.actorPlayerName || '관리자';
  player.liveAddedSource = 'club-official-arrival';
  player.liveAddedOrigin = origin;
  player.liveAddedCandidateKey = request.candidateKey || (origin === 'roster' ? `roster:${player.memberId || player.id}` : `player:${player.id}`);
  player.liveAddedOperationId = operationId || request.operationId || request.key || `server-add-${player.id}-${now}`;
}

function clearLiveAddition(player){
  delete player.liveAddedAt;
  delete player.liveAddedBy;
  delete player.liveAddedByName;
  delete player.liveAddedSource;
  delete player.liveAddedOrigin;
  delete player.liveAddedCandidateKey;
  delete player.liveAddedOperationId;
}

function reprioritizePreparedForLateArrival(session, now){
  const event=session?.event;
  const startedAt=number(session?.matchStartedAt);
  if(!event || !startedAt || now-startedAt<5*60*1000 || event.finishMode)return false;
  const target=Math.max(0,number(event.nextTarget||event.queuePolicy?.official||event.next?.length));
  const current=Array.isArray(event.next)?event.next:[];
  if(current.length<=1)return false;
  const preserved=current.filter((item,index)=>index===0||item?.reservationId||item?.restPass||item?.notifiedAt);
  const next=preserved.slice(0,target);
  if(next.length===current.length&&next.every((item,index)=>item===current[index]))return false;
  event.next=next;
  return true;
}

function applyArrival(session, request, now, requestId){
  if(session.event?.finishMode)return '마무리 전환 후에는 자동대진 참가자를 추가할 수 없습니다.';
  const player = playerById(session, request.playerId);
  if(!player)return '참가 등록할 선수를 찾지 못했습니다.';
  if(!['invited', 'planned'].includes(text(player.status)))return '이미 참가 상태가 바뀐 선수입니다.';
  if(text(request.expectedStatus) !== text(player.status))return '선수 상태가 이미 바뀌었습니다.';
  if(number(request.expectedLastStatusAt) !== number(player.lastStatusAt))return '선수 상태가 이미 바뀌었습니다.';
  player.status = 'wait';
  player.statusLabel = statusLabel('wait');
  player.preArrivalVisible = false;
  player.registrationCancelled = false;
  player.locked = false;
  player.currentMatchId = '';
  player.afterMatchStatus = '';
  player.joinedAt = now;
  player.waitFrom = now;
  player.lastStatusAt = now;
  player.restPausedMs = 0;
  player.arrivalConfirmedBy = request.actorPlayerId || 'system-admin';
  player.arrivalConfirmedByName = request.actorPlayerName || '';
  player.arrivalConfirmedAt = now;
  player.arrivalConfirmedSource = 'club-official-arrival';
  markLiveAddition(session, player, request, now, 'existing', requestId);
  session.arrivalCandidates = session.arrivalCandidates.filter(item=>text(item.candidateKey) !== text(request.candidateKey));
  reprioritizePreparedForLateArrival(session, now);
  return '';
}

function applyPlayerAdd(session, request, now, requestId, operation){
  if(session.event?.finishMode)return '마무리 전환 후에는 자동대진 참가자를 추가할 수 없습니다.';
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
    preArrivalVisible: false,
    registrationCancelled: false,
    games: 0,
    fairExpected: 0,
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
    arrivalConfirmedBy: request.actorPlayerId || 'system-admin',
    arrivalConfirmedByName: request.actorPlayerName || '',
    arrivalConfirmedAt: now,
    arrivalConfirmedSource: 'club-official-arrival'
  };
  markLiveAddition(session, player, request, now, 'roster', requestId);
  session.players.push(player);
  session.arrivalCandidates = session.arrivalCandidates.filter(item=>text(item.candidateKey) !== text(request.candidateKey));
  if(operation){
    operation.result = {
      playerAddition:{
        candidateKey:text(request.candidateKey),
        player:clone(player)
      }
    };
  }
  return '';
}

function applyPlayerAddCancel(session, request, now, operation){
  const player = playerById(session, request.playerId);
  if(!player)return '취소할 선수를 찾지 못했습니다.';
  if(number(player.liveAddedAt) <= 0)return '라이브 후 추가된 선수만 오등록 취소할 수 있습니다.';
  if(text(request.expectedStatus) !== text(player.status))return '선수 상태가 이미 바뀌었습니다.';
  if(number(request.expectedLiveAddedAt) !== number(player.liveAddedAt))return '라이브 후 추가 기록이 이미 바뀌었습니다.';
  if(text(request.expectedLiveAddedOperationId) !== text(player.liveAddedOperationId))return '라이브 후 추가 작업이 이미 바뀌었습니다.';
  if(number(request.expectedLastStatusAt) !== number(player.lastStatusAt))return '선수 상태가 이미 바뀌었습니다.';
  if(number(request.expectedGames) !== number(player.games) || number(player.games) > 0)return '이미 경기에 참여한 선수는 오등록 취소할 수 없습니다.';
  if(normalizeStatus(player.status) === 'playing' || player.currentMatchId)return '진행 중인 선수는 오등록 취소할 수 없습니다.';

  const playerId = text(player.id);
  const origin = text(player.liveAddedOrigin);
  const mode = origin === 'existing' ? 'revert' : 'hide';
  repairPreparedForUnavailablePlayer(session, playerId, now);
  removePlayerReservations(session, playerId);

  player.status = 'planned';
  player.statusLabel = statusLabel('planned');
  player.preArrivalVisible = mode === 'revert';
  player.registrationCancelled = mode === 'hide';
  player.locked = false;
  player.currentMatchId = '';
  player.afterMatchStatus = '';
  player.lastStatusAt = now;
  player.restPausedMs = 0;
  delete player.arrivalConfirmedBy;
  delete player.arrivalConfirmedByName;
  delete player.arrivalConfirmedAt;
  delete player.arrivalConfirmedSource;
  clearLiveAddition(player);
  const candidateKey = `player:${playerId}`;
  session.arrivalCandidates = session.arrivalCandidates.filter(item=>{
    return text(item.playerId) !== playerId && text(item.memberId) !== text(player.memberId);
  });
  session.arrivalCandidates.push({
    candidateKey,
    kind:'existing',
    playerId,
    name:player.name,
    status:'planned',
    lastStatusAt:now,
    registrationCancelled:mode === 'hide'
  });
  if(mode === 'hide'){
    player.isTemporaryOfficial = false;
    delete player.temporaryOfficialGrantedAt;
    delete player.temporaryOfficialGrantedBy;
    delete player.temporaryOfficialGrantedByName;
  }
  promotePrepared(session);
  if(operation){
    operation.result = {
      playerAddCancel:{
        playerId,
        mode,
        liveAddedAt:number(request.expectedLiveAddedAt),
        updatedAt:now
      }
    };
  }
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
  if(
    index < 0 ||
    event.next[index] !== item ||
    event.active.some(match=>number(match.court) === number(court)) ||
    !queueReady(session, item) ||
    !preparedQualityValid(session, item)
  )return null;
  const runtime = session.serverRuntime;
  const maxSeq = event.active.reduce((max, match)=>Math.max(max, number(match.seq)), number(event.completed));
  runtime.nextSeq = Math.max(number(runtime.nextSeq), maxSeq + 1);
  // 한 명령으로 여러 빈 코트를 채울 수 있어 경기 id 가 겹치면 안 됩니다.
  const matchId = options.autoHandoff
    ? `sm_${safeId(requestId)}${options.autoSuffix ? `_${safeId(options.autoSuffix)}` : ''}`
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
    fairnessCorrection:!!item.fairnessCorrection,
    correctionReason:item.correctionReason || '',
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
  applyFairOpportunity(session, match);
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

// 빈 코트가 있고 다음 대진이 준비돼 있으면 알아서 넣습니다.
// 예전에는 '경기 종료' 순간에만 자동 투입이 돌아서, 끝난 경기가 없는 상황
// (운영 시작 직후, 운영 중 코트 증설)에는 임원이 '입장 처리'를 눌러야 했습니다.
// 이제 임원이 무슨 동작을 하든 그때마다 빈 코트를 채웁니다.
function autoEnterFreeCourts(session, now, requestId, actorPlayerId){
  if(session.capabilities?.officialAutoHandoffV1 !== true)return [];
  if(session.event?.finishMode)return [];
  const entered = [];
  let guard = 0;
  while(guard++ < 12){
    promotePrepared(session);
    replenishPrepared(session, {now, requestId});
    refreshEvent(session, now);
    const busy = new Set((session.event.active || []).map(match=>number(match.court)));
    const index = (session.event.next || []).findIndex(item=>
      item &&
      item.cueState === 'free' &&
      number(item.targetCourt) &&
      !busy.has(number(item.targetCourt)) &&
      !item.restPass &&
      queueReady(session, item)
    );
    if(index < 0)break;
    const item = session.event.next[index];
    const court = number(item.targetCourt);
    const match = startPreparedItem(session, item, index, court, now, requestId, {
      actorPlayerId,
      autoHandoff:true,
      autoHandoffSource:'auto-free-court',
      autoSuffix:`c${court}_${entered.length}`,
      queueIndex:index + 1
    });
    if(!match)break;
    entered.push(match);
  }
  return entered;
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
  if(!preparedQualityValid(session, item))return '대진 품질 기준이 바뀌어 다음 대진을 다시 준비해 주세요.';

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
  rollbackFairOpportunity(session, match, now);
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
  // 임원의 '이번만 뒤로'는 한 칸만입니다. 관리자 드래그는 임의 위치로 옮깁니다.
  const freeMove = request.allowFreeMove === true;
  const target = freeMove && Object.prototype.hasOwnProperty.call(request, 'targetQueueIndex')
    ? number(request.targetQueueIndex)
    : index + 2;
  if(target < 1 || target > list.length)return '옮길 수 있는 순번이 아닙니다.';
  if(!freeMove){
    if(target > list.length)return '뒤에 보낼 다음 대진이 없습니다.';
    if(Object.prototype.hasOwnProperty.call(request, 'targetQueueIndex') && number(request.targetQueueIndex) !== target){
      return '이번만 뒤로는 한 순번만 이동할 수 있습니다.';
    }
  }
  if(target === index + 1)return '같은 순번입니다.';
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
  item.yieldedSteps = Math.abs(target - (index + 1));
  item.restPass = false;
  item.restPassText = '';
  list.splice(target - 1, 0, item);
  refreshEvent(session, now);
  return '';
}

function applyQueueHold(session, request, now){
  refreshEvent(session, now);
  const list = session.event.next;
  const index = list.findIndex(item=>text(item.queueId || item.id) === text(request.queueId));
  if(index < 0)return '일시정지할 다음 대진을 찾지 못했습니다.';
  const item = list[index];
  if(idsFingerprint(request.expectedPlayerIds) !== idsFingerprint(queuePlayerIds(item)))return '다음 대진 선수가 이미 바뀌었습니다.';
  if(item.restPass)return '이미 일시정지된 대진입니다.';
  // 자리는 그대로 두고 코트만 다음 순위에게 넘깁니다.
  item.restPass = {officialHold:true, playerId:'', actorPlayerId:text(request.actorPlayerId), at:now};
  item.restPassText = '일시정지';
  refreshEvent(session, now);
  return '';
}

function applyQueueResume(session, request, now){
  refreshEvent(session, now);
  const list = session.event.next;
  const index = list.findIndex(item=>text(item.queueId || item.id) === text(request.queueId));
  if(index < 0)return '재시작할 다음 대진을 찾지 못했습니다.';
  const item = list[index];
  if(!item.restPass)return '이미 진행 중인 대진입니다.';
  if(idsFingerprint(request.expectedPlayerIds) !== idsFingerprint(queuePlayerIds(item)))return '다음 대진 선수가 이미 바뀌었습니다.';
  item.restPass = false;
  item.restPassText = '';
  refreshEvent(session, now);
  return '';
}

// 일시정지한 대진에서 안 돌아오는 선수를 바꿉니다.
// 대진에 들어가지 않은 대기 선수 중, 팀 균형이 가장 잘 맞는 사람을 자동으로 고릅니다.
function unassignedWaitingPlayers(session){
  const busy = new Set();
  (session.event?.active || []).forEach(match=>activePlayerIds(match).forEach(id=>busy.add(text(id))));
  ['next','expected','serverStandby'].forEach(key=>{
    (session.event?.[key] || []).forEach(item=>queuePlayerIds(item).forEach(id=>busy.add(text(id))));
  });
  (session.reservations || []).forEach(row=>reservationIds(row).forEach(id=>busy.add(text(id))));
  return (session.players || []).filter(player=>
    player && player.name &&
    !busy.has(text(player.id)) &&
    normalizeStatus(player.status) === 'wait' &&
    !player.currentMatchId &&
    !player.registrationCancelled
  );
}

function replacementScore(session, item, outId, candidate){
  const swap = id=>text(id) === text(outId) ? candidate : playerById(session, id);
  const t1 = queueTeam1Ids(item).map(swap).filter(Boolean);
  const t2 = queueTeam2Ids(item).map(swap).filter(Boolean);
  if(t1.length !== 2 || t2.length !== 2)return null;
  const level = team=>team.reduce((sum, player)=>sum + effectiveLevel(player), 0);
  const gap = team=>Math.abs(effectiveLevel(team[0]) - effectiveLevel(team[1]));
  const teamDiff = Math.abs(level(t1) - level(t2));
  const gapMax = Math.max(gap(t1), gap(t2));
  if(gapMax >= PARTNER_GAP_HARD)return null;      // 한쪽이 일방적으로 몰리는 조합은 제외
  if(teamDiff > TEAM_DIFF_LIMIT)return null;      // 팀 실력차 하드 한계
  // 균형이 우선, 같으면 덜 뛴 사람을 먼저 넣습니다.
  return teamDiff * 1000 + Math.abs(gap(t1) - gap(t2)) * 200 + number(candidate.games) * 10;
}

function applyQueueReplace(session, request, now, operation){
  refreshEvent(session, now);
  const list = session.event.next;
  const index = list.findIndex(item=>text(item.queueId || item.id) === text(request.queueId));
  if(index < 0)return '교체할 다음 대진을 찾지 못했습니다.';
  const item = list[index];
  if(!item.restPass && !text(request.inPlayerId))return '일시정지한 대진에서만 선수를 교체할 수 있습니다.';
  if(idsFingerprint(request.expectedPlayerIds) !== idsFingerprint(queuePlayerIds(item)))return '대진 선수가 이미 바뀌었습니다.';
  const outId = text(request.outPlayerId);
  const outPlayer = playerById(session, outId);
  if(!outPlayer || !queuePlayerIds(item).includes(outId))return '교체할 선수를 이 대진에서 찾지 못했습니다.';
  if(text(item.reservationId))return '게임신청으로 잡힌 대진은 선수를 교체할 수 없습니다. 먼저 신청을 정리해 주세요.';
  // '이 선수로'(inPlayerId)를 지정하면 그대로 넣고, 없으면 서버가 균형으로 고릅니다.
  // 지정은 관리자·임원 공통입니다(운영자 2026-08-10).
  const requestedInId = text(request.inPlayerId);
  const candidates = requestedInId
    ? unassignedWaitingPlayers(session).filter(player=>text(player.id) === requestedInId)
    : unassignedWaitingPlayers(session);
  if(requestedInId && !candidates.length){
    const requested = playerById(session, requestedInId);
    if(!requested)return '넣으려는 선수를 찾지 못했습니다.';
    return `${text(requested.name)} 선수는 지금 다른 대진이나 신청에 묶여 있어 넣을 수 없습니다.`;
  }
  if(!candidates.length)return '지금 넣을 수 있는 대기 선수가 없습니다.';
  let best = null;
  candidates.forEach(candidate=>{
    const score = requestedInId ? 0 : replacementScore(session, item, outId, candidate);
    if(score == null)return;
    if(!best || score < best.score || (score === best.score && text(candidate.id) < text(best.player.id))){
      best = {player:candidate, score};
    }
  });
  if(!best)return '균형을 맞출 수 있는 대기 선수가 없습니다.';
  const inId = text(best.player.id);
  const swap = ids=>ids.map(id=>text(id) === outId ? inId : text(id));
  item.t1Ids = swap(queueTeam1Ids(item));
  item.t2Ids = swap(queueTeam2Ids(item));
  item.playerIds = [...item.t1Ids, ...item.t2Ids];
  item.t1 = item.t1Ids.map(id=>playerById(session, id)?.name || '선수');
  item.t2 = item.t2Ids.map(id=>playerById(session, id)?.name || '선수');
  item.replacedAt = now;
  item.replacedOutId = outId;
  item.replacedInId = inId;
  refreshEvent(session, now);
  // 관리자 원본이 같은 교체를 재현할 수 있도록 결과를 알려 줍니다.
  if(operation)operation.result = {replacedOutId:outId, replacedInId:inId, replacedInName:text(best.player.name)};
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
  const preparedRows = preparedLocations(session);
  const covered = preparedRows.find(row=>{
    if(!row.item?.reservationId || !ids.every(id=>queuePlayerIds(row.item).includes(id)))return false;
    const first = queueTeam1Ids(row.item);
    const second = queueTeam2Ids(row.item);
    return ids.every(id=>first.includes(id)) || ids.every(id=>second.includes(id));
  });
  if(covered){
    if(operation)operation.result = {
      reservationId:text(covered.item.reservationId),
      queueApplied:true,
      queueId:text(covered.item.queueId || covered.item.id),
      queueIndex:preparedRows.findIndex(row=>row.item === covered.item) + 1,
      queueGroup:covered.key,
      rearranged:false,
      alreadyCovered:true
    };
    return '';
  }
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


// 코트 수·운영 시간·자동 진행을 한 명령으로 받습니다.
// 운영자 판단 ③ — 준비 단계를 잠그지 않는 대신, 기록하는 주체만 서버로 모읍니다.
// 현장 융통성은 그대로 두고 관리자가 세션을 직접 고치는 것만 없앱니다.
function applySettingsUpdate(session, request, now, operation){
  const event = session.event;
  const has = key=>Object.prototype.hasOwnProperty.call(request, key);
  const changes = {};

  if(has('courts')){
    const courts = number(request.courts);
    if(!Number.isInteger(courts) || courts < 1 || courts > 12)return '코트 수는 1~12 사이로 정해 주세요.';
    if(has('expectedCourts') && number(request.expectedCourts) !== number(event.courts, 0)){
      return '코트 수가 이미 바뀌었습니다.';
    }
    // 진행 중인 코트를 잘라내면 그 경기가 갈 곳이 없어집니다.
    const busy = (event.active || []).filter(match=>number(match?.court) > courts).map(match=>number(match.court));
    if(busy.length)return `${[...new Set(busy)].sort((a,b)=>a-b).join(', ')}코트에서 경기가 진행 중이라 코트 수를 줄일 수 없습니다.`;
    event.courts = courts;
    changes.courts = courts;
  }

  // 운영 시간·자동 진행은 일부러 뺐습니다. 관리자 게시 payload(_dailyPublicEvent)가
  // queuePolicy.auto 를 매번 다시 계산해 덮어쓰고 운영 시간은 아예 싣지 않아서,
  // 여기에 저장해도 다음 게시 한 번에 사라집니다. 화면을 되살릴 때 payload 부터
  // 같이 고치고 나서 추가하십시오.
  if(!Object.keys(changes).length)return '바꿀 설정이 없습니다.';
  if(operation)operation.result = {settings:changes};
  return '';
}


// ── 4단계: 관리자만 쓰던 운영 동작들의 명령 ────────────────────────────────
// 모두 관리자 전용입니다. 임원 화면에는 이 버튼들이 없습니다.

function applyPlayerRemove(session, request, now, operation){
  const player = playerById(session, request.playerId);
  if(!player)return '명단에서 뺄 선수를 찾지 못했습니다.';
  if(text(request.expectedName) && text(request.expectedName) !== text(player.name)){
    return '선수 정보가 이미 바뀌었습니다.';
  }
  if(normalizeStatus(player.status) === 'playing' || player.currentMatchId){
    return '경기중 선수는 먼저 경기 완료 또는 취소를 해주세요.';
  }
  const playerId = text(player.id);
  const queueRepair = repairPreparedForUnavailablePlayer(session, playerId, now);
  removePlayerReservations(session, playerId);
  session.players = (session.players || []).filter(row=>text(row?.id) !== playerId);
  session.arrivalCandidates = (session.arrivalCandidates || [])
    .filter(item=>text(item?.playerId) !== playerId);
  promotePrepared(session);
  if(operation)operation.result = {playerRemove:{playerId, name:text(player.name), queueRepair}};
  return '';
}

function applyPlayerRename(session, request, now, operation){
  const player = playerById(session, request.playerId);
  if(!player)return '이름을 바꿀 선수를 찾지 못했습니다.';
  const next = text(request.name).trim();
  if(!next)return '새 이름을 입력해 주세요.';
  if(next.length > 20)return '이름이 너무 깁니다.';
  if(text(request.expectedName) && text(request.expectedName) !== text(player.name)){
    return '선수 이름이 이미 바뀌었습니다.';
  }
  const previous = text(player.name);
  if(previous === next)return '이미 같은 이름입니다.';
  if((session.players || []).some(row=>text(row?.id) !== text(player.id) && text(row?.name) === next)){
    return '이미 명단에 있는 이름입니다.';
  }
  player.name = next;
  // 이름을 키로 쓰는 기록과 화면용 이름 배열을 함께 옮깁니다.
  (session.players || []).forEach(row=>{
    ['partnerCount','opponentCount'].forEach(key=>{
      const map = row?.[key];
      if(!map || typeof map !== 'object' || !Object.prototype.hasOwnProperty.call(map, previous))return;
      map[next] = number(map[next]) + number(map[previous]);
      delete map[previous];
    });
  });
  const renameList = list=>(list || []).map(value=>text(value) === previous ? next : value);
  (session.event.active || []).forEach(match=>{
    match.t1 = renameList(match.t1);
    match.t2 = renameList(match.t2);
  });
  ['next','expected','serverStandby'].forEach(key=>{
    (session.event?.[key] || []).forEach(item=>{
      item.t1 = renameList(item.t1);
      item.t2 = renameList(item.t2);
    });
  });
  if(operation)operation.result = {playerRename:{playerId:text(player.id), previous, name:next}};
  return '';
}

function applyPlayerCreate(session, request, now, operation){
  if(session.event?.finishMode)return '마무리 전환 후에는 선수를 추가할 수 없습니다.';
  const name = text(request.name).trim();
  if(!name)return '추가할 선수 이름을 입력해 주세요.';
  if(name.length > 20)return '이름이 너무 깁니다.';
  if((session.players || []).some(row=>text(row?.name) === name))return '이미 오늘 명단에 있는 선수입니다.';
  const playerId = text(request.playerId);
  if(!playerId)return '추가할 선수 번호가 없습니다.';
  if(playerById(session, playerId))return '이미 사용 중인 선수 번호입니다.';
  // 도착 전(planned) 등록도 같은 명령으로 받습니다. 기본은 현장 참가(wait).
  const status = text(request.status) === 'planned' ? 'planned' : 'wait';
  const grade = text(request.grade) || 'C';
  const player = {
    id: playerId,
    memberId: text(request.memberId),
    name,
    grade,
    level: number(request.level, 4),
    gender: request.gender === 'F' || request.gender === '여' ? 'F' : 'M',
    ageGroup: text(request.ageGroup) || '40대',
    club: text(request.club),
    status,
    statusLabel: statusLabel(status),
    preArrivalVisible: status === 'planned',
    registrationCancelled: false,
    games: 0,
    fairExpected: 0,
    mixedGames: 0,
    typeTrackedGames: 0,
    lastPlayedSeq: 0,
    partnerCount: {},
    opponentCount: {},
    partnerCountById: {},
    opponentCountById: {},
    isGuest: request.isGuest === true,
    isClubOfficial: false,
    isTemporaryOfficial: false,
    locked: false,
    currentMatchId: '',
    afterMatchStatus: '',
    joinedAt: now,
    waitFrom: now,
    lastStatusAt: now,
    restPausedMs: 0
  };
  session.players.push(player);
  // 도착 전 선수는 아직 뛰지 않으므로 라이브 추가로 기록하지 않습니다.
  if(status === 'wait')markLiveAddition(session, player, request, now, 'manual', text(request.operationId));
  if(operation)operation.result = {playerCreate:{playerId, name, isGuest:player.isGuest, status}};
  return '';
}

function applyQueueDelete(session, request, now, operation){
  refreshEvent(session, now);
  const list = session.event.next;
  const index = list.findIndex(item=>text(item.queueId || item.id) === text(request.queueId));
  if(index < 0)return '삭제할 대기 경기를 찾지 못했습니다.';
  const item = list[index];
  if(idsFingerprint(request.expectedPlayerIds) !== idsFingerprint(queuePlayerIds(item))){
    return '대기 경기 선수가 이미 바뀌었습니다.';
  }
  const reservationId = text(item.reservationId);
  list.splice(index, 1);
  // 신청으로 잡힌 대기표를 지우면 그 신청도 함께 정리합니다.
  if(reservationId){
    session.reservations = (session.reservations || []).filter(row=>text(row?.id) !== reservationId);
  }
  if(operation)operation.result = {queueDelete:{queueId:text(request.queueId), reservationId}};
  return '';
}

function applyQueueRegenerate(session, request, now, operation){
  refreshEvent(session, now);
  const list = session.event.next;
  const index = list.findIndex(item=>text(item.queueId || item.id) === text(request.queueId));
  if(index < 0)return '다시 만들 대기 경기를 찾지 못했습니다.';
  const item = list[index];
  if(text(item.reservationId))return '회원 게임신청은 자동 재배정하지 않습니다. 신청 삭제 후 다시 등록해 주세요.';
  if(idsFingerprint(request.expectedPlayerIds) !== idsFingerprint(queuePlayerIds(item))){
    return '대기 경기 선수가 이미 바뀌었습니다.';
  }
  // 자리를 비우고 서버 편성기가 같은 자리를 다시 채우게 합니다.
  list.splice(index, 1);
  const before = list.length;
  replenishPrepared(session, {now, requestId:text(request.operationId || request.key)});
  if(session.event.next.length <= before){
    return '현재 대기 인원으로 새 대기 경기를 만들 수 없습니다.';
  }
  if(operation)operation.result = {queueRegenerate:{queueId:text(request.queueId)}};
  return '';
}

function applyReservationPromote(session, request, now, operation){
  const reservationId = text(request.reservationId);
  const reservation = (session.reservations || []).find(row=>text(row?.id) === reservationId);
  if(!reservation)return '반영할 게임신청을 찾지 못했습니다.';
  refreshEvent(session, now);
  if((session.event.next || []).some(item=>text(item.reservationId) === reservationId)){
    return '이미 대기표에 반영된 게임신청입니다.';
  }
  const ids = reservationIds(reservation);
  const unavailable = ids.filter(id=>{
    const player = playerById(session, id);
    return !player || normalizeStatus(player.status) !== 'wait' || player.currentMatchId;
  });
  if(unavailable.length)return '아직 게임신청을 반영할 수 없습니다. 신청 선수가 모두 참가 상태인지 확인해 주세요.';
  // 신청 선수가 낀 기존 대기표를 비우고 편성기를 돌리면 신청이 먼저 잡힙니다.
  session.event.next = (session.event.next || []).filter(item=>{
    if(text(item.reservationId))return true;
    return !queuePlayerIds(item).some(id=>ids.includes(id));
  });
  replenishPrepared(session, {now, requestId:text(request.operationId || request.key)});
  refreshEvent(session, now);
  const placed = (session.event.next || []).some(item=>text(item.reservationId) === reservationId);
  if(!placed)return '아직 게임신청을 반영할 수 없습니다. 상대 후보가 준비되면 자동으로 반영됩니다.';
  if(operation)operation.result = {reservationPromote:{reservationId}};
  return '';
}

function applyFinishMode(session, request, now, operation){
  const next = request.finishMode === true;
  const event = session.event;
  if(!!event.finishMode === next)return next ? '이미 마무리 중입니다.' : '마무리 중이 아닙니다.';
  event.finishMode = next;
  if(next){
    event.finishStartedAt = now;
    // 마무리에 들어가면 더 만들지 않습니다. 남은 대기표는 그대로 소진합니다.
  }else{
    event.finishStartedAt = 0;
    replenishPrepared(session, {now, requestId:text(request.operationId || request.key)});
  }
  if(operation)operation.result = {finishMode:{finishMode:next, at:now}};
  return '';
}


// 경기 취소는 완료와 정확히 반대입니다. "쳤다"가 아니라 "없던 일"이라
// games·partnerCount·opponentCount 를 건드리지 않고 공정성 기대치만 되돌립니다.
// 잘못 투입한 경기를 완료로 처리하면 안 뛴 4명의 경기 수가 올라가고,
// 대진이 경기 수 적은 사람 우선이라 그날 남은 순번이 계속 틀어집니다.
function applyCourtCancel(session, request, now, operation){
  refreshEvent(session, now);
  const event = session.event;
  const index = event.active.findIndex(match=>text(match.id) === text(request.matchId));
  if(index < 0)return '취소할 진행중 경기를 찾지 못했습니다.';
  const match = event.active[index];
  if(number(request.expectedStartedAt) !== number(match.startedAt))return '코트의 진행 경기가 이미 바뀌었습니다.';
  if((request.expectedPlayerIds || []).length !== 4
    || idsFingerprint(request.expectedPlayerIds) !== idsFingerprint(activePlayerIds(match))){
    return '코트의 선수 구성이 이미 바뀌었습니다.';
  }
  rollbackFairOpportunity(session, match, now);
  event.active.splice(index, 1);
  const restored = [];
  activePlayerIds(match).forEach(id=>{
    const player = playerById(session, id);
    if(!player)return;
    const after = normalizeStatus(player.afterMatchStatus);
    const nextStatus = ['rest', 'done'].includes(after) ? after : 'wait';
    player.status = nextStatus;
    player.statusLabel = statusLabel(nextStatus);
    player.locked = false;
    player.currentMatchId = '';
    player.afterMatchStatus = '';
    player.lastStatusAt = now;
    player.restPausedMs = 0;
    if(nextStatus === 'wait')player.waitFrom = now;
    else repairPreparedForUnavailablePlayer(session, player.id, now);
    restored.push({id:text(player.id), status:nextStatus});
  });
  match.cancelledAt = now;
  if(operation)operation.result = {courtCancel:{matchId:text(match.id), court:number(match.court), restored}};
  return '';
}


// 관리자가 코트에 경기를 직접 등록합니다(자율게임 · 계속 경기).
// 편성기를 거치지 않으므로 선수 4명과 코트만 검사하고 그대로 올립니다.
function applyManualMatch(session, request, now, requestId, operation){
  refreshEvent(session, now);
  const event = session.event;
  if(event.finishMode)return '마무리 전환 후에는 경기를 등록할 수 없습니다.';
  const court = number(request.court);
  if(!Number.isInteger(court) || court < 1 || court > Math.max(1, number(event.courts, 1))){
    return '코트 번호를 다시 확인해 주세요.';
  }
  if(event.active.some(match=>number(match.court) === court))return `${court}코트에는 이미 진행 중인 경기가 있습니다.`;
  const team1Ids = (request.team1Ids || []).map(text).filter(Boolean);
  const team2Ids = (request.team2Ids || []).map(text).filter(Boolean);
  const ids = [...team1Ids, ...team2Ids];
  if(team1Ids.length !== 2 || team2Ids.length !== 2 || new Set(ids).size !== 4){
    return '서로 다른 선수 4명을 다시 선택해 주세요.';
  }
  const players = ids.map(id=>playerById(session, id));
  if(players.some(player=>!player))return '등록할 선수를 현재 명단에서 찾지 못했습니다.';
  const transition = request.transition === true;
  // '계속 경기'는 이미 코트에서 뛰던 선수를 그대로 옮기는 것이라 playing 을 허용합니다.
  const bad = players.filter(player=>{
    const status = normalizeStatus(player.status);
    if(transition)return ['invited','planned','done'].includes(status);
    return status !== 'wait' || text(player.currentMatchId);
  });
  if(bad.length)return `${bad.map(player=>text(player.name)).join(', ')} 선수는 지금 이 경기에 넣을 수 없습니다.`;
  const matchId = text(request.matchId) || `sm_${safeId(requestId)}`;
  if(event.active.some(match=>text(match.id) === matchId))return '이미 사용 중인 경기 번호입니다.';

  // 이 넷이 걸려 있던 대기표와 게임신청을 먼저 정리합니다.
  ids.forEach(id=>removePlayerReservations(session, id));
  ['next','expected','serverStandby'].forEach(key=>{
    event[key] = (event[key] || []).filter(item=>!queuePlayerIds(item).some(id=>ids.includes(id)));
  });

  const runtime = session.serverRuntime;
  const maxSeq = event.active.reduce((max, match)=>Math.max(max, number(match.seq)), number(event.completed));
  runtime.nextSeq = Math.max(number(runtime.nextSeq), maxSeq + 1);
  const names = list=>list.map(id=>playerById(session, id)?.name || '선수');
  const label = text(request.reservationLabel) || (transition ? '계속 경기' : '자율게임');
  const match = {
    id:matchId,
    court,
    seq:runtime.nextSeq++,
    type:text(request.type) || '자율',
    teamMode:false,
    labelA:'A팀', labelB:'B팀',
    t1:names(team1Ids), t2:names(team2Ids),
    t1Ids:team1Ids, t2Ids:team2Ids,
    playerIds:ids,
    startedAt:now,
    expectedMinutes:MATCH_MINUTES,
    endAt:now + MATCH_MINUTES * 60000,
    remain:MATCH_MINUTES,
    timerState:'normal',
    transitionStarted:transition,
    manualStarted:true,
    reservationId:null,
    reservationLabel:label,
    reservationMode:null,
    fairnessCorrection:false,
    correctionReason:'',
    serverStartedBy:text(request.actorPlayerId),
    serverRequestId:requestId
  };
  event.active.push(match);
  applyFairOpportunity(session, match);
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
  delete runtime.holds[text(court)];
  promotePrepared(session);
  if(operation)operation.result = {manualMatch:{matchId, court, seq:match.seq, playerIds:ids, transition, label}};
  return '';
}


// 진행 중 경기의 선수 교체(운영자 결정 2026-08-08).
//  - 대기 선수 투입: 나간 선수는 휴식, 들어온 선수가 마저 뜁니다.
//    경기 수는 종료 시점의 명단으로 셉니다 — 끝까지 뛴 사람이 그 경기를 가져갑니다.
//  - 다른 코트 선수와 맞교환: 두 경기의 명단을 한 번에 바꿉니다(타이머는 그대로).
// 코트에서 4명이 동의하고 바꾸는 일을 시스템이 막으면 기록만 실제와 어긋납니다.
function applyActiveReplace(session, request, now, operation){
  refreshEvent(session, now);
  const event = session.event;
  const match = event.active.find(m=>text(m.id) === text(request.matchId));
  if(!match)return '교체할 진행중 경기를 찾지 못했습니다.';
  if(number(request.expectedStartedAt) !== number(match.startedAt))return '코트의 진행 경기가 이미 바뀌었습니다.';
  if(idsFingerprint(request.expectedPlayerIds) !== idsFingerprint(activePlayerIds(match))){
    return '코트의 선수 구성이 이미 바뀌었습니다.';
  }
  const outId = text(request.outPlayerId);
  const inId = text(request.inPlayerId);
  if(!outId || !inId)return '교체할 두 선수를 다시 확인해 주세요.';
  if(outId === inId)return '같은 선수입니다.';
  if(!activePlayerIds(match).map(text).includes(outId))return '교체할 선수를 이 경기에서 찾지 못했습니다.';
  if(activePlayerIds(match).map(text).includes(inId))return '이미 이 경기에서 뛰는 선수입니다.';
  const outPlayer = playerById(session, outId);
  const inPlayer = playerById(session, inId);
  if(!outPlayer || !inPlayer)return '선수를 현재 명단에서 찾지 못했습니다.';

  const swapIds = list=>list.map(id=>text(id) === outId ? inId : (text(id) === inId ? outId : text(id)));
  const applyRoster = m=>{
    m.t1Ids = swapIds(queueTeam1Ids(m));
    m.t2Ids = swapIds(queueTeam2Ids(m));
    m.playerIds = [...m.t1Ids, ...m.t2Ids];
    m.t1 = m.t1Ids.map(id=>text(playerById(session, id)?.name) || '선수');
    m.t2 = m.t2Ids.map(id=>text(playerById(session, id)?.name) || '선수');
    // 명단이 바뀌면 자동 투입 취소 스냅샷은 더 이상 맞지 않습니다
    ['autoHandoffAt','autoHandoffExpiresAt','autoHandoffQueue','autoHandoffPlayerStates',
     'autoHandoffReservation','autoHandoffSource','autoHandoffSourceMatchId',
     'autoHandoffSourceRequestId','autoHandoffQueueIndex'].forEach(key=>delete m[key]);
  };

  const otherMatch = event.active.find(m=>m !== match && activePlayerIds(m).map(text).includes(inId));
  if(otherMatch){
    applyRoster(match);
    applyRoster(otherMatch);
    outPlayer.currentMatchId = text(otherMatch.id);
    inPlayer.currentMatchId = text(match.id);
    outPlayer.lastStatusAt = now;
    inPlayer.lastStatusAt = now;
    if(operation)operation.result = {activeReplace:{mode:'swap', matchId:text(match.id),
      otherMatchId:text(otherMatch.id), outId, inId}};
    refreshEvent(session, now);
    return '';
  }

  if(normalizeStatus(inPlayer.status) !== 'wait' || text(inPlayer.currentMatchId)){
    return `${text(inPlayer.name)} 선수는 지금 참가 대기 상태가 아닙니다.`;
  }
  repairPreparedForUnavailablePlayer(session, inId, now);
  removePlayerReservations(session, inId);
  applyRoster(match);
  inPlayer.status = 'playing';
  inPlayer.statusLabel = statusLabel('playing');
  inPlayer.locked = true;
  inPlayer.currentMatchId = text(match.id);
  inPlayer.afterMatchStatus = '';
  inPlayer.lastStatusAt = now;
  inPlayer.restPausedMs = 0;
  outPlayer.status = 'rest';
  outPlayer.statusLabel = statusLabel('rest');
  outPlayer.locked = false;
  outPlayer.currentMatchId = '';
  outPlayer.afterMatchStatus = '';
  outPlayer.lastStatusAt = now;
  outPlayer.restPausedMs = 0;
  promotePrepared(session);
  if(operation)operation.result = {activeReplace:{mode:'sub', matchId:text(match.id), outId, inId}};
  refreshEvent(session, now);
  return '';
}

function applyByType(session, request, now, requestId, operation){
  switch(request.type){
    case 'official-player-arrival': return applyArrival(session, request, now, requestId);
    case 'official-player-add': return applyPlayerAdd(session, request, now, requestId, operation);
    case 'official-player-add-cancel': return applyPlayerAddCancel(session, request, now, operation);
    case 'official-player-status': return applyPlayerStatus(session, request, now, operation);
    case 'official-court-complete': return applyComplete(session, request, now, requestId, operation);
    case 'official-active-yield': return applyActiveYield(session, request, now, requestId, operation);
    case 'official-queue-enter-free': return applyQueueEnter(session, request, now, requestId);
    case 'official-queue-yield': return applyQueueYield(session, request, now);
    case 'official-queue-hold': return applyQueueHold(session, request, now);
    case 'official-queue-resume': return applyQueueResume(session, request, now);
    case 'official-queue-replace': return applyQueueReplace(session, request, now, operation);
    case 'official-partner-reservation': return applyPartnerReservation(session, request, now, requestId, operation);
    case 'official-partner-cancel': return applyPartnerCancel(session, request, now);
    case 'official-temporary-grant': return applyTemporaryOfficial(session, request, now, operation, true);
    case 'official-temporary-revoke': return applyTemporaryOfficial(session, request, now, operation, false);
    case 'official-settings-update': return applySettingsUpdate(session, request, now, operation);
    case 'official-court-cancel': return applyCourtCancel(session, request, now, operation);
    case 'official-active-replace': return applyActiveReplace(session, request, now, operation);
    case 'official-manual-match': return applyManualMatch(session, request, now, requestId, operation);
    case 'official-player-remove': return applyPlayerRemove(session, request, now, operation);
    case 'official-player-rename': return applyPlayerRename(session, request, now, operation);
    case 'official-player-create': return applyPlayerCreate(session, request, now, operation);
    case 'official-queue-delete': return applyQueueDelete(session, request, now, operation);
    case 'official-queue-regenerate': return applyQueueRegenerate(session, request, now, operation);
    case 'official-reservation-promote': return applyReservationPromote(session, request, now, operation);
    case 'official-finish-mode': return applyFinishMode(session, request, now, operation);
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
  if(!['official-temporary-grant','official-temporary-revoke'].includes(request.type)){
    replenishPrepared(session, {now, requestId});
    // '이번만 뒤로'는 미루려고 누르는 것이라, 그 직후에 자동 투입하면
    // 미룬 대진이 곧바로 다른 코트로 들어가 기능이 무의미해집니다.
    // 경기 취소는 '없던 일로' 되돌리는 것이라, 그 코트에 바로 다른 대진을 밀어넣으면
    // 운영자가 상황을 정리할 틈이 없습니다. 자동 투입 결과를 관리자 원본이 받을 경로도
    // 없어 서버에만 경기가 생겨 갈라집니다(2026-08-04 실측). 빈 코트는 다음 주기에 찹니다.
    if(!['official-queue-yield','official-active-yield','official-court-cancel'].includes(request.type)){
      autoEnterFreeCourts(session, now, requestId, request.actorPlayerId);
    }
  }
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
  TEMPORARY_OFFICIAL_LIMIT,
  applyOfficialRequest,
  applyMemberStatusRequest,
  refreshEvent,
  queuePlayerIds,
  idsFingerprint,
  teamsFingerprint,
  canonicalJson,
  issueOfficialGrant,
  verifyOfficialGrant,
  pruneCommandLedger
};
