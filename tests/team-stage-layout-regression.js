'use strict';
/**
 * 2026-09-03 운영자: "민턴라이브처럼 팀전라이브도 동일하게 개선해줘. 꼼꼼하게 살펴서."
 *
 * 민턴LIVE 의 단계별 노출(_dailyUiStage/dailyApplyStageLayout)과 채널별 공유를 팀전에 이식.
 * 팀전은 접힘/펼침(_autoFlowSetSection)은 이미 있었고, '눌러도 안내창만 뜨는 카드·버튼 감추기'가 없었다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const src = read('js/team.js');
const html = read('team.html');
const css = read('css/team.css');

// ── 단계 판정과 적용이 있고, 매 렌더마다 돈다 ──
assert(src.includes('function _teamUiStage()') && src.includes('function teamApplyStageLayout()'),
  '팀전에도 단계 판정과 단계 배치 함수가 있어야 합니다.');
const board = src.slice(src.indexOf('function renderAutoFlowDashboard('), src.indexOf('function rsvpRender('));
assert(board.includes('teamApplyStageLayout();'), '운영 보드를 그릴 때마다 단계 배치를 적용해야 합니다.');

// ── 기능: 가짜 DOM 으로 세 단계를 실제 실행 ──
const cut = (begin, end) => {
  const a = src.indexOf(begin), b = src.indexOf(end, a);
  assert(a >= 0 && b > a, `${begin.slice(0, 32)} 범위를 찾지 못했습니다.`);
  return src.slice(a, b);
};
const code = cut('function _teamUiStage()', 'function _autoFlowSetResultSections(');

function run(state){
  const els = {};
  const get = key => {
    if (!els[key]) {
      const e = { classes: new Set(), open: null, parentElement: null, textContent: '', tagName: key.startsWith('#sec-') ? 'DETAILS' : 'DIV' };
      e.classList = { toggle: (c, on) => { if (on) e.classes.add(c); else e.classes.delete(c); }, contains: c => e.classes.has(c) };
      els[key] = e;
    }
    return els[key];
  };
  const genBtn = get('#sec-settings .btn-gen');
  genBtn.parentElement = get('gen-row');
  const ctx = {
    currentMatches: state.matches || [],
    _liveOn: !!state.live,
    _directPlayers: state.players || [],
    _rsvpId: state.rsvpId || null,
    _teamForceOpenSection: id => { get('#' + id).open = true; },
    document: {
      getElementById: id => get('#' + id),
      querySelector: sel => (sel === '#sec-settings .btn-gen' ? genBtn : get(sel)),
      querySelectorAll: sel => sel.split(',').map(s => get(s.trim())),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(code + '\nthis.stage=_teamUiStage();teamApplyStageLayout();', ctx);
  return {
    stage: ctx.stage,
    hidden: key => els[key]?.classes.has('hidden') === true,
    open: key => els['#' + key]?.open,
    page: els['#pageMain'].classes,
  };
}

// empty: 참가자 0명 — 링크·팀 배정·빈 청홍 상자·대진 생성·저장 버튼 전부 감춤, 참가자 카드 펼침
let r = run({});
assert.strictEqual(r.stage, 'empty');
assert(r.page.has('team-stage-empty'), '단계 표시 클래스가 붙어야 합니다.');
for (const sel of ['#sec-rsvp', '#teamAssignBtn', '#teamReassignBtn', '#teamListWrap', '.bracket-save-primary'])
  assert(r.hidden(sel), `빈 세팅 화면에서 ${sel} 은 감춰져야 합니다.`);
assert(r.hidden('gen-row'), '참가자가 없으면 대진 생성 줄이 감춰져야 합니다.');
assert.strictEqual(r.open('sec-players'), true, '빈 화면에서는 참가자 확인 카드가 펼쳐져야 합니다.');
assert.strictEqual(r.open('sec-settings'), false, '빈 화면에서는 진행 설정이 접혀야 합니다.');

// 이미 링크를 만든 뒤라면 참가자가 비어도 링크 카드는 남긴다(운영 중 명단을 비우는 경우)
r = run({ rsvpId: 'ABCDEFGH' });
assert(!r.hidden('#sec-rsvp'), '링크가 이미 있으면 링크 카드를 감추면 안 됩니다.');

// roster: 참가자 있음 — 세팅이 모두 열린다
r = run({ players: [{}, {}, {}, {}] });
assert.strictEqual(r.stage, 'roster');
for (const sel of ['#sec-rsvp', '#teamAssignBtn', '#teamListWrap', '.bracket-save-primary'])
  assert(!r.hidden(sel), `명단이 있으면 ${sel} 이 보여야 합니다.`);
assert(!r.hidden('gen-row'), '명단이 있으면 대진 생성 줄이 보여야 합니다.');

// live: 대진 생성 뒤 — 결과가 먼저 오도록 세팅 카드는 접힌다
r = run({ players: [{}], matches: [{}, {}] });
assert.strictEqual(r.stage, 'live');
for (const id of ['sec-players', 'sec-settings', 'sec-rsvp'])
  assert.strictEqual(r.open(id), false, `대진 생성 뒤에는 ${id} 가 접혀야 합니다.`);
// 중계만 켜져 있어도 live 로 본다
assert.strictEqual(run({ players: [{}], live: true }).stage, 'live');

// 빈 화면의 죽은 상태 타일과, 갈 곳 없는 하단 탭
r = run({});
assert(r.hidden('.auto-flow-board.setup-board'), '빈 화면에서는 상태 타일이 「다음 할 일」과 중복이라 감춰져야 합니다.');
assert(r.hidden('#bnav-bracket') && r.hidden('#bnav-result'), '대진 전에는 대진표·결과 탭이 갈 곳이 없습니다.');
r = run({ players: [{}] });
assert(!r.hidden('.auto-flow-board.setup-board'), '명단이 있으면 상태 타일이 보여야 합니다.');
assert(r.hidden('#bnav-bracket'), '대진을 만들기 전에는 대진표 탭이 감춰져야 합니다.');
r = run({ players: [{}], matches: [{}] });
assert(!r.hidden('#bnav-bracket') && !r.hidden('#bnav-result'), '대진 생성 뒤에는 두 탭이 보여야 합니다.');
const mobileTab = src.slice(src.indexOf('function switchMobileTab('), src.indexOf('function syncBottomNav('));
assert(mobileTab.includes('el.offsetParent===null'), '감춘 구역을 가리키는 하단 탭은 상황판으로 보내야 합니다.');

// ── 공유 채널 분리 (민턴LIVE 와 같은 방식) ──
assert(html.includes("onclick=\"rsvpShareLink('kakao')\"") && html.includes("onclick=\"rsvpShareLink('band')\""),
  '팀전도 카카오톡·밴드 버튼으로 나뉘어야 합니다.');
assert(html.includes('class="team-share-top kakao"') && html.includes('<svg viewBox="0 0 24 24"'),
  '공유 버튼은 로고를 써야 합니다.');
assert(html.includes('window.KOKMATCH_KAKAO_JS_KEY'), '팀전에도 카카오 키 설정 자리가 있어야 합니다.');
const share = src.slice(src.indexOf('async function rsvpShareLink('), src.indexOf('function rsvpLoad('));
assert(share.includes("const popup=channel==='band'?_teamOpenSharePopup():null;"),
  '밴드 창은 사용자 제스처 안에서 먼저 열어야 팝업 차단을 피합니다.');
assert(share.includes('https://band.us/plugin/share?body='), '밴드는 공유 플러그인으로 바로 가야 합니다.');
assert(share.includes('Kakao.Share.sendDefault(') && share.includes('KOKMATCH_KAKAO_JS_KEY'),
  '카카오톡은 키가 있으면 SDK 로 바로 공유해야 합니다.');
assert(css.includes('.team-share-top.kakao') && css.includes('.daily-flash-note'),
  '채널 버튼 색과 짧은 안내 스타일이 있어야 합니다.');

// ── 참가자 등록 입구: 명부에서 고르기가 기본, 직접 추가는 접이식 ──
assert(html.includes('<details class="team-direct-add" id="teamDirectAddBox">') && !html.includes('id="teamDirectAddBox" open'),
  '직접 추가 폼은 기본 접힘이어야 명부 불러오기와 목록이 위로 옵니다.');
assert(/<summary>＋ 직접 추가/.test(html), '직접 추가를 여는 요약 줄이 있어야 합니다.');
assert(html.indexOf('openImportModal()') < html.indexOf('teamDirectAddBox'),
  '명부에서 불러오기가 직접 추가보다 먼저 와야 합니다(기본 경로).');
assert(src.includes("directBox.open=empty&&rosterEmpty;"),
  '명부가 비어 직접 추가가 유일한 길일 때만 자동으로 펼쳐야 합니다.');
assert(html.includes('class="roster-transfer-btn hidden" id="teamImportDailyRosterBtn"')
  && src.includes("btn.classList.toggle('hidden',!count);"),
  '민턴LIVE 선수가 없으면 가져오기 버튼을 감춰야 합니다.');
assert(css.includes('.team-direct-add summary{') && css.includes('min-height:44px'),
  '직접 추가 요약 줄은 터치 높이를 확보해야 합니다.');

assert(src.includes("saveBar.classList.toggle('hidden',!hasStatus&&!hasRestore);"),
  '저장 상태 줄은 내용이 없으면 빈 상자로 남지 않아야 합니다.');

console.log('team stage layout regression ok');
