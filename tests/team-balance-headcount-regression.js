'use strict';
/**
 * 팀 나누기의 **공정성 단위** (2026-08-13 팀전 9ZJ2VH 데이터 분석, 2026-08-14).
 *
 * 운영자 실전 피드백:
 *   ② "인원이 많은 팀이 불리해 보임"
 *   ③ "초심 2명을 한쪽에 몰아 배당 — 좌우 급수 합은 맞아도 실제 전력은 안 맞음"
 *
 * 실측(9ZJ2VH, 청16 vs 홍17, 21경기): 팀 나누기가 「합」을 맞춰(58.5:56)
 * 인원 많은 홍팀의 슬롯당 평균이 3.35 vs 3.61 로 밀렸고, 대진표가 청우세 9 vs
 * 홍우세 4 로 기울어 14:7 로 끝났다. 우세 쪽이 다 이겼다고 가정한 기대 스코어가
 * 13:8 — 결과의 거의 전부가 나누기에서 결정됐다. 초심 2명(실효 0.5)은 둘 다
 * 홍팀에 배당됐고 이들이 낀 경기는 0승 3패.
 *
 * 여기서 고정하는 것:
 *   1) 경기는 언제나 2:2 — 인원이 다르면 합이 아니라 **1인당 평균**을 맞춘다
 *      (= 인원 많은 팀이 레벨 합계를 **더 많이** 가져가야 한다)
 *   2) **초심(실효 최하위 ±0.5)은 한 팀에 몰지 않는다** — 합으로는 안 보이는 구멍
 *   3) 인원이 같으면 예전과 같다: 합 맞추기 = 평균 맞추기
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// balanceTeams 는 team.js 와 daily.js 에 사본이 둘 있습니다 — 둘 다 검사해야
// 한쪽만 고쳐지는 일이 없습니다 (살아있는 경로가 daily 쪽입니다).
function build(file){
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
  const cut = (a, b) => {
    const i = src.indexOf(a);
    assert(i >= 0, `${file}: 시작 표지를 못 찾음: ${a}`);
    const j = src.indexOf(b, i + a.length);
    assert(j > i, `${file}: 끝 표지를 못 찾음: ${b}`);
    return src.slice(i, j);
  };
  // Math.random 을 씨앗 고정 LCG 로 바꿔 결과를 결정적으로 만듭니다.
  let _seed = 20260814;
  const seededMath = Object.create(Math);
  seededMath.random = () => {
    _seed = (_seed * 1103515245 + 12345) % 2147483648;
    return _seed / 2147483648;
  };
  const sandbox = {console, Object, Number, String, Array, JSON, Math: seededMath, Infinity};
  vm.createContext(sandbox);
  vm.runInContext(`
const MATCH_QUALITY = null;
function effLevel(p){
  const isF = p.gender==='F' || p.gender==='여';
  const _AGE_BONUS={'20대':0,'30대':-0.2,'40대':-0.5,'50대':-1.2,'60대+':-2.0};
  const ageMod = _AGE_BONUS[p.ageGroup] || 0;
  return Math.round((p.level - (isF ? 0.5 : 0) + ageMod) * 10) / 10;
}
${cut('function levelToGrade(level,gender)', 'function effLevel(p){')}
${cut('function fisherYates(arr)', '\n')}
${cut('function balanceTeams(all', '\n/* ═══ GENERATE ═══ */')}
this.api = {balanceTeams, effLevel};
`, sandbox);
  return sandbox.api;
}

// 9ZJ2VH 실제 로스터의 급수·성별 33명 (이름만 익명화).
const ROSTER = [
  [5,'F'],[5,'F'],[4,'F'],[2,'F'],[2,'F'],[5,'M'],[4,'M'],[4,'M'],[4,'M'],[4,'M'],
  [4,'M'],[4,'M'],[4,'M'],[4,'M'],[3,'M'],[3,'M'],[5,'F'],[5,'F'],[3,'F'],[2,'F'],
  [1,'F'],[1,'F'],[6,'M'],[5,'M'],[4,'M'],[4,'M'],[4,'M'],[3,'M'],[3,'M'],[3,'M'],
  [4,'M'],[3,'M'],[3,'M']
].map(([l, g], i) => ({name: 'p' + (i + 1), level: l, gender: g}));

for (const file of ['team.js', 'daily.js']){
const api = build(file);
console.log(`\n[${file}]`);
const sum = t => t.reduce((s, p) => s + api.effLevel(p), 0);
const r1 = x => Math.round(x * 10) / 10;

// 1) 홀수 인원(16:17): 인원 많은 팀이 합계를 더 가져가고, 평균이 맞아야 합니다.
{
  const {blue, white} = api.balanceTeams([...ROSTER]);
  assert.strictEqual(blue.length + white.length, 33, '전원이 배정돼야 합니다.');
  assert.strictEqual(Math.abs(blue.length - white.length), 1, '홀수면 16:17 입니다.');
  const big = blue.length > white.length ? blue : white;
  const small = blue.length > white.length ? white : blue;
  assert(sum(big) > sum(small) + 1.5,
    `인원 많은 팀이 합계를 더 가져가야 평균이 맞습니다: ` +
    `${big.length}명 ${r1(sum(big))} vs ${small.length}명 ${r1(sum(small))}`);
  const avgGap = Math.abs(sum(big) / big.length - sum(small) / small.length);
  assert(avgGap <= 0.15,
    `1인당 평균이 맞아야 합니다: 차이 ${r1(avgGap * 100) / 100}`);
  // 여성 수 균형은 그대로 지켜져야 합니다 (F 12명 → 6:6).
  const fem = t => t.filter(p => p.gender === 'F').length;
  assert(Math.abs(fem(blue) - fem(white)) <= 1, '여성 수 균형이 깨지면 안 됩니다.');
  console.log(`  16:17 나누기: ${big.length}명 ${r1(sum(big))} vs ${small.length}명 ` +
    `${r1(sum(small))} (평균차 ${r1(avgGap * 100) / 100})`);
}

// 2) 초심(실효 최하위 ±0.5)은 갈라놓아야 합니다 — 9ZJ2VH 의 실효 0.5 두 명.
{
  for (let t = 0; t < 5; t++){
    const {blue, white} = api.balanceTeams([...ROSTER]);
    const lows = ROSTER.filter(p => api.effLevel(p) <= 0.5 + 0.5).map(p => p.name);
    assert.strictEqual(lows.length, 2, '이 로스터의 초심은 2명입니다.');
    const inBlue = blue.filter(p => lows.includes(p.name)).length;
    assert.strictEqual(inBlue, 1,
      `초심 2명은 1:1 로 갈라야 합니다 (청에 ${inBlue}명).`);
  }
  console.log('  초심 분산: 5회 반복 모두 1:1');
}

// 3) 인원이 같으면 예전 그대로 — 합이 정확히 맞을 수 있으면 맞춥니다.
{
  const four = [
    {name: 'a', level: 5, gender: 'M'}, {name: 'b', level: 4, gender: 'M'},
    {name: 'c', level: 4, gender: 'M'}, {name: 'd', level: 3, gender: 'M'}
  ];
  const {blue, white} = api.balanceTeams(four);
  assert.strictEqual(blue.length, 2);
  assert.strictEqual(sum(blue), sum(white), '5+3 = 4+4 로 갈라야 합니다.');
  console.log('  짝수 인원: 합 균형 그대로');
}
}

console.log('\nteam balance headcount regression ok');
