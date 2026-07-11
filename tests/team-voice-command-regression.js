const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js', 'team.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'team.html'), 'utf8');

function extractFunction(name, nextName) {
  const functionStart = src.indexOf(`function ${name}`);
  assert(functionStart >= 0, `${name} 함수가 있어야 합니다.`);
  const start = src.slice(Math.max(0,functionStart-6),functionStart)==='async '
    ? functionStart-6
    : functionStart;
  const end = src.indexOf(`function ${nextName}`, functionStart);
  assert(end > functionStart, `${name} 함수의 끝을 찾을 수 있어야 합니다.`);
  return src.slice(start, end);
}

const code = `
let currentParticipants=[];
let currentMatches=[];
let _liveOn=true;
let currentSettings={teamMode:true};
let teamAssignment=null;
let _partners=[];
const winOverride={};
const teamNames={blue:'청 팀',white:'홍 팀'};
const captains={blue:{leader:'',sub:''},white:{leader:'',sub:''}};
let _liveId='LIVE1';
let _liveAttendance={};
let _liveParty={};
let _liveResultInputs={};
let _liveResultConflicts={};
let remoteLiveData={};
let lastLiveUpdate=null;
let rsvpSessionPushCount=0;
const _fbDb={ref(){return {
  async once(){return {val(){return remoteLiveData;}};},
  async update(value){lastLiveUpdate=value;remoteLiveData={...remoteLiveData,...value};}
};}};
const document={getElementById(){return {value:''};}};
function effLevel(p){return Number(p.level)||0;}
function _isMatchDone(index){return !!winOverride[index];}
function _liveKey(name){return String(name||'');}
function _buildLiveState(){return {bracketKey:'new-bracket'};}
function rsvpPushSession(){rsvpSessionPushCount++;}
async function rsvpPushEventState(){return {};}
function _teamLiveScoreCounts(){return {blueWins:0,whiteWins:0};}
function _teamLivePendingCourts(round){
  return currentMatches.map((m,i)=>({m,i})).filter(x=>x.m.round===round&&!_isMatchDone(x.i)).map(x=>x.m.court+'코트');
}
${extractFunction('_teamVoiceNormalizeText', '_teamVoiceNumber')}
${extractFunction('_teamVoiceNumber', '_teamVoiceTaggedNumber')}
${extractFunction('_teamVoiceTaggedNumber', '_teamVoiceFindParticipantName')}
${extractFunction('_teamVoiceFindParticipantName', '_teamVoiceParseLocalCommand')}
${extractFunction('_teamVoiceParseLocalCommand', '_teamVoiceCommandContext')}
${extractFunction('_teamVoiceCurrentRound', '_teamVoiceMatchTarget')}
${extractFunction('_teamVoiceMatchTarget', '_teamVoiceTeamSide')}
${extractFunction('_teamVoiceTeamSide', '_teamVoiceWinnerTeam')}
${extractFunction('_teamVoiceWinnerTeam', '_teamVoiceTeamLabel')}
${extractFunction('_teamVoiceTeamLabel', '_teamVoiceMatchNames')}
${extractFunction('_teamVoiceMatchNames', '_teamVoiceError')}
${extractFunction('_teamVoiceError', '_teamVoiceResolveParticipant')}
${extractFunction('_teamVoiceResolveParticipant', '_teamVoiceValidatePlan')}
${extractFunction('_teamVoiceValidatePlan', '_teamVoiceSetStatus')}
${extractFunction('_teamVoiceFinalizeLiveReallocation', 'applyTeamVoiceCommand')}
${extractFunction('_teamSyncAssignmentAfterExclusion', 'executeChangeModal')}
this.api={
  setParticipants(value){currentParticipants=value;},
  setMatches(value){currentMatches=value;},
  setWin(index,value){if(value)winOverride[index]=value;else delete winOverride[index];},
  setAssignment(value){teamAssignment=value;},
  setPartners(value){_partners=value;},
  setCaptain(side,role,name){captains[side][role]=name;},
  syncAssignment(participants,names){_teamSyncAssignmentAfterExclusion(participants,new Set(names));},
  assignmentState(){return {teamAssignment,partners:_partners,captains};},
  setRemote(value){remoteLiveData=value;},
  finalize:_teamVoiceFinalizeLiveReallocation,
  liveUpdateState(){return {lastLiveUpdate,rsvpSessionPushCount};},
  parse:_teamVoiceParseLocalCommand,
  validate:_teamVoiceValidatePlan
};
`;

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const api = sandbox.api;

function player(name, team, level = 4) {
  return { name, team, level, grade: 'C', gender: 'M' };
}
function match(round, court, t1a, t1b, t2a, t2b) {
  return { round, court, team1A: t1a, team1B: t1b, team2C: t2a, team2D: t2b };
}

const blueA = player('김민현', '청팀', 5);
const blueB = player('이준호', '청팀', 4);
const blueC = player('박정우', '청팀', 3);
const redA = player('최영희', '홍팀', 5);
const redB = player('정수진', '홍팀', 4);
const redC = player('한서연', '홍팀', 3);
api.setParticipants([blueA, blueB, blueC, redA, redB, redC]);
api.setMatches([
  match(1, 1, blueA, blueB, redA, redB),
  match(1, 2, redA, redC, blueB, blueC),
  match(2, 1, blueA, blueC, redB, redC)
]);

let plan = api.parse('1번 코트 청팀 승');
assert.deepStrictEqual(JSON.parse(JSON.stringify(plan)), {type:'set_winner',court:1,round:null,team:'blue'});
let result = api.validate(plan);
assert.strictEqual(result.ok, true, '현재 라운드 1코트 승패를 검증해야 합니다.');
assert.strictEqual(result.plan.side, 't1', '청팀이 1조이면 t1 승으로 매핑해야 합니다.');

plan = api.parse('2코트 청팀 승리');
result = api.validate(plan);
assert.strictEqual(result.plan.side, 't2', '청팀이 2조이면 t2 승으로 매핑해야 합니다.');

api.setWin(0, 't1');
plan = api.parse('1코트 결과 취소');
result = api.validate(plan);
assert.strictEqual(result.ok, true, '입력된 현재 경기 결과는 취소할 수 있어야 합니다.');
assert.strictEqual(result.plan.type, 'clear_winner');

api.setWin(0, null);
plan = api.parse('김 민현 부상으로 제외');
result = api.validate(plan);
assert.strictEqual(result.ok, true, '띄어쓰기가 달라도 현재 참가자를 찾아야 합니다.');
assert.strictEqual(result.plan.playerName, '김민현');
assert(result.impact.includes('기존 0경기 유지'), '미완료 전체 재배정 범위를 보여줘야 합니다.');
assert(result.impact.includes('1인 평균 실력차'), '팀 인원이 달라지면 총합 대신 1인 평균 실력차를 보여줘야 합니다.');

plan = api.parse('김민현 2라운드부터 제외');
assert.strictEqual(plan.fromRound, 2, '말한 시작 라운드를 구조화해야 합니다.');
result = api.validate(plan);
assert.strictEqual(result.ok, true, '입력 완료 결과가 없는 미래 라운드는 선택할 수 있어야 합니다.');

api.setWin(2, 't1');
result = api.validate(plan);
assert.strictEqual(result.ok, false, '선택 라운드 이후 완료 결과가 있으면 재배정을 막아야 합니다.');
api.setWin(2, null);

plan = api.parse('현재 상황 알려줘');
assert.strictEqual(plan.type, 'status');
plan = api.parse('승패 결과 보여줘');
assert.deepStrictEqual(JSON.parse(JSON.stringify(plan)), {type:'open_panel',target:'scoreboard'});
plan = api.parse('다음 경기 보여줘');
assert.deepStrictEqual(JSON.parse(JSON.stringify(plan)), {type:'open_panel',target:'bracket'});

api.setParticipants([blueA, player('김민현','청팀',4), blueB, redA, redB]);
result = api.validate({type:'exclude_player',playerName:'김민현',fromRound:null});
assert.strictEqual(result.ok, false, '동명이인은 음성으로 임의 선택하면 안 됩니다.');

assert(html.includes('id="teamVoiceModal"'), '음성 명령 확인 모달이 있어야 합니다.');
assert(src.includes('window.KokMatchTeamVoiceAI'), '보안 프록시 AI 해석기 연결점이 있어야 합니다.');
assert(!/sk-[A-Za-z0-9_-]{20,}/.test(src), '브라우저 코드에 OpenAI 비밀키가 들어가면 안 됩니다.');

api.setAssignment({blue:[blueA,blueB,blueC],white:[redA,redB,redC]});
api.setPartners([{id:'p1',members:['김민현','이준호']}]);
api.setCaptain('blue','sub','김민현');
api.syncAssignment([blueB,blueC,redA,redB,redC],['김민현']);
const assignmentState=api.assignmentState();
assert.strictEqual(assignmentState.teamAssignment.blue.length,2,'제외 선수가 청팀 명단에 남으면 안 됩니다.');
assert.strictEqual(assignmentState.partners.length,0,'제외 선수가 포함된 파트너 지정은 해제되어야 합니다.');
assert.strictEqual(assignmentState.captains.blue.sub,'','제외 선수의 부단장 지정은 해제되어야 합니다.');

(async()=>{
  api.setRemote({
    attendance:{김민현:{name:'김민현'},이준호:{name:'이준호'}},
    party:{김민현:{name:'김민현'}},
    resultInputs:{'1_1':{kept:true},'2_1':{stale:true}},
    resultConflicts:{'2_1':{stale:true}}
  });
  await api.finalize('김민현',['2_1']);
  const liveState=api.liveUpdateState();
  assert(!liveState.lastLiveUpdate.attendance.김민현,'제외 선수의 LIVE 출석 상태는 제거되어야 합니다.');
  assert(liveState.lastLiveUpdate.attendance.이준호,'남은 선수의 최신 출석 상태는 보존되어야 합니다.');
  assert(liveState.lastLiveUpdate.resultInputs['1_1'],'완료 경기의 회원 승패 입력은 보존되어야 합니다.');
  assert(!liveState.lastLiveUpdate.resultInputs['2_1'],'재생성 경기의 이전 승패 입력은 제거되어야 합니다.');
  assert.strictEqual(liveState.rsvpSessionPushCount,1,'팀전LIVE 회원 명단을 다시 저장해야 합니다.');
  console.log('team voice command regression ok');
})().catch(error=>{console.error(error);process.exitCode=1;});
