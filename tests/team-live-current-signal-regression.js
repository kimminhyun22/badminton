const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const liveSrc = fs.readFileSync(path.join(root, 'js', 'live-view.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'live.css'), 'utf8');

assert(
  liveSrc.includes("document.body.classList.toggle('team-live-view',_isTeamLiveData(d))"),
  '팀전 화면에만 강조 스타일 범위를 적용해야 합니다.'
);
assert(css.includes('--live-alert:#b42318'), '진행 중 신호는 눈에 띄는 진한 레드를 사용해야 합니다.');
assert(css.includes('--live-alert-border:#d92d20'), '진행 경기 테두리는 선명한 레드를 사용해야 합니다.');
assert(css.includes('.team-live-view .current-panel'), '현재 경기 요약 전체를 레드로 강조해야 합니다.');
assert(liveSrc.includes("viewer-next-card'+(isCurrent?' is-current':'')"), '내 페이지의 지금 경기 카드에 현재 상태를 표시해야 합니다.');
assert(css.includes('.team-live-view .viewer-next-card.is-current'), '내 페이지에서 가장 먼저 보이는 지금 경기 카드도 레드로 강조해야 합니다.');
assert(css.includes('.team-live-view .live-match.is-current'), '진행 중 경기 카드를 레드로 강조해야 합니다.');
assert(css.includes('.team-live-view .round.cur .round-badge'), '진행 라운드 배지를 레드로 강조해야 합니다.');
/* 2026-08-12 계약 갱신(운영자 "진행 중 대진표가 너무 요란해… 예전에 사람들이 입력
   안해서 그랬는데 이제 임원들에게도 권한 부여했으니"): 승패를 넣을 사람이 정해지자
   재촉이 필요 없어졌습니다. 「입력 필요」 배지·주황 테두리·깜빡임을 걷어냅니다. */
assert(!css.includes('needs-result'),
  '승패 입력 재촉 스타일이 남아 있으면 안 됩니다 — 넣을 사람이 정해져 있습니다.');
assert(!css.includes("content:'입력 필요'"), '「입력 필요」 배지는 없어야 합니다.');
assert(!liveSrc.includes('needs-result'), '화면도 그 클래스를 붙이면 안 됩니다.');
// 지금 경기 카드는 테두리 한 겹까지만 — 붉은 글로우까지 두르면 카드 전부가 경고가 됩니다.
const currentCard = css.slice(css.indexOf('.team-live-view .round.cur,'));
const currentRule = currentCard.slice(0, currentCard.indexOf('}'));
assert(/border-color:var\(--live-alert-border\)!important/.test(currentRule),
  '진행 중 경기는 테두리로 구분해야 합니다.');
assert(!/rgba\(217,45,32/.test(currentRule) && !/rgba\(180,35,24/.test(currentRule),
  '테두리 밖 붉은 글로우는 빼야 합니다.');
assert(css.includes('animation:teamLiveAlertPulse 1.15s ease-in-out 4'), '진행 신호는 5초 이내 맥동한 뒤 고정되어야 합니다.');
assert(css.includes('@media (prefers-reduced-motion:reduce)'), '동작 줄이기 설정에서는 강조 애니메이션을 꺼야 합니다.');

console.log('team live current signal regression ok');
