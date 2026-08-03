'use strict';

const assert = require('assert');
const crypto = require('crypto');

const {
  canonicalJson,
  issueOfficialGrant,
  refreshEvent
} = require('../functions/daily-official-engine');
const {
  TEAM_DIFF_LIMIT,
  PARTNER_GAP_HARD,
  PARTNER_GAP_CORRECTION_LIMIT,
  FAIR_FORCE_GAP,
  effectiveLevel,
  replenishPrepared
} = require('../functions/daily-server-matchmaker');
const {applyCommandTransaction} = require('../functions/daily-official-command');

const BASE_NOW = 1_830_000_000_000;
const MATCH_MINUTES = 15;
const COURTS = 3;
const WAVES = 10;
const CHECKIN_ID = 'DROSTER36';
const CLIENT_ID = 'official_roster36_client';
const SECRET = 'minton-roster-36-fairness-secret';
const ACTOR_NAME = '운영임원';
const FOCUS_NAME = '희소S';

// This anonymized fixture preserves the supplied 36-player gender, grade, age-band and guest distribution.
const ROSTER = [
  ['게스트01','F','D','40대',true],
  ['선수02','M','C','30대'],
  ['상급03','M','A','40대'],
  ['선수04','M','C','50대'],
  ['선수05','F','C','40대'],
  [ACTOR_NAME,'M','D','40대'],
  ['상급07','M','B','40대'],
  ['선수08','F','D','40대'],
  ['선수09','F','C','40대'],
  ['선수10','M','C','30대'],
  ['선수11','F','D','40대'],
  ['게스트12','M','E','40대',true],
  [FOCUS_NAME,'M','S','40대'],
  ['선수14','F','C','40대'],
  ['선수15','M','E','40대'],
  ['선수16','M','C','50대'],
  ['상급17','M','B','50대'],
  ['선수18','F','D','50대'],
  ['선수19','M','D','40대'],
  ['게스트20','F','C','40대',true],
  ['상급21','M','A','40대'],
  ['상급22','M','A','50대'],
  ['게스트23','M','B','40대',true],
  ['상급24','F','A','40대'],
  ['게스트25','M','D','40대',true],
  ['선수26','F','D','50대'],
  ['게스트27','M','B','40대',true],
  ['선수28','F','B','40대'],
  ['선수29','M','C','50대'],
  ['게스트30','F','C','40대',true],
  ['선수31','M','C','50대'],
  ['선수32','M','D','50대'],
  ['선수33','M','C','40대'],
  ['선수34','M','C','20대'],
  ['선수35','M','B','50대'],
  ['상급36','M','A','40대']
];

const GRADE_LEVEL = Object.freeze({S:7,A:6,B:5,C:4,D:3,E:2});

function hash(value){
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function rng(seed){
  let value = seed >>> 0;
  return ()=>{
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function shuffled(values, seed){
  const result = [...values];
  const random = rng(seed);
  for(let i=result.length-1;i>0;i--){
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function median(values){
  const sorted=[...values].sort((a,b)=>a-b);
  if(!sorted.length)return 0;
  const mid=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
}

function round(value, places=2){
  const scale=10**places;
  return Math.round((Number(value)||0)*scale)/scale;
}

function playerRows(options){
  const idOrder = shuffled(ROSTER.map(row=>row[0]), options.idSeed || 1);
  const idByName = new Map(idOrder.map((name,index)=>[name,`p${String(index+1).padStart(2,'0')}`]));
  const late = new Set(options.lateNames || []);
  return ROSTER.map(([name,gender,grade,ageGroup,isGuest])=>{
    const resolvedGender = name === FOCUS_NAME ? (options.hajuGender || gender) : gender;
    const level = Math.max(1, GRADE_LEVEL[grade] - (resolvedGender === 'F' ? 1 : 0));
    const status = late.has(name) ? 'planned' : 'wait';
    return {
      id:idByName.get(name),
      memberId:`member_${idByName.get(name)}`,
      name,gender:resolvedGender,grade,level,ageGroup,isGuest:!!isGuest,
      status,statusLabel:status,preArrivalVisible:status==='planned',registrationCancelled:false,
      locked:false,currentMatchId:'',afterMatchStatus:'',games:0,fairExpected:0,
      mixedGames:0,typeTrackedGames:0,lastPlayedSeq:0,
      partnerCount:{},opponentCount:{},partnerCountById:{},opponentCountById:{},
      joinedAt:status==='wait'?BASE_NOW:0,
      waitFrom:status==='wait'?BASE_NOW:0,
      lastStatusAt:BASE_NOW-1000,
      restPausedMs:0,
      isClubOfficial:name===ACTOR_NAME,
      isTemporaryOfficial:false
    };
  });
}

function makeRoot(options){
  const players=playerRows(options);
  const actor=players.find(row=>row.name===ACTOR_NAME);
  assert(actor,'운영 임원을 찾을 수 없습니다.');
  const grant=issueOfficialGrant({
    v:1,sid:CHECKIN_ID,cid:CLIENT_ID,pid:actor.id,
    iat:BASE_NOW-1000,exp:BASE_NOW+48*60*60_000
  },SECRET);
  return {
    actorId:actor.id,
    grant,
    current:{
      session:{
        serverSessionId:CHECKIN_ID,
        commandProtocol:2,
        serverRevision:0,
        matchStartedAt:BASE_NOW,
        expiresAt:BASE_NOW+48*60*60_000,
        officialInvite:{tokenHash:'a'.repeat(64),expiresAt:BASE_NOW+48*60*60_000},
        capabilities:{
          officialOpsServerV2:true,
          officialAutoHandoffV1:true,
          officialOperationUndoV1:true,
          memberStatusServerV1:true
        },
        players,
        reservations:[],
        arrivalCandidates:[],
        serverRuntime:{holds:{},nextSeq:1,fourCounts:{},exactCounts:{}},
        event:{
          courts:COURTS,
          nextTarget:COURTS,
          serverExpectedGoal:0,
          completed:0,
          finishMode:false,
          operationStarted:true,
          queuePolicy:{official:COURTS,auto:true},
          active:[],next:[],expected:[],serverStandby:[]
        }
      },
      officialClaims:{
        [CLIENT_ID]:{
          clientId:CLIENT_ID,
          expiresAt:BASE_NOW+48*60*60_000,
          claimMode:'roster',
          officialPlayerId:actor.id
        }
      }
    }
  };
}

function submit(context, extra, now, label){
  const operationId=`sim_${label}_${String(context.operationIndex++).padStart(5,'0')}`;
  const stored={
    actorPlayerId:context.actorId,
    actorPlayerName:ACTOR_NAME,
    createdAt:now,
    expiresAt:now+30*60_000,
    source:'roster-36-simulation',
    operationId,
    ...extra
  };
  const outcome=applyCommandTransaction(context.state,{
    storedCommand:stored,
    engineCommand:{...stored,officialGrantToken:context.grant},
    operationId,
    payloadHash:hash(stored),
    clientId:CLIENT_ID,
    grantPlayerId:context.actorId,
    now,
    checkinId:CHECKIN_ID,
    grantSecret:SECRET
  });
  assert.strictEqual(outcome.action,'commit',`${label}: 서버 명령이 커밋되지 않았습니다. ${outcome.failureMessage||''}`);
  assert.strictEqual(outcome.terminal.status,'applied',`${label}: ${outcome.terminal.reason||'서버 명령 거절'}`);
  context.state=outcome.current;
  return outcome;
}

function playerByName(context,name){
  const player=context.state.session.players.find(row=>row.name===name);
  assert(player,`${name} 선수를 찾지 못했습니다.`);
  return player;
}

function assertOperationalInvariants(session){
  const occupied=new Set();
  for(const match of session.event.active){
    assert.strictEqual(match.playerIds.length,4,'진행 경기 인원은 네 명이어야 합니다.');
    for(const id of match.playerIds){
      assert(!occupied.has(id),'진행 경기 사이에 선수가 중복되었습니다.');
      occupied.add(id);
    }
  }
  for(const item of session.event.next){
    assert.strictEqual(item.playerIds.length,4,'다음 대진 인원은 네 명이어야 합니다.');
    assert.strictEqual(new Set(item.playerIds).size,4,'다음 대진 내부에 선수가 중복되었습니다.');
    for(const id of item.playerIds){
      assert(!occupied.has(id),'진행 경기와 다음 대진에 선수가 중복되었습니다.');
      occupied.add(id);
    }
    const team1=item.t1Ids.map(id=>session.players.find(row=>row.id===id));
    const team2=item.t2Ids.map(id=>session.players.find(row=>row.id===id));
    const diff=Math.abs(team1.reduce((sum,row)=>sum+effectiveLevel(row),0)-team2.reduce((sum,row)=>sum+effectiveLevel(row),0));
    const gaps=[
      Math.abs(effectiveLevel(team1[0])-effectiveLevel(team1[1])),
      Math.abs(effectiveLevel(team2[0])-effectiveLevel(team2[1]))
    ];
    assert(diff<=TEAM_DIFF_LIMIT+1e-9,`다음 대진 팀 실력차 ${diff}가 제한을 넘었습니다.`);
    const limit=item.fairnessCorrection?PARTNER_GAP_CORRECTION_LIMIT:PARTNER_GAP_HARD;
    gaps.forEach(gap=>assert(item.fairnessCorrection?gap<=limit+1e-9:gap<limit,`파트너 실력차 ${gap}가 제한을 넘었습니다.`));
  }
}

function startInitialMatches(context){
  replenishPrepared(context.state.session,{now:BASE_NOW,requestId:'sim_initial_prepare'});
  refreshEvent(context.state.session,BASE_NOW);
  assert.strictEqual(context.state.session.event.next.length,COURTS,'초기 다음 대진이 코트 수만큼 생성되어야 합니다.');
  for(let count=0;count<COURTS;count++){
    refreshEvent(context.state.session,BASE_NOW);
    const item=context.state.session.event.next.find(row=>row.cueState==='free'&&row.targetCourt);
    // 첫 투입 뒤 남은 빈 코트는 서버가 알아서 채웁니다(2026-08-03 자동 투입 확대).
    if(!item)break;
    submit(context,{
      type:'official-queue-enter-free',
      token:`initial_enter_${count+1}`,
      queueId:item.queueId||item.id,
      court:item.targetCourt,
      newMatchId:`initial_match_${count+1}`,
      expectedQueueIndex:context.state.session.event.next.indexOf(item)+1,
      expectedHoldId:item.targetHoldId||'',
      expectedPlayerIds:[...item.playerIds],
      expectedTeam1Ids:[...item.t1Ids],
      expectedTeam2Ids:[...item.t2Ids]
    },BASE_NOW,`initial_enter_${count+1}`);
  }
  assert.strictEqual(context.state.session.event.active.length,COURTS,'초기 세 코트가 모두 시작되어야 합니다.');
  assertOperationalInvariants(context.state.session);
}

function arrival(context,name,now){
  const player=playerByName(context,name);
  submit(context,{
    type:'official-player-arrival',
    playerId:player.id,
    candidateKey:`player:${player.id}`,
    status:'wait',
    expectedStatus:player.status,
    expectedLastStatusAt:player.lastStatusAt
  },now,`arrival_${player.id}`);
}

function leave(context,name,now){
  const player=playerByName(context,name);
  const playing=player.status==='playing'||!!player.currentMatchId;
  submit(context,{
    type:'official-player-status',
    playerId:player.id,
    status:'done',
    expectedStatus:playing?'playing':player.status,
    expectedCurrentMatchId:playing?player.currentMatchId:'',
    expectedLastStatusAt:player.lastStatusAt
  },now,`done_${player.id}`);
}

function matchQuality(session,match){
  const byId=id=>session.players.find(row=>row.id===id);
  const first=match.t1Ids.map(byId);
  const second=match.t2Ids.map(byId);
  return {
    teamDiff:round(Math.abs(first.reduce((sum,row)=>sum+effectiveLevel(row),0)-second.reduce((sum,row)=>sum+effectiveLevel(row),0)),1),
    partnerGaps:[
      round(Math.abs(effectiveLevel(first[0])-effectiveLevel(first[1])),1),
      round(Math.abs(effectiveLevel(second[0])-effectiveLevel(second[1])),1)
    ],
    correction:!!match.fairnessCorrection
  };
}

function completeWave(context,now,waveIndex,finalWave){
  const matches=context.state.session.event.active.slice().sort((a,b)=>a.court-b.court);
  assert.strictEqual(matches.length,COURTS,`${waveIndex}회차 시작 시 세 코트가 모두 진행 중이어야 합니다.`);
  if(finalWave){
    context.state.session.event.finishMode=true;
    context.state.session.event.next=[];
    context.state.session.event.expected=[];
    context.state.session.event.serverStandby=[];
  }
  for(const match of matches){
    context.matchLog.push({
      wave:waveIndex,
      startedAt:match.startedAt,
      endedAt:now,
      type:match.type,
      playerIds:[...match.playerIds],
      t1Ids:[...match.t1Ids],
      t2Ids:[...match.t2Ids],
      ...matchQuality(context.state.session,match)
    });
    submit(context,{
      type:'official-court-complete',
      token:`complete_${waveIndex}_${match.court}`,
      matchId:match.id,
      court:match.court,
      expectedStartedAt:match.startedAt,
      expectedPlayerIds:[...match.playerIds]
    },now,`complete_${waveIndex}_${match.court}`);
    assertOperationalInvariants(context.state.session);
  }
  if(!finalWave){
    assert.strictEqual(context.state.session.event.active.length,COURTS,`${waveIndex}회차 종료 후 자동 투입으로 세 코트가 유지되어야 합니다.`);
  }else{
    assert.strictEqual(context.state.session.event.active.length,0,'13:00 마무리 뒤 진행 경기가 남으면 안 됩니다.');
  }
  const haju=context.state.session.players.find(row=>row.name===FOCUS_NAME);
  const active=context.state.session.event.active.find(row=>row.playerIds.includes(haju.id));
  const queued=context.state.session.event.next.findIndex(row=>row.playerIds.includes(haju.id));
  context.hajuTrace.push({
    atMin:waveIndex*MATCH_MINUTES,
    games:haju.games,
    fairGap:round(Number(haju.fairExpected||0)-Number(haju.games||0)-(active?1:0),3),
    state:active?`경기중(${active.seq})`:queued>=0?`다음${queued+1}`:haju.status
  });
}

function scheduleNames(seed, options={}){
  const candidates=ROSTER.map(row=>row[0]).filter(name=>name!==ACTOR_NAME&&name!==FOCUS_NAME);
  const order=shuffled(candidates,seed);
  let late=order.slice(0,5);
  let early=order.slice(5,10);
  if(options.strongLate){
    const strong=['상급03','상급22','상급36','상급07','상급17'];
    late=[...strong];
    early=order.filter(name=>!late.includes(name)).slice(0,5);
  }
  if(options.hajuLate){
    late[options.hajuLateSlot??4]=FOCUS_NAME;
    late=[...new Set(late)];
    while(late.length<5)late.push(order.find(name=>!late.includes(name)&&!early.includes(name)));
  }
  if(options.hajuEarly){
    early[options.hajuEarlySlot??2]=FOCUS_NAME;
    early=[...new Set(early)];
    while(early.length<5)early.push(order.find(name=>!early.includes(name)&&!late.includes(name)));
  }
  assert.strictEqual(new Set([...late,...early]).size,10,'지각자와 조기 종료자는 서로 달라야 합니다.');
  return {late,early};
}

function summarize(context,options){
  const session=context.state.session;
  const lateSet=new Set(options.lateNames);
  const earlySet=new Set(options.earlyNames);
  const rows=session.players.map(player=>({
    name:player.name,
    grade:player.grade,
    gender:player.gender,
    effective:effectiveLevel(player),
    group:lateSet.has(player.name)?'지각':earlySet.has(player.name)?'조기종료':'전체참석',
    games:player.games,
    mixed:player.mixedGames,
    fairExpected:round(player.fairExpected,3),
    fairGap:round(Number(player.fairExpected||0)-Number(player.games||0),3)
  }));
  const regular=rows.filter(row=>row.group==='전체참석');
  const haju=rows.find(row=>row.name===FOCUS_NAME);
  const qualities=context.matchLog;
  const partnerPairs=new Map();
  for(const match of qualities){
    for(const team of [match.t1Ids,match.t2Ids]){
      const key=[...team].sort().join('|');
      partnerPairs.set(key,(partnerPairs.get(key)||0)+1);
    }
  }
  const typeCounts=qualities.reduce((acc,row)=>{
    acc[row.type]=(acc[row.type]||0)+1;
    return acc;
  },{});
  return {
    label:options.label,
    lateNames:options.lateNames,
    earlyNames:options.earlyNames,
    rows,
    regular:{
      count:regular.length,
      min:Math.min(...regular.map(row=>row.games)),
      median:median(regular.map(row=>row.games)),
      max:Math.max(...regular.map(row=>row.games)),
      maxFairGap:Math.max(...regular.map(row=>row.fairGap)),
      minFairGap:Math.min(...regular.map(row=>row.fairGap))
    },
    haju,
    hajuTrace:context.hajuTrace,
    quality:{
      games:qualities.length,
      avgTeamDiff:round(qualities.reduce((sum,row)=>sum+row.teamDiff,0)/qualities.length,3),
      maxTeamDiff:Math.max(...qualities.map(row=>row.teamDiff)),
      maxPartnerGap:Math.max(...qualities.flatMap(row=>row.partnerGaps)),
      corrections:qualities.filter(row=>row.correction).length,
      maxPartnerRepeat:Math.max(...partnerPairs.values()),
      typeCounts
    }
  };
}

function runScenario(options){
  const root=makeRoot(options);
  const context={
    state:root.current,actorId:root.actorId,grant:root.grant,
    operationIndex:1,matchLog:[],hajuTrace:[]
  };
  startInitialMatches(context);
  {
    const haju=playerByName(context,FOCUS_NAME);
    const active=context.state.session.event.active.find(row=>row.playerIds.includes(haju.id));
    const queued=context.state.session.event.next.findIndex(row=>row.playerIds.includes(haju.id));
    context.hajuTrace.push({atMin:0,games:0,fairGap:round(Number(haju.fairExpected||0)-(active?1:0),3),state:active?`경기중(${active.seq})`:queued>=0?`다음${queued+1}`:haju.status});
  }
  const arrivalSlots=[1,2,3,4,5];
  const departureSlots=[5,6,7,8,9];
  for(let wave=1;wave<=WAVES;wave++){
    const now=BASE_NOW+wave*MATCH_MINUTES*60_000;
    const arrivalIndex=arrivalSlots.indexOf(wave);
    if(arrivalIndex>=0)arrival(context,options.lateNames[arrivalIndex],now-2000);
    const departureIndex=departureSlots.indexOf(wave);
    if(departureIndex>=0)leave(context,options.earlyNames[departureIndex],now-1000);
    completeWave(context,now,wave,wave===WAVES);
  }
  const result=summarize(context,options);
  result.issues=[];
  assert.strictEqual(result.quality.games,COURTS*WAVES,'총 30경기가 완료되어야 합니다.');
  assert(result.quality.maxTeamDiff<=TEAM_DIFF_LIMIT,'완료 경기의 팀 실력차가 하드 제한을 넘었습니다.');
  assert(result.quality.maxPartnerGap<=PARTNER_GAP_CORRECTION_LIMIT,'완료 경기의 파트너 실력차가 보정 한도를 넘었습니다.');
  if(result.regular.max-result.regular.min>2)result.issues.push('전체 참석자 경기 수 차이가 2경기를 넘음');
  if(result.regular.maxFairGap>FAIR_FORCE_GAP+0.35)result.issues.push(`전체 참석자 최대 기회차 ${result.regular.maxFairGap}`);
  if(result.haju.group==='전체참석'){
    if(result.haju.games<result.regular.median-1)result.issues.push('희소 S급이 전체 참석 중앙값보다 두 경기 이상 적음');
    if(result.haju.games<3)result.issues.push('희소 S급 전체 참석 경기 수가 3 미만');
  }
  return result;
}

function printScenario(result){
  console.log(`\n[${result.label}]`);
  console.log(`지각: ${result.lateNames.join(', ')}`);
  console.log(`조기종료: ${result.earlyNames.join(', ')}`);
  console.log(`전체참석 경기수 min/median/max: ${result.regular.min}/${result.regular.median}/${result.regular.max}`);
  console.log(`희소 S급: ${result.haju.games}경기, 혼복 ${result.haju.mixed}, 공정차 ${result.haju.fairGap}, 상태 ${result.haju.group}`);
  console.log(`희소 S급 흐름: ${result.hajuTrace.map(row=>`${row.atMin}분 ${row.state}/${row.games}경기/차${row.fairGap}`).join(' -> ')}`);
  console.log(`품질: 평균 팀차 ${result.quality.avgTeamDiff}, 최대 팀차 ${result.quality.maxTeamDiff}, 최대 파트너차 ${result.quality.maxPartnerGap}, 보정 ${result.quality.corrections}경기, 파트너 최대반복 ${result.quality.maxPartnerRepeat}`);
  const sorted=[...result.rows].sort((a,b)=>a.games-b.games||b.fairGap-a.fairGap||a.name.localeCompare(b.name,'ko'));
  console.log(sorted.map(row=>`${row.name}:${row.games}(${row.group},기회차 ${row.fairGap})`).join(' | '));
}

function scenario(label,idSeed,schedule){
  return runScenario({label,idSeed,hajuGender:'M',lateNames:schedule.late,earlyNames:schedule.early});
}

const primary=scenario('기본 실전 배치',17,scheduleNames(20260801));
const strongLate=scenario('A/B 상위권 5명 지각',31,scheduleNames(20260802,{strongLate:true}));
const hajuLate=scenario('희소 S급 11:30 도착',47,scheduleNames(20260803,{hajuLate:true,hajuLateSlot:3}));
const hajuEarly=scenario('희소 S급 12:15 조기종료',59,scheduleNames(20260804,{hajuEarly:true,hajuEarlySlot:2}));
const randomScenarios=Array.from({length:12},(_,index)=>{
  const seed=index+1;
  return scenario(`무작위 운영 ${seed}`,300+seed,scheduleNames(91000+seed));
});
const results=[primary,strongLate,hajuLate,hajuEarly,...randomScenarios];

results.forEach(result=>{
  assert.deepStrictEqual(result.issues,[],`${result.label}: ${result.issues.join(', ')}`);
});
assert(primary.haju.games>=3,'희소 S급이 전체 참석하면 13:00까지 최소 세 경기를 보장해야 합니다.');
assert(strongLate.haju.games>=3,'상위권 선수들이 늦어도 희소 S급에게 최소 세 경기를 보장해야 합니다.');
assert(hajuLate.haju.games>=2,'희소 S급이 11:30에 도착해도 남은 90분 동안 두 경기는 배정해야 합니다.');
assert(hajuEarly.haju.games>=2,'희소 S급이 12:15에 조기 종료해도 앞선 105분 동안 두 경기는 배정해야 합니다.');

const hajuGames=randomScenarios.map(row=>row.haju.games);
const maxRegularSpread=Math.max(...randomScenarios.map(row=>row.regular.max-row.regular.min));
assert(Math.min(...hajuGames)>=3,'명단 ID와 지각·조기종료 순서가 바뀌어도 전체 참석 희소 S급은 세 경기 이상이어야 합니다.');
assert(maxRegularSpread<=2,'전체 참석자의 출전 횟수 차이는 두 경기 이하여야 합니다.');
console.log(`daily 36p 150m regression ok: 희소 S급 ${Math.min(...hajuGames)}~${Math.max(...hajuGames)}경기, 전체 참석 격차 ${maxRegularSpread}`);
