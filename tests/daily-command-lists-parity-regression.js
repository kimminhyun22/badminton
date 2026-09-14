'use strict';
/**
 * 임원 명령 목록 대조 — 명령 하나가 서버·관리자·임원 화면의 목록을 모두 지나야 한다.
 *
 * 2026-09-13 실배포: 관리자 쪽 라우팅 배열 하나를 빠뜨려, 서버는 임원의 「대진 게시」를
 * 적용했는데 관리자 화면 리비전이 멈췄다(「서버 운영 기록 일부를 관리자 원본에 연결하지
 * 못했습니다」). 단위 테스트는 엔진만 봐서 못 잡았다. 그 뒤로 새 명령을 넣을 때마다 이
 * 목록들을 사람이 세어야 했다 — 이 검사가 그 일을 대신한다.
 *
 *   서버    ① SUPPORTED_TYPES          ② applyByType 분기 (되돌리기 둘은 applyUndo 경로)
 *   관리자  ③ _dailyOfficialRequestError (서버 적용분 재검사 — 모르면 「지원하지 않는」)
 *           ④ dailyProcessCheckinRequests (재생 — 모르면 조용히 흘려보냄)
 *           ⑤ 그 안의 라우팅 배열 → ⑥ _dailyApplyAdminOperation 분기 (⑤ = ⑥)
 *   임원    ⑦ checkin.html 이 보내는 type 은 전부 ①에 있어야 한다
 *           ⑧ 관리자 전용이 아닌 명령은 임원 화면에 입구가 있어야 한다 (예외는 아래 표에 이유와 함께)
 *   정지    ⑨ 정지 중 막는 명령: 관리자 목록 = 임원 화면 목록, 둘 다 서버 PAUSED_FLOW_TYPES 의 부분집합
 *
 * 훼손 시험용: PARITY_ROOT=<다른 사본 경로> 로 사본을 검사할 수 있다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = process.env.PARITY_ROOT || path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const engine = read('functions/daily-official-engine.js');
const daily = read('js/daily.js');
const checkin = read('checkin.html');

// 임원 화면에 입구가 없어도 되는 명령과 그 이유. 늘릴 때는 이유를 반드시 적는다.
const OFFICIAL_SCREEN_EXEMPT = {
  'official-reservation-promote': '회원 게임신청을 대진으로 올리는 관리자 화면 동작(임원 화면은 파트너 예약으로 직접 짠다)'
};

const stripComments = src => src.replace(/\/\/[^\n]*/g, '');
const quotedTypes = src => new Set((stripComments(src).match(/'official-[a-z-]+'/g) || []).map(s => s.slice(1, -1)));
const sorted = set => [...set].sort();
const minus = (a, b) => sorted(a).filter(x => !b.has(x));

function slice(src, startMarker, endMarker, label){
  const i = src.indexOf(startMarker);
  assert(i >= 0, `${label}: 시작 표지를 못 찾았습니다 — ${startMarker} (구조가 바뀌었으면 이 검사도 함께 고치세요)`);
  const j = src.indexOf(endMarker, i + startMarker.length);
  assert(j > i, `${label}: 끝 표지를 못 찾았습니다 — ${endMarker}`);
  return src.slice(i, j);
}
function fnBody(src, name){
  const start = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(src);
  assert(start, `함수 ${name} 를 못 찾았습니다 (이름이 바뀌었으면 이 검사도 함께 고치세요)`);
  const tail = src.slice(start.index + start[0].length);
  const next = /\n(?:async )?function [A-Za-z_$]/.exec(tail);
  return tail.slice(0, next ? next.index : tail.length);
}
// req.type==='x' 분기와 [...].includes(req.type) 배열에 든 명령만 센다(주석·문구 속 이름은 세지 않는다).
function dispatched(body, subject){
  const out = new Set();
  const eq = new RegExp(`${subject}\\s*===\\s*'(official-[a-z-]+)'`, 'g');
  for(const m of body.matchAll(eq))out.add(m[1]);
  const inc = new RegExp(`\\[([^\\[\\]]*?)\\]\\s*\\.includes\\(\\s*${subject}\\s*\\)`, 'g');
  for(const m of body.matchAll(inc))quotedTypes(m[1]).forEach(t => out.add(t));
  return out;
}

// ── 서버 ──────────────────────────────────────────────
const supported = quotedTypes(slice(engine, 'const SUPPORTED_TYPES', ']);', 'SUPPORTED_TYPES'));
assert(supported.size >= 30, `SUPPORTED_TYPES 를 제대로 읽지 못했습니다(${supported.size}종)`);
const cases = new Set([...fnBody(engine, 'applyByType').matchAll(/case\s+'(official-[a-z-]+)'\s*:/g)].map(m => m[1]));
const undoMatch = /\[([^\[\]]+)\]\.includes\(request\.type\)\)\{\s*const undone = applyUndo\(/.exec(engine);
assert(undoMatch, '엔진의 되돌리기 경로(applyUndo 앞 배열)를 못 찾았습니다');
const undoTypes = quotedTypes(undoMatch[1]);
const serverDispatched = new Set([...cases, ...undoTypes]);
assert.deepStrictEqual(minus(supported, serverDispatched), [],
  `② 서버가 받는다고 해 놓고 처리 분기가 없는 명령: ${minus(supported, serverDispatched)} — applyByType 에 case 를 넣으세요.`);
assert.deepStrictEqual(minus(serverDispatched, supported), [],
  `① 처리 분기는 있는데 SUPPORTED_TYPES 에 없어 「지원하지 않는 임원 운영 요청」으로 거절되는 명령: ${minus(serverDispatched, supported)}`);
const adminOnly = quotedTypes(slice(engine, 'const adminOnlyCommand = [', '].includes(request.type)', 'adminOnlyCommand'));
console.log(`  서버: 명령 ${supported.size}종 (되돌리기 ${undoTypes.size} · 관리자 전용 ${adminOnly.size})`);

// ── 관리자 화면 ────────────────────────────────────────
const recheck = dispatched(fnBody(daily, '_dailyOfficialRequestError'), 'req\\.type');
assert.deepStrictEqual(minus(supported, recheck), [],
  `③ 서버가 적용해도 관리자 재검사가 「지원하지 않는」으로 떨어뜨리는 명령: ${minus(supported, recheck)} — _dailyOfficialRequestError 에 넣으세요. 이 상태면 관리자 동기화가 통째로 멈춥니다.`);
assert.deepStrictEqual(minus(recheck, supported), [],
  `③ 관리자 재검사에만 있고 서버에는 없는 명령(죽은 분기): ${minus(recheck, supported)}`);

const replayBody = fnBody(daily, 'dailyProcessCheckinRequests');
const replay = dispatched(replayBody, 'req\\.type');
assert.deepStrictEqual(minus(supported, replay), [],
  `④ 서버가 적용해도 관리자 재생이 흘려보내는 명령: ${minus(supported, replay)} — dailyProcessCheckinRequests 에 인라인 처리를 넣거나 라우팅 배열에 올리세요. 리비전이 멈춥니다(2026-09-13).`);

const routeMatch = /\[([^\[\]]*?)\]\s*\.includes\(\s*req\.type\s*\)\s*\)\s*\{\s*const ok\s*=\s*_dailyApplyAdminOperation\(req\)/.exec(replayBody);
assert(routeMatch, '⑤ _dailyApplyAdminOperation 으로 보내는 라우팅 배열을 못 찾았습니다');
const routed = quotedTypes(routeMatch[1]);
const handled = dispatched(fnBody(daily, '_dailyApplyAdminOperation'), 'req\\.type');
assert.deepStrictEqual(minus(routed, handled), [],
  `⑥ 라우팅은 되는데 _dailyApplyAdminOperation 에 처리 분기가 없는 명령: ${minus(routed, handled)}`);
assert.deepStrictEqual(minus(handled, routed), [],
  `⑤ 처리 분기는 만들었는데 라우팅 배열에 없어 한 번도 불리지 않는 명령: ${minus(handled, routed)} — 「만들었다」와 「닿는다」는 다릅니다.`);
assert.deepStrictEqual(minus(routed, supported), [], `⑤ 서버에 없는 명령을 라우팅합니다: ${minus(routed, supported)}`);
console.log(`  관리자: 재검사 ${recheck.size} · 재생 ${replay.size} · 라우팅=처리 ${routed.size}`);

// ── 임원 화면 ─────────────────────────────────────────
const sent = new Set([
  ...[...checkin.matchAll(/type\s*:\s*'(official-[a-z-]+)'/g)].map(m => m[1]),
  ...[...checkin.matchAll(/'(official-[a-z-]+-undo)'/g)].map(m => m[1])
]);
assert(sent.size >= 25, `임원 화면의 전송 type 을 제대로 읽지 못했습니다(${sent.size}종)`);
assert.deepStrictEqual(minus(sent, supported), [],
  `⑦ 임원 화면이 보내는데 서버가 모르는 명령: ${minus(sent, supported)}`);
const checkinMentions = quotedTypes(checkin);
const needEntry = new Set(sorted(supported).filter(t => !adminOnly.has(t) && !OFFICIAL_SCREEN_EXEMPT[t]));
assert.deepStrictEqual(minus(needEntry, checkinMentions), [],
  `⑧ 임원에게 열린 명령인데 임원 화면에 입구가 없습니다: ${minus(needEntry, checkinMentions)} — 입구를 만들거나 OFFICIAL_SCREEN_EXEMPT 에 이유와 함께 적으세요.`);
Object.keys(OFFICIAL_SCREEN_EXEMPT).forEach(t => assert(supported.has(t), `예외 표의 ${t} 는 이제 서버에 없습니다 — 표에서 지우세요.`));
console.log(`  임원 화면: 전송 ${sent.size}종, 입구 필요 ${needEntry.size}종 모두 있음 (예외 ${Object.keys(OFFICIAL_SCREEN_EXEMPT).length})`);
// ── 일시정지 분류 ─────────────────────────────────────
// 정지 중 막을 명령 목록이 관리자·임원 화면에 두 벌 있다. 둘이 다르면 한쪽 화면만 버튼을 막는다.
// 서버는 이보다 넓게 막는다(2026-09-14 기준 서버 23종 · 화면 13종 — 나머지는 누르면 서버가 거절, BACKLOG).
const pausedServer = quotedTypes(slice(engine, 'const PAUSED_FLOW_TYPES', ']);', 'PAUSED_FLOW_TYPES'));
const pausedAdmin = quotedTypes(fnBody(daily, '_dailyFlowOperationType'));
const pausedOfficial = quotedTypes(fnBody(checkin, 'officialFlowOperationType'));
assert(pausedAdmin.size >= 10 && pausedServer.size >= 10, `일시정지 분류를 제대로 읽지 못했습니다(관리자 ${pausedAdmin.size} · 서버 ${pausedServer.size})`);
assert.deepStrictEqual(sorted(pausedAdmin), sorted(pausedOfficial),
  `⑨ 정지 중 막는 명령이 두 화면에서 다릅니다 — 관리자만: ${minus(pausedAdmin, pausedOfficial)} · 임원 화면만: ${minus(pausedOfficial, pausedAdmin)}`);
assert.deepStrictEqual(minus(pausedAdmin, pausedServer), [],
  `⑨ 화면은 정지 중 막는데 서버는 받는 명령: ${minus(pausedAdmin, pausedServer)}`);
console.log(`  일시정지 분류: 두 화면 ${pausedAdmin.size}종 일치, 서버 ${pausedServer.size}종에 포함`);
console.log('daily-command-lists-parity-regression: ok');
