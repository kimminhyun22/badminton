'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.join(__dirname,'..');
const storageSrc=fs.readFileSync(path.join(root,'js','storage.js'),'utf8');
const dailySrc=fs.readFileSync(path.join(root,'js','daily.js'),'utf8');
const teamSrc=fs.readFileSync(path.join(root,'js','team.js'),'utf8');
const indexHtml=fs.readFileSync(path.join(root,'index.html'),'utf8');
const teamHtml=fs.readFileSync(path.join(root,'team.html'),'utf8');

function sourceBetween(src,startName,endName){
  const start=src.indexOf(`function ${startName}`);
  const end=src.indexOf(`function ${endName}`,start+1);
  assert(start>=0&&end>start,`${startName} 함수 범위를 찾을 수 있어야 합니다.`);
  return src.slice(start,end);
}

assert(indexHtml.includes('id="dailyImportTeamRosterBtn"')&&indexHtml.includes('onclick="dailyImportTeamRoster()"'),'민턴LIVE 선수 영역에서 팀전 명단을 가져올 수 있어야 합니다.');
assert(teamHtml.includes('id="teamImportDailyRosterBtn"')&&teamHtml.includes('onclick="teamImportDailyRoster()"'),'팀전 참가자 영역에서 민턴LIVE 명단을 가져올 수 있어야 합니다.');
assert(teamHtml.includes('id="teamImportDailyRosterModalBtn"'),'기존 명부 선택 창에서도 민턴LIVE 명단을 바로 가져올 수 있어야 합니다.');
assert(!indexHtml.includes('등록 전 상태'),'명단 복사 UI에 폐기된 출석 상태를 다시 노출하면 안 됩니다.');

const memory=new Map();
let now=1000;
const storageSandbox={
  window:{},
  document:{querySelector:()=>null},
  localStorage:{
    getItem:key=>memory.has(key)?memory.get(key):null,
    setItem:(key,value)=>memory.set(key,String(value)),
    removeItem:key=>memory.delete(key)
  },
  Date:class extends Date{
    static now(){return now;}
  },
  console
};
vm.createContext(storageSandbox);
vm.runInContext(storageSrc,storageSandbox);
const bridge=storageSandbox.window.KokMatchRosterBridge;
assert(bridge,'공통 선수 명단 브리지가 준비되어야 합니다.');
assert.strictEqual(
  bridge.normalizePlayer({id:'daily-runtime-id',name:'세션아이디검증'}).memberId,
  '',
  '민턴LIVE 세션용 id를 다른 서비스의 명부 memberId로 승격하면 안 됩니다.'
);

memory.set('kokmatch_daily_v1',JSON.stringify({
  mode:'daily',
  appMode:'dailyLive',
  savedAt:500,
  players:[{
    id:'daily-runtime-id',memberId:'m-old',name:'기존민턴',grade:'C',level:4,gender:'M',ageGroup:'50대',
    status:'done',games:9,team:'청팀',partnerName:'누군가',currentMatchId:'m1'
  }]
}));
let snapshot=bridge.load('daily');
assert.strictEqual(snapshot.players.length,1,'업데이트 전 민턴LIVE 저장 명단도 한 번에 읽을 수 있어야 합니다.');
assert.strictEqual(snapshot.players[0].gender,'남','기존 성별 표기를 공통 형식으로 정규화해야 합니다.');
assert.strictEqual(snapshot.players[0].memberId,'m-old','세션용 id 대신 명부 memberId만 보존해야 합니다.');

now=2000;
bridge.save('daily',[
  {
    memberId:'m1',name:'김민턴',grade:'B',level:5,gender:'F',ageGroup:'40대',club:'일만클럽',
    isGuest:false,isClubOfficial:true,status:'playing',games:3,fairExpected:4,
    team:'홍팀',partnerName:'박파트너',partnerId:'pair1',currentMatchId:'dm1',afterMatchStatus:'done'
  },
  {memberId:'m2',name:' 김민턴 ',grade:'D',level:3,gender:'남'},
  {memberId:'m3',name:'이게스트',grade:'C',level:4,gender:'여',isGuest:true}
]);
snapshot=bridge.load('daily');
assert.strictEqual(snapshot.players.length,2,'동일 이름은 양쪽 서비스의 기존 제약에 맞춰 한 번만 복사해야 합니다.');
assert.deepStrictEqual(
  Object.keys(JSON.parse(JSON.stringify(snapshot.players[0]))).sort(),
  ['ageGroup','club','gender','grade','isClubOfficial','isGuest','level','memberId','name'].sort(),
  '명단 스냅샷에는 선수 프로필 필드만 남아야 합니다.'
);
['status','games','fairExpected','team','partnerName','partnerId','currentMatchId','afterMatchStatus'].forEach(key=>{
  assert(!Object.prototype.hasOwnProperty.call(snapshot.players[0],key),`${key} 운영 상태를 다른 LIVE로 복사하면 안 됩니다.`);
});
assert.strictEqual(snapshot.players[0].gender,'여','여성 성별을 공통 표기로 보존해야 합니다.');
assert.strictEqual(snapshot.players[0].isClubOfficial,true,'클럽 임원 정보는 명단 프로필로 보존해야 합니다.');

now=3000;
bridge.save('team',[
  {memberId:'t1',name:'박팀전',grade:'A',level:6,gender:'남',team:'청팀',partnerName:'최팀전'},
  {memberId:'t2',name:'최팀전',grade:'B',level:5,gender:'여',isGuest:true}
]);
snapshot=bridge.load('team');
assert.strictEqual(snapshot.players.length,2,'팀전 현재 참가자 명단을 저장해야 합니다.');
assert(!Object.prototype.hasOwnProperty.call(snapshot.players[0],'team'),'청·홍팀 배정은 민턴LIVE로 복사하면 안 됩니다.');
assert(!Object.prototype.hasOwnProperty.call(snapshot.players[0],'partnerName'),'팀전 파트너 지정은 민턴LIVE로 복사하면 안 됩니다.');

now=4000;
bridge.clear('daily');
snapshot=bridge.load('daily');
assert.strictEqual(snapshot.players.length,0,'민턴LIVE 초기화 후 이전 저장 상태가 다시 나타나면 안 됩니다.');

const teamImportSource=sourceBetween(teamSrc,'_teamRosterBridge','addDirectPlayer');
assert(teamImportSource.includes('currentMatches.length||teamAssignment||_liveOn||_liveId||_teamStoredLiveId()||_teamSavedBracketRestoreInfo()'),'팀 배정·저장 대진·LIVE 시작 후 명단 덮어쓰기를 막아야 합니다.');
assert(teamImportSource.includes('_partners=[]'),'민턴LIVE에서 팀전로 파트너 지정을 복사하면 안 됩니다.');
assert(teamImportSource.includes('isClubOfficial:!!raw.isClubOfficial'),'민턴LIVE 임원 프로필을 팀전에 보존해야 합니다.');
const savedRestoreSource=sourceBetween(teamSrc,'_teamSavedBracketRestoreInfo','_teamSavedLiveRestoreInfo');
assert(!savedRestoreSource.includes('_teamSaveLiveId('),'저장 여부를 확인하는 것만으로 종료한 LIVE ID를 되살리면 안 됩니다.');
const clearLiveSource=sourceBetween(teamSrc,'_teamClearLiveBroadcastData','stopLiveBroadcast');
assert(clearLiveSource.includes('explicitLiveId||_liveId||_teamStoredLiveId()'),'앱 재실행 뒤 전체 초기화해도 저장된 LIVE 노드를 정확히 지워야 합니다.');
const resetSource=sourceBetween(teamSrc,'resetAll','_teamEnsureMemberId');
assert(resetSource.includes('localStorage.removeItem(SAVE_KEY)'),'전체 초기화는 저장 대진도 즉시 지워야 합니다.');
assert(resetSource.includes('localStorage.removeItem(LEGACY_SHARED_SAVE_KEY)'),'구버전 팀전 저장본도 전체 초기화 뒤 다시 살아나면 안 됩니다.');
assert(!resetSource.includes('scheduleSave()'),'전체 초기화 직후 빈 상태 저장이 생략되어 이전 저장 대진을 남기면 안 됩니다.');

const teamSandbox={window:{KokMatchRosterBridge:{
  load:()=>({players:[
    {memberId:'d1',name:'민턴하나',grade:'B',level:5,gender:'남',ageGroup:'40대',club:'일만클럽',isGuest:false,isClubOfficial:true},
    {memberId:'d2',name:'민턴둘',grade:'C',level:4,gender:'여',ageGroup:'50대',club:'일만클럽',isGuest:true,isClubOfficial:false}
  ]}),
  save:()=>({})
}},document:{getElementById:()=>null},alert:()=>{},confirm:()=>true};
vm.createContext(teamSandbox);
vm.runInContext(`
let currentMatches=[],_liveOn=false,_liveId='',_directPlayers=[{name:'기존'}],_partners=[{id:'p1'}];
let _partnerSelectMode=true,_partnerSelectName='기존',teamAssignment=null;
let captains={blue:{leader:'기존',sub:''},white:{leader:'',sub:''}};
let temporaryOperators=[{memberId:'old',name:'기존'}];
let currentParticipants=[{name:'기존'}],currentSettings={teamMode:true};
let _teamParticipantSourceRsvpId='old',_lastRsvpImportSummary={attend:1};
function _teamStoredLiveId(){return '';}
function _teamSavedBracketRestoreInfo(){return null;}
function isTeamSampleMode(){return false;}
function _captureUndoSnapshot(){}
function levelToGrade(){return 'C';}
function gradeToLevel(){return 4;}
function _teamEnsureMemberId(player){if(!player.memberId)player.memberId='generated-'+player.name;}
function renderDirectPlayerList(){}
function syncDirectToPaste(){}
function updateTeamModeBadge(){}
function rsvpSyncRosterChange(){}
function renderAutoFlowDashboard(){}
function _autoFlowSetSection(){}
function closeImportModal(){}
${teamImportSource}
this.api={
  run:teamImportDailyRoster,
  state:()=>({players:_directPlayers,partners:_partners,teamAssignment,temporaryOperators,currentParticipants,currentSettings})
};
`,teamSandbox);
teamSandbox.api.run();
let teamState=JSON.parse(JSON.stringify(teamSandbox.api.state()));
assert.deepStrictEqual(teamState.players.map(player=>player.name),['민턴하나','민턴둘'],'민턴LIVE 선수 명단이 팀전 참가자 목록을 정확히 교체해야 합니다.');
assert.strictEqual(teamState.players[0].isClubOfficial,true,'양방향 복사 뒤에도 임원 정보를 유지해야 합니다.');
assert.deepStrictEqual(teamState.partners,[],'팀전 기존 파트너 지정은 명단 교체와 함께 비워야 합니다.');
assert.deepStrictEqual(teamState.temporaryOperators,[],'명단 교체 시 이전 자유대진 운영 도우미 권한을 남기면 안 됩니다.');
assert.strictEqual(teamState.teamAssignment,null,'이전 청·홍팀 배정을 새 명단에 남기면 안 됩니다.');

const dailyImportSource=sourceBetween(dailySrc,'_dailyRosterBridge','dailyAddPlayer');
assert(dailyImportSource.includes('_dailyCheckinId||_dailyOperationStarted||_dailyMatches.length'),'민턴LIVE 운영이나 회원 링크 시작 후 명단 덮어쓰기를 막아야 합니다.');
assert(dailyImportSource.includes("status:'wait'"),'가져온 선수는 출석 단계 없이 바로 민턴LIVE 대진 가능 상태가 되어야 합니다.');
assert(!dailyImportSource.includes('등록 전'),'민턴LIVE 가져오기 로직에 폐기된 출석 용어를 다시 넣으면 안 됩니다.');
assert(dailyImportSource.includes('_dailyQueue=[]')&&dailyImportSource.includes('_dailyReservations=[]'),'명단만 가져오고 이전 대기표와 파트너 신청은 비워야 합니다.');

const dailySandbox={window:{KokMatchRosterBridge:{
  load:()=>({players:[
    {memberId:'t1',name:'팀전하나',grade:'A',level:6,gender:'남',ageGroup:'30대',club:'일만클럽',isGuest:false,isClubOfficial:true},
    {memberId:'t2',name:'팀전둘',grade:'B',level:5,gender:'여',ageGroup:'40대',club:'일만클럽',isGuest:false,isClubOfficial:false}
  ]}),
  save:()=>({})
}},document:{getElementById:()=>null},alert:()=>{},confirm:()=>true};
vm.createContext(dailySandbox);
vm.runInContext(`
let _dailyCheckinId=null,_dailyOperationStarted=false,_dailyMatches=[],_dailyPlayers=[{name:'기존'}];
let _dailyQueue=[{id:'old'}],_dailyReservations=[{id:'old'}],_dailyNext={id:'old'},_dailySeq=9,_dailyWaveStarts=2;
let _dailyPairSelectId='old',_dailyAutoAssign=true,_dailyFinishMode=true,_dailyFinishStartedAt=1;
let _dailyPaused=false,_dailyPausedAt=0,_dailyPauseReason='',_dailyLastCompleteUndo={token:'old'};
function _dailyBlockServerSync(){return false;}
function _dailyNow(){return 5000;}
let nextId=1;
function _dailyNormalize(raw){return {...raw,id:'new'+nextId++,partnerName:null,partnerId:null};}
function _dailyClearSimpleTeamState(){_dailyPlayers.forEach(player=>{player.team='';});}
function _dailyMarkFourCacheDirty(){}
function dailySave(){}
function dailyRender(){}
${dailyImportSource}
this.api={
  run:dailyImportTeamRoster,
  state:()=>({players:_dailyPlayers,matches:_dailyMatches,queue:_dailyQueue,reservations:_dailyReservations,operationStarted:_dailyOperationStarted})
};
`,dailySandbox);
dailySandbox.api.run();
const dailyState=JSON.parse(JSON.stringify(dailySandbox.api.state()));
assert.deepStrictEqual(dailyState.players.map(player=>player.name),['팀전하나','팀전둘'],'팀전 선수 명단이 민턴LIVE 선수 목록을 정확히 교체해야 합니다.');
assert(dailyState.players.every(player=>player.status==='wait'),'복사 직후 모든 선수는 별도 출석 절차 없이 대진 가능해야 합니다.');
assert(dailyState.players.every(player=>player.team===''&&!player.partnerName),'팀·파트너 운영 정보를 민턴LIVE에 남기면 안 됩니다.');
assert.deepStrictEqual(dailyState.queue,[],'이전 민턴LIVE 대기표를 새 명단에 연결하면 안 됩니다.');
assert.deepStrictEqual(dailyState.reservations,[],'이전 파트너 신청을 새 명단에 연결하면 안 됩니다.');

console.log('cross live roster regression ok');
