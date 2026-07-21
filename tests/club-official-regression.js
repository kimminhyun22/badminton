const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.join(__dirname,'..');
const teamSrc=fs.readFileSync(path.join(root,'js','team.js'),'utf8');
const dailySrc=fs.readFileSync(path.join(root,'js','daily.js'),'utf8');
const liveSrc=fs.readFileSync(path.join(root,'js','live-view.js'),'utf8');
const checkin=fs.readFileSync(path.join(root,'checkin.html'),'utf8');
const indexHtml=fs.readFileSync(path.join(root,'index.html'),'utf8');
const teamHtml=fs.readFileSync(path.join(root,'team.html'),'utf8');

function functionSource(src,name,nextName){
  const start=src.indexOf(`function ${name}`);
  const end=src.indexOf(`function ${nextName}`,start+1);
  assert(start>=0&&end>start,`${name} 함수 범위를 찾을 수 있어야 합니다.`);
  return src.slice(start,end);
}

assert(indexHtml.includes('id="memberOfficial"')&&teamHtml.includes('id="memberOfficial"'),'두 LIVE 명부에서 같은 클럽 임원 체크를 제공해야 합니다.');
assert(teamSrc.includes('isClubOfficial:!!p.isClubOfficial'),'팀 배정과 저장에서 임원 역할을 보존해야 합니다.');
assert(teamSrc.includes('isClubOfficial:!!m.isClubOfficial'),'명부에서 팀전 참가자로 임원 역할을 전달해야 합니다.');
assert(teamSrc.includes('clubOfficials:currentParticipants.filter'),'현재 참가한 임원만 팀전LIVE 운영 명단에 포함해야 합니다.');
assert(liveSrc.includes('viewer.isClubOfficial'),'팀전LIVE 회원 페이지에서 클럽 임원의 승패 입력을 허용해야 합니다.');
assert(dailySrc.includes('officialOpsV1:true'),'민턴LIVE 회원 페이지에 임원 운영 기능 계약을 게시해야 합니다.');
assert(dailySrc.includes('officialArrivalV1:true'),'민턴LIVE 세션이 임원의 지각 선수 참가 등록 기능을 명시해야 합니다.');
assert(dailySrc.includes('arrivalCandidates:_dailyOfficialArrivalCandidates()'),'임원 화면에는 관리자 원본이 승인한 해당 클럽 참가 후보만 게시해야 합니다.');
assert(dailySrc.includes('officialQueueYieldV1:true'),'민턴LIVE 세션이 임원의 다음 대진 순서 조정 기능을 명시해야 합니다.');
assert(dailySrc.includes('officialQueueYieldV2:true'),'민턴LIVE 세션이 임원의 다중 순번 이동 기능을 명시해야 합니다.');
assert(dailySrc.includes('officialQueueCardOpsV1:true'),'민턴LIVE 세션이 임원의 카드 내 입장·이번만 뒤로 기능을 명시해야 합니다.');
assert(dailySrc.includes('isClubOfficial:!!p.isClubOfficial'),'민턴LIVE 참가자 세션에 임원 역할을 전달해야 합니다.');
assert(dailySrc.includes("source:'club-official-complete'"),'임원 경기 종료는 관리자 원본에서 별도 출처로 기록해야 합니다.');
assert(functionSource(dailySrc,'importDirectFromDaily','openEditDirectPlayer').includes('isClubOfficial:!!p.isClubOfficial'),'민턴LIVE 참가자를 팀전으로 가져올 때 임원 역할을 보존해야 합니다.');
assert(functionSource(dailySrc,'dailyReset','dailyToggleAutoAssign').includes('_dailyStopOperatorHeartbeat'),'민턴LIVE 초기화 시 운영 연결과 화면 켜짐 요청을 정리해야 합니다.');
assert(checkin.includes('클럽 임원 운영'),'회원 페이지에서 임원 중심 운영 화면을 제공해야 합니다.');
assert(indexHtml.includes('임원이 두 선수를 접수합니다.')&&indexHtml.includes('뒷풀이 참석은 내 카드에서 직접 신청하거나 취소합니다.'),'사용 안내도 임원 파트너 접수와 회원 뒷풀이 신청 정책을 따라야 합니다.');
assert(!checkin.includes('관리자 앱 연결 필요'),'임원 화면이 시스템 관리자 호출을 일상 운영의 전제로 보여주면 안 됩니다.');
assert(checkin.includes("connected?'운영 엔진 정상':'연결 복구 중'"),'연결 상태는 관리자 호출이 아닌 비차단 운영 상태로 표시해야 합니다.');
const officialPush=functionSource(checkin,'pushOfficialRequest','sendOfficialPartnerReservation');
assert(!officialPush.includes("if(!operatorConnected())"),'운영 연결이 잠시 끊겨도 임원 요청 저장을 막으면 안 됩니다.');
assert(checkin.includes("source:'club-official-support'"),'임원 요청을 일반 회원 요청과 구분해야 합니다.');
const memberQueueNotice=functionSource(checkin,'nextQueueNoticeHtml','refreshMyQueueNotice');
assert(!memberQueueNotice.includes('sendQueueEnterFree'),'일반 회원의 다음 대진 카드에서 직접 입장 처리를 제공하면 안 됩니다.');
assert(!memberQueueNotice.includes('openCourtCompletePicker'),'일반 회원의 다음 대진 카드에서 코트 선택을 제공하면 안 됩니다.');
assert(memberQueueNotice.includes('sendQueueRestPass'),'일반 회원은 입장 직전에도 조금 쉬고 요청을 보낼 수 있어야 합니다.');
assert(memberQueueNotice.includes('sendQueueDefer'),'일반 회원의 기존 이번만 뒤로 기능은 유지해야 합니다.');
const memberEventBoard=functionSource(checkin,'renderEvent','render');
assert(!memberEventBoard.includes('sendQueueEnterFree'),'일반 회원 상황판에서도 직접 입장 처리를 제공하면 안 됩니다.');
assert(!memberEventBoard.includes('openCourtCompletePicker'),'일반 회원 상황판에서도 코트 선택을 제공하면 안 됩니다.');
assert(memberEventBoard.includes('sendQueueRestPass'),'일반 회원 상황판의 조금 쉬고 요청은 유지해야 합니다.');
assert(memberEventBoard.includes('canOfficialOperate')&&memberEventBoard.includes('event-official-complete'),'클럽 임원의 경기 종료 버튼은 진행 중 코트 카드 안에 있어야 합니다.');
assert(memberEventBoard.includes('officialQueueCardActionsHtml'),'클럽 임원의 입장 처리와 이번만 뒤로 버튼은 해당 다음 대진 카드 안에 있어야 합니다.');
assert(checkin.includes('event-official-enter')&&checkin.includes('event-official-yield'),'다음 대진 카드에서 입장 처리와 이번만 뒤로를 한눈에 구분해야 합니다.');
assert(memberEventBoard.includes('placeEventPanelForViewer(canOfficialOperate)'),'임원은 개인 카드보다 진행 코트와 종료 버튼을 먼저 볼 수 있어야 합니다.');
assert(checkin.includes("main:'입장 준비',detail:'클럽 임원 확인 중'"),'일반 회원에게 클럽 임원 처리 대기 상태를 명확히 보여야 합니다.');
assert(checkin.includes("onclick=\"sendOfficialCourtComplete"),'클럽 임원의 경기 종료 기능은 유지해야 합니다.');
assert(checkin.includes("onclick=\"sendOfficialQueueEnter"),'클럽 임원의 빈 코트 입장 처리 기능은 유지해야 합니다.');
assert(checkin.includes('지각 선수 참가 등록')&&checkin.includes("type:'official-player-arrival'"),'클럽 임원은 등록 전 선수를 현장에서 바로 참가 등록할 수 있어야 합니다.');
assert(checkin.includes("officialArrivalV1!==true"),'구 관리자 세션에서는 지원되지 않는 지각 참가 등록 도구를 숨겨야 합니다.');
assert(checkin.includes('대진 순서 상세 조정')&&checkin.includes("type:'official-queue-yield'"),'클럽 임원은 특정 다음 대진을 선택한 순번까지 보낼 수 있어야 합니다.');
assert(checkin.includes("officialQueueYieldV1!==true"),'구 관리자 세션에서는 지원되지 않는 임원 순서 조정 버튼을 숨겨야 합니다.');
assert(checkin.includes('expectedTeam1Ids:team1Ids')&&checkin.includes('expectedTeam2Ids:team2Ids')&&checkin.includes('targetQueueIndex'),'임원 순서 조정 요청은 화면에서 확인한 두 팀 구성과 목적 순번까지 전달해야 합니다.');
assert(!functionSource(checkin,'officialSupportHtml','refreshOfficialConnection').includes('sendOfficialCourtComplete'),'클럽 임원 운영 도구에 진행 코트 종료 목록을 중복 표시하면 안 됩니다.');
assert(functionSource(checkin,'refreshOfficialConnection','renderMyCard').includes("btn.dataset.officialPending==='true'"),'연결 상태가 갱신되어도 처리 중인 임원 순서 조정 버튼이 다시 활성화되면 안 됩니다.');
const memberQueueSend=functionSource(checkin,'sendQueueDefer','sendQueueEnterFree');
assert(memberQueueSend.includes('expectedPlayerIds')&&memberQueueSend.includes('expectedTeam1Ids')&&memberQueueSend.includes('expiresAt'),'회원의 기존 뒤로 미루기도 오래된 다른 대진에 적용되지 않도록 지문과 만료시간을 보내야 합니다.');
const officialQueueUiCode=`
let session={capabilities:{officialQueueYieldV1:true,officialQueueYieldV2:true},event:{active:[{id:'m1'},{id:'m2'},{id:'m3'}]}};
let officialRequests=[];
let list=[];
function eventNextList(){return list;}
function teamNames(q){return (q.t1||[]).join(' ')+' vs '+(q.t2||[]).join(' ');}
function esc(v){return String(v||'');}
${functionSource(checkin,'officialQueueYieldTarget','officialQueueCardActionsHtml')}
${functionSource(checkin,'officialQueueYieldToolsHtml','officialSupportHtml')}
this.api={render:()=>officialQueueYieldToolsHtml({id:'official'},''),setList:v=>list=v,setRequests:v=>officialRequests=v,setCapabilities:v=>session.capabilities=v};`;
const officialQueueUiSandbox={};
vm.createContext(officialQueueUiSandbox);
vm.runInContext(officialQueueUiCode,officialQueueUiSandbox);
const uiQ1={idx:1,queueId:'q1',cueState:'soon',t1:['A','B'],t2:['C','D']};
const uiQ2={idx:2,queueId:'q2',cueState:'ready',t1:['E','F'],t2:['G','H']};
const uiQ3={idx:3,queueId:'q3',cueState:'ready',t1:['I','J'],t2:['K','L']};
const uiQ4={idx:4,queueId:'q4',cueState:'ready',t1:['M','N'],t2:['O','P']};
officialQueueUiSandbox.api.setList([uiQ1,uiQ2,uiQ3,uiQ4]);
const rangeQueueHtml=officialQueueUiSandbox.api.render();
assert(rangeQueueHtml.includes('현재 코트 이후 · 4순위')&&rangeQueueHtml.includes('대진 유지 · 4순위 이동 권장'),'진행 코트 3개가 끝날 상황이면 첫 대진을 4순위로 보내도록 권장해야 합니다.');
assert(rangeQueueHtml.includes('officialQueueTarget_0')&&rangeQueueHtml.includes('>미루기</button>'),'임원이 목적 순번을 선택해 한 번에 이동할 수 있어야 합니다.');
officialQueueUiSandbox.api.setRequests([{type:'official-queue-yield',queueId:'q1'}]);
const pendingQueueHtml=officialQueueUiSandbox.api.render();
assert(pendingQueueHtml.includes('data-official-pending="true"')&&pendingQueueHtml.includes('요청 중'),'같은 대진의 임원 요청 처리 중에는 중복 버튼을 비활성화해야 합니다.');
officialQueueUiSandbox.api.setRequests([]);
officialQueueUiSandbox.api.setList([{...uiQ1,cueState:'free',targetCourt:1},uiQ2,uiQ3,uiQ4]);
assert(officialQueueUiSandbox.api.render().includes('미루기'),'새 다중 이동 계약에서는 빈 코트 입장 직전에도 임원이 대진을 그대로 뒤로 보낼 수 있어야 합니다.');
officialQueueUiSandbox.api.setCapabilities({officialQueueYieldV1:true});
officialQueueUiSandbox.api.setList([{...uiQ1,cueState:'free',targetCourt:1},uiQ2]);
assert.strictEqual(officialQueueUiSandbox.api.render(),'','구 관리자 세션의 한 칸 이동 UI는 기존 빈 코트 안전 규칙을 유지해야 합니다.');

const officialQueueCardCode=`
let session={capabilities:{officialQueueCardOpsV1:true,officialQueueYieldV2:true},event:{active:[{id:'m1'},{id:'m2'},{id:'m3'}]}};
let officialRequests=[];
let sendingKey='';
function esc(v){return String(v||'');}
${functionSource(checkin,'officialQueueYieldTarget','canQueueCompleteCourt')}
this.api={
  render:(q,index,list)=>officialQueueCardActionsHtml({id:'official'},q,index,list),
  setRequests:v=>officialRequests=v,
  setSending:v=>sendingKey=v,
  setCapabilities:v=>session.capabilities=v
};`;
const officialQueueCardSandbox={};
vm.createContext(officialQueueCardSandbox);
vm.runInContext(officialQueueCardCode,officialQueueCardSandbox);
const cardQueue=[{...uiQ1,cueState:'free',targetCourt:1},uiQ2,uiQ3,uiQ4];
const freeCardHtml=officialQueueCardSandbox.api.render(cardQueue[0],0,cardQueue);
assert(freeCardHtml.includes('입장 처리')&&freeCardHtml.includes('이번만 뒤로'),'빈 코트의 해당 다음 대진 카드에는 두 현장 선택을 함께 보여야 합니다.');
assert(freeCardHtml.includes("sendOfficialQueueYield('official','q1','',4)"),'카드의 이번만 뒤로는 한 칸이 아니라 현재 코트 투입 묶음 뒤로 보내야 합니다.');
officialQueueCardSandbox.api.setRequests([{type:'official-queue-yield',queueId:'q1'}]);
assert(officialQueueCardSandbox.api.render(cardQueue[0],0,cardQueue).includes('뒤로 이동 확인 중'),'같은 카드의 순서 변경 요청 처리 중에는 중복 실행을 막아야 합니다.');
officialQueueCardSandbox.api.setRequests([{type:'official-queue-enter-free',queueId:'q1'}]);
assert(officialQueueCardSandbox.api.render(cardQueue[0],0,cardQueue).includes('입장 확인 중'),'같은 카드의 입장 요청 처리 중에는 중복 실행을 막아야 합니다.');
officialQueueCardSandbox.api.setRequests([]);
officialQueueCardSandbox.api.setCapabilities({officialQueueCardOpsV1:true});
assert(!officialQueueCardSandbox.api.render(cardQueue[0],0,cardQueue).includes('이번만 뒤로'),'다중 이동 안전 계약이 없는 구 세션에서는 빈 코트 카드의 뒤로 미루기를 노출하면 안 됩니다.');

const officialEntryHoldCode=`
let now=100;
let _dailyMatches=[
  {id:'done1',court:1,completedAt:80,cancelledAt:null,officialEntryPending:true,officialEntryCourt:1},
  {id:'done2',court:2,completedAt:90,cancelledAt:null,officialEntryPending:true,officialEntryCourt:2},
  {id:'active3',court:3,completedAt:null,cancelledAt:null}
];
function _dailyNow(){return now;}
function _dailyCourtCount(){return 3;}
function _dailyActiveMatches(){return _dailyMatches.filter(m=>!m.completedAt&&!m.cancelledAt);}
function _dailyCourtOrderForUse(limit){return [1,2,3].slice(0,limit==null?3:limit);}
${functionSource(dailySrc,'_dailyCourtEntryHold','_dailyCourtAvailable')}
this.api={
  auto:()=>_dailyAvailableCourt(3,{auto:true}),
  manual:()=>_dailyAvailableCourt(3),
  release:(court,queueId)=>_dailyReleaseCourtEntryHold(court,queueId),
  matches:()=>_dailyMatches,
  addActive:court=>_dailyMatches.push({id:'active'+court,court,completedAt:null,cancelledAt:null})
};`;
const officialEntryHoldSandbox={};
vm.createContext(officialEntryHoldSandbox);
vm.runInContext(officialEntryHoldCode,officialEntryHoldSandbox);
assert.strictEqual(officialEntryHoldSandbox.api.auto(),null,'두 코트가 동시에 끝나도 임원이 선수 확인하기 전에는 자동 투입하면 안 됩니다.');
assert.strictEqual(officialEntryHoldSandbox.api.manual(),1,'임원의 명시적 입장 처리는 대기 중인 빈 코트를 계속 사용할 수 있어야 합니다.');
assert.strictEqual(officialEntryHoldSandbox.api.release(1,'q2'),true,'입장 처리한 코트의 자동 투입 보류 상태를 정확히 해제해야 합니다.');
assert.strictEqual(officialEntryHoldSandbox.api.auto(),1,'1코트 입장 확인 뒤에는 해당 코트만 다시 사용할 수 있어야 합니다.');
officialEntryHoldSandbox.api.addActive(1);
assert.strictEqual(officialEntryHoldSandbox.api.auto(),null,'2코트의 별도 입장 확인 대기는 1코트 처리 때문에 함께 풀리면 안 됩니다.');
const releasedHold=officialEntryHoldSandbox.api.matches().find(m=>m.id==='done1');
assert.strictEqual(releasedHold.officialEntryQueueId,'q2','어떤 대진으로 입장 대기를 해제했는지 감사 기록을 남겨야 합니다.');

const completeFlowSource=functionSource(dailySrc,'dailyCompleteMatch','dailyCancelMatch');
assert(completeFlowSource.includes('options.awaitOfficialEntry')&&completeFlowSource.includes('officialEntryPending=true'),'임원 종료는 다음 대진을 진행 경기로 즉시 바꾸지 않고 입장 확인 상태로 남겨야 합니다.');
assert(completeFlowSource.includes('!options.awaitOfficialEntry&&_dailyAutoFlowEnabled()'),'임원 입장 확인 대기 중에는 기존 자동 시작을 건너뛰어야 합니다.');
assert(functionSource(dailySrc,'dailyStartQueueItem','_dailyRenderQueueItem').includes('_dailyReleaseCourtEntryHold(court,q.id)'),'임원이 입장 처리한 정확한 대진만 해당 코트 보류를 해제해야 합니다.');
assert(functionSource(dailySrc,'dailyMaybeAutoAssign','_dailyCombos').includes('_dailyAvailableCourt(limit,{auto:true})'),'주기적 자동 배정도 임원 입장 확인 대기 코트를 건너뛰어야 합니다.');
assert(functionSource(dailySrc,'dailyProcessCheckinRequests','dailyApproveCheckinRequest').includes("awaitOfficialEntry:true"),'임원 경기 종료 요청은 반드시 반자동 입장 흐름을 사용해야 합니다.');

const completeUndoGuardCode=`
let now=100;
let _dailyPlayers=[{id:'a',status:'playing',currentMatchId:'m1',games:0,lastStatusAt:10}];
let _dailyMatches=[{id:'m1',court:1,team1:['a','b'],team2:['c','d'],completedAt:null,cancelledAt:null}];
let _dailyQueue=[{id:'q1',team1:['e','f'],team2:['g','h']}];
let _dailyReservations=[];
let _dailySeq=2;
let _dailyWaveStarts=1;
let _dailyLastCompleteUndo=null;
function _dailyNow(){return now;}
function _dailyQueueIds(q){return [...(q.team1||[]),...(q.team2||[])];}
function _dailyMarkFourCacheDirty(){}
function dailyEnsureQueue(){}
function dailySave(){}
function dailyRender(){}
function confirm(){return true;}
${functionSource(dailySrc,'_dailyCloneStateForUndo','dailyCompleteMatch')}
this.api={
  capture:_dailyCaptureCompleteUndo,
  guard:_dailyCompleteUndoGuard,
  setGuard:()=>{_dailyLastCompleteUndo.guard=_dailyCompleteUndoGuard();},
  complete:()=>{_dailyMatches[0].completedAt=100;_dailyPlayers[0].status='wait';_dailyPlayers[0].currentMatchId='';},
  changeQueue:()=>_dailyQueue.push({id:'q2',team1:['i','j'],team2:['k','l']}),
  undo:token=>dailyUndoMemberComplete(token,true),
  queue:()=>_dailyQueue,
  match:()=>_dailyMatches[0],
  pending:()=>_dailyLastCompleteUndo
};`;
const completeUndoGuardSandbox={JSON};
vm.createContext(completeUndoGuardSandbox);
vm.runInContext(completeUndoGuardCode,completeUndoGuardSandbox);
completeUndoGuardSandbox.api.capture('undo1','club-official-complete');
completeUndoGuardSandbox.api.complete();
completeUndoGuardSandbox.api.setGuard();
completeUndoGuardSandbox.api.changeQueue();
assert.strictEqual(completeUndoGuardSandbox.api.undo('undo1'),false,'종료 후 다음 대진 순서가 바뀌면 오래된 종료 취소로 전체 상태를 되감으면 안 됩니다.');
assert.strictEqual(completeUndoGuardSandbox.api.queue().length,2,'거절된 종료 취소는 이후 대진 변경을 그대로 보존해야 합니다.');
assert.strictEqual(completeUndoGuardSandbox.api.pending(),null,'안전 조건이 깨진 종료 취소 토큰은 다시 실행되지 않도록 폐기해야 합니다.');

const officialArrivalUiCode=`
let session={capabilities:{officialArrivalV1:true},players:[
  {id:'late1',name:'늦은회원',status:'invited'},
  {id:'late2',name:'예정회원',status:'planned'},
  {id:'active',name:'참가회원',status:'wait'},
  {id:'done',name:'종료회원',status:'done'}
],arrivalCandidates:[
  {candidateKey:'player:late1',kind:'existing',playerId:'late1',name:'늦은회원',status:'invited'},
  {candidateKey:'player:late2',kind:'existing',playerId:'late2',name:'예정회원',status:'planned'},
  {candidateKey:'roster:roster_late',kind:'roster',memberId:'roster_late',name:'명부지각'}
]};
let officialRequests=[];
function esc(v){return String(v||'');}
function compactLabel(v){return v;}
${functionSource(checkin,'officialArrivalPlayers','officialPlayerOptions')}
${functionSource(checkin,'officialPlayerOptions','officialPartnerOptions')}
this.api={
  render:()=>officialArrivalToolsHtml({id:'official'},''),
  generic:()=>officialPlayerOptions(),
  setRequests:v=>officialRequests=v,
  setCapabilities:v=>session.capabilities=v
};`;
const officialArrivalUiSandbox={};
vm.createContext(officialArrivalUiSandbox);
vm.runInContext(officialArrivalUiCode,officialArrivalUiSandbox);
const arrivalHtml=officialArrivalUiSandbox.api.render();
assert(arrivalHtml.includes('늦은회원')&&arrivalHtml.includes('예정회원')&&arrivalHtml.includes('명부지각 · 클럽 명부'),'지각 참가 등록에는 등록 전 선수와 해당 클럽 명부 후보를 함께 보여야 합니다.');
assert(!arrivalHtml.includes('참가회원')&&!arrivalHtml.includes('종료회원'),'이미 참가·종료 상태인 선수를 지각 참가 등록 후보로 보여주면 안 됩니다.');
assert(!officialArrivalUiSandbox.api.generic().includes('늦은회원'),'새 계약에서는 등록 전 선수를 일반 복귀 버튼으로 우회 처리하면 안 됩니다.');
officialArrivalUiSandbox.api.setRequests([{type:'official-player-arrival',playerId:'late1'}]);
assert(officialArrivalUiSandbox.api.render().includes('늦은회원 · 등록 확인 중'),'처리 중인 선수는 중복 참가 등록할 수 없도록 선택지에서 잠가야 합니다.');
officialArrivalUiSandbox.api.setRequests([{type:'official-player-arrival',playerId:'late1'},{type:'official-player-arrival',playerId:'late2'},{type:'official-player-add',memberId:'roster_late'}]);
assert(officialArrivalUiSandbox.api.render().includes('data-arrival-pending="true" disabled'),'모든 후보를 확인 중이면 참가 등록 버튼을 비활성화해야 합니다.');
officialArrivalUiSandbox.api.setCapabilities({});
assert(officialArrivalUiSandbox.api.generic().includes('늦은회원'),'구 세션에서는 기존 복귀 방식이 사라지지 않아야 합니다.');

const arrivalCandidateCode=`
let rosters={clubs:[
  {name:'일만클럽',members:[{memberId:'m_active',name:'참가회원',grade:'A'},{memberId:'m_late',name:'명부지각',grade:'B'}]},
  {name:'다른클럽',members:[{memberId:'m_other',name:'타클럽회원',grade:'C'}]}
]};
let _dailyPlayers=[
  {id:'official',memberId:'m_active',name:'참가회원',club:'일만클럽',status:'wait',isClubOfficial:true},
  {id:'planned',name:'예정회원',club:'일만클럽',status:'planned',lastStatusAt:22}
];
function _rsvpMemberId(m){return 'generated:'+m.club+':'+m.name;}
function _rsvpNameKey(name){return String(name||'').replace(/\\s+/g,'').toLowerCase();}
${functionSource(dailySrc,'_dailyOfficialArrivalRoster','_dailyCheckinPayload')}
this.api={candidates:_dailyOfficialArrivalCandidates,profile:_dailyOfficialArrivalRosterProfile};`;
const arrivalCandidateSandbox={};
vm.createContext(arrivalCandidateSandbox);
vm.runInContext(arrivalCandidateCode,arrivalCandidateSandbox);
const approvedCandidates=arrivalCandidateSandbox.api.candidates();
assert.deepStrictEqual(Array.from(approvedCandidates,c=>c.name),['명부지각','예정회원'],'현재 참가 클럽의 등록 전 선수와 미등록 명부 회원만 후보여야 합니다.');
assert(!approvedCandidates.some(c=>c.name==='타클럽회원'),'다른 클럽 명부 회원을 임원 참가 등록 후보로 노출하면 안 됩니다.');
assert.strictEqual(arrivalCandidateSandbox.api.profile('m_late').grade,'B','추가 선수 프로필은 관리자 클럽 명부 원본에서 찾아야 합니다.');

assert(checkin.includes('파트너 접수·취소')&&checkin.includes("type:'official-partner-reservation'"),'파트너 요청은 회원이 아닌 임원이 두 선수를 접수하고 취소할 수 있어야 합니다.');
assert(checkin.includes("officialPartnerOpsV1!==true"),'구 관리자 세션과 섞이면 지원 여부가 확인된 경우에만 임원 파트너 도구를 보여야 합니다.');
assert(dailySrc.includes("req.type==='official-partner-reservation'")&&dailySrc.includes("req.type==='official-partner-cancel'"),'관리자 대진 엔진은 임원 파트너 접수와 취소를 검증해 반영해야 합니다.');
const memberRequestBox=functionSource(checkin,'gameRequestBox','toggleAfterParty');
assert(!memberRequestBox.includes('파트너 신청 보내기'),'일반 회원 화면에서 새 파트너 신청 버튼을 제공하면 안 됩니다.');
assert(!memberRequestBox.includes('sendReservationConsent')&&!memberRequestBox.includes('sendReservationCancel'),'구버전 파트너 요청도 회원이 동의하거나 취소하는 운영 UI를 다시 노출하면 안 됩니다.');
assert(functionSource(dailySrc,'_dailyReservationRequestError','_dailyReleaseTemporaryQueueForReservationIds').includes('파트너 요청은 클럽 임원이 현장에서 접수합니다.'),'구버전 회원의 직접 파트너 요청도 관리자 원본에서 거절해야 합니다.');
assert(functionSource(dailySrc,'_dailyReservationPreservesOrder','_dailyReservationPlayerConflict').includes("r.source==='club-official-request'"),'임원이 접수한 파트너도 앞선 대진 순서를 밀면 안 됩니다.');
assert(checkin.includes("'경기중 · 경기 후 반영'"),'임원 선수 선택에서 경기중 선수의 경기 후 상태도 처리할 수 있어야 합니다.');
assert(dailySrc.includes('afterMatchStatus:p.afterMatchStatus'), '임원 화면에 경기 후 휴식·종료 예약 상태를 전달해야 합니다.');
assert(checkin.includes('expectedCurrentMatchId:target.currentMatchId'), '임원 요청이 경기 종료와 엇갈려 도착해도 같은 경기를 식별할 수 있어야 합니다.');
const memberCourtBoundary=functionSource(dailySrc,'_dailyMemberCourtOperationError','_dailyOfficialFingerprint');
const memberCourtSandbox={};
vm.createContext(memberCourtSandbox);
vm.runInContext(`${memberCourtBoundary};this.error=_dailyMemberCourtOperationError;`,memberCourtSandbox);
assert(memberCourtSandbox.error({type:'court-complete'}).includes('클럽 임원'),'구버전 회원의 경기 종료 요청도 관리자 원본에서 거절해야 합니다.');
assert(memberCourtSandbox.error({type:'queue-enter-free'}).includes('클럽 임원'),'구버전 회원의 직접 입장 요청도 관리자 원본에서 거절해야 합니다.');
assert.strictEqual(memberCourtSandbox.error({type:'queue-rest-pass'}),'','회원의 조금 쉬고 요청까지 막으면 안 됩니다.');

const permissionCode=`
var viewer=null;
function _viewerInfo(){return viewer;}
function _isTeamLiveData(){return true;}
function _usesFixedTeams(){return false;}
${functionSource(liveSrc,'_canSubmitResult','_resultRoleForSubmit')}
this.api={can:_canSubmitResult,set:v=>viewer=v};`;
const permissionSandbox={};
vm.createContext(permissionSandbox);
vm.runInContext(permissionCode,permissionSandbox);
const openMatch={t1:['선수1','선수2'],t2:['선수3','선수4'],win:null};
permissionSandbox.api.set({n:'임원',isClubOfficial:true});
assert.strictEqual(permissionSandbox.api.can(openMatch,{}),true,'참가 중인 클럽 임원은 다른 경기의 승패도 입력할 수 있어야 합니다.');
permissionSandbox.api.set({n:'일반회원'});
assert.strictEqual(permissionSandbox.api.can(openMatch,{}),false,'일반 회원에게 전체 경기 권한이 번지면 안 됩니다.');

const validationCode=`
const DAILY_OFFICIAL_REQUEST_TTL_MS=10*60*1000;
let now=100000;
let _dailyFinishMode=false;
let rosterPresent=false;
const players={
  official:{id:'official',isClubOfficial:true,status:'wait',lastStatusAt:10},
  member:{id:'member',isClubOfficial:false,status:'wait',lastStatusAt:20},
  invited:{id:'invited',isClubOfficial:false,status:'invited',lastStatusAt:40},
  planned:{id:'planned',isClubOfficial:false,status:'planned',lastStatusAt:50},
  playing:{id:'playing',isClubOfficial:false,status:'playing',currentMatchId:'played1',lastStatusAt:30},
  fake:{id:'fake',isClubOfficial:false,status:'wait',lastStatusAt:10}
};
let _dailyMatches=[
  {id:'match1',team1:['a','b'],team2:['c','d'],startedAt:123},
  {id:'played1',team1:['playing','x'],team2:['y','z'],startedAt:124}
];
let _dailyQueue=[
  {id:'queue1',team1:['e','f'],team2:['g','h']},
  {id:'queue2',team1:['i','j'],team2:['k','l']},
  {id:'queue3',team1:['m','n'],team2:['o','p']},
  {id:'queue4',team1:['q','r'],team2:['s','t']}
];
let queueState='soon';
let queueCourt=null;
let queueHoldId='';
let restPassActive=true;
let _dailyReservations=[{id:'pair1',mode:'pair',team1:['member','playing'],team2:[]}];
function _dailyPlayer(id){return players[id]||null;}
function _dailyNow(){return now;}
function _dailyNormalizeStatus(s){return s;}
function _dailyQueueIds(q){return [...q.team1,...q.team2];}
function dailyEnsureQueue(){}
function _dailyQueueItemValid(){return true;}
function _dailyQueueRestPassActive(q){return !!q.restPass&&restPassActive;}
function _dailyQueueStartInfo(){return {state:queueState,court:queueCourt,holdId:queueHoldId};}
function _dailyExactKey(team1,team2){
  const teamKey=team=>(team||[]).map(String).sort().join('|');
  return [teamKey(team1),teamKey(team2)].sort().join(' VS ');
}
function _dailyFreeCourtRequestError(){return '';}
function _dailyReservationRequestError(){return '';}
function _dailyOfficialArrivalRosterProfile(memberId){return memberId==='roster_late'?{memberId,name:'명부지각',club:'테스트클럽'}:null;}
function _dailyHasRosterPlayer(){return rosterPresent;}
${functionSource(dailySrc,'_dailyApplyQueueYield','_dailyApplyQueueDefer')}
${functionSource(dailySrc,'_dailyOfficialFingerprint','_dailyOfficialRequestError')}
${functionSource(dailySrc,'_dailyOfficialRequestError','_dailyApplyOfficialStatus')}
this.api={
  error:_dailyOfficialRequestError,
  apply:_dailyApplyQueueYield,
  setNow:v=>now=v,
  setMemberLast:v=>players.member.lastStatusAt=v,
  setArrivalStatus:(id,status,lastStatusAt)=>{players[id].status=status;players[id].lastStatusAt=lastStatusAt;},
  setRosterPresent:v=>{rosterPresent=v;},
  setFinishMode:v=>{_dailyFinishMode=v;},
  setQueueRestPass:v=>{_dailyQueue[0].restPass=v;},
  setRestPassActive:v=>{restPassActive=v;},
  setQueueState:(state,court)=>{queueState=state;queueCourt=court;},
  setQueueHold:v=>{queueHoldId=v;},
  queue:()=>_dailyQueue,
  completePlaying:()=>{players.playing.status='wait';players.playing.currentMatchId=null;players.playing.lastStatusAt=31;_dailyMatches[1].completedAt=100000;}
};`;
const validationSandbox={};
vm.createContext(validationSandbox);
vm.runInContext(validationCode,validationSandbox);
const validBase={actorPlayerId:'official',createdAt:99990,expiresAt:100050};
const validArrival={...validBase,type:'official-player-arrival',playerId:'invited',status:'wait',expectedStatus:'invited',expectedLastStatusAt:40};
assert.strictEqual(validationSandbox.api.error(validArrival),'','임원은 최신 등록 전 선수를 참가 상태로 바꿀 수 있어야 합니다.');
assert(validationSandbox.api.error({...validArrival,status:'rest'}).includes('올바르지 않습니다'),'참가 등록 요청으로 휴식·종료 상태를 주입하면 안 됩니다.');
assert(validationSandbox.api.error({...validArrival,expectedStatus:'planned'}).includes('이미 바뀌었습니다'),'화면에서 본 등록 전 상태와 관리자 원본이 다르면 거절해야 합니다.');
assert(validationSandbox.api.error({...validArrival,expectedLastStatusAt:39}).includes('이미 바뀌었습니다'),'오래된 참가 등록 요청은 적용하면 안 됩니다.');
assert(validationSandbox.api.error({...validArrival,playerId:'member',expectedStatus:'wait',expectedLastStatusAt:20}).includes('이미 참가 상태'),'이미 참가한 선수를 중복 등록하면 안 됩니다.');
assert(validationSandbox.api.error({...validBase,type:'official-player-status',playerId:'invited',status:'wait',expectedLastStatusAt:40}).includes('참가 등록'),'등록 전 선수를 일반 복귀 요청으로 우회하면 안 됩니다.');
const validRosterArrival={...validBase,type:'official-player-add',memberId:'roster_late',playerName:'명부지각',expectedName:'명부지각'};
assert.strictEqual(validationSandbox.api.error(validRosterArrival),'','임원은 오늘 명단에 빠진 해당 클럽 회원도 명부 원본으로 참가 등록할 수 있어야 합니다.');
assert(validationSandbox.api.error({...validRosterArrival,memberId:'other'}).includes('클럽 명부'),'다른 클럽 또는 임의 회원 ID를 참가 명단에 넣으면 안 됩니다.');
assert(validationSandbox.api.error({...validRosterArrival,expectedName:'다른이름'}).includes('정보가 이미 바뀌었습니다'),'임원 화면을 연 뒤 명부 이름이 바뀌면 오래된 후보 요청을 거절해야 합니다.');
validationSandbox.api.setRosterPresent(true);
assert(validationSandbox.api.error(validRosterArrival).includes('이미 오늘 명단'),'동시에 도착 등록된 같은 명부 회원을 중복 추가하면 안 됩니다.');
validationSandbox.api.setRosterPresent(false);
validationSandbox.api.setFinishMode(true);
assert(validationSandbox.api.error(validRosterArrival).includes('마무리'),'자율게임 전환 뒤 자동대진 참가자를 다시 추가하면 안 됩니다.');
assert(validationSandbox.api.error(validArrival).includes('마무리'),'마무리 전환 뒤 등록 전 선수도 자동대진에 합류시키면 안 됩니다.');
validationSandbox.api.setFinishMode(false);
assert.strictEqual(validationSandbox.api.error({...validBase,type:'official-player-status',playerId:'member',status:'rest',expectedLastStatusAt:20}),'');
assert.strictEqual(validationSandbox.api.error({...validBase,type:'official-player-status',playerId:'playing',status:'done',expectedLastStatusAt:30}),'','임원은 경기중 선수의 경기 후 종료를 미리 표시할 수 있어야 합니다.');
assert(validationSandbox.api.error({...validBase,type:'official-player-status',playerId:'playing',status:'wait',expectedLastStatusAt:30}).includes('경기 후'),'경기중 선수의 복귀 처리는 허용하면 안 됩니다.');
assert(validationSandbox.api.error({...validBase,type:'official-player-status',playerId:'member',status:'rest'}).includes('최신 상태'),'선수 상태 비교값이 없는 임원 요청을 적용하면 안 됩니다.');
assert(validationSandbox.api.error({...validBase,actorPlayerId:'fake',type:'official-player-status',playerId:'member',status:'rest'}).includes('클럽 임원'),'요청 본문의 임원 표시는 믿지 않고 관리자 참가자 원본을 확인해야 합니다.');
assert(validationSandbox.api.error({...validBase,type:'official-player-status',playerId:'member',status:'rest',expectedLastStatusAt:19}).includes('이미 바뀌었습니다'),'선수 상태가 바뀐 오래된 요청을 적용하면 안 됩니다.');
validationSandbox.api.setMemberLast(0);
assert.strictEqual(validationSandbox.api.error({...validBase,type:'official-player-status',playerId:'member',status:'rest',expectedLastStatusAt:0}),'','비교값 0도 유효한 최신 상태로 처리해야 합니다.');
validationSandbox.api.setMemberLast(21);
assert(validationSandbox.api.error({...validBase,type:'official-player-status',playerId:'member',status:'rest',expectedLastStatusAt:0}).includes('이미 바뀌었습니다'),'비교값 0인 오래된 요청도 반드시 거절해야 합니다.');
assert.strictEqual(validationSandbox.api.error({...validBase,type:'official-court-complete',matchId:'match1',expectedStartedAt:123,expectedPlayerIds:['a','b','c','d']}),'');
assert(validationSandbox.api.error({...validBase,type:'official-court-complete',matchId:'match1',expectedStartedAt:123}).includes('선수 구성'),'선수 지문이 없는 코트 종료 요청을 적용하면 안 됩니다.');
assert(validationSandbox.api.error({...validBase,type:'official-court-complete',matchId:'match1',expectedStartedAt:123,expectedPlayerIds:['a','b','c','x']}).includes('선수 구성'),'다른 경기로 바뀐 코트 종료 요청을 적용하면 안 됩니다.');
assert(validationSandbox.api.error({...validBase,type:'official-queue-enter-free',queueId:'queue1'}).includes('선수'),'선수 지문이 없는 입장 요청을 적용하면 안 됩니다.');
const validYield={...validBase,type:'official-queue-yield',queueId:'queue1',expectedQueueIndex:1,targetQueueIndex:4,expectedPlayerIds:['h','g','f','e'],expectedTeam1Ids:['e','f'],expectedTeam2Ids:['g','h']};
assert.strictEqual(validationSandbox.api.error(validYield),'','임원은 최신 순번과 같은 선수·팀 구성의 다음 대진을 뒤로 보낼 수 있어야 합니다.');
assert(validationSandbox.api.error({...validYield,expectedQueueIndex:2}).includes('순서가 이미 바뀌었습니다'),'오래된 순번을 기준으로 다른 대진을 이동하면 안 됩니다.');
assert(validationSandbox.api.error({...validYield,expectedPlayerIds:['e','f','g','x']}).includes('선수가 이미 바뀌었습니다'),'선수 구성이 바뀐 대진을 오래된 화면에서 이동하면 안 됩니다.');
assert(validationSandbox.api.error({...validYield,expectedTeam1Ids:['e','g'],expectedTeam2Ids:['f','h']}).includes('팀 구성이 이미 바뀌었습니다'),'같은 4명이라도 팀 조합이 바뀐 대진을 오래된 화면에서 이동하면 안 됩니다.');
assert(validationSandbox.api.error({...validYield,targetQueueIndex:1}).includes('순번이 올바르지 않습니다'),'현재보다 앞이나 같은 순번으로 뒤로 미루기를 위장하면 안 됩니다.');
assert(validationSandbox.api.error({...validYield,targetQueueIndex:5}).includes('순번이 올바르지 않습니다'),'현재 대기표 범위를 넘는 순번으로 이동하면 안 됩니다.');
assert(validationSandbox.api.error({...validYield,queueId:'queue4',expectedQueueIndex:4,targetQueueIndex:5,expectedPlayerIds:['q','r','s','t'],expectedTeam1Ids:['q','r'],expectedTeam2Ids:['s','t']}).includes('순번이 올바르지 않습니다'),'마지막 대진은 더 뒤로 보낼 수 없어야 합니다.');
validationSandbox.api.setQueueRestPass({playerId:'e'});
assert.strictEqual(validationSandbox.api.error(validYield),'','임원은 조금 쉬고 상태도 더 뒤 순번으로 확정 이동할 수 있어야 합니다.');
validationSandbox.api.setQueueState('free',1);
assert.strictEqual(validationSandbox.api.error(validYield),'','빈 코트 입장 직전에도 임원은 부재 대진을 현재 코트 묶음 뒤로 보낼 수 있어야 합니다.');
validationSandbox.api.setQueueHold('match1:100000');
const heldYield={...validYield,expectedCueState:'free',expectedTargetCourt:1,expectedHoldId:'match1:100000'};
assert.strictEqual(validationSandbox.api.error(heldYield),'','현재 종료 건과 코트가 일치하는 임원 요청만 빈 코트 대진을 뒤로 보낼 수 있어야 합니다.');
assert(validationSandbox.api.error({...heldYield,expectedHoldId:'old-match:90000'}).includes('종료 연결이 이미 바뀌었습니다'),'이전 종료 건에서 늦게 도착한 뒤로 미루기 요청을 적용하면 안 됩니다.');
assert(validationSandbox.api.error(validYield).includes('최신 종료 연결'),'종료 연결 지문이 없는 구 화면 요청은 임원 확인 대기 코트에 적용하면 안 됩니다.');
const heldEnter={...validBase,type:'official-queue-enter-free',queueId:'queue1',court:1,expectedPlayerIds:['e','f','g','h'],expectedHoldId:'match1:100000'};
assert.strictEqual(validationSandbox.api.error(heldEnter),'','같은 종료 연결과 선수 지문의 입장 요청은 허용해야 합니다.');
assert(validationSandbox.api.error({...heldEnter,expectedHoldId:'old-match:90000'}).includes('종료 연결이 이미 바뀌었습니다'),'이전 종료 건의 입장 요청을 나중의 같은 코트에 적용하면 안 됩니다.');
const multiMove=validationSandbox.api.apply('e','queue1','club-official-queue-yield',{strict:true,yieldedBy:'official',targetQueueIndex:4,clearRestPass:true,expectedCueState:'free',expectedTargetCourt:1,expectedHoldId:'match1:100000'});
assert.strictEqual(multiMove.ok,true,'검증된 임원 요청은 정확한 queueId의 대진을 선택한 순번까지 이동해야 합니다.');
assert.strictEqual(multiMove.moveBy,3,'1순위 대진을 4순위로 한 번에 세 칸 이동해야 합니다.');
assert.deepStrictEqual(Array.from(validationSandbox.api.queue(),q=>q.id),['queue2','queue3','queue4','queue1'],'여러 코트가 끝나도 부재 대진은 현재 코트 투입 묶음 뒤에 있어야 합니다.');
const movedQueue=validationSandbox.api.queue()[3];
assert.deepStrictEqual(Array.from(movedQueue.team1),['e','f'],'순번을 옮겨도 첫 번째 복식팀 구성을 유지해야 합니다.');
assert.deepStrictEqual(Array.from(movedQueue.team2),['g','h'],'순번을 옮겨도 두 번째 복식팀 구성을 유지해야 합니다.');
assert.strictEqual(movedQueue.restPass,undefined,'임원이 목적 순번을 확정하면 기존 조금 쉬고 임시 표시는 정리해야 합니다.');
assert.strictEqual(movedQueue.yieldedPromotedQueueId,'queue2','부재 대진을 보낸 뒤 정확한 다음 대진이 같은 코트 입장 순서를 이어받아야 합니다.');
assert.strictEqual(movedQueue.yieldedHeldCourt,1,'뒤로 미루기 감사 기록에 실제 이어받은 빈 코트를 남겨야 합니다.');
assert(validationSandbox.api.error(validYield).includes('순서가 이미 바뀌었습니다'),'같은 임원 요청을 다시 처리해 대진을 추가 이동하면 안 됩니다.');
assert.strictEqual(validationSandbox.api.error({...validBase,type:'official-partner-reservation',playerIds:['member','playing']}),'','임원은 현재 참가자 두 명의 파트너 요청을 접수할 수 있어야 합니다.');
assert(validationSandbox.api.error({...validBase,type:'official-partner-reservation',playerIds:['member','member']}).includes('두 명'),'같은 선수를 중복 접수하면 안 됩니다.');
assert.strictEqual(validationSandbox.api.error({...validBase,type:'official-partner-cancel',reservationId:'pair1',expectedPlayerIds:['playing','member']}),'','같은 선수 지문의 파트너 접수는 취소할 수 있어야 합니다.');
assert(validationSandbox.api.error({...validBase,type:'official-partner-cancel',reservationId:'pair1',expectedPlayerIds:['member','fake']}).includes('바뀌었습니다'),'다른 파트너 접수를 오래된 화면에서 취소하면 안 됩니다.');
assert(validationSandbox.api.error({...validBase,type:'official-court-complete-undo'}).includes('종료 기록'),'토큰이 없는 종료 취소 요청을 적용하면 안 됩니다.');
validationSandbox.api.completePlaying();
assert.strictEqual(validationSandbox.api.error({...validBase,type:'official-player-status',playerId:'playing',status:'done',expectedStatus:'playing',expectedCurrentMatchId:'played1',expectedLastStatusAt:30}),'','경기 종료와 엇갈려 도착한 임원 귀가 요청도 같은 경기라면 반영해야 합니다.');
validationSandbox.api.setNow(800001);
assert(validationSandbox.api.error({...validBase,type:'official-player-status',playerId:'member',status:'rest'}).includes('시간이 지나'),'만료된 운영 요청을 앱 재실행 뒤 늦게 적용하면 안 됩니다.');

const officialArrivalApplyCode=`
let now=200000;
let _dailyPlayers=[];
const players={
  official:{id:'official',name:'운영임원',isClubOfficial:true,status:'wait'},
  late:{id:'late',name:'지각회원',status:'invited',lastStatusAt:40}
};
_dailyPlayers=Object.values(players);
function _dailyPlayer(id){return players[id]||null;}
function _dailyNow(){return now;}
function _dailyApplyPlayerStatus(p,status){p.status=status;p.joinedAt=now;p.waitFrom=now;p.lastStatusAt=now;}
function _dailyOfficialArrivalRosterProfile(memberId){return memberId==='roster_late'?{memberId,name:'명부지각',club:'테스트클럽',grade:'B',gender:'M',isClubOfficial:false}:null;}
function _dailyHasRosterPlayer(profile){return _dailyPlayers.some(p=>p.memberId&&p.memberId===profile.memberId);}
function _dailyNormalize(raw){return {id:'generated_late',...raw};}
${functionSource(dailySrc,'_dailyRecordOfficialArrival','_dailyApplyOfficialStatus')}
this.api={apply:_dailyApplyOfficialArrival,add:_dailyApplyOfficialPlayerAdd,player:()=>players.late,all:()=>_dailyPlayers};`;
const officialArrivalApplySandbox={};
vm.createContext(officialArrivalApplySandbox);
vm.runInContext(officialArrivalApplyCode,officialArrivalApplySandbox);
assert.strictEqual(officialArrivalApplySandbox.api.apply({key:'arrival1',actorPlayerId:'official',playerId:'late'}),true,'검증된 임원 참가 등록을 관리자 원본에 반영해야 합니다.');
const appliedArrival=officialArrivalApplySandbox.api.player();
assert.strictEqual(appliedArrival.status,'wait','지각 선수는 즉시 참가 대기 상태가 되어야 합니다.');
assert.strictEqual(appliedArrival.joinedAt,200000,'지각 선수의 실제 도착시각을 참가 등록 시각으로 기록해야 합니다.');
assert.strictEqual(appliedArrival.arrivalConfirmedBy,'official','참가 등록을 확인한 임원을 선수 기록에 남겨야 합니다.');
assert.strictEqual(appliedArrival.arrivalConfirmedByName,'운영임원','감사 기록에는 임원 이름도 남겨야 합니다.');
assert.strictEqual(appliedArrival.arrivalConfirmedSource,'club-official-arrival','관리자 직접 등록과 임원 현장 확인을 구분해야 합니다.');
assert.strictEqual(appliedArrival.arrivalRequestKey,'arrival1','요청 감사 기록과 선수 변경을 연결할 수 있어야 합니다.');
assert.strictEqual(officialArrivalApplySandbox.api.apply({key:'arrival2',actorPlayerId:'official',playerId:'late'}),false,'같은 선수를 두 번 참가 등록하면 안 됩니다.');
assert.strictEqual(officialArrivalApplySandbox.api.add({key:'arrival3',actorPlayerId:'official',memberId:'roster_late'}),true,'해당 클럽 명부 후보는 새 오늘 참가자로 추가해야 합니다.');
const rosterArrival=officialArrivalApplySandbox.api.all().find(p=>p.memberId==='roster_late');
assert(rosterArrival&&rosterArrival.status==='wait','명부에서 추가한 지각자도 즉시 참가 대기 상태여야 합니다.');
assert.strictEqual(rosterArrival.grade,'B','임원 입력값이 아니라 관리자 클럽 명부의 급수를 사용해야 합니다.');
assert.strictEqual(rosterArrival.arrivalConfirmedBy,'official','새로 추가한 지각자에도 확인 임원 감사 기록을 남겨야 합니다.');
assert.strictEqual(officialArrivalApplySandbox.api.add({key:'arrival4',actorPlayerId:'official',memberId:'roster_late'}),false,'동일 명부 회원의 중복 추가 요청은 두 번째부터 거절해야 합니다.');

const legacyRequestCode=`
let _dailyCheckinApplying=false;
let _dailyCheckinRequests=[{key:'legacy1',type:'reservation',source:'club-official-reservation',consentRequired:['a','b'],consents:{a:'accepted'}}];
let updates=[];
function _dailyNow(){return 200;}
function _dailyOfficialRequestError(){return '';}
function _dailyMemberCourtOperationError(){return '';}
function _dailyReservationRequestError(){return '';}
function _dailyCheckinRequestRef(){return {update(payload){updates.push(payload);return {catch(){}};}};}
${functionSource(dailySrc,'dailyProcessCheckinRequests','dailyApproveCheckinRequest')}
this.api={run:dailyProcessCheckinRequests,pending:()=>_dailyCheckinRequests,updates:()=>updates};`;
const legacyRequestSandbox={};
vm.createContext(legacyRequestSandbox);
vm.runInContext(legacyRequestCode,legacyRequestSandbox);
legacyRequestSandbox.api.run();
assert.strictEqual(legacyRequestSandbox.api.pending().length,0,'동의가 남은 구버전 회원 파트너 요청도 대기열에 계속 남기면 안 됩니다.');
assert(legacyRequestSandbox.api.updates()[0].reason.includes('클럽 임원'),'구버전 회원 요청은 임원 현장 접수 안내와 함께 즉시 종료해야 합니다.');

const officialRegistrationCode=`
let _dailyReservations=[];
let released=false;
let applied=false;
let seenOptions=null;
function _dailyReservationRequestError(req,options){seenOptions=options;return options&&options.official?'':'blocked';}
function _dailyReleaseTemporaryQueueForReservationIds(){released=true;}
function _dailyNow(){return 300;}
function _dailyTryApplyReservationToExistingQueue(){applied=true;return false;}
${functionSource(dailySrc,'_dailyRegisterReservationRequest','_dailyCompleteRequestError')}
this.api={run:req=>_dailyRegisterReservationRequest(req,{official:true}),reservations:()=>_dailyReservations,state:()=>({released,applied,seenOptions})};`;
const officialRegistrationSandbox={Math};
vm.createContext(officialRegistrationSandbox);
vm.runInContext(officialRegistrationCode,officialRegistrationSandbox);
assert.strictEqual(officialRegistrationSandbox.api.run({key:'official1',mode:'pair',team1:['a','b'],source:'club-official-reservation'}),true);
assert.strictEqual(officialRegistrationSandbox.api.reservations()[0].source,'club-official-request','임원 접수를 일반 관리자 예약과 구분해 저장해야 합니다.');
assert.strictEqual(officialRegistrationSandbox.api.reservations()[0].preserveOrder,true,'임원 파트너 접수는 기존 순번을 유지해야 합니다.');
assert.strictEqual(officialRegistrationSandbox.api.state().released,false,'임원 파트너 접수 때문에 이미 준비된 일반 대진을 먼저 해체하면 안 됩니다.');
assert.strictEqual(officialRegistrationSandbox.api.state().applied,true,'가능하면 기존 대진 순번 안에서 임원 파트너 접수를 반영해야 합니다.');

const officialQueueProcessCode=`
let _dailyCheckinApplying=false;
let _dailyCheckinRequests=[{key:'yield1',type:'official-queue-yield',actorPlayerId:'official',queueId:'q1',expectedQueueIndex:1,targetQueueIndex:4,expectedPlayerIds:['a','b','c','d'],expectedTeam1Ids:['a','b'],expectedTeam2Ids:['c','d']}];
let _dailyQueue=[
  {id:'q1',ids:['a','b','c','d'],team1:['a','b'],team2:['c','d'],restPass:{playerId:'a',createdAt:450}},
  {id:'q2',ids:['e','f','g','h']},
  {id:'q3',ids:['i','j','k','l']},
  {id:'q4',ids:['m','n','o','p']}
];
let updates=[];
function _dailyNow(){return 500;}
function dailyEnsureQueue(){}
function _dailyQueueIds(q){return q.ids;}
function _dailyOfficialRequestError(){return '';}
function _dailyMemberCourtOperationError(){return '';}
function _dailyCheckinRequestRef(){return {update(payload){updates.push(payload);return {catch(){}};}};}
function _dailyPromoteReadyReservations(){}
function dailySave(){}
function dailyRender(){}
function dailyMaybeAutoAssign(){}
${functionSource(dailySrc,'_dailyApplyQueueYield','_dailyApplyQueueDefer')}
${functionSource(dailySrc,'dailyProcessCheckinRequests','dailyApproveCheckinRequest')}
this.api={run:dailyProcessCheckinRequests,queue:()=>_dailyQueue,updates:()=>updates,pending:()=>_dailyCheckinRequests};`;
const officialQueueProcessSandbox={};
vm.createContext(officialQueueProcessSandbox);
vm.runInContext(officialQueueProcessCode,officialQueueProcessSandbox);
officialQueueProcessSandbox.api.run();
assert.deepStrictEqual(Array.from(officialQueueProcessSandbox.api.queue(),q=>q.id),['q2','q3','q4','q1'],'검증된 임원 요청은 해당 다음 대진을 선택한 순번까지 한 번에 이동해야 합니다.');
assert.strictEqual(officialQueueProcessSandbox.api.queue()[3].yieldedSource,'club-official-queue-yield','임원 순서 변경 출처를 회원 요청과 구분해 기록해야 합니다.');
assert.strictEqual(officialQueueProcessSandbox.api.queue()[3].yieldedBy,'official','순서 변경 감사 기록에는 대상 선수가 아닌 실행 임원을 남겨야 합니다.');
assert.strictEqual(officialQueueProcessSandbox.api.queue()[3].yieldedSteps,3,'관리자 원본에도 실제 이동한 순번 수를 기록해야 합니다.');
assert.strictEqual(officialQueueProcessSandbox.api.queue()[3].restPass,undefined,'임원 확정 이동 시 기존 조금 쉬고 임시 상태를 정리해야 합니다.');
assert.deepStrictEqual(Array.from(officialQueueProcessSandbox.api.queue()[3].team1),['a','b'],'다중 이동 처리 후에도 대진 팀 구성을 유지해야 합니다.');
assert.strictEqual(officialQueueProcessSandbox.api.updates()[0].appliedBy,'club-official-support','임원 순서 변경 요청은 임원 운영 처리로 완료 기록해야 합니다.');
assert.strictEqual(officialQueueProcessSandbox.api.pending().length,0,'반영된 임원 순서 변경 요청은 대기 목록에서 제거해야 합니다.');

const memberQueueValidationCode=`
const DAILY_OFFICIAL_REQUEST_TTL_MS=10*60*1000;
let now=100000;
let queueState='soon';
let restPassActive=false;
let _dailyQueue=[
  {id:'q1',team1:['a','b'],team2:['c','d']},
  {id:'q2',team1:['e','f'],team2:['g','h']}
];
function _dailyNow(){return now;}
function _dailyQueueIds(q){return [...q.team1,...q.team2];}
function _dailyOfficialFingerprint(ids){return (ids||[]).map(String).sort().join('|');}
function _dailyOfficialTeamFingerprint(team1,team2){const key=t=>(t||[]).map(String).sort().join('|');return [key(team1),key(team2)].sort().join(' VS ');}
function _dailyQueueRestPassActive(){return restPassActive;}
function _dailyQueueItemValid(){return true;}
function _dailyQueueStartInfo(){return {state:queueState,court:queueState==='free'?1:null};}
${functionSource(dailySrc,'_dailyMemberQueueYieldError','_dailyApplyQueueRestPass')}
this.api={error:_dailyMemberQueueYieldError,setNow:v=>now=v,setState:v=>queueState=v,setRest:v=>restPassActive=v};`;
const memberQueueValidationSandbox={};
vm.createContext(memberQueueValidationSandbox);
vm.runInContext(memberQueueValidationCode,memberQueueValidationSandbox);
const validMemberYield={type:'queue-yield',queueId:'q1',playerId:'a',queueIndex:1,expectedPlayerIds:['a','b','c','d'],expectedTeam1Ids:['a','b'],expectedTeam2Ids:['c','d'],createdAt:99990,expiresAt:100100};
assert.strictEqual(memberQueueValidationSandbox.api.error(validMemberYield),'','회원의 최신 본인 대진 뒤로 미루기는 그대로 허용해야 합니다.');
assert(memberQueueValidationSandbox.api.error({...validMemberYield,queueId:'missing'}).includes('찾지 못했습니다'),'오래된 queueId가 사라져도 같은 선수가 든 다른 대진으로 fallback하면 안 됩니다.');
assert(memberQueueValidationSandbox.api.error({...validMemberYield,queueIndex:2}).includes('순서가 이미 바뀌었습니다'),'회원 요청도 화면에서 본 순번이 달라졌으면 거절해야 합니다.');
assert(memberQueueValidationSandbox.api.error({...validMemberYield,expectedTeam1Ids:['a','c'],expectedTeam2Ids:['b','d']}).includes('팀 구성이 이미 바뀌었습니다'),'회원 요청도 같은 4명의 팀 조합이 바뀌었으면 거절해야 합니다.');
memberQueueValidationSandbox.api.setRest(true);
assert(memberQueueValidationSandbox.api.error(validMemberYield).includes('조금 쉬고'),'회원 요청도 조금 쉬고 처리된 대진을 중복 이동하면 안 됩니다.');
memberQueueValidationSandbox.api.setRest(false);
memberQueueValidationSandbox.api.setState('free');
assert(memberQueueValidationSandbox.api.error(validMemberYield).includes('빈 코트'),'회원 요청을 변조해 빈 코트 입장 대진을 뒤로 보내면 안 됩니다.');
memberQueueValidationSandbox.api.setState('soon');
memberQueueValidationSandbox.api.setNow(800001);
assert(memberQueueValidationSandbox.api.error(validMemberYield).includes('시간이 지나'),'오래된 회원 뒤로 미루기 요청을 다른 대진 흐름에 적용하면 안 됩니다.');

const roleSyncCode=`
function _teamGenderCode(g){return g==='F'||g==='여'?'F':'M';}
function levelToGrade(){return 'C';}
function gradeToLevel(){return 4;}
${functionSource(teamSrc,'_teamApplyDirectProfileToPlayer','_teamRecalcMatchLevels')}
this.sync=_teamApplyDirectProfileToPlayer;`;
const roleSyncSandbox={};
vm.createContext(roleSyncSandbox);
vm.runInContext(roleSyncCode,roleSyncSandbox);
const staleOfficial={name:'임원',grade:'C',gender:'M',level:4,isClubOfficial:true};
roleSyncSandbox.sync(staleOfficial,new Map([['임원',{name:'임원',grade:'C',gender:'M',level:4,isClubOfficial:false}]]));
assert.strictEqual(staleOfficial.isClubOfficial,false,'명부에서 임원 해제 시 기존 팀·대진·LIVE 권한도 즉시 회수해야 합니다.');

console.log('club official regression ok');
