'use strict';
/**
 * 대체 투입의 **문**과 **범위** (운영자 2026-08-14).
 *
 *   "대진표의 지각자를 눌러서 선수교체하는 방식으로 처리해.
 *    지각자는 어쨌든 오고 있는 사람이니까 모든 경기를 대체할 필요 없어.
 *    지각에서 불참으로 변경되는 경우도 대체선수 투입하는 방식으로"
 *
 * 여기서 고정하는 것:
 *   1) 지각은 **지금 라운드만** — 오고 있는 사람의 뒷 경기까지 갈아치우지 않는다
 *   2) 불참은 **남은 경기 전부** — 안 오는 사람이다
 *   3) 끝난 경기·권한 없는 사람에게는 문이 열리지 않는다
 *   4) 이름은 `<div role=button>` 이어야 한다 — `<button>` 은 이름 글꼴을 흐트러뜨린다
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'live-view.js'), 'utf8');
function cut(a, b){
  const i = src.indexOf(a);
  assert(i >= 0, `시작 표지를 못 찾음: ${a}`);
  const j = src.indexOf(b, i + a.length);
  assert(j > i, `끝 표지를 못 찾음: ${b}`);
  return src.slice(i, j);
}

const sandbox = {console, Object, Set, Number, String, Array, JSON, window: {}, canOperate: true};
vm.createContext(sandbox);
vm.runInContext(`
${cut('function esc(s)', '\n')}
function _canSubstitute(){ return canOperate; }
${cut('function _attKey(name)', 'function _lateMapFromData')}
${cut('function _replaceableInMatch', 'function buildLiveMatchCard')}
${cut('function _substituteHintHtml', 'function openTeamSubstitutePanel')}
this.api={_replaceableInMatch,_playerLine,_pendingSubstitutions,_substituteHintHtml,
  _attendanceState,_attendanceLabel,_attendanceCycleLabel,
  setLate(map){ window._liveLate = map; }, setOperate(v){ canOperate = v; }};
`, sandbox);
const api = sandbox.api;

const attKey = n => encodeURIComponent(n).replace(/[.#$[\]/']/g, '_');
const M = (num, round, court, t1, t2, win) => ({num, round, court, t1, t2, win: win || null});
const d = {
  currentRound: 1,
  matches: [
    M(1, 1, 1, ['청하나', '지각이'], ['홍하나', '홍두리']),
    M(2, 1, 2, ['청세찌', '불참이'], ['홍세찌', '홍너리']),
    M(3, 2, 1, ['청하나', '지각이'], ['홍세찌', '불참이'])
  ]
};
api.setLate({
  [attKey('지각이')]: {name: '지각이', status: 'late'},
  [attKey('불참이')]: {name: '불참이', status: 'absent'}
});

// 1) 지각은 지금 라운드만. 뒷 라운드는 그냥 둔다 — 오고 있는 사람이다.
{
  assert.strictEqual(api._replaceableInMatch(d, d.matches[0], '지각이'), true,
    '지금 라운드의 지각자는 교체할 수 있어야 합니다.');
  assert.strictEqual(api._replaceableInMatch(d, d.matches[2], '지각이'), false,
    '다음 라운드까지 미리 갈아치우면 안 됩니다 — 오고 있는 사람입니다.');
  console.log('  지각: 지금 라운드만');
}

// 2) 불참은 남은 경기 전부.
{
  assert.strictEqual(api._replaceableInMatch(d, d.matches[1], '불참이'), true,
    '지금 라운드의 불참자는 교체 대상입니다.');
  assert.strictEqual(api._replaceableInMatch(d, d.matches[2], '불참이'), true,
    '불참자는 남은 경기 전부가 교체 대상이어야 합니다 — 안 오는 사람입니다.');
  console.log('  불참: 남은 경기 전부');
}

// 3) 끝난 경기 · 출결 표시 없는 사람 · 권한 없는 사람에게는 문이 없습니다.
{
  assert.strictEqual(api._replaceableInMatch(d, {...d.matches[0], win: 't1'}, '지각이'), false,
    '결과가 입력된 경기는 교체 대상이 아닙니다.');
  assert.strictEqual(api._replaceableInMatch(d, d.matches[0], '청하나'), false,
    '출결 표시가 없는 선수는 교체 대상이 아닙니다.');
  api.setOperate(false);
  assert.strictEqual(api._replaceableInMatch(d, d.matches[0], '지각이'), false,
    '임원이 아니면 이름이 눌려서는 안 됩니다.');
  api.setOperate(true);
  console.log('  끝난 경기 · 정상 출석 · 일반 회원: 문 없음');
}

// 4) 세어 보면 지금 라운드 2자리 + 불참자의 다음 라운드 1자리 = 3.
{
  const pending = api._pendingSubstitutions(d);
  assert.strictEqual(pending.length, 3, `메울 자리 수가 규칙과 같아야 합니다: ${JSON.stringify(pending)}`);
  const names = pending.map(p => `${p.num}:${p.name}`).sort();
  assert.deepEqual(names, ['1:지각이', '2:불참이', '3:불참이'],
    '지각은 지금 라운드 한 자리, 불참은 두 경기 모두여야 합니다.');
  console.log(`  메울 자리 ${pending.length}곳 (지각 1 · 불참 2)`);
}

// 5) 이름 마크업 — 눌리는 이름과 안 눌리는 이름의 **클래스가 같아야** 모양이 안 갈라집니다.
{
  const tappable = api._playerLine('지각이', d, d.matches[0]);
  const plain = api._playerLine('청하나', d, d.matches[0]);
  assert(/role="button"/.test(tappable), '지각자 이름은 버튼 역할이어야 합니다.');
  assert(/tabindex="0"/.test(tappable) && /onkeydown=/.test(tappable), '키보드로도 열려야 합니다.');
  assert(/openTeamSubstitutePanel\(1,/.test(tappable), '그 경기 번호를 실어야 합니다.');
  assert(!/<button/.test(tappable),
    '이름을 <button> 으로 만들면 !important 글꼴 규칙과 싸워 크기가 흐트러집니다.');
  assert(/class="live-player not-ready swap"/.test(tappable), `클래스 조합: ${tappable}`);
  assert(/class="live-player"/.test(plain), '평범한 이름은 그대로여야 합니다.');
  assert(!/role="button"/.test(plain), '평범한 이름은 눌리면 안 됩니다.');

  const out = api._playerLine('불참이', d, d.matches[1]);
  assert(/is-out/.test(out), '불참은 눈에 다르게 보여야 합니다.');
  assert(/불참 · 교체/.test(out), '무엇을 할 수 있는지 이름 옆에 적어야 합니다.');
  console.log('  이름 마크업: div+role · 같은 클래스 · 불참 표시');
}

// 6) 안내 한 줄 — 버튼이 아니어야 합니다(누를 곳은 대진표의 이름 하나뿐).
{
  const hint = api._substituteHintHtml(d);
  assert(/대진표에서 이름을 누르면/.test(hint), '어디를 눌러야 하는지 말해야 합니다.');
  assert(!/<button/.test(hint), '여기에 버튼을 두면 진입점이 둘이 됩니다.');
  api.setOperate(false);
  assert.strictEqual(api._substituteHintHtml(d), '', '일반 회원에게는 안내도 뜨지 않습니다.');
  api.setOperate(true);
  console.log('  안내: 문구만 · 임원에게만');
}

// 7) 출결 3단계 — 버튼에는 **다음에 될 상태**를 적습니다.
{
  assert.strictEqual(api._attendanceState('청하나'), '');
  assert.strictEqual(api._attendanceState('지각이'), 'late');
  assert.strictEqual(api._attendanceState('불참이'), 'absent');
  assert.strictEqual(api._attendanceCycleLabel('청하나'), '지각');
  assert.strictEqual(api._attendanceCycleLabel('지각이'), '불참으로');
  assert.strictEqual(api._attendanceCycleLabel('불참이'), '도착 확인');
  console.log('  출결 순환: 지각 → 불참으로 → 도착 확인');
}

console.log('\nteam substitute entry regression ok');
