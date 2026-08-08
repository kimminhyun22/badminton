'use strict';
/**
 * 진행 중 경기 선수 교체 (운영자 결정 2026-08-08).
 *
 *   1) 경기는 교체로 들어간 선수가 뛴 걸로 — 종료 시점 명단으로 셉니다
 *   2) 임원이 처리할 수 있습니다 (inPlayerId 지정 포함)
 *   3) 다른 코트 선수와 맞교환이 됩니다 (두 경기 원자적 교체)
 *
 * 코트에서 4명이 동의하고 바꾸는 일을 시스템이 막으면, 기록만 실제와 어긋납니다.
 * 대진 공정성 엔진의 전제가 "기록된 4명 = 실제 뛴 4명"입니다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {applyOfficialRequest, issueOfficialGrant} = require('../functions/daily-official-engine');

const root = path.join(__dirname, '..');
const daily = fs.readFileSync(path.join(root, 'js', 'daily.js'), 'utf8');
const checkin = fs.readFileSync(path.join(root, 'checkin.html'), 'utf8');

const NOW = 1_830_000_000_000;
const SESSION_ID = 'DREPL01';
const SECRET = 'active-replace-regression-secret-at-least-32-bytes';
const adminGrant = issueOfficialGrant({v:1, sid:SESSION_ID, cid:'admin', iat:NOW-1000, exp:NOW+3600_000}, SECRET);
const officialGrant = issueOfficialGrant({v:1, sid:SESSION_ID, cid:'off', pid:'p9', iat:NOW-1000, exp:NOW+3600_000}, SECRET);

function player(id, name, extra = {}){
  return {id, name, gender:'M', level:4, grade:'C', ageGroup:'40대',
    status:'wait', statusLabel:'wait', locked:false, currentMatchId:'', afterMatchStatus:'',
    games:0, fairExpected:0, mixedGames:0, typeTrackedGames:0, lastPlayedSeq:0,
    partnerCount:{}, opponentCount:{}, partnerCountById:{}, opponentCountById:{},
    joinedAt:NOW, waitFrom:NOW, lastStatusAt:NOW-1000, restPausedMs:0,
    preArrivalVisible:false, registrationCancelled:false,
    isClubOfficial:false, isTemporaryOfficial:false, isGuest:false, ...extra};
}
function activeMatch(id, court, ids){
  return {id, court, seq:court, type:'남복', startedAt:NOW-5*60_000, expectedMinutes:15,
    endAt:NOW+10*60_000, playerIds:[...ids], t1Ids:ids.slice(0,2), t2Ids:ids.slice(2,4),
    t1:['',''], t2:['','']};
}
function makeSession(){
  const players=[];
  for(let i=1;i<=9;i++)players.push(player('p'+i,'선수'+i,{isClubOfficial:i===9}));
  ['p1','p2','p3','p4','p5','p6','p7','p8'].forEach((id,i)=>{
    const p=players.find(x=>x.id===id);
    p.status='playing'; p.statusLabel='playing'; p.locked=true;
    p.currentMatchId=i<4?'m1':'m2';
  });
  const w=player('w1','대기선수');
  players.push(w);
  return {serverSessionId:SESSION_ID, serverRevision:0, commandProtocol:2,
    expiresAt:NOW+48*3600_000, capabilities:{officialOpsServerV2:true},
    players, reservations:[], arrivalCandidates:[],
    serverRuntime:{holds:{}, nextSeq:3, fourCounts:{}, exactCounts:{}},
    event:{courts:2, nextTarget:0, completed:0, finishMode:false, operationStarted:true,
      queuePolicy:{official:0, auto:true},
      active:[activeMatch('m1',1,['p1','p2','p3','p4']), activeMatch('m2',2,['p5','p6','p7','p8'])],
      next:[], expected:[], serverStandby:[]}};
}
function send(session, request, {admin=true}={}){
  return applyOfficialRequest(session, {
    operationId:'op_'+Math.random().toString(36).slice(2,9), commandProtocol:2,
    actorPlayerId:admin?'':'p9', actorPlayerName:admin?'관리자':'임원선수',
    officialGrantToken:admin?adminGrant:officialGrant,
    createdAt:NOW+1000, expiresAt:NOW+30*60_000, ...request
  }, {now:NOW+1000, grantSecret:SECRET, checkinId:SESSION_ID, adminClaim:admin});
}
const base={type:'official-active-replace', matchId:'m1', court:1,
  expectedStartedAt:NOW-5*60_000, expectedPlayerIds:['p1','p2','p3','p4']};

// 1) 대기 선수 투입: 들어온 선수가 마저 뛰고, 종료하면 그 선수가 경기를 가져갑니다.
{
  const r=send(makeSession(), {...base, outPlayerId:'p1', inPlayerId:'w1'});
  assert.strictEqual(r.status,'applied',`교체가 적용되어야 합니다: ${r.reason||''}`);
  const m=r.session.event.active.find(x=>x.id==='m1');
  assert(m.playerIds.includes('w1')&&!m.playerIds.includes('p1'),'명단이 바뀌어야 합니다.');
  assert.strictEqual(m.startedAt,NOW-5*60_000,'타이머(시작 시각)는 그대로여야 합니다.');
  const w=r.session.players.find(p=>p.id==='w1');
  const out=r.session.players.find(p=>p.id==='p1');
  assert.strictEqual(w.status,'playing','들어온 선수는 경기중이어야 합니다.');
  assert.strictEqual(out.status,'rest','나간 선수는 휴식으로 전환됩니다.');
  // 결정 1: 종료하면 끝까지 뛴 사람이 경기를 가져갑니다.
  const done=send(r.session, {type:'official-court-complete', matchId:'m1', court:1,
    expectedStartedAt:NOW-5*60_000, expectedPlayerIds:['w1','p2','p3','p4']});
  assert.strictEqual(done.status,'applied',`교체 후 종료가 되어야 합니다: ${done.reason||''}`);
  assert.strictEqual(done.session.players.find(p=>p.id==='w1').games,1,'교체 투입 선수가 경기 수를 가져갑니다.');
  assert.strictEqual(done.session.players.find(p=>p.id==='p1').games,0,'나간 선수는 경기 수가 오르지 않습니다.');
  console.log('  대기 선수 투입: 명단 교체 · 타이머 유지 · 종료 시 투입 선수 +1');
}

// 2) 맞교환: 두 코트의 명단이 한 번에 바뀝니다.
{
  const r=send(makeSession(), {...base, outPlayerId:'p1', inPlayerId:'p5'});
  assert.strictEqual(r.status,'applied',`맞교환이 적용되어야 합니다: ${r.reason||''}`);
  const m1=r.session.event.active.find(x=>x.id==='m1');
  const m2=r.session.event.active.find(x=>x.id==='m2');
  assert(m1.playerIds.includes('p5')&&!m1.playerIds.includes('p1'),'1코트에 p5 가 들어와야 합니다.');
  assert(m2.playerIds.includes('p1')&&!m2.playerIds.includes('p5'),'2코트에 p1 이 가야 합니다.');
  assert.strictEqual(r.session.players.find(p=>p.id==='p1').currentMatchId,'m2');
  assert.strictEqual(r.session.players.find(p=>p.id==='p5').currentMatchId,'m1');
  assert.strictEqual(r.session.players.find(p=>p.id==='p1').status,'playing','맞교환은 둘 다 계속 경기중입니다.');
  console.log('  코트 간 맞교환: 두 경기 동시 교체 · 둘 다 경기중 유지');
}

// 3) 임원도 지정 교체가 됩니다 (결정 2). queue-replace 의 지정 금지는 그대로입니다.
{
  const r=send(makeSession(), {...base, outPlayerId:'p1', inPlayerId:'w1'}, {admin:false});
  assert.strictEqual(r.status,'applied',`임원 교체가 적용되어야 합니다: ${r.reason||''}`);
  console.log('  임원 지정 교체: applied');
  const q=send(makeSession(), {type:'official-queue-replace', queueId:'q1',
    outPlayerId:'p1', inPlayerId:'w1', expectedPlayerIds:['p1','p2','p3','p4']}, {admin:false});
  assert.strictEqual(q.status,'rejected','대기 경기의 지정 교체는 여전히 관리자 전용입니다.');
  assert(q.reason.includes('관리자'),q.reason);
  console.log('  대기 경기 지정 교체(임원): rejected 유지');
}

// 4) 전제가 깨지면 거절합니다.
[
  [{...base, outPlayerId:'p1', inPlayerId:'p2'}, '같은 경기 선수'],
  [{...base, outPlayerId:'p1', inPlayerId:'p1'}, '같은 선수'],
  [{...base, outPlayerId:'w1', inPlayerId:'p2'}, '경기에 없는 out'],
  [{...base, expectedPlayerIds:['p1','p2','p3','p9'], outPlayerId:'p1', inPlayerId:'w1'}, '지문 불일치']
].forEach(([req,label])=>{
  const r=send(makeSession(), req);
  assert.strictEqual(r.status,'rejected',`${label}은 거절되어야 합니다.`);
  console.log(`  ${label}: rejected (${r.reason})`);
});
{
  const s2=makeSession();
  s2.players.find(p=>p.id==='w1').status='rest';
  const r=send(s2, {...base, outPlayerId:'p1', inPlayerId:'w1'});
  assert.strictEqual(r.status,'rejected','휴식 선수는 참가로 바꾼 뒤 넣어야 합니다.');
  console.log(`  휴식 선수 투입: rejected (${r.reason})`);
}

// 5) 화면 배선 — 관리자·임원 양쪽, 그리고 관리자 원본의 재생·검증 (오늘 밤의 교훈).
assert(daily.includes("type:'official-active-replace'"),'관리자 화면이 교체 명령을 보내야 합니다.');
assert(daily.includes("req.type==='official-active-replace'"),'관리자 원본에 재생·검증 분기가 있어야 합니다.');
assert(daily.includes('function _dailyApplyActiveReplaceLocal'),'재생과 게시 전 경로가 같은 적용 함수를 써야 합니다.');
assert(checkin.includes('sendOfficialActiveReplace'),'임원 화면에 교체 전송이 있어야 합니다.');
assert(checkin.includes('선수 교체'),'임원 화면에 교체 진입점이 있어야 합니다.');
// 맞교환은 두 코트가 함께 바뀌므로 양쪽 화면 모두 경고 확인을 거쳐야 합니다.
['js/daily.js','checkin.html'].forEach(()=>{});
assert(daily.includes('두 경기의 대진이 함께 바뀝니다'),'관리자 맞교환에 경고 확인이 있어야 합니다.');
assert(checkin.includes('두 경기의 대진이 함께 바뀝니다'),'임원 맞교환에 경고 확인이 있어야 합니다.');
assert(/chosen\.swap&&!confirm/.test(daily),'관리자 경고는 맞교환일 때만 떠야 합니다.');
// 같은 이름의 옛 정의가 뒤에 남으면 새 코드를 조용히 덮습니다(2026-08-08 실측).
assert.strictEqual((daily.match(/^(?:async )?function dailyPickActiveReplacement\(/gm)||[]).length,1,
  'dailyPickActiveReplacement 가 두 번 정의되면 뒤의 옛 코드가 이깁니다.');
console.log('  관리자·임원 화면 배선 + 재생 경로 확인');

// 6) 이름 하나만 막으면 다음 중복은 또 통과합니다.
//    실제로 2026-08-08 의 교체 작업이 161줄(함수 6개)을 통째로 복사해 두고 갔고,
//    위의 단일 검사는 그것을 잡지 못했습니다. 파일 전체를 봅니다.
{
  const re=/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm;
  const seen=new Map();
  let hit;
  while((hit=re.exec(daily))!==null)seen.set(hit[1],(seen.get(hit[1])||0)+1);
  const dup=[...seen.entries()].filter(([,n])=>n>1).map(([name,n])=>`${name}(${n}회)`);
  assert.strictEqual(dup.length,0,`js/daily.js 에 중복 정의된 함수가 있습니다 — 뒤의 것이 앞의 것을 덮습니다: ${dup.join(', ')}`);
  console.log(`  js/daily.js 최상위 함수 ${seen.size}개, 중복 정의 없음`);
}

// 7) "원하는 선수로 교환" — 대기 선수든 다른 코트 선수든 목록에서 닿아야 합니다.
//    (운영자 2026-08-09: "원하는 선수로 교환하려다보면 대기선수일 수도 있고
//     다른 코트 선수일 수도 있어 이 두 가지 경우에 대응할 수 있어야 해")
function extractFunction(src, name){
  const start=src.indexOf('function '+name+'(');
  assert(start>=0, `${name} 를 찾지 못했습니다.`);
  let depth=0, started=false;
  for(let i=src.indexOf('{', start); i<src.length; i++){
    if(src[i]==='{'){depth++; started=true;}
    else if(src[i]==='}'){depth--; if(started&&depth===0)return src.slice(start,i+1);}
  }
  throw new Error(`${name} 의 끝을 찾지 못했습니다.`);
}
{
  const candidateSrc=extractFunction(daily,'_dailyActiveReplacementCandidates');
  // 상한을 두면 지목한 선수가 목록 밖으로 밀려납니다.
  assert(!/_dailyActiveReplacementCandidates\([^)]*\)\s*\.slice\(/.test(daily),
    '교체 후보 목록을 잘라내면 안 됩니다 — 운영자가 지목한 선수가 빠질 수 있습니다.');
  // 다음 대진에 예약된 대기 선수는 지우지 말고 뒤로만 미룹니다.
  assert(!/_dailyQueue\.forEach\(q=>_dailyQueueIds\(q\)\.forEach\(id=>blocked\.add\(id\)\)\)/.test(candidateSrc),
    '다음 대진 예약 선수를 후보에서 지우면 그 선수로는 교체할 수 없습니다.');
  assert(/_dailyQueuedPlayerLocation/.test(candidateSrc),
    '예약된 대기 선수는 목록에서 빼지 말고 정렬로만 뒤에 두어야 합니다.');
  assert(daily.includes('대기(다음 대진 예정)'),'관리자 화면이 예약 상태를 표시해야 합니다.');
  assert(checkin.includes('다음 대진 예정'),'임원 화면이 예약 상태를 표시해야 합니다.');
  console.log('  후보 목록: 상한 없음 · 다음 대진 예약 선수도 후보(뒤로 정렬)');
}

// 8) 관리자 화면은 목록이 길어 번호 대신 이름으로도 골라야 합니다.
{
  const load=(src,name)=>new Function(`${extractFunction(src,name)}\nreturn ${name};`)();
  const adminPick=load(daily,'_dailyPickFromCandidates');
  const rows=[{id:'a',name:'김가나'},{id:'b',name:'김나다'},{id:'c',name:'박다라'},{id:'d',name:'김가나'}];
  const cases=[
    ['2','b','번호로 고르기'],
    ['0',null,'0번은 없음'],
    ['5',null,'범위 밖 번호'],
    ['박다라','c','이름 정확히'],
    ['박','c','이름 일부가 한 명일 때'],
    ['김가나',null,'동명이인은 번호로 유도'],
    ['김',null,'여러 명에 걸리면 고르지 않음'],
    [' 박다라 ','c','앞뒤 공백 무시'],
    ['박 다 라','c','가운데 공백 무시'],
    ['',null,'빈 입력'],
    ['홍길동',null,'없는 이름']
  ];
  cases.forEach(([input,expectId,label])=>{
    const got=adminPick(rows,input);
    if(expectId===null){
      assert.strictEqual(typeof got,'string',`관리자: ${label} — 사유를 돌려줘야 합니다 (입력 ${JSON.stringify(input)})`);
      assert(got.length>0,`관리자: ${label} — 사유가 비어 있습니다.`);
    }else{
      assert(got&&got.id===expectId,`관리자: ${label} — ${expectId} 를 골라야 합니다 (입력 ${JSON.stringify(input)}).`);
    }
  });
  assert(daily.includes('번호 또는 이름으로 선택'),'관리자 안내 문구가 이름 입력을 알려야 합니다.');
  console.log(`  관리자 번호·이름 선택 ${cases.length}가지 확인`);
}

// 8b) 임원 화면은 prompt 를 폐지했습니다(운영자 요청 2026-08-09
//     "이름을 누르면 선수교체 창이 뜨고 골라 바꾸는 방식"). 카드의 선수 이름을
//     누르면 그 선수를 빼는 후보 시트가 뜨고, 후보를 눌러 고릅니다.
{
  // 이름 → 시트 배선: 진행 코트 이름이 버튼이고 시트 열기를 부릅니다.
  const lines=extractFunction(checkin,'teamLines');
  assert(/openOfficialActiveReplace\(/.test(lines),'진행 코트 선수 이름이 교체 시트를 열어야 합니다.');
  assert(/event-active-player replaceable/.test(lines),'이름 버튼은 일시정지 대진 교체와 같은 시각 언어여야 합니다.');
  assert(checkin.includes('id="replacePicker"'),'교체 후보 시트가 있어야 합니다.');
  assert(checkin.includes('pickOfficialReplaceCandidate'),'후보를 눌러 고르는 경로가 있어야 합니다.');
  // prompt 로 돌아가면 현장에서 번호를 세게 됩니다.
  ['openOfficialActiveReplace','sendOfficialActiveReplace','pickOfficialReplaceCandidate'].forEach(name=>{
    assert(!/\bprompt\(/.test(extractFunction(checkin,name)),`${name} 이 prompt 를 쓰면 안 됩니다.`);
  });
  // 옛 「선수 교체」 버튼이 남아 있으면 진입점이 둘이 됩니다.
  assert(!checkin.includes('event-official-complete replace'),'옛 선수 교체 버튼은 제거되어야 합니다.');
  // 후보 구분: 대기 선수와 맞교환(다른 코트)이 다르게 표시되어야 합니다.
  const cand=extractFunction(checkin,'officialActiveReplaceCandidates');
  assert(/다음 대진 예정/.test(cand)&&/맞교환/.test(cand),'후보에 예약 상태와 맞교환 표시가 있어야 합니다.');
  console.log('  임원 이름 탭 → 후보 시트: prompt 없음 · 옛 버튼 제거 · 후보 구분 표시');
}

// 9) 서버가 적용한 교체를 관리자 원본이 다시 거절하면 안 됩니다.
//    소스에 분기가 있는지만 보면 부족합니다 — 실제로 호출해 빈 사유가 나와야 합니다.
//    2026-08-09 실측: 이 분기가 검증 함수가 아니라 적용 함수 안에 붙어 있어
//    닿지 않는 죽은 코드였고, 교체는 전부 '지원하지 않는 임원 운영 요청' 이었습니다.
{
  const vm = require('vm');
  const start = daily.indexOf('function _dailyOfficialRequestError');
  const end = daily.indexOf('\nfunction _dailyRecordOfficialArrival');
  assert(start >= 0 && end > start, '_dailyOfficialRequestError 를 잘라내지 못했습니다.');
  const src = daily.slice(start, end);
  const match = {id:'m1', team1:['p1','p2'], team2:['p3','p4'], completedAt:null, cancelledAt:null};
  const run = (req, actor) => {
    const sandbox = {
      _dailyPlayer: id => (actor && String(id) === actor.id) ? actor : null,
      _dailyNow: () => NOW, DAILY_OFFICIAL_OPERATION_TTL_MS: 30*60_000,
      _dailyPaused:false, _dailyFinishMode:false, _dailyFlowOperationType:()=>false,
      _dailyMatches:[match], _dailyQueue:[], console
    };
    vm.createContext(sandbox);
    vm.runInContext(`${src}\nthis.check=_dailyOfficialRequestError;`, sandbox);
    return sandbox.check(req);
  };
  const applied = {type:'official-active-replace', matchId:'m1', court:1,
    outPlayerId:'p1', inPlayerId:'w1', serverAppliedAt:NOW-1000, createdAt:NOW-2000};

  assert.strictEqual(run({...applied, actorPlayerId:''}, null), '',
    '관리자가 보내 서버가 적용한 교체를 관리자 원본이 받아야 합니다.');
  assert.strictEqual(run({...applied, actorPlayerId:'p9'}, {id:'p9', isClubOfficial:true}), '',
    '임원이 보내 서버가 적용한 교체를 관리자 원본이 받아야 합니다.');

  // 게시 전(서버 미적용) 경로의 전제 검사는 그대로 살아 있어야 합니다.
  const local = {type:'official-active-replace', matchId:'m1', court:1, createdAt:NOW,
    actorPlayerId:'p9'};
  const actor = {id:'p9', isClubOfficial:true};
  assert.strictEqual(run({...local, outPlayerId:'p1', inPlayerId:'w1'}, actor), '',
    '전제가 맞으면 통과해야 합니다.');
  assert(run({...local, outPlayerId:'w1', inPlayerId:'w2'}, actor).includes('찾지 못했습니다'),
    '경기에 없는 선수를 빼려 하면 막아야 합니다.');
  assert(run({...local, outPlayerId:'p1', inPlayerId:'p2'}, actor).includes('이미 이 경기'),
    '같은 경기 선수를 넣으려 하면 막아야 합니다.');
  console.log('  관리자 원본 검증: 서버 적용분 수용 · 게시 전 전제 검사 유지');
}

console.log('\ndaily active replace regression ok');
