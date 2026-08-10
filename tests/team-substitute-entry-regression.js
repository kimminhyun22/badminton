'use strict';
/**
 * 대체 투입의 **문**과 **범위** (운영자 2026-08-14).
 *
 *   "대진표의 지각자를 눌러서 선수교체하는 방식으로 처리해.
 *    지각자는 어쨌든 오고 있는 사람이니까 모든 경기를 대체할 필요 없어."
 *   "불참이라 해도 완전 대체할 사람은 없으니 지각자와 다를 바 없는 것 같아."
 *   "당장 코트에 투입하는 경우뿐 아니라 다음 대진에서도 미리 처리할 수 있어야 해."
 *
 * 여기서 고정하는 것:
 *   1) 출결은 **지각 하나** — 불참을 따로 두지 않는다(벤치가 얇아 실익이 없다)
 *   2) 교체는 **지금 라운드 + 다음 라운드** — 미리 손볼 수 있되, 먼 경기는 열지 않는다
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
${cut('function _swappableRounds', 'function buildLiveMatchCard')}
${cut('function _allLiveMembers', 'function _viewerInfo')}
${cut('function _normalizeMembers', 'function _viewerInfo')}
${cut('function _teamOfName', 'async function submitTeamSubstitute')}
${cut('function _substituteHintHtml', 'function openTeamSubstitutePanel')}
this.api={_replaceableInMatch,_playerLine,_pendingSubstitutions,_substituteHintHtml,_lateOn,_swappableRounds,
  _substituteCandidates,_balanceLabel,_balanceGapAfter,
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
    M(3, 2, 1, ['청하나', '지각이'], ['홍세찌', '불참이']),
    M(4, 3, 1, ['청하나', '지각이'], ['홍하나', '홍두리'])
  ]
};
api.setLate({
  [attKey('지각이')]: {name: '지각이'},
  // 옛 데이터에 남아 있는 status 칸은 그냥 무시하고 지각으로 봅니다.
  [attKey('불참이')]: {name: '불참이', status: 'absent'}
});

// 1) 지금 라운드와 **다음 라운드**까지. 그 뒤는 열지 않는다.
{
  assert.strictEqual(api._replaceableInMatch(d, d.matches[0], '지각이'), true,
    '지금 라운드의 지각자는 교체할 수 있어야 합니다.');
  assert.strictEqual(api._replaceableInMatch(d, d.matches[2], '지각이'), true,
    '다음 대진도 미리 처리할 수 있어야 합니다.');
  assert.strictEqual(api._replaceableInMatch(d, d.matches[3], '지각이'), false,
    '그 뒤 라운드까지 미리 갈아치울 필요는 없습니다 — 오고 있는 사람입니다.');
  console.log('  교체 범위: 지금 + 다음 라운드');
}

// 2) 출결은 한 가지뿐 — 옛 데이터의 `status:absent` 도 그냥 지각으로 봅니다.
{
  assert.strictEqual(api._lateOn('불참이'), true, '옛 status 칸이 있어도 지각으로 봐야 합니다.');
  assert.strictEqual(api._replaceableInMatch(d, d.matches[1], '불참이'), true,
    '지금 라운드면 교체 대상입니다.');
  assert.strictEqual(api._replaceableInMatch(d, d.matches[3], '불참이'), false,
    '불참을 따로 두지 않으므로 먼 라운드는 대상이 아닙니다.');
  console.log('  출결 한 가지: 옛 불참 표시도 지각으로');
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

// 4) 세어 보면 지금 라운드 두 자리 + 다음 라운드 두 자리 = 4.
{
  const pending = api._pendingSubstitutions(d);
  assert.strictEqual(pending.length, 4, `메울 자리 수가 규칙과 같아야 합니다: ${JSON.stringify(pending)}`);
  const names = pending.map(p => `${p.num}:${p.name}`).sort();
  assert.deepEqual(names, ['1:지각이', '2:불참이', '3:불참이', '3:지각이'],
    '지금·다음 라운드의 자리여야 합니다(3라운드는 빠집니다).');
  console.log(`  메울 자리 ${pending.length}곳 (지금 + 다음)`);
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

  assert(/지각 · 교체/.test(tappable), '무엇을 할 수 있는지 이름 옆에 적어야 합니다.');
  assert(!/불참/.test(tappable), '불참 표기는 더 이상 쓰지 않습니다.');
  console.log('  이름 마크업: div+role · 같은 클래스 · 지각 표시');
}

// 6) 안내 한 줄 — 버튼이 아니어야 합니다(누를 곳은 대진표의 이름 하나뿐).
{
  const hint = api._substituteHintHtml(d);
  assert(/지금·다음 대진에서 이름을 누르면/.test(hint),
    '지금뿐 아니라 다음 대진도 미리 손볼 수 있다고 말해야 합니다.');
  assert(!/<button/.test(hint), '여기에 버튼을 두면 진입점이 둘이 됩니다.');
  api.setOperate(false);
  assert.strictEqual(api._substituteHintHtml(d), '', '일반 회원에게는 안내도 뜨지 않습니다.');
  api.setOperate(true);
  console.log('  안내: 문구만 · 임원에게만');
}

// 7) 출결은 켜고 끄는 하나입니다.
{
  assert.strictEqual(api._lateOn('청하나'), false);
  assert.strictEqual(api._lateOn('지각이'), true);
  console.log('  출결: 지각 하나 (켜기/끄기)');
}

// 8) 급수 밸런스 — 넣고 난 뒤 경기가 덜 기우는 사람이 먼저 와야 합니다
//    (운영자 2026-08-14 "아무나 투입하면 상대에겐 불공정한 게임이 되잖아").
{
  const bal = {
    currentRound: 1,
    members: {
      blue: [{id:'b1',n:'청여섯',l:6},{id:'b2',n:'지각넷',l:4},{id:'b3',n:'청넷',l:4},
             {id:'b4',n:'청둘',l:2},{id:'b5',n:'청일곱',l:7}],
      red: [{id:'r1',n:'홍여섯',l:6},{id:'r2',n:'홍넷',l:4},{id:'r3',n:'홍둘',l:2}],
      all: []
    },
    matches: [M(1, 1, 1, ['청여섯', '지각넷'], ['홍여섯', '홍넷'])]
  };
  api.setLate({[attKey('지각넷')]: {name: '지각넷'}});
  const cands = api._substituteCandidates(bal, bal.matches[0], '지각넷');
  const byName = Object.fromEntries(cands.map(c => [c.name, c]));
  // 청여섯(6) + X  vs  홍여섯(6)+홍넷(4)=10
  assert.strictEqual(byName['청넷'].balanceGap, 0, '6+4=10 이면 딱 맞습니다.');
  assert.strictEqual(byName['청둘'].balanceGap, 2, '6+2=8 이면 2 차이입니다.');
  assert.strictEqual(byName['청일곱'].balanceGap, 3, '6+7=13 이면 3 차이입니다.');
  assert.strictEqual(cands[0].name, '청넷',
    `가장 안 기우는 사람이 먼저여야 합니다: ${cands.map(c => c.name + '(' + c.balanceGap + ')')}`);
  const cross = cands.find(c => c.crossTeam);
  assert(cands.indexOf(cross) > cands.indexOf(byName['청일곱']),
    '상대 팀은 균형이 좋아도 같은 팀 뒤에 옵니다.');
  assert.strictEqual(api._balanceLabel(0), '균형');
  assert.strictEqual(api._balanceLabel(3), '±3 기욺', '크게 기울면 눈에 띄게 적어야 합니다.');
  api.setLate({
    [attKey('지각이')]: {name: '지각이'},
    [attKey('불참이')]: {name: '불참이', status: 'absent'}
  });
  console.log('  급수 밸런스: 균형 0 우선 · 기욺 표시 · 상대 팀은 뒤로');
}

console.log('\nteam substitute entry regression ok');
