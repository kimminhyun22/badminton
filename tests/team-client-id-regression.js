'use strict';
/**
 * 기기 식별자는 **서버가 받아 주는 모양**이어야 합니다 (실전 2026-08-14:
 * 교체를 누르면 "임원 운영 연결을 확인하지 못했습니다").
 *
 * 화면이 만드는 `_teamClientId()` 와 서버가 검사하는 `cleanClientId()` 는 서로
 * 다른 파일에 있어서, 한쪽만 바뀌면 **눌러야 알 수 있는** 종류의 사고가 됩니다.
 * 그래서 두 실물을 같이 돌려 봅니다(픽스처 금지 — [[verify-with-real-markup]]).
 *
 * 실제로 두 갈래가 서버 최소 길이(16자)에 못 미쳤습니다:
 *   · 저장이 막힌 브라우저의 대체값 `'tc_fallback'` = 11자
 *   · `Math.random().toString(36).slice(2,10)` 이 짧게 나오는 드문 경우
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const view = fs.readFileSync(path.join(root, 'js', 'live-view.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8');

function slice(src, a, b){
  const i = src.indexOf(a);
  assert(i >= 0, `시작 표지를 못 찾음: ${a}`);
  const j = src.indexOf(b, i + a.length);
  assert(j > i, `끝 표지를 못 찾음: ${b}`);
  return src.slice(i, j);
}

// 서버의 검사기를 그대로 가져옵니다(던지면 거절이라는 뜻).
const cleanBox = {console};
vm.createContext(cleanBox);
vm.runInContext(`
class HttpsError extends Error{ constructor(code,msg){ super(msg); this.code=code; } }
${slice(index, 'function cleanClientId', 'function cleanOptionalPlayerId')}
this.api={cleanClientId};
`, cleanBox);
const serverAccepts = id => {
  try{ cleanBox.api.cleanClientId(id); return ''; }
  catch(e){ return e.message || '거절'; }
};

// 화면의 생성기를 그대로 가져옵니다. 저장 가능/불가 두 경우를 다 돌립니다.
function makeClientIdFactory(storageWorks){
  const store = {};
  const box = {
    console, Math, Date, String, Number,
    localStorage: storageWorks
      ? {getItem(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
         setItem(k, v){ store[k] = String(v); }}
      : {getItem(){ throw new Error('storage blocked'); }, setItem(){ throw new Error('storage blocked'); }}
  };
  vm.createContext(box);
  vm.runInContext(`
${slice(view, 'let _teamClientIdMemo', 'async function ensureTeamOfficialGrant')}
this.api={_teamClientId, reset(){ _teamClientIdMemo=''; }};
`, box);
  return box.api;
}

// 1) 저장이 되는 보통 브라우저 — 만들어진 값을 서버가 받아야 합니다.
{
  const f = makeClientIdFactory(true);
  const id = f._teamClientId();
  assert.strictEqual(serverAccepts(id), '', `서버가 거절했습니다(${id.length}자): ${id}`);
  assert(id.length >= 16, `16자 이상이어야 합니다: ${id}`);
  assert.strictEqual(f._teamClientId(), id, '같은 기기는 같은 값을 써야 연결이 유지됩니다.');
  console.log(`  보통 브라우저: ${id.length}자 · 서버 통과 · 재호출 동일`);
}

// 2) **저장이 막힌 브라우저**(카톡 인앱·사생활 모드) — 여기가 실제로 터진 자리입니다.
{
  const f = makeClientIdFactory(false);
  const id = f._teamClientId();
  assert.strictEqual(serverAccepts(id), '',
    `저장이 막혀도 서버가 받아야 합니다(${id.length}자): ${id}`);
  assert.strictEqual(f._teamClientId(), id, '한 탭 안에서는 같은 값을 유지해야 합니다.');
  console.log(`  저장 막힌 브라우저: ${id.length}자 · 서버 통과 · 탭 내 동일`);
}

// 3) 무작위가 짧게 나와도 항상 통과해야 합니다 — 확률에 기대면 안 됩니다.
{
  let shortest = Infinity;
  for(let i = 0; i < 500; i += 1){
    const f = makeClientIdFactory(i % 2 === 0);
    const id = f._teamClientId();
    shortest = Math.min(shortest, id.length);
    const why = serverAccepts(id);
    assert.strictEqual(why, '', `${i}번째에서 거절(${id.length}자): ${id} — ${why}`);
  }
  assert(shortest >= 16, `가장 짧게 나온 값도 16자 이상이어야 합니다: ${shortest}`);
  console.log(`  500회 반복: 최소 길이 ${shortest}자 · 전부 통과`);
}

// 4) 옛 짧은 값이 저장돼 있으면 버리고 새로 만들어야 합니다(한 번 막힌 기기 구제).
{
  const store = {};
  const box = {console, Math, Date, String, Number,
    localStorage:{getItem(k){ return store[k] || null; }, setItem(k, v){ store[k] = String(v); }}};
  vm.createContext(box);
  vm.runInContext(`
${slice(view, 'let _teamClientIdMemo', 'async function ensureTeamOfficialGrant')}
this.api={_teamClientId};
`, box);
  store['kokmatch_team_client'] = 'tc_fallback';   // 예전에 저장된 11자
  const id = box.api._teamClientId();
  assert.notStrictEqual(id, 'tc_fallback', '옛 짧은 값을 그대로 쓰면 계속 거절됩니다.');
  assert.strictEqual(serverAccepts(id), '', `새로 만든 값은 통과해야 합니다: ${id}`);
  assert.strictEqual(store['kokmatch_team_client'], id, '새 값을 저장해 둬야 합니다.');
  console.log('  옛 짧은 값: 버리고 새로 발급 · 저장까지');
}

// 5) 연결 실패는 **이유 없이** 뜨면 안 됩니다.
{
  const grant = slice(view, 'async function ensureTeamOfficialGrant', 'function _teamGrantFailMessage');
  assert(/_teamGrantError=/.test(grant), '실패 사유를 담아 둬야 합니다.');
  assert(/서버 연결 모듈이 로드되지 않았습니다/.test(grant),
    'SDK 미로드도 사유로 말해야 합니다 — 조용히 빈 값을 돌려주면 현장에서 알 길이 없습니다.');
  const msg = slice(view, 'function _teamGrantFailMessage', 'async function submitTeamSubstitute');
  assert(/사유: /.test(msg), '팝업이 서버가 준 이유를 붙여 보여줘야 합니다.');
  console.log('  실패 안내: 사유 항상 포함');
}

console.log('\nteam client id regression ok');
