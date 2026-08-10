'use strict';
/**
 * 참가자의 진입 (운영자 2026-08-14).
 *
 *   "관리자가 대진생성하고 링크 공유하면 참가자는 이름만 입력하면 본인 및
 *    대진표 보기를 할 수 있도록 간소화 처리. 민턴라이브와 동일한 방식"
 *   "참가자는 그저 대진표를 보는 정도, 투표는 뒷풀이만"
 *
 * 여기서 지키는 것:
 *   1) 링크를 열면 **전원**이 보인다 — 앞 12명만 보이면 뒤쪽 사람은 자기 이름이
 *      없는 줄 안다
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

// 1) 링크를 열면 전원이 보여야 합니다.
{
  const html = sandbox.api.build(d);
  const cards = (html.match(/viewer-name-card/g) || []).length;
  assert.strictEqual(cards, 20,
    `명단 20명이면 20칸이 보여야 합니다(잘라내면 뒤쪽 사람이 자기 이름을 못 찾습니다): ${cards}`);
  assert(!/\.slice\(0,\s*12\)/.test(cut('function buildViewerIdentity', 'function _canSubmitResult')),
    '후보 목록을 12개로 자르면 안 됩니다.');
  assert(/내 이름을 누르세요/.test(html), '무엇을 해야 하는지 제목이 말해야 합니다.');
  assert(/예\) 김민현, ㄱㅁㅎ/.test(html), '민턴LIVE 와 같은 검색 예시를 보여야 합니다.');
  console.log(`  링크 진입: 전원 ${cards}칸 · 검색 예시 안내`);
}

// 2) 이름·초성 어느 쪽으로도 찾아집니다.
{
  sandbox.api.setQuery('ㄱㅁㅎ');
  const byInitials = (sandbox.api.build(d).match(/viewer-name-card/g) || []).length;
  sandbox.api.setQuery('김민현');
  const byName = (sandbox.api.build(d).match(/viewer-name-card/g) || []).length;
  sandbox.api.setQuery('없는사람');
  const none = sandbox.api.build(d);
  sandbox.api.setQuery('');
  assert.strictEqual(byInitials, 1, '초성으로 찾아져야 합니다.');
  assert.strictEqual(byName, 1, '이름으로도 찾아져야 합니다.');
  assert(/검색 결과가 없습니다/.test(none), '없으면 없다고 말해야 합니다.');
  console.log('  검색: 초성 · 이름 · 빈 결과 안내');
}

// 3) 청/홍이 눈에 구분돼야 합니다 — 이름칸에 팀 표시가 실려야 합니다.
{
  const html = sandbox.api.build(d);
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
  assert(/canOperate\s*\?/.test(statusButtons) && /toggleMemberLate/.test(statusButtons),
    '지각 버튼은 운영진에게만 보여야 합니다.');
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
