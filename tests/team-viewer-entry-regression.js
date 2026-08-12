'use strict';
/**
 * 참가자의 진입 (운영자 2026-08-14).
 *
 *   "관리자가 대진생성하고 링크 공유하면 참가자는 이름만 입력하면 본인 및
 *    대진표 보기를 할 수 있도록 간소화 처리. 민턴라이브와 동일한 방식"
 *   "참가자는 그저 대진표를 보는 정도, 투표는 뒷풀이만"
 *
 * 여기서 지키는 것:
 *   1) 검색하기 전에는 **아무 이름도 안 보인다** (운영자 2026-08-12 계약 갱신:
 *      "그냥 초성 입력 검색토록 해줘. 카드가 있으니까 다른 이름을 눌러 볼 것 같아")
 *      — 이름칸을 깔아 두면 자기 이름을 찾기보다 눈에 띄는 이름을 눌러 본다.
 *      검색하면 걸린 사람은 **전원** 나온다(앞 12명만 자르지 않는다)
 *   2) 이름칸이 대진표를 화면 밖으로 밀지 않는다(작은 칸 · 목록만 스크롤)
 *   3) 청/홍이 눈에 구분된다 — 전역 `!important` 버튼 규칙에 먹히지 않아야 한다
 *   4) 참가자가 만질 수 있는 건 **뒷풀이뿐**. 지각은 임원·단장 몫이다
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js', 'live-view.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'live.css'), 'utf8');
function cut(a, b){
  const i = src.indexOf(a);
  assert(i >= 0, `시작 표지를 못 찾음: ${a}`);
  const j = src.indexOf(b, i + a.length);
  assert(j > i, `끝 표지를 못 찾음: ${b}`);
  return src.slice(i, j);
}

// 실제 이름 고르기 화면을 그려서 셉니다.
const sandbox = {console, Object, Set, Number, String, Array, JSON, window: {}};
vm.createContext(sandbox);
vm.runInContext(`
${cut('function esc(s)', '\n')}
var _viewerSearchTerm='';
function _viewerInfo(){ return null; }
function liveTeamLabel(d,side){ return side==='blue'?'청팀':'홍팀'; }
function _viewerRoleText(p){ return p&&p.isLeader?'단장':'선수'; }
function _viewerPartnerText(){ return ''; }
function _viewerNextHtml(){ return ''; }
function _viewerStatusButtons(){ return ''; }
function _viewerRecordHtml(){ return ''; }
function _viewerScheduleHtml(){ return ''; }
${cut('function _koInitials', 'function _viewerSearchText')}
${cut('function _viewerSearchText', 'function _allLiveMembers')}
${cut('function _allLiveMembers', 'function _viewerInfo')}
${cut('function _normalizeMembers', 'function _viewerInfo')}
${cut('function buildViewerIdentity', 'function _canSubmitResult')}
this.api={build:buildViewerIdentity, setQuery(q){ _viewerSearchTerm=q; }};
`, sandbox);

const NAMES_B = ['김민현', '박서연', '정우성', '한지민', '강수지', '오세훈', '신열하', '윤가온', '조민서', '배도윤'];
const NAMES_R = ['이준호', '최다은', '임태경', '서지우', '문하늘', '노아린', '황시우', '권나윤', '천유진', '석건우'];
const d = {
  isTeam: true, teamBlue: '청팀', teamWhite: '홍팀',
  members: {
    blue: NAMES_B.map((n, i) => ({id: 'b' + i, n, l: 4, isLeader: i === 0, isSub: i === 1})),
    red: NAMES_R.map((n, i) => ({id: 'r' + i, n, l: 4, isLeader: i === 0, isSub: i === 1})),
    all: []
  },
  officials: {}
};

// 1) 검색 전에는 이름칸이 하나도 없어야 합니다.
{
  const html = sandbox.api.build(d);
  const cards = (html.match(/viewer-name-card/g) || []).length;
  assert.strictEqual(cards, 0,
    `검색 전에는 이름칸을 깔지 않아야 합니다(남의 이름을 눌러 보게 됩니다): ${cards}`);
  assert(/viewer-search-guide/.test(html), '무엇을 치면 되는지 안내가 있어야 합니다.');
  assert(/오늘 20명/.test(html), '오늘 몇 명인지는 알려 줘야 합니다.');
  assert(/내 이름 찾기/.test(html), '무엇을 해야 하는지 제목이 말해야 합니다.');
  assert(/예\) 김민현, ㄱㅁㅎ/.test(html), '민턴LIVE 와 같은 검색 예시를 보여야 합니다.');
  console.log('  링크 진입: 이름칸 0개 · 검색 안내');
}

// 2) 이름·초성 어느 쪽으로도 찾아집니다.
{
  sandbox.api.setQuery('ㄱㅁㅎ');
  const byInitials = (sandbox.api.build(d).match(/viewer-name-card/g) || []).length;
  sandbox.api.setQuery('김민현');
  const byName = (sandbox.api.build(d).match(/viewer-name-card/g) || []).length;
  sandbox.api.setQuery('없는사람');
  const none = sandbox.api.build(d);
  // 여러 명이 걸리면 전부 나와야 합니다 — 여기서 자르면 뒤쪽 사람이 못 찾습니다.
  sandbox.api.setQuery('ㅈ');
  const bySurname = (sandbox.api.build(d).match(/viewer-name-card/g) || []).length;
  sandbox.api.setQuery('');
  assert.strictEqual(byInitials, 1, '초성으로 찾아져야 합니다.');
  assert.strictEqual(byName, 1, '이름으로도 찾아져야 합니다.');
  assert(bySurname >= 2, `성으로 치면 걸린 사람이 모두 나와야 합니다: ${bySurname}`);
  assert(!/\.slice\(0,\s*12\)/.test(cut('function buildViewerIdentity', 'function _canSubmitResult')),
    '검색 결과를 12개로 자르면 안 됩니다.');
  assert(/찾은 이름이 없습니다/.test(none), '없으면 없다고 말해야 합니다.');
  console.log('  검색: 초성 · 이름 · 빈 결과 안내');
}

// 3) 청/홍이 눈에 구분돼야 합니다 — 이름칸에 팀 표시가 실려야 합니다.
{
  sandbox.api.setQuery('ㅈ');   // 검색해야 이름칸이 나옵니다
  const html = sandbox.api.build(d);
  sandbox.api.setQuery('');
  assert(/viewer-name-card blue/.test(html) && /viewer-name-card red/.test(html),
    '이름칸이 팀을 달고 나와야 합니다.');
  // 아래쪽 `.viewer-identity button{background:…!important}` 가 모든 칸을 파랑으로
  // 눌러 버립니다. `!important` 없이는 홍팀도 파랗게 나옵니다(실측으로 확인).
  assert(/\.viewer-name-card\.red\{[^}]*background:[^;]*!important/.test(css),
    '홍팀 색이 전역 !important 버튼 규칙을 이겨야 합니다.');
  assert(/\.viewer-name-card\.blue\{[^}]*background:[^;]*!important/.test(css),
    '청팀 색도 마찬가지입니다.');
  assert(/\.viewer-identity button[^{]*\{[^}]*!important/.test(css),
    '전제 확인: 그 전역 규칙이 실제로 존재합니다.');
  console.log('  팀 색: 청/홍 구분 · 전역 규칙보다 우선');
}

// 3-1) 이름칸 글자가 잘리지 않아야 합니다.
// 말줄임 때문에 `overflow:hidden` 이 걸려 있어서, 줄 상자가 글자보다 낮으면
// **받침이 잘려 나갑니다.** 아이폰 Safari 처럼 Noto 대신 애플 한글 글꼴로
// 떨어지는 환경에서 「부단장」이 「브다자」로 보였습니다(단장·부단장처럼 두 줄인
// 칸에서만). 줄 높이와 안쪽 여백 두 겹으로 막습니다.
{
  const nameRule = (css.match(/\.viewer-name-card b\{[^}]*\}/) || [''])[0];
  const roleRule = (css.match(/\.viewer-name-card span\{[^}]*\}/) || [''])[0];
  [['이름', nameRule], ['역할', roleRule]].forEach(([what, rule]) => {
    assert(/overflow:hidden/.test(rule), `전제 확인: ${what}칸은 말줄임 때문에 잘라 냅니다.`);
    const lh = Number((rule.match(/line-height:([\d.]+)/) || [])[1] || 0);
    assert(lh >= 1.45, `${what}칸 줄 높이가 ${lh} 입니다 — 1.45 아래면 받침이 잘립니다.`);
    assert(/padding:1px 0/.test(rule), `${what}칸에 위아래 여백이 있어야 잘림에 여유가 생깁니다.`);
  });
  // 나중에 덮어쓰는 규칙이 다시 낮추면 소용이 없습니다.
  const later = css.match(/\.viewer-name-card span\{\s*(?:\/\*[^*]*\*\/\s*)?line-height:([\d.]+)/g) || [];
  later.forEach(hit => {
    const lh = Number((hit.match(/line-height:([\d.]+)/) || [])[1] || 0);
    assert(lh >= 1.45, `뒤에서 줄 높이를 ${lh} 로 다시 낮추면 안 됩니다.`);
  });
  console.log('  이름칸: 줄 높이·여백으로 받침 잘림 방지');
}

// 4) 이름 고르기가 대진표를 밀어내지 않아야 합니다.
{
  assert(/\.viewer-candidates\{[^}]*grid-template-columns:repeat\(3/.test(css),
    '이름칸은 3열이어야 20명이 한눈에 들어옵니다.');
  assert(/\.viewer-candidates\{[^}]*max-height/.test(css),
    '목록이 길어지면 그 안에서만 스크롤해야 대진표가 바로 아래 남습니다.');
  assert(!/\.viewer-candidates\{grid-template-columns:1fr;\}/.test(css),
    '폰에서 1열로 무너지면 20명이 화면을 다 먹습니다.');
  console.log('  배치: 3열 · 목록만 스크롤');
}

// 5) 참가자가 만질 수 있는 건 뒷풀이뿐입니다.
{
  const statusButtons = cut('function _viewerStatusButtons', 'function buildViewerIdentity');
  // 2026-08-12 계약 갱신(운영자 "임원 외 운영자 지각 버튼 삭제"): 지각은 **남을**
  // 대상으로 하는 운영 행위라 팀 명단에서 합니다. 내 카드에 두면 임원이 자기
  // 지각을 누르는 이상한 버튼이 됩니다. 찍혀 있으면 표시만 합니다.
  assert(!/toggleMemberLate/.test(statusButtons),
    '내 카드에서는 지각을 누를 수 없어야 합니다 — 팀 명단에서 합니다.');
  assert(/viewer-state-view on">지각/.test(statusButtons),
    '내가 지각으로 찍혀 있으면 그 사실은 보여야 합니다.');
  assert(/toggleMemberParty/.test(statusButtons), '뒷풀이는 본인이 누를 수 있어야 합니다.');
  const idx = statusButtons.indexOf('toggleMemberParty');
  assert(!/canOperate/.test(statusButtons.slice(idx - 120, idx)),
    '뒷풀이까지 운영진 전용으로 막으면 안 됩니다 — 참가자의 유일한 투표입니다.');
  const toggle = cut('async function toggleMemberLate', 'async function toggleMemberParty');
  assert(/_canOperateAttendance/.test(toggle),
    '저장하는 자리에서도 참가자의 지각 변경을 막아야 합니다.');
  console.log('  참가자 권한: 뒷풀이만 · 지각은 임원/단장');
}

console.log('\nteam viewer entry regression ok');
