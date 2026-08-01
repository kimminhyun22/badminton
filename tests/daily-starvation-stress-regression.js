'use strict';

const assert=require('assert');
const crypto=require('crypto');
const {
  canonicalJson,
  issueOfficialGrant
}=require('../functions/daily-official-engine');
const {applyCommandTransaction}=require('../functions/daily-official-command');
const {
  TEAM_DIFF_LIMIT,
  PARTNER_GAP_HARD,
  PARTNER_GAP_CORRECTION_LIMIT,
  PARTNER_GAP_SYMMETRY_LIMIT,
  effectiveLevel,
  preparedPairing,
  replenishPrepared
}=require('../functions/daily-server-matchmaker');

const BASE_NOW=1_850_000_000_000;
const CHECKIN_ID='DFAIR222';
const CLIENT_ID='fair_stress_official_client';
const OFFICIAL_ID='fair-official';
const SECRET='daily-starvation-stress-secret';
const INVITE_HASH='d'.repeat(64);
const GRANT=issueOfficialGrant({
  v:1,sid:CHECKIN_ID,cid:CLIENT_ID,pid:OFFICIAL_ID,
  iat:BASE_NOW-1000,exp:BASE_NOW+48*60*60_000
},SECRET);

function clone(value){
  return JSON.parse(JSON.stringify(value));
}

function hash(value){
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function grade(level){
  return ({7:'S',6:'A',5:'B',4:'C',3:'D',2:'E',1:'E'})[level]||'C';
}

function profile(id,level,gender,ageGroup='40대'){
  return {
    id,name:id,level,grade:grade(level),gender,ageGroup,club:'시뮬레이션클럽',
    status:'wait',statusLabel:'wait',locked:false,currentMatchId:'',afterMatchStatus:'',
    games:0,fairExpected:0,mixedGames:0,typeTrackedGames:0,lastPlayedSeq:0,
    partnerCount:{},opponentCount:{},joinedAt:BASE_NOW-60*60_000,
    waitFrom:BASE_NOW-60*60_000,lastStatusAt:BASE_NOW-1000,isClubOfficial:false
  };
}

function sessionFor(players){
  return {
    serverSessionId:CHECKIN_ID,commandProtocol:2,serverRevision:0,serverLastRequestId:'',
    matchStartedAt:BASE_NOW,expiresAt:BASE_NOW+48*60*60_000,
    officialInvite:{tokenHash:INVITE_HASH,expiresAt:BASE_NOW+48*60*60_000},
    capabilities:{officialOpsServerV2:true,officialAutoHandoffV1:true,officialOperationUndoV1:true},
    players:[
      {
        ...profile(OFFICIAL_ID,4,'M'),
        name:'운영임원',status:'rest',statusLabel:'rest',isClubOfficial:true
      },
      ...players
    ],
    reservations:[],arrivalCandidates:[],
    serverRuntime:{holds:{},nextSeq:1,fourCounts:{},exactCounts:{}},
    event:{
      courts:3,nextTarget:3,serverExpectedGoal:0,completed:0,
      finishMode:false,operationStarted:true,queuePolicy:{official:3,auto:true},
      active:[],next:[],expected:[],serverStandby:[]
    }
  };
}

function startInitialCourts(session){
  replenishPrepared(session,{now:BASE_NOW,requestId:'fair_initial_prepare'});
  assert.strictEqual(session.event.next.length,3,'초기 세 코트 대진을 만들 수 있어야 합니다.');
  const prepared=[...session.event.next];
  session.event.next=[];
  prepared.forEach((item,index)=>{
    const pool=session.players.filter(row=>row.status==='wait'&&!row.currentMatchId);
    const amount=4/pool.length;
    pool.forEach(row=>{row.fairExpected=Number(row.fairExpected||0)+amount;});
    const matchId=`fair_seed_${index+1}`;
    const ids=[...item.t1Ids,...item.t2Ids];
    session.event.active.push({
      id:matchId,court:index+1,seq:index+1,type:item.type,teamMode:false,
      startedAt:BASE_NOW,expectedMinutes:15,endAt:BASE_NOW+15*60_000,
      t1Ids:[...item.t1Ids],t2Ids:[...item.t2Ids],playerIds:ids,
      t1:[...item.t1],t2:[...item.t2]
    });
    ids.forEach(id=>{
      const row=session.players.find(player=>player.id===id);
      row.status='playing';
      row.statusLabel='playing';
      row.locked=true;
      row.currentMatchId=matchId;
      row.lastStatusAt=BASE_NOW;
    });
  });
  session.serverRuntime.nextSeq=4;
  replenishPrepared(session,{now:BASE_NOW,requestId:'fair_initial_queue'});
}

function root(players){
  const session=sessionFor(players);
  startInitialCourts(session);
  return {
    session,requests:{},serverCommands:{},serverOps:{},
    officialClaims:{
      [CLIENT_ID]:{
        clientId:CLIENT_ID,expiresAt:BASE_NOW+48*60*60_000,
        inviteHash:INVITE_HASH,claimMode:'roster',officialPlayerId:OFFICIAL_ID
      }
    }
  };
}

function complete(current,index,now){
  const match=current.session.event.active
    .slice()
    .sort((a,b)=>Number(a.startedAt)-Number(b.startedAt)||Number(a.court)-Number(b.court))[0];
  assert(match,'운영 중인 경기가 끊기면 안 됩니다.');
  const stored={
    type:'official-court-complete',
    operationId:`fair_complete_${String(index).padStart(3,'0')}`,
    token:`fair_token_${String(index).padStart(3,'0')}`,
    actorPlayerId:OFFICIAL_ID,actorPlayerName:'운영임원',
    createdAt:now,expiresAt:now+30*60_000,source:'club-official-support',
    matchId:match.id,court:match.court,
    expectedStartedAt:match.startedAt,expectedPlayerIds:[...match.playerIds]
  };
  const outcome=applyCommandTransaction(clone(current),{
    storedCommand:stored,
    engineCommand:{...stored,officialGrantToken:GRANT},
    operationId:stored.operationId,
    payloadHash:hash(stored),
    clientId:CLIENT_ID,grantPlayerId:OFFICIAL_ID,
    now,checkinId:CHECKIN_ID,grantSecret:SECRET
  });
  assert.strictEqual(outcome.action,'commit',`${index}번째 종료 트랜잭션이 저장되어야 합니다.`);
  assert.strictEqual(outcome.terminal.status,'applied',`${index}번째 종료가 적용되어야 합니다.`);
  return outcome.current;
}

function actualGames(player){
  return Number(player.games||0)+((player.status==='playing'||player.currentMatchId)?1:0);
}

function assertQuality(session){
  const occupied=new Set();
  for(const item of [...session.event.active,...session.event.next]){
    const ids=item.playerIds||[...(item.t1Ids||[]),...(item.t2Ids||[])];
    assert.strictEqual(ids.length,4,'모든 진행·대기 대진은 네 명이어야 합니다.');
    ids.forEach(id=>{
      assert(!occupied.has(id),'한 선수가 진행·대기 대진에 중복되면 안 됩니다.');
      occupied.add(id);
    });
    const first=item.t1Ids.map(id=>session.players.find(row=>row.id===id));
    const second=item.t2Ids.map(id=>session.players.find(row=>row.id===id));
    const teamDiff=Math.abs(
      first.reduce((sum,row)=>sum+effectiveLevel(row),0)
      -second.reduce((sum,row)=>sum+effectiveLevel(row),0)
    );
    assert(teamDiff<=TEAM_DIFF_LIMIT,'공정성 보정 중에도 팀 실력차 하드 제한을 넘으면 안 됩니다.');
    const partnerLimit=item.fairnessCorrection?PARTNER_GAP_CORRECTION_LIMIT:PARTNER_GAP_HARD;
    const firstGap=Math.abs(effectiveLevel(first[0])-effectiveLevel(first[1]));
    const secondGap=Math.abs(effectiveLevel(second[0])-effectiveLevel(second[1]));
    assert(item.fairnessCorrection?firstGap<=partnerLimit:firstGap<partnerLimit,'첫 팀 파트너 실력차 제한을 넘으면 안 됩니다.');
    assert(item.fairnessCorrection?secondGap<=partnerLimit:secondGap<partnerLimit,'둘째 팀 파트너 실력차 제한을 넘으면 안 됩니다.');
  }
}

function runScenario(name,players,focusId,completions=24){
  let state=root(players);
  let now=BASE_NOW;
  for(let index=1;index<=completions;index++){
    now+=5*60_000;
    state=complete(state,index,now);
    assert.strictEqual(state.session.event.active.length,3,`${name}: 충분한 인원일 때 세 코트가 계속 운영되어야 합니다.`);
    assertQuality(state.session);
  }
  const participants=state.session.players.filter(row=>row.id!==OFFICIAL_ID);
  const games=participants.map(actualGames);
  const fairGaps=participants.map(row=>Number(row.fairExpected||0)-actualGames(row));
  const focus=participants.find(row=>row.id===focusId);
  const sorted=[...games].sort((a,b)=>a-b);
  const median=sorted[Math.floor(sorted.length/2)];
  return {
    name,
    state,
    focusGames:focus?actualGames(focus):null,
    focusFairGap:focus?Number(focus.fairExpected||0)-actualGames(focus):null,
    minGames:Math.min(...games),
    maxGames:Math.max(...games),
    medianGames:median,
    maxFairGap:Math.max(...fairGaps),
    priorityCount:fairGaps.filter(gap=>gap>=0.75).length
  };
}

function wideRoster(){
  const levels=[7,6,6,5,5,5,4,4,4,3,3,3,2,2,1,1];
  return [
    ...levels.map((level,index)=>profile(`wide-m-${index+1}`,level,'M',index%4===0?'20대':'40대')),
    ...levels.map((level,index)=>profile(`wide-f-${index+1}`,level,'F',index%5===0?'30대':'40대'))
  ];
}

function rareHighRoster(){
  const rows=[
    profile('rare-s',7,'M','20대'),
    profile('rare-a-low',6,'F','50대'),
    profile('rare-a-m',6,'M','20대'),
    profile('rare-a-f',6,'F','20대')
  ];
  for(let index=0;index<28;index++){
    const level=[5,5,4,4,3,3][index%6];
    rows.push(profile(`rare-mid-${index+1}`,level,index%2?'F':'M',index%7===0?'50대':'40대'));
  }
  return rows;
}

function rareLowRoster(){
  const rows=[
    profile('rare-e',1,'F','20대'),
    profile('rare-d-m',3,'M','40대'),
    profile('rare-e-m',1,'M','20대'),
    profile('rare-d-f',3,'F','40대')
  ];
  for(let index=0;index<28;index++){
    const level=[5,4,4,3,3,2][index%6];
    rows.push(profile(`rare-low-mid-${index+1}`,level,index%2?'F':'M','40대'));
  }
  return rows;
}

function minorityGenderRoster(){
  const rows=[profile('minority-f',4,'F','40대')];
  for(let index=0;index<31;index++){
    rows.push(profile(`minority-m-${index+1}`,[6,5,5,4,4,3,3][index%7],'M','40대'));
  }
  return rows;
}

const results=[
  runScenario('wide-levels',wideRoster(),'wide-m-1'),
  runScenario('rare-high-s',rareHighRoster(),'rare-s'),
  runScenario('rare-low-e',rareLowRoster(),'rare-e'),
  runScenario('minority-gender',minorityGenderRoster(),'minority-f')
];
const recoveryResults=[
  runScenario('wide-levels-150m',wideRoster(),'wide-m-1',30),
  runScenario('rare-high-s-150m',rareHighRoster(),'rare-s',30),
  runScenario('rare-low-e-150m',rareLowRoster(),'rare-e',30),
  runScenario('minority-gender-150m',minorityGenderRoster(),'minority-f',30)
];

function compact(result){
  const {state,...summary}=result;
  return summary;
}

console.log(JSON.stringify(results.map(compact)));

results.forEach(result=>{
  const summary=JSON.stringify(compact(result));
  assert(result.maxGames-result.minGames<=2,`${result.name}: 상시 참가자의 경기 수 차이는 두 경기 이하여야 합니다. ${summary}`);
  assert(result.focusGames>=result.medianGames-1,`${result.name}: 희소 급수·성별 선수도 중앙값보다 두 경기 이상 뒤처지면 안 됩니다. ${summary}`);
  assert(result.maxFairGap<=2,`${result.name}: 다음 생성 주기에서 회복할 수 없는 수준으로 공정성 부족이 누적되면 안 됩니다. ${summary}`);
});

recoveryResults.forEach(result=>{
  const summary=JSON.stringify(compact(result));
  assert(result.maxGames-result.minGames<=2,`${result.name}: 2시간 30분 운영 후에도 경기 수 차이는 두 경기 이하여야 합니다. ${summary}`);
  assert(result.focusGames>=result.medianGames-1,`${result.name}: 희소 급수·성별 선수의 보정이 다음 주기까지 완료되어야 합니다. ${summary}`);
  assert(result.maxFairGap<=1.5,`${result.name}: 강제 보정 기준을 넘은 공정성 부족은 다음 생성 주기 안에 회복되어야 합니다. ${summary}`);
});

const symmetryPlayers=[
  profile('symmetry-s',7,'M','20대'),
  profile('symmetry-b',5,'M','20대'),
  profile('symmetry-a1',6,'M','20대'),
  profile('symmetry-a2',6,'M','20대')
];
const symmetrySession=sessionFor(symmetryPlayers);
assert.strictEqual(PARTNER_GAP_SYMMETRY_LIMIT,1.5,'서버도 보통 대진의 파트너 격차 대칭 상한을 공유해야 합니다.');
assert.strictEqual(
  preparedPairing(symmetrySession,['symmetry-s','symmetry-b'],['symmetry-a1','symmetry-a2'],{now:BASE_NOW}),
  null,
  '합산이 같아도 한쪽 파트너 격차만 크면 서버 보통 대진에서 제외해야 합니다.'
);
symmetryPlayers[0].fairExpected=1;
assert(
  preparedPairing(symmetrySession,['symmetry-s','symmetry-b'],['symmetry-a1','symmetry-a2'],{now:BASE_NOW}),
  '한 경기 이상 부족한 선수는 파트너 격차 대칭보다 경기 기회를 우선해야 합니다.'
);
symmetryPlayers[0].fairExpected=0;
assert(
  preparedPairing(symmetrySession,['symmetry-s','symmetry-b'],['symmetry-a1','symmetry-a2'],{now:BASE_NOW,reservationId:'pair-1'}),
  '지정 파트너 요청은 서버 대칭 제한으로 취소하면 안 됩니다.'
);

function correctionRoster(fairExpected){
  const rows=[
    profile('correction-s',7,'M','20대'),
    profile('correction-d',3,'M','20대'),
    profile('correction-b1',5,'M','20대'),
    profile('correction-b2',5,'M','20대')
  ];
  rows[0].fairExpected=fairExpected;
  return rows;
}

const correctionSession=sessionFor(correctionRoster(2));
correctionSession.event.courts=1;
correctionSession.event.queuePolicy.official=1;
const correctionGenerated=replenishPrepared(correctionSession,{now:BASE_NOW,requestId:'fair_partner_gap_correction'});
assert.strictEqual(correctionGenerated.generated.length,1,'경기 기회가 1.5경기 이상 부족하면 파트너 차이만 완화한 보정 대진을 만들어야 합니다.');
const correctionMatch=correctionGenerated.generated[0];
assert.strictEqual(correctionMatch.fairnessCorrection,true,'일반 대진과 파트너 차이 완화 보정 대진을 구분해 동기화해야 합니다.');
assert(correctionMatch.playerIds.includes('correction-s'),'보정 대진에는 실제 경기 기회가 부족한 희소 선수가 포함되어야 합니다.');
const correctionTeam1=correctionMatch.t1Ids.map(id=>correctionSession.players.find(player=>player.id===id));
const correctionTeam2=correctionMatch.t2Ids.map(id=>correctionSession.players.find(player=>player.id===id));
const correctionPartnerGap=Math.max(
  Math.abs(effectiveLevel(correctionTeam1[0])-effectiveLevel(correctionTeam1[1])),
  Math.abs(effectiveLevel(correctionTeam2[0])-effectiveLevel(correctionTeam2[1]))
);
assert(correctionPartnerGap>=PARTNER_GAP_HARD,'보정 시나리오는 일반 파트너 제한으로는 만들 수 없는 조합이어야 합니다.');
assert(correctionPartnerGap<=PARTNER_GAP_CORRECTION_LIMIT,'보정 대진도 완화된 파트너 차이 상한은 지켜야 합니다.');
assert(correctionMatch.levelDiff<=TEAM_DIFF_LIMIT,'파트너 차이를 완화해도 양 팀 합산 실력차 제한은 절대 풀면 안 됩니다.');

const earlyCorrectionSession=sessionFor(correctionRoster(1.49));
earlyCorrectionSession.event.courts=1;
earlyCorrectionSession.event.queuePolicy.official=1;
assert.strictEqual(
  replenishPrepared(earlyCorrectionSession,{now:BASE_NOW,requestId:'fair_partner_gap_too_early'}).generated.length,
  0,
  '게임 기회가 강제 보정 기준에 이르기 전에는 일반 파트너 품질을 느슨하게 만들면 안 됩니다.'
);

const supportOutsideCandidateRows=[profile('candidate-s',7,'M','20대')];
supportOutsideCandidateRows[0].fairExpected=2;
for(let index=0;index<22;index++){
  supportOutsideCandidateRows.push(profile(`candidate-low-${index+1}`,3,'M','40대'));
}
for(let index=0;index<3;index++){
  const support=profile(`candidate-support-${index+1}`,5,'M','20대');
  support.games=5;
  support.fairExpected=5;
  supportOutsideCandidateRows.push(support);
}
const supportOutsideCandidateSession=sessionFor(supportOutsideCandidateRows);
supportOutsideCandidateSession.event.courts=1;
supportOutsideCandidateSession.event.queuePolicy.official=1;
const supportOutsideCandidate=replenishPrepared(supportOutsideCandidateSession,{now:BASE_NOW,requestId:'fair_support_outside_candidate'}).generated[0];
assert(supportOutsideCandidate,'전체 대기자에 합법 조합이 있으면 희소 급수 대진을 생성해야 합니다.');
assert(supportOutsideCandidate.playerIds.includes('candidate-s'),'강제 보정 선수와 호환되는 선수가 상위 22명 밖에 있어도 전체 대기자에서 찾아야 합니다.');
assert(supportOutsideCandidate.playerIds.filter(id=>id.startsWith('candidate-support-')).length===3,'희소 S급의 합법 조합에 필요한 B급 세 명을 함께 찾아야 합니다.');

const impossiblePlayers=[
  profile('impossible-s',7,'M','20대'),
  ...Array.from({length:31},(_,index)=>profile(`impossible-c-${index+1}`,3,index%2?'F':'M','40대'))
];
const impossible=runScenario('impossible-s',impossiblePlayers,'impossible-s',12);
assert.strictEqual(impossible.focusGames,0,'호환 가능한 파트너·상대가 전혀 없는 S급은 하드 제한을 깨지 않고 자동 편성할 수 없어야 합니다.');
assert(impossible.focusFairGap>=0.75,'편성이 불가능한 선수도 공정 보정 필요 상태로 명확히 남아야 합니다.');
assertQuality(impossible.state.session);

console.log('daily starvation stress regression ok');
console.log(JSON.stringify(recoveryResults.map(compact)));
console.log(JSON.stringify({name:impossible.name,focusGames:impossible.focusGames,focusFairGap:impossible.focusFairGap}));
