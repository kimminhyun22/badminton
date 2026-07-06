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
  return { underSlots:0, overSlots:0, avoidableUnderSlots:0, avoidableOverSlots:0 };
}
`;
const scoringBlock = src.slice(
  src.indexOf('function _bracketQualityScore'),
  src.indexOf('function _isBetterQualityKey') + 'function _isBetterQualityKey(next,best){\n  if(!best)return true;\n  for(let i=0;i<next.length;i++){\n    if(next[i]!==best[i])return next[i]<best[i];\n  }\n  return false;\n}'.length
);

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(prefix + stubs + scoringBlock, sandbox);

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

console.log('team balance priority regression ok');
