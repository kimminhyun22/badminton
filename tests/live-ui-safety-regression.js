const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const live = fs.readFileSync(path.join(root, 'js', 'live-view.js'), 'utf8');
const checkin = fs.readFileSync(path.join(root, 'checkin.html'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  live.includes("if(!opts || !opts.current) return '';"),
  '다음 대진에는 승패 입력 버튼을 렌더링하면 안 됩니다.'
);
assert(
  live.includes('Number(liveMatch.round)!==Number(currentRound)'),
  '저장 시점에도 현재 라운드인지 재검증해야 합니다.'
);
assert(
  checkin.includes('const queuePending=pendingEnter||pendingYield;'),
  '입장 처리와 이번만 뒤로 요청은 같은 대진에서 함께 잠겨야 합니다.'
);
assert(
  checkin.includes('class="event-row event-active ${state}"'),
  '좁은 화면에서 진행 경기 전용 레이아웃을 적용할 수 있어야 합니다.'
);
assert(
  checkin.includes('pendingComplete||pendingActiveYield') &&
  checkin.includes('officialQueueReadyForHandoff(item)'),
  '경기 종료와 자동 투입 취소는 중복 실행을 막고 실제 대체 가능한 대진을 확인해야 합니다.'
);

console.log('live ui safety regression: pass');
