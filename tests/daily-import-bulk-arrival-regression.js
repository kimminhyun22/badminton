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
  // 배너 닫기(운영자 2026-08-13 "오늘 명단 임원 아니면 자격 복구 필요 없어"):
  // 관리자가 「복구 안 함」으로 접으면 그 이름은 다시 뜨지 않아야 하고,
  // 접은 목록은 저장·복원·초기화가 함께 돌아야 합니다.
  assert(daily.includes('function dailyDismissOfficialRestore')&&daily.includes('복구 안 함'),
    '복구 배너에 닫기 경로가 있어야 합니다 — 계속 떠 있으면 눈에 거슬립니다.');
  assert((daily.match(/_dailyOfficialRestoreCandidates\(\)/g)||[]).length>=3,
    '배너 표시·복구 실행·닫기 모두 접은 이름을 뺀 후보를 써야 합니다.');
  assert(daily.includes('officialRestoreDismissed:_dailyOfficialRestoreDismissed'),'접은 목록이 저장에 실려야 합니다.');
  assert(daily.includes('s.officialRestoreDismissed'),'접은 목록이 복원되어야 합니다.');
  assert((daily.match(/_dailyOfficialRestoreDismissed=\[\];/g)||[]).length>=2,
    '초기화·준비 복원 시 접은 목록을 비워야 합니다.');
  console.log('  임원 자격: 도착 전 등록 → 도착 확인까지 유지 · 굳은 세션 복구 배너 · 복구 안 함 닫기');
}

// 1d) 명부 후보는 클럽 하나를 추정해 싣지 않습니다(2026-08-11 실전: 일만클럽
//     세션에 미르클럽 명부가 실림 — 이름이 겹치는 클럽이 여럿이면 추정이
//     뒤집힘). 모든 클럽을 라벨과 함께 싣고, 오늘 명단과 겹침이 큰 클럽이
//     앞에 오며, 같은 이름은 앞선 클럽 것만 남습니다. 실제 함수를 실행합니다.
{
  const vm=require('vm');
  // 실전 2026-08-11 시나리오: 오늘 미르클럽 회원이 더 많이 참가해 겹침 점수로는
  // 미르가 이깁니다. 하지만 관리자가 최초 선수 등록을 일만클럽 명부에서 했으므로
  // 세션 클럽 기록(_dailySessionClubName)이 일만을 가리키고, 그게 이겨야 합니다.
  const sandbox={
    rosters:{clubs:[
      {name:'미르클럽',members:[{name:'겹침이',grade:'C',gender:'남'},{name:'미르만',grade:'B',gender:'남'},
        {name:'미르둘',grade:'C',gender:'남'},{name:'미르셋',grade:'D',gender:'여'},{name:'미르넷',grade:'C',gender:'남'}]},
      {name:'일만클럽',members:[{name:'겹침이',grade:'A',gender:'남'},{name:'일만만',grade:'C',gender:'여'},{name:'오늘참가',grade:'C',gender:'남'}]}
    ]},
    _dailySessionClubName:'일만클럽',
    _dailyPlayers:[
      {id:'t1',name:'오늘참가',club:'일만클럽',memberId:'m_오늘참가_일만클럽',status:'wait'},
      {id:'t2',name:'늦은이',club:'일만클럽',status:'planned',lastStatusAt:1},
      {id:'t3',name:'미르만',club:'미르클럽',memberId:'m_미르만_미르클럽',status:'wait'},
      {id:'t4',name:'미르둘',club:'미르클럽',memberId:'m_미르둘_미르클럽',status:'wait'},
      {id:'t5',name:'미르셋',club:'미르클럽',memberId:'m_미르셋_미르클럽',status:'wait'}
    ],
    _rsvpMemberId:p=>'m_'+p.name+'_'+(p.club||''),
    _rsvpNameKey:s=>String(s||'').replace(/\s+/g,'').toLowerCase(),
    _dailyGenderLabel:g=>(g==='F'||g==='여')?'여':'남',
    _dailyGender:g=>(g==='여'||g==='F')?'F':'M',
    gradeToLevel:()=>4,
    _dailyHasRosterPlayer:null
  };
  sandbox._dailyHasRosterPlayer=profile=>sandbox._dailyPlayers
    .some(p=>p.name===profile.name&&!['planned','invited'].includes(p.status));
  vm.createContext(sandbox);
  vm.runInContext(`${extractFunction(daily,'_dailyOfficialArrivalRoster')}
${extractFunction(daily,'_dailyOfficialArrivalCandidates')}
this.out=_dailyOfficialArrivalCandidates();`,sandbox);
  const rosterRows=sandbox.out.filter(c=>c.kind==='roster');
  assert(rosterRows.some(c=>c.club==='일만클럽')&&rosterRows.some(c=>c.club==='미르클럽'),
    '모든 클럽의 명부가 라벨과 함께 실려야 합니다.');
  assert.strictEqual(rosterRows[0].club,'일만클럽',
    '미르 회원이 더 많이 참가한 날에도 최초 등록 클럽(일만)이 오늘 클럽이어야 합니다.');
  const dup=rosterRows.filter(c=>c.name==='겹침이');
  assert.strictEqual(dup.length,1,'같은 이름은 한 번만 나와야 합니다.');
  assert.strictEqual(dup[0].club,'일만클럽','겹치는 이름은 앞선 클럽 프로필이어야 합니다.');
  assert.strictEqual(dup[0].grade,'A','앞선 클럽의 급수가 유지되어야 합니다.');
  assert(!rosterRows.some(c=>c.name==='오늘참가'),'이미 참가한 회원은 후보에서 빠져야 합니다.');
  assert(sandbox.out.some(c=>c.kind==='existing'&&c.name==='늦은이'),'도착 전 선수는 후보 맨 앞에 있어야 합니다.');
  // 세션 클럽 기록의 배선: 최초 등록 시 기록 · 저장/복원 · 초기화.
  assert(/if\(!_dailySessionClubName&&club\?\.name\)\{\s*_dailySessionClubName=String\(club\.name\);\s*if\(_dailyCheckinId\)_dailySyncArrivalCandidates\(\);/.test(daily),
    '최초 선수 등록의 명부 클럽을 세션 클럽으로 기록하고, 라이브 중이면 후보를 바로 동기화해야 합니다.');
  assert(daily.includes('sessionClub:_dailySessionClubName'),'세션 클럽이 저장에 실려야 합니다.');
  assert(daily.includes("_dailySessionClubName=String(s.sessionClub||'')"),'세션 클럽이 복원되어야 합니다.');
  assert((daily.match(/_dailySessionClubName='';/g)||[]).length>=2,'초기화·준비 복원 시 세션 클럽을 비워야 합니다.');
  // 기록 없는 라이브 세션의 구제(2026-08-13 실전 "여전히 미르클럽만"): 상황판
  // 알림에서 관리자가 오늘 클럽을 버튼 한 번으로 지정하고, 지정 즉시 후보를
  // 부분 동기화해야 합니다. 추정을 더 쌓는 길은 금지.
  assert(daily.includes('function dailySetSessionClub'),'오늘 클럽 지정 함수가 있어야 합니다.');
  const setClub=extractFunction(daily,'dailySetSessionClub');
  assert(setClub.includes('dailySave()')&&setClub.includes('_dailySyncArrivalCandidates()'),
    '클럽 지정은 저장과 후보 부분 동기화를 함께 해야 합니다 — 동기화가 빠지면 임원 화면이 낡은 클럽을 계속 봅니다.');
  assert(/_dailyCheckinId&&!_dailySessionClubName&&rosterClubs\.length>1/.test(daily),
    '오늘 클럽 확인 알림은 기록 없는 라이브 + 클럽 여럿일 때만 떠야 합니다.');
  console.log('  명부 후보: 최초 등록 클럽 우선(기록) · 전 클럽 수록 · 이름 중복 제거');

  // 1e) 서버 후보 부분 동기화(2026-08-11 실전: 라이브 중에는 관리자 조작이 명령
  //     경로만 돌아 전체 게시가 없고, 후보는 게시에만 실려 낡은 명부가 서버에
  //     남았음 — "휴식 전환해도 미르클럽"). 관리자 화면이 열리면 후보만 부분
  //     쓰기로 맞추고, 내용이 같으면 다시 쓰지 않아야 합니다.
  const writes=[];
  Object.assign(sandbox,{
    _dailyCheckinId:'TESTID',
    _dailyCheckinOwnershipVerified:true,
    _dailyCheckinPath:()=>'live/checkin_TESTID',
    _fbDb:{ref:path=>({set:async value=>{writes.push({path,count:value.length});}})},
    _dailyArrivalCandidatesSyncedHash:'',
    console
  });
  vm.runInContext(`${extractFunction(daily,'_dailyArrivalCandidatesHash')}
async ${extractFunction(daily,'_dailySyncArrivalCandidates')}
this.sync=_dailySyncArrivalCandidates;`,sandbox);
  // 모든 프라미스가 즉시 완료되므로 async IIFE 로 검사합니다 — 안에서 단언이
  // 깨지면 미처리 거부로 테스트가 실패합니다.
  (async()=>{
    const first=await sandbox.sync();
    const second=await sandbox.sync();
    assert.strictEqual(first,true,'후보 동기화가 성공해야 합니다.');
    assert.strictEqual(second,true,'같은 내용의 재동기화도 성공(생략)해야 합니다.');
    assert.strictEqual(writes.length,1,'내용이 같으면 서버에 다시 쓰면 안 됩니다.');
    assert.strictEqual(writes[0].path,'live/checkin_TESTID/session/arrivalCandidates',
      '전체 게시가 아니라 후보 노드만 부분 쓰기해야 합니다 — 통째 쓰기는 8일 밤 사고의 경로입니다.');
    assert(writes[0].count>0,'후보가 실제로 실려야 합니다.');
    console.log('  후보 부분 동기화: 관리자 열림 시 1회 쓰기 · 중복 생략 · 부분 경로');
  })();

  // 배선: 소유 확인 직후와 명단 저장 브리지에서 동기화를 불러야 합니다.
  assert((daily.match(/_dailySyncArrivalCandidates\(\)/g)||[]).length>=2,
    '소유 확인·명단 저장 경로에서 후보 동기화를 불러야 합니다.');
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

// 4) 역순 등록 흐름(운영자 2026-08-11 "전원 현장으로 처리하고 현장에서 도착 전
//    선수만 체킹"): 사전에 전원 현장 참가로 올린 뒤, 게시 전 모달에서 안 온
//    선수만 골라 「도착 전 등록」으로 되돌립니다. 실제 함수를 실행합니다.
{
  const vm=require('vm');
  const calls={cancel:[],removedFromQueue:[],alerts:[]};
  const players=[
    {id:'w1',name:'왔음이',status:'wait',games:0,club:'일만클럽'},
    {id:'w2',name:'대기중이',status:'wait',games:0,club:'일만클럽'},   // 대기표 보유
    {id:'w3',name:'안온이',status:'wait',games:0,club:'일만클럽'},     // 선택 안 함
    {id:'w4',name:'뛴선수',status:'wait',games:3,club:'일만클럽'}      // 되돌리기 불가
  ];
  const checks=[
    {checked:true,value:'0'},{checked:true,value:'1'},
    {checked:false,value:'2'},{checked:true,value:'3'}
  ];
  const sandbox={
    rosters:{clubs:[{name:'일만클럽',members:[
      {name:'왔음이',grade:'C',gender:'남'},{name:'대기중이',grade:'B',gender:'남'},
      {name:'안온이',grade:'C',gender:'여'},{name:'뛴선수',grade:'A',gender:'남'}]}]},
    _dailyImportClubIdx:0,
    _dailyPlayers:players,
    _dailyCheckinId:'',
    _dailySessionClubName:'',
    _dailyNext:{dummy:true},
    document:{querySelectorAll:()=>checks},
    _dailyBlockServerSync:()=>false,
    _dailyCanChangeRoster:()=>true,
    _dailyNormalizeStatus:s=>String(s||''),
    _rsvpMemberId:p=>'m_'+p.name,
    _dailyGenderLabel:g=>g,
    _dailyApplyPlayerStatus:(p,s)=>{p.status=s;},
    _dailyCancelReservationsForPlayer:id=>{calls.cancel.push(id);},
    _dailyIsQueued:id=>id==='w2',
    _dailyTryReplaceQueuedPlayer:()=>false,
    _dailyRemoveQueuedPlayer:id=>{calls.removedFromQueue.push(id);},
    _dailyPruneForeignDormantCarryover:()=>0,
    closeDailyImportModal(){},dailySave(){},dailyRender(){},dailyMaybeAutoAssign(){},
    alert:msg=>{calls.alerts.push(String(msg));}
  };
  vm.createContext(sandbox);
  // extractFunction 은 async 접두를 떨어뜨리므로 다시 붙입니다(테스트 기록 참조).
  vm.runInContext(`async ${extractFunction(daily,'importDailySelected')}
importDailySelected('planned');`,sandbox);
  assert.strictEqual(players[0].status,'planned','선택한 참가 중 선수는 도착 전으로 돌아가야 합니다.');
  assert.strictEqual(players[0].preArrivalVisible,true,'되돌린 선수는 도착 전 명단에 보여야 합니다.');
  assert.strictEqual(players[1].status,'planned','대기표 보유자도 되돌아가야 합니다.');
  assert(calls.removedFromQueue.includes('w2'),'되돌릴 때 대기표를 정리해야 합니다.');
  assert(calls.cancel.includes('w1')&&calls.cancel.includes('w2'),'되돌릴 때 게임신청을 취소해야 합니다.');
  assert.strictEqual(players[2].status,'wait','선택하지 않은 선수는 그대로여야 합니다.');
  assert.strictEqual(players[3].status,'wait','이미 뛴 선수는 되돌리면 안 됩니다.');
  assert.strictEqual(sandbox._dailyNext,null,'되돌리면 대진 미리보기를 무효화해야 합니다.');
  assert(calls.alerts.length===1&&calls.alerts[0].includes('2명을 도착 전으로 되돌렸습니다'),
    `되돌린 인원을 알림으로 보고해야 합니다: ${calls.alerts[0]||'(알림 없음)'}`);
  // 게시 후에는 되돌림 명령이 없으므로 잠겨야 합니다.
  const render=extractFunction(daily,'renderDailyImportMembers');
  assert(/canRevert=p=>!_dailyCheckinId/.test(render),
    '되돌리기는 게시 전에만 열려야 합니다 — 게시 후엔 planned 전환 서버 명령이 없습니다.');
  assert(render.includes('참가 중'),'모달이 참가 중 선수를 표시로 구분해야 합니다.');
  assert(/\(isPre\(p\)\|\|canRevert\(p\)\)/.test(render),
    '명부 밖 참가 중 선수(게스트)도 되돌리기 목록에 떠야 합니다.');
  assert(index.includes('사전에는 전원'),
    'index.html 안내가 역순 흐름(전원 현장 → 안 온 선수만 도착 전)을 설명해야 합니다.');
  // 처음 등록 정리(운영자 2026-08-12 "도착 전 등록 버튼 정리"): 게시 전 +
  // 되돌릴 선수 없음(= 처음 등록)이면 「도착 전」 액션 두 개를 숨겨야 합니다.
  assert(/showPlanned=!!_dailyCheckinId\|\|_dailyPlayers\.some\(canRevert\)/.test(render),
    '「도착 전」 노출 조건은 게시 후 또는 되돌릴 참가 중 선수 존재여야 합니다.');
  assert(render.includes('daily-prearrival-btn')&&render.includes('dailyImportGuestPlannedBtn'),
    '하단 「도착 전 등록」과 게스트 「도착 전으로 추가」 둘 다 같은 규칙으로 숨겨야 합니다.');
  assert(index.includes("if(event.key==='Enter')dailyImportAddGuest('wait')"),
    '게스트 이름 Enter 기본값은 현장 참가여야 합니다 — 역순 흐름의 기본은 현장입니다.');
  // 기존 참가자 재노출 정리(운영자 2026-08-12 "기존 참가자 명부는 다시 보여줄
  // 필요 없는 거 아냐"): 액션 없는 회색 행은 목록에서 빠지고 머리글 숫자만 남습니다.
  assert(!render.includes('이미 참가 등록')&&!/disabledRoster/.test(render),
    '선택해도 할 게 없는 기존 참가자 행은 목록에 그리면 안 됩니다.');
  assert(render.includes('이미 있음'),
    '기존 참가자 수는 머리글 「이미 있음」으로는 남아야 합니다.');
  console.log('  역순 등록: 참가 중→도착 전 되돌리기 · 대기표 정리 · 뛴 선수 보호 · 게시 전 한정');
}

console.log('\ndaily import bulk arrival regression ok');
