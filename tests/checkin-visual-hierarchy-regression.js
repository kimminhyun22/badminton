const assert = require('assert');
// 이름 크기(운영자 2026-08-13 "진행 중 코트 선수 이름이 가장 중요한 정보").
// 진행 중이 가장 크고, 다음 대진이 그 다음, 조작 버튼은 그보다 작습니다.
{
  const fs2=require('fs'), path2=require('path');
  const src=fs2.readFileSync(path2.join(__dirname,'..','checkin.html'),'utf8');
  // 좁은 화면(360px 이하)용 축소 규칙과 섞이지 않게 기본 선언만 봅니다.
  const size=re=>{const m=src.match(re); return m?parseFloat(m[1]):0;};
  const active=size(/\.event-active-player\{font-size:(\d+(?:\.\d+)?)px;line-height:1\.16/);
  const next=size(/\.event-next-line\{font-size:(\d+(?:\.\d+)?)px;letter-spacing:-\.04em/);
  assert(active>=20,`진행 중 이름은 20px 이상이어야 합니다(현재 ${active}).`);
  assert(next>=17,`다음 대진 이름은 17px 이상이어야 합니다(현재 ${next}).`);
  assert(active>next,'진행 중 이름이 다음 대진보다 커야 위계가 보입니다.');
}
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

// 경기중 = 라이브 (운영자 2026-08-10 실전 피드백).
// "후 휴식"은 직관적이지 않고, 경기중에는 빨간불이 함께 보여야 합니다.
{
  const daily = fs.readFileSync(path.join(__dirname, '..', 'js', 'daily.js'), 'utf8');
  assert(!source.includes("?'후 ':''"), '임원 화면 상태 버튼이 "후 휴식"으로 줄여 쓰면 안 됩니다 — "경기 후 휴식"으로 명확히.');
  assert(!daily.includes("?'후 ':''"), '관리자 화면 상태 버튼도 "경기 후 휴식"으로 명확히 써야 합니다.');
  assert(source.includes("?'경기 후 ':''"), '경기중 회원의 상태 버튼은 "경기 후 " 접두어를 붙여야 합니다.');
  assert(source.includes('class="live-dot"') && source.includes('.live-dot{'),
    '경기중 표시에 빨간불(live-dot)이 있어야 합니다.');
  assert(source.includes('prefers-reduced-motion'), '깜빡임은 동작 축소 설정을 존중해야 합니다.');
}

// 임원 버튼 위계 (v1.10.544, 운영자 "중요도에 따라 간결하고 애플스런 디자인,
// 이미지 버튼 활용"). 규칙이 파일 안에서 순서를 잃으면 원본 규칙에 덮입니다.
{
  const styleEnd = source.indexOf('\n</style>');
  const hierarchy = source.indexOf('/* ═══ 임원 버튼 위계');
  assert(hierarchy > 0, '임원 버튼 위계 블록이 있어야 합니다.');
  assert(hierarchy < styleEnd, '위계 블록은 스타일 블록 안에 있어야 합니다.');
  assert(source.indexOf('.official-overview-tool{', hierarchy) > hierarchy,
    '위계 블록은 스타일 끝에 있어야 합니다 — 앞에 두면 원본 규칙이 덮어씁니다(리그 실측).');
  // 주버튼은 채운 파랑 하나, 파괴는 붉은 tint(채우지 않음).
  assert(/\.event-official-complete,\.event-official-enter,\.official-arrival-actions button\{[^}]*background:var\(--ob-blue\)/.test(source),
    '경기 종료·입장 처리·참가 등록은 채운 파랑 주버튼이어야 합니다.');
  assert(/\.event-official-cancel,\.event-official-queue-remove\{[^}]*background:var\(--ob-red-tint\)/.test(source),
    '경기 취소·삭제는 채우지 않은 붉은 tint 여야 합니다 — 채우면 주버튼과 무게가 같아집니다.');
  // 전역 button 규칙 두 개가 임원 버튼에 새어 들어온 이력이 있습니다.
  assert(source.includes('.event-official-complete,.event-official-cancel,.event-official-enter,'),
    '아이콘 버튼은 flex-direction:row 를 명시해야 합니다 — 전역 column 이 아이콘을 글자 위로 올립니다.');
  assert(/\.official-overview-stat\.active b,\.official-overview-stat\.active span\{color:var\(--ob-blue-deep\)\}/.test(source.replace(/;\}/g,'}')),
    '고른 타일은 글자색을 스스로 정해야 합니다 — 전역 button.active 의 흰 글자가 새어 라벨이 묻힙니다.');
  // 아이콘은 외부 자산 없이 인라인 SVG 한 벌로.
  assert(source.includes('function obIcon(name)') && source.includes('class="ob-ic"'),
    '버튼 아이콘은 인라인 SVG 헬퍼로 그려야 합니다.');
  ['check','x','enter','redo','trash','plus','copy'].forEach(name =>
    assert(source.includes(`obIcon('${name}')`), `${name} 아이콘이 버튼에 붙어야 합니다.`));
  assert(!/<img[^>]+ob-ic/.test(source), '아이콘에 외부 이미지를 쓰면 오프라인·저속 회선에서 깨집니다.');
}

console.log('checkin visual hierarchy regression ok');
