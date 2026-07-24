const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'checkin.html'), 'utf8');

function functionSource(name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  assert(start >= 0 && end > start, `Missing function boundary: ${name}`);
  return source.slice(start, end);
}

assert(
  source.includes('id="afterPartyPanel" class="after-party-panel hidden"'),
  'After-party content needs its own visual section.'
);
assert(
  source.includes('id="officialPanel" class="panel official-panel hidden"'),
  'Club official tools need a separate operational section.'
);

const placeEvent = functionSource('placeEventPanelForViewer', 'jumpToOfficialMemberStatus');
assert(
  placeEvent.includes('main.insertBefore(panel,nextTarget)'),
  'Member LIVE status should appear before the after-party section.'
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

const renderMyCard = functionSource('renderMyCard', 'requestPlayerOptions');
assert(
  renderMyCard.includes('afterPartyPanel.innerHTML=afterPartyHtml'),
  'After-party content should render outside the personal action card.'
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
