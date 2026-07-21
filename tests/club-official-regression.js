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
assert(dailySrc.includes('officialQueueYieldV1:true'),'민턴LIVE 세션이 임원의 다음 대진 순서 조정 기능을 명시해야 합니다.');
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
assert(checkin.includes("main:'입장 준비',detail:'클럽 임원 확인 중'"),'일반 회원에게 클럽 임원 처리 대기 상태를 명확히 보여야 합니다.');
assert(checkin.includes("onclick=\"sendOfficialCourtComplete"),'클럽 임원의 경기 종료 기능은 유지해야 합니다.');
assert(checkin.includes("onclick=\"sendOfficialQueueEnter"),'클럽 임원의 빈 코트 입장 처리 기능은 유지해야 합니다.');
assert(checkin.includes('다음 대진 순서 조정')&&checkin.includes("type:'official-queue-yield'"),'클럽 임원은 특정 다음 대진을 한 칸 뒤로 보낼 수 있어야 합니다.');
assert(checkin.includes("officialQueueYieldV1!==true"),'구 관리자 세션에서는 지원되지 않는 임원 순서 조정 버튼을 숨겨야 합니다.');
assert(checkin.includes('expectedTeam1Ids:team1Ids')&&checkin.includes('expectedTeam2Ids:team2Ids'),'임원 순서 조정 요청은 화면에서 확인한 두 팀 구성까지 전달해야 합니다.');
assert(functionSource(checkin,'refreshOfficialConnection','renderMyCard').includes("btn.dataset.officialPending==='true'"),'연결 상태가 갱신되어도 처리 중인 임원 순서 조정 버튼이 다시 활성화되면 안 됩니다.');
const memberQueueSend=functionSource(checkin,'sendQueueDefer','sendQueueEnterFree');
assert(memberQueueSend.includes('expectedPlayerIds')&&memberQueueSend.includes('expectedTeam1Ids')&&memberQueueSend.includes('expiresAt'),'회원의 기존 뒤로 미루기도 오래된 다른 대진에 적용되지 않도록 지문과 만료시간을 보내야 합니다.');
const officialQueueUiCode=`
let session={capabilities:{officialQueueYieldV1:true}};
let officialRequests=[];
let list=[];
function eventNextList(){return list;}
function teamNames(q){return (q.t1||[]).join(' ')+' vs '+(q.t2||[]).join(' ');}
function esc(v){return String(v||'');}
${functionSource(checkin,'officialQueueYieldToolsHtml','officialSupportHtml')}
this.api={render:()=>officialQueueYieldToolsHtml({id:'official'},''),setList:v=>list=v,setRequests:v=>officialRequests=v};`;
const officialQueueUiSandbox={};
vm.createContext(officialQueueUiSandbox);
vm.runInContext(officialQueueUiCode,officialQueueUiSandbox);
const uiQ1={idx:1,queueId:'q1',cueState:'soon',t1:['A','B'],t2:['C','D']};
const uiQ2={idx:2,queueId:'q2',cueState:'ready',t1:['E','F'],t2:['G','H']};
officialQueueUiSandbox.api.setList([uiQ1,uiQ2]);
assert(officialQueueUiSandbox.api.render().includes('한 칸 뒤로'),'뒤에 대진이 있는 일반 대기 상태에서는 임원 순서 조정 버튼을 보여야 합니다.');
officialQueueUiSandbox.api.setRequests([{type:'official-queue-yield',queueId:'q1'}]);
const pendingQueueHtml=officialQueueUiSandbox.api.render();
assert(pendingQueueHtml.includes('data-official-pending="true"')&&pendingQueueHtml.includes('요청 중'),'같은 대진의 임원 요청 처리 중에는 중복 버튼을 비활성화해야 합니다.');
officialQueueUiSandbox.api.setRequests([]);
officialQueueUiSandbox.api.setList([{...uiQ1,cueState:'free',targetCourt:1},uiQ2]);
assert.strictEqual(officialQueueUiSandbox.api.render(),'','빈 코트 입장 단계와 마지막 대진만 남으면 임원 순서 조정 메뉴를 숨겨야 합니다.');
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
const players={
  official:{id:'official',isClubOfficial:true,status:'wait',lastStatusAt:10},
  member:{id:'member',isClubOfficial:false,status:'wait',lastStatusAt:20},
  playing:{id:'playing',isClubOfficial:false,status:'playing',currentMatchId:'played1',lastStatusAt:30},
  fake:{id:'fake',isClubOfficial:false,status:'wait',lastStatusAt:10}
};
let _dailyMatches=[
  {id:'match1',team1:['a','b'],team2:['c','d'],startedAt:123},
  {id:'played1',team1:['playing','x'],team2:['y','z'],startedAt:124}
];
let _dailyQueue=[
  {id:'queue1',team1:['e','f'],team2:['g','h']},
  {id:'queue2',team1:['i','j'],team2:['k','l']}
];
let queueState='soon';
let queueCourt=null;
let restPassActive=true;
let _dailyReservations=[{id:'pair1',mode:'pair',team1:['member','playing'],team2:[]}];
function _dailyPlayer(id){return players[id]||null;}
function _dailyNow(){return now;}
function _dailyNormalizeStatus(s){return s;}
function _dailyQueueIds(q){return [...q.team1,...q.team2];}
function dailyEnsureQueue(){}
function _dailyQueueItemValid(){return true;}
function _dailyQueueRestPassActive(q){return !!q.restPass&&restPassActive;}
function _dailyQueueStartInfo(){return {state:queueState,court:queueCourt};}
function _dailyExactKey(team1,team2){
  const teamKey=team=>(team||[]).map(String).sort().join('|');
  return [teamKey(team1),teamKey(team2)].sort().join(' VS ');
}
function _dailyFreeCourtRequestError(){return '';}
function _dailyReservationRequestError(){return '';}
${functionSource(dailySrc,'_dailyApplyQueueYield','_dailyApplyQueueDefer')}
${functionSource(dailySrc,'_dailyOfficialFingerprint','_dailyOfficialRequestError')}
${functionSource(dailySrc,'_dailyOfficialRequestError','_dailyApplyOfficialStatus')}
this.api={
  error:_dailyOfficialRequestError,
  apply:_dailyApplyQueueYield,
  setNow:v=>now=v,
  setMemberLast:v=>players.member.lastStatusAt=v,
  setQueueRestPass:v=>{_dailyQueue[0].restPass=v;},
  setRestPassActive:v=>{restPassActive=v;},
  setQueueState:(state,court)=>{queueState=state;queueCourt=court;},
  completePlaying:()=>{players.playing.status='wait';players.playing.currentMatchId=null;players.playing.lastStatusAt=31;_dailyMatches[1].completedAt=100000;}
};`;
const validationSandbox={};
vm.createContext(validationSandbox);
vm.runInContext(validationCode,validationSandbox);
const validBase={actorPlayerId:'official',createdAt:99990,expiresAt:100050};
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
const validYield={...validBase,type:'official-queue-yield',queueId:'queue1',expectedQueueIndex:1,expectedPlayerIds:['h','g','f','e'],expectedTeam1Ids:['e','f'],expectedTeam2Ids:['g','h']};
assert.strictEqual(validationSandbox.api.error(validYield),'','임원은 최신 순번과 같은 선수·팀 구성의 다음 대진을 뒤로 보낼 수 있어야 합니다.');
assert(validationSandbox.api.error({...validYield,expectedQueueIndex:2}).includes('순서가 이미 바뀌었습니다'),'오래된 순번을 기준으로 다른 대진을 이동하면 안 됩니다.');
assert(validationSandbox.api.error({...validYield,expectedPlayerIds:['e','f','g','x']}).includes('선수가 이미 바뀌었습니다'),'선수 구성이 바뀐 대진을 오래된 화면에서 이동하면 안 됩니다.');
assert(validationSandbox.api.error({...validYield,expectedTeam1Ids:['e','g'],expectedTeam2Ids:['f','h']}).includes('팀 구성이 이미 바뀌었습니다'),'같은 4명이라도 팀 조합이 바뀐 대진을 오래된 화면에서 이동하면 안 됩니다.');
assert(validationSandbox.api.error({...validYield,queueId:'queue2',expectedQueueIndex:2,expectedPlayerIds:['i','j','k','l'],expectedTeam1Ids:['i','j'],expectedTeam2Ids:['k','l']}).includes('뒤에 대진'),'마지막 대진은 더 뒤로 보낼 수 없어야 합니다.');
validationSandbox.api.setQueueRestPass({playerId:'e'});
assert(validationSandbox.api.error(validYield).includes('조금 쉬고'),'이미 조금 쉬고 처리된 대진을 중복 이동하면 안 됩니다.');
validationSandbox.api.setRestPassActive(false);
assert.strictEqual(validationSandbox.api.error(validYield),'','시간이 지난 조금 쉬고 기록만 남아 있는 대진은 다시 순서를 조정할 수 있어야 합니다.');
validationSandbox.api.setQueueRestPass(null);
validationSandbox.api.setRestPassActive(true);
validationSandbox.api.setQueueState('free',1);
assert(validationSandbox.api.error(validYield).includes('빈 코트'),'회원과 동일하게 빈 코트 입장 단계에서는 임원 뒤로 미루기를 허용하면 안 됩니다.');
validationSandbox.api.setQueueState('soon',null);
assert.strictEqual(validationSandbox.api.apply('e','queue1','club-official-queue-yield',{strict:true,yieldedBy:'official'}).ok,true,'검증된 임원 요청은 정확한 queueId의 대진을 한 칸 이동해야 합니다.');
assert(validationSandbox.api.error(validYield).includes('순서가 이미 바뀌었습니다'),'같은 임원 요청을 다시 처리해 대진을 두 칸 이동하면 안 됩니다.');
assert.strictEqual(validationSandbox.api.error({...validBase,type:'official-partner-reservation',playerIds:['member','playing']}),'','임원은 현재 참가자 두 명의 파트너 요청을 접수할 수 있어야 합니다.');
assert(validationSandbox.api.error({...validBase,type:'official-partner-reservation',playerIds:['member','member']}).includes('두 명'),'같은 선수를 중복 접수하면 안 됩니다.');
assert.strictEqual(validationSandbox.api.error({...validBase,type:'official-partner-cancel',reservationId:'pair1',expectedPlayerIds:['playing','member']}),'','같은 선수 지문의 파트너 접수는 취소할 수 있어야 합니다.');
assert(validationSandbox.api.error({...validBase,type:'official-partner-cancel',reservationId:'pair1',expectedPlayerIds:['member','fake']}).includes('바뀌었습니다'),'다른 파트너 접수를 오래된 화면에서 취소하면 안 됩니다.');
assert(validationSandbox.api.error({...validBase,type:'official-court-complete-undo'}).includes('종료 기록'),'토큰이 없는 종료 취소 요청을 적용하면 안 됩니다.');
validationSandbox.api.completePlaying();
assert.strictEqual(validationSandbox.api.error({...validBase,type:'official-player-status',playerId:'playing',status:'done',expectedStatus:'playing',expectedCurrentMatchId:'played1',expectedLastStatusAt:30}),'','경기 종료와 엇갈려 도착한 임원 귀가 요청도 같은 경기라면 반영해야 합니다.');
validationSandbox.api.setNow(800001);
assert(validationSandbox.api.error({...validBase,type:'official-player-status',playerId:'member',status:'rest'}).includes('시간이 지나'),'만료된 운영 요청을 앱 재실행 뒤 늦게 적용하면 안 됩니다.');

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
let _dailyCheckinRequests=[{key:'yield1',type:'official-queue-yield',actorPlayerId:'official',queueId:'q1',expectedQueueIndex:1,expectedPlayerIds:['a','b','c','d'],expectedTeam1Ids:['a','b'],expectedTeam2Ids:['c','d']}];
let _dailyQueue=[{id:'q1',ids:['a','b','c','d']},{id:'q2',ids:['e','f','g','h']}];
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
assert.deepStrictEqual(Array.from(officialQueueProcessSandbox.api.queue(),q=>q.id),['q2','q1'],'검증된 임원 요청은 해당 다음 대진만 정확히 한 칸 뒤로 이동해야 합니다.');
assert.strictEqual(officialQueueProcessSandbox.api.queue()[1].yieldedSource,'club-official-queue-yield','임원 순서 변경 출처를 회원 요청과 구분해 기록해야 합니다.');
assert.strictEqual(officialQueueProcessSandbox.api.queue()[1].yieldedBy,'official','순서 변경 감사 기록에는 대상 선수가 아닌 실행 임원을 남겨야 합니다.');
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
