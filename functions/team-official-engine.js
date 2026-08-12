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
  'team-official-result',
  'team-official-late',
  'team-official-void',
  'team-official-rename',
  'team-official-court',
  'team-official-finish',
  'team-official-roster',
  'team-official-undo'
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
/* 치르지 않기로 한 경기(미실시). 결과는 없지만 **끝난 것으로 셉니다** —
   안 그러면 그 라운드가 영원히 안 넘어갑니다(운영자 2026-08-14). */
function isVoided(match){ return match?.voided === true; }
function isSettled(match){ return isDecided(match) || isVoided(match); }
/* 이미 시작한 경기 = **지금 코트에서 뛰고 있는** 경기.
   `startAt` 은 그 코트가 이 경기 차례가 된 시각이라 다음 라운드 경기에도 붙습니다.
   그래서 지금 라운드인지까지 봅니다 — 안 그러면 다음 대진을 미리 손볼 때마다
   "이미 시작한 경기"로 걸립니다(화면 `_isMatchUnderway` 와 같은 규칙).
   `currentRound` 가 없는 옛 게시본은 예전처럼 startAt 만 봅니다. */
function isStarted(session, match){
  if(isDecided(match))return true;
  if(!number(match?.startAt))return false;
  const current = number(session?.currentRound, 0);
  return !current || number(match?.round, -1) === current;
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
/**
 * 그 라운드에 이미 이름이 올라간 사람은 대체로 넣을 수 없습니다.
 *
 * **끝난 경기도 셉니다** (운영자 2026-08-14 "교체 인원은 해당 라운드에 뛰는
 * 선수는 아니겠지?"). 예전에는 같은 라운드라도 이미 결과가 입력된 경기는 건너뛰어서,
 * **1코트에서 방금 뛰고 나온 사람이 2코트 교체 후보로 떴습니다.** 한 라운드에 두
 * 경기를 뛰게 되고, 그만큼 남의 경기 수를 가져갑니다.
 */
function conflictingMatch(session, name, round, exceptNum){
  const key = nameKey(name);
  return matchList(session).find(m => {
    if(number(m?.num, -1) === number(exceptNum, -2))return false;
    if(number(m?.round, -1) !== number(round, -1))return false;
    if(isVoided(m))return false;   // 안 치르는 경기는 자리를 차지하지 않습니다
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
  // 화면이 버튼을 띄우는 근거(팀원 줄의 표시)와 **같은 것**을 봅니다.
  // 여기가 어긋나면 "버튼은 보이는데 누르면 거절"이 됩니다.
  return memberList(session).some(m => m
    && (m.isLeader || m.isSub || m.isClubOfficial || m.isTemporaryOperator)
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
/* **부호가 있는** 기울기: 교체하는 쪽 급수 합 − 상대 급수 합.
   양수면 교체한 팀이 세고(상대에게 불합리), 음수면 그 팀이 약합니다.
   운영자 2026-08-14: "+, - 로 표기하고 컬러는 +는 레드, -는 블루" */
function balanceAfter(session, match, outName, inLevel){
  const side = sideOfPlayer(match, outName);
  if(!side)return 0;
  const other = side === 't1' ? 't2' : 't1';
  const mine = sideLevelSum(session, match[side], outName, inLevel);
  const theirs = sideLevelSum(session, match[other], '', 0);
  return mine - theirs;
}
function balanceGapAfter(session, match, outName, inLevel){
  return Math.abs(balanceAfter(session, match, outName, inLevel));
}

/**
 * AI 보조 — 대체 후보를 골라 줍니다(운영자: "ai는 운영의 중심에서 안정적 지원
 * 및 보조 역할"). 결정은 임원이 합니다. 순서:
 *   1) 같은 팀 먼저 (팀 승부의 공정성)
 *   2) **교체로 그 팀이 더 세지지 않을 것** — 운영자 2026-08-14:
 *      "교체는 팀 패널티인데 패널티를 받는 팀이 교체로 더 유리해지는 것은 불합리"
 *   3) 넣고 난 뒤 두 팀 급수 합이 가장 덜 벌어지는 사람 (차이 1도 승부를 기울인다)
 *   4) 덜 뛴 사람
 * 같은 라운드에 이미 잡힌 사람은 후보에서 뺍니다.
 */
function suggestSubstitutes(session, matchNum, outName, options = {}){
  const match = findMatch(session, matchNum);
  if(!match)return [];
  // 기본은 **전원**입니다. 자르면 임원이 고를 수 있는 폭이 줄어듭니다
  // (운영자 2026-08-14). 부르는 쪽이 원하면 limit 으로 줄일 수 있습니다.
  const limit = Math.max(1, number(options.limit, Number.MAX_SAFE_INTEGER));
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
        // 넣고 난 뒤의 기울기. 0 이 가장 공정하고, 양수면 교체한 팀이 셉니다.
        balance: balanceAfter(session, match, outName, memberLevel(m)),
        balanceGap: balanceGapAfter(session, match, outName, memberLevel(m)),
        // 빠지는 사람보다 세면 그 팀이 교체로 이득을 봅니다(양수 = 강해짐).
        swing: memberLevel(m) - outLevel,
        games: played.get(nameKey(name)) || 0
      };
    })
    .sort((a, b) =>
      Number(a.crossTeam) - Number(b.crossTeam) ||
      // 0 에 가까운 순. 같은 크기면 **덜 유리한 쪽**(음수)을 먼저 — 사람이 빠진 팀이
      // 교체로 이득을 보면 상대가 불합리합니다(운영자 2026-08-14).
      Math.abs(a.balance) - Math.abs(b.balance) ||
      Number(a.balance > 0) - Number(b.balance > 0) ||
      a.games - b.games ||
      a.name.localeCompare(b.name, 'ko'))
    .slice(0, limit);
}

function applySubstitute(session, request, now, operation){
  const match = findMatch(session, request.matchNum);
  if(!match)return '교체할 경기를 찾지 못했습니다.';
  if(isVoided(match))return '치르지 않기로 한 경기입니다.';
  if(isDecided(match))return '이미 결과가 입력된 경기입니다.';
  if(request.allowStarted !== true && isStarted(session, match)){
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
  const balance = balanceAfter(session, match, outName, memberLevel(inMember));
  const balanceGap = Math.abs(balance);
  const swing = memberLevel(inMember) - memberLevel(memberByName(session, outName));
  const gradeKey = side === 't1' ? 't1g' : 't2g';
  match[side] = [...(match[side] || [])];
  match[side][index] = inDisplayName;
  if(Array.isArray(match[gradeKey])){
    match[gradeKey] = [...match[gradeKey]];
    match[gradeKey][index] = memberGrade(session, inDisplayName);
  }
  // 누가 언제 무엇을 바꿨는지 남깁니다 — 현장에서 되짚을 수 있어야 합니다.
  session.substitutions = Array.isArray(session.substitutions) ? session.substitutions : [];
  pushLog(session, {at:number(now, Date.now()), by:text(request.actorPlayerName || ''),
    type:'substitute', label:`${number(match.num,0)}번 ${outName}→${inDisplayName}`,
    undo:{type:'team-official-substitute', matchNum:number(match.num, 0),
      outName:inDisplayName, inName:outName, allowCrossTeam:true, allowStarted:true}});
  session.substitutions.push({
    at: number(now, Date.now()),
    matchNum: number(match.num, 0),
    round: number(match.round, 0),
    out: outName,
    in: inDisplayName,
    crossTeam,
    balance,
    balanceGap,
    swing,
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
        balance,
        balanceGap,
        swing
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
  session.currentRound = rounds.find(r => rows.filter(m => number(m?.round, 0) === r).some(m => !isSettled(m))) || 0;
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
    // 처음 넣은 것과 고친 것을 구분해 둡니다(기록을 나중에 읽을 때 헷갈리지 않게).
    match.winByRole = before ? 'officialCorrection' : 'official';
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
  pushLog(session, {at:number(now, Date.now()), by:text(request.actorPlayerName || ''),
    type:'result', label:`${number(match.num,0)}번 승패 ${before||'없음'}→${want||'없음'}`,
    undo:{type:'team-official-result', matchNum:number(match.num, 0), win:before, expectedWin:want}});
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

/**
 * 지각 표시 (운영자 2026-08-14 "운영관리는 임원과 단장 위주로").
 *
 * 예전에는 회원 화면이 `live/<id>/late/<키>` 에 **직접 썼습니다.** 그러면 링크만
 * 아는 사람은 누구나 남의 출결을 바꿀 수 있고, 서명 권한도 무의미해집니다.
 * 이제 다른 조작과 같은 문으로 들어옵니다.
 *
 * 키는 화면(`_attKey`)과 **같은 방식**으로 만들어야 같은 칸을 가리킵니다.
 */
function attendanceKey(name){
  return encodeURIComponent(text(name)).replace(/[.#$[\]/']/g, '_');
}
function applyLate(session, request, now){
  const name = text(request.playerName).trim();
  if(!name)return '누구인지 지정해 주세요.';
  const member = memberByName(session, name);
  if(!member)return '명단에서 그 선수를 찾지 못했습니다.';
  const key = attendanceKey(memberName(member));
  const late = {...(session.late || {})};
  if(request.late === true){
    late[key] = {
      name: memberName(member),
      team: teamOf(session, name) === 'red' ? 'red' : (teamOf(session, name) || ''),
      source: 'official-late',
      ts: number(now, Date.now())
    };
  }else{
    delete late[key];
  }
  session.late = late;
  pushLog(session, {at:number(now, Date.now()), by:text(request.actorPlayerName || ''),
    type:'late', label:`${memberName(member)} 지각 ${request.late === true ? '표시' : '해제'}`,
    undo:{type:'team-official-late', playerName:memberName(member), late:request.late !== true}});
  return '';
}

/**
 * 경기 미실시 (운영자 2026-08-14 ③단계).
 *
 * 시간이 모자라거나 도저히 못 치르는 경기가 생기면, 그대로 두면 **그 라운드가
 * 끝나지 않아 다음 라운드로 넘어가지 못합니다.** 결과를 지어내지 않고 "안 치름"
 * 으로 표시해 진행만 넘깁니다. 승패 집계에는 들어가지 않습니다.
 */
function applyVoid(session, request, now, operation){
  const match = findMatch(session, request.matchNum);
  if(!match)return '표시할 경기를 찾지 못했습니다.';
  const want = request.voided !== false;
  if(want && isDecided(match)){
    return '결과가 입력된 경기입니다. 결과를 먼저 지운 뒤 미실시로 표시해 주세요.';
  }
  if(want === isVoided(match)){
    return want ? '이미 미실시로 표시된 경기입니다.' : '미실시가 아닌 경기입니다.';
  }
  if(want){
    match.voided = true;
    match.voidedBy = text(request.actorPlayerName || '');
    match.voidedAt = number(now, Date.now());
  }else{
    delete match.voided;
    delete match.voidedBy;
    delete match.voidedAt;
  }
  recountSession(session);
  pushLog(session, {at:number(now, Date.now()), by:text(request.actorPlayerName || ''),
    type:'void', label:`${number(match.num,0)}번 ${want ? '미실시' : '미실시 해제'}`,
    undo:{type:'team-official-void', matchNum:number(match.num, 0), voided:!want}});
  session.resultEdits = Array.isArray(session.resultEdits) ? session.resultEdits : [];
  session.resultEdits.push({
    at: number(now, Date.now()),
    matchNum: number(match.num, 0),
    round: number(match.round, 0),
    from: want ? '' : 'void',
    to: want ? 'void' : '',
    by: text(request.actorPlayerName || '')
  });
  if(operation){
    operation.result = {void:{matchNum:number(match.num, 0), voided:want,
      currentRound:number(session.currentRound, 0)}};
  }
  return '';
}

/* ── 되돌리기용 기록 ───────────────────────────────────────────────────────
   조작마다 **되돌릴 명령**을 함께 적어 둡니다. 그래야 마지막 조작 하나를
   그대로 뒤집을 수 있습니다(운영자 2026-08-14 ③단계). 최근 50건만 남깁니다. */
function pushLog(session, entry){
  session.officialLog = Array.isArray(session.officialLog) ? session.officialLog : [];
  session.officialLog.push(entry);
  if(session.officialLog.length > 50){
    session.officialLog = session.officialLog.slice(-50);
  }
}

/**
 * 이름 수정 (오타·동명이인 구분).
 * 명단·대진표·지각·뒷풀이에 흩어진 이름을 **한 번에** 바꿉니다. 한 군데만 바꾸면
 * 그 사람이 두 사람이 되어 교체·집계가 어긋납니다.
 */
function renameEverywhere(session, from, to){
  const key = nameKey(from);
  const setName = row => {
    if(!row)return;
    if(row.name != null)row.name = to;
    if(row.n != null)row.n = to;
  };
  const members = session.members || {};
  ['blue', 'red', 'all'].forEach(side => {
    (members[side] || []).forEach(row => { if(nameKey(memberName(row)) === key)setName(row); });
  });
  ['clubOfficials', 'temporaryOperators', 'leaders'].forEach(group => {
    ((session.officials || {})[group] || []).forEach(row => {
      if(nameKey(row?.name) === key)row.name = to;
    });
  });
  matchList(session).forEach(m => {
    ['t1', 't2'].forEach(side => {
      m[side] = (m[side] || []).map(n => nameKey(n) === key ? to : n);
    });
    if(nameKey(m.winBy) === key)m.winBy = to;
  });
  // 지각·뒷풀이는 이름으로 키를 만들므로 칸을 옮겨 줍니다.
  ['late', 'party'].forEach(mapName => {
    const map = session[mapName];
    if(!map || typeof map !== 'object')return;
    Object.keys(map).forEach(k => {
      if(nameKey(map[k]?.name) !== key)return;
      const row = {...map[k], name: to};
      delete map[k];
      map[attendanceKey(to)] = row;
    });
  });
}
function applyRename(session, request, now, operation){
  const from = text(request.fromName).trim();
  const to = text(request.toName).trim();
  if(!from || !to)return '바꿀 이름과 새 이름을 함께 지정해 주세요.';
  if(nameKey(from) === nameKey(to))return '같은 이름입니다.';
  if(!memberByName(session, from))return '명단에서 그 선수를 찾지 못했습니다.';
  if(memberByName(session, to))return `${to} 은(는) 이미 명단에 있는 이름입니다.`;
  renameEverywhere(session, from, to);
  if(matchList(session).length)session.bracketKey = bracketKey(session);
  pushLog(session, {at:number(now, Date.now()), by:text(request.actorPlayerName || ''),
    type:'rename', label:`${from} → ${to}`,
    undo:{type:'team-official-rename', fromName:to, toName:from}});
  if(operation)operation.result = {rename:{from, to}};
  return '';
}

/**
 * 코트 번호 정정 — 실제로 쓰는 코트와 화면이 다를 때.
 * 같은 라운드에 그 번호를 쓰는 경기가 있으면 **맞바꿉니다**(확인을 받은 뒤).
 */
function applyCourt(session, request, now, operation){
  const match = findMatch(session, request.matchNum);
  if(!match)return '경기를 찾지 못했습니다.';
  const to = number(request.court, 0);
  const from = number(match.court, 0);
  if(!to || to < 1)return '코트 번호가 올바르지 않습니다.';
  const courts = number(session.courts, 0);
  if(courts && to > courts)return `코트는 ${courts}개까지 있습니다.`;
  if(to === from)return '같은 코트입니다.';
  const clash = matchList(session).find(m => number(m?.round, -1) === number(match.round, -1)
    && number(m?.court, -1) === to && number(m?.num, -2) !== number(match.num, -1));
  if(clash && request.allowSwap !== true){
    return `${to}코트는 같은 라운드 ${number(clash.num, 0)}번 경기가 씁니다. 맞바꾸려면 확인이 필요합니다.`;
  }
  match.court = to;
  if(clash)clash.court = from;
  if(matchList(session).length)session.bracketKey = bracketKey(session);
  pushLog(session, {at:number(now, Date.now()), by:text(request.actorPlayerName || ''),
    type:'court', label:`${number(match.num, 0)}번 경기 ${from}→${to}코트`,
    undo:{type:'team-official-court', matchNum:number(match.num, 0), court:from, allowSwap:true}});
  if(operation)operation.result = {court:{matchNum:number(match.num, 0), from, to, swapped:!!clash}};
  return '';
}

/**
 * 팀전 마무리 — **임원이 끝을 선언합니다**.
 *
 * 지금까지 끝을 낼 수 있는 사람은 관리자뿐이었고, 관리자의 「팀전 종료」는 회원
 * 링크의 데이터를 **지웁니다**. 그러면 최종 점수도 뒷풀이 명단도 같이 사라집니다.
 * 여기서는 지우지 않고 마무리만 표시해, 결과 화면은 그대로 남깁니다.
 *
 * 결과가 없는 경기가 남았으면 한 번 되묻습니다(시간이 모자라 못 치른 경우가
 * 있어 막지는 않습니다 — 운영자 판단이 우선).
 */
function applyFinish(session, request, now, operation){
  const want = request.finished !== false;
  const already = !!number(session.finishedAt);
  if(want === already)return want ? '이미 마무리한 팀전입니다.' : '마무리하지 않은 팀전입니다.';
  if(want){
    const left = matchList(session).filter(m => !isSettled(m));
    if(left.length && request.allowUnfinished !== true){
      return `아직 결과가 없는 경기가 ${left.length}개 있습니다. 그대로 마무리하려면 확인이 필요합니다.`;
    }
    session.finishedAt = number(now, Date.now());
    session.finishedBy = text(request.actorPlayerName || '');
  }else{
    delete session.finishedAt;
    delete session.finishedBy;
  }
  pushLog(session, {at:number(now, Date.now()), by:text(request.actorPlayerName || ''),
    type:'finish', label:want ? '팀전 마무리' : '마무리 해제',
    undo:{type:'team-official-finish', finished:!want, allowUnfinished:true}});
  if(operation)operation.result = {finish:{finished:want}};
  return '';
}

/**
 * 명단 고치기 — 갑자기 한 명 더 오거나, 못 오게 됐을 때.
 *
 * 지금까지는 관리자 화면에서만 됐습니다. 임원이 현장에서 고칠 수 있어야 관리자를
 * 부르지 않습니다.
 *
 * 뺄 때는 **아직 안 끝난 경기에 이름이 있으면 막습니다.** 그냥 빼면 대진표에
 * 이름만 남아 그 자리가 비었는지 아닌지 아무도 모르게 됩니다. 대체 투입이 먼저입니다.
 *
 * 관리자 화면이 따라올 수 있도록 `rosterEdits` 에 순서대로 적어 둡니다
 * (관리자는 이 목록을 처음부터 다시 훑어 반영하므로 몇 번을 읽어도 같은 결과입니다).
 */
function pushRosterEdit(session, entry){
  session.rosterEdits = Array.isArray(session.rosterEdits) ? session.rosterEdits : [];
  session.rosterEdits.push(entry);
  if(session.rosterEdits.length > 50)session.rosterEdits = session.rosterEdits.slice(-50);
}
function applyRoster(session, request, now, operation){
  const action = text(request.action);
  const name = text(request.playerName).trim();
  if(!name)return '누구인지 지정해 주세요.';
  if(action !== 'add' && action !== 'remove')return '명단을 어떻게 고칠지 지정해 주세요.';
  const members = session.members && typeof session.members === 'object' ? session.members : {};
  session.members = members;
  const fixedTeams = usesFixedTeams(session);

  if(action === 'add'){
    if(memberByName(session, name))return `${name} 은(는) 이미 명단에 있습니다.`;
    const side = text(request.team) === 'red' ? 'red' : 'blue';
    const level = number(request.level, 4);
    const grade = text(request.grade || '');
    const row = {
      id: 'field_' + number(now, Date.now()).toString(36) + '_' + nameKey(name),
      n: name, l: level, g: text(request.gender || ''), gr: grade,
      isGuest: true, addedByOfficial: true
    };
    if(fixedTeams){
      members[side] = Array.isArray(members[side]) ? members[side] : [];
      members[side].push(row);
      // `all` 을 쓰는 게시본이라면 거기에도 넣어야 합니다. `memberList` 는 `all`
      // 이 차 있으면 그것만 보므로, 한쪽만 넣으면 **넣은 사람을 아무도 못 찾습니다**
      // (대체 후보·팀 판정·이름 수정이 전부 빗나갑니다).
      if(Array.isArray(members.all) && members.all.length)members.all.push({...row, team:side});
    }else{
      members.all = Array.isArray(members.all) ? members.all : [];
      members.all.push(row);
    }
    pushRosterEdit(session, {at:number(now, Date.now()), action:'add', name,
      team:fixedTeams ? side : '', level, grade, gender:text(request.gender || ''),
      by:text(request.actorPlayerName || '')});
    pushLog(session, {at:number(now, Date.now()), by:text(request.actorPlayerName || ''),
      type:'roster', label:`${name} 명단 추가${fixedTeams ? ` (${side === 'red' ? '홍' : '청'}팀)` : ''}`,
      undo:{type:'team-official-roster', action:'remove', playerName:name}});
    if(operation)operation.result = {roster:{action:'add', name, team:fixedTeams ? side : ''}};
    return '';
  }

  const member = memberByName(session, name);
  if(!member)return '명단에서 그 선수를 찾지 못했습니다.';
  const pending = matchList(session).find(m => !isSettled(m)
    && matchPlayers(m).some(n => nameKey(n) === nameKey(name)));
  if(pending){
    return `${name} 은(는) ${number(pending.num, 0)}번 경기에 들어 있습니다. 대체 투입을 먼저 해 주세요.`;
  }
  const side = teamOf(session, name);
  const level = memberLevel(member);
  const grade = memberGrade(session, name);
  const key = nameKey(name);
  ['blue', 'red', 'all'].forEach(group => {
    if(!Array.isArray(members[group]))return;
    members[group] = members[group].filter(row => nameKey(memberName(row)) !== key);
  });
  pushRosterEdit(session, {at:number(now, Date.now()), action:'remove', name,
    team:side, level, grade, by:text(request.actorPlayerName || '')});
  pushLog(session, {at:number(now, Date.now()), by:text(request.actorPlayerName || ''),
    type:'roster', label:`${name} 명단 제외`,
    undo:{type:'team-official-roster', action:'add', playerName:name, team:side,
      level, grade, gender:text(member.gender || member.g || '')}});
  if(operation)operation.result = {roster:{action:'remove', name, team:side}};
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
 * 되돌리기 — **마지막 조작 하나**를 그대로 뒤집습니다.
 * 각 명령이 남긴 `undo` 를 그대로 실행하고, 그 되돌리기 자체는 기록에 남기지
 * 않습니다(되돌리기를 또 되돌리는 고리를 만들지 않기 위해).
 */
function applyUndo(session, request, now, operation){
  const log = Array.isArray(session.officialLog) ? session.officialLog : [];
  const lastIndex = log.length - 1;
  const last = log[lastIndex];
  if(!last || !last.undo)return '되돌릴 조작이 없습니다.';
  if(request.expectedLabel !== undefined && text(request.expectedLabel) !== text(last.label)){
    return '그 사이 다른 조작이 있었습니다. 화면을 새로 고친 뒤 다시 봐 주세요.';
  }
  const inverse = {...last.undo, actorPlayerName: text(request.actorPlayerName || '')};
  const reason = runCommand(session, inverse, now, {}, {silent:true});
  if(reason)return `되돌리지 못했습니다: ${reason}`;
  /* `log` 는 되돌리기 실행 중에 push 로 **같은 배열이 늘어났다가** 잘려 나갑니다.
     그래서 옛 참조를 슬라이스하면 아무것도 안 지워집니다(2026-08-14에 잡음).
     지금 배열에서 그 자리만 떼어냅니다. */
  const current = Array.isArray(session.officialLog) ? session.officialLog : [];
  session.officialLog = current.slice(0, lastIndex);
  if(operation)operation.result = {undo:{type:text(last.type), label:text(last.label)}};
  return '';
}

/* 명령 하나를 실행합니다. `silent` 면 기록을 남기지 않습니다(되돌리기 전용). */
function runCommand(session, request, now, operation, options = {}){
  const before = Array.isArray(session.officialLog) ? session.officialLog.length : 0;
  let reason;
  switch(text(request.type)){
    case 'team-official-substitute':
      reason = applySubstitute(session, request, now, operation); break;
    case 'team-official-result':
      reason = applyResult(session, request, now, operation); break;
    case 'team-official-late':
      reason = applyLate(session, request, now); break;
    case 'team-official-void':
      reason = applyVoid(session, request, now, operation); break;
    case 'team-official-rename':
      reason = applyRename(session, request, now, operation); break;
    case 'team-official-court':
      reason = applyCourt(session, request, now, operation); break;
    case 'team-official-finish':
      reason = applyFinish(session, request, now, operation); break;
    case 'team-official-roster':
      reason = applyRoster(session, request, now, operation); break;
    case 'team-official-undo':
      reason = applyUndo(session, request, now, operation); break;
    default:
      reason = '지원하지 않는 팀전 운영 요청입니다.';
  }
  if(!reason && options.silent && Array.isArray(session.officialLog)
     && session.officialLog.length > before){
    session.officialLog = session.officialLog.slice(0, before);
  }
  return reason;
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
  const reason = runCommand(session, request, now, operation);
  if(reason)return {status: 'rejected', reason, session: rawSession, result: null};
  // 대진이 바뀌었으면 지문도 함께 고쳐 둡니다(관리자가 튕기지 않도록).
  if(matchList(session).length)session.bracketKey = bracketKey(session);
  session.updatedAt = now;
  return {status: 'applied', reason: '', session, result: operation.result || null};
}

module.exports = {
  SUPPORTED_TYPES,
  bracketKey,
  isSettled,
  attendanceKey,
  balanceAfter,
  balanceGapAfter,
  applyTeamOfficialRequest,
  suggestSubstitutes,
  teamOf,
  conflictingMatch,
  isOfficial
};
