const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js', 'team.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'team.html'), 'utf8');

const modeStart = src.indexOf('function _teamUsesFixedTeams');
const modeEnd = src.indexOf('function updateSettingsMiniSummary', modeStart);
assert(modeStart >= 0 && modeEnd > modeStart, '대진 방식 전환 함수를 찾을 수 있어야 합니다.');

const sandbox = {
  console,
  currentMatches: [],
  teamAssignment: null,
  _teamModeOverride: null,
  _teamWanted: true,
  confirmAllowed: true,
  generated: 0,
  captured: 0,
  updated: 0,
};
vm.createContext(sandbox);
vm.runInContext(`
var currentMatches=[];
var teamAssignment=null;
var _teamModeOverride=null;
var _teamWanted=true;
var confirmAllowed=true;
var generated=0;
var captured=0;
var updated=0;
function _teamConfirmOverwriteGeneratedBracket(){ return confirmAllowed; }
function _captureUndoSnapshot(){ captured++; }
function updateTeamModeBadge(){ updated++; }
function generate(){ generated++; }
${src.slice(modeStart, modeEnd)}
this.api={
  usesTeams:_teamUsesFixedTeams,
  setMode:setTeamMatchMode,
  state(){ return {currentMatches,teamAssignment,_teamModeOverride,_teamWanted,generated,captured,updated}; },
  setMatches(v){ currentMatches=v; },
  setAssignment(v){ teamAssignment=v; },
  setConfirm(v){ confirmAllowed=v; }
};
`, sandbox);

const api = sandbox.api;
assert.strictEqual(api.usesTeams(), true, '기본 대진 방식은 청·홍 팀전이어야 합니다.');
assert.strictEqual(api.setMode('free'), true, '대진 전에는 자유 대진으로 바로 전환되어야 합니다.');
assert.strictEqual(api.usesTeams(), false, '자유 대진 선택 상태가 유지되어야 합니다.');
assert.strictEqual(api.state().generated, 0, '대진 전 모드 선택만으로 대진을 생성하면 안 됩니다.');

api.setAssignment({ blue: [{ name: '청1' }], white: [{ name: '홍1' }] });
api.setMatches([{ round: 1 }]);
assert.strictEqual(api.setMode('team'), true, '기존 자유 대진은 확인 후 청·홍 팀전으로 전환되어야 합니다.');
assert.strictEqual(api.usesTeams(), true, '청·홍 팀전 선택이 반영되어야 합니다.');
assert.strictEqual(api.state().teamAssignment, null, '자유 대진에서 팀전으로 바꿀 때는 팀을 새로 배정해야 합니다.');
assert.strictEqual(api.state().generated, 1, '기존 대진의 방식 변경은 새 대진 생성으로 이어져야 합니다.');
assert.strictEqual(api.state().captured, 1, '방식 변경 전 되돌리기 상태를 남겨야 합니다.');

api.setConfirm(false);
assert.strictEqual(api.setMode('free'), false, '사용자가 경고를 취소하면 대진 방식을 바꾸면 안 됩니다.');
assert.strictEqual(api.usesTeams(), true, '취소 후 기존 청·홍 팀전 상태가 유지되어야 합니다.');

assert(html.includes('id="teamModeTeamBtn"'), '청·홍 팀전 선택 버튼이 보여야 합니다.');
assert(html.includes('id="teamModeFreeBtn"'), '자유 대진 선택 버튼이 보여야 합니다.');
assert(html.includes("setTeamMatchMode('free')"), '자유 대진 버튼이 실제 모드 전환 함수와 연결되어야 합니다.');

const generateBody = src.slice(src.indexOf('function generate(opts={})'), src.indexOf('function generateMatches'));
assert(generateBody.includes('const useFixedTeams=_teamUsesFixedTeams()'), '대진 생성은 현재 선택한 방식을 읽어야 합니다.');
assert(generateBody.includes('if(useFixedTeams&&!teamAssignment)'), '청·홍 팀전에서만 자동 팀 배정을 실행해야 합니다.');
assert(generateBody.includes('teamMode: useFixedTeams&&!!teamAssignment'), '자유 대진 저장 설정에 teamMode=false가 들어가야 합니다.');
assert(src.includes("matchMode:_teamUsesFixedTeams()?'team':'free'"), '선택한 대진 방식을 저장해야 합니다.');
assert(src.includes("state.matchMode==='free'"), '저장된 자유 대진을 불러올 때 방식을 복원해야 합니다.');
assert(src.includes("_autoFlowPanel('방식'"), '상단 운영 보드에서 현재 대진 방식을 보여야 합니다.');

console.log('team free mode regression ok');
