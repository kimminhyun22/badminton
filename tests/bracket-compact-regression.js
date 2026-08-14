'use strict';
/**
 * 전체 대진표 간략판 (운영자 2026-08-12).
 *
 *   "경기가 많아서 세로 스크롤을 많이 해야 하니 간략히 볼 수 있게 해줘
 *    중복제거하고 바둑판식으로 해도 될 것 같아."
 *
 * 큰 카드는 경기마다 청/홍 딱지·VS·종목 칩을 되풀이합니다. 44경기면 그 되풀이가
 * 세로로 열 화면을 넘깁니다.
 *
 * 여기서 지키는 것:
 *   1) 한 경기는 **한 줄**이다 — 큰 카드를 다시 쓰지 않는다
 *   2) 되풀이되는 딱지를 다시 넣지 않는다 (왼쪽이 청, 오른쪽이 홍)
 *   3) 이름은 큰 카드와 **같은 규칙으로** 눌린다 — 지금·다음 라운드의 교체
 *   4) 임원은 여기서도 승패를 고친다. 참가자에게는 버튼이 없다
 *   5) 이름이 잘리지 않는다
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const view = fs.readFileSync(path.join(root, 'js', 'live-view.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'live.css'), 'utf8');
const cut = (a, b) => {
  const i = view.indexOf(a);
  assert(i >= 0, '시작 표지를 못 찾음: ' + a);
  const j = view.indexOf(b, i + a.length);
  assert(j >= 0, '끝 표지를 못 찾음: ' + b);
  return view.slice(i, j);
};

// 1) 전체 대진표는 간략판을 씁니다 — 큰 카드로 되돌리면 안 됩니다.
{
  const render = view.slice(view.indexOf('id="fullBracket"'), view.indexOf('content.innerHTML=html'));
  assert(/buildBracketRow\(m,d\)/.test(render), '전체 대진표는 한 줄짜리 간략판을 써야 합니다.');
  assert(!/buildLiveMatchCard\(m,d/.test(render),
    '전체 대진표에 큰 카드를 다시 쓰면 세로 스크롤이 되돌아옵니다.');
  assert(/class="bracket-grid"/.test(render), '라운드마다 격자로 묶어야 합니다.');
  console.log('  전체 대진표: 간략판 사용');
}

// 2) 되풀이되던 딱지를 다시 넣지 않습니다.
{
  const row = cut('function _bracketSideHtml', 'function _playerLine');
  ['live-team-label', 'live-vs', 'live-type'].forEach(cls => {
    assert(!row.includes(cls), `${cls} 는 경기마다 같은 말을 되풀이합니다 — 자리로 대신합니다.`);
  });
  assert(/bracket-side.*t1.*blue/s.test(row) || /side==='t1'\?'blue':'red'/.test(row),
    '왼쪽이 청, 오른쪽이 홍이라는 자리로 팀을 말해야 합니다.');
  console.log('  중복 제거: 팀 딱지·VS·종목 칩 없음');
}

// 3~4) 실제 함수를 돌려 임원/참가자 두 경우를 확인합니다.
{
  const box = {console, Object, Set, Number, String, Array, JSON, Date, Math};
  vm.createContext(box);
  vm.runInContext(`
    ${cut('function esc(s)', '\n')}
    var CAN_FIX=true, LATE=[];
    function _usesFixedTeams(){ return true; }
    function _isTeamLiveData(){ return true; }
    function _canFixResult(){ return CAN_FIX; }
    function _canSubstitute(){ return CAN_FIX; }
    function _lateOn(n){ return LATE.indexOf(n) >= 0; }
    function _settled(m){ return !!(m && (m.win || m.voided)); }
    ${cut('function _swappableRounds', 'function _playerLine')}
    this.api = {row:buildBracketRow, set(f, l){ CAN_FIX = f; LATE = l || []; }};
  `, box);

  const d = {currentRound: 2, matches: [
    {num: 1, round: 1, court: 1, t1: ['청하나','청두리'], t2: ['홍하나','홍두리'], win: 't1'},
    {num: 5, round: 2, court: 1, t1: ['청세모','청네모'], t2: ['홍세모','홍네모'], win: null},
    {num: 7, round: 3, court: 1, t1: ['청일곱','청여덟'], t2: ['홍일곱','홍여덟'], win: null},
    {num: 9, round: 4, court: 1, t1: ['청다섯','청여섯'], t2: ['홍다섯','홍여섯'], win: null}
  ]};

  box.api.set(true, ['청세모']);
  const asOfficial = d.matches.map(m => box.api.row(m, d));
  assert(asOfficial.every(h => /bracket-pick/.test(h)),
    '임원은 어느 경기에서든 승패를 고칠 수 있어야 합니다.');
  assert(/class="blue on"/.test(asOfficial[0]),
    '이긴 팀이 눌린 상태로 보여야 합니다.');
  assert(/toggleTeamWin\(1,'t1'\)/.test(asOfficial[0]),
    '같은 팀을 다시 누르면 지워지는 토글이어야 합니다.');
  // 교체는 지금·다음 라운드에서만 — 큰 카드와 같은 규칙입니다.
  assert(/bracket-name swap/.test(asOfficial[1]), '지금 라운드 이름은 눌러서 교체할 수 있어야 합니다.');
  assert(/openTeamSubstitutePanel\(5,/.test(asOfficial[1]), '그 경기·그 선수로 시트가 열려야 합니다.');
  // 2026-08-14 임원 재량 교체: 제외 표시가 없어도 지금·다음 라운드면 눌립니다.
  assert(/bracket-name swap/.test(asOfficial[2]), '다음 라운드 이름도 제외 표시 없이 눌려야 합니다.');
  assert(!/bracket-name swap/.test(asOfficial[0]), '끝난 경기는 교체 대상이 아닙니다.');
  assert(!/bracket-name swap/.test(asOfficial[3]), '먼 라운드는 교체 범위 밖입니다.');

  box.api.set(false, ['청세모']);
  const asMember = d.matches.map(m => box.api.row(m, d));
  assert(asMember.every(h => !/bracket-pick/.test(h)),
    '참가자에게는 승패 버튼이 없어야 합니다.');
  assert(asMember.every(h => !/swap/.test(h)),
    '참가자는 교체할 수 없습니다.');
  assert(/bracket-result done">청</.test(asMember[0]),
    '참가자에게는 결과를 글자로 보여 줘야 합니다.');
  console.log('  임원/참가자: 승패 토글 · 교체 범위 · 읽기 전용');
}

// 5) 촘촘해도 손가락과 눈이 견디는 크기여야 합니다.
{
  const chip = (css.match(/\.bracket-pick button\{[^}]*\}/) || [''])[0];
  const min = Number((chip.match(/min-height:(\d+)px/) || [])[1] || 0);
  assert(min >= 36, `승패 칩이 ${min}px 입니다 — 잘못 누르면 승패가 바뀝니다. 36px 이상.`);
  const name = (css.match(/\.bracket-name\{[^}]*\}/) || [''])[0];
  assert(/text-overflow:ellipsis/.test(name), '이름이 넘치면 말줄임으로 처리해야 합니다.');
  assert(/white-space:nowrap/.test(name), '이름은 한 줄로 둬야 줄 높이가 흔들리지 않습니다.');
  // 진 쪽 회색이 지각 표시를 덮어쓰면 누가 늦었는지 안 보입니다.
  assert(/\.bracket-side\.lost \.bracket-name\.late\{color:#b45309;\}/.test(css.replace(/\s+/g, ' ').replace(/, /g, ','))
    || /\.bracket-name\.late,\.bracket-side\.lost \.bracket-name\.late\{/.test(css),
    '진 쪽 회색이 지각 색을 덮으면 안 됩니다.');
  console.log('  크기: 승패 칩 36px · 이름 말줄임 · 지각 색 우선');
}

console.log('bracket-compact-regression: OK');
