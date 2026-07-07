const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'team.js'), 'utf8');
const effBlock = src.slice(0, src.indexOf('const BALANCE_PARTNER_GAP_OK'));
const helperBlock = src.slice(
  src.indexOf('function _teamGenderCode'),
  src.indexOf('function saveState()')
);

const sandbox = {
  levelToGrade(){ return 'C'; },
};
vm.createContext(sandbox);
vm.runInContext(effBlock + helperBlock, sandbox);

const restored = sandbox._teamEnrichAssignmentProfiles(
  {
    blue: [{ name: '청A', level: 6, gender: 'M', team: '청팀' }],
    white: [{ name: '홍A', level: 6, gender: 'M', team: '홍팀' }],
  },
  [
    { name: '청A', level: 6, gender: 'M', ageGroup: '50대', team: '청팀' },
    { name: '홍A', level: 6, gender: 'M', ageGroup: '40대', team: '홍팀' },
  ]
);

assert.strictEqual(restored.blue[0].ageGroup, '50대', '복원 시 청팀 선수 나이대가 보강되어야 합니다.');
assert.strictEqual(restored.white[0].ageGroup, '40대', '복원 시 홍팀 선수 나이대가 보강되어야 합니다.');
assert.strictEqual(sandbox.effLevel(restored.blue[0]), 4.8, '50대 보정 실효 레벨을 유지해야 합니다.');
assert.strictEqual(sandbox.effLevel(restored.white[0]), 5.5, '40대 보정 실효 레벨을 유지해야 합니다.');

assert(src.includes("ageGroup:p.ageGroup||'40대',partnerName"), 'teamAssignment 저장본에 ageGroup이 포함되어야 합니다.');
assert(
  src.includes('_teamEnrichAssignmentProfiles(state.teamAssignment,state.participants||[],state.directPlayers||[],_directPlayers||[])'),
  '구버전 저장본 복원 시 최신 참가자 프로필까지 반영해 teamAssignment를 보강해야 합니다.'
);
assert(src.includes('function _teamSyncGeneratedProfilesFromDirectPlayers()'), '생성된 대진의 선수 프로필을 최신 참가자 정보로 동기화해야 합니다.');
assert(src.includes('showWarn(\'명부의 급수 수정이 현재 팀 목록과 대진표에 반영됐습니다.'), '급수 수정 반영 후 새 대진 생성을 안내해야 합니다.');
assert(src.includes('currentMatches.length&&!opts.forGenerate'), '기존 대진표가 있을 때 단독 팀 재배정을 막아야 합니다.');
assert(src.includes('doTeamAssign({forGenerate:true})'), '대진표 재생성 내부 배정은 허용해야 합니다.');

console.log('team balance restore regression ok');
