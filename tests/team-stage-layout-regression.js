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
// 카드를 프로그램이 접을 때 「수동으로 접었다」로 기억되지 않게 하는 가드 —
// 실제 함수를 잘라 넣는다(스텁으로 흉내 내면 계약이 갈린다).
const code = cut('let _teamProgrammaticOpen=false;', "document.addEventListener('toggle'")
  + cut('function _teamUiStage()', 'function _autoFlowSetResultSections(');

function run(state){
  const els = {};
  const get = key => {
    if (!els[key]) {
      const e = { classes: new Set(), open: null, parentElement: null, textContent: '', tagName: key.startsWith('#sec-') ? 'DETAILS' : 'DIV' };
      e.dataset = {};
      e.classList = {
        toggle: (c, on) => { if (on) e.classes.add(c); else e.classes.delete(c); },
        contains: c => e.classes.has(c),
        add: c => e.classes.add(c),
        remove: c => e.classes.delete(c),
      };
      els[key] = e;
    }
    return els[key];
  };
  const genBtn = get('#sec-settings .btn-gen');
  genBtn.parentElement = get('gen-row');
  // team.html 의 #bracketSaveQuick 는 class="bracket-save-quick hidden" 로 시작한다
  if (!state.quickVisible) get('#bracketSaveQuick').classes.add('hidden');
  (state.preHidden || []).forEach(sel => get(sel).classes.add('hidden'));
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
// 2026-09-03: 진행 표시를 흐름 타일 한 벌로 합쳤다 — 상태 판은 저장 대진 복구 화면 전용이다.
assert(r.hidden('.auto-flow-board.setup-board'), '복구 대기가 아니면 상태 판은 감춰져야 합니다.');
assert(r.hidden('#bnav-bracket') && r.hidden('#bnav-result'), '대진 전에는 대진표·결과 탭이 갈 곳이 없습니다.');
r = run({ players: [{}] });
assert(r.hidden('.auto-flow-board.setup-board'), '명단이 있어도 상태 판은 복구 화면 전용입니다.');
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
assert(css.includes('.team-share-top.kakao') && css.includes('.team-flash-note'),
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

// ── 2차 감사(2026-09-03) 반영: 중복 입구·죽은 버튼·채널 일관성 ──
r = run({});
assert(r.hidden('.auto-flow-quick-actions'), '참가자가 없으면 공유 버튼은 눌러도 안내창뿐이라 감춰야 합니다.');
r = run({ players: [{}], matches: [{}] });
assert(r.hidden('#teamLiveActionRow'), 'LIVE 중 「팀전 진행 중」처럼 보이는 중계 종료 사본은 없어야 합니다.');
assert(r.hidden('#undoBtnMain'), '대진이 생기면 되돌리기는 대진 옆 하나만 남아야 합니다.');
assert(src.includes("hide('.auto-flow-quick-actions',(empty&&!_rsvpId)||shareCta);"),
  '안내 CTA 가 공유일 때는 머리쪽 공유 사본을 감춰야 합니다 — 같은 버튼이 한 화면에 넷이 되면 안 됩니다.');
assert(src.includes('const TEAM_KAKAO_SVG=') && src.includes('function _autoFlowShareAction('),
  '채널 버튼 로고와 공유 CTA 헬퍼가 있어야 합니다.');
assert(src.includes("link:_autoFlowShareAction(),"),
  '링크 단계 CTA 도 채널 버튼이어야 합니다 — 채널 없는 사본을 남기면 안 됩니다.');
assert((src.match(/TEAM_KAKAO_SVG\}/g) || []).length >= 3, '로고는 CTA·LIVE 스트립·링크 카드에도 붙어야 합니다.');
assert(css.includes('.rsvp-action-btn.primary.soft.kakao'),
  '링크 카드 채널 색은 .primary.soft 규칙을 이길 특이도가 필요합니다.');
assert(/\.auto-flow-btn\.kakao[^{]*\{[^}]*background:#FEE500!important/.test(css),
  '채널 색은 .auto-flow-btn 의 !important 그라데이션을 이겨야 합니다.');
assert(css.includes('.mob-save-bar{display:none!important;}'),
  '모바일 전용 저장 바가 데스크톱에서 내비와 겹치면 안 됩니다.');
assert(css.includes('.team-live-ops-actions .team-live-primary{grid-column:1/-1;}'),
  'LIVE 스트립은 1차 행동 전폭 + 채널 2열이어야 합니다.');
assert(css.includes('.rsvp-current-actions>.rsvp-action-btn:last-child{grid-column:1/-1;}'),
  '링크 카드의 「참가자 수정」은 반쪽으로 남지 않아야 합니다.');
assert(src.includes("if(resumeTop&&document.querySelector('#autoFlowBody .auto-flow-action.live-start'))resumeTop.classList.add('hidden');"),
  '「팀전 이어가기」는 보드 CTA 와 머리쪽 버튼이 겹치면 안 됩니다.');
const shareFn = src.slice(src.indexOf('async function rsvpCopyShareText('), src.indexOf('function rsvpLoad('));
assert(shareFn.includes('_teamShareToKakao(body,url)') && shareFn.includes('const text=`${body}\\n\\n${url}`;'),
  '카카오톡 본문에는 주소를 넣지 않아야 합니다(link 필드가 붙입니다).');
assert(!css.includes('.daily-flash-note') && css.includes('.team-flash-note'),
  '팀전 CSS 는 팀전 소유 클래스를 써야 합니다.');

// 청/홍 버튼의 주인은 모드 로직 — 단계 로직이 hidden 을 벗기면 자유 대진에서 되살아난다
assert(src.includes("el.dataset.hiddenByStage='1';") && src.includes("else if(el.dataset.hiddenByStage==='1')"),
  '단계 로직은 자기가 감춘 것만 되돌려야 합니다.');
{
  // 모드 로직이 미리 감춰 둔 버튼을 roster 단계가 되살리면 안 된다
  const dom = run({ players: [{}], preHidden: ['#teamAssignBtn'] });
  assert(dom.hidden('#teamAssignBtn'), '자유 대진에서 감춰 둔 청/홍 배정 버튼을 단계 로직이 되살리면 안 됩니다.');
}
// 가대진 저장 사본은 단계 배치 한 곳에서만 정한다
assert(src.includes("hide('.bracket-save-primary',empty||quickVisible||liveOn);"),
  '대진안 저장 사본의 주인은 한 곳이어야 하고, 중계 중에는 양쪽 다 감춰야 합니다.');
assert(run({ players: [{}], matches: [{}], live: true }).hidden('.bracket-save-primary'),
  '중계 중에는 진행 설정의 저장 사본도 감춰야 합니다(상황판 빠른 저장과 같은 기준).');
assert(run({ players: [{}], quickVisible: true }).hidden('.bracket-save-primary'),
  '상황판 사본이 떠 있으면 진행 설정 사본은 감춰야 합니다.');
// 자유 대진에는 청·홍 명단이 없다
assert(src.includes("document.querySelectorAll('[data-team-only]').forEach(el=>el.classList.toggle('hidden',!wantTeam));"),
  '자유 대진에서는 공유·인쇄 메뉴의 청팀·홍팀 항목을 감춰야 합니다.');
assert((html.match(/data-team-only/g) || []).length === 4, '청팀·홍팀 항목 네 개에 표시가 있어야 합니다.');
assert(!html.includes('⚪ 홍팀 명단') && html.includes('🔴 홍팀 명단'), '홍팀 아이콘은 붉은색이어야 합니다.');
// 저장 이름칸은 모바일에서 16px — 인라인 font-size 가 규칙을 이기면 iOS 가 확대한다
assert(!/id="slotNameInput"[\s\S]{0,320}?font-size:\.92rem/.test(html),
  '저장 이름칸에 인라인 font-size 가 있으면 iOS 가 포커스 시 확대합니다.');
assert(css.includes('@media(min-width:769px){#slotNameInput{font-size:.92rem;}}'),
  '데스크톱에서는 저장 이름칸 크기를 되돌려야 합니다.');
// 320px 급수 줄
assert(css.includes('.team-direct-add-body .lv-sel-btns{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));'),
  '360px 이하에서 급수 6버튼은 6등분 격자여야 카드 밖으로 나가지 않습니다.');

// ── 문구·글자 (2026-09-03 감사 3차) ──
assert(!/팀전를|팀전는/.test(html) && !/팀전를|팀전는/.test(src),
  "'팀전'은 받침이 있어 조사는 '팀전을/팀전은' 입니다.");
assert(!html.includes('가대진') && !src.includes('가대진'),
  "'가대진'은 내부 은어입니다 — 화면에는 '대진안'으로 씁니다.");
assert(html.includes('<p>월례 팀전 · 자유 대진 · 실시간 중계</p>'),
  '헤더 부제는 자유 대진과 중계까지 다룬다는 것을 말해야 합니다.');
assert(!html.includes('연속배정 패널티') && !html.includes('>랜덤<'),
  '내부 알고리즘 용어를 헤더 배지에 두면 안 됩니다.');
assert(html.includes('📤 무엇을 공유할까요?'),
  '「공유」로 연 시트가 「인쇄」라고 말하면 안 됩니다.');
assert(src.includes("currentRound==='-'?'중계 중'"),
  '대진이 아직 없을 때 「- 진행」으로 뜨면 안 됩니다.');
assert(css.includes('.op-status-sub{max-width:100%!important;text-align:left;}'),
  '운영 상태 줄은 좁은 화면에서 오른쪽 정렬로 깨지지 않아야 합니다.');
// 2026-09-03: 헤더 배지(.hb/.hbs)는 두 화면 어디에서도 렌더되지 않아 규칙째 걷어냈다.
// 렌더되지 않는 요소에 건 글자 하한은 초록이어도 아무것도 증명하지 않는다.
assert(!css.includes('.hb{') && !css.includes('.hbs{'),
  '렌더되지 않는 헤더 배지 규칙을 되살리면 안 됩니다.');

// ── 최종 감사(2026-09-03) 반영 ──
// 대진을 버리면 지난 지표가 남지 않는다 — 전체 초기화는 renderResults 를 부르지 않는다
assert(run({}).hidden('#sec-quality') && run({ players: [{}] }).hidden('#sec-quality'),
  '대진이 없으면 품질 점검 카드는 감춰져야 합니다.');
assert(run({ players: [{}], live: true }).hidden('#sec-quality'),
  '중계만 켜져 있고 대진이 없으면 빈 품질 카드가 뜨면 안 됩니다.');
assert(!run({ players: [{}], matches: [{}] }).hidden('#sec-quality'),
  '대진이 있으면 품질 점검이 보여야 합니다.');
// 팀 배정·대진 생성은 4명부터 — 1~3명에서는 눌러도 빨간 안내막대뿐이다
{
  const few = run({ players: [{}, {}, {}] });
  assert(few.hidden('#teamAssignBtn') && few.hidden('#sec-settings .btn-gen'),
    '1~3명에서는 팀 배정·대진 생성이 감춰져야 합니다.');
  assert(!few.hidden('gen-row'), '되돌리기는 남아야 합니다 — 줄째 감추는 것은 0명일 때뿐입니다.');
  const four = run({ players: [{}, {}, {}, {}] });
  assert(!four.hidden('#teamAssignBtn') && !four.hidden('#sec-settings .btn-gen'),
    '4명부터는 팀 배정·대진 생성이 보여야 합니다.');
}
// 저장 대진 복구 화면에서는 「무엇을 되살리는지」 판을 남긴다
assert(src.includes("hide('.auto-flow-board.setup-board',!_teamRestoreHint);")
  && src.includes("_teamRestoreHint=stage==='restoreBracket'||stage==='restoreLive';"),
  '복구 대기 화면에서는 상태 판을 감추면 안 됩니다.');
// 되돌리기로 대진만 사라지면 접어 둔 카드를 도로 편다
assert(src.includes("if(stage==='roster'&&_teamUiStageShown==='live')"),
  '대진을 버리고 명단만 남으면 세팅 카드가 다시 열려야 합니다.');
// 900px 이하에서 품질 점검이 설정 카드 밑으로 밀리던 것
assert(css.includes('#resultArea>#sec-quality{order:5;}') && css.includes('  #sec-quality{order:1;}'),
  '품질 점검 order 는 결과 영역 자식으로 좁히고, 모바일에서는 결과 위에 와야 합니다.');

console.log('team stage layout regression ok');

// 진행 설정을 펼치면 요약 칩은 바로 아래 라벨과 같은 말이 된다 — 접혔을 때만 보인다(2026-09-03).
assert(css.includes('#sec-settings[open] .settings-mini-summary'),
  '진행 설정을 펼치면 요약 칩은 감춰야 합니다(아래 라벨과 같은 말).');
// 버튼 위 보조문구는 CSS 로 늘 숨겨져 있던 죽은 줄이었다 — 다시 만들지 말 것.
assert(!src.includes('class="auto-flow-next"'),
  '「다음 할 일」 버튼 위 보조문구는 화면에 나온 적이 없는 사본입니다 — 되살리지 마세요.');
assert(!/<div class="auto-flow-sub" id="autoFlowSub">.+<\/div>/.test(html),
  '부제는 어느 단계도 쓰지 않습니다 — HTML 기본값을 넣으면 첫 페인트에 스칩니다.');

/* ── 민턴LIVE 와 한 벌로 (운영자 2026-09-03 "지금은 서로 다른 서비스를 붙여놓은 것 같다") ── */

// 보드 제목은 「여기가 어디」 — 민턴LIVE 의 「상황판」과 같은 말이고 하단 내비 라벨과도 같다.
// 단계 이름은 안내문(stageGuide)과 흐름 칩이 맡는다.
assert(html.includes('<h3 class="auto-flow-title" id="autoFlowTitle">상황판</h3>'),
  '팀전 보드 제목은 민턴LIVE 와 같이 「상황판」으로 고정해야 합니다.');
assert(!src.includes('titleEl.textContent'),
  '보드 제목을 단계마다 갈아 끼우면 화면 이름이 흔들립니다 — 제목은 고정입니다.');

// 배지는 「상태」만 말한다. 「공유·팀 배정·팀 완료·시작 전」은 단계 이름이라 안내문·칩과 세 겹이었다.
{
  const badges = [...src.matchAll(/badge:'([^']+)'/g)].map(m => m[1]);
  const allowed = new Set(['운영 준비', '진행 중', '이어가기', '불러오기']);
  const bad = badges.filter(b => !allowed.has(b));
  assert.deepStrictEqual(bad, [],
    `보드 배지는 상태 4가지만 씁니다(단계 이름 금지): ${bad.join(', ')}`);
}

// 안내 제목의 번호는 흐름 칩(5칸)과 어긋났다 — 「4. 대진 생성」이 3번 칩 위에 앉았다.
// 민턴LIVE 도 안내 제목에 번호를 쓰지 않는다.
assert(!/\bk:'\d+\.\s/.test(src),
  '단계 안내 제목에 번호를 다시 붙이면 흐름 칩과 어긋납니다.');

// 제목 크기의 주인은 한 곳 — 덮어쓰기를 쌓으면 폰에서 민턴LIVE 보다 30% 작아진다.
{
  const n = (css.match(/\.auto-flow-title[^,{]*\{[^}]*font-size/g) || []).length;
  assert.strictEqual(n, 1, `보드 제목 크기를 정하는 규칙은 하나여야 합니다(현재 ${n}곳).`);
}

// 헤더 상시 칩은 민턴LIVE 에 없다 — 눌리지도 바뀌지도 않는 문구다.
assert(!html.includes('class="hbs"'),
  '팀전 헤더의 상시 생성 옵션 칩은 없어야 합니다 — 민턴LIVE 와 같은 헤더입니다.');

// 하단 탭 순서가 화면 스크롤 순서와 같아야 하이라이트가 뒤로 튀지 않는다.
{
  const order = ['bnav-dashboard', 'bnav-result', 'bnav-bracket', 'bnav-players', 'bnav-roster']
    .map(id => html.indexOf(`id="${id}"`));
  assert(order.every(i => i >= 0), '하단 탭 5개가 모두 있어야 합니다.');
  assert(order.every((v, i) => i === 0 || v > order[i - 1]),
    '하단 탭 순서는 화면 순서(상황판·결과·대진표·참가자·명부)와 같아야 합니다.');
}

// 접기 어휘는 한 벌 — 열기/닫기와 펼치기/접기가 섞여 있었다.
assert(!html.includes('>닫기</button>'), '구역 접기 버튼은 「접기」로 통일합니다.');
assert(!css.includes("content:'열기'"), '구역 펼치기 표시는 「펼치기」로 통일합니다.');

// 상태 표시는 민턴LIVE 알약과 같은 물건 — 점이 있어야 한다.
assert(html.includes('id="autoFlowBadge"') && html.includes('id="autoFlowBadgeText"')
  && /autoFlowBadge"><span class="daily-dot">/.test(html),
  '상태 배지에는 민턴LIVE 와 같은 점(.daily-dot)이 있어야 합니다.');
assert(src.includes('badgeTextEl.textContent=cfg.badge'),
  '배지 글자만 갈아 끼워야 점이 지워지지 않습니다.');

// 진행 표시는 하나여야 한다 — 칩(자리)과 상태 판(값)이 같은 것을 두 문법으로 말했다.
// 민턴LIVE 의 .daily-start-step 과 같은 「번호 + 이름 + 값 + 한 줄」 타일 한 벌로 합쳤다.
assert(src.includes('class="team-live-step-num"') && src.includes('class="team-live-step-value"'),
  '흐름 표시는 번호와 값을 가진 타일이어야 합니다.');
assert(!/team-live-step \$\{stepState\('playerSetup'\)\}">참가자<\/span>/.test(src),
  '옛 칩 문법으로 되돌리면 안 됩니다.');
assert(/\$\{doneSteps\}\/5/.test(src), '민턴LIVE 의 「n/2」와 같은 자리에 진행 개수가 있어야 합니다.');
// 갈 곳이 없는 단계는 누를 수 없어야 한다 — 눌리면 단계 게이팅이 감춘 카드를 몰래 연다.
assert(src.includes("f.target?` role=\"button\""),
  '이동 대상이 없는 흐름 타일에는 role/onclick 을 붙이면 안 됩니다.');
