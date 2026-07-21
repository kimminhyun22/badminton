const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const appCss = read('css/app.css');
const teamCss = read('css/team.css');
const liveCss = read('css/live.css');
const checkin = read('checkin.html');
const rsvp = read('rsvp.html');
const index = read('index.html');
const team = read('team.html');
const view = read('view.html');
const dailyJs = read('js/daily.js');
const teamJs = read('js/team.js');

assert(appCss.includes('--safe-bottom:env(safe-area-inset-bottom,0px)'), '민턴LIVE 관리자에 safe-area 변수가 필요합니다.');
assert(appCss.includes('.daily-court-grid{grid-template-columns:1fr;}'), '430px 이하 진행 코트는 한 열이어야 합니다.');
assert(appCss.includes('.daily-queue-player{min-height:44px;}'), '대기 선수 조작 영역은 44px 이상이어야 합니다.');
assert(appCss.includes('.goto-current-btn .gcb-text{display:none;}'), '모바일 진행중 버튼은 화면을 가리지 않는 아이콘이어야 합니다.');
assert(appCss.includes('.daily-ops-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;}'), '360px 상황판 지표는 비대칭으로 남으면 안 됩니다.');

assert(teamCss.includes('@media(max-width:480px)'), '팀전 대진표의 모바일 경계 규칙이 필요합니다.');
assert(teamCss.includes('#tabBracket .match-grid{grid-template-columns:1fr!important;}'), '480px 이하 팀전 대진표는 한 열이어야 합니다.');
assert(teamCss.includes('.team-list-wrap.show{grid-template-columns:1fr!important;'), '모바일 청홍팀 명단은 이름을 읽을 수 있는 한 열이어야 합니다.');
assert(teamCss.includes('.qd-row-detail{font-size:.75rem!important;line-height:1.45!important;}'), '모바일 품질 점검 설명은 12px 수준으로 읽혀야 합니다.');
assert(teamCss.includes('.bottom-nav{padding-bottom:var(--safe-bottom)!important;}'), '팀전 하단 내비는 홈 인디케이터를 피해야 합니다.');

assert(liveCss.includes('@media(max-width:375px)'), '좁은 실중계 화면의 단일 열 규칙이 필요합니다.');
assert(liveCss.includes('.next-list{grid-template-columns:1fr!important;}'), '좁은 실중계 다음 경기 목록은 한 열이어야 합니다.');
assert(liveCss.includes('overflow-wrap:anywhere'), '실중계의 긴 선수명은 카드 안에서 줄바꿈되어야 합니다.');

assert(checkin.includes('max-height:calc(100dvh - var(--safe-top) - var(--safe-bottom) - 28px)'), '민턴LIVE 코트 선택 시트는 화면 높이를 넘지 않아야 합니다.');
assert(checkin.includes('@media(max-width:340px)'), '320px 다음 대진은 이름을 보존하는 좁은 화면 규칙이 필요합니다.');
assert(checkin.includes('id="toast" class="toast" role="status" aria-live="polite"'), '민턴LIVE 알림은 보조기기에 전달되어야 합니다.');
assert(rsvp.includes('.identity-change,\n.select-badge,'), '팀전 회원 핵심 조작은 모바일 터치 크기를 보장해야 합니다.');
assert(rsvp.includes('id="toast" class="toast" role="status" aria-live="polite"'), '팀전 회원 알림은 보조기기에 전달되어야 합니다.');

assert(index.includes('class="gcb-prefix">진행중</span>'), '민턴LIVE 진행중 버튼에 축약 가능한 문구가 필요합니다.');
assert(team.includes('class="gcb-prefix">진행중</span>'), '팀전LIVE 진행중 버튼에 축약 가능한 문구가 필요합니다.');
assert(index.includes('onclick="switchMobileTab(\'roster\')"'), '민턴LIVE 모바일 명부 탭은 전용 이동 흐름을 사용해야 합니다.');
assert(team.includes('onclick="switchMobileTab(\'roster\')"'), '팀전LIVE 모바일 명부 탭은 전용 이동 흐름을 사용해야 합니다.');
assert(dailyJs.includes("window.scrollTo({top:0,behavior:'auto'});"), '민턴LIVE 명부는 맨 위에서 열려야 합니다.');
assert(dailyJs.includes("if(!document.getElementById('pageDaily')?.classList.contains('active'))return;"), '명부 화면에서 스크롤 판정이 하단 탭 상태를 덮어쓰면 안 됩니다.');
assert(teamJs.includes("window.scrollTo({top:0,behavior:'auto'});"), '팀전LIVE 명부는 맨 위에서 열려야 합니다.');
assert(view.includes('viewport-fit=cover'), '실중계 화면도 iPhone safe-area를 사용해야 합니다.');

console.log('mobile layout regression ok');
