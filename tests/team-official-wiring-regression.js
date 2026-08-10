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

// 2) 회원 화면 — 서버 함수를 부를 수 있어야 합니다(SDK 가 없으면 조용히 실패).
assert(viewHtml.includes('firebase-functions-compat.js'),
  'view.html 이 functions SDK 를 실어야 임원 요청을 보낼 수 있습니다.');
assert(/httpsCallable\('submitTeamOfficialRequest'\)/.test(liveView),
  '임원 화면이 팀전 callable 을 호출해야 합니다.');

// 3) 진입점 — 「대체 확인」이 눌리는 버튼이어야 합니다(예전에는 안내 문구뿐이었음).
assert(liveView.includes('function _pendingSubstitutions'), '구멍 난 경기를 찾아내야 합니다.');
assert(/onclick="openTeamSubstitutePanel\(\)"/.test(liveView),
  '대체 알림은 눌러서 여는 버튼이어야 합니다 — 문구만 있으면 손을 못 씁니다.');
assert(liveView.includes('function openTeamSubstitutePanel'), '대체 시트가 있어야 합니다.');

// 4) 권한 — 임원만. 일반 회원 화면에는 뜨지 않아야 합니다.
const canSub = liveView.slice(liveView.indexOf('function _canSubstitute'),
  liveView.indexOf('function _teamOfName'));
assert(/isClubOfficial\|\|viewer\.isLeader\|\|viewer\.isSub\|\|viewer\.isTemporaryOperator/.test(canSub),
  '단장·부단장·클럽 임원·운영 도우미만 대체 투입을 볼 수 있어야 합니다.');
assert(/_canSubstitute\(d\)/.test(liveView.slice(liveView.indexOf('function _substituteAlertHtml'))),
  '알림 자체가 권한을 먼저 봐야 합니다.');

// 5) 팀을 넘는 투입은 화면에서도 한 번 더 확인합니다(운영자 확정).
assert(/상대 팀입니다/.test(liveView), '상대 팀 선수를 넣을 때 확인창이 있어야 합니다.');
assert(/allowCrossTeam:crossTeam/.test(liveView), '확인 결과를 서버에 그대로 전해야 합니다.');
assert(/이미 시작한 경기입니다/.test(liveView), '시작한 경기는 한 번 더 확인해야 합니다.');

// 6) 지문 — 그 사이 대진이 바뀌었으면 서버가 되돌릴 수 있어야 합니다.
assert(/expectedT1:\[\.\.\.\(match\.t1\|\|\[\]\)\]/.test(liveView),
  '요청에 현재 구성(지문)을 실어 보내야 합니다.');

// 7) AI 보조 — 후보 정렬 기준이 서버 엔진과 같아야 합니다.
const cands = liveView.slice(liveView.indexOf('function _substituteCandidates'),
  liveView.indexOf('async function submitTeamSubstitute'));
assert(/Number\(a\.crossTeam\)-Number\(b\.crossTeam\)\|\|a\.levelGap-b\.levelGap/.test(cands),
  '후보는 같은 팀 → 급수 근접 순이어야 합니다(서버 엔진과 같은 기준).');
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
assert(officialButtonClasses.length >= 2, '임원 진입 버튼이 둘 이상 있어야 합니다(대체·정정).');
officialButtonClasses.forEach(cls => {
  cls.split(/\s+/).filter(Boolean).forEach(token => {
    assert(!dimTokens.has(token),
      `임원 버튼의 클래스 "${token}" 가 전역 !important 유틸리티와 겹칩니다 — 글씨가 회색으로 먹힙니다.`);
  });
});
assert(liveCss.includes('.team-official-overview-conflict.act{'),
  '대체 투입 버튼 스타일은 겹치지 않는 이름(.act)으로 있어야 합니다.');

console.log('team official wiring regression ok — 서버 callable · 화면 진입점 · 권한 · 지문 · AI 후보 · 승패 정정 · 버튼 대비');
