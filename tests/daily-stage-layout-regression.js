'use strict';
/**
 * 2026-09-02 운영자: "민턴LIVE ux… 여전히 한눈에 들어오지 않고 복잡. 세팅 시 필요없는
 * 메뉴는 보이지 않도록, 필요한 메뉴는 사용이 쉽도록."
 *
 * 화면 단계(empty/roster/live)에 따라 운영용 카드·숫자·버튼을 감추고, 세팅 폴드는
 * 게시 전엔 상황판 바로 아래 펼쳐진 채, 게시 뒤엔 맨 아래로 접힌다.
 * 선수 등록 입구는 「오늘 참가자 등록」 모달 하나 — 직접 입력 폼 사본은 뺐다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const src = fs.readFileSync(path.join(root, 'js', 'daily.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'app.css'), 'utf8');

// ── 마크업: 세팅 폴드는 .daily-main 안, 상황판 다음·진행 중 카드 앞 ──
const dash = html.indexOf('daily-dashboard-card');
const setup = html.indexOf('id="dailySetupDetails"');
const active = html.indexOf('daily-active-card');
assert(dash > 0 && setup > dash && active > setup, '세팅 폴드는 상황판 다음, 진행 중 카드 앞에 있어야 합니다.');
assert(!html.includes('class="daily-side"'), '세팅 폴드를 담던 옆 칸(.daily-side)은 없어야 합니다 — 맨 아래 닫힌 채 묻혀 있던 자리입니다.');
assert(!html.includes('id="dailyName"') && !html.includes('onclick="dailyAddPlayer()"'),
  '세팅 폴드의 직접 입력 폼은 모달 게스트 폼과 같은 일이라 없어야 합니다 — 등록 입구는 하나.');
assert(html.includes('onclick="dailyImportRoster()"'), '세팅 폴드에서 「오늘 참가자 등록」 모달을 열 수 있어야 합니다.');
assert(html.includes('id="dailyImportTeamRosterBtn"') && /class="roster-transfer-btn hidden" id="dailyImportTeamRosterBtn"/.test(html),
  '팀전 선수 가져오기 버튼은 기본 숨김이어야 합니다(없을 때 비활성 버튼은 소음).');
assert(html.split('id="dailyCourts"').length === 2, '코트 수 입력은 한 개만 있어야 합니다.');
for (const id of ['dailyQuickShareBtn', 'dailyQuickStopBtn', 'dailyQuickResetBtn'])
  assert(html.includes(`id="${id}"`), `${id} 가 있어야 단계별로 감출 수 있습니다.`);
assert(!html.includes('class="nav-sync-btn"') && !html.includes('class="hbs"'),
  '팀전 대진표 저장·내보내기 버튼과 생성 옵션 칩은 민턴LIVE 화면에 없어야 합니다.');

// ── daily.js: 게시 버튼 가드, 폴드 토글, 단계 함수 호출 ──
assert(src.includes("const showTransition=_dailyUiStage()!=='live'&&_dailyStartedPoolCount()>0;"),
  '「대진 게시」는 현장 참가자가 있을 때만 보여야 합니다 — 0명이면 눌러도 안내창뿐입니다.');
assert(/btn\.textContent=count\?`팀전 선수 \$\{count\}명 가져오기`:'팀전 선수 없음';\n\s*btn\.classList\.toggle\('hidden',!count\)/.test(src),
  '팀전 선수가 없으면 가져오기 버튼을 감춰야 합니다.');
const ops = src.slice(src.indexOf('function dailyRenderOpsStats('), src.indexOf('function _dailyTemporaryOfficialEligible('));
assert(ops.includes('dailyApplyStageLayout();'), '상황판을 그릴 때마다 단계 배치를 적용해야 합니다.');

// ── CSS: 폴드 순서 ──
assert(css.includes('#dailySetupDetails{order:1;}') && css.includes('.daily-layout.stage-live #dailySetupDetails{order:9;}'),
  '세팅 폴드는 게시 전 상황판 바로 아래, 게시 뒤 맨 아래여야 합니다.');

// ── 기능: 단계 판정과 노출을 가짜 DOM으로 실행 ──
const cut = (begin, end) => {
  const a = src.indexOf(begin); const b = src.indexOf(end, a);
  assert(a >= 0 && b > a, `${begin.slice(0, 30)} 범위를 찾지 못했습니다.`);
  return src.slice(a, b);
};
const code = cut('function _dailyUiStage(', 'function dailyRenderOpsStats(');
function fakeDom(){
  const els = {};
  const mk = key => els[key] = els[key] || {
    classes: new Set(), open: null,
    classList: { toggle(c, on){ if(on) this._s.add(c); else this._s.delete(c); }, _s: null }
  };
  const get = key => { const e = mk(key); e.classList._s = e.classes; return e; };
  const layout = get('.daily-layout');
  const doc = {
    querySelector: sel => sel === '.daily-layout' ? layout : null,
    querySelectorAll: sel => [get(sel)],
    getElementById: id => get('#' + id)
  };
  return { doc, els, hidden: key => els[key]?.classes.has('hidden') };
}
function run(state){
  const dom = fakeDom();
  const ctx = {
    document: dom.doc,
    _dailyOperationStarted: !!state.started,
    _dailyActiveMatches: () => state.active || [],
    _dailyQueue: state.queue || [],
    _dailyPlayers: state.players || [],
    _dailyMatches: state.matches || [],
    _dailyCheckinId: state.checkinId || null
  };
  vm.createContext(ctx);
  vm.runInContext(code + '\nthis.stage=_dailyUiStage();dailyApplyStageLayout();this.setupOpen=document.getElementById("dailySetupDetails").open;', ctx);
  return { stage: ctx.stage, setupOpen: ctx.setupOpen, hidden: dom.hidden, layout: dom.els['.daily-layout'].classes };
}

// empty: 선수 0명 — 등록 입구와 코트만. 운영 카드·0 숫자·링크 종료·초기화 전부 숨김, 폴드 열림
let r = run({});
assert.strictEqual(r.stage, 'empty');
assert(r.layout.has('stage-empty'));
for (const sel of ['.daily-active-card', '.daily-urgent-card', '#dailyResultDetails', '#dailyOpsStats', '#dailyHeadcount', '#dailyPlayersManage',
  '#dailyQuickShareBtn', '#dailyQuickStopBtn', '#dailyQuickResetBtn'])
  assert(r.hidden(sel), `빈 세팅 화면에서 ${sel} 은 감춰져야 합니다.`);
assert.strictEqual(r.setupOpen, true, '빈 세팅 화면에서는 참가자 등록 폴드가 펼쳐져 있어야 합니다.');

// roster: 명단 있음·게시 전 — 인원 수·명단·초기화·링크 공유는 보이고, 운영 카드는 숨김
r = run({ players: [{}, {}, {}, {}] });
assert.strictEqual(r.stage, 'roster');
assert(!r.hidden('#dailyHeadcount') && !r.hidden('#dailyPlayersManage') && !r.hidden('#dailyQuickResetBtn') && !r.hidden('#dailyQuickShareBtn'),
  '명단이 있으면 인원 수·전체 선수 상태·초기화·링크 공유가 보여야 합니다.');
assert(r.hidden('.daily-active-card') && r.hidden('.daily-urgent-card') && r.hidden('#dailyOpsStats') && r.hidden('#dailyQuickStopBtn'),
  '게시 전에는 진행·다음 대진·운영 지표·링크 종료가 감춰져야 합니다.');
assert.strictEqual(r.setupOpen, true);

// live: 게시 뒤 — 운영 카드 전부 보이고, 폴드는 접힘. 링크가 있으면 종료 버튼도 보임
r = run({ started: true, players: [{}], matches: [{}], checkinId: 'DX' });
assert.strictEqual(r.stage, 'live');
assert(r.layout.has('stage-live'));
for (const sel of ['.daily-active-card', '.daily-urgent-card', '#dailyResultDetails', '#dailyOpsStats', '#dailyHeadcount', '#dailyPlayersManage',
  '#dailyQuickShareBtn', '#dailyQuickStopBtn', '#dailyQuickResetBtn'])
  assert(!r.hidden(sel), `운영 중에는 ${sel} 이 보여야 합니다.`);
assert.strictEqual(r.setupOpen, false, '게시 뒤에는 세팅 폴드가 접혀야 합니다.');

// 큐만 있어도(게시 직후 대기표) live 로 본다
r = run({ players: [{}], queue: [{}] });
assert.strictEqual(r.stage, 'live');

// 게시 전 상태 알약은 「운영 준비」 — 「조치 1건」 노란 경고가 아니다
assert(src.includes("preparing?'운영 준비':todo?(entryReady?'입장 준비'"), '게시 전 상태 알약은 운영 준비여야 합니다.');
assert(src.includes("const preparing=_dailyUiStage()!=='live'&&!_dailyPaused;"), '상태 알약도 같은 단계 판정을 써야 합니다.');
assert(src.includes("flow.classList.toggle('need',!preparing&&!_dailyPaused&&!!todo);"), '게시 전에는 노란 경고 알약이 켜지면 안 됩니다.');
// 빈 화면에서는 도구 줄(선수 추가·코트·도우미…)도 접는다 — 등록 입구 사본만 늘린다
r = run({});
assert(r.hidden('#dailyDashboardTools'), '빈 세팅 화면에서는 운영 도구 줄이 감춰져야 합니다.');
r = run({ players: [{}] });
assert(!r.hidden('#dailyDashboardTools'), '명단이 있으면 이름 변경·삭제 도구가 보여야 합니다.');
// 게시 전 인원 수는 등록·현장·도착 전 3칸만
assert(src.includes("const shown=_dailyUiStage()==='live'?cards:cards.filter(card=>['all','current','planned'].includes(card.filter));"),
  '게시 전 인원 수는 등록·현장·도착 전만 보여야 합니다.');
assert(css.includes('.daily-headcount.compact{grid-template-columns:repeat(3,minmax(0,1fr))!important;}'), '3칸 인원 수는 3열이어야 합니다.');

// 게시 전 「현장 참가 등록」 중요 알림은 운영 준비 안내와 중복 — 없어야 한다
const alertsFn = src.slice(src.indexOf('function dailyRenderAdminAlerts('), src.indexOf('function dailyCurrentStage('));
assert(!alertsFn.includes("title:'현장 참가 등록'"), '게시 전 참가 등록 알림 카드는 운영 준비 안내와 중복이라 없어야 합니다.');

// ── 2차 감사(적대 검증 29건 확정) 반영분 ──
// 링크 생성·만료·분리 경로도 단계 배치를 다시 적용 — 「링크 종료」가 링크 유무를 따라간다
const checkinReq = src.slice(src.indexOf('function dailyRenderCheckinRequests('), src.indexOf('function dailyRender('));
assert(checkinReq.includes('dailyApplyStageLayout()'), '링크 생성 직후에도 「링크 종료」가 나타나야 합니다.');
// 모바일 하단 탭 — 감춘 카드는 스크롤 대상·활성 판정에서 건너뛴다
const mobileTab = src.slice(src.indexOf('function switchMobileTab('), src.indexOf('function syncBottomNav('));
assert(mobileTab.includes('el.offsetParent===null'), '숨긴 카드를 가리키는 하단 탭은 상황판으로 보내야 합니다.');
const bnavScroll = src.slice(src.indexOf('function updateActiveBnavByScroll('), src.indexOf('let _scrollTimer'));
assert(bnavScroll.includes('el.offsetParent===null) continue'), '숨긴 카드(top 0)가 활성 탭을 정하면 안 됩니다.');
r = run({});
assert(r.hidden('#bnav-queue') && r.hidden('#bnav-players'), '빈 화면에서는 대진·선수 탭이 감춰져야 합니다.');
r = run({ players: [{}] });
assert(r.hidden('#bnav-queue') && !r.hidden('#bnav-players'), '명단 단계에서는 대진 탭만 감춰져야 합니다.');
r = run({ started: true, players: [{}], matches: [{}] });
assert(!r.hidden('#bnav-queue') && !r.hidden('#bnav-players'), '게시 뒤에는 하단 탭이 모두 보여야 합니다.');
// 명부가 비어도 참가자 등록 모달은 열린다 — 게스트 폼이 유일한 등록 입구
const importRoster = src.slice(src.indexOf('function dailyImportRoster('), src.indexOf('function _dailyApplyPlayerStatus('));
assert(!importRoster.includes('명부에 등록된 회원이 없습니다'), '명부가 비어도 등록 모달이 열려야 합니다(게스트 등록 길).');
assert(importRoster.includes('_dailySessionClubName'), '모달 기본 클럽은 오늘 세션 클럽이어야 합니다.');
const importMembers = src.slice(src.indexOf('function renderDailyImportMembers('), src.indexOf('function toggleDailySelectAll('));
assert(importMembers.includes('명부 만들기') && importMembers.includes("switchNav('roster')"), '명부가 비면 모달 안에서 명부 만들기로 갈 수 있어야 합니다.');
// 전원 도착 전 명단은 '등록'이 아니라 '도착 확인'을 안내한다
const guide = src.slice(src.indexOf('function dailyRenderStartGuide('), src.indexOf('function _dailyHeadcountInfo('));
assert(guide.includes("awaitingArrival?'도착 확인':'현장 참가'") && guide.includes("dailyOpenPlayerStatus('planned')"),
  '전원 도착 전이면 2단계가 도착 확인으로 바뀌어야 합니다.');
assert(guide.includes('명부가 비어 있습니다'), '명부가 비면 안내가 명부로 가는 길을 말해야 합니다.');
// 도우미 지정은 링크·게시가 있을 때만
assert(src.includes("(_dailyOperationStarted||_dailyCheckinId)?mode('helper'"), '게시 전 도우미 버튼은 링크 강제 생성 부작용만 있어 감춰야 합니다.');
// 게시 전 링크 공유는 준비 명단 승계가 끊김을 한 번 묻는다
assert(src.includes('지금 링크를 만들면 오늘 운동으로 시작되어'), '게시 전 링크 공유는 확인을 거쳐야 합니다.');
// 내비: 상황판 탭이 있고 옛 대진표 복구 버튼은 없다
assert(html.includes('data-nav="daily" onclick="switchNav(\'daily\')">📡 상황판</button>'), '데스크톱 내비에 상황판 탭이 있어야 명부에서 돌아올 수 있습니다.');
assert(!html.includes('id="restoreBtn"'), '보이지 않는 옛 대진표 페이지로 복원하는 버튼은 없어야 합니다.');
// 빠른 동작 줄은 보이는 버튼 수만큼 — 3열 고정 grid 는 빈 칸을 남긴다
assert(css.includes('.daily-dashboard-quick-actions{display:flex;flex-wrap:wrap;gap:6px;width:100%;}'), '빠른 동작 줄은 flex 여야 빈 칸이 남지 않습니다.');

// 참가자 등록 모달의 게스트 폼은 접이식 — 게스트 없는 날이 많고, 늘 펼치면 등록 버튼이 스크롤 아래로 밀린다
assert(html.includes('<details class="daily-import-guest" id="dailyImportGuestBox">') && !html.includes('id="dailyImportGuestBox" open'),
  '게스트 폼은 기본 접힘이어야 합니다.');
assert(/<summary>＋ 게스트 추가/.test(html), '게스트 폼을 여는 요약 줄이 있어야 합니다.');
assert(src.includes('guestBox.open=_dailyImportClubIdx<0;'), '명부가 비어 게스트가 유일한 길일 때만 자동으로 펼쳐야 합니다.');
assert(css.includes('.daily-import-guest summary{') && css.includes('min-height:44px'), '게스트 요약 줄은 터치 높이를 확보해야 합니다.');

// 「대진 게시」 모달 중복 제거 — 가짜 버튼·등록 목록 사본 없음, 빈 코트 없으면 선수 선택 접힘
const manual = src.slice(src.indexOf('function dailyRenderManualActiveModal('), src.indexOf('async function dailyConfirmManualActiveMatch('));
assert(!manual.includes('daily-manual-registered') && !manual.includes("'대진 게시 가능'"),
  '요약 줄에 코트 카드와 겹치는 등록 목록이나 「대진 게시」 가짜 버튼이 있으면 안 됩니다.');
assert(manual.includes("pickTitle.classList.toggle('hidden',pickHidden)") && manual.includes('const pickHidden=transition&&!freeCourt&&!selectedIds.length;'),
  '빈 코트가 없으면 선수 선택 구역을 접어야 합니다.');
assert(manual.includes('`등록 ${registeredCount}/${max}`'), '코트 힌트는 등록 N/전체 코트 수여야 합니다.');
assert(manual.includes("const status='';"), '게시 전환 후보는 전부 참가라 상태 접두를 붙이지 않습니다.');
assert(manual.includes('명은 게시 후 자동 대진'), '등록 뒤 남은 인원이 자동 대진으로 간다는 한 줄 상태가 있어야 합니다.');
assert(html.includes('id="dailyManualPickTitle"'), '선수 선택 제목에 id 가 있어야 접을 수 있습니다.');

console.log('daily stage layout regression ok');
