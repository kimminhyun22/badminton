'use strict';
/**
 * 2026-09-03 운영자: "팀전에서 E조 2명이 한 팀에 몰려 있는데 이러면 팀 밸런스가
 * 붕괴돼. 예전에 얘기해서 수정했는데 왜 이렇게 배정되지?"
 *
 * 초심 쏠림 방지는 있었지만 세 군데서 샜다 (2026-09-03 300회 시뮬 실측).
 *   ① 기준선이 「풀 실효 최하위 +0.5」라 유난히 낮은 한 명(60대+ D·여 → 실효 −0.5)이
 *      섞이면 기준이 끌려 내려가 정작 E조(실효 0.3)가 초심에서 빠졌다 → 몰림 35%.
 *   ② 맞추는 게 「명수」라 「약한 2명 vs 덜 약한 2명」도 차이 0으로 통과했다 → 23%.
 *   ③ 실효급수 하위로 갈라도 나이 보정(60대+ −2.0) 때문에 하위 2명이 E조가 아니어서
 *      E조는 그대로 몰렸다 → 24%.
 * 그래서 ⑴ 평균 대비 부족분의 제곱합(총량)과 ⑵ 하위 조(E, E+D) 자체의 분산을
 * 함께 본다. 운영자가 눈으로 보는 단위가 「조」이고, 상대가 집중 공략하는 대상도
 * 조가 낮은 선수다.
 *
 * 같은 나누기 감사(_qualityAssessment)도 같은 기준선을 쓰고 있어서 이 분할이
 * 경고 없이 통과했다 — 감사도 조 기준으로 바꿨다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// balanceTeams 는 team.js 와 daily.js 에 사본이 둘 — 둘 다 검사한다.
function build(file, seed){
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
  const cut = (a, b) => {
    const i = src.indexOf(a);
    assert(i >= 0, `${file}: 시작 표지를 못 찾음: ${a}`);
    const j = src.indexOf(b, i + a.length);
    assert(j > i, `${file}: 끝 표지를 못 찾음: ${b}`);
    return src.slice(i, j);
  };
  let _seed = seed;
  const seededMath = Object.create(Math);
  seededMath.random = () => {
    _seed = (_seed * 1103515245 + 12345) % 2147483648;
    return _seed / 2147483648;
  };
  const sandbox = {console, Object, Number, String, Array, JSON, Set, Math: seededMath, Infinity};
  vm.createContext(sandbox);
  vm.runInContext(`
const MATCH_QUALITY = null;
${cut('function levelToGrade(level,gender)', 'function effLevel(p){')}
function effLevel(p){
  const isF = p.gender==='F' || p.gender==='여';
  const _AGE_BONUS={'20대':0,'30대':-0.2,'40대':-0.5,'50대':-1.2,'60대+':-2.0};
  const ageMod = _AGE_BONUS[p.ageGroup] || 0;
  return Math.round((p.level - (isF ? 0.5 : 0) + ageMod) * 10) / 10;
}
${cut('function fisherYates(arr)', '\n')}
${cut('function balanceTeams(all', '\n/* ═══ GENERATE ═══ */')}
this.api = {balanceTeams, effLevel};
`, sandbox);
  return sandbox.api;
}

// 운영자 제보와 같은 모양의 27명 — E조 여성 2명 + 「기준선을 끌어내리던」 60대+ D조
// 여성 1명. 이 조합은 옛 코드에서 실제로 E조 2명이 한 팀에 몰린다(씨앗 8개 중 2개).
// 무작위 4,000 로스터에서 찾아 박아 둔 것이라, 새 항을 끄면 이 테스트가 바로 터진다.
const GRADE_LEVEL = {S: 7, A: 6, B: 5, C: 4, D: 3, E: 2};
const SHAPE = [
  ['m0','C','M','40대'],['m1','C','M','60대+'],['m2','C','M','30대'],['m3','C','M','40대'],
  ['m4','C','M','40대'],['m5','C','M','20대'],['m6','C','M','40대'],['m7','C','M','30대'],
  ['m8','C','M','20대'],['m9','C','M','30대'],['m10','B','M','60대+'],['m11','C','M','50대'],
  ['m12','D','M','30대'],['m13','C','M','30대'],['m14','C','M','50대'],['m15','C','M','20대'],
  ['f0','C','F','20대'],['f1','B','F','50대'],['f2','C','F','40대'],['f3','B','F','40대'],
  ['f4','B','F','30대'],['f5','D','F','30대'],['f6','C','F','20대'],['f7','D','F','50대'],
  ['노장','D','F','60대+'],   // 실효 −0.5 — 예전 기준선을 끌어내리던 한 명
  ['이E','E','F','30대'],['정E','E','F','30대']   // 실효 0.3
];
function make(withGrade){
  return SHAPE.map(([name, grade, gender, age]) => {
    const p = {name, gender, ageGroup: age,
      level: Math.max(1, gender === 'F' ? GRADE_LEVEL[grade] - 1 : GRADE_LEVEL[grade])};
    if (withGrade) p.grade = grade;   // 조가 비어 있으면 levelToGrade 로 되돌린다
    return p;
  });
}

for (const file of ['team.js', 'daily.js']){
  console.log(`\n[${file}]`);
  for (const withGrade of [true, false]){
    const label = withGrade ? '조 입력됨' : '조 비어 있음(레벨→조 역산)';
    let worstGap = 0;
    for (let t = 0; t < 8; t++){
      const api = build(file, 20260903 + t * 7919);
      const roster = make(withGrade);
      const {blue, white} = api.balanceTeams(roster.map(p => ({...p})));
      assert.strictEqual(blue.length + white.length, roster.length, '전원이 배정돼야 합니다.');
      const inBlue = blue.filter(p => p.name === '이E' || p.name === '정E').length;
      assert.strictEqual(inBlue, 1,
        `${label}: E조 2명은 1:1 로 갈라야 합니다 (청에 ${inBlue}명, 씨앗 ${t}).`);
      const avg = t2 => t2.reduce((s, p) => s + api.effLevel(p), 0) / t2.length;
      const gap = Math.abs(avg(blue) - avg(white));
      if (gap > worstGap) worstGap = gap;
    }
    assert(worstGap <= 0.15,
      `${label}: 초심을 갈라도 1인당 평균은 맞아야 합니다 (최악 ${Math.round(worstGap * 100) / 100}).`);
    console.log(`  ${label}: 8회 모두 1:1 · 평균차 최악 ${Math.round(worstGap * 100) / 100}`);
  }
}

// 옛 기준선이 되살아나면 같은 결함이 그대로 돌아온다 — 두 파일 모두에서 못 박는다.
for (const file of ['js/team.js', 'js/daily.js']){
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert(!/Math\.min\(\.\.\.(everyone|participants)\.map\(effLevel\)\)\s*\+\s*0\.5/.test(src),
    `${file}: 초심 기준선을 「풀 최하위 +0.5」로 되돌리면 안 됩니다 — 아주 낮은 한 명이 기준을 끌어내립니다.`);
  assert(src.includes('const lowGradeSets=[[\'E\'],[\'E\',\'D\']]'),
    `${file}: 하위 조는 E, E+D 누적으로 갈라야 합니다.`);
  assert(src.includes('W_SPREAD') && src.includes('spreadD(fullB,fullW)*W_SPREAD'),
    `${file}: 하위 조 분산이 나누기 비용에 들어가야 합니다.`);
  assert(src.includes('const d=Math.max(0,avgAll-effLevel(p));return s+d*d;'),
    `${file}: 약체 부담은 명수가 아니라 「평균 대비 부족분의 제곱합」이어야 합니다.`);
  // 인원이 많은 팀은 1인당 출전이 줄어 불리하다 → 평균을 그만큼 더 세게 잡아 준다.
  assert(src.includes('const CNT_TILT=0.1;') && src.includes('-(nB-nW)*CNT_TILT'),
    `${file}: 인원 많은 팀 보정이 있어야 합니다.`);
  // 나누기 감사도 같은 잣대여야 수동 이동으로 다시 몰릴 때 경고가 뜬다.
  assert(/const lowGrade=\['E','D','C'\]\.find/.test(src),
    `${file}: 나누기 감사도 조 기준으로 초심을 잡아야 합니다.`);
}
console.log('\nteam low grade spread regression ok');
