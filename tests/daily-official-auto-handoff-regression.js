'use strict';

const assert=require('assert');
const {
  AUTO_HANDOFF_WINDOW_MS,
  canonicalJson,
  issueOfficialGrant
}=require('../functions/daily-official-engine');
const {applyCommandTransaction}=require('../functions/daily-official-command');
const crypto=require('crypto');

const NOW=1_800_000_000_000;
const CHECKIN_ID='DAUTO222';
const CLIENT_ID='oc_auto_handoff_1234567890';
const SECRET='auto-handoff-test-secret-at-least-32-bytes';
const GRANT=issueOfficialGrant({v:1,sid:CHECKIN_ID,cid:CLIENT_ID,pid:'official',iat:NOW-1000,exp:NOW+60*60_000},SECRET);

function hash(value){return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');}
function player(id,status='wait',official=false){
  return {
    id,name:id.toUpperCase(),status,statusLabel:status,locked:status==='playing',currentMatchId:'',afterMatchStatus:'',
    games:0,typeTrackedGames:0,mixedGames:0,lastPlayedSeq:0,partnerCount:{},opponentCount:{},
    lastStatusAt:NOW-1000,waitFrom:NOW-60_000,isClubOfficial:official
  };
}
function active(id,court,ids,startedAt){
  return {id,court,seq:court,type:'남복',teamMode:false,startedAt,expectedMinutes:15,endAt:startedAt+15*60_000,t1Ids:ids.slice(0,2),t2Ids:ids.slice(2),playerIds:ids,t1:ids.slice(0,2).map(v=>v.toUpperCase()),t2:ids.slice(2).map(v=>v.toUpperCase())};
}
function queue(id,ids){
  return {id,queueId:id,type:'남복',teamMode:false,t1Ids:ids.slice(0,2),t2Ids:ids.slice(2),playerIds:ids,t1:ids.slice(0,2).map(v=>v.toUpperCase()),t2:ids.slice(2).map(v=>v.toUpperCase())};
}
function root(){
  const players=[player('official','wait',true)];
  for(let i=1;i<=16;i++)players.push(player(`p${i}`,i<=8?'playing':'wait'));
  players.push(player('spare'));
  for(let i=1;i<=4;i++)players[i].currentMatchId='m1';
  for(let i=5;i<=8;i++)players[i].currentMatchId='m2';
  return {
    session:{
      serverSessionId:CHECKIN_ID,commandProtocol:2,serverRevision:0,expiresAt:NOW+48*60*60_000,
      officialInvite:{tokenHash:'f'.repeat(64),expiresAt:NOW+48*60*60_000},
      capabilities:{officialOpsServerV2:true,officialAutoHandoffV1:true},
      players,reservations:[],arrivalCandidates:[],serverRuntime:{holds:{},nextSeq:3},
      event:{courts:2,nextTarget:2,serverExpectedGoal:0,completed:0,queuePolicy:{official:2},active:[
        active('m1',1,['p1','p2','p3','p4'],NOW-14*60_000),
        active('m2',2,['p5','p6','p7','p8'],NOW-10*60_000)
      ],next:[queue('q1',['p9','p10','p11','p12']),queue('q2',['p13','p14','p15','p16'])],expected:[],serverStandby:[]}
    },
    officialClaims:{[CLIENT_ID]:{clientId:CLIENT_ID,expiresAt:NOW+60*60_000,claimMode:'roster',officialPlayerId:'official'}}
  };
}
function submit(current,command,now){
  const stored={actorPlayerId:'official',actorPlayerName:'운영임원',createdAt:now,expiresAt:now+30*60_000,source:'club-official-support',...command};
  return applyCommandTransaction(current,{
    storedCommand:stored,engineCommand:{...stored,officialGrantToken:GRANT},operationId:stored.operationId,
    payloadHash:hash(stored),clientId:CLIENT_ID,grantPlayerId:'official',now,checkinId:CHECKIN_ID,grantSecret:SECRET
  });
}
function complete(current,id='auto_complete_001',matchId='m1',now=NOW,clientMatchId='client_suggested_match'){
  const match=current.session.event.active.find(item=>item.id===matchId);
  return submit(current,{
    type:'official-court-complete',operationId:id,matchId,court:match.court,token:`token_${id}`,autoEnterMatchId:clientMatchId,
    expectedStartedAt:match.startedAt,expectedPlayerIds:[...match.playerIds]
  },now);
}
function activeYield(current,matchId,now=NOW+30_000,id='auto_yield_0001'){
  const match=current.session.event.active.find(item=>item.id===matchId);
  return submit(current,{
    type:'official-active-yield',operationId:id,matchId,court:match.court,token:`token_${id}`,replacementMatchId:`client_replacement_${id}`,
    expectedStartedAt:match.startedAt,expectedAutoHandoffAt:match.autoHandoffAt,
    expectedPlayerIds:[...match.playerIds],expectedTeam1Ids:[...match.t1Ids],expectedTeam2Ids:[...match.t2Ids]
  },now);
}

let state=root();
let completed=complete(state);
assert.strictEqual(completed.terminal.status,'applied','경기 종료는 서버에서 적용되어야 합니다.');
state=completed.current;
const autoMatch=state.session.event.active.find(match=>match.id==='sm_auto_complete_001');
assert(autoMatch&&autoMatch.court===1,'종료한 코트에 해당 다음 대진을 즉시 투입해야 합니다.');
assert.strictEqual(autoMatch.autoHandoffExpiresAt-autoMatch.autoHandoffAt,AUTO_HANDOFF_WINDOW_MS,'자동 투입 경기의 이번만 뒤로 창은 정확히 2분이어야 합니다.');
assert.deepStrictEqual(autoMatch.playerIds,['p9','p10','p11','p12'],'종료 전에 해당 코트로 안내된 다음 대진을 그대로 투입해야 합니다.');
assert(state.session.players.filter(p=>['p1','p2','p3','p4'].includes(p.id)).every(p=>p.games===1&&p.status==='wait'),'종료 경기 선수만 게임 수를 올리고 대기로 돌려야 합니다.');
assert(state.session.players.filter(p=>['p1','p2','p3','p4'].includes(p.id)).every(p=>p.typeTrackedGames===1&&p.lastPlayedSeq===1),'서버 종료도 관리자 원본과 같은 경기 통계를 기록해야 합니다.');
assert.strictEqual(state.session.players.find(p=>p.id==='p1').partnerCount.P2,1,'서버 종료도 파트너 출전 통계를 기록해야 합니다.');
assert.strictEqual(state.session.players.find(p=>p.id==='p1').opponentCount.P3,1,'서버 종료도 상대 출전 통계를 기록해야 합니다.');
assert(state.session.players.filter(p=>['p9','p10','p11','p12'].includes(p.id)).every(p=>p.games===0&&p.status==='playing'),'자동 투입 선수의 게임 수는 시작 시점에 올리면 안 됩니다.');
assert.strictEqual(state.requests.auto_complete_001.serverResult.autoEnter.matchId,'sm_auto_complete_001','관리자 재실행을 위해 서버가 결정한 자동 투입 결과를 명령 기록에 남겨야 합니다.');
assert(!state.session.event.active.some(match=>match.id==='client_suggested_match'),'클라이언트가 제안한 경기 ID를 서버 상태에 그대로 사용하면 안 됩니다.');
assert.strictEqual(state.session.serverRuntime.holds['1'],undefined,'자동 투입된 코트를 수동 입장 대기로 남기면 안 됩니다.');

const beforeYieldGames=state.session.players.filter(p=>['p9','p10','p11','p12'].includes(p.id)).map(p=>p.games);
let yielded=activeYield(state,'sm_auto_complete_001');
assert.strictEqual(yielded.terminal.status,'applied','2분 안의 이번만 뒤로는 즉시 적용되어야 합니다.');
state=yielded.current;
const replacement=state.session.event.active.find(match=>match.id==='sm_auto_yield_0001');
assert(replacement&&replacement.court===1,'이번만 뒤로 처리 뒤 같은 코트에 다음 대진을 즉시 투입해야 합니다.');
assert.deepStrictEqual(replacement.playerIds,['p13','p14','p15','p16'],'다음 대기 순서의 네 명을 대체 투입해야 합니다.');
assert.deepStrictEqual(state.session.event.next[0].playerIds,['p9','p10','p11','p12'],'빠진 대진은 네 명과 팀을 유지해 현재 코트 순환 뒤로 보내야 합니다.');
assert.deepStrictEqual(state.session.players.filter(p=>['p9','p10','p11','p12'].includes(p.id)).map(p=>p.games),beforeYieldGames,'이번만 뒤로는 취소된 경기의 게임 수를 올리면 안 됩니다.');
assert(state.session.players.filter(p=>['p9','p10','p11','p12'].includes(p.id)).every(p=>p.status==='wait'),'뒤로 보낸 네 명은 다시 대기 상태여야 합니다.');
assert(state.session.players.filter(p=>['p9','p10','p11','p12'].includes(p.id)).every(p=>p.waitFrom===NOW-60_000&&p.lastStatusAt===NOW-1000),'이번만 뒤로는 자동 투입 전 대기시간을 복원해 공정성을 지켜야 합니다.');
assert.strictEqual(state.requests.auto_yield_0001.serverResult.deferred.queueId,'q1','관리자 재실행을 위해 뒤로 보낸 대진 정보를 기록해야 합니다.');
assert.strictEqual(replacement.autoHandoffExpiresAt-replacement.autoHandoffAt,AUTO_HANDOFF_WINDOW_MS,'대체 투입 경기에도 새 2분 대응 창을 제공해야 합니다.');

const undo=submit(state,{type:'official-operation-undo',operationId:'auto_undo_00001',token:'token_auto_yield_0001'},NOW+40_000);
assert.strictEqual(undo.terminal.status,'applied','이번만 뒤로도 45초 안에는 되돌릴 수 있어야 합니다.');
assert(undo.current.session.event.active.some(match=>match.id==='sm_auto_complete_001'),'되돌리면 방금 자동 투입됐던 경기를 복원해야 합니다.');
assert(undo.current.session.event.next.some(item=>item.queueId==='q2'),'되돌리면 대체 투입 전 대기 순서도 복원해야 합니다.');

let expiredState=complete(root(),'expired_complete_1','m1',NOW,'expired_auto').current;
const expired=activeYield(expiredState,'sm_expired_complete_1',NOW+AUTO_HANDOFF_WINDOW_MS+1,'expired_yield_01');
assert.strictEqual(expired.terminal.status,'rejected','자동 투입 후 2분이 지나면 이번만 뒤로를 거절해야 합니다.');

let noReplacementRoot=root();
noReplacementRoot.session.event.next=[noReplacementRoot.session.event.next[0]];
for(const id of ['p1','p2','p3','p4']){
  noReplacementRoot.session.players.find(player=>player.id===id).afterMatchStatus='done';
}
for(const id of ['p13','p14','p15','p16','spare']){
  const player=noReplacementRoot.session.players.find(row=>row.id===id);
  player.status='done';player.statusLabel='done';player.currentMatchId='';
}
let noReplacement=complete(noReplacementRoot,'single_complete_1','m1',NOW,'single_auto').current;
const noReplacementYield=activeYield(noReplacement,'sm_single_complete_1',NOW+10_000,'single_yield_01');
assert.strictEqual(noReplacementYield.terminal.status,'rejected','대체할 다음 대진이 없으면 진행 경기를 빈 코트로 만들면 안 됩니다.');

let beforeBoundary=complete(root(),'boundary_before_complete','m1',NOW).current;
const beforeBoundaryYield=activeYield(beforeBoundary,'sm_boundary_before_complete',NOW+AUTO_HANDOFF_WINDOW_MS-1,'boundary_before_yield');
assert.strictEqual(beforeBoundaryYield.terminal.status,'applied','2분이 끝나기 직전까지는 이번만 뒤로를 처리해야 합니다.');
let atBoundary=complete(root(),'boundary_exact_complete','m1',NOW).current;
const atBoundaryYield=activeYield(atBoundary,'sm_boundary_exact_complete',NOW+AUTO_HANDOFF_WINDOW_MS,'boundary_exact_yield');
assert.strictEqual(atBoundaryYield.terminal.status,'rejected','정확히 2분이 지나면 화면과 서버 모두 이번만 뒤로를 닫아야 합니다.');

let promotedRoot=root();
promotedRoot.session.event.expected=[promotedRoot.session.event.next[0]];
promotedRoot.session.event.next=[];
promotedRoot.session.event.nextTarget=1;
promotedRoot.session.event.queuePolicy.official=1;
const promoted=complete(promotedRoot,'expected_promote_complete','m1',NOW).current;
assert.deepStrictEqual(promoted.session.event.active.find(match=>match.id==='sm_expected_promote_complete')?.playerIds,['p9','p10','p11','p12'],'다음 대진이 예상 영역에만 있어도 종료와 함께 승격해 같은 코트에 자동 투입해야 합니다.');

let mixedRoot=root();
mixedRoot.session.event.active.find(match=>match.id==='m1').type='혼복';
const mixed=complete(mixedRoot,'mixed_complete_001','m1',NOW).current;
assert(mixed.session.players.filter(p=>['p1','p2','p3','p4'].includes(p.id)).every(p=>p.mixedGames===1),'혼복 종료를 서버에서 처리해도 혼복 출전 통계를 빠뜨리면 안 됩니다.');

let reservedRoot=root();
reservedRoot.session.event.next[0].reservationId='reservation_q1';
reservedRoot.session.reservations=[{id:'reservation_q1',mode:'match',team1:['p9','p10'],team2:['p11','p12'],source:'club-official-request'}];
let reserved=complete(reservedRoot,'reserved_complete_1','m1',NOW).current;
assert(!reserved.session.reservations.some(row=>row.id==='reservation_q1'),'예약 대진이 자동 투입되면 대기 예약에서는 제거해야 합니다.');
reserved=activeYield(reserved,'sm_reserved_complete_1',NOW+10_000,'reserved_yield_01').current;
assert(reserved.session.reservations.some(row=>row.id==='reservation_q1'),'예약 대진을 이번만 뒤로 보내면 원 예약도 함께 복원해야 합니다.');
assert.strictEqual(reserved.session.event.next.find(item=>item.queueId==='q1')?.reservationId,'reservation_q1','뒤로 보낸 대진은 예약 연결을 유지해야 합니다.');

let collision=complete(root(),'collision_complete_1','m1',NOW,'m2').current;
assert(collision.session.event.active.some(match=>match.id==='m2')&&collision.session.event.active.some(match=>match.id==='sm_collision_complete_1'),'클라이언트가 기존 경기 ID를 제안해도 서버 결정 ID로 중복을 막아야 합니다.');

let unrelated=complete(root(),'unrelated_complete_1','m1',NOW).current;
const spare=unrelated.session.players.find(player=>player.id==='spare');
unrelated=submit(unrelated,{
  type:'official-player-status',operationId:'unrelated_status_01',playerId:'spare',status:'rest',
  expectedLastStatusAt:spare.lastStatusAt
},NOW+20_000).current;
const afterUnrelated=activeYield(unrelated,'sm_unrelated_complete_1',NOW+30_000,'unrelated_yield_01');
assert.strictEqual(afterUnrelated.terminal.status,'applied','다른 코트·선수 작업이 끼어도 해당 자동 경기의 2분 대응 창은 유지해야 합니다.');

let freeCourtRoot=root();
for(let i=1;i<=4;i++){
  const p=freeCourtRoot.session.players.find(row=>row.id===`p${i}`);
  p.status='wait';p.statusLabel='wait';p.locked=false;p.currentMatchId='';
}
freeCourtRoot.session.event.active=freeCourtRoot.session.event.active.filter(match=>match.id==='m2');
freeCourtRoot.session.event.next.push(queue('q3',['p1','p2','p3','p4']));
freeCourtRoot.session.event.nextTarget=3;
freeCourtRoot.session.event.queuePolicy.official=3;
let freeCourt=complete(freeCourtRoot,'free_court_complete','m2',NOW).current;
assert.deepStrictEqual(freeCourt.session.event.active.find(match=>match.id==='sm_free_court_complete')?.playerIds,['p13','p14','p15','p16'],'다른 코트가 이미 비어 있어도 종료한 코트에 배정된 대진만 자동 투입해야 합니다.');
assert.deepStrictEqual(freeCourt.session.event.next.find(item=>item.queueId==='q1')?.playerIds,['p9','p10','p11','p12'],'다른 빈 코트 몫의 대진을 가져오면 안 됩니다.');
const freeCourtYield=activeYield(freeCourt,'sm_free_court_complete',NOW+10_000,'free_court_yield');
assert.strictEqual(freeCourtYield.terminal.status,'applied','다른 빈 코트가 있어도 자동 투입 경기의 이번만 뒤로는 처리되어야 합니다.');
assert.deepStrictEqual(freeCourtYield.current.session.event.active.find(match=>match.id==='sm_free_court_yield')?.playerIds,['p1','p2','p3','p4'],'이번만 뒤로도 정확히 같은 코트 몫의 다음 대진을 대체 투입해야 합니다.');

let threeCourt=root();
for(let i=17;i<=24;i++)threeCourt.session.players.push(player(`p${i}`,i<=20?'playing':'wait'));
for(let i=17;i<=20;i++)threeCourt.session.players.find(row=>row.id===`p${i}`).currentMatchId='m3';
threeCourt.session.event.courts=3;
threeCourt.session.event.nextTarget=3;
threeCourt.session.event.queuePolicy.official=3;
threeCourt.session.event.active.push(active('m3',3,['p17','p18','p19','p20'],NOW-8*60_000));
threeCourt.session.event.next.push(queue('q3',['p21','p22','p23','p24']));
threeCourt=complete(threeCourt,'three_court_complete','m1',NOW).current;
const threeCourtYield=activeYield(threeCourt,'sm_three_court_complete',NOW+10_000,'three_court_yield');
assert.strictEqual(threeCourtYield.terminal.status,'applied','세 코트 운영에서도 자동 투입 대진을 이번만 뒤로 처리할 수 있어야 합니다.');
assert.deepStrictEqual(threeCourtYield.current.session.event.active.find(match=>match.id==='sm_three_court_yield')?.playerIds,['p13','p14','p15','p16'],'바로 다음 한 경기만 같은 코트에 대체 투입해야 합니다.');
assert.strictEqual(threeCourtYield.current.session.event.next[0].queueId,'q1','진행 코트가 여러 개여도 빠진 대진을 맨 뒤가 아닌 대체 경기 바로 다음에 두어야 합니다.');
assert.strictEqual(threeCourtYield.current.requests.three_court_yield.serverResult.deferred.queueIndex,1,'서버 재동기화 기록에도 한 경기 뒤 순번을 남겨야 합니다.');

let fourCourt=root();
for(let i=17;i<=36;i++)fourCourt.session.players.push(player(`p${i}`,i<=24?'playing':'wait'));
for(let i=17;i<=20;i++)fourCourt.session.players.find(row=>row.id===`p${i}`).currentMatchId='m3';
for(let i=21;i<=24;i++)fourCourt.session.players.find(row=>row.id===`p${i}`).currentMatchId='m4';
fourCourt.session.event.courts=4;
fourCourt.session.event.nextTarget=4;
fourCourt.session.event.queuePolicy.official=4;
fourCourt.session.event.active.push(active('m3',3,['p17','p18','p19','p20'],NOW-8*60_000));
fourCourt.session.event.active.push(active('m4',4,['p21','p22','p23','p24'],NOW-7*60_000));
fourCourt.session.event.next.push(queue('q3',['p25','p26','p27','p28']));
fourCourt.session.event.next.push(queue('q4',['p29','p30','p31','p32']));
fourCourt.session.event.next.push(queue('q5',['p33','p34','p35','p36']));
fourCourt=complete(fourCourt,'four_court_complete','m3',NOW).current;
for(const matchId of ['m1','m2']){
  const match=fourCourt.session.event.active.find(row=>row.id===matchId);
  fourCourt.session.event.active=fourCourt.session.event.active.filter(row=>row.id!==matchId);
  for(const id of match.playerIds){
    const row=fourCourt.session.players.find(playerRow=>playerRow.id===id);
    row.status='wait';row.statusLabel='wait';row.locked=false;row.currentMatchId='';
  }
}
const fourCourtYield=activeYield(fourCourt,'sm_four_court_complete',NOW+10_000,'four_court_yield');
assert.strictEqual(fourCourtYield.terminal.status,'applied','여러 빈 코트가 섞여도 자동 투입 대진의 이번만 뒤로는 처리되어야 합니다.');
assert.deepStrictEqual(fourCourtYield.current.session.event.active.find(match=>match.id==='sm_four_court_yield')?.playerIds,['p29','p30','p31','p32'],'다른 빈 코트 두 곳을 건너 같은 코트의 바로 다음 한 경기만 대체 투입해야 합니다.');
assert.strictEqual(fourCourtYield.current.session.event.next[2].queueId,'q1','빠진 대진은 다른 빈 코트에 즉시 재투입되지 않고 같은 코트 대체 경기 바로 다음에 있어야 합니다.');
assert.strictEqual(fourCourtYield.current.requests.four_court_yield.serverResult.deferred.queueIndex,3,'다중 코트의 전역 순번보다 같은 코트 한 경기 뒤라는 의미를 우선해야 합니다.');

let simultaneous=root();
simultaneous=complete(simultaneous,'multi_complete_01','m1',NOW,'multi_auto_1').current;
simultaneous=complete(simultaneous,'multi_complete_02','m2',NOW+1,'multi_auto_2').current;
assert.deepStrictEqual(simultaneous.session.event.active.map(match=>match.id).sort(),['sm_multi_complete_01','sm_multi_complete_02'],'두 코트가 연달아 끝나도 서로 다른 다음 대진을 한 번씩만 투입해야 합니다.');
const simultaneousIds=simultaneous.session.event.active.flatMap(match=>match.playerIds);
assert.strictEqual(new Set(simultaneousIds).size,simultaneousIds.length,'동시 종료 처리에서 한 선수가 두 코트에 중복 투입되면 안 됩니다.');

console.log('daily official auto handoff regression ok');
