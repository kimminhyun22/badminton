'use strict';
/**
 * 대진 준비 화면(rsvp.html)은 **들어가는 문**입니다 (운영자 2026-08-12).
 *
 *   "늦음 삭제"
 *   "뒷풀이 늦음 현황도 모두 없애고 실중계 들어가기만 남겨"
 *   "이름 입력하고 본인확인되면 바로 대진표 보게"
 *   "본인 확인되면 바로 연결되야지"
 *
 * 여기서 지키는 것:
 *   1) 참가자가 누를 것은 없다 — 지각·뒷풀이는 현장에서 임원이 다룬다
 *   2) 집계 화면(늦음 현황)을 다시 만들지 않는다
 *   3) 본인 확인이 끝난 폰은 **대진이 열리는 순간** 알아서 넘어간다
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'rsvp.html'), 'utf8');

// 1) 참가자가 누르는 지각·뒷풀이 버튼이 없어야 합니다.
{
  assert(!/onclick="toggleLateStatus\(/.test(src),
    '늦음 버튼은 없어야 합니다 — 지각은 현장에서 임원이 표시합니다.');
  assert(!/늦는 경우에만 알려주세요/.test(src),
    '늦음 안내 문구도 남아 있으면 안 됩니다.');
  assert(!/onclick="toggleParty\(/.test(src),
    '뒷풀이 버튼은 없어야 합니다 — 이 화면이 하는 일이 아닙니다.');
  console.log('  참가자 버튼: 늦음·뒷풀이 없음');
}

// 2) 늦음 현황 집계 화면이 없어야 합니다.
{
  // 설명 주석에는 「늦음 현황」이라는 말이 남습니다 — 코드에 남은 것만 봅니다.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ['summaryPanel', 'summaryActions', 'toggleSummary', 'renderSummaryPanel', 'summaryNames']
    .forEach(token => {
      assert(!code.includes(token), `${token} 이 남아 있으면 안 됩니다 — 집계 화면은 뺐습니다.`);
    });
  // 화면에 붙는 것도 없어야 합니다(묶음 선택자에 남은 이름까지 쫓지는 않습니다).
  [/class="summary-/, /id="summary/, /class="party-toggle/, /class="[^"]*late-only/]
    .forEach(re => assert(!re.test(code), `${re} 가 화면에 남아 있으면 안 됩니다.`));
  console.log('  집계 화면: 없음');
}

// 3) 실중계로 들어가는 길은 남아야 합니다.
{
  assert(/실중계 들어가기/.test(src), '실중계로 들어가는 버튼은 남아야 합니다.');
  assert(/function enterActiveLive\(\)/.test(src), '자동 진입 함수가 있어야 합니다.');
  console.log('  실중계 진입: 버튼 · 자동 진입');
}

// 4) 본인 확인이 끝났으면 **대진이 열리는 순간** 넘어가야 합니다.
//    예전에는 이름을 고른 그때만 확인해서, 준비 중이면 화면에 머물렀고
//    대진이 열려도 직접 새로 고쳐야 했습니다.
{
  const listener = src.slice(src.indexOf("db.ref(path()).on('value'"));
  const body = listener.slice(0, listener.indexOf('bindSearch()'));
  assert(/session=data\.session;/.test(body), '전제 확인: 세션을 받아 적습니다.');
  const posAssign = body.indexOf('session=data.session;');
  const posEnter = body.indexOf('if(enterActiveLive())return;');
  assert(posEnter > posAssign,
    '세션이 갱신될 때마다 대진이 열렸는지 확인해 바로 넘어가야 합니다.');
  assert(posEnter < body.indexOf('render();', posEnter),
    '넘어갈 수 있으면 다시 그리기 전에 넘어가야 합니다.');
  // 이름을 고르는 그 순간에도 확인합니다(이미 열려 있는 경우).
  const select = src.slice(src.indexOf('function selectRsvpIdentity'),
    src.indexOf('function liveIdFromUrl'));
  assert(/if\(enterActiveLive\(\)\)return;/.test(select),
    '이미 대진이 열려 있으면 이름을 고른 즉시 넘어가야 합니다.');
  // 아직 준비 중이면 기다리면 된다고 알려 줍니다.
  assert(/대진이 열리면 이 화면에서 바로 들어갑니다/.test(src),
    '준비 중일 때는 기다리면 된다고 알려 줘야 합니다 — 빈 화면은 새로 고치게 만듭니다.');
  console.log('  자동 연결: 선택 시 · 대진이 열릴 때');
}

console.log('rsvp-entry-only-regression: OK');
