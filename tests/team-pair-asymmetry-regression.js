'use strict';
/**
 * 약한 고리 집중공략 (운영자 2026-08-14).
 *
 *   "배드민턴은 팀 스포츠이기 때문에 팀 내 파트너간 실력차가 크면 실력이 약한
 *    파트너에게 집중공략해서 점수를 따내는 경향이 있어. 실전에서도 팀별 실력
 *    합산점수가 동일하더라도 파트너간 실력차가 큰 팀이 지는 경우가 많아."
 *
 * 9ZJ2VH 실측: 합 6.5:6.5 로 맞춘 「김동균(6)+정다빈(0.5) vs 2.5+4」 류의 경기가
 * 생성기에서 그대로 나왔다. 품질점검(match-quality.js partnerGapSymmetryLimit)은
 * 이걸 벌점하는데 4명 선택기는 안 봤다 — 감사 잣대와 생성 잣대가 어긋난 상태.
 *
 * 여기서 고정하는 것 (team.js·daily.js 두 사본 모두):
 *   1) 좌우 페어 격차의 **비대칭**이 주벌점 — 합이 같아도 격차 큰 쪽이 진다
 *   2) **나란한 격차는 공정** — 초심전(0.5+4 vs 0.5+4)은 비대칭 벌점 0
 *   3) 양쪽 다 극단이면 대칭이어도 가볍게 회피 (즐거움·부상)
 *   4) 선택기가 실제로 이 벌점으로 고른다 — 파트너 반복(120점)을 내더라도
 *      비대칭 극단(6+0.5 vs 4+2.5)을 피해야 한다
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function build(file){
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
  const cut = (a, b) => {
    const i = src.indexOf(a);
    assert(i >= 0, `${file}: 시작 표지를 못 찾음: ${a}`);
    const j = src.indexOf(b, i + a.length);
    assert(j > i, `${file}: 끝 표지를 못 찾음: ${b}`);
    return src.slice(i, j);
  };
  const isTeam = file === 'team.js';
  const sandbox = {console, Object, Number, String, Array, JSON, Math, Set, Infinity};
  vm.createContext(sandbox);
  vm.runInContext(`
const MATCH_QUALITY=null;
function effLevel(p){
  const isF = p.gender==='F' || p.gender==='여';
  return Math.round((p.level - (isF ? 0.5 : 0)) * 10) / 10;
}
let _currentRound=1;
let _partnerGapThreshold=2;
${isTeam
    ? cut('const BALANCE_PARTNER_GAP_OK', 'function balanceTeamDiffPenalty')
    : cut('const DAILY_PARTNER_GAP_OK', 'const DAILY_RECENT_SOFT_MIN')}
${isTeam
    ? cut('function balancePartnerLevelGap(team)', 'let _currentRound')
    : cut('function _dailyPartnerLevelGap(team)', 'function _dailyMatchMaxPartnerGap')}
${isTeam ? '' : 'function _fixedPartnersComplete(){return true;}'}
${cut('function diversityScore(four,ld)', '\nfunction ')}
${cut('function selectFourTeamMode(pool,gf,maxLD)', '\nfunction ')}
this.api={selectFourTeamMode, pairGapAsymmetryPenalty, effLevel};
`, sandbox);
  return sandbox.api;
}

const P = (name, level, team, extra) => ({
  name, level, gender: 'M', team,
  gamesPlayed: 0, lastRoundPlayed: 0,
  partnerCount: {}, opponentCount: {}, partnerName: null, ...extra
});

for (const file of ['team.js', 'daily.js']){
  const api = build(file);
  console.log(`[${file}]`);

  // 1)~3) 벌점의 모양: 비대칭 > 나란한 극단 > 보통.
  {
    const t = (a, b) => [{level: a, gender: 'M'}, {level: b, gender: 'M'}];
    const asym = api.pairGapAsymmetryPenalty(t(6, 0.5), t(4, 2.5));    // 격차 5.5 vs 1.5
    const mirrored = api.pairGapAsymmetryPenalty(t(4, 0.5), t(4, 0.5)); // 격차 3.5 vs 3.5
    const mild = api.pairGapAsymmetryPenalty(t(4, 3), t(4, 4));        // 격차 1 vs 0
    assert(asym > 1500, `비대칭 극단은 사실상 금지 수준이어야 합니다: ${asym}`);
    assert(mirrored < asym / 3,
      `나란한 격차(초심전)는 비대칭보다 훨씬 싸야 합니다: ${mirrored} vs ${asym}`);
    assert(mirrored > 0, '양쪽 다 극단이면 대칭이어도 0 은 아닙니다 (즐거움·부상).');
    assert.strictEqual(api.pairGapAsymmetryPenalty(t(4, 4), t(3, 3)), 0,
      '격차가 나란히 작으면 벌점이 없습니다.');
    assert(mild < 100, `한계(1.5) 안의 비대칭은 가볍습니다: ${mild}`);
    console.log(`  벌점 모양: 비대칭 ${asym} > 나란한 극단 ${mirrored} > 보통 ${mild}`);
  }

  // 4) 선택기가 실제로 피한다 — 반복 벌점 120점을 내더라도.
  //    청 [4, 2.5] 고정. 홍 후보: [6, 0.5](비대칭 극단, 새 조합) vs [4, 2.5](대칭,
  //    파트너 반복 1회). 합은 모두 6.5 로 같다. 옛 코드는 반복 없는 [6, 0.5] 를
  //    골랐다 — 어제 실경기 「김동균+정다빈」이 그렇게 나왔다.
  {
    const E = P('홍E', 4, '홍팀'), F = P('홍F', 2.5, '홍팀');
    E.partnerCount = {'홍F': 1}; F.partnerCount = {'홍E': 1};
    const pool = [
      P('청A', 4, '청팀'), P('청B', 2.5, '청팀'),
      P('홍C', 6, '홍팀'), P('홍D', 0.5, '홍팀'), E, F
    ];
    const four = api.selectFourTeamMode(pool, null, 2);
    assert(four, '4명을 골라야 합니다.');
    const reds = four.filter(p => p.team === '홍팀').map(p => p.name).sort();
    assert.deepEqual(reds, ['홍E', '홍F'],
      `반복 벌점을 내더라도 비대칭 극단(6+0.5)은 피해야 합니다: ${reds}`);
    console.log('  선택기: 6+0.5 대신 반복 있는 4+2.5 선택');
  }
}

console.log('\nteam pair asymmetry regression ok');
