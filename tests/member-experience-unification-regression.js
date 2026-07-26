const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const functionSource = (src, name, nextName) => {
  const start = src.indexOf(`function ${name}`);
  const end = src.indexOf(`function ${nextName}`, start + 1);
  assert(start >= 0 && end > start, `${name} 함수 범위를 찾을 수 있어야 합니다.`);
  return src.slice(start, end);
};

const checkin = read('checkin.html');
const rsvp = read('rsvp.html');
const view = read('view.html');
const live = read('js/live-view.js');
const liveCss = read('css/live.css');
const shell = read('css/member-shell.css');
const serviceWorker = read('sw.js');

[checkin, rsvp, view].forEach((html, index) => {
  assert(html.includes('css/member-shell.css'), `회원 화면 ${index + 1}은 공통 화면 스타일을 사용해야 합니다.`);
  assert(html.includes('class="km-member-page '), `회원 화면 ${index + 1}은 공통 회원 페이지 범위를 가져야 합니다.`);
  assert(html.includes('<span class="km-member-brand">콕매치</span>'), `회원 화면 ${index + 1}의 상단 브랜드는 콕매치로 통일되어야 합니다.`);
});

assert(!rsvp.includes('KOKMATCH TEAM LIVE'), '회원 이름 확인 화면에 서비스 구분용 영문 헤더를 노출하면 안 됩니다.');
assert(!live.includes('선수용 라이브 보드'), '실중계 화면에 서비스 설명용 보조 헤더를 노출하면 안 됩니다.');
assert(live.includes('<div class="viewer-identity-k">내 경기</div>'), '실중계 개인 영역은 MY PAGE 대신 내 경기로 표시해야 합니다.');

const renderSource = functionSource(live, 'render', 'toggleRoster');
assert(
  renderSource.indexOf('html+=buildViewerIdentity(d);') < renderSource.indexOf('html+=buildLiveScore(d,totalR,doneR);'),
  '회원 실중계에서는 내 경기 정보가 팀 점수보다 먼저 나와야 합니다.'
);
assert(!renderSource.includes("d.title||'대진표'"), '회원 실중계 첫 화면에 행사명을 다시 노출하면 안 됩니다.');

const viewerSource = functionSource(live, 'buildViewerIdentity', '_canSubmitResult');
assert(
  viewerSource.indexOf('_viewerNextHtml(d,current)') < viewerSource.indexOf('_viewerStatusButtons(current)'),
  '회원은 늦음·뒷풀이 버튼보다 지금 또는 다음 내 경기를 먼저 봐야 합니다.'
);
assert(checkin.includes("class=\"after-party-quick ${attending?'selected':''}\""), '민턴LIVE는 내 상태 옆에 작은 뒷풀이 토글을 제공해야 합니다.');
assert(live.includes('class="viewer-state-btn party '), '팀전LIVE도 내 경기 영역에 뒷풀이 토글을 제공해야 합니다.');
assert(liveCss.includes('grid-template-columns:minmax(0,1fr) minmax(82px,.72fr)'), '팀전LIVE 뒷풀이 버튼은 늦음보다 작게 배치해야 합니다.');

assert(shell.includes('border-radius:8px!important'), '회원 화면의 명령 버튼과 주요 표면은 8px 규칙을 공유해야 합니다.');
assert(shell.includes('body.km-live-page .viewer-state-btn.ready'), '팀전 늦음 표시는 현재 경기 레드와 구분되는 공통 의미색을 사용해야 합니다.');
assert(shell.includes('.km-member-state.live'), '두 회원 화면은 동일한 LIVE 상태 표시를 사용해야 합니다.');
assert(serviceWorker.includes("'/badminton/css/member-shell.css'"), '공통 회원 화면 스타일은 오프라인 캐시에도 포함되어야 합니다.');
assert(serviceWorker.includes("caches.match(e.request, { ignoreSearch: true })"), '버전 쿼리가 붙은 회원 화면 자산도 오프라인에서 복구되어야 합니다.');

console.log('member experience unification regression ok');
