'use strict';
/**
 * 팀전 임원 운영 — 서버·화면 배선 (운영자 2026-08-13 "임원 운영을 중심으로
 * 서버 동기화", "민턴라이브와 동일한 방식").
 *
 * 엔진 규칙은 team-official-substitute-regression 이 지킵니다. 여기서는
 * **연결이 끊기지 않았는지**를 고정합니다 — 배선이 빠지면 화면에서 눌러도
 * 아무 일도 일어나지 않습니다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8');
const liveView = fs.readFileSync(path.join(root, 'js', 'live-view.js'), 'utf8');
const viewHtml = fs.readFileSync(path.join(root, 'view.html'), 'utf8');

// 1) 서버 — 팀전 전용 callable 이 엔진을 쓰고, 같은 요청을 두 번 적용하지 않아야 합니다.
assert(index.includes("require('./team-official-engine')"), '서버가 팀전 엔진을 불러와야 합니다.');
assert(index.includes('exports.submitTeamOfficialRequest'), '팀전 임원 요청 callable 이 있어야 합니다.');
assert(/live\/\$\{liveId\}/.test(index), '팀전은 live/<liveId> 노드를 직접 다뤄야 합니다(민턴LIVE 와 경로가 다름).');
assert(/const prior = current\.officialOps && current\.officialOps\[operationId\]/.test(index),
  '같은 요청을 두 번 눌러도 한 번만 적용해야 합니다(중복 탭·재시도 대비).');
assert(index.includes('officialOps'), '처리 결과를 기록해 재시도에 답할 수 있어야 합니다.');

// 1-1) 팀전 트랜잭션도 **민턴LIVE 와 같은 헬퍼**를 써야 합니다 (실기기 2026-08-14).
//      RTDB 는 로컬 캐시가 비면 콜백을 `null` 로 먼저 부르는데, 거기서 중단하면
//      서버 값으로 다시 부르지 않습니다. 멀쩡한 팀전이 매번 "종료되었거나 없는
//      팀전입니다"로 거절됐습니다 — 직접 트랜잭션을 걸면 재발합니다.
const teamCallables = ['exports.claimTeamOfficialInvite', 'exports.submitTeamOfficialRequest'];
teamCallables.forEach(name => {
  const start = index.indexOf(name);
  assert(start >= 0, `${name} 이 있어야 합니다.`);
  const body = index.slice(start, index.indexOf('exports.', start + name.length));
  assert(/runExistingSessionTransaction\(ref/.test(body),
    `${name} 은 빈 캐시에서 재시도하는 헬퍼를 써야 합니다.`);
  assert(/\{exists: teamSessionExists\}/.test(body),
    `${name} 은 팀전 모양(session 하위가 아님)으로 존재 확인을 해야 합니다.`);
  assert(!/ref\.transaction\(/.test(body),
    `${name} 이 직접 트랜잭션을 걸면 안 됩니다 — 빈 캐시 첫 호출에서 중단됩니다.`);
  assert(/transaction\.missing\)throw new HttpsError\('not-found'/.test(body),
    `${name} 은 헬퍼가 알려 준 부재만 not-found 로 답해야 합니다.`);
});
assert(/const teamSessionExists = snapshot => snapshot\.exists\(\) && snapshot\.child\('matches'\)\.exists\(\)/.test(index),
  '팀전 존재 확인은 노드 바로 아래 `matches` 를 봐야 합니다.');

// 2) 회원 화면 — 서버 함수를 부를 수 있어야 합니다(SDK 가 없으면 조용히 실패).
assert(viewHtml.includes('firebase-functions-compat.js'),
  'view.html 이 functions SDK 를 실어야 임원 요청을 보낼 수 있습니다.');
assert(/httpsCallable\('submitTeamOfficialRequest'\)/.test(liveView),
  '임원 화면이 팀전 callable 을 호출해야 합니다.');

// 3) 진입점 — **대진표의 이름 자체**가 교체 버튼입니다(운영자 2026-08-14
//    "대진표의 지각자를 눌러서 선수교체하는 방식으로 처리해"). 진입점은 한 곳입니다.
assert(liveView.includes('function _pendingSubstitutions'), '메워야 할 자리를 셀 수 있어야 합니다.');
assert(liveView.includes('function openTeamSubstitutePanel'), '대체 시트가 있어야 합니다.');
const playerLine = liveView.slice(liveView.indexOf('function _playerLine'),
  liveView.indexOf('function buildLiveMatchCard'));
assert(/onclick="openTeamSubstitutePanel\('\+Number\(m\.num\|\|0\)\+','\+arg\+'\)"/.test(playerLine)
  || /openTeamSubstitutePanel\('\+Number\(m\.num/.test(playerLine),
  '대진표의 이름을 누르면 그 경기·그 선수로 시트가 열려야 합니다.');
assert(/class="'\+cls\+' swap" role="button" tabindex="0"/.test(playerLine),
  '지각자 이름은 눌리는 버튼 역할이어야 합니다.');
// 태그를 <button> 으로 바꾸면 이름에 걸린 !important 규칙과 버튼 기본 글꼴이 싸워
// 코트 이름 크기·굵기가 흐트러집니다(이 화면에서 가장 중요한 정보입니다).
assert(!/<button[^>]*class="'\+cls/.test(playerLine),
  '이름은 <div> 로 남아야 합니다 — <button> 은 글꼴 규칙과 충돌합니다.');
assert(/onkeydown=/.test(playerLine), '키보드로도 열 수 있어야 합니다.');
assert(/const cls='live-player'\+\(flag\?' not-ready':''\);/.test(playerLine),
  '눌리는 이름과 안 눌리는 이름은 같은 클래스를 써야 모양이 갈라지지 않습니다.');
// 배너 버튼을 되살리면 진입점이 둘이 됩니다 — 운영자가 싫어하는 형태입니다.
assert(!/onclick="openTeamSubstitutePanel\(\)"/.test(liveView),
  '인자 없는 대체 배너 버튼이 남아 있으면 안 됩니다(진입점 1곳).');
assert(liveView.includes('function _substituteHintHtml'), '운영 현황에는 안내 한 줄만 둡니다.');

// 3-1) 메우는 범위 — 지금 라운드 + 다음 라운드(미리 처리).
const scope = liveView.slice(liveView.indexOf('function _swappableRounds'),
  liveView.indexOf('function _playerLine'));
assert(/_swappableRounds\(d\)\.includes\(Number\(m\.round\)\)/.test(scope),
  '교체 범위는 지금·다음 라운드여야 합니다.');
assert(/const next=open\.find\(r=>r>cur\)/.test(liveView),
  '다음 대진도 미리 처리할 수 있어야 합니다(운영자 2026-08-14).');
assert(!/absent/.test(scope), '불참을 따로 두지 않습니다.');
assert(/if\(!m\|\|m\.win\)return false;/.test(scope), '끝난 경기는 교체 대상이 아닙니다.');

// 3-2) 출결은 지각 하나입니다(운영자 2026-08-14 "불참도 지각자와 다를 바 없다").
const cycle = liveView.slice(liveView.indexOf('async function toggleMemberLate'),
  liveView.indexOf('async function toggleMemberParty'));
assert(!/absent/.test(cycle), '불참 상태를 다시 만들면 안 됩니다.');
assert(/ref\.remove\(\)/.test(cycle), '도착 확인으로 되돌릴 수 있어야 합니다.');
assert(/_canOperateAttendance/.test(cycle),
  '지각 표시는 임원·단장만 — 참가자는 대진표를 보는 정도입니다.');

// 4) 권한 — 임원만. 일반 회원 화면에는 뜨지 않아야 합니다.
const canSub = liveView.slice(liveView.indexOf('function _canSubstitute'),
  liveView.indexOf('function _teamOfName'));
assert(/isClubOfficial\|\|viewer\.isLeader\|\|viewer\.isSub\|\|viewer\.isTemporaryOperator/.test(canSub),
  '단장·부단장·클럽 임원·운영 도우미만 대체 투입을 볼 수 있어야 합니다.');
assert(/_canSubstitute\(d\)/.test(scope),
  '교체 가능 판정이 권한을 먼저 봐야 합니다 — 일반 회원에게 버튼이 뜨면 안 됩니다.');
assert(/_canSubstitute\(d\)/.test(liveView.slice(liveView.indexOf('function _substituteHintHtml'),
  liveView.indexOf('function _pendingSubstitutions'))),
  '안내 한 줄도 권한을 먼저 봐야 합니다.');

// 5) 팀을 넘는 투입은 화면에서도 한 번 더 확인합니다(운영자 확정).
assert(/상대 팀입니다/.test(liveView), '상대 팀 선수를 넣을 때 확인창이 있어야 합니다.');
assert(/allowCrossTeam:crossTeam/.test(liveView), '확인 결과를 서버에 그대로 전해야 합니다.');
assert(/이미 시작한 경기입니다/.test(liveView), '시작한 경기는 한 번 더 확인해야 합니다.');

// 6) 지문 — 그 사이 대진이 바뀌었으면 서버가 되돌릴 수 있어야 합니다.
assert(/expectedT1:\[\.\.\.\(match\.t1\|\|\[\]\)\]/.test(liveView),
  '요청에 현재 구성(지문)을 실어 보내야 합니다.');

// 7) AI 보조 — 후보 정렬 기준이 서버 엔진과 같아야 합니다.
const liveCssForBalance = fs.readFileSync(path.join(root, 'css', 'live.css'), 'utf8');
const cands = liveView.slice(liveView.indexOf('function _substituteCandidates'),
  liveView.indexOf('async function submitTeamSubstitute'));
// 2026-08-14 계약 갱신: 빠지는 사람과 급수가 가까운 순이 아니라, **넣은 뒤 경기가
// 가장 안 기우는 순**입니다("아무나 투입하면 상대에겐 불공정한 게임이 되잖아").
// 교체는 팀 패널티다 — 사람이 빠진 팀이 교체로 **더 세지면** 상대가 불합리하다
// (운영자 2026-08-14). 그래서 강해지는 후보는 균형이 좋아도 뒤로 민다.
assert(/Math\.abs\(a\.balance\)-Math\.abs\(b\.balance\)/.test(cands),
  '후보는 기울기가 0 에 가까운 순이어야 합니다.');
assert(/Number\(a\.balance>0\)-Number\(b\.balance>0\)/.test(cands),
  '같은 크기면 교체로 강해지는 쪽이 뒤여야 합니다.');
const engineSrc = fs.readFileSync(path.join(root, 'functions', 'team-official-engine.js'), 'utf8');
assert(/Math\.abs\(a\.balance\) - Math\.abs\(b\.balance\)/.test(engineSrc)
  && /Number\(a\.balance > 0\) - Number\(b\.balance > 0\)/.test(engineSrc),
  '서버 엔진도 같은 기준으로 정렬해야 합니다.');
assert(/function balanceAfter/.test(engineSrc) && /function _balanceAfter/.test(liveView),
  '부호 있는 기울기 계산이 서버·화면 양쪽에 있어야 합니다.');
// 색은 부호를 따릅니다 — + 빨강 / − 파랑(운영자 2026-08-14).
assert(/\.team-sub-cand\.over small\{color:#c0392b/.test(liveCssForBalance)
  && /\.team-sub-cand\.under small\{color:#1d4ed8/.test(liveCssForBalance),
  '+ 는 빨강, − 는 파랑이어야 합니다.');
assert(/a\.games-b\.games/.test(cands), '그 다음은 덜 뛴 순이어야 합니다.');
assert(/_bookedInRound\(d,p\.name,match\.round,match\.num\)/.test(cands),
  '같은 라운드에 이미 잡힌 사람은 후보에서 빼야 합니다.');
assert(/filter\(c=>!c\.late\)/.test(cands), '늦은 사람을 대체 후보로 올리면 안 됩니다.');

// 8) 승패 정정 — 한 번 들어간 승패를 임원이 고칠 수 있어야 합니다(2026-08-13).
//    관리자가 손을 뗀 뒤에는 이 길이 없으면 잘못된 승패가 영원히 굳습니다.
assert(liveView.includes('function openTeamResultPanel'), '승패 정정 시트가 있어야 합니다.');
assert(/onclick="openTeamResultPanel\(\)"/.test(liveView),
  '승패 확인 알림은 눌러서 여는 버튼이어야 합니다 — 문구만 있으면 손을 못 씁니다.');
const fixResult = liveView.slice(liveView.indexOf('async function submitTeamResult'),
  liveView.indexOf('function _viewerNextHtml'));
assert(/type:'team-official-result'/.test(fixResult), '정정도 서버 명령으로 보내야 합니다.');
assert(/grantToken/.test(fixResult), '정정에도 서명된 권한을 실어야 합니다.');
assert(/expectedWin:String\(expectedWin\|\|''\)/.test(fixResult),
  '내가 본 결과를 지문으로 보내야 그 사이 바뀐 값을 덮어쓰지 않습니다.');
assert(/confirm\(/.test(fixResult), '한 번의 오클릭으로 승패가 바뀌면 안 됩니다.');
const alertHtml = liveView.slice(liveView.indexOf('function _resultAlertHtml'),
  liveView.indexOf('function openTeamResultPanel'));
assert(/_canFixResult\(d\)/.test(alertHtml), '알림 자체가 권한을 먼저 봐야 합니다.');

// 9) 서버 — 정정이 팀 점수·현재 라운드를 회원 화면과 **같은 규칙**으로 다시 세야 합니다.
const engine = fs.readFileSync(path.join(root, 'functions', 'team-official-engine.js'), 'utf8');
assert(engine.includes("'team-official-result'"), '엔진이 정정 명령을 알아야 합니다.');
assert(/function recountSession/.test(engine), '정정 뒤 점수를 다시 세야 합니다.');
assert(/text\(m\?\.win\) === 't1'\)blueWins/.test(engine),
  't1 은 청팀 — 회원 화면 집계와 같은 규칙이어야 합니다.');
assert(/delete session\.resultConflicts\[key\]/.test(engine),
  '임원이 결론을 냈으면 그 경기의 승패 확인 대기도 함께 정리해야 합니다.');

// 10) 임원 버튼이 전역 `!important` 유틸리티에 먹히면 안 됩니다.
//     v566 의 「대체 필요」 버튼은 클래스 이름을 `sub` 로 두는 바람에
//     `.sub{color:var(--dim)!important}` 가 **!important 로 이겨서** 파란 버튼에
//     회색 글씨로 나갔습니다(폰 리그 실측으로 발견). 이름이 겹치는지 자동으로 봅니다.
const liveCss = fs.readFileSync(path.join(root, 'css', 'live.css'), 'utf8');
const dimTokens = new Set();
liveCss.replace(/([^{}]+)\{[^{}]*color\s*:\s*[^;{}]*!important[^{}]*\}/g, (_, sel) => {
  sel.split(',').forEach(one => {
    const t = one.trim();
    if(/^\.[A-Za-z0-9_-]+$/.test(t))dimTokens.add(t.slice(1));
  });
  return '';
});
assert(dimTokens.has('sub'), '전제 확인: `.sub` 는 실제로 !important 유틸리티입니다.');
const officialButtonClasses = [...liveView.matchAll(/class="(team-official-overview-conflict[^"]*)"/g)]
  .map(m => m[1]);
assert(officialButtonClasses.length >= 1, '임원 진입 버튼(승패 정정)이 있어야 합니다.');
officialButtonClasses.forEach(cls => {
  cls.split(/\s+/).filter(Boolean).forEach(token => {
    assert(!dimTokens.has(token),
      `임원 버튼의 클래스 "${token}" 가 전역 !important 유틸리티와 겹칩니다 — 글씨가 회색으로 먹힙니다.`);
  });
});
assert(liveCss.includes('.team-official-overview-conflict.act{'),
  '대체 투입 버튼 스타일은 겹치지 않는 이름(.act)으로 있어야 합니다.');

console.log('team official wiring regression ok — 서버 callable · 화면 진입점 · 권한 · 지문 · AI 후보 · 승패 정정 · 버튼 대비');
