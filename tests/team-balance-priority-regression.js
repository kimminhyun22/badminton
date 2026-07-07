const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'team.js'), 'utf8');
const prefix = src.split('let _currentRound=1;')[0];
const stubs = `
function _matchGenderErrorCount(){ return 0; }
function _matchStructureErrorCount(){ return 0; }
function _participationSlotStats(){
  return {
    underSlots:0,
    overSlots:0,
    totalGoalSlots:8,
    minimumMatches:2,
    minimumOver:0,
    parityAdjustment:0,
    avoidableUnderSlots:0,
    avoidableOverSlots:0
  };
}
`;
const scoringBlock = src.slice(
  src.indexOf('function _bracketQualityScore'),
  src.indexOf('function _isBetterQualityKey') + 'function _isBetterQualityKey(next,best){\n  if(!best)return true;\n  for(let i=0;i<next.length;i++){\n    if(next[i]!==best[i])return next[i]<best[i];\n  }\n  return false;\n}'.length
);
const qualityBlock = src.slice(
  src.indexOf('function _qualityAssessment'),
  src.indexOf('function renderQualityDashboard')
);

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(prefix + stubs + scoringBlock + qualityBlock, sandbox);

function player(name, level, team = '청팀') {
  return {
    name,
    level,
    grade: ['E', 'E', 'D', 'C', 'B', 'A', 'S', 'S'][level] || 'E',
    gender: 'M',
    ageGroup: '20대',
    team,
    gamesPlayed: 1,
    lastRoundPlayed: 1,
  };
}

function match(round, court, a, b, c, d) {
  const team1Level = sandbox.effLevel(a) + sandbox.effLevel(b);
  const team2Level = sandbox.effLevel(c) + sandbox.effLevel(d);
  return {
    round,
    court,
    team1A: a,
    team1B: b,
    team2C: c,
    team2D: d,
    team1Level,
    team2Level,
    levelDiff: Math.round(Math.abs(team1Level - team2Level) * 10) / 10,
    type: '남복',
  };
}

const settings = { teamMode: true, gamesPerPlayer: 1, typeMode: 'auto' };
const strongBlue = player('청A', 6, '청팀');
const strongBlue2 = player('청B', 5, '청팀');
const weakRed = player('홍E', 1, '홍팀');
const weakRed2 = player('홍D', 2, '홍팀');
const midBlue = player('청C', 4, '청팀');
const midBlue2 = player('청D', 3, '청팀');
const midRed = player('홍C', 4, '홍팀');
const midRed2 = player('홍B', 3, '홍팀');
const participants = [strongBlue, strongBlue2, weakRed, weakRed2, midBlue, midBlue2, midRed, midRed2];

const tilted = [
  match(1, 1, strongBlue, strongBlue2, weakRed, weakRed2),
  match(1, 2, midBlue, midBlue2, midRed, midRed2),
];
const balanced = [
  match(1, 1, strongBlue, weakRed, midRed, midBlue2),
  match(1, 2, strongBlue2, weakRed2, midBlue, midRed2),
];

const tiltedScore = sandbox._bracketQualityScore(tilted, participants, settings);
const balancedScore = sandbox._bracketQualityScore(balanced, participants, settings);
assert(balancedScore < tiltedScore, '실력 균형이 좋은 후보가 더 낮은 품질 페널티를 받아야 합니다.');

const tiltedKey = sandbox._candidateQualityKey(tilted, participants, settings, tiltedScore);
const balancedKey = sandbox._candidateQualityKey(balanced, participants, settings, balancedScore);
assert(
  sandbox._isBetterQualityKey(balancedKey, tiltedKey),
  '실력차 2.0 초과 후보보다 균형 좋은 후보가 우선 선택되어야 합니다.'
);

assert.strictEqual(sandbox._balanceQualityStats(tilted, settings).hardCount, 1, '2.0 초과 경기를 강한 불균형으로 잡아야 합니다.');
assert.strictEqual(sandbox._balanceQualityStats(balanced, settings).hardCount, 0, '균형 후보에는 강한 불균형이 없어야 합니다.');

const b1 = player('청1', 3, '청팀');
const b2 = player('청2', 3, '청팀');
const b3 = player('청3', 3, '청팀');
const b4 = player('청4', 3, '청팀');
const r1 = player('홍1', 3, '홍팀');
const r2 = player('홍2', 3, '홍팀');
const r3 = player('홍3', 3, '홍팀');
const r4 = player('홍4', 3, '홍팀');
const nearPerfectMatches = Array.from({ length: 9 }, (_, i) => {
  const m = match(i + 1, 1, b1, b2, r1, r2);
  m.levelDiff = i === 0 ? 0.7 : 0;
  return m;
});
const nearPerfectQuality = sandbox._qualityAssessment(
  nearPerfectMatches,
  [b1, b2, r1, r2],
  { teamMode: false, gamesPerPlayer: 9, typeMode: 'auto' }
);
assert.strictEqual(Math.round(nearPerfectQuality.avgLD * 100) / 100, 0.08, '테스트 대진 평균 실력차가 실제 사례와 같아야 합니다.');
assert.strictEqual(nearPerfectQuality.maxLD, 0.7, '테스트 대진 최대 실력차가 실제 사례와 같아야 합니다.');
assert.strictEqual(Math.round(nearPerfectQuality.sBalance), 40, '평균 0.08·최대 0.7은 경기 실력 균형 만점이어야 합니다.');
const diversityParticipants = [b1, b2, b3, b4, r1, r2, r3, r4];
const repeatedPartners = [
  match(1, 1, b1, b2, r1, r2),
  match(2, 1, b1, b2, r3, r4),
  match(3, 1, b3, b4, r1, r2),
  match(4, 1, b3, b4, r3, r4),
];
const diversePartners = [
  match(1, 1, b1, b2, r1, r2),
  match(2, 1, b3, b4, r3, r4),
  match(3, 1, b1, b3, r1, r3),
  match(4, 1, b2, b4, r2, r4),
];
const repeatedPartnerScore = sandbox._bracketQualityScore(repeatedPartners, diversityParticipants, settings);
const diversePartnerScore = sandbox._bracketQualityScore(diversePartners, diversityParticipants, settings);
assert(
  diversePartnerScore < repeatedPartnerScore,
  '실력 균형이 같다면 파트너 반복이 적은 후보가 더 낮은 품질 페널티를 받아야 합니다.'
);
assert(
  sandbox._isBetterQualityKey(
    sandbox._candidateQualityKey(diversePartners, diversityParticipants, settings, diversePartnerScore),
    sandbox._candidateQualityKey(repeatedPartners, diversityParticipants, settings, repeatedPartnerScore)
  ),
  '파트너 반복이 많은 후보보다 다양한 파트너 후보가 우선 선택되어야 합니다.'
);

assert(!src.includes("blocking.push('회피 가능한 연속 출전')"), '연속 출전만으로 재생성 권장을 띄우면 안 됩니다.');
assert(src.includes("caution.push(`연속 출전 ${excessConsec}건`)"), '연속 출전은 확인 후 진행 사유로 안내해야 합니다.');
assert(src.includes('파트너 재배정 과다'), '파트너 반복 과다는 재생성 권장 사유로 안내해야 합니다.');
assert(src.includes('상대 만남은 제외했습니다'), '파트너 반복 안내에서 상대 만남 제외를 명확히 알려야 합니다.');
assert(!src.includes('Math.min(total'), '품질 총점은 숨은 상한 없이 항목 점수 합산과 일치해야 합니다.');

console.log('team balance priority regression ok');
