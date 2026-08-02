const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.join(__dirname,'..');
const dailySrc=fs.readFileSync(path.join(root,'js','daily.js'),'utf8');

function sourceBetween(startName,nextName){
  const start=dailySrc.indexOf(`function ${startName}`);
  const end=dailySrc.indexOf(`function ${nextName}`,start+1);
  assert(start>=0&&end>start,`${startName} 함수 범위를 찾을 수 있어야 합니다.`);
  return dailySrc.slice(start,end);
}

const scoringSandbox={
  DAILY_LATE_GRACE_MIN:5,
  DAILY_LATE_PRIORITY_GAMES:2,
  DAILY_RECENT_RECOVERY_MIN:12,
  _dailyFirstMatchStartedAt:()=>1_000_000,
  _dailyRecentRecoveryMinutes:()=>12,
  _dailyMinutes:()=>0
};
vm.createContext(scoringSandbox);
vm.runInContext(`
${sourceBetween('_dailyLatePriorityInfo','_dailyLatePriorityBonus')}
${sourceBetween('_dailyLatePriorityBonus','_dailySessionLateStage')}
this.api={lateInfo:_dailyLatePriorityInfo,lateBonus:_dailyLatePriorityBonus};
`,scoringSandbox,{filename:'daily-real-world-scoring.js'});

const onTime={joinedAt:999_000,games:0,mixedGames:0};
const lateFirst={joinedAt:1_600_000,games:0,mixedGames:0};
const lateSecond={joinedAt:1_600_000,games:1,mixedGames:0};
const caughtUp={joinedAt:1_600_000,games:2,mixedGames:0};
assert.strictEqual(scoringSandbox.api.lateBonus(onTime),0,'정시 참가자는 지각 보정을 받지 않아야 합니다.');
assert(scoringSandbox.api.lateBonus(lateFirst)>scoringSandbox.api.lateBonus(lateSecond),'지각자의 첫 경기를 두 번째 경기보다 더 강하게 우선해야 합니다.');
assert(scoringSandbox.api.lateBonus(lateSecond)>0,'지각자는 두 번째 경기까지 우선 보정을 받아야 합니다.');
assert.strictEqual(scoringSandbox.api.lateBonus(caughtUp),0,'지각 보정은 두 경기를 채운 뒤 끝나야 합니다.');
assert.strictEqual(scoringSandbox.api.lateInfo({joinedAt:1_299_000,games:0}).late,false,'첫 경기 후 4분 59초 이내 등록은 지각 보정 대상이 아니어야 합니다.');
assert.strictEqual(scoringSandbox.api.lateInfo({joinedAt:1_300_000,games:0}).late,true,'첫 경기 후 5분부터 지각 보정 대상이어야 합니다.');
assert(scoringSandbox.api.lateBonus({joinedAt:4_600_000,games:0})<=240,'지각자 첫 경기 보정은 240점을 넘지 않아야 합니다.');
assert(scoringSandbox.api.lateBonus({joinedAt:4_600_000,games:1})<=150,'지각자 두 번째 경기 보정은 150점을 넘지 않아야 합니다.');
scoringSandbox._dailyRecentRecoveryMinutes=()=>11;
assert.strictEqual(scoringSandbox.api.lateBonus(lateSecond),0,'지각 보정이 12분 회복시간을 무시해 연속 출전을 유발하면 안 됩니다.');

// 종목 방침(2026-08-02 운영자 결정): 남복·여복이 기본, 혼복은 동성복식이
// 안 될 때나 운동 후반에만. 개인별 혼복 쿼터는 폐기했습니다.
assert(dailySrc.includes('const DAILY_MIXED_PENALTY_EARLY=3200;'),'전반 혼복 감점은 3,200점이어야 합니다.');
assert(dailySrc.includes('const DAILY_MIXED_PENALTY_LATE=0;'),'후반에는 혼복 감점을 풀어야 합니다.');
assert(!dailySrc.includes('_dailyMixedQuotaPenalty'),'개인별 혼복 쿼터는 남아 있으면 안 됩니다.');
// 혼복 감점이 경기 수 균등 보정(최대 5,600)을 넘으면 종목 맞추다 대기자가 밀립니다.
assert(3200 < 5600,'혼복 감점은 경기 수 균등 보정보다 작아야 합니다.');

const scoreSource=sourceBetween('_dailyScoreMatch','dailyRecommend');
assert(scoreSource.includes('score-=Math.min(360,latePriorityTotal)'),'한 경기의 지각 보정 합계는 360점으로 제한되어야 합니다.');
assert(scoreSource.includes('_dailyMixedTypePenalty()'),'실제 LIVE 점수식에 종목 선호가 연결되어야 합니다.');
assert(scoreSource.includes('behind/DAILY_FAIR_FORCE_GAP'),'출전이 밀린 사람이 있으면 혼복 감점을 풀어야 합니다(경기 수 균등 우선).');
assert(dailySrc.includes("mixedGames:(p.mixedGames||0)+(active.match.type==='혼복'?1:0)"),'진행 중 혼복도 예상 대진의 개인별 횟수에 반영되어야 합니다.');
assert(dailySrc.includes('typeTrackedGames:(p.typeTrackedGames||0)+1'),'예상 대진은 유형을 확인할 수 있는 경기만 종목 집계에 포함해야 합니다.');
assert(dailySrc.includes("if(m.type==='혼복')p.mixedGames=(p.mixedGames||0)+1"),'혼복 완료 시 개인별 혼복 횟수를 기록해야 합니다.');
assert(dailySrc.includes('_dailyRebuildLiveTypeCounts();'),'기존 저장본을 불러올 때 완료 대진으로 혼복 횟수를 복구해야 합니다.');
assert(dailySrc.includes('const DAILY_FAIR_FORCE_GAP=1;'),'1경기 기회 차부터 부족 선수를 정상 품질 대진에 강제 포함해야 합니다.');
assert(dailySrc.includes('const DAILY_FAIR_CORRECTION_GAP=1.5;'),'파트너 급수 완화는 1.5경기 차부터만 허용해야 합니다.');
assert(dailySrc.includes('pick(eligible.length>=8,urgent.id,eligible)'),'부족 선수와 맞는 조합은 상위 22명뿐 아니라 전체 대기자에서 찾아야 합니다.');
assert(dailySrc.includes('_dailyFairGap(urgent)>=DAILY_FAIR_CORRECTION_GAP'),'정상 품질 대진을 먼저 찾고 별도 보정 기준에 도달한 경우에만 급수 제한을 완화해야 합니다.');

const rebuildCalls=[];
const arrivalSandbox={
  _dailyNormalizeStatus:s=>s,
  _dailyNow:()=>2_000_000,
  _dailyFinishMode:false,
  _dailyMarkLiveAddition:()=>{},
  _dailyLatePriorityInfo:()=>({late:true}),
  _dailyNext:null,
  dailyRebuildQueue:options=>rebuildCalls.push(options)
};
vm.createContext(arrivalSandbox);
vm.runInContext(`${sourceBetween('_dailyApplyPlayerStatus','_dailySetAfterMatchStatus')};this.apply=_dailyApplyPlayerStatus;`,arrivalSandbox);
const invited={status:'invited',joinedAt:1_000_000};
arrivalSandbox.apply(invited,'wait');
assert.strictEqual(invited.joinedAt,2_000_000,'등록 전 선수를 참가로 바꾼 시각을 실제 도착시각으로 기록해야 합니다.');
assert.strictEqual(rebuildCalls[0].preserveCount,1,'지각자 도착 시 이미 안내된 1순위만 유지하고 뒤 예비 대진을 재구성해야 합니다.');
const returning={status:'rest',joinedAt:1_000_000};
rebuildCalls.length=0;
arrivalSandbox.apply(returning,'wait');
assert.strictEqual(returning.joinedAt,1_000_000,'휴식 후 복귀는 최초 도착시각을 바꾸면 안 됩니다.');
assert.strictEqual(rebuildCalls.length,0,'휴식 복귀를 새 지각 도착으로 처리하면 안 됩니다.');

const cancelledReservations=[];
const afterMatchSandbox={
  _dailyNormalizeStatus:s=>s,_dailyNow:()=>3_000_000,_dailyNext:{},
  _dailyCheckinStatusLabel:s=>s,
  _dailyCancelReservationsForPlayer:(id,reason)=>cancelledReservations.push({id,reason})
};
vm.createContext(afterMatchSandbox);
vm.runInContext(`${sourceBetween('_dailySetAfterMatchStatus','_dailyApplyQueueYield')};this.setAfter=_dailySetAfterMatchStatus;`,afterMatchSandbox);
const leavingPlayer={id:'p1',name:'귀가선수',status:'playing',currentMatchId:'m1',lastStatusAt:1};
assert.strictEqual(afterMatchSandbox.setAfter(leavingPlayer,'done'),true,'경기중 선수도 경기 후 종료를 미리 표시할 수 있어야 합니다.');
assert.strictEqual(leavingPlayer.status,'playing','경기 후 종료 표시는 현재 진행 경기를 중단하면 안 됩니다.');
assert.strictEqual(leavingPlayer.afterMatchStatus,'done','경기 완료 순간 적용할 종료 상태를 보관해야 합니다.');
assert.strictEqual(cancelledReservations.length,1,'경기 후 종료를 표시하면 남아 있는 게임신청을 즉시 취소해야 합니다.');
assert(sourceBetween('_dailyProjectedCandidatePlayers','_dailyBalancePolicyText').includes('p.afterMatchStatus'),'경기 후 종료 예정자는 예상 대진에서도 즉시 제외해야 합니다.');
assert(sourceBetween('_dailyLatestPendingStatusRequest','_dailyConsumeDeferredStatusRequest').includes("startsWith('official-')"),'검증 전 임원 요청을 일반 경기 후 상태 요청으로 소비하면 안 됩니다.');

const statusSource=sourceBetween('dailySetStatus','dailyStartPair');
const replaceAt=statusSource.indexOf('_dailyTryReplaceQueuedPlayer');
const applyAt=statusSource.indexOf('_dailyApplyPlayerStatus');
assert(replaceAt>=0&&applyAt>replaceAt,'귀가 처리는 상태를 닫기 전에 예비 대진 교체를 먼저 시도해야 합니다.');
assert(sourceBetween('_dailyTryReplaceQueuedPlayer','_dailyRemoveQueuedPlayer').includes('_dailyRecalcQueueItem'),'귀가자 교체 뒤 팀 밸런스와 종목을 다시 계산해야 합니다.');
assert(sourceBetween('_dailyTryReplaceQueuedPlayer','_dailyRemoveQueuedPlayer').includes('preserveReservation'),'파트너 당사자가 아닌 상대 교체는 파트너 지정과 배지를 유지해야 합니다.');
assert(sourceBetween('_dailyRemoveQueuedPlayer','dailyEditQueuePlayer').includes('_dailyQueue.filter'),'교체가 불가능하면 귀가자가 든 예비 대진을 제거해야 합니다.');

const partnerRepairSandbox={
  _dailyReservations:[{id:'pair-request',mode:'pair',team1:['pair-a','pair-b'],team2:[]}],
  _dailyQueue:[],
  cancelCalls:0,
  _dailyReservationIds:r=>[...(r.team1||[]),...(r.team2||[])],
  _dailyFindQueueReplacement:()=>null,
  _dailyCancelReservationById(){this.cancelCalls++;},
  _dailyClearReservationQueueMeta(q){q.reservationId=null;},
  _dailyRecalcQueueItem:q=>q
};
const localPartnerQueue={
  id:'q-partner',
  team1:['pair-a','pair-b'],
  team2:['leaving-opponent','other-opponent'],
  reservationId:'pair-request',
  reservationLabel:'지정 파트너',
  reservationMode:'pair',
  reservationAttachedExisting:true,
  reservationOriginalTeam1Ids:['pair-a','leaving-opponent'],
  reservationOriginalTeam2Ids:['pair-b','other-opponent']
};
partnerRepairSandbox._dailyQueue=[localPartnerQueue];
partnerRepairSandbox._dailyFindQueueReplacement=()=>({
  loc:{q:localPartnerQueue,side:'team2',pos:0},
  candidate:{id:'replacement-opponent'},
  source:'free'
});
vm.createContext(partnerRepairSandbox);
vm.runInContext(`${sourceBetween('_dailyTryReplaceQueuedPlayer','_dailyRemoveQueuedPlayer')};this.replace=_dailyTryReplaceQueuedPlayer;`,partnerRepairSandbox);
assert.strictEqual(partnerRepairSandbox.replace('leaving-opponent','조기 종료'),true,'관리자 원본에서도 파트너 대진 상대를 교체할 수 있어야 합니다.');
assert.strictEqual(localPartnerQueue.reservationId,'pair-request','상대 교체가 파트너 지정 배지를 없애면 안 됩니다.');
assert.deepStrictEqual(localPartnerQueue.team1,['pair-a','pair-b'],'상대 교체 뒤 지정 파트너 같은 편을 유지해야 합니다.');
assert(localPartnerQueue.reservationOriginalTeam1Ids.includes('replacement-opponent'),'파트너 취소용 원래 팀도 교체 선수로 갱신해야 합니다.');
assert(!localPartnerQueue.reservationOriginalTeam1Ids.includes('leaving-opponent'),'파트너 취소 시 종료 선수를 되살리면 안 됩니다.');
assert.strictEqual(partnerRepairSandbox.cancelCalls,0,'예약 당사자가 아닌 상대 교체는 파트너 예약을 취소하면 안 됩니다.');

console.log('daily real-world regression ok');
