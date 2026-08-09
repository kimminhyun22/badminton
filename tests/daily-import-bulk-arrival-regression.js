'use strict';
/**
 * 미리 등록 → 현장 일괄 도착 확인 (운영자 요구 2026-08-09).
 *
 *   "미리 선수등록을 하고 현장에서 확인하려고 해. 도착 전 선수로 등록하고
 *    현장에서 한번에 상태를 현장으로 바꾸고, 일부 인원만 도착 전으로 수정"
 *   "현장 참가 등록과 게스트 등록 함께 하고 싶은데 따로 처리되는 것 같아"
 *
 * 그래서 참가자 모달이 세 가지를 보장해야 합니다.
 *   1) 게스트도 도착 전(planned)으로 등록할 수 있다 — 명부 회원과 같은 흐름
 *   2) 명부 밖 도착 전 선수(게스트)도 모달 목록에 떠서 일괄 도착에 포함된다
 *   3) '도착 전' 필터가 있어 「전체 선택」이 오늘 안 오는 명부 회원을 쓸어 담지 않는다
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {applyOfficialRequest, issueOfficialGrant} = require('../functions/daily-official-engine');

const root = path.join(__dirname, '..');
const daily = fs.readFileSync(path.join(root, 'js', 'daily.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const NOW = 1_830_000_000_000;
const SESSION_ID = 'DIMPORT1';
const SECRET = 'import-bulk-arrival-regression-secret-at-least-32-bytes';
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
  return {serverSessionId:SESSION_ID, serverRevision:0, commandProtocol:2,
    expiresAt:NOW+48*3600_000, capabilities:{officialOpsServerV2:true},
    players:[player('p1','가선수'), player('p9','임원선수',{isClubOfficial:true})],
    reservations:[], arrivalCandidates:[],
    serverRuntime:{holds:{}, nextSeq:1, fourCounts:{}, exactCounts:{}},
    event:{courts:2, nextTarget:0, completed:0, finishMode:false, operationStarted:true,
      queuePolicy:{official:0, auto:true},
      active:[], next:[], expected:[], serverStandby:[]}};
}
function send(session, request, {admin=true}={}){
  return applyOfficialRequest(session, {
    operationId:'op_'+Math.random().toString(36).slice(2,9), commandProtocol:2,
    actorPlayerId:admin?'':'p9', actorPlayerName:admin?'관리자':'임원선수',
    officialGrantToken:admin?adminGrant:officialGrant,
    createdAt:NOW+1000, expiresAt:NOW+30*60_000, ...request
  }, {now:NOW+1000, grantSecret:SECRET, checkinId:SESSION_ID, adminClaim:admin});
}

// 1) 게스트 도착 전 등록 → 현장 일괄 도착 확인의 전체 생애.
{
  const create=send(makeSession(), {type:'official-player-create',
    playerId:'dpv2_guest1', name:'게스트일', grade:'D', gender:'F', level:3,
    ageGroup:'30대', isGuest:true, status:'planned', source:'system-admin-guest-prearrival'});
  assert.strictEqual(create.status,'applied',`게스트 도착 전 등록이 적용되어야 합니다: ${create.reason||''}`);
  const g=create.session.players.find(p=>p.id==='dpv2_guest1');
  assert.strictEqual(g.status,'planned','게스트가 도착 전 상태여야 합니다.');
  assert.strictEqual(g.isGuest,true,'게스트 표시가 유지되어야 합니다.');
  assert.strictEqual(g.preArrivalVisible,true,'도착 전 명단에 보여야 합니다.');
  assert.strictEqual(g.gender,'F','입력한 프로필이 유지되어야 합니다.');

  // 현장 도착: 일괄 「현장 참가 등록」이 기존 도착 전 선수에게 보내는 명령과 같습니다.
  const arrive=send(create.session, {type:'official-player-arrival',
    candidateKey:'player:dpv2_guest1', playerId:'dpv2_guest1', playerName:'게스트일',
    status:'wait', expectedStatus:g.status, expectedLastStatusAt:g.lastStatusAt,
    source:'system-admin-arrival'}, {admin:false});
  assert.strictEqual(arrive.status,'applied',`도착 확인이 적용되어야 합니다: ${arrive.reason||''}`);
  const g2=arrive.session.players.find(p=>p.id==='dpv2_guest1');
  assert.strictEqual(g2.status,'wait','도착 확인 후 참가 대기여야 합니다.');
  assert.strictEqual(g2.isGuest,true,'도착 확인이 게스트 표시를 지우면 안 됩니다.');
  assert.strictEqual(g2.preArrivalVisible,false,'도착 전 명단에서는 빠져야 합니다.');
  console.log('  게스트 생애: 도착 전 등록(관리자) → 도착 확인(임원) → 참가 대기');
}

// 1b) 임원 자격은 도착 전 등록을 거쳐도 살아 있어야 합니다.
//     applyPlayerCreate 가 isClubOfficial 을 false 로 박아 두는 바람에, 도착 전
//     일괄 등록으로 들어간 임원들이 현장에서 본인 이름을 골라도 임원으로 인식되지
//     않았습니다(2026-08-10 실전: 도우미로 강등해 운영). 명령은 관리자 전용이라
//     요청의 임원 표시를 믿습니다.
{
  const create=send(makeSession(), {type:'official-player-create',
    playerId:'dpv2_off1', name:'임원일', grade:'B', gender:'M',
    isClubOfficial:true, status:'planned', source:'system-admin-prearrival'});
  assert.strictEqual(create.status,'applied',`임원 도착 전 등록이 적용되어야 합니다: ${create.reason||''}`);
  const o=create.session.players.find(p=>p.id==='dpv2_off1');
  assert.strictEqual(o.isClubOfficial,true,'도착 전 등록이 임원 자격을 지우면 안 됩니다.');
  const arrive=send(create.session, {type:'official-player-arrival',
    candidateKey:'player:dpv2_off1', playerId:'dpv2_off1', playerName:'임원일',
    status:'wait', expectedStatus:o.status, expectedLastStatusAt:o.lastStatusAt,
    source:'system-admin-arrival'}, {admin:false});
  assert.strictEqual(arrive.status,'applied',arrive.reason||'');
  assert.strictEqual(arrive.session.players.find(p=>p.id==='dpv2_off1').isClubOfficial,true,
    '도착 확인이 임원 자격을 지우면 안 됩니다.');
  // 화면 배선: 도착 전 일괄 등록이 명부의 임원 표시를 실어 보내야 합니다.
  assert(/isClubOfficial:!!m\.isClubOfficial/.test(daily),
    '_dailyRegisterPreArrivalsViaServer 가 임원 표시를 빠뜨리면 안 됩니다.');
  // 이미 굳은 세션의 복구: 명부-세션 대조와 복구 배너가 있어야 합니다.
  // (버그 수리는 새로 만드는 선수부터 적용되고, 지난 세션 데이터는 안 낫습니다)
  assert(daily.includes('function _dailyStrippedOfficials')&&daily.includes('function dailyRestoreOfficialFlags'),
    '임원 자격 풀림을 감지·복구하는 경로가 있어야 합니다.');
  assert(daily.includes('임원 자격 복구'),'상황판에 복구 배너가 있어야 합니다.');
  assert(daily.includes("type:'official-player-official'"),'복구가 자격 명령을 보내야 합니다.');
  console.log('  임원 자격: 도착 전 등록 → 도착 확인까지 유지 · 굳은 세션 복구 배너');
}

// 2) 전제 검사는 그대로여야 합니다.
{
  const dup=send(makeSession(), {type:'official-player-create',
    playerId:'dpv2_dup', name:'가선수', isGuest:true, status:'planned'});
  assert.strictEqual(dup.status,'rejected','같은 이름은 거절되어야 합니다.');
  // 선수 추가도 임원에게 열렸습니다(운영자 2026-08-10 "관리자와 동일한 기능").
  const byOfficial=send(makeSession(), {type:'official-player-create',
    playerId:'dpv2_off', name:'게스트이', isGuest:true, status:'planned'}, {admin:false});
  assert.strictEqual(byOfficial.status,'applied',`임원 게스트 추가가 적용되어야 합니다: ${byOfficial.reason||''}`);
  console.log('  같은 이름 거절 · 임원 추가 applied (2026-08-10 개방)');
}

// 3) 화면 배선 — 게스트 등록과 명부 등록이 한 모달로 합쳐져야 합니다.
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
  // 선수 생성 코어는 한 벌이어야 합니다. 폼과 모달이 각자 만들면 한쪽만 고치게 됩니다.
  const core=extractFunction(daily,'_dailyCreatePlayerDirect');
  assert(/status.*planned/.test(core)&&/isGuest:!!opts\.isGuest/.test(core),
    '생성 코어가 status(planned)와 isGuest 를 서버 명령에 실어야 합니다.');
  assert(extractFunction(daily,'dailyAddPlayer').includes('_dailyCreatePlayerDirect'),
    '「선수 추가」 폼이 공용 코어를 써야 합니다.');
  const guestAdd=extractFunction(daily,'dailyImportAddGuest');
  assert(guestAdd.includes('_dailyCreatePlayerDirect')&&guestAdd.includes('isGuest:true'),
    '모달 게스트 추가가 공용 코어를 게스트로 써야 합니다.');
  assert(guestAdd.includes('renderDailyImportMembers'),
    '게스트 추가 후 모달 목록을 새로 그려야 합니다 — 안 그러면 방금 넣은 게스트가 안 보입니다.');

  // 명부 밖 도착 전 선수가 목록에 떠야 일괄 도착에 포함됩니다.
  const render=extractFunction(daily,'renderDailyImportMembers');
  assert(/rosterNames/.test(render)&&/extras/.test(render),
    '모달 목록에 명부 밖 도착 전 선수(게스트) 행이 있어야 합니다.');
  const sel=extractFunction(daily,'importDailySelected');
  assert(/startsWith\('p:'\)/.test(sel),
    '일괄 등록이 게스트 행(p:<id>)을 처리해야 합니다.');
  assert(/_playerRow/.test(sel),
    '게스트 행은 프로필을 다시 쓰지 말고 상태만 바꿔야 합니다.');

  // '도착 전' 필터: 전체 선택이 화면에 보이는 행만 집으므로 필터가 곧 선택 범위입니다.
  assert(daily.includes('function setDailyImportFilter'),'모달에 도착 전 필터가 있어야 합니다.');
  ['disf-all','disf-planned','dailyImportGuestName','dailyImportGuestGrade',
   'dailyImportGuestGender','dailyImportGuestAge'].forEach(id=>{
    assert(index.includes(id), `index.html 에 ${id} 가 있어야 합니다.`);
  });
  assert(index.includes("dailyImportAddGuest('planned')")&&index.includes("dailyImportAddGuest('wait')"),
    '게스트를 도착 전·현장 참가 양쪽으로 추가할 수 있어야 합니다.');
  assert(extractFunction(daily,'dailyImportRoster').includes("_dailyImportFilter='all'"),
    '모달을 열 때 필터가 전체로 돌아와야 합니다 — 지난 필터가 남으면 명부가 사라진 것처럼 보입니다.');
  // 전체 선택은 목록 머리글에 있어야 합니다. 하단 등록 버튼 줄에 섞여 있으면
  // 헷갈립니다(운영자 피드백 2026-08-09) — 보이는 행만 집으므로 필터 눈높이가 맞습니다.
  assert(/toggleDailySelectAll/.test(extractFunction(daily,'renderDailyImportMembers')),
    '전체 선택/해제가 목록 머리글에 있어야 합니다.');
  assert(!index.includes('toggleDailySelectAll'),
    '하단 액션 줄의 전체 선택은 제거되어야 합니다 — 진입점이 둘이면 다시 헷갈립니다.');
  console.log('  모달 배선: 공용 코어 · 게스트 행 · 도착 전 필터 · 열 때 초기화 · 전체 선택 위치');
}

console.log('\ndaily import bulk arrival regression ok');
