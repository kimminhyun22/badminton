'use strict';
/**
 * 팀전 임원 운영 엔진 (운영자 2026-08-13 결정).
 *
 *   "관리자는 최초 게임을 생성하는 역할만 하고 이후는 임원이 모두 운영하는
 *    민턴라이브 방식… 임원 운영을 중심으로 서버 동기화"
 *   "현실에서는 팀전에서도 갑작스런 불참 및 인원 변경이 발생해. 이 경우
 *    땜방으로 진행하는 수밖에 없어서 계획대로만 되지는 않거든"
 *
 * 그래서 이 엔진은 **서버가 권한의 중심**입니다. 관리자 앱이 꺼져 있어도
 * 임원의 조작이 그대로 반영됩니다(민턴LIVE `daily-official-engine` 과 같은 계약).
 *
 * 첫 명령은 현장에서 가장 급한 것 하나 — **대체 투입**입니다.
 * 원칙(운영자 확정): 임원 자유 최대. 같은 팀이든 다른 팀이든 넣을 수 있고,
 * 팀을 넘을 때만 경고를 돌려줍니다. 판단은 사람이, 안전은 시스템이 맡습니다.
 */

const SUPPORTED_TYPES = new Set([
  'team-official-substitute'
]);

function text(value){ return String(value == null ? '' : value); }
function number(value, fallback = 0){
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function clone(value){ return value == null ? value : JSON.parse(JSON.stringify(value)); }
function nameKey(value){ return text(value).replace(/\s+/g, '').toLowerCase(); }

function matchList(session){
  return Array.isArray(session?.matches) ? session.matches : [];
}
function matchPlayers(match){
  return [...(match?.t1 || []), ...(match?.t2 || [])].map(text).filter(Boolean);
}
function findMatch(session, num){
  const target = number(num, -1);
  return matchList(session).find(m => number(m?.num, -1) === target) || null;
}
function isDecided(match){
  return !!text(match?.win);
}
// 이미 시작한 경기는 코트에서 뛰고 있다는 뜻입니다(같은 코트 앞 경기가 끝난 시각).
function isStarted(match){
  return !!number(match?.startAt) || isDecided(match);
}
function memberList(session){
  const members = session?.members || {};
  if(Array.isArray(members.all) && members.all.length)return members.all;
  return [...(members.blue || []), ...(members.red || [])];
}
function memberByName(session, name){
  const key = nameKey(name);
  return memberList(session).find(m => nameKey(m?.name) === key) || null;
}
function teamOf(session, name){
  const key = nameKey(name);
  const members = session?.members || {};
  if((members.blue || []).some(m => nameKey(m?.name) === key))return 'blue';
  if((members.red || []).some(m => nameKey(m?.name) === key))return 'red';
  return '';
}
// 그 사람이 지금 뛰고 있거나 같은 라운드에 이미 잡혀 있으면 또 넣을 수 없습니다.
function conflictingMatch(session, name, round, exceptNum){
  const key = nameKey(name);
  return matchList(session).find(m => {
    if(number(m?.num, -1) === number(exceptNum, -2))return false;
    if(number(m?.round, -1) !== number(round, -1))return false;
    if(isDecided(m))return false;
    return matchPlayers(m).some(p => nameKey(p) === key);
  }) || null;
}
function idsFingerprint(list){
  return (list || []).map(nameKey).filter(Boolean).sort((a, b) => a.localeCompare(b)).join('|');
}

function isOfficial(session, playerName){
  const key = nameKey(playerName);
  if(!key)return false;
  const officials = session?.officials || {};
  const rows = [
    ...(officials.clubOfficials || []),
    ...(officials.temporaryOperators || []),
    ...(officials.leaders || [])
  ];
  return rows.some(row => nameKey(row?.name) === key);
}

/**
 * AI 보조 — 대체 후보를 골라 줍니다(운영자: "ai는 운영의 중심에서 안정적 지원
 * 및 보조 역할"). 결정은 임원이 합니다. 순서:
 *   1) 같은 팀 먼저 (팀 승부의 공정성)
 *   2) 급수가 가까운 사람
 *   3) 덜 뛴 사람
 * 같은 라운드에 이미 잡힌 사람은 후보에서 뺍니다.
 */
function suggestSubstitutes(session, matchNum, outName, options = {}){
  const match = findMatch(session, matchNum);
  if(!match)return [];
  const limit = Math.max(1, number(options.limit, 6));
  const outMember = memberByName(session, outName);
  const outTeam = teamOf(session, outName);
  const outLevel = number(outMember?.level, 4);
  const inMatch = new Set(matchPlayers(match).map(nameKey));
  const played = new Map();
  matchList(session).forEach(m => matchPlayers(m).forEach(p => {
    const k = nameKey(p);
    played.set(k, (played.get(k) || 0) + 1);
  }));
  return memberList(session)
    .filter(m => m && m.name)
    .filter(m => !inMatch.has(nameKey(m.name)))
    .filter(m => !conflictingMatch(session, m.name, match.round, match.num))
    .map(m => {
      const team = teamOf(session, m.name);
      return {
        name: text(m.name),
        team,
        crossTeam: !!outTeam && !!team && team !== outTeam,
        level: number(m.level, 4),
        levelGap: Math.abs(number(m.level, 4) - outLevel),
        games: played.get(nameKey(m.name)) || 0
      };
    })
    .sort((a, b) =>
      Number(a.crossTeam) - Number(b.crossTeam) ||
      a.levelGap - b.levelGap ||
      a.games - b.games ||
      a.name.localeCompare(b.name, 'ko'))
    .slice(0, limit);
}

function applySubstitute(session, request, now, operation){
  const match = findMatch(session, request.matchNum);
  if(!match)return '교체할 경기를 찾지 못했습니다.';
  if(isDecided(match))return '이미 결과가 입력된 경기입니다.';
  if(request.allowStarted !== true && isStarted(match)){
    return '이미 시작한 경기입니다. 그래도 바꾸려면 다시 확인해 주세요.';
  }
  // 지문 — 그 사이 대진이 바뀌었으면 되돌립니다(민턴LIVE와 같은 규칙).
  if(request.expectedT1 && idsFingerprint(request.expectedT1) !== idsFingerprint(match.t1)){
    return '경기 구성이 이미 바뀌었습니다.';
  }
  if(request.expectedT2 && idsFingerprint(request.expectedT2) !== idsFingerprint(match.t2)){
    return '경기 구성이 이미 바뀌었습니다.';
  }
  const outName = text(request.outName);
  const inName = text(request.inName);
  if(!outName || !inName)return '빠지는 선수와 들어갈 선수를 함께 지정해 주세요.';
  if(nameKey(outName) === nameKey(inName))return '같은 선수입니다.';

  const side = (match.t1 || []).some(n => nameKey(n) === nameKey(outName)) ? 't1'
    : (match.t2 || []).some(n => nameKey(n) === nameKey(outName)) ? 't2' : '';
  if(!side)return '빠지는 선수를 이 경기에서 찾지 못했습니다.';
  if(matchPlayers(match).some(n => nameKey(n) === nameKey(inName))){
    return '이미 이 경기에서 뛰는 선수입니다.';
  }
  const inMember = memberByName(session, inName);
  if(!inMember)return '들어갈 선수를 명단에서 찾지 못했습니다.';

  const clash = conflictingMatch(session, inName, match.round, match.num);
  if(clash)return `${inName} 선수는 같은 라운드 ${number(clash.num, 0)}번 경기에 이미 들어가 있습니다.`;

  // 팀을 넘는 투입은 막지 않되 **경고**로 돌려줍니다(운영자 확정 2026-08-13).
  const outTeam = teamOf(session, outName);
  const inTeam = teamOf(session, inName);
  const crossTeam = !!outTeam && !!inTeam && outTeam !== inTeam;
  if(crossTeam && request.allowCrossTeam !== true){
    return `${inName} 선수는 상대 팀입니다. 팀을 넘겨 넣으려면 확인이 필요합니다.`;
  }

  const index = (match[side] || []).findIndex(n => nameKey(n) === nameKey(outName));
  if(index < 0)return '빠지는 선수를 이 경기에서 찾지 못했습니다.';
  const gradeKey = side === 't1' ? 't1g' : 't2g';
  match[side] = [...(match[side] || [])];
  match[side][index] = text(inMember.name);
  if(Array.isArray(match[gradeKey])){
    match[gradeKey] = [...match[gradeKey]];
    match[gradeKey][index] = text(inMember.grade || '');
  }
  // 누가 언제 무엇을 바꿨는지 남깁니다 — 현장에서 되짚을 수 있어야 합니다.
  session.substitutions = Array.isArray(session.substitutions) ? session.substitutions : [];
  session.substitutions.push({
    at: number(now, Date.now()),
    matchNum: number(match.num, 0),
    round: number(match.round, 0),
    out: outName,
    in: text(inMember.name),
    crossTeam,
    by: text(request.actorPlayerName || ''),
    reason: text(request.reason || '')
  });
  if(operation){
    operation.result = {
      substitute: {
        matchNum: number(match.num, 0),
        round: number(match.round, 0),
        side,
        out: outName,
        in: text(inMember.name),
        crossTeam
      }
    };
  }
  return '';
}

function validate(session, request, options = {}){
  if(!SUPPORTED_TYPES.has(text(request?.type)))return '지원하지 않는 팀전 운영 요청입니다.';
  const adminClaim = options.adminClaim === true;
  if(!adminClaim && !isOfficial(session, request?.actorPlayerName)){
    return '팀전 운영은 단장·부단장·클럽 임원만 할 수 있습니다.';
  }
  const now = number(options.now, Date.now());
  if(number(request?.expiresAt) && now > number(request.expiresAt)){
    return '요청 시간이 지났습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.';
  }
  return '';
}

/**
 * 임원 요청 하나를 세션에 적용합니다.
 * 반환: {status:'applied'|'rejected', reason, session, result}
 */
function applyTeamOfficialRequest(rawSession, request, options = {}){
  const session = clone(rawSession) || {};
  const now = number(options.now, Date.now());
  const invalid = validate(session, request, options);
  if(invalid)return {status: 'rejected', reason: invalid, session: rawSession, result: null};
  const operation = {};
  let reason = '';
  switch(text(request.type)){
    case 'team-official-substitute':
      reason = applySubstitute(session, request, now, operation);
      break;
    default:
      reason = '지원하지 않는 팀전 운영 요청입니다.';
  }
  if(reason)return {status: 'rejected', reason, session: rawSession, result: null};
  session.updatedAt = now;
  return {status: 'applied', reason: '', session, result: operation.result || null};
}

module.exports = {
  SUPPORTED_TYPES,
  applyTeamOfficialRequest,
  suggestSubstitutes,
  teamOf,
  conflictingMatch,
  isOfficial
};
