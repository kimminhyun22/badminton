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
  publicEvent.includes('const expected=[]')&&publicEvent.includes('const serverStandby=[]'),
  '민턴라이브는 코트 수를 넘는 예상·서버 대기 대진을 미리 생성하면 안 됩니다.'
);
assert(
  !publicEvent.includes('_dailyProjectedQueue('),
  '회원 세션 게시 과정에서 코트 수 밖의 예상 대진을 만들면 안 됩니다.'
);
assert(publicEvent.includes('_dailyFinishMode&&!queuedCount&&!st.active.length'),'진행 경기가 남아 있으면 회원 화면을 마무리 완료로 표시하면 안 됩니다.');
const finishPlan=extractFunction('_dailyFinishPlanInfo','_dailyFinishEtaLabel');
const finishEta=extractFunction('_dailyFinishEtaLabel','dailyToggleFinishMode');
const finishSandbox={};
vm.createContext(finishSandbox);
vm.runInContext(`
const DAILY_MATCH_MINUTES=15;
let _dailyQueue=[];
let active=[];
function _dailyQueueItemValid(){return true;}
function _dailyCourtCount(){return 3;}
function _dailyActiveMatches(){return active;}
function _dailyRemainingMinutes(match){return match.remain;}
${finishPlan}
${finishEta}
this.api={
  set(queueCount,remaining){_dailyQueue=Array.from({length:queueCount},()=>({}));active=remaining.map(remain=>({remain}));},
  plan:_dailyFinishPlanInfo
};
`,finishSandbox);
finishSandbox.api.set(3,[5,5,5]);
assert.strictEqual(finishSandbox.api.plan().etaMin,20,'현재 경기 뒤 다음 세 경기를 마치려면 시작 시각이 아니라 최종 종료까지 20분으로 계산해야 합니다.');
finishSandbox.api.set(0,[12,7,3]);
assert.strictEqual(finishSandbox.api.plan().etaMin,12,'다음 대진이 없어도 진행 중인 마지막 경기 종료까지 남은 시간을 보여야 합니다.');
finishSandbox.api.set(0,[]);
assert.strictEqual(finishSandbox.api.plan().etaMin,0,'진행·다음 대진이 모두 없을 때만 바로 자율게임이어야 합니다.');
const queueTarget=extractFunction('_dailyQueueTarget','_dailyQueueCapacity');
assert(queueTarget.includes('return _dailyFinishMode?Math.min(base,_dailyQueue.length):base;'),'다음 대진 목표는 사용 코트 수를 넘지 않아야 합니다.');
assert(!queueTarget.includes('boost')&&!queueTarget.includes('extra'),'종료 임박이나 여유 인원 때문에 다음 대진 수를 늘리면 안 됩니다.');
const expectedTarget=extractFunction('_dailyExpectedQueueTarget','_dailyProjectedCandidatePlayers');
assert(expectedTarget.includes('return 0;'),'별도 예상 대진 목표는 항상 0이어야 합니다.');
const renderQueue=extractFunction('dailyRenderQueue','dailyRenderRecommend');
assert(!renderQueue.includes('dailyEnsureQueue()'),'대진 화면을 그리는 함수가 게시되지 않은 새 대진을 따로 만들면 안 됩니다.');
const renderAll=extractFunction('dailyRender','_rsvpDefaultTitle');
assert(renderAll.includes('const queueChanged=_dailyPaused?false:dailyEnsureQueue();')&&renderAll.includes('if(queueChanged)dailySave();'),'관리자 화면에서 대진이 정리되면 같은 배열을 회원 화면에도 즉시 게시해야 합니다.');

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
  '자정 직후의 활성 민턴라이브는 이어서 불러와야 합니다.'
);
assert.strictEqual(
  resumeSandbox.api._dailyCanResumeCrossDay({...activeSession, savedAt:resumeNow-7*60*60*1000}, resumeNow),
  false,
  '6시간이 지난 이전 날짜 세션은 새날로 전환해야 합니다.'
);
assert.strictEqual(
  resumeSandbox.api._dailyCanResumeCrossDay({savedAt:resumeNow-10*60*1000,players:[{name:'김민현'}]}, resumeNow),
  false,
  '준비 명단은 이전 LIVE 전체 재개가 아니라 새날 준비본 보존 경로로 처리해야 합니다.'
);

const preparationState = extractFunction('_dailyPreparationState', '_dailyPreparationResetPlayer');
const preparationSandbox = {};
vm.createContext(preparationSandbox);
vm.runInContext(`
const DAILY_PREPARATION_RETENTION_MS=7*24*60*60*1000;
function _dailyNow(){return ${resumeNow};}
${preparationState}
this.api={_dailyPreparationState};
`, preparationSandbox);
assert.strictEqual(
  preparationSandbox.api._dailyPreparationState({savedAt:resumeNow-2*24*60*60*1000,players:[{name:'김민현'}]},resumeNow),
  true,
  '7일 이내의 미시작 선수 등록은 준비 명단으로 보존해야 합니다.'
);
assert.strictEqual(
  preparationSandbox.api._dailyPreparationState({...activeSession},resumeNow),
  false,
  '이미 시작한 LIVE는 준비 명단으로 바꾸면 안 됩니다.'
);
assert.strictEqual(
  preparationSandbox.api._dailyPreparationState({savedAt:resumeNow-8*24*60*60*1000,players:[{name:'김민현'}]},resumeNow),
  false,
  '7일이 지난 준비 명단은 자동 승계하지 않아야 합니다.'
);

const loadAsNewDay = extractFunction('_dailyLoadAsNewDay', 'dailyLoad');
assert(!loadAsNewDay.includes(".remove()"), '새날 전환만으로 소유권을 확인하지 않은 원격 회원 링크를 삭제하면 안 됩니다.');
assert(loadAsNewDay.includes('localStorage.removeItem(DAILY_CHECKIN_KEY)'), '새날 전환 시 이전 회원 링크의 로컬 연결은 해제해야 합니다.');

const stopCheckin = extractFunction('dailyStopCheckinLink', 'dailyRenderCheckinRequests');
const clearTemporaryOfficials = extractFunction('_dailyClearTemporaryOfficials', '_dailyRebuildLiveTypeCounts');
const code = `
let _dailyCheckinId='DTEST123';
let _dailyCheckinCreatedAt=123;
let _dailyCheckinRequests=[{key:'a'}];
let _dailyCheckinParty={p1:{attending:true}};
let _dailyCheckinListening=true;
let _dailyCheckinListeningPath='live/checkin_DTEST123';
let _dailyCheckinOwnershipVerified=true;
let _dailyCheckinIdentityPending=false;
let _dailyRemoteCheckinExpiresAt=0;
let _dailyCrossTabIdentityPending=false;
let _dailyCapabilityEpoch=0;
let _dailyCapabilityPromise=null;
let _dailyServerRevision=0;
let _dailyServerLastRequestId='';
let _dailyOfficialInviteToken='token';
let _dailyOfficialInviteHash='hash';
let _dailyServerReconcileError='';
let _dailyPlayers=[{id:'helper',isTemporaryOfficial:true,temporaryOfficialGrantedAt:100,temporaryOfficialGrantedBy:'official',temporaryOfficialGrantedByName:'임원'}];
const DAILY_CHECKIN_KEY='daily_checkin';
const DAILY_CHECKIN_CREATED_KEY='daily_checkin_created';
const calls=[];
const localStorage={
  values:{daily_checkin:'DTEST123',daily_checkin_created:'123'},
  removeItem(key){ delete this.values[key]; }
};
const _fbDb={ref(){ return {remove:async()=>{ calls.push('remove'); }}; }};
function _dailyCheckinPath(){ return 'live/checkin_'+_dailyCheckinId; }
function _dailyIdentitySnapshot(){ return {id:_dailyCheckinId,hash:_dailyOfficialInviteHash}; }
async function _dailyRemoveOwnedCheckin(){ calls.push('remove');return true; }
function _dailyStopCheckinListener(){ _dailyCheckinListening=false;_dailyCheckinListeningPath='';calls.push('listener-stop'); }
function _dailyClearAdminGrant(){ calls.push('grant-clear'); }
function dailySave(){ calls.push('save'); }
function dailyRender(){ calls.push('render'); }
function confirm(){ return true; }
${clearTemporaryOfficials}
${stopCheckin}
this.api={dailyStopCheckinLink,state:()=>({
  id:_dailyCheckinId,
  createdAt:_dailyCheckinCreatedAt,
  requests:_dailyCheckinRequests,
  party:_dailyCheckinParty,
  players:_dailyPlayers,
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
  assert.strictEqual(state.players[0].isTemporaryOfficial, false, '종료한 링크의 임시 운영 권한도 함께 제거되어야 합니다.');
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
