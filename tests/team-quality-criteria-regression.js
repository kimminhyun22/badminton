'use strict';
/**
 * 품질 점검 기준 개편 (2026-08-14) — 생성 잣대가 바뀌면 감사 잣대도 바뀌어야 한다.
 *
 * 배경: 9ZJ2VH 의 18:7 은 경기 잣대(합 차)로는 안 보였다 — 결함이 전부 잣대
 * 바깥(팀 나누기·페어 격차 비대칭)에 있었고, 옛 기준이면 그 대진이 상급을 받는다.
 *
 * 여기서 고정하는 것 (team.js — daily.js 는 캡 방식으로 같은 원리):
 *   1) 팀 나누기 점검 신설(10점): 1인당 평균 차(0.1/0.3) · 초심 몰림 · 여성 균형.
 *      나누기 결함은 재생성 권장(blocking) 사유다.
 *   2) 실력 균형은 40→30점, 페어 격차 「비대칭」 감점 추가.
 *      나란한 격차(초심전)는 감점 없이 정보로만 — 생성기와 같은 잣대.
 *   3) 백중/우세 헤드라인: |합 차|≤0.5 경기 수 — 공정성의 요약 지표.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const teamSrc = fs.readFileSync(path.join(root, 'js', 'team.js'), 'utf8');
const dailySrc = fs.readFileSync(path.join(root, 'js', 'daily.js'), 'utf8');

function cut(src, a, b, label){
  const i = src.indexOf(a);
  assert(i >= 0, `${label}: 시작 표지를 못 찾음: ${a}`);
  const j = src.indexOf(b, i + a.length);
  assert(j > i, `${label}: 끝 표지를 못 찾음: ${b}`);
  return src.slice(i, j);
}

// ── team.js 하네스: 상수·effLevel·통계는 실물, 주변부는 스텁 ──
const sandbox = {console, Object, Number, String, Array, JSON, Math, Set, Infinity, isFinite, Date};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`
${cut(teamSrc, 'const LV_LABEL', '\nlet _currentRound', 'team.js')}
function _participationSlotStats(participants,settings,counts){
  return {underSlots:0,overSlots:0,totalGoalSlots:participants.length*(settings.gamesPerPlayer||4),
    minimumMatches:1,minimumOver:0,parityAdjustment:0,avoidableUnderSlots:0,avoidableOverSlots:0};
}
function _matchGenderErrorCount(){return 0;}
function _matchStructureErrorCount(){return 0;}
${cut(teamSrc, 'function _qualityAssessment(matches,participants,settings)', '\n/* ═══ 대진 품질 대시보드', 'team.js')}
this.api={_qualityAssessment};
`, sandbox);
const api = sandbox.api;

const P = (name, level, team, gender) => ({name, level, team, gender: gender || 'M'});
const M = (num, t1, t2, type) => {
  const s = t => t.reduce((s, p) => s + p.level - (p.gender === 'F' ? 0.5 : 0), 0);
  return {matchNumber: num, round: num, court: 1, type: type || '남복',
    team1A: t1[0], team1B: t1[1], team2C: t2[0], team2D: t2[1],
    team1Level: s(t1), team2Level: s(t2),
    levelDiff: Math.round(Math.abs(s(t1) - s(t2)) * 10) / 10};
};
const settings = {teamMode: true, gamesPerPlayer: 1, courts: 1};

// 1) 어제의 나누기(합은 비슷·평균은 기움·초심 몰림)는 이제 걸린다.
{
  // 청 4명 실효 16(평균 4) vs 홍 5명 실효 11(평균 2.2), 초심 0.5 둘 다 홍.
  const blue = [P('청1', 4, '청팀'), P('청2', 4, '청팀'), P('청3', 4, '청팀'), P('청4', 4, '청팀')];
  const red = [P('홍1', 4, '홍팀'), P('홍2', 4, '홍팀'), P('홍3', 2, '홍팀'),
               P('홍4', 0.5, '홍팀'), P('홍5', 0.5, '홍팀')];
  const q = api._qualityAssessment(
    [M(1, [blue[0], blue[1]], [red[0], red[1]])], [...blue, ...red], settings);
  assert(q.splitAudit, '팀전이면 나누기 점검이 있어야 합니다.');
  assert(q.splitAudit.avgGap > 0.3, `평균 차가 잡혀야 합니다: ${q.splitAudit.avgGap}`);
  assert.strictEqual(q.splitAudit.lowStacked, true, '초심 2명이 한 팀이면 몰림입니다.');
  assert(q.sTeamSplit <= 0, `나누기 결함이 겹치면 0점이어야 합니다: ${q.sTeamSplit}`);
  console.log(`  나누기 결함 감지: 평균 차 ${q.splitAudit.avgGap} · 초심 몰림 → ${q.sTeamSplit}/10점`);
}

// 2) 좋은 나누기는 만점 — 초심이 갈라져 있으면 몰림이 아니다.
{
  const blue = [P('청1', 4, '청팀'), P('청2', 3, '청팀'), P('청3', 0.5, '청팀')];
  const red = [P('홍1', 4, '홍팀'), P('홍2', 3, '홍팀'), P('홍3', 0.5, '홍팀')];
  const q = api._qualityAssessment(
    [M(1, [blue[0], blue[1]], [red[0], red[1]])], [...blue, ...red], settings);
  assert.strictEqual(q.splitAudit.lowStacked, false);
  assert.strictEqual(q.sTeamSplit, 10, `균형 나누기는 10점: ${q.sTeamSplit}`);
  console.log('  좋은 나누기: 10/10점');
}

// 3) 비대칭은 감점, 나란한 격차(초심전)는 정보로만.
{
  const ps = [P('a', 6, '청팀'), P('b', 0.5, '청팀'), P('c', 4, '홍팀'), P('d', 2.5, '홍팀'),
              P('e', 4, '청팀'), P('f', 0.5, '홍팀'), P('g', 4, '홍팀'), P('h', 1, '청팀')];
  // 비대칭: 6+0.5(격차 5.5) vs 4+2.5(격차 1.5) — 합은 6.5:6.5 로 같다
  const asym = M(1, [ps[0], ps[1]], [ps[2], ps[3]]);
  // 나란한 격차: 1+4(격차 3) vs 0.5+4(격차 3.5) — 초심전
  const mirrored = M(2, [ps[7], ps[4]], [ps[5], ps[6]]);
  const q = api._qualityAssessment([asym, mirrored], ps, settings);
  assert.deepEqual(q.asymMatches.map(a => a.num), [1],
    `비대칭은 1번 경기만: ${JSON.stringify(q.asymMatches)}`);
  assert.deepEqual(q.mirroredExtremes, [2], '나란한 극단은 초심전으로 분류됩니다.');
  // 합 차는 똑같이 0 인데 비대칭만 다른 두 경기 — 대칭 쪽 점수가 높아야 한다
  const i = P('i', 4.5, '홍팀'), j = P('j', 2, '홍팀');
  const symMatch = M(1, [ps[4], ps[3]], [i, j]);      // 4+2.5 vs 4.5+2 — 격차 1.5 vs 2.5
  const qAsym = api._qualityAssessment([asym], [...ps, i, j], settings);
  const qSym = api._qualityAssessment([symMatch], [...ps, i, j], settings);
  assert.strictEqual(qAsym.avgLD, qSym.avgLD, '두 비교 경기의 합 차는 같아야 합니다.');
  assert(qSym.sBalance > qAsym.sBalance,
    `합이 같아도 비대칭이면 감점돼야 합니다: 비대칭 ${qAsym.sBalance} vs 대칭 ${qSym.sBalance}`);
  console.log(`  비대칭 감점: 비대칭 ${qAsym.sBalance} < 대칭 ${qSym.sBalance} (만점 30)`);
}

// 4) 백중/우세 헤드라인.
{
  const ps = [P('a', 4, '청팀'), P('b', 3, '청팀'), P('c', 4, '홍팀'), P('d', 3, '홍팀'),
              P('e', 5, '청팀'), P('f', 4, '청팀'), P('g', 4, '홍팀'), P('h', 3, '홍팀')];
  const even = M(1, [ps[0], ps[1]], [ps[2], ps[3]]);   // 7 vs 7
  const fav = M(2, [ps[4], ps[5]], [ps[6], ps[7]]);    // 9 vs 7
  const q = api._qualityAssessment([even, fav], ps, settings);
  assert.strictEqual(q.evenCount, 1);
  assert.strictEqual(q.favCount, 1);
  console.log('  백중/우세 집계: 1 · 1');
}

// 5) 자유 대진(팀 없음)은 나누기 점검을 건너뛰되 감점하지 않는다.
{
  const ps = [P('a', 4, ''), P('b', 3, ''), P('c', 4, ''), P('d', 3, '')];
  const q = api._qualityAssessment([M(1, [ps[0], ps[1]], [ps[2], ps[3]])], ps,
    {teamMode: false, gamesPerPlayer: 1, courts: 1});
  assert.strictEqual(q.splitAudit, null);
  assert.strictEqual(q.sTeamSplit, 10, '자유 대진은 중립 만점입니다.');
  console.log('  자유 대진: 나누기 점검 해당 없음');
}

// 6) daily.js(민턴LIVE)도 같은 원리 — 비대칭 감점(상한 포함)·백중 집계·나누기 결함 캡.
{
  assert(dailySrc.includes('Math.min(6,asymCount*1.5)'),
    'daily 실력 균형에 상한 있는 비대칭 감점이 있어야 합니다.');
  assert(dailySrc.includes('const evenCount=matches.filter'), 'daily 에 백중 집계가 있어야 합니다.');
  assert(dailySrc.includes('splitAudit.lowStacked||splitAudit.avgGap>0.3'),
    'daily 는 나누기 결함 시 총점을 캡해야 합니다.');
  // 후보 채점(best-of-N)도 감사와 같은 잣대를 봐야 한다 — 감사만 벌점하면
  // 점수는 낮게 나오는데 생성은 그대로인 어긋남이 생긴다 (2026-08-14 실측 D~C 사건).
  const teamBQ = cut(teamSrc, 'function _bracketQualityScore', '\nfunction _candidateQualityKey', 'team.js');
  const dailyBQ = cut(dailySrc, 'function _bracketQualityScore', '\nfunction ', 'daily.js');
  assert(/BALANCE_PARTNER_GAP_SYMMETRY/.test(teamBQ), 'team 후보 채점에 비대칭 항이 있어야 합니다.');
  assert(/DAILY_PARTNER_GAP_SYMMETRY_LIMIT/.test(dailyBQ), 'daily 후보 채점에 비대칭 항이 있어야 합니다.');
  // 감사 쪽 비대칭 감점은 상한이 있어야 한다 — 특이점 급수 로스터를 처벌하지 않게.
  assert(teamSrc.includes('Math.min(8,asymMatches.length*1.5+asymSevereCount*2.5)'),
    'team 감사의 비대칭 감점에 상한(8)이 있어야 합니다.');
  // 자유 대진 짝 고르기(formTeams)도 두 파일 모두 비대칭을 피한다.
  const teamFormBody = cut(teamSrc, 'function formTeams(four', '\nfunction updatePlayerRecords', 'team.js');
  const dailyFormBody = cut(dailySrc, 'function formTeams(four', '\nfunction updatePlayerRecords', 'daily.js');
  assert(teamFormBody.includes('pairGapAsymmetryPenalty(t1,t2)'),
    'team.js formTeams(자유 대진 짝 선택)에 비대칭 벌점이 있어야 합니다.');
  assert(dailyFormBody.includes('pairGapAsymmetryPenalty(t1,t2)'),
    'daily.js formTeams 에도 비대칭 벌점이 있어야 합니다.');
  console.log('  daily.js·자유 대진: 같은 잣대 확인');
}

console.log('\nteam quality criteria regression ok');
