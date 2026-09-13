'use strict';
/**
 * 관리자 없이 임원이 운영을 시작한다 (운영자 2026-09-13 "관리자인 내가 없어도
 * 임원들이 게임 운영을 할 수 있게 하고 싶어. 사실상 관리자의 모든 권한을 위임").
 *
 * 엔진은 2026-08-10 부터 임원에게 전부 열려 있었다(관리자 전용은 임원 자격 부여뿐).
 * 진짜 벽은 둘이었다: ① 세션은 관리자 브라우저만 만든다 ② 「대진 게시」를 켜는 서버
 * 명령이 없어 매치메이커가 영영 대기표를 짜지 않는다(operationStarted===false 가드).
 * ①은 관리자가 미리 게시해 두는 것으로 풀고(전날이라도 됨), ②를 이 명령이 푼다.
 *
 * 함정 하나 더: 관리자 화면은 서버 명령을 하나씩 재생해 따라온다. 재생기가 이 명령을
 * 모르면 다음 게시가 operationStarted:false 를 도로 밀어 올려 임원의 시작을 지운다.
 * 그래서 관리자 쪽 재생 허용 목록·처리 분기까지 함께 못 박는다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {applyOfficialRequest, issueOfficialGrant, refreshEvent} = require('../functions/daily-official-engine');

const NOW = 1_830_000_000_000;
const SESSION_ID = 'DELEG01';
const SECRET = 'delegation-regression-secret-at-least-32-bytes!!';
const H48 = 48 * 60 * 60 * 1000;

const officialGrant = issueOfficialGrant({
  v:1, sid:SESSION_ID, cid:'official-client', pid:'p9', iat:NOW-1000, exp:NOW+60*60*1000
}, SECRET);
const helperGrant = issueOfficialGrant({
  v:1, sid:SESSION_ID, cid:'helper-client', pid:'p8', iat:NOW-1000, exp:NOW+60*60*1000
}, SECRET);

function player(id, name, extra = {}){
  return {
    id, name, gender:'M', level:4, grade:'C', ageGroup:'40대',
    status:'wait', statusLabel:'wait', locked:false, currentMatchId:'', afterMatchStatus:'',
    games:0, fairExpected:0, mixedGames:0, typeTrackedGames:0, lastPlayedSeq:0,
    partnerCount:{}, opponentCount:{}, partnerCountById:{}, opponentCountById:{},
    joinedAt:NOW, waitFrom:NOW, lastStatusAt:NOW-1000, restPausedMs:0,
    preArrivalVisible:false, registrationCancelled:false,
    isClubOfficial:false, isTemporaryOfficial:false, isGuest:false,
    ...extra
  };
}
// 관리자가 전날 미리 게시해 둔 세션 — 게시 표시는 꺼져 있고, 만료는 12시간 남았다.
function prepSession(overrides){
  const session = {
    serverSessionId:SESSION_ID, serverRevision:0, commandProtocol:2,
    expiresAt:NOW+12*60*60*1000,
    matchStartedAt:0,
    officialInvite:{tokenHash:'deadbeef', expiresAt:NOW+12*60*60*1000, maxClaims:8},
    capabilities:{officialOpsServerV2:true, officialOperationStartV1:true},
    players:[
      player('p1','가선수'), player('p2','나선수'), player('p3','다선수'), player('p4','라선수'),
      player('p5','마선수'), player('p6','바선수'), player('p7','사선수'),
      player('p8','도우미',{isTemporaryOfficial:true}),
      player('p9','임원선수',{isClubOfficial:true})
    ],
    reservations:[], arrivalCandidates:[],
    serverRuntime:{holds:{}, nextSeq:1, fourCounts:{}, exactCounts:{}},
    event:{
      courts:2, nextTarget:2, completed:0, finishMode:false, operationStarted:false,
      queuePolicy:{official:2, auto:true},
      active:[], next:[], expected:[], serverStandby:[]
    }
  };
  return Object.assign(session, overrides || {});
}
function send(session, request, {grant = officialGrant, actor = 'p9', name = '임원선수'} = {}){
  return applyOfficialRequest(session, {
    operationId:'op_'+Math.random().toString(36).slice(2,9),
    commandProtocol:2,
    actorPlayerId:actor, actorPlayerName:name,
    officialGrantToken:grant,
    createdAt:NOW+1000, expiresAt:NOW+30*60*1000,
    ...request
  }, {now:NOW+1000, grantSecret:SECRET, checkinId:SESSION_ID, adminClaim:false});
}

// 1) 게시 전 세션에서는 대기표가 짜이지 않는다 — 이게 「관리자를 기다리는」 상태였다.
{
  const s = prepSession();
  const {replenishPrepared} = require('../functions/daily-server-matchmaker');
  replenishPrepared(s, {now:NOW, requestId:'before'});
  refreshEvent(s, NOW);
  assert.strictEqual((s.event.next || []).length, 0, '게시 전에는 매치메이커가 대기표를 짜면 안 됩니다.');
  console.log('  게시 전: 대기표 0 (관리자를 기다리던 상태)');
}

// 2) 임원이 「대진 게시」를 누르면 — 표시가 켜지고, 대기표가 바로 짜이고, 만료가 늘어난다.
{
  const r = send(prepSession(), {type:'official-operation-start'});
  assert.strictEqual(r.status, 'applied', `임원의 대진 게시가 적용돼야 합니다: ${r.reason || ''}`);
  const s = r.session;
  assert.strictEqual(s.event.operationStarted, true, '게시 표시가 켜져야 합니다.');
  assert.strictEqual(s.event.operationStartedAt, NOW+1000, '게시 시각이 명령 시각이어야 합니다.');
  assert(s.event.next.length >= 1, `게시 직후 대기표가 짜여야 합니다(현재 ${s.event.next.length}).`);
  assert(s.expiresAt >= NOW+1000+H48-1, '세션 만료가 게시 시각부터 48시간으로 늘어야 합니다.');
  assert(s.officialInvite.expiresAt >= NOW+1000+H48-1, '초대 만료도 함께 늘어야 임원 링크가 도중에 끊기지 않습니다.');
  assert.strictEqual(s.officialInvite.tokenHash, 'deadbeef', '초대 토큰은 바뀌면 안 됩니다.');
  assert(r.result?.operationStart && r.result.queueSync,
    '관리자 재생용 결과(operationStart·queueSync)가 실려야 합니다.');
  assert.strictEqual(r.result.operationStart.generated, s.event.next.length, '생성 수가 대기표와 맞아야 합니다.');
  console.log(`  임원 대진 게시: applied · 대기표 ${s.event.next.length} · 만료 +48h`);

  // 두 번 누르면 거절 — 되돌릴 수 없는 동작이라 멱등이 아니라 명시 거절이다.
  const again = send(s, {type:'official-operation-start'});
  assert.strictEqual(again.status, 'rejected', '이미 게시된 세션은 다시 게시하면 안 됩니다.');
  console.log(`  두 번째 게시: rejected (${again.reason})`);
}

// 3) 만료가 아직 넉넉하면 줄이지 않는다.
{
  const s = prepSession({expiresAt:NOW+5*H48, officialInvite:{tokenHash:'x', expiresAt:NOW+5*H48, maxClaims:8}});
  const r = send(s, {type:'official-operation-start'});
  assert.strictEqual(r.status, 'applied');
  assert.strictEqual(r.session.expiresAt, NOW+5*H48, '더 긴 만료는 줄이면 안 됩니다.');
  console.log('  넉넉한 만료: 그대로');
}

// 4) 진행 중 코트 등록 → 게시: 관리자 전환 모달과 같은 명령(transition:true)이 임원에게도 통한다.
{
  let s = prepSession();
  const reg = send(s, {type:'official-manual-match', court:1, matchId:'sm_court1',
    team1Ids:['p1','p2'], team2Ids:['p3','p4'], transition:true, reservationLabel:'계속 경기'});
  assert.strictEqual(reg.status, 'applied', `게시 전 코트 등록이 적용돼야 합니다: ${reg.reason || ''}`);
  s = reg.session;
  assert.strictEqual(s.event.active.length, 1, '1코트에 진행 중 경기가 올라야 합니다.');
  assert(['p1','p2','p3','p4'].every(id=>s.players.find(p=>p.id===id).status==='playing'), '등록된 4명은 경기중이어야 합니다.');
  const start = send(s, {type:'official-operation-start'});
  assert.strictEqual(start.status, 'applied', `코트 등록 뒤 게시가 적용돼야 합니다: ${start.reason || ''}`);
  s = start.session;
  const queuedIds = new Set(s.event.next.flatMap(q=>q.playerIds || [...(q.t1Ids||[]), ...(q.t2Ids||[])]));
  assert(['p1','p2','p3','p4'].every(id=>!queuedIds.has(id)), '경기 중인 4명이 첫 대기표에 겹치면 안 됩니다.');
  assert(s.event.active.length === 1 && s.event.next.length >= 1, '진행 중 1경기 + 대기표가 함께 있어야 합니다.');
  console.log(`  코트 등록 → 게시: 진행 중 1 · 대기표 ${s.event.next.length} · 겹침 없음`);
}

// 5) 마무리 중엔 게시 불가(이미 시작된 세션이다).
{
  const s = prepSession({event:{courts:2, nextTarget:2, completed:0, finishMode:true, operationStarted:false,
    queuePolicy:{official:2, auto:true}, active:[], next:[], expected:[], serverStandby:[]}});
  const r = send(s, {type:'official-operation-start'});
  assert.strictEqual(r.status, 'rejected', '마무리 중에는 게시가 거절돼야 합니다.');
  console.log(`  마무리 중 게시: rejected (${r.reason})`);
}

// 6) 운영 도우미(임시 임원)도 서버에서는 허용 — 화면은 클럽 임원만 버튼을 보여 준다(마무리와 같은 경계).
{
  const r = send(prepSession(), {type:'official-operation-start'}, {grant:helperGrant, actor:'p8', name:'도우미'});
  assert.strictEqual(r.status, 'applied', `운영 도우미의 게시도 서버는 받아야 합니다: ${r.reason || ''}`);
  console.log('  운영 도우미: 서버는 허용(화면 게이트는 클럽 임원)');
}

// ── 관리자 화면이 따라오는지 (정적 핀) ──
const daily = fs.readFileSync(path.join(__dirname, '..', 'js', 'daily.js'), 'utf8');
assert(daily.includes('officialOperationStartV1:!!_dailyOfficialInviteHash'),
  '게시 페이로드가 능력 표시(officialOperationStartV1)를 실어야 임원 화면에 버튼이 뜹니다.');
assert(/\[\s*'official-settings-update'[\s\S]{0,600}'official-operation-start'[\s\S]{0,300}\]\.includes\(req\.type\)/.test(daily),
  '관리자 재생 허용 목록에 official-operation-start 가 있어야 합니다 — 없으면 서버는 통과시킨 명령을 관리자 화면이 거절합니다.');
assert(daily.includes("if(req.type==='official-operation-start'){") && daily.includes('const info=result.operationStart;')
  && /result\.operationStart;[\s\S]{0,200}_dailyMarkOperationStarted\(Number\(info\.at\|\|at\)\)/.test(daily),
  '관리자 재생기가 임원의 게시를 게시 시각 그대로 받아들여야 합니다.');
assert(daily.includes('_dailyMarkOperationStarted(Number(remote.event.operationStartedAt)||undefined)'),
  '서버 상태 채택도 게시 시각을 그대로 받아야 합니다.');

// ── 임원 화면 (정적 핀) ──
const checkin = fs.readFileSync(path.join(__dirname, '..', 'checkin.html'), 'utf8');
assert(checkin.includes('function officialPrepPanelHtml(player)') && checkin.includes('${officialPrepPanelHtml(p)}'),
  '임원 화면에 「운영 준비」 패널이 있어야 합니다.');
assert(/officialPrepPanelHtml[\s\S]{0,400}officialOperationStartV1!==true\)return ''/.test(checkin),
  '준비 패널은 세션이 능력 표시를 실었을 때만 떠야 합니다(구버전 게시 세션에서는 숨김).');
assert(/officialPrepPanelHtml[\s\S]{0,600}operationStarted!==false\)return ''/.test(checkin),
  '준비 패널은 게시 전에만 떠야 합니다.');
assert(checkin.includes('async function sendOfficialOperationStart(actorId)') && checkin.includes("type:'official-operation-start'"),
  '「대진 게시」 전송이 있어야 합니다.');
assert(/sendOfficialOperationStart[\s\S]{0,300}isClubOfficial\)return toast/.test(checkin),
  '대진 게시 버튼은 클럽 임원 게이트를 지나야 합니다.');
assert(checkin.includes('function openOfficialCourtCompose(actorId,court)') && checkin.includes('async function _officialCourtComposeSubmit()'),
  '진행 중 코트 등록 시트가 있어야 합니다.');
assert(/_officialCourtComposeSubmit[\s\S]{0,900}type:'official-manual-match'[\s\S]{0,300}transition:true/.test(checkin),
  '코트 등록은 관리자 전환 모달과 같은 명령(official-manual-match, transition:true)이어야 합니다.');
assert(checkin.includes("rosterToolsOn&&session?.event?.operationStarted!==false?`<button type=\"button\" class=\"official-overview-tool ${session?.event?.finishMode?'active':''}\""),
  '게시 전에는 「마무리」 도구가 뜨면 안 됩니다.');

assert(!/_officialCourtComposeSubmit[\s\S]{0,1200}type:'자율'/.test(checkin),
  "코트 등록 요청에 경기 종목을 type 으로 넣으면 명령 종류 type 을 덮어써 「지원하지 않는 요청」이 됩니다(2026-09-13 실측).");

// 관리자 재생기는 서버 사실을 따를 뿐, 전환 등록(게시 전 코트 등록)에서 시작을 추론하면 안 된다.
// 2026-09-13 실배포 실측: 관리자 탭이 열려 있으면 임원이 코트만 올려도 관리자가 대신 게시해
// 대기표 0개인 채로 started 가 됐고, 임원의 「대진 게시」는 「이미 게시됨」으로 거절됐다.
assert(daily.includes('if(!match.transitionStarted)_dailyMarkOperationStarted();'),
  '전환 등록 재생은 게시 표시를 켜면 안 됩니다 — 시작은 대진 게시 명령이 정합니다.');
assert(!/_dailyMarkFourCacheDirty\(\);\n\s*_dailyMarkOperationStarted\(\);\n\s*_dailyNext=null;/.test(daily),
  '수동 경기 재생에서 무조건 시작 표시를 켜는 옛 줄이 되살아나면 안 됩니다.');

// 관리자 운영 명령은 세 목록을 다 지나야 한다 — ① 허용 검사(_dailyOfficialRequestError)
// ② 라우팅(dailyProcessCheckinRequests 의 인라인 배열) ③ 처리(_dailyApplyAdminOperation).
// 2026-09-13 실배포 실측: ①③만 고치면 ②에서 흘려보내 리비전이 멈추고
// 「서버 운영 기록 일부를 관리자 원본에 연결하지 못했습니다」가 떴다.
{
  const routing = daily.match(/\[\s*'official-player-remove'[\s\S]{0,700}?\]\.includes\(req\.type\)\)\{\s*const ok=_dailyApplyAdminOperation\(req\);/);
  assert(routing, '관리자 운영 명령 라우팅 배열을 찾을 수 있어야 합니다.');
  assert(routing[0].includes("'official-operation-start'"),
    '라우팅 배열에 official-operation-start 가 없으면 관리자 화면이 임원의 게시를 흘려보냅니다.');
}

// ── 새 운동일 시작(rollover): 관리자가 매주 게시하지 않아도 같은 링크로 굴린다 ──
const D9 = 9 * 24 * 60 * 60 * 1000, H4 = 4 * 60 * 60 * 1000;
function playedSession(){
  // 어제 운동을 마친 세션: 게시 6시간 전, 완료 3경기, 임원은 「종료」로 퇴장, 도우미 1명, 진행 중 코트 없음
  const s = prepSession({expiresAt:NOW+30*60*60*1000, officialInvite:{tokenHash:'deadbeef', expiresAt:NOW+30*60*60*1000, maxClaims:8}});
  s.event.operationStarted = true; s.event.operationStartedAt = NOW - 6*60*60*1000; s.event.completed = 3;
  s.completedLog = [{seq:1,court:1,type:'남복',t1:['가선수','나선수'],t2:['다선수','라선수'],startAt:NOW-5*3600e3,endAt:NOW-5*3600e3+15*60e3}];
  s.players.forEach(p=>{ p.games = 2; p.partnerCountById = {x:1}; p.status = 'done'; p.statusLabel = 'done'; });
  s.players.find(p=>p.id==='p8').isTemporaryOfficial = true;
  s.serverRuntime.nextSeq = 9;
  return s;
}
// 1) 「종료」로 남은 클럽 임원이 롤오버를 보낼 수 있다(상태 게이트 예외) — 리셋·보관·연장 확인
{
  const r = send(playedSession(), {type:'official-session-rollover'});
  assert.strictEqual(r.status, 'applied', `종료 상태 임원의 새 운동일 시작이 적용돼야 합니다: ${r.reason || ''}`);
  const s = r.session;
  assert.strictEqual(s.event.operationStarted, false, '게시 표시가 꺼져야 다음 「대진 게시」를 받을 수 있습니다.');
  assert.strictEqual(s.event.completed, 0); assert.deepStrictEqual(s.event.active, []); assert.deepStrictEqual(s.event.next, []);
  assert.strictEqual(s.completedLog.length, 0, '완료 기록은 비워야 합니다(보관함으로).');
  assert.strictEqual(s.archive.length, 1, '지난 운동이 보관함에 한 건 남아야 합니다.');
  assert.strictEqual(s.archive[0].completed, 3); assert.strictEqual(s.archive[0].completedLog.length, 1);
  const me = s.players.find(p=>p.id==='p9'), other = s.players.find(p=>p.id==='p1'), helper = s.players.find(p=>p.id==='p8');
  assert.strictEqual(me.status, 'wait', '누른 임원은 현장 참가로 남아야 합니다(도착 전이면 자기 도착 처리도 못 보냅니다).');
  assert.strictEqual(other.status, 'planned', '나머지는 도착 전으로 돌아가야 합니다.');
  assert.strictEqual(other.games, 0); assert.deepStrictEqual(other.partnerCountById, {});
  assert.strictEqual(helper.isTemporaryOfficial, false, '운영 도우미는 그날만입니다.');
  assert.strictEqual(s.serverRuntime.nextSeq, 1, '경기 번호는 1부터 다시.');
  assert(s.expiresAt >= NOW+1000+D9-1 && s.officialInvite.expiresAt >= NOW+1000+D9-1, '세션·초대 만료가 9일로 늘어야 다음 주 임원이 클레임할 수 있습니다.');
  assert.strictEqual(s.officialInvite.tokenHash, 'deadbeef', '초대 토큰은 불변입니다.');
  assert.strictEqual(s.rolloverAt, NOW+1000); assert.strictEqual(s.rolloverCount, 1);
  assert(r.result?.sessionRollover && r.result.queueSync, '관리자 채택용 결과가 실려야 합니다.');
  console.log(`  새 운동일 시작: applied · 보관 ${s.archive.length} · 임원 wait · 나머지 planned · 만료 +9d`);

  // 롤오버 뒤 흐름이 이어진다: 임원이 다른 선수를 도착 처리 → 4명 이상이면 대진 게시 → 대기표
  let t = s;
  for(const id of ['p1','p2','p3','p4','p5','p6','p7']){
    const before = t.players.find(p=>p.id===id);
    const a = send(t, {type:'official-player-arrival', playerId:id, expectedStatus:before.status, expectedLastStatusAt:before.lastStatusAt});
    assert.strictEqual(a.status, 'applied', `롤오버 뒤 도착 처리가 돼야 합니다(${id}): ${a.reason || ''}`);
    t = a.session;
  }
  const waiting = t.players.filter(p=>p.status==='wait').length;
  assert.strictEqual(waiting, 8, '임원 1 + 도착 7 = 대기 8명이어야 합니다.');
  const st = send(t, {type:'official-operation-start'});
  assert.strictEqual(st.status, 'applied', `롤오버 뒤 대진 게시가 다시 돼야 합니다: ${st.reason || ''}`);
  assert(st.session.event.next.length >= 1, '대기 8명이면 게시 직후 대기표가 최소 1개 짜여야 합니다.');
  console.log(`  롤오버 → 도착 처리(대기 ${waiting}) → 대진 게시: applied · 대기표 ${st.session.event.next.length}`);
}
// 2) 거절 조건: 게시 전 / 4시간 안 됨 / 진행 중 코트 / 운영 도우미
{
  const pre = send(prepSession(), {type:'official-session-rollover'});
  assert.strictEqual(pre.status, 'rejected', '게시 전 세션은 굴릴 게 없습니다.');
  const young = playedSession(); young.event.operationStartedAt = NOW - 1*60*60*1000;
  assert.strictEqual(send(young, {type:'official-session-rollover'}).status, 'rejected', '게시 4시간 안에는 거절.');
  const busy = playedSession(); busy.event.active = [{id:'m1',court:1,startedAt:NOW-5*60e3,playerIds:['p1','p2','p3','p4'],t1Ids:['p1','p2'],t2Ids:['p3','p4']}];
  assert.strictEqual(send(busy, {type:'official-session-rollover'}).status, 'rejected', '진행 중 코트가 있으면 거절.');
  const helperTry = send(playedSession(), {type:'official-session-rollover'}, {grant:helperGrant, actor:'p8', name:'도우미'});
  assert.strictEqual(helperTry.status, 'rejected', '운영 도우미는 새 운동일을 시작할 수 없습니다.');
  console.log('  거절: 게시 전 · 4시간 미만 · 진행 중 코트 · 운영 도우미');
}
// 3) 보관함 상한
{
  const s = playedSession(); s.archive = [1,2,3,4].map(i=>({at:i}));
  const r = send(s, {type:'official-session-rollover'});
  assert.strictEqual(r.session.archive.length, 4, '보관함은 최근 4개만 둡니다(세션 노드 크기).');
}
// 4) 대진 게시도 같은 9일 창을 쓴다 — 48시간이면 다음 주에 세션이 만료돼 클레임이 안 된다
{
  const r = send(prepSession(), {type:'official-operation-start'});
  assert(r.session.expiresAt >= NOW+1000+D9-1, '대진 게시의 만료 연장도 9일이어야 합니다.');
}
// ── 관리자 화면 (정적 핀) ──
assert(daily.includes('officialSessionRolloverV1:!!_dailyOfficialInviteHash'), '게시 페이로드에 롤오버 능력 표시가 있어야 합니다.');
assert(/\[\s*'official-settings-update'[\s\S]{0,700}'official-session-rollover'[\s\S]{0,300}\]\.includes\(req\.type\)/.test(daily), '허용 목록에 롤오버가 있어야 합니다.');
{
  const routing = daily.match(/\[\s*'official-player-remove'[\s\S]{0,800}?\]\.includes\(req\.type\)\)\{\s*const ok=_dailyApplyAdminOperation\(req\);/);
  assert(routing && routing[0].includes("'official-session-rollover'"), '라우팅 배열에 롤오버가 있어야 합니다.');
}
assert(daily.includes("if(req.type==='official-session-rollover'){") && daily.includes('_dailyRolloverAt>=Number(result.sessionRollover.at)'),
  '재생기는 롤오버 상태를 손대지 않고 채택 여부만 확인해야 합니다.');
assert(daily.includes("if(trusted.some(req=>req.type==='official-session-rollover')&&await _dailyMaybeAdoptRollover())return true;"),
  '동기화 pull 은 롤오버 명령을 재생하지 않고 채택으로 처리해야 합니다 — 재생 뒤 게시가 서버 리셋을 덮어씁니다.');
assert((daily.match(/if\(await _dailyMaybeAdoptRollover\(\)\)return true;/g) || []).length === 2,
  '명령 기록이 없어 막히는 두 갈래 모두 채택을 먼저 시도해야 합니다(관리자가 며칠 만에 켜는 경우).');
assert(daily.includes("path+'/session/rolloverAt').on('value'"), '관리자 화면은 rolloverAt 을 따로 들어야 합니다.');
assert(daily.includes("else if(rollover){ _dailyOperationStarted=false;"), '롤오버 채택은 게시 표시를 꺼야 합니다(기존 채택은 true 만 반영).');
assert(daily.includes("const done=rollover?[]:_dailyMatches.filter"), '롤오버 채택은 지난 경기를 오늘 기록으로 남기면 안 됩니다.');
assert(daily.includes('function _dailyArchiveLocalDay(at)') && daily.includes("'daily_day_archive_v1'"), '지난 운동의 로컬 기록은 일자 보관함으로 가야 합니다.');
assert(daily.includes('rolloverAt:_dailyRolloverAt,') && daily.includes('_dailyRolloverAt=Math.max(0,Number(s.rolloverAt||0));'), 'rolloverAt 은 저장·복원돼야 합니다.');
// ── 엔진 (정적 핀) ──
const engine = fs.readFileSync(path.join(__dirname, '..', 'functions', 'daily-official-engine.js'), 'utf8');
assert(engine.includes('const STANDING_SESSION_WINDOW_MS = 9 * 24 * 60 * 60 * 1000;') && !engine.includes('OPERATION_START_SESSION_TTL_MS'),
  '시작과 롤오버는 같은 9일 창을 써야 합니다.');
assert(/rolloverCommand && !adminClaim && !actor\?\.isClubOfficial/.test(engine) && /!rolloverCommand && !adminClaim && \['invited','planned','done'\]/.test(engine),
  '상태 게이트는 롤오버만 비켜 가고, 롤오버는 클럽 임원만 보내야 합니다.');
// ── 임원 화면 (정적 핀) ──
assert(checkin.includes('function officialRolloverCardHtml(player)') && checkin.includes('${officialRolloverCardHtml(p)}'), '새 운동일 시작 카드가 있어야 합니다.');
assert(/officialRolloverCardHtml[\s\S]{0,500}officialSessionRolloverV1!==true\)return ''/.test(checkin), '카드는 능력 표시가 있을 때만.');
assert(checkin.includes("async function sendOfficialSessionRollover(actorId)") && checkin.includes("type:'official-session-rollover'"), '롤오버 전송이 있어야 합니다.');
assert(/sendOfficialSessionRollover[\s\S]{0,300}\(session\?\.players\|\|\[\]\)\.find/.test(checkin), '롤오버 전송은 상태 게이트 없이 명단에서 임원을 찾아야 합니다(종료 상태 임원도 눌러야 함).');

// 지난주 「종료」로 남은 클럽 임원도 정체된 세션(게시 뒤 4시간·진행 코트 없음)에서는 운영자로 인식돼야
// 카드가 그려지고 클레임·전송이 통과한다. 다른 명령은 서버 상태 게이트가 막으므로 안전하다.
assert(checkin.includes('function sessionRolloverEligible()') && /isLiveOperatorPlayer[\s\S]{0,400}sessionRolloverEligible\(\)/.test(checkin),
  '정체된 세션에서는 종료 상태 클럽 임원도 운영자로 인식돼야 새 운동일을 시작할 수 있습니다.');

console.log('daily official delegation regression ok');
