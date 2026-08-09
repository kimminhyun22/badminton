'use strict';
/**
 * 다음 대진 수동 편성 (운영자 결정 2026-08-10).
 *
 *   "새 게임 등록은 다음 대진을 수동으로 짠다는 뜻이야. 미리 대진을 짜고
 *    필요 시 대진 순서를 변경할 수 있으면 돼"
 *   "교체선수 선택에 대한 제한을 두지 말고, 게임 진행 중인 선수를 선택했을
 *    경우엔 해당 선수가 게임 종료될 때까지 투입이 되지 않도록"
 *
 * 이 결정에는 함정이 셋 있고, 전부 기계 검사로 고정합니다.
 *   1) 품질 필터가 수동 편성을 조용히 지운다 (실력 차 큰 구성)
 *   2) 대기표 동기화가 목표 수로 잘라내 끝에 붙인 수동 대진을 버린다
 *   3) 경기 중인 선수가 든 대진이 시작되면 한 선수가 두 코트에 선다
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {applyOfficialRequest, issueOfficialGrant} = require('../functions/daily-official-engine');

const root = path.join(__dirname, '..');
const daily = fs.readFileSync(path.join(root, 'js', 'daily.js'), 'utf8');

const NOW = 1_830_000_000_000;
const SESSION_ID = 'DCOMPOSE';
const SECRET = 'queue-compose-regression-secret-at-least-32-bytes!!';
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
function makeSession(){
  const players=[
    player('p1','뛰는일',{status:'playing',currentMatchId:'m1'}),
    player('p2','뛰는이',{status:'playing',currentMatchId:'m1'}),
    player('p3','뛰는삼',{status:'playing',currentMatchId:'m1'}),
    player('p4','뛰는사',{status:'playing',currentMatchId:'m1'}),
    player('w1','상급자',{level:7, grade:'S'}),
    player('w2','초급자',{level:1, grade:'E'}),
    player('w3','대기삼'), player('w4','대기사'), player('w5','대기오',{status:'rest'}),
    player('w6','대기육'), player('w7','대기칠'), player('w8','대기팔'), player('w9','대기구'),
    player('p9','임원선수',{isClubOfficial:true})
  ];
  return {serverSessionId:SESSION_ID, serverRevision:0, commandProtocol:2,
    expiresAt:NOW+48*3600_000, capabilities:{officialOpsServerV2:true},
    players, reservations:[], arrivalCandidates:[],
    serverRuntime:{holds:{}, nextSeq:2, fourCounts:{}, exactCounts:{}},
    event:{courts:2, nextTarget:0, completed:0, finishMode:false, operationStarted:true,
      queuePolicy:{official:0, auto:true},
      active:[{id:'m1', court:1, seq:1, type:'남복', startedAt:NOW-5*60_000, expectedMinutes:15,
        endAt:NOW+10*60_000, playerIds:['p1','p2','p3','p4'], t1Ids:['p1','p2'], t2Ids:['p3','p4'],
        t1:['뛰는일','뛰는이'], t2:['뛰는삼','뛰는사']}],
      next:[], expected:[], serverStandby:[]}};
}
function send(session, request, {admin=false}={}){
  return applyOfficialRequest(session, {
    operationId:'op_'+Math.random().toString(36).slice(2,9), commandProtocol:2,
    actorPlayerId:admin?'':'p9', actorPlayerName:admin?'관리자':'임원선수',
    officialGrantToken:admin?adminGrant:officialGrant,
    createdAt:NOW+1000, expiresAt:NOW+30*60_000, ...request
  }, {now:NOW+1000, grantSecret:SECRET, checkinId:SESSION_ID, adminClaim:admin});
}

// 1) 임원이 실력 차 큰 구성(S+E 같은 편)을 짜도 적용되고 — 지워지지 않습니다.
{
  const r=send(makeSession(), {type:'official-queue-add', queueId:'sq_manual1',
    team1Ids:['w1','w2'], team2Ids:['w3','w4']});
  assert.strictEqual(r.status,'applied',`임원 대진 짜기가 적용되어야 합니다: ${r.reason||''}`);
  const item=r.session.event.next.find(x=>String(x.queueId||x.id)==='sq_manual1');
  assert(item,'대기표 끝에 붙어야 합니다.');
  assert.strictEqual(item.manualComposed,true,'수동 편성 표시가 있어야 합니다.');
  assert.deepStrictEqual(item.t1Ids,['w1','w2'],'A팀 구성이 그대로여야 합니다.');
  // 함정 1: refreshEvent 의 품질 필터가 지우지 않아야 합니다. 두 번째 편성을
  // 보내면 refreshEvent 가 다시 돌므로, 첫 편성이 살아남는지 확인합니다.
  const again=send(r.session, {type:'official-queue-add', queueId:'sq_manual2',
    team1Ids:['w6','w7'], team2Ids:['w8','w9']});
  assert.strictEqual(again.status,'applied',`두 번째 편성이 적용되어야 합니다: ${again.reason||''}`);
  const still=again.session.event.next.find(x=>String(x.queueId||x.id)==='sq_manual1');
  assert(still,'실력 차 큰 수동 편성이 품질 필터에 지워지면 안 됩니다.');
  // 이미 다른 대진에 있는 선수를 다시 편성하면 거기서 빼 옵니다(편성 우선).
  // 중요한 불변식: 어떤 선수도 두 대진에 동시에 서지 않습니다.
  const overlap=send(again.session, {type:'official-queue-add', queueId:'sq_manual3',
    team1Ids:['w1','w6'], team2Ids:['w3','w8']});
  assert.strictEqual(overlap.status,'applied',`겹치는 편성도 빼 와서 적용되어야 합니다: ${overlap.reason||''}`);
  const counts=new Map();
  ['next','expected','serverStandby'].forEach(key=>(overlap.session.event[key]||[]).forEach(item=>{
    (item.playerIds||[]).forEach(id=>counts.set(String(id),(counts.get(String(id))||0)+1));
  }));
  const doubled=[...counts.entries()].filter(([,n])=>n>1).map(([id])=>id);
  assert.strictEqual(doubled.length,0,`선수가 두 대진에 동시에 서면 안 됩니다: ${doubled.join(', ')}`);
  assert(overlap.session.event.next.some(x=>String(x.queueId||x.id)==='sq_manual3'),'새 편성이 남아야 합니다.');
  console.log('  실력 차 큰 수동 편성: applied · 품질 필터 생존 · 이중 배치 없음');
}

// 2) 경기 중인 선수를 넣을 수 있고, 그 대진은 빈 코트를 차지하지 않고 기다립니다.
//    (2026-08-10 시뮬레이션: 빈 코트 cue 를 붙잡으면 선수가 끝나도 그 코트는
//     자동으로 못 채워지고 사람이 눌러야만 삽니다)
{
  const r=send(makeSession(), {type:'official-queue-add', queueId:'sq_wait1',
    team1Ids:['p1','w3'], team2Ids:['w4','w1']});
  assert.strictEqual(r.status,'applied',`경기 중 선수를 넣은 편성이 적용되어야 합니다: ${r.reason||''}`);
  const item=r.session.event.next.find(x=>String(x.queueId||x.id)==='sq_wait1');
  assert(item,'대진이 남아 있어야 합니다.');
  assert(item.playerIds.includes('p1'),'경기 중 선수가 구성에 있어야 합니다.');
  assert.strictEqual(item.cueState,'hold','준비 안 된 편성이 빈 코트 cue 를 받으면 안 됩니다.');
  assert.strictEqual(item.cue,'선수 경기중','기다리는 이유가 딱지로 보여야 합니다.');
  assert(!item.targetCourt,'빈 코트를 차지하면 안 됩니다 — 준비된 대진에게 넘깁니다.');
  // 함정 3: 그래도 억지로 입장을 보내면 거절되어야 합니다(이중 코트 방지).
  const enter=send(r.session, {type:'official-queue-enter-free',
    queueId:'sq_wait1', court:2,
    expectedQueueIndex:1,
    expectedPlayerIds:[...item.playerIds],
    expectedTeam1Ids:[...item.t1Ids], expectedTeam2Ids:[...item.t2Ids],
    expectedCueState:item.cueState||'', expectedTargetCourt:item.targetCourt||null,
    expectedHoldId:item.targetHoldId||''});
  assert.strictEqual(enter.status,'rejected','경기 중 선수가 든 대진은 입장되면 안 됩니다.');
  console.log(`  경기 중 선수 편성: applied · 코트 비점유(hold) · 입장 거절 (${enter.reason})`);

  // 그 선수의 경기가 끝나면 자동 투입 대상이 됩니다 — 전체 흐름이 굳지 않습니다.
  const done=send(r.session, {type:'official-court-complete', token:'t_done1',
    matchId:'m1', court:1,
    expectedStartedAt:r.session.event.active[0].startedAt,
    expectedPlayerIds:[...r.session.event.active[0].playerIds]});
  assert.strictEqual(done.status,'applied',`경기 종료가 되어야 합니다: ${done.reason||''}`);
  const seated=done.session.event.active.find(m=>String(m.id).length&&m.playerIds.includes('p1'));
  const stillQueued=done.session.event.next.find(x=>String(x.queueId||x.id)==='sq_wait1');
  assert(seated||stillQueued,'선수 경기 종료 후 편성이 사라지면 안 됩니다(투입 또는 대기 유지).');
  if(seated)console.log('  선수 경기 종료 → 수동 편성 자동 투입 확인');
  else{
    assert(stillQueued.cueState!=='hold'||stillQueued.cue!=='선수 경기중','선수가 끝났으면 보류가 풀려야 합니다.');
    console.log('  선수 경기 종료 → 보류 해제 확인');
  }
}

// 2b) 실력 차 큰 수동 편성도 입장이 됩니다 — startPreparedItem 의 품질 재검사가
//     이를 막으면 자동·수동 입장이 전부 조용히 실패하고, 그 대진들이 대기표를
//     차지해 코트 전체가 굳습니다(2026-08-10 시뮬레이션: 180분에 11경기).
{
  const r=send(makeSession(), {type:'official-queue-add', queueId:'sq_enter1',
    team1Ids:['w1','w2'], team2Ids:['w3','w4']});   // S+E 같은 편
  assert.strictEqual(r.status,'applied',r.reason||'');
  const item=r.session.event.next.find(x=>String(x.queueId||x.id)==='sq_enter1');
  assert.strictEqual(item.cueState,'free','전원 대기인 수동 편성은 빈 코트 cue 를 받아야 합니다.');
  const enter=send(r.session, {type:'official-queue-enter-free',
    queueId:'sq_enter1', court:item.targetCourt,
    expectedQueueIndex:r.session.event.next.indexOf(item)+1,
    expectedPlayerIds:[...item.playerIds],
    expectedTeam1Ids:[...item.t1Ids], expectedTeam2Ids:[...item.t2Ids],
    expectedCueState:item.cueState, expectedTargetCourt:item.targetCourt,
    expectedHoldId:item.targetHoldId||''});
  assert.strictEqual(enter.status,'applied',`실력 차 큰 수동 편성 입장이 되어야 합니다: ${enter.reason||''}`);
  const match=enter.session.event.active.find(m=>m.playerIds.includes('w1'));
  assert(match&&match.playerIds.includes('w2'),'짠 그대로 코트에 올라가야 합니다.');
  console.log('  실력 차 큰 수동 편성: 입장 applied (품질 재검사 면제)');
}

// 3) 대기 경기 교체도 경기 중인 선수를 지정할 수 있습니다 — 제한 없음.
{
  const s=makeSession();
  const made=send(s, {type:'official-queue-add', queueId:'sq_rep1',
    team1Ids:['w1','w2'], team2Ids:['w3','w4']});
  assert.strictEqual(made.status,'applied',made.reason||'');
  const r=send(made.session, {type:'official-queue-replace', queueId:'sq_rep1',
    outPlayerId:'w3', inPlayerId:'p2', expectedPlayerIds:['w1','w2','w3','w4']});
  assert.strictEqual(r.status,'applied',`경기 중 선수 지정 교체가 적용되어야 합니다: ${r.reason||''}`);
  const item=r.session.event.next.find(x=>String(x.queueId||x.id)==='sq_rep1');
  assert(item.playerIds.includes('p2')&&!item.playerIds.includes('w3'),'지정한 경기 중 선수로 바뀌어야 합니다.');
  assert.strictEqual(item.manualComposed,true,'지정 교체된 대진도 수동 편성 표시를 받아야 합니다.');
  console.log('  대기 교체에 경기 중 선수 지정: applied');
}

// 4) 넣을 수 없는 것: 휴식·중복·마무리 전환.
{
  const rest=send(makeSession(), {type:'official-queue-add', queueId:'sq_bad1',
    team1Ids:['w5','w1'], team2Ids:['w3','w4']});
  assert.strictEqual(rest.status,'rejected','휴식 선수는 거절되어야 합니다 — 정리 필터가 대진을 지워 버립니다.');
  assert(rest.reason.includes('휴식'),rest.reason);
  const dup=send(makeSession(), {type:'official-queue-add', queueId:'sq_bad2',
    team1Ids:['w1','w1'], team2Ids:['w3','w4']});
  assert.strictEqual(dup.status,'rejected','중복 선수는 거절되어야 합니다.');
  const fin=makeSession(); fin.event.finishMode=true;
  const finR=send(fin, {type:'official-queue-add', queueId:'sq_bad3',
    team1Ids:['w1','w2'], team2Ids:['w3','w4']});
  assert.strictEqual(finR.status,'rejected','마무리 전환 후에는 거절되어야 합니다.');
  console.log('  휴식·중복·마무리: rejected');
}

// 5) 관리자 원본의 두 함정을 소스로 고정합니다.
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
  // 함정 2: 동기화가 목표 수로 잘라내면 끝에 붙인 수동 대진이 사라집니다.
  assert(/manualComposed/.test(extractFunction(daily,'_dailyApplyServerQueueSync')),
    '대기표 동기화가 수동 편성을 목표 수 제한 밖에 두어야 합니다.');
  assert(/manualComposed/.test(extractFunction(daily,'_dailyQueueFromServerSyncItem')),
    '동기화 항목이 수동 편성 표시를 옮겨야 합니다.');
  // 보관 판정과 시작 판정의 분리 — 합치면 경기 중 선수가 두 코트에 서거나
  // 보관 정리가 수동 편성을 지웁니다.
  assert(/manualComposed/.test(extractFunction(daily,'_dailyQueueItemValid')),
    '보관 판정이 수동 편성을 균형 검사로 지우면 안 됩니다.');
  assert(daily.includes('function _dailyQueueItemStartable'),'시작 판정이 분리되어 있어야 합니다.');
  assert(/_dailyQueueItemStartable/.test(extractFunction(daily,'dailyStartQueueItem')),
    '시작 경로가 경기 중 선수를 보류해야 합니다.');
  assert(/_dailyQueueItemStartable/.test(extractFunction(daily,'_dailyFirstStartableQueueForCourt')),
    '자동 시작 탐색이 경기 중 선수가 든 대진을 건너뛰어야 합니다.');
  console.log('  관리자 원본: 동기화 잘라내기 면제 · 보관/시작 판정 분리');
}

// 6) 실전 피드백 배선 (2026-08-10 밤): 예약현황 · 순번 안내 · 마무리 버튼.
{
  const checkin=fs.readFileSync(path.join(root,'checkin.html'),'utf8');
  // 편성 시트 위에 현재 대기표가 보여야 합니다 — "현황이 안 보여".
  assert(checkin.includes('replace-picker-current')&&checkin.includes('현재 다음 대진'),
    '편성 시트에 예약현황(현재 다음 대진)이 있어야 합니다.');
  // "몇 번째에 짜지는지" — 확인창·완료 안내가 순번을 말해야 합니다.
  assert(/순위로 추가할까요\?/.test(checkin)&&/순위로 추가 요청/.test(checkin),
    '편성 확인창과 완료 안내가 순번을 알려야 합니다.');
  // 지각 등록 안내 — 우선 편성 규칙을 말해야 합니다.
  assert(checkin.includes('처음 2경기 우선 편성'),
    '지각 등록 후 편성 규칙 안내가 있어야 합니다.');
  // 마무리 전환 — 클럽 임원 버튼과 전송이 있어야 합니다.
  assert(checkin.includes('sendOfficialFinishMode')&&checkin.includes("type:'official-finish-mode'"),
    '임원 마무리 전환 버튼·전송이 있어야 합니다.');
  console.log('  실전 피드백 배선: 예약현황 · 순번 안내 · 지각 안내 · 마무리 버튼');
}

console.log('\ndaily queue compose regression ok');
