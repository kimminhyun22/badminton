'use strict';
/**
 * 교체 후보의 실력 차 계산 (운영자 2026-08-12 실전 제보).
 *
 *   "박태경 30대 C조인데 교체하려고 했는데 40대 C조 김민현으로 했더니
 *    더 유리해졌다고 나오네. 이거 왜 이래?"
 *   "원래 실력차 계산할 때 성별이랑 나이랑 급수랑 계산하는 산식 있잖아.
 *    그에 따라 최적인원을 추천해줘야지"
 *
 * 원인이 둘이었습니다:
 *   1) 게시본(`liveMember`)에 **나이대가 실리지 않아** 임원 화면이 나이를 못 봤다
 *   2) 교체 기울기가 **급수 숫자만** 봐서, 30대 C(4)와 40대 C(4)가 같은 값이었다
 *      — 관리자 대진 생성은 같은 둘을 3.8 과 3.5 로 봅니다
 *
 * 여기서 지키는 것:
 *   1) 세 곳(관리자 생성 · 서버 엔진 · 회원 화면)이 **같은 산식**을 쓴다
 *   2) 같은 급수라도 나이가 많으면 실효 급수가 낮다
 *   3) 여성 보정도 같은 값으로 들어간다
 *   4) 추천 순서가 그 값으로 정해진다
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const {suggestSubstitutes} = require(path.join(root, 'functions', 'team-official-engine'));
const engine = fs.readFileSync(path.join(root, 'functions', 'team-official-engine.js'), 'utf8');
const view = fs.readFileSync(path.join(root, 'js', 'live-view.js'), 'utf8');
const team = fs.readFileSync(path.join(root, 'js', 'team.js'), 'utf8');
const quality = fs.readFileSync(path.join(root, 'js', 'match-quality.js'), 'utf8');

const M = (n, g, gr, age, lv) => ({id: 'm_' + n, n, l: lv, g, gr, a: age});
function session(){
  return {
    isTeam: true, teamBlue: '청', teamWhite: '홍', currentRound: 1,
    members: {
      blue: [M('김권재','M','C','40대',4), M('이건행','M','C','30대',4),
             M('김민현','M','C','40대',4), M('강연수','M','B','30대',5)],
      red:  [M('최영훈','M','C','30대',4), M('박태경','M','C','30대',4),
             M('유동구','M','C','40대',4), M('여선수','F','C','30대',3)]
    },
    officials: {clubOfficials: [{memberId: 'm_김권재', name: '김권재'}]},
    matches: [{num: 1, round: 1, court: 4, type: '남복',
      t1: ['김권재','이건행'], t2: ['최영훈','박태경'],
      t1g: ['C','C'], t2g: ['C','C'], win: null}],
    substitutions: []
  };
}
const byName = list => Object.fromEntries(list.map(c => [c.name, c]));

// 1) 같은 급수라도 나이가 많으면 실효 급수가 낮습니다.
{
  const c = byName(suggestSubstitutes(session(), 1, '박태경', {limit: 20}));
  assert.strictEqual(c['유동구'].level, 3.5, `40대 C 남 = 3.5 여야 합니다: ${c['유동구'].level}`);
  assert.strictEqual(c['강연수'].level, 4.8, `30대 B 남 = 4.8 여야 합니다: ${c['강연수'].level}`);
  // 빠지는 박태경(30대 C 남)은 3.8 이므로, 40대 C 를 넣으면 그 팀은 **약해집니다**.
  assert.strictEqual(c['유동구'].swing, -0.3,
    `40대 C 로 바꾸면 −0.3 이어야 합니다(더 유리해질 수 없습니다): ${c['유동구'].swing}`);
  console.log('  나이 반영: 40대 C 3.5 · 30대 C 3.8 → 교체 시 −0.3');
}

// 2) 여성 보정도 같은 값(−0.5)으로 들어갑니다.
{
  const c = byName(suggestSubstitutes(session(), 1, '박태경', {limit: 20}));
  // 여선수: 급수 숫자 3(여성은 급수→숫자 변환에서 이미 낮음) − 0.5 − 0.2(30대) = 2.3
  assert.strictEqual(c['여선수'].level, 2.3, `여성 보정이 들어가야 합니다: ${c['여선수'].level}`);
  console.log('  성별 반영: 여 C 30대 = 2.3');
}

// 3) 추천 순서는 **넣은 뒤 경기가 가장 안 기우는 순**입니다.
{
  const list = suggestSubstitutes(session(), 1, '박태경', {limit: 20}).filter(x => !x.crossTeam);
  const gaps = list.map(x => Math.abs(x.balance));
  assert.deepStrictEqual(gaps, [...gaps].sort((a, b) => a - b),
    `기울기가 0 에 가까운 순이어야 합니다: ${JSON.stringify(list.map(x => [x.name, x.balance]))}`);
  console.log('  추천 순서: ' + list.map(x => `${x.name}(${x.balance})`).join(' → '));
}

// 4) 세 곳이 같은 산식을 씁니다 — 하나만 다르면 화면마다 다른 답이 나옵니다.
{
  /* 글자로 비교하면 `-2` 와 `-2.0` 이 달라 헛되이 실패합니다 — **값**으로 봅니다. */
  const readBonus = src => {
    const out = {};
    ['20대','30대','40대','50대','60대\\+'].forEach(k => {
      const m = src.match(new RegExp("'" + k + "'\\s*:\\s*(-?[\\d.]+)"));
      if(m) out[k.replace('\\','')] = Number(m[1]);
    });
    return out;
  };
  const want = {'20대':0, '30대':-0.2, '40대':-0.5, '50대':-1.2, '60대+':-2};
  [['서버 엔진', engine], ['회원 화면', view], ['관리자 품질', quality]].forEach(([what, src]) => {
    assert.deepStrictEqual(readBonus(src), want, `${what} 의 나이 보정표가 달라졌습니다.`);
  });
  // 여성 −0.5 도 세 곳 모두.
  [['서버 엔진', engine], ['회원 화면', view], ['관리자 품질', quality]].forEach(([what, src]) => {
    assert(/female\s*\?\s*0\.5\s*:\s*0/.test(src) || /isF\s*\?\s*0\.5\s*:\s*0/.test(src),
      `${what} 에 여성 보정(−0.5)이 있어야 합니다.`);
  });
  console.log('  산식 일치: 나이 보정표 · 여성 보정 세 곳 모두');
}

// 5) 게시본이 나이대를 실어야 화면이 계산할 수 있습니다.
{
  assert(/a:p\.ageGroup\|\|''/.test(team),
    '게시본에 나이대(`a`)를 실어야 합니다 — 없으면 화면이 나이를 못 봅니다.');
  assert(/ageGroup \|\| row\?\.a/.test(engine) || /row\?\.ageGroup \|\| row\?\.a/.test(engine),
    '엔진은 두 표기(ageGroup/a)를 모두 읽어야 합니다.');
  console.log('  게시본: 나이대 포함 · 엔진이 두 표기 모두 읽음');
}

// 6) 소수 기울기를 화면이 제대로 읽어야 합니다.
{
  const mark = view.slice(view.indexOf('function _balanceMark'), view.indexOf('function _balanceMark') + 460);
  assert(/toFixed\(1\)/.test(mark), '소수 한 자리로 보여야 합니다.');
  assert(/n<0\.05/.test(mark), '거의 0 이면 「균형」으로 읽어야 합니다.');
  console.log('  표기: 소수 한 자리 · 0.05 미만은 균형');
}

console.log('substitute-effective-level-regression: OK');
