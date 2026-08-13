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
  _substituteCandidates,_balanceMark,_balanceGapAfter,_balanceAfter,_isMatchUnderway,
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

  // 2026-08-12: 상태(제외)와 할 일(교체)을 한 배지에 함께 적습니다.
  assert(/제외 · 교체/.test(tappable), '무엇을 할 수 있는지 이름 옆에 적어야 합니다.');
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

// 8) 급수 밸런스와 **교체 패널티** (운영자 2026-08-14).
//    "급수 차가 1 이상 나면 승부가 기울어"
//    "교체는 팀 패널티인데 패널티를 받는 팀이 교체로 더 유리해지는 것은 불합리"
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
  // 부호가 방향을 말합니다: 양수 = 교체한 팀이 셈, 음수 = 약해짐.
  assert.strictEqual(byName['청넷'].balance, 0, '6+4=10 vs 10 이면 균형입니다.');
  assert.strictEqual(byName['청둘'].balance, -2, '6+2=8 vs 10 이면 우리가 2 약합니다.');
  assert.strictEqual(byName['청일곱'].balance, 3, '6+7=13 vs 10 이면 우리가 3 셉니다.');
  assert.strictEqual(cands[0].name, '청넷',
    `0 에 가장 가까운 사람이 먼저여야 합니다: ${cands.map(c => c.name + '(' + c.balance + ')')}`);
  // 같은 크기면 **덜 유리한 쪽**(음수)이 먼저 — 사람이 빠진 팀이 이득 보면 불합리.
  assert(cands.indexOf(byName['청둘']) < cands.indexOf(byName['청일곱']),
    `약해지는 쪽이 세지는 쪽보다 먼저여야 합니다: ${cands.map(c => c.name)}`);
  const cross = cands.find(c => c.crossTeam);
  assert(cands.indexOf(cross) > cands.indexOf(byName['청넷']),
    '상대 팀은 균형이 좋아도 같은 팀 뒤에 옵니다.');

  // 표기 — 「기욺」 같은 말 대신 부호와 색으로(운영자 2026-08-14).
  assert.strictEqual(api._balanceMark({balance:0}).text, '균형');
  assert.strictEqual(api._balanceMark({balance:2}).text, '+2', '세지면 + 로 적습니다.');
  assert.strictEqual(api._balanceMark({balance:2}).cls, 'over', '+ 는 빨강입니다.');
  assert.strictEqual(api._balanceMark({balance:-2}).text, '−2', '약해지면 − 로 적습니다.');
  assert.strictEqual(api._balanceMark({balance:-2}).cls, 'under', '− 는 파랑입니다.');
  assert(!/기욺|강해짐/.test([api._balanceMark({balance:3}).text,
    api._balanceMark({balance:-3}).text].join(' ')), '헷갈리는 말은 쓰지 않습니다.');

  api.setLate({
    [attKey('지각이')]: {name: '지각이'},
    [attKey('불참이')]: {name: '불참이', status: 'absent'}
  });
  console.log('  급수 밸런스: 0 우선 · 같은 크기면 음수 먼저 · +빨강/−파랑');
}

// 9) 같은 라운드에 이미 뛰는(또는 뛴) 사람은 후보가 아닙니다
//    (운영자 2026-08-14 "교체 인원은 해당 라운드에 뛰는 선수는 아니겠지?").
//    **끝난 경기도 셉니다** — 방금 1코트에서 뛰고 나온 사람을 2코트에 넣으면
//    그 라운드에 두 경기를 뛰고, 그만큼 남의 경기를 가져갑니다.
{
  const round = {
    currentRound: 1,
    members: {
      blue: [{id:'b1',n:'청A',l:4},{id:'b2',n:'지각',l:4},{id:'b3',n:'진행중',l:4},
             {id:'b4',n:'방금끝남',l:4},{id:'b5',n:'쉬는중',l:4},{id:'b6',n:'다음라운드',l:4}],
      red: [{id:'r1',n:'홍A',l:4},{id:'r2',n:'홍B',l:4},{id:'r3',n:'홍C',l:4},{id:'r4',n:'홍D',l:4}],
      all: []
    },
    matches: [
      M(1, 1, 1, ['청A', '지각'], ['홍A', '홍B']),
      M(2, 1, 2, ['진행중', '홍C'], ['홍D', '청A']),
      M(3, 1, 3, ['방금끝남', '홍A'], ['홍B', '홍C'], 't1'),   // 같은 라운드 · 이미 끝남
      M(4, 2, 1, ['다음라운드', '쉬는중'], ['홍A', '홍B'])      // 다음 라운드
    ]
  };
  api.setLate({[attKey('지각')]: {name: '지각'}});
  const names = api._substituteCandidates(round, round.matches[0], '지각').map(c => c.name);
  assert(!names.includes('진행중'), '지금 다른 코트에서 뛰는 사람은 후보가 아닙니다.');
  assert(!names.includes('방금끝남'),
    `같은 라운드에서 이미 뛴 사람도 후보가 아닙니다: ${names.join(', ')}`);
  assert(names.includes('쉬는중'), '그 라운드에 안 뛰는 사람은 후보여야 합니다.');
  assert(names.includes('다음라운드'), '다음 라운드에만 있는 사람은 지금 라운드에 넣을 수 있습니다.');

  // **다음 대진을 미리 교체할 때도 같은 규칙** (운영자 2026-08-14 "다음 대진선수
  // 교체도 마찬가지"). 이때 기준은 **그 경기가 속한 라운드**여야 합니다.
  api.setLate({[attKey('다음라운드')]: {name: '다음라운드'}});
  const nextNames = api._substituteCandidates(round, round.matches[3], '다음라운드').map(c => c.name);
  assert(!nextNames.includes('쉬는중'),
    `2라운드 경기에 그 라운드에서 이미 뛰는 사람을 넣으면 안 됩니다: ${nextNames.join(', ')}`);
  assert(nextNames.includes('진행중'),
    '1라운드에서 뛰는 사람은 2라운드 경기에는 넣을 수 있어야 합니다.');
  assert(nextNames.includes('방금끝남'), '1라운드에서 끝난 사람도 2라운드에는 넣을 수 있습니다.');

  api.setLate({
    [attKey('지각이')]: {name: '지각이'},
    [attKey('불참이')]: {name: '불참이', status: 'absent'}
  });
  console.log(`  같은 라운드 이중 출전: 진행 중·이미 끝남 모두 제외 (후보 ${names.join(', ')})`);
}

// 10) 다음 대진을 미리 손볼 때 "이미 시작한 경기" 팝업이 뜨면 안 됩니다
//     (운영자 2026-08-14 실기기). `startAt` 은 코트 차례가 된 시각이라 다음 라운드에도 붙습니다.
{
  const live = {currentRound: 1};
  const nowPlaying = {num: 1, round: 1, court: 1, startAt: 1000};
  const upNext = {num: 2, round: 2, court: 1, startAt: 1000};
  const notYet = {num: 3, round: 2, court: 2};
  assert.strictEqual(api._isMatchUnderway(live, nowPlaying), true,
    '지금 라운드에서 코트에 올라간 경기는 진행 중입니다.');
  assert.strictEqual(api._isMatchUnderway(live, upNext), false,
    '다음 라운드 경기는 코트가 비었을 뿐 아직 진행 중이 아닙니다.');
  assert.strictEqual(api._isMatchUnderway(live, notYet), false, 'startAt 이 없으면 아닙니다.');
  assert.strictEqual(api._isMatchUnderway({currentRound: 2}, upNext), true,
    '그 라운드가 되면 진행 중입니다.');
  // 옛 게시본(currentRound 없음)은 예전처럼 startAt 만 봅니다.
  assert.strictEqual(api._isMatchUnderway({}, upNext), true, '옛 데이터는 보수적으로 봅니다.');
  console.log('  시작 판정: 지금 라운드만 · 옛 데이터 보수적');
}

console.log('\nteam substitute entry regression ok');
