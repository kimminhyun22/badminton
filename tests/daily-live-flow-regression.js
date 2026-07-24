const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js', 'daily.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function extractFunction(name, nextName) {
  const regular = src.indexOf(`function ${name}`);
  const asyncStart = src.indexOf(`async function ${name}`);
  const starts = [regular, asyncStart].filter(index => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  assert(start >= 0, `${name} 함수가 있어야 합니다.`);
  const end = src.indexOf(`function ${nextName}`, start);
  assert(end > start, `${name} 함수의 끝을 찾을 수 있어야 합니다.`);
  return src.slice(start, end);
}

const startGuide = extractFunction('dailyRenderStartGuide', 'dailyRenderOpsStats');
const stepNumbers = [...startGuide.matchAll(/\{n:(\d+)/g)].map(match => Number(match[1]));
assert.deepStrictEqual(stepNumbers, [1, 2], '운영 준비는 코트와 현장 참가 등록 2개만 필수로 보여야 합니다.');
assert(startGuide.includes('${requiredDone}/2'), '준비 진행률의 분모도 2여야 합니다.');
assert(!startGuide.includes('dailyShareCheckinLink'), '회원용 경기 링크는 운영 시작 필수 단계가 아니어야 합니다.');
assert(!startGuide.includes("action:'dailyBeginLiveTransition()'"), '준비 단계 안에 중복 운영 시작 동작이 있으면 안 됩니다.');

const finishTransition = extractFunction('dailyFinishLiveTransition', 'dailySetManualActiveCourt');
assert(finishTransition.includes('skipEmptyConfirm'), '명시적인 현재 경기 없음 동작은 중복 확인을 생략할 수 있어야 합니다.');
assert(
  indexHtml.includes('id="dailyTransitionFinishBtn" onclick="dailyFinishLiveTransition(true)"'),
  '현재 경기 없이 대진 게시 버튼은 명시적인 바로 게시 경로를 사용해야 합니다.'
);

const publicEvent = extractFunction('_dailyPublicEvent', 'dailyRenderResults');
assert(
  publicEvent.includes('queuePayload(q,next.length+idx,true)'),
  '예상 대진 번호는 목표 큐 수가 아니라 실제 게시된 다음 대진 수 바로 뒤에서 시작해야 합니다.'
);
assert(
  !publicEvent.includes('queuePayload(q,cap.target+idx,true)'),
  '무효 대진이 빠진 경우 예상 대진 번호에 공백이 생기는 계산을 사용하면 안 됩니다.'
);

const crossDayResume = extractFunction('_dailyCanResumeCrossDay', '_dailySavedDateLabel');
const resumeSandbox = {};
vm.createContext(resumeSandbox);
vm.runInContext(`
const DAILY_CROSS_DAY_RESUME_MS=6*60*60*1000;
${crossDayResume}
this.api={_dailyCanResumeCrossDay};
`, resumeSandbox);
const resumeNow = Date.UTC(2026, 6, 22, 0, 20);
const activeSession = {
  savedAt: resumeNow - 40 * 60 * 1000,
  operationStarted: true,
  checkinId: 'DOVERNIGHT',
  players: [{name:'김민현'}],
  matches: [{id:'m1'}],
  queue: []
};
assert.strictEqual(
  resumeSandbox.api._dailyCanResumeCrossDay(activeSession, resumeNow),
  true,
  '자정 직후의 활성 민턴LIVE는 이어서 불러와야 합니다.'
);
assert.strictEqual(
  resumeSandbox.api._dailyCanResumeCrossDay({...activeSession, savedAt:resumeNow-7*60*60*1000}, resumeNow),
  false,
  '6시간이 지난 이전 날짜 세션은 새날로 전환해야 합니다.'
);
assert.strictEqual(
  resumeSandbox.api._dailyCanResumeCrossDay({savedAt:resumeNow-10*60*1000,players:[{name:'김민현'}]}, resumeNow),
  false,
  '운영이나 링크가 시작되지 않은 이전 날짜 명단만 자동 복구하면 안 됩니다.'
);

const loadAsNewDay = extractFunction('_dailyLoadAsNewDay', 'dailyLoad');
assert(loadAsNewDay.includes('staleCheckinId'), '새날 전환 전에 이전 회원 링크 ID를 확보해야 합니다.');
assert(loadAsNewDay.includes("_fbDb.ref('live/checkin_'+staleCheckinId).remove()"), '새날 전환 시 이전 원격 회원 링크도 종료해야 합니다.');

const stopCheckin = extractFunction('dailyStopCheckinLink', 'dailyRenderCheckinRequests');
const code = `
let _dailyCheckinId='DTEST123';
let _dailyCheckinCreatedAt=123;
let _dailyCheckinRequests=[{key:'a'}];
let _dailyCheckinParty={p1:{attending:true}};
let _dailyCheckinListening=true;
let _dailyCheckinListeningPath='live/checkin_DTEST123';
const DAILY_CHECKIN_KEY='daily_checkin';
const DAILY_CHECKIN_CREATED_KEY='daily_checkin_created';
const calls=[];
const localStorage={
  values:{daily_checkin:'DTEST123',daily_checkin_created:'123'},
  removeItem(key){ delete this.values[key]; }
};
const _fbDb={ref(){ return {remove:async()=>{ calls.push('remove'); }}; }};
function _dailyCheckinPath(){ return 'live/checkin_'+_dailyCheckinId; }
function _dailyStopCheckinListener(){ _dailyCheckinListening=false;_dailyCheckinListeningPath='';calls.push('listener-stop'); }
function _dailyClearAdminGrant(){ calls.push('grant-clear'); }
function dailySave(){ calls.push('save'); }
function dailyRender(){ calls.push('render'); }
function confirm(){ return true; }
${stopCheckin}
this.api={dailyStopCheckinLink,state:()=>({
  id:_dailyCheckinId,
  createdAt:_dailyCheckinCreatedAt,
  requests:_dailyCheckinRequests,
  party:_dailyCheckinParty,
  listening:_dailyCheckinListening,
  calls:[...calls],
  values:{...localStorage.values}
})};
`;

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

(async () => {
  await sandbox.api.dailyStopCheckinLink();
  const state = sandbox.api.state();
  assert.strictEqual(state.id, null, '종료한 링크 ID는 메모리에서 제거되어야 합니다.');
  assert.strictEqual(state.values.daily_checkin, undefined, '종료한 링크 ID는 별도 저장소에서도 제거되어야 합니다.');
  assert.strictEqual(Object.keys(state.party).length, 0, '종료한 링크의 뒷풀이 응답도 메모리에서 제거되어야 합니다.');
  assert(state.calls.includes('listener-stop'), '종료한 링크의 실시간 구독을 먼저 해제해야 합니다.');
  assert(state.calls.includes('grant-clear'), '종료한 링크의 관리자 서버 권한도 함께 폐기해야 합니다.');
  assert(state.calls.includes('save'), '종료 상태를 일일 저장본에 즉시 저장해야 합니다.');
  assert(state.calls.includes('render'), '종료 직후 전체 상황판을 다시 그려야 합니다.');
  assert(state.calls.indexOf('save') < state.calls.indexOf('render'), '종료 상태 저장 후 화면을 갱신해야 합니다.');
  console.log('daily live flow regression ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
