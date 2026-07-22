const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const dailySrc = fs.readFileSync(path.join(root, 'js', 'daily.js'), 'utf8');
const checkinSrc = fs.readFileSync(path.join(root, 'checkin.html'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function extractFunction(src, name, nextName) {
  const regular = src.indexOf(`function ${name}`);
  const asyncStart = src.indexOf(`async function ${name}`);
  const starts = [regular, asyncStart].filter(index => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  assert(start >= 0, `${name} 함수가 있어야 합니다.`);
  const end = src.indexOf(`function ${nextName}`, start);
  assert(end > start, `${name} 함수의 끝을 찾을 수 있어야 합니다.`);
  return src.slice(start, end);
}

const importSelected = extractFunction(dailySrc, 'importDailySelected', 'syncFixedTeamNames');
assert(importSelected.includes("status='wait'"), '현장 등록 선수는 즉시 참가 상태여야 합니다.');
assert(importSelected.includes("['invited','planned']"), '전날 등록 전 명단은 현장에서 다시 참가 등록할 수 있어야 합니다.');
assert(!importSelected.includes('dailyShareCheckinLink'), '현장 참가 등록 뒤 회원 링크를 강제로 공유하면 안 됩니다.');
assert.strictEqual(
  (indexHtml.match(/importDailySelected\('wait'\)/g) || []).length,
  1,
  '명부 모달에는 현장 참가 등록 동작 하나만 있어야 합니다.'
);
assert(!indexHtml.includes("importDailySelected('invited')"), '회원 자가 출석을 전제로 한 등록 전 추가 버튼은 노출하면 안 됩니다.');

const renderImport = extractFunction(dailySrc, 'renderDailyImportMembers', 'toggleDailySelectAll');
assert(renderImport.includes('checked=!isDup&&prevChecked.has'), '관리자가 직접 고른 선수만 선택 상태여야 합니다.');
assert(!renderImport.includes('firstRender'), '명부를 열자마자 전원을 자동 선택하면 안 됩니다.');

const adminAlerts = extractFunction(dailySrc, 'dailyRenderAdminAlerts', 'dailyCurrentStage');
const currentStage = extractFunction(dailySrc, 'dailyCurrentStage', 'dailyOpenBoardTarget');
const actionItems = extractFunction(dailySrc, 'dailyCountActionItems', 'dailyRenderUnscheduled');
assert(!adminAlerts.includes("else if(!_dailyCheckinId)"), '회원 링크가 없다는 이유로 중요 알림을 띄우면 안 됩니다.');
assert(!currentStage.includes('_dailyCheckinId'), '회원 링크가 운영 단계 판정을 막으면 안 됩니다.');
assert(!actionItems.includes('_dailyCheckinId'), '회원 링크가 관리자 조치 필요 건수에 포함되면 안 됩니다.');

const transitionCandidates = extractFunction(dailySrc, '_dailyManualActiveCandidates', '_dailyManualEscape');
const candidateSandbox = {
  _dailyPlayers: [
    {id:'wait', name:'참가', status:'wait', games:0, waitFrom:1},
    {id:'rest', name:'휴식', status:'rest', games:0, waitFrom:1},
    {id:'invited', name:'등록전', status:'invited', games:0, waitFrom:1},
    {id:'done', name:'종료', status:'done', games:0, waitFrom:1}
  ],
  _dailyActiveMatches: () => [],
  _dailyMatchPlayers: () => [],
  _dailyNormalizeStatus: status => status
};
vm.createContext(candidateSandbox);
vm.runInContext(`${transitionCandidates}\nthis.pick=()=>_dailyManualActiveCandidates('transition').map(p=>p.id);`, candidateSandbox);
assert.deepStrictEqual(
  Array.from(candidateSandbox.pick()),
  ['wait'],
  '계속 진행할 경기에는 현장 참가 상태 선수만 선택할 수 있어야 합니다.'
);

const finishTransition = extractFunction(dailySrc, 'dailyFinishLiveTransition', 'dailySetManualActiveCourt');
const operationStart = finishTransition.indexOf('_dailyOperationStarted=true');
assert(operationStart >= 0, '대진 게시 시 운영 시작 상태를 저장해야 합니다.');
assert(operationStart < finishTransition.indexOf('dailyEnsureQueue()', operationStart), '운영 시작을 확정한 뒤 나머지 자동대진을 만들어야 합니다.');
assert(operationStart < finishTransition.indexOf('dailyMaybeAutoAssign()', operationStart), '대진 게시 전에는 빈 코트 자동 투입을 시작하면 안 됩니다.');

assert(!checkinSrc.includes('출석'), '회원 화면에는 자가 출석 개념이 남아 있으면 안 됩니다.');
assert(checkinSrc.includes('현재 경기와 다음 순서'), '회원 첫 화면은 경기 확인 목적을 바로 알려야 합니다.');
const statusActionKeys = extractFunction(checkinSrc, 'statusActionKeys', 'statusButtons');
const actionSandbox = {getSelectedStatus: player => player.status};
vm.createContext(actionSandbox);
vm.runInContext(`${statusActionKeys}\nthis.keys=status=>statusActionKeys({status},['wait','rest','done']);`, actionSandbox);
assert.deepStrictEqual(Array.from(actionSandbox.keys('wait')), ['rest','done'], '참가 중에는 휴식과 종료만 보여야 합니다.');
assert.deepStrictEqual(Array.from(actionSandbox.keys('rest')), ['wait','done'], '휴식 중에는 복귀와 종료를 보여야 합니다.');
assert.deepStrictEqual(Array.from(actionSandbox.keys('done')), ['wait'], '운동 종료 뒤에는 복귀만 보여야 합니다.');

const renderEvent = extractFunction(checkinSrc, 'renderEvent', 'statusButtonSpec');
assert(renderEvent.includes('if(!viewer||!viewer.playerId)'), '본인 이름 선택 전에는 전체 경기판을 기본 노출하면 안 됩니다.');
assert(checkinSrc.includes("checkinId=officialLink.checkinId||qs('id')||(sampleMode?'SAMPLE':'')"), '회원 샘플 화면은 별도 링크 ID 없이도 열려야 합니다.');
const payload = extractFunction(dailySrc, '_dailyCheckinPayload', 'dailyEnsureCheckinId');
assert(payload.includes('lastStatusAt:p.lastStatusAt||0'), '회원 화면은 관리자 상태 변경 시각을 받아 오래된 요청 표시를 덮어써야 합니다.');

console.log('daily semi-auto regression ok');
