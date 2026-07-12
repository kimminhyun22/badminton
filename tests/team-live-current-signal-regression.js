const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const liveSrc = fs.readFileSync(path.join(root, 'js', 'live-view.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'live.css'), 'utf8');

assert(
  liveSrc.includes("document.body.classList.toggle('team-live-view',_isTeamLiveData(d))"),
  '팀전LIVE 화면에만 강조 스타일 범위를 적용해야 합니다.'
);
assert(css.includes('--live-alert:#b42318'), '진행 중 신호는 눈에 띄는 진한 레드를 사용해야 합니다.');
assert(css.includes('--live-alert-border:#d92d20'), '진행 경기 테두리는 선명한 레드를 사용해야 합니다.');
assert(css.includes('.team-live-view .current-panel'), '현재 경기 요약 전체를 레드로 강조해야 합니다.');
assert(liveSrc.includes("viewer-next-card'+(isCurrent?' is-current':'')"), '내 페이지의 지금 경기 카드에 현재 상태를 표시해야 합니다.');
assert(css.includes('.team-live-view .viewer-next-card.is-current'), '내 페이지에서 가장 먼저 보이는 지금 경기 카드도 레드로 강조해야 합니다.');
assert(css.includes('.team-live-view .live-match.is-current'), '진행 중 경기 카드를 레드로 강조해야 합니다.');
assert(css.includes('.team-live-view .round.cur .round-badge'), '진행 라운드 배지를 레드로 강조해야 합니다.');
assert(css.includes('.team-live-view .result-entry.needs-result'), '승패 입력 대기 영역을 레드로 강조해야 합니다.');
assert(css.includes('animation:teamLiveAlertPulse 1.15s ease-in-out 4'), '진행 신호는 5초 이내 맥동한 뒤 고정되어야 합니다.');
assert(css.includes('@media (prefers-reduced-motion:reduce)'), '동작 줄이기 설정에서는 강조 애니메이션을 꺼야 합니다.');

console.log('team live current signal regression ok');
