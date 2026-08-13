'use strict';
/**
 * 진행 속도 · 남은 시간 (운영자 2026-08-12).
 *
 *   "예상 시간이 지금 예상 시간이 있는 거니까 라운드 진행할 때마다 남은 시간
 *    계산할 수 있을 것 같거든? 그래서 언제쯤 끝날 것 같은지."
 *
 * 여기서 지키는 것:
 *   1) 끝난 라운드가 있으면 **실제로 걸린 시간**으로 잰다 — 점수제 어림값이 아니라
 *   2) 잴 게 없는 출발 전에만 점수제 어림값(25점 15분 / 21점 12분 / 15점 9분)
 *   3) 어느 쪽을 썼는지 화면에 적는다 — 임원이 숫자를 믿을지 말지 판단할 수 있게
 *   4) 말이 안 되는 값(밤새 켜 둔 세션 등)은 버린다
 *   5) 관리자 화면과 회원 화면이 **같은 방식**으로 잰다
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const view = fs.readFileSync(path.join(root, 'js', 'live-view.js'), 'utf8');
const team = fs.readFileSync(path.join(root, 'js', 'team.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'live.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'team.html'), 'utf8');
const cut = (a, b) => {
  const i = view.indexOf(a);
  assert(i >= 0, '시작 표지를 못 찾음: ' + a);
  const j = view.indexOf(b, i + a.length);
  assert(j >= 0, '끝 표지를 못 찾음: ' + b);
  return view.slice(i, j);
};

const box = {console, Object, Set, Number, String, Array, JSON, Date, Math, isNaN};
vm.createContext(box);
vm.runInContext(`
  ${cut('function esc(s)', '\n')}
  function _settled(m){ return !!(m && (m.win || m.voided)); }
  ${cut('var _LIVE_POINT_MINUTES', 'function buildLiveScore')}
  ${cut('function _officialPaceHtml', '/* 지금 메워야 하는 자리')}
  this.api = {left:_liveTimeLeft, pace:_officialPaceHtml, fmt:_fmtMinutes};
`, box);

// 4코트 × 5라운드 = 20경기. `doneRounds` 라운드까지 `perRound` 분씩 걸렸다고 둡니다.
function board(doneRounds, perRound, point){
  const T0 = Date.parse('2026-08-12T18:00:00+09:00');
  const ms = [];
  for(let r = 1; r <= 5; r++) for(let c = 1; c <= 4; c++){
    const n = (r - 1) * 4 + c, done = r <= doneRounds;
    const s = T0 + (r - 1) * perRound * 60000;
    ms.push({num:n, round:r, court:c, t1:['a','b'], t2:['c','d'],
      win: done ? (n % 2 ? 't1' : 't2') : null,
      startAt: done ? s : 0, winAt: done ? s + perRound * 60000 : 0});
  }
  return {matches: ms, currentRound: doneRounds + 1, pointSystem: point || 25};
}

// 1) 끝난 라운드가 있으면 실측으로 잽니다.
{
  const t = box.api.left(board(2, 18));
  assert.strictEqual(t.left, 3, '남은 라운드를 세야 합니다.');
  assert.strictEqual(t.basis, '실측', '끝난 라운드가 있으면 실제 소요로 재야 합니다.');
  assert.strictEqual(t.perRound, 18, `실제 18분이 걸렸으면 18분이어야 합니다: ${t.perRound}`);
  assert.strictEqual(t.minutes, 54, '18분 × 3라운드 = 54분.');
  console.log('  실측: 3라운드 남음 · 라운드당 18분 · 54분');
}

// 2) 출발 전에는 점수제 어림값 — 25점 15분 / 21점 12분 / 15점 9분.
{
  [[25, 15], [21, 12], [15, 9]].forEach(([point, per]) => {
    const t = box.api.left(board(0, 0, point));
    assert.strictEqual(t.basis, '예상', '잴 게 없으면 어림값이라고 말해야 합니다.');
    assert.strictEqual(t.perRound, per, `${point}점은 라운드당 ${per}분이어야 합니다: ${t.perRound}`);
    assert.strictEqual(t.minutes, per * 5, `${point}점 5라운드는 ${per * 5}분.`);
  });
  console.log('  출발 전: 25점 75분 · 21점 60분 · 15점 45분');
}

// 3) 실측이 어림값을 **이깁니다** — 그날 실제로 느리면 그대로 반영되어야 합니다.
{
  const slow = box.api.left(board(2, 25));   // 25점 기준 15분인데 실제로는 25분
  assert.strictEqual(slow.perRound, 25, '실제가 느리면 느린 대로 잡아야 합니다.');
  assert(slow.minutes > 15 * 3, '어림값보다 길게 나와야 합니다.');
  const fast = box.api.left(board(2, 9));
  assert.strictEqual(fast.perRound, 9, '실제가 빠르면 빠른 대로 잡아야 합니다.');
  console.log('  실측 우선: 느린 날 75분 · 빠른 날 27분');
}

// 4) 말이 안 되는 값은 버립니다(세션을 밤새 켜 둔 경우 등).
{
  const d = board(2, 18);
  d.matches.filter(m => m.round === 1).forEach(m => { m.winAt = m.startAt + 9 * 60 * 60 * 1000; });
  const t = box.api.left(d);
  assert.strictEqual(t.perRound, 18,
    `9시간짜리 라운드는 버리고 멀쩡한 라운드만 써야 합니다: ${t.perRound}`);
  console.log('  이상값: 9시간 라운드는 평균에서 제외');
}

// 5) 다 끝났으면 남은 시간이 없습니다.
{
  const t = box.api.left(board(5, 18));
  assert.strictEqual(t.left, 0);
  assert.strictEqual(t.minutes, 0);
  assert(/경기 종료/.test(box.api.pace(board(5, 18))), '끝났으면 끝났다고 해야 합니다.');
  assert.strictEqual(box.api.left({matches: []}), null, '대진이 없으면 아무것도 재지 않습니다.');
  console.log('  종료·빈 대진: 안전하게 처리');
}

// 6) 화면 — 진행률, 남은 시간, 끝 예정 시각, 근거를 함께 적습니다.
{
  const h = box.api.pace(board(2, 18));
  const text = h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  assert(/8\/20/.test(text), `진행한 경기 수를 보여야 합니다: ${text}`);
  assert(/3 라운드 남음/.test(text), '남은 라운드를 보여야 합니다.');
  assert(/54분 남음/.test(text), '남은 시간을 보여야 합니다.');
  assert(/끝 예정/.test(text), '언제 끝나는지 보여야 합니다.');
  assert(/실측/.test(text), '어떤 근거로 잰 값인지 밝혀야 합니다.');
  // 근거는 오른쪽 칸에 욱여넣으면 폰에서 잘립니다 — 줄을 통째로 씁니다.
  assert(/team-official-pace-sub/.test(h), '근거는 제 줄을 가져야 합니다.');
  assert(!/pace-top>em small/.test(css), '오른쪽 칸에 말줄임으로 넣으면 안 됩니다.');
  assert(/width:40%/.test(h), '진행률 막대가 8/20 = 40% 여야 합니다.');
  console.log('  화면: ' + text);
}

// 7) 자리 — 숫자 타일 바로 아래, 바로가기보다 위.
{
  const overview = view.slice(view.indexOf('function buildTeamOfficialOverview'),
    view.indexOf('function _officialPaceHtml'));
  const posGrid = overview.indexOf('team-official-overview-grid');
  const posPace = overview.indexOf('${_officialPaceHtml(d)}');
  const posJump = overview.indexOf('${_officialJumpHtml(d)}');
  assert(posGrid > 0 && posPace > posGrid && posJump > posPace,
    '진행 속도는 타일 아래·바로가기 위여야 합니다.');
  assert(/\.team-official-pace\{/.test(css), '진행 속도 카드 스타일이 있어야 합니다.');
  console.log('  자리: 타일 → 진행 속도 → 바로가기');
}

// 8) 관리자 화면도 **같은 방식**으로 재야 합니다 — 두 화면이 다른 답을 하면 안 됩니다.
{
  assert(/function _teamRoundsLeftInfo/.test(team), '관리자 화면에도 같은 계산이 있어야 합니다.');
  const admin = team.slice(team.indexOf('function _teamRoundsLeftInfo'),
    team.indexOf('function _renderLiveOpsSummary'));
  assert(/span>0&&span<3\*60\*60\*1000/.test(admin), '이상값 기준이 회원 화면과 같아야 합니다.');
  assert(/_POINT_MINUTES\[_pointSystem\]/.test(admin), '어림값은 점수제 표를 그대로 써야 합니다.');
  assert(/basis:n\?'실측':'예상'/.test(admin), '근거 표기도 같아야 합니다.');
  assert(/남은 시간/.test(team) && /끝 예정/.test(team), '관리자 운영 요약에 남은 시간이 떠야 합니다.');
  console.log('  관리자: 같은 계산 · 같은 이상값 기준 · 같은 근거 표기');
}

// 9) 품질 점검은 맨 위 — 다만 대진이 없으면 빈 상자를 띄우지 않습니다.
{
  const posQuality = html.indexOf('id="sec-quality"');
  const posPlayers = html.indexOf('id="sec-players"');
  const posSettings = html.indexOf('id="sec-settings"');
  assert(posQuality > 0 && posQuality < posPlayers && posQuality < posSettings,
    '품질 점검 카드는 참가자·설정보다 위에 있어야 합니다.');
  assert(/<details class="card hidden" id="sec-quality"/.test(html),
    '대진이 없을 때는 숨어 있어야 합니다 — 빈 상자가 맨 위에 뜨면 안 됩니다.');
  assert(/qualityCard\.classList\.toggle\('hidden',!matches\.length\)/.test(team),
    '대진이 생기면 열려야 합니다.');
  console.log('  품질 점검: 맨 위 · 대진 없으면 숨김');
}

console.log('official-pace-regression: OK');
