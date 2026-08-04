const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'checkin.html'), 'utf8');

function functionSource(name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  const endAsync = end >= 6 && source.slice(end-6, end) === 'async ' ? end-6 : end;
  assert(start >= 0 && end > start, `Missing function boundary: ${name}`);
  return source.slice(start,endAsync);
}

assert(
  source.includes('id="afterPartyPanel" class="after-party-panel hidden"'),
  'After-party content needs its own visual section.'
);
assert(
  source.includes('id="officialPanel" class="panel official-panel hidden"'),
  'Club official tools need a separate operational section.'
);

const placeEvent = functionSource('placeEventPanelForViewer', 'renderEvent');
assert(
  placeEvent.includes('[myCard,panel,officialPanel]'),
  '일반 회원은 내 카드 → 경기 현황 순으로 보여야 합니다.'
);
assert(
  placeEvent.includes('[panel,officialPanel,myCard]'),
  '임원은 본인 이름표보다 운영 대시보드를 먼저 봐야 합니다.'
);

const renderEvent = functionSource('renderEvent', 'render');
assert(
  renderEvent.includes("index===0?'priority ':''"),
  'The first queued match needs an explicit priority marker.'
);
assert(
  source.includes('.event-row.next.priority{'),
  'The first queued match needs a visible priority style.'
);
assert(
  source.includes('class="event-partner-badge">파트너 지정</span>'),
  'Partner-designated matches need a compact visible badge.'
);
assert(
  renderEvent.includes('partnerMatchBadge(m)'),
  'Partner badges need to appear in active and queued LIVE match cards.'
);
const currentMatch = functionSource('myCurrentMatchHtml', 'queueIdentity');
assert(
  currentMatch.includes('partnerMatchBadge(m)'),
  'A member needs to see the partner badge in their current match card.'
);

const renderMyCard = functionSource('renderMyCard', 'requestPlayerOptions');
assert(
  renderMyCard.includes("afterPartyPanel.innerHTML=''"),
  '뒷풀이 별도 패널은 비워 둡니다. 신청자 명단은 운영 현황에서 봅니다.'
);
assert(
  renderMyCard.includes('afterPartyQuickButtonHtml(selected,afterPartyDisabledAttr)'),
  'The personal action card should keep a compact after-party toggle beside status actions.'
);
assert(
  renderMyCard.includes('officialPanel.innerHTML=officialHtml'),
  'Club official tools should render outside the personal action card.'
);

assert(
  source.includes('visibility:hidden;') &&
  source.includes('.toast.show{\n  opacity:1;\n  visibility:visible;'),
  'A hidden toast must not leave a dark strip on the mobile viewport.'
);

console.log('checkin visual hierarchy regression ok');
