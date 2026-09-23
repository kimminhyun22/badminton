'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');

const root=process.env.REGISTRATION_SIMPLIFICATION_SOURCE_ROOT
  ? path.resolve(process.env.REGISTRATION_SIMPLIFICATION_SOURCE_ROOT)
  : path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const index=read('index.html');
const team=read('team.html');
const checkin=read('checkin.html');
const daily=read('js/daily.js');

function sourceBetween(src,startToken,endToken){
  const start=src.indexOf(startToken);
  assert(start>=0,`${startToken} 시작을 찾지 못했습니다.`);
  const end=src.indexOf(endToken,start+startToken.length);
  assert(end>start,`${endToken} 끝을 찾지 못했습니다.`);
  return src.slice(start,end);
}

const dailyModal=sourceBetween(index,'id="dailyImportModal"','<!-- ── 민턴LIVE 자율게임 등록 모달');
assert.strictEqual((dailyModal.match(/onclick="importDailySelected\(\)"/g)||[]).length,1,
  '민턴LIVE 명부 등록은 단일 버튼이어야 합니다.');
assert(!dailyModal.includes("importDailySelected('planned')")&&!dailyModal.includes("importDailySelected('wait')"),
  '민턴LIVE 등록 버튼에서 도착 상태를 고르게 하면 안 됩니다.');
assert.strictEqual((dailyModal.match(/onclick="dailyImportAddGuest\(\)"/g)||[]).length,1,
  '게스트도 단일 등록 버튼이어야 합니다.');
assert(!dailyModal.includes('dailyImportGuestPlannedBtn')&&!dailyModal.includes('daily-prearrival-btn'),
  '도착 전 등록 전용 버튼이 다시 생기면 안 됩니다.');
assert(dailyModal.includes('아직 안 온 선수만 선수 목록에서 「도착 전」'),
  '등록 뒤 도착 전 상태를 바꾸는 위치를 짧게 알려야 합니다.');

const adminImport=sourceBetween(daily,'async function importDailySelected()','/* ═══ TEAM NAME CHANGE');
assert(adminImport.includes("status:'wait'")&&!adminImport.includes("status==='planned'"),
  '관리자 명부 등록은 참가 상태 한 경로만 사용해야 합니다.');
const guestImport=sourceBetween(daily,'async function dailyImportAddGuest()','function dailyImportRoster');
assert(guestImport.includes("status:'wait'")&&!guestImport.includes("status==='planned'"),
  '관리자 게스트 등록도 참가 상태 한 경로만 사용해야 합니다.');

const officialPicker=sourceBetween(checkin,'function _officialRosterPickRender()','function toggleOfficialRosterSetupCandidate');
assert.strictEqual((officialPicker.match(/sendOfficialRosterSetup\('/g)||[]).length,1,
  '임원 명부 등록도 단일 버튼이어야 합니다.');
assert(!officialPicker.includes("'planned'")&&!officialPicker.includes("'wait'"),
  '임원 명부 버튼에서 상태를 고르게 하면 안 됩니다.');
const officialSubmit=sourceBetween(checkin,'async function sendOfficialRosterSetup(actorId)','async function sendOfficialCourtCancel');
assert(officialSubmit.includes("const status='wait'"),
  '임원 명부 등록은 참가 상태로 고정해야 합니다.');

const adminActions=sourceBetween(daily,'function _dailyPlayerRowActions(p)','function _dailyIcon');
const officialActions=sourceBetween(checkin,'function officialOverviewStatusButtons(actor,target,viewKey)','function setOfficialOverviewMode');
[adminActions,officialActions].forEach((src,index)=>{
  assert(src.includes("label:'경기 후 휴식'")&&src.includes("label:'경기 후 종료'"),
    `${index?'임원':'관리자'} 경기중 상태 동작이 명확해야 합니다.`);
  assert(src.includes("status==='done'")&&src.includes("label:'복귀'"),
    `${index?'임원':'관리자'} 종료 선수에게는 복귀 동작이 있어야 합니다.`);
  assert(src.includes('Number(')&&src.includes('games||0')&&src.includes('도착 전'),
    `${index?'임원':'관리자'}은 경기 전 오등록을 도착 전으로 바꿀 수 있어야 합니다.`);
});

assert(index.includes('onclick="importSelected()">등록</button>')&&team.includes('onclick="importSelected()">등록</button>'),
  '팀전 참가자 선택도 등록이라는 같은 문구를 써야 합니다.');
assert(daily.includes("{label:'전체',value:count.total")&&checkin.includes("{key:'total',label:'전체'"),
  '관리자와 임원 현황의 총원 명칭은 전체로 같아야 합니다.');
assert(daily.includes("status:'planned'")&&checkin.includes("['invited','planned']"),
  '도착 전 상태 자체는 사라지면 안 됩니다.');

console.log('registration simplification regression ok');
