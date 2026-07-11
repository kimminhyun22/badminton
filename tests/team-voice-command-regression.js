const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js', 'team.js'), 'utf8');
const aiSrc = fs.readFileSync(path.join(root, 'js', 'team-ai.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'team.html'), 'utf8');

function extractFunction(name, nextName) {
  const functionStart = src.indexOf(`function ${name}`);
  assert(functionStart >= 0, `${name} 함수가 있어야 합니다.`);
  const start = src.slice(Math.max(0,functionStart-6),functionStart)==='async '
    ? functionStart-6
    : functionStart;
  const nextFunctionStart = src.indexOf(`function ${nextName}`, functionStart);
  assert(nextFunctionStart > functionStart, `${name} 함수의 끝을 찾을 수 있어야 합니다.`);
  const end = src.slice(Math.max(0,nextFunctionStart-6),nextFunctionStart)==='async '
    ? nextFunctionStart-6
    : nextFunctionStart;
  return src.slice(start, end);
}

const code = `
let currentParticipants=[];
let currentMatches=[];
let _liveOn=true;
let _teamVoiceInterpretationSource='local';
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
const window={};
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
function _teamVoiceSetStatus(){}
${extractFunction('_teamVoiceNormalizeText', '_teamVoiceNumber')}
${extractFunction('_teamVoiceNumber', '_teamVoiceTaggedNumber')}
${extractFunction('_teamVoiceTaggedNumber', '_teamVoiceFindParticipantName')}
${extractFunction('_teamVoiceFindParticipantName', '_teamVoiceParseLocalCommand')}
${extractFunction('_teamVoiceParseLocalCommand', '_teamVoiceCommandContext')}
${extractFunction('_teamVoiceCommandContext', '_teamVoiceNormalizeExternalPlan')}
${extractFunction('_teamVoiceNormalizeExternalPlan', '_teamVoiceInterpretCommand')}
${extractFunction('_teamVoiceInterpretCommand', '_teamVoiceCurrentRound')}
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
  interpret:_teamVoiceInterpretCommand,
  setInterpreter(value){window.KokMatchTeamVoiceAI=value;},
  interpretationSource(){return _teamVoiceInterpretationSource;},
  validate:_teamVoiceValidatePlan
};
`;

const sandbox = { console:{log:console.log,error:console.error,warn(){}} };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const api = sandbox.api;

const aiSandbox=vm.createContext({
  window:{},
  document:{querySelector(){return null;}},
  setTimeout,
  clearTimeout,
  console
});
vm.runInContext(aiSrc,aiSandbox);
const aiPrivacy=JSON.parse(vm.runInContext(`JSON.stringify((()=>{
  const redaction=_kokMatchAIRedactCommand('김 민현이 다쳐서 오늘 그만',{
    participants:[{name:'김민현'},{name:'이준호'}]
  });
  const prompt=_kokMatchAIPrompt(redaction.redacted,{
    currentRound:2,
    participants:[{name:'김민현'}],
    matches:[{round:2,court:1,done:false,team1:['김민현'],team2:['이준호']}]
  });
  return {
    redacted:redaction.redacted,
    restored:_kokMatchAIRestorePlan({type:'exclude_player',playerName:'[선수1]'},redaction.tokenToName),
    invented:_kokMatchAIRestorePlan({type:'exclude_player',playerName:'홍길동'},redaction.tokenToName),
    promptHasName:prompt.includes('김민현')||prompt.includes('이준호'),
    promptHasTeams:prompt.includes('team1')||prompt.includes('team2'),
    prompt
  };
})())`,aiSandbox));

assert.strictEqual(aiPrivacy.redacted,'[선수1]이 다쳐서 오늘 그만','AI 전송 전 등록 선수 이름을 토큰으로 바꿔야 합니다.');
assert.strictEqual(aiPrivacy.restored.playerName,'김민현','AI가 돌려준 선수 토큰은 기기에서 원래 이름으로 복원해야 합니다.');
assert.strictEqual(aiPrivacy.invented.playerName,'','AI가 임의로 만든 선수 이름은 적용 후보에서 제거해야 합니다.');
assert.strictEqual(aiPrivacy.promptHasName,false,'AI 프롬프트에 등록 선수 이름이 포함되면 안 됩니다.');
assert.strictEqual(aiPrivacy.promptHasTeams,false,'AI 프롬프트에 경기별 팀 선수 정보가 포함되면 안 됩니다.');

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

plan = api.parse('첫 번째 코트는 파란 팀이 가져갔어');
assert.deepStrictEqual(JSON.parse(JSON.stringify(plan)), {type:'set_winner',court:1,round:null,team:'blue'});
result = api.validate(plan);
assert.strictEqual(result.ok, true, '일상적인 승리 표현과 서수 코트 표현을 이해해야 합니다.');
assert.strictEqual(api.parse('1코트 청 승').team, 'blue', '버튼 명칭처럼 짧게 말한 청 승도 이해해야 합니다.');
assert.strictEqual(api.parse('2코트는 홍이 이겼어').team, 'white', '홍이 이겼다는 구어체도 이해해야 합니다.');

api.setWin(0, 't1');
plan = api.parse('1코트 결과 취소');
result = api.validate(plan);
assert.strictEqual(result.ok, true, '입력된 현재 경기 결과는 취소할 수 있어야 합니다.');
assert.strictEqual(result.plan.type, 'clear_winner');

plan = api.parse('1코트 잘못 입력했어 되돌려 줘');
assert.strictEqual(plan.type, 'clear_winner', '잘못 입력했다는 자연어도 결과 취소로 이해해야 합니다.');

api.setWin(0, null);
plan = api.parse('김 민현 부상으로 제외');
result = api.validate(plan);
assert.strictEqual(result.ok, true, '띄어쓰기가 달라도 현재 참가자를 찾아야 합니다.');
assert.strictEqual(result.plan.playerName, '김민현');
assert(result.impact.includes('기존 0경기 유지'), '미완료 전체 재배정 범위를 보여줘야 합니다.');
assert(result.impact.includes('1인 평균 실력차'), '팀 인원이 달라지면 총합 대신 1인 평균 실력차를 보여줘야 합니다.');

plan = api.parse('김민현이 다쳐서 오늘 그만');
assert.strictEqual(plan.type, 'exclude_player', '부상 상황을 일상 표현으로 말해도 선수 제외로 이해해야 합니다.');
assert.strictEqual(api.parse('김민현 오늘 못 나와').type, 'exclude_player', '참가 불가 구어체도 선수 제외로 이해해야 합니다.');

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
plan = api.parse('지금 누가 이기고 있어?');
assert.strictEqual(plan.type, 'status', '자연스러운 점수 질문을 현재 현황으로 이해해야 합니다.');
plan = api.parse('승패 결과 보여줘');
assert.deepStrictEqual(JSON.parse(JSON.stringify(plan)), {type:'open_panel',target:'scoreboard'});
plan = api.parse('다음 경기 보여줘');
assert.deepStrictEqual(JSON.parse(JSON.stringify(plan)), {type:'open_panel',target:'bracket'});

plan = api.parse('청홍팀 밸런스 다시 맞춰');
assert.strictEqual(plan.type, 'team_balance_review', '청홍팀 밸런스 요청을 놓치면 안 됩니다.');
api.setWin(0, 't1');
result = api.validate(plan);
assert.strictEqual(result.ok, true, '진행 중 팀 재배정 요청의 의도를 이해해야 합니다.');
assert(result.title.includes('이해했습니다'), '요청을 이해했다는 사실을 명확히 보여줘야 합니다.');
assert(result.impact.includes('LIVE 중에는 팀을 다시 나누지 않습니다'), '완료 결과와 팀 소속을 보호해야 합니다.');
assert.strictEqual(result.applyLabel, '팀 목록 보기', '안전하게 현재 팀 구성을 확인할 수 있어야 합니다.');
api.setWin(0, null);
result = api.validate(plan);
assert(result.impact.includes('중계 중에는 팀을 다시 나누지 않습니다'), '첫 경기 전에도 LIVE 링크와 대진 일치를 보호해야 합니다.');
assert.strictEqual(api.parse('양 팀 전력 차 좀 줄여 줘').type, 'team_balance_review');
assert.strictEqual(api.parse('팀 다시 나눠 줘').type, 'team_balance_review');

api.setParticipants([blueA, player('김민현','청팀',4), blueB, redA, redB]);
result = api.validate({type:'exclude_player',playerName:'김민현',fromRound:null});
assert.strictEqual(result.ok, false, '동명이인은 음성으로 임의 선택하면 안 됩니다.');

assert(html.includes('id="teamVoiceModal"'), '음성 명령 확인 모달이 있어야 합니다.');
assert(html.includes('type="module" src="js/team-ai.js'), 'Firebase AI Logic 명령 해석 모듈을 불러와야 합니다.');
assert(/meta name="firebase-app-check-site-key" content="[^"]+"/.test(html), 'Firebase AI Logic 호출에는 App Check 사이트 키가 있어야 합니다.');
assert(src.includes('window.KokMatchTeamVoiceAI'), '보안 프록시 AI 해석기 연결점이 있어야 합니다.');
assert(!/sk-[A-Za-z0-9_-]{20,}/.test(src), '브라우저 코드에 OpenAI 비밀키가 들어가면 안 됩니다.');
assert(!/AIza[A-Za-z0-9_-]{20,}/.test(aiSrc), 'AI 모듈에 Firebase 또는 Gemini 키를 중복 저장하면 안 됩니다.');
assert(aiSrc.includes('_kokMatchAIRedactCommand'), 'AI 전송 전에 등록 선수 이름을 치환해야 합니다.');
assert(aiSrc.includes('kokmatch/app-check-site-key-missing'), 'App Check 키가 없으면 무보호 AI 호출을 차단해야 합니다.');
assert(aiSrc.includes('JSON.stringify(_kokMatchAICompactContext(context))'), 'AI에는 최소화한 운영 문맥만 보내야 합니다.');
const compactStart=aiSrc.indexOf('function _kokMatchAICompactContext');
const compactEnd=aiSrc.indexOf('function _kokMatchAIPrompt',compactStart);
const compactSource=aiSrc.slice(compactStart,compactEnd);
assert(!/participants|team1|team2|playerName/.test(compactSource), 'AI 운영 문맥에 회원 명단이나 경기별 선수 이름을 포함하면 안 됩니다.');
assert(src.includes("team:{tab:'players',id:'teamListWrap',open:'sec-settings'}"), '팀 목록 보기는 실제 청·홍팀 목록과 실력차로 이동해야 합니다.');
const openVoiceSource=extractFunction('openTeamVoiceCommand','closeTeamVoiceCommand');
const startVoiceSource=extractFunction('startTeamVoiceListening','toggleTeamVoiceListening');
assert(!openVoiceSource.includes('startTeamVoiceListening();'), '음성 창을 열 때 마이크를 자동 시작하면 iPhone 키보드 입력을 막을 수 있습니다.');
assert(openVoiceSource.includes('input.focus();'), '음성 창은 텍스트 입력을 먼저 사용할 수 있어야 합니다.');
assert(html.includes('onpointerdown="stopTeamVoiceListeningForText()"'), '입력창을 누르면 음성 세션을 먼저 종료해야 합니다.');
assert(startVoiceSource.includes('_teamVoiceStartTimer=setTimeout'), '마이크 시작 무응답을 텍스트 입력으로 돌리는 감시 타이머가 있어야 합니다.');

api.setAssignment({blue:[blueA,blueB,blueC],white:[redA,redB,redC]});
api.setPartners([{id:'p1',members:['김민현','이준호']}]);
api.setCaptain('blue','sub','김민현');
api.syncAssignment([blueB,blueC,redA,redB,redC],['김민현']);
const assignmentState=api.assignmentState();
assert.strictEqual(assignmentState.teamAssignment.blue.length,2,'제외 선수가 청팀 명단에 남으면 안 됩니다.');
assert.strictEqual(assignmentState.partners.length,0,'제외 선수가 포함된 파트너 지정은 해제되어야 합니다.');
assert.strictEqual(assignmentState.captains.blue.sub,'','제외 선수의 부단장 지정은 해제되어야 합니다.');

(async()=>{
  api.setInterpreter(async()=>({type:'status'}));
  const interpreted=await api.interpret('운영 흐름을 간단히 브리핑해 줘');
  assert.strictEqual(interpreted.type,'status','로컬 범위 밖 자연어는 AI 구조화 결과를 사용해야 합니다.');
  assert.strictEqual(api.interpretationSource(),'ai','AI가 해석한 명령임을 UI가 구분할 수 있어야 합니다.');
  api.setInterpreter(async()=>{const error=new Error('timeout');error.code='kokmatch/ai-timeout';throw error;});
  const aiFailed=await api.interpret('알아서 지금 필요한 운영을 해 줘');
  assert.strictEqual(aiFailed.type,'unknown','AI 실패 시 임의 명령을 만들어 실행하면 안 됩니다.');
  assert(aiFailed.aiError.includes('응답이 늦어'),'AI 실패 원인을 사용자에게 안전한 문구로 알려야 합니다.');

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
