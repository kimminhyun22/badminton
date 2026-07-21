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
assert(dailySrc.includes('capabilities:{officialOpsV1:true}'),'민턴LIVE 회원 페이지에 제한 운영 기능 계약을 게시해야 합니다.');
assert(dailySrc.includes('isClubOfficial:!!p.isClubOfficial'),'민턴LIVE 참가자 세션에 임원 역할을 전달해야 합니다.');
assert(dailySrc.includes("source:'club-official-complete'"),'임원 경기 종료는 관리자 원본에서 별도 출처로 기록해야 합니다.');
assert(functionSource(dailySrc,'importDirectFromDaily','openEditDirectPlayer').includes('isClubOfficial:!!p.isClubOfficial'),'민턴LIVE 참가자를 팀전으로 가져올 때 임원 역할을 보존해야 합니다.');
assert(functionSource(dailySrc,'dailyReset','dailyToggleAutoAssign').includes('_dailyStopOperatorHeartbeat'),'민턴LIVE 초기화 시 운영 연결과 화면 켜짐 요청을 정리해야 합니다.');
assert(checkin.includes('클럽 임원 운영 지원'),'회원 페이지에서 임원용 최소 운영 화면을 제공해야 합니다.');
assert(checkin.includes('operatorConnected()'),'관리자 앱 연결 상태에 따라 임원 버튼을 제어해야 합니다.');
assert(checkin.includes("source:'club-official-support'"),'임원 요청을 일반 회원 요청과 구분해야 합니다.');
const memberQueueNotice=functionSource(checkin,'nextQueueNoticeHtml','refreshMyQueueNotice');
assert(!memberQueueNotice.includes('sendQueueEnterFree'),'일반 회원의 다음 대진 카드에서 직접 입장 처리를 제공하면 안 됩니다.');
assert(!memberQueueNotice.includes('openCourtCompletePicker'),'일반 회원의 다음 대진 카드에서 코트 선택을 제공하면 안 됩니다.');
assert(memberQueueNotice.includes('sendQueueRestPass'),'일반 회원은 입장 직전에도 조금 쉬고 요청을 보낼 수 있어야 합니다.');
const memberEventBoard=functionSource(checkin,'renderEvent','render');
assert(!memberEventBoard.includes('sendQueueEnterFree'),'일반 회원 상황판에서도 직접 입장 처리를 제공하면 안 됩니다.');
assert(!memberEventBoard.includes('openCourtCompletePicker'),'일반 회원 상황판에서도 코트 선택을 제공하면 안 됩니다.');
assert(memberEventBoard.includes('sendQueueRestPass'),'일반 회원 상황판의 조금 쉬고 요청은 유지해야 합니다.');
assert(checkin.includes("main:'입장 준비',detail:'관리자·임원 확인 중'"),'일반 회원에게 운영진 처리 대기 상태를 명확히 보여야 합니다.');
assert(checkin.includes("onclick=\"sendOfficialCourtComplete"),'클럽 임원의 경기 종료 기능은 유지해야 합니다.');
assert(checkin.includes("onclick=\"sendOfficialQueueEnter"),'클럽 임원의 빈 코트 입장 처리 기능은 유지해야 합니다.');
assert(checkin.includes("'경기중 · 경기 후 반영'"),'임원 선수 선택에서 경기중 선수의 경기 후 상태도 처리할 수 있어야 합니다.');
assert(dailySrc.includes('afterMatchStatus:p.afterMatchStatus'), '임원 화면에 경기 후 휴식·종료 예약 상태를 전달해야 합니다.');
assert(checkin.includes('expectedCurrentMatchId:target.currentMatchId'), '임원 요청이 경기 종료와 엇갈려 도착해도 같은 경기를 식별할 수 있어야 합니다.');
const memberCourtBoundary=functionSource(dailySrc,'_dailyMemberCourtOperationError','_dailyOfficialFingerprint');
const memberCourtSandbox={};
vm.createContext(memberCourtSandbox);
vm.runInContext(`${memberCourtBoundary};this.error=_dailyMemberCourtOperationError;`,memberCourtSandbox);
assert(memberCourtSandbox.error({type:'court-complete'}).includes('관리자 또는 클럽 임원'),'구버전 회원의 경기 종료 요청도 관리자에서 거절해야 합니다.');
assert(memberCourtSandbox.error({type:'queue-enter-free'}).includes('관리자 또는 클럽 임원'),'구버전 회원의 직접 입장 요청도 관리자에서 거절해야 합니다.');
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
const DAILY_OFFICIAL_REQUEST_TTL_MS=90000;
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
let _dailyQueue=[{id:'queue1',team1:['e','f'],team2:['g','h']}];
function _dailyPlayer(id){return players[id]||null;}
function _dailyNow(){return now;}
function _dailyNormalizeStatus(s){return s;}
function _dailyQueueIds(q){return [...q.team1,...q.team2];}
function _dailyFreeCourtRequestError(){return '';}
${functionSource(dailySrc,'_dailyOfficialFingerprint','_dailyOfficialRequestError')}
${functionSource(dailySrc,'_dailyOfficialRequestError','_dailyApplyOfficialStatus')}
this.api={
  error:_dailyOfficialRequestError,
  setNow:v=>now=v,
  setMemberLast:v=>players.member.lastStatusAt=v,
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
assert(validationSandbox.api.error({...validBase,type:'official-court-complete-undo'}).includes('종료 기록'),'토큰이 없는 종료 취소 요청을 적용하면 안 됩니다.');
validationSandbox.api.completePlaying();
assert.strictEqual(validationSandbox.api.error({...validBase,type:'official-player-status',playerId:'playing',status:'done',expectedStatus:'playing',expectedCurrentMatchId:'played1',expectedLastStatusAt:30}),'','경기 종료와 엇갈려 도착한 임원 귀가 요청도 같은 경기라면 반영해야 합니다.');
validationSandbox.api.setNow(200001);
assert(validationSandbox.api.error({...validBase,type:'official-player-status',playerId:'member',status:'rest'}).includes('시간이 지나'),'만료된 운영 요청을 앱 재실행 뒤 늦게 적용하면 안 됩니다.');

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
