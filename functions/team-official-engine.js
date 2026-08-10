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
  'team-official-substitute',
  'team-official-result'
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
/* 게시된 팀원 한 줄은 `{id, n, l, g, gr}` 로 줄여 실립니다(`_buildLiveState`
   의 `liveMember`). 여기서 `name`/`level` 만 읽으면 **실제 팀전에서는 아무도
   못 찾습니다** — 시험용 픽스처만 통과하고 현장에서는 전부 실패합니다.
   그래서 두 표기를 모두 받습니다. */
function memberName(row){ return text(row?.name || row?.n); }
function memberLevel(row){
  const raw = row?.level != null ? row.level : row?.l;
  return number(raw, 4);
}
/* 급수는 옛 게시본에 아예 없습니다. 그럴 땐 대진에 적힌 급수(t1g/t2g)에서
   그 사람 자리를 찾아 씁니다 — 교체 뒤 급수 표시가 빈칸이 되지 않도록. */
function memberGrade(session, name){
  const row = memberByName(session, name);
  const direct = text(row?.grade || row?.gr);
  if(direct)return direct;
  const key = nameKey(name);
  let found = '';
  matchList(session).some(m => {
    const sides = [['t1', 't1g'], ['t2', 't2g']];
    return sides.some(([side, gradeKey]) => {
      const idx = (m?.[side] || []).findIndex(n => nameKey(n) === key);
      if(idx < 0)return false;
      found = text((m?.[gradeKey] || [])[idx]);
      return !!found;
    });
  });
  return found;
}
function memberByName(session, name){
  const key = nameKey(name);
  return memberList(session).find(m => nameKey(memberName(m)) === key) || null;
}
function teamOf(session, name){
  const key = nameKey(name);
  const members = session?.members || {};
  if((members.blue || []).some(m => nameKey(memberName(m)) === key))return 'blue';
  if((members.red || []).some(m => nameKey(memberName(m)) === key))return 'red';
  // 팀 구분 없이 `all` 한 줄로만 실린 자유대진 게시본도 있습니다.
  const row = (members.all || []).find(m => nameKey(memberName(m)) === key);
  const team = text(row?.team);
  return team === 'blue' || team === 'red' ? team : '';
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

/**
 * 대진 지문 — 관리자 화면의 `_teamLiveSignatureFromData` 와 **같은 문자열**을
 * 만들어야 합니다.
 *
 * 관리자 앱은 다시 열릴 때 이 지문으로 "내가 만든 그 대진이 맞나"를 봅니다.
 * 교체로 명단이 바뀌었는데 지문을 옛것 그대로 두면, 관리자는 자기 팀전에서
 * **"다른 대진입니다"로 튕겨 나갑니다.** 그래서 바꾼 쪽이 다시 적습니다.
 */
function sigName(name){ return text(name).replace(/\s+/g, '').trim(); }
function bracketKey(session){
  return JSON.stringify(matchList(session).map(m => [
    number(m?.round, 0),
    number(m?.court, 0),
    text(m?.type),
    (m?.t1 || []).map(sigName).sort(),
    (m?.t2 || []).map(sigName).sort()
  ]).sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || String(a[2]).localeCompare(String(b[2]))));
}

/**
 * 운영할 수 있는 사람 = 클럽 임원 · 운영 도우미 · **단장/부단장**.
 * `officials.leaders` 가 없던 시절 팀전에서는 팀원 명단의 `isLeader`/`isSub`
 * 표시가 유일한 근거라 함께 봅니다(연결 판정 `team-official-claim` 과 같은 기준).
 */
function isOfficial(session, playerName){
  const key = nameKey(playerName);
  if(!key)return false;
  const officials = session?.officials || {};
  const rows = [
    ...(officials.clubOfficials || []),
    ...(officials.temporaryOperators || []),
    ...(officials.leaders || [])
  ];
  if(rows.some(row => nameKey(row?.name) === key))return true;
  return memberList(session).some(m => m && (m.isLeader || m.isSub)
    && nameKey(m.name || m.n) === key);
}

/**
 * 이 선수를 넣으면 두 팀 급수 합이 얼마나 벌어지는가 (운영자 2026-08-14
 * "지각자 대체 시 급수 밸런스가 맞아야 해. 아무나 투입하면 상대에겐 불공정한
 * 게임이 되잖아").
 *
 * 빠지는 사람과 급수가 가까운 사람을 고르는 것만으로는 부족합니다 — 원래 경기가
 * 기울어 있었다면 그 기울기를 그대로 물려받습니다. 그래서 **투입한 뒤의 경기**를
 * 직접 재서 고릅니다.
 */
function sideOfPlayer(match, name){
  const key = nameKey(name);
  if((match?.t1 || []).some(n => nameKey(n) === key))return 't1';
  if((match?.t2 || []).some(n => nameKey(n) === key))return 't2';
  return '';
}
function sideLevelSum(session, list, replaceName, replaceLevel){
  const key = nameKey(replaceName);
  return (list || []).reduce((sum, n) => {
    if(replaceName && nameKey(n) === key)return sum + number(replaceLevel, 4);
    return sum + memberLevel(memberByName(session, n));
  }, 0);
}
function balanceGapAfter(session, match, outName, inLevel){
  const side = sideOfPlayer(match, outName);
  if(!side)return 0;
  const other = side === 't1' ? 't2' : 't1';
  const mine = sideLevelSum(session, match[side], outName, inLevel);
  const theirs = sideLevelSum(session, match[other], '', 0);
  return Math.abs(mine - theirs);
}

/**
 * AI 보조 — 대체 후보를 골라 줍니다(운영자: "ai는 운영의 중심에서 안정적 지원
 * 및 보조 역할"). 결정은 임원이 합니다. 순서:
 *   1) 같은 팀 먼저 (팀 승부의 공정성)
 *   2) **넣고 난 뒤 두 팀 급수 합이 가장 덜 벌어지는 사람**
 *   3) 덜 뛴 사람
 * 같은 라운드에 이미 잡힌 사람은 후보에서 뺍니다.
 */
function suggestSubstitutes(session, matchNum, outName, options = {}){
  const match = findMatch(session, matchNum);
  if(!match)return [];
  const limit = Math.max(1, number(options.limit, 6));
  const outMember = memberByName(session, outName);
  const outTeam = teamOf(session, outName);
  const outLevel = memberLevel(outMember);
  const inMatch = new Set(matchPlayers(match).map(nameKey));
  const played = new Map();
  matchList(session).forEach(m => matchPlayers(m).forEach(p => {
    const k = nameKey(p);
    played.set(k, (played.get(k) || 0) + 1);
  }));
  return memberList(session)
    .filter(m => memberName(m))
    .filter(m => !inMatch.has(nameKey(memberName(m))))
    .filter(m => !conflictingMatch(session, memberName(m), match.round, match.num))
    .map(m => {
      const name = memberName(m);
      const team = teamOf(session, name);
      return {
        name,
        team,
        crossTeam: !!outTeam && !!team && team !== outTeam,
        level: memberLevel(m),
        levelGap: Math.abs(memberLevel(m) - outLevel),
        // 넣고 난 뒤 두 팀 급수 합의 차이. 작을수록 공정한 경기가 됩니다.
        balanceGap: balanceGapAfter(session, match, outName, memberLevel(m)),
        games: played.get(nameKey(name)) || 0
      };
    })
    .sort((a, b) =>
      Number(a.crossTeam) - Number(b.crossTeam) ||
      a.balanceGap - b.balanceGap ||
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
  const inDisplayName = memberName(inMember);
  // 넣고 난 뒤 두 팀 급수 합이 얼마나 벌어지는지 — 되짚을 수 있게 남깁니다.
  // 막지는 않습니다. 임원 자유가 먼저고, 시스템은 재서 알려 줄 뿐입니다.
  const balanceGap = balanceGapAfter(session, match, outName, memberLevel(inMember));
  const gradeKey = side === 't1' ? 't1g' : 't2g';
  match[side] = [...(match[side] || [])];
  match[side][index] = inDisplayName;
  if(Array.isArray(match[gradeKey])){
    match[gradeKey] = [...match[gradeKey]];
    match[gradeKey][index] = memberGrade(session, inDisplayName);
  }
  // 누가 언제 무엇을 바꿨는지 남깁니다 — 현장에서 되짚을 수 있어야 합니다.
  session.substitutions = Array.isArray(session.substitutions) ? session.substitutions : [];
  session.substitutions.push({
    at: number(now, Date.now()),
    matchNum: number(match.num, 0),
    round: number(match.round, 0),
    out: outName,
    in: inDisplayName,
    crossTeam,
    balanceGap,
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
        in: inDisplayName,
        crossTeam,
        balanceGap
      }
    };
  }
  return '';
}

/* 회원 화면과 **같은 규칙**으로 다시 셉니다(live-view 의 승패 입력 트랜잭션과
   한 글자도 다르면 안 됩니다): t1 = 청팀, 현재 라운드 = 아직 안 끝난 첫 라운드. */
function matchKey(match){
  return `${number(match?.round, 0)}_${number(match?.court, 0)}`;
}
function usesFixedTeams(session){
  if(!session)return false;
  if(text(session.matchMode) === 'free')return false;
  if(text(session.matchMode) === 'team')return true;
  return !!session.isTeam;
}
function recountSession(session){
  const rows = matchList(session);
  let blueWins = 0, whiteWins = 0;
  if(usesFixedTeams(session)){
    rows.forEach(m => {
      if(text(m?.win) === 't1')blueWins += 1;
      else if(text(m?.win) === 't2')whiteWins += 1;
    });
  }
  session.blueWins = blueWins;
  session.whiteWins = whiteWins;
  const rounds = [...new Set(rows.map(m => number(m?.round, 0)).filter(Boolean))].sort((a, b) => a - b);
  session.currentRound = rounds.find(r => rows.filter(m => number(m?.round, 0) === r).some(m => !text(m?.win))) || 0;
}

/**
 * 승패 정정 (운영자 2026-08-13, 4단계에서 드러난 막다른 길).
 *
 * 회원·임원이 승패를 한 번 넣으면 그 뒤로는 **아무도 못 고칩니다** — 다른 값을
 * 넣으면 「관리자 확인으로 보냈어요」로 넘어갈 뿐입니다. 그런데 관리자는 이제
 * 최초 생성만 하고 손을 뗍니다. 현장에서 잘못 눌린 승패가 **영원히 굳는다**는
 * 뜻이라, 임원이 자기 폰에서 고칠 수 있어야 합니다.
 *
 * 라운드 제한을 두지 않습니다 — 지난 라운드를 바로잡는 것이 이 명령의 목적입니다.
 */
function applyResult(session, request, now, operation){
  const match = findMatch(session, request.matchNum);
  if(!match)return '정정할 경기를 찾지 못했습니다.';
  const want = text(request.win);
  if(want && want !== 't1' && want !== 't2')return '승패 값이 올바르지 않습니다.';
  const before = text(match.win);
  // 지문 — 내가 본 화면과 서버가 같은지. 그 사이 누가 바꿨으면 되돌립니다.
  if(request.expectedWin !== undefined && text(request.expectedWin) !== before){
    return '그 사이 다른 결과가 입력됐습니다. 화면을 새로 고친 뒤 다시 봐 주세요.';
  }
  if(want === before)return '이미 같은 결과입니다.';

  if(want){
    match.win = want;
    match.winAt = number(now, Date.now());
    match.winBy = text(request.actorPlayerName || '');
    match.winByRole = 'officialCorrection';
  }else{
    delete match.win;
    delete match.winAt;
    delete match.winBy;
    delete match.winByMemberId;
    delete match.winByRole;
  }
  // 임원이 결론을 냈으므로 이 경기의 '승패 확인' 대기는 함께 정리합니다.
  const key = matchKey(match);
  if(session.resultConflicts && session.resultConflicts[key]){
    session.resultConflicts = {...session.resultConflicts};
    delete session.resultConflicts[key];
  }
  recountSession(session);
  session.resultEdits = Array.isArray(session.resultEdits) ? session.resultEdits : [];
  session.resultEdits.push({
    at: number(now, Date.now()),
    matchNum: number(match.num, 0),
    round: number(match.round, 0),
    from: before,
    to: want,
    by: text(request.actorPlayerName || '')
  });
  if(operation){
    operation.result = {result: {matchNum: number(match.num, 0), from: before, to: want,
      blueWins: number(session.blueWins, 0), whiteWins: number(session.whiteWins, 0)}};
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
    case 'team-official-result':
      reason = applyResult(session, request, now, operation);
      break;
    default:
      reason = '지원하지 않는 팀전 운영 요청입니다.';
  }
  if(reason)return {status: 'rejected', reason, session: rawSession, result: null};
  // 대진이 바뀌었으면 지문도 함께 고쳐 둡니다(관리자가 튕기지 않도록).
  if(matchList(session).length)session.bracketKey = bracketKey(session);
  session.updatedAt = now;
  return {status: 'applied', reason: '', session, result: operation.result || null};
}

module.exports = {
  SUPPORTED_TYPES,
  bracketKey,
  balanceGapAfter,
  applyTeamOfficialRequest,
  suggestSubstitutes,
  teamOf,
  conflictingMatch,
  isOfficial
};
