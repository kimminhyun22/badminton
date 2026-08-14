const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.join(__dirname,'..');
const policySrc=fs.readFileSync(path.join(root,'js','match-quality.js'),'utf8');
const dailySrc=fs.readFileSync(path.join(root,'js','daily.js'),'utf8');
const teamSrc=fs.readFileSync(path.join(root,'js','team.js'),'utf8');
const indexHtml=fs.readFileSync(path.join(root,'index.html'),'utf8');
const teamHtml=fs.readFileSync(path.join(root,'team.html'),'utf8');
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');

const sandbox={};
vm.createContext(sandbox);
vm.runInContext(policySrc,sandbox,{filename:'match-quality.js'});
const q=sandbox.KokMatchQuality;
assert(q,'공통 대진 품질 API가 전역에 공개되어야 합니다.');
assert(Object.isFrozen(q),'공통 대진 품질 API는 실행 중 바뀌지 않아야 합니다.');
assert.strictEqual(q.constants.partnerGapCorrectionLimit,4.5,'공정 보정에서만 사용하는 파트너 차이 완화 상한을 공통 정책으로 유지해야 합니다.');
assert.strictEqual(q.constants.partnerGapSymmetryLimit,1.5,'보통 대진의 양 팀 파트너 격차 차이는 공통 상한을 사용해야 합니다.');

const player=(level,gender='M',ageGroup='20대')=>({level,gender,ageGroup});
assert.strictEqual(q.effectiveLevel(player(4,'M','20대')),4);
assert.strictEqual(q.effectiveLevel(player(4,'F','20대')),3.5);
assert.strictEqual(q.effectiveLevel(player(4,'남','40대')),3.5);
assert.strictEqual(q.effectiveLevel(player(4,'여','60대+')),1.5);
assert.strictEqual(q.teamDiff([player(4),player(3)],[player(3),player(3)]),1);
assert.strictEqual(q.partnerGapSymmetry([player(7),player(5)],[player(6),player(6)]),2);
assert(q.teamDiffPenalty(2.1)>q.teamDiffPenalty(1.9),'팀 실력차 2 초과는 강하게 회피해야 합니다.');
assert.strictEqual(q.partnerRepeatPenalty(0),0);
assert.strictEqual(q.partnerRepeatPenalty(1),240);
assert.strictEqual(q.partnerRepeatPenalty(2),1400);
// 반복 회피는 '경기 수 1경기 차이'(170점)보다 비싸야 같은 얼굴이 계속 붙지 않습니다.
assert(q.partnerRepeatPenalty(1)>170,'파트너 재조합은 한 경기 출전 차이보다 비싸야 합니다.');
assert(q.opponentRepeatPenalty(3)*4>170*3,'같은 상대를 네 번째 만나는 값은 출전 차이 몇 경기보다 비싸야 합니다.');
assert.strictEqual(q.partnerRepeatPenalty(1,'pool'),120);
assert.strictEqual(q.partnerRepeatPenalty(2,'pool'),900);
assert(Number.isFinite(q.partnerRepeatPenalty(3))&&q.partnerRepeatPenalty(3)>=1e9,'소수 인원에서도 대진은 멈추지 않는 유한 최후 패널티여야 합니다.');
assert.strictEqual(q.opponentRepeatPenalty(4),1e9);

assert(indexHtml.indexOf('js/match-quality.js')<indexHtml.indexOf('js/daily.js'),'민턴LIVE보다 공통 품질 정책을 먼저 로드해야 합니다.');
assert(teamHtml.indexOf('js/match-quality.js')<teamHtml.indexOf('js/team.js'),'팀전보다 공통 품질 정책을 먼저 로드해야 합니다.');
assert(sw.includes('/badminton/js/match-quality.js'),'공통 품질 정책을 오프라인 캐시에 포함해야 합니다.');
assert(dailySrc.includes("MATCH_QUALITY.partnerRepeatPenalty(pc,'pool')"),'민턴LIVE 후보군의 파트너 반복 정책도 공통 기준을 사용해야 합니다.');
assert(dailySrc.includes('_dailyPartnerRepeatPenalty(t1[0].partnerCount'),'민턴LIVE 실제 팀 조합에 단계형 파트너 반복 감점을 적용해야 합니다.');
assert(dailySrc.includes('_dailyExactRepeatPenalty(_dailyExactRepeatCount(m))'),'민턴LIVE는 같은 네 명과 완전히 같은 팀 구성을 구분해 회피해야 합니다.');
assert(teamSrc.includes('MATCH_QUALITY.partnerRepeatPenalty(count)'),'팀전 실제 조합도 공통 반복 정책을 사용해야 합니다.');

function sourceBetween(src,startName,nextName){
  const start=src.indexOf(`function ${startName}`);
  const end=src.indexOf(`function ${nextName}`,start+1);
  const endAsync = end >= 6 && src.slice(end-6, end) === 'async ' ? end-6 : end;
  assert(start>=0&&end>start,`${startName} 함수 범위를 찾을 수 있어야 합니다.`);
  return src.slice(start,endAsync);
}

assert(dailySrc.includes('pickFairnessCorrection'),'관리자 앱의 로컬 대진도 서버와 같은 공정 보정 단계를 사용해야 합니다.');
assert(dailySrc.includes("m.correctionReason='fairness-partner-gap'"),'파트너 차이 완화는 공정 보정 대진으로만 표시되어야 합니다.');
const correctionPolicySandbox={
  KokMatchQuality:q,
  DAILY_PARTNER_GAP_HARD:q.constants.partnerGapHard,
  DAILY_PARTNER_GAP_CORRECTION_LIMIT:q.constants.partnerGapCorrectionLimit,
  DAILY_PARTNER_GAP_SYMMETRY_LIMIT:q.constants.partnerGapSymmetryLimit,
  DAILY_FAIR_FORCE_GAP:1
};
vm.createContext(correctionPolicySandbox);
vm.runInContext(`
function _dailyPartnerLevelGap(team){return KokMatchQuality.partnerGap(team);}
function _dailyFairGap(player){return Number(player&&player.fairGap||0);}
${sourceBetween(dailySrc,'_dailyMatchMaxPartnerGap','_dailyMatchLevelSpreadPenalty')}
this.allowed=_dailyMatchPartnerGapOfficialOk;
`,correctionPolicySandbox,{filename:'daily-correction-policy.js'});
const correctionCandidate={
  team1A:player(7),team1B:player(3),
  team2C:player(5),team2D:player(5)
};
assert.strictEqual(correctionPolicySandbox.allowed(correctionCandidate),false,'일반 대진은 기존 파트너 차이 제한을 유지해야 합니다.');
assert.strictEqual(correctionPolicySandbox.allowed({...correctionCandidate,fairnessCorrection:true}),true,'공정 보정 대진만 파트너 차이를 완화해야 합니다.');
assert.strictEqual(correctionPolicySandbox.allowed({
  team1A:player(7),team1B:player(1),
  team2C:player(4),team2D:player(4),
  fairnessCorrection:true
}),false,'공정 보정이어도 완화 상한을 넘는 파트너 조합은 허용하면 안 됩니다.');
const asymmetricCandidate={
  team1A:player(7),team1B:player(5),
  team2C:player(6),team2D:player(6)
};
assert.strictEqual(correctionPolicySandbox.allowed(asymmetricCandidate),false,'합산이 같아도 양 팀 파트너 격차가 크게 다르면 보통 대진에서 제외해야 합니다.');
assert.strictEqual(correctionPolicySandbox.allowed({
  ...asymmetricCandidate,
  team1A:{...asymmetricCandidate.team1A,fairGap:1}
}),true,'경기 기회가 한 경기 이상 부족한 선수는 파트너 격차 대칭보다 출전 보장을 우선해야 합니다.');
assert.strictEqual(correctionPolicySandbox.allowed({...asymmetricCandidate,reservationId:'pair-1'}),true,'지정 파트너 요청은 새 대칭 제한으로 취소하면 안 됩니다.');

const formSandbox={KokMatchQuality:q};
vm.createContext(formSandbox);
vm.runInContext(`
const MATCH_QUALITY=KokMatchQuality;
function effLevel(player){return MATCH_QUALITY.effectiveLevel(player);}
function _dailyTeamDiffPenalty(diff){return MATCH_QUALITY.teamDiffPenalty(diff);}
function _dailyPartnerLevelGapPenalty(team){return MATCH_QUALITY.partnerGapPenalty(team);}
function _dailyPartnerRepeatPenalty(count){return MATCH_QUALITY.partnerRepeatPenalty(count);}
function _dailyPartnerLevelGap(team){return MATCH_QUALITY.partnerGap(team);}
const DAILY_PARTNER_GAP_SYMMETRY_LIMIT=MATCH_QUALITY.constants.partnerGapSymmetryLimit;
const DAILY_PARTNER_GAP_CAUTION=MATCH_QUALITY.constants.partnerGapCaution;
${sourceBetween(dailySrc,'pairGapAsymmetryPenalty','_dailyPartnerLevelGapPenalty')}
${sourceBetween(dailySrc,'_matchGenderErrorCount','_participationSlotStats')}
${sourceBetween(dailySrc,'formTeams','updatePlayerRecords')}
this.formTeams=formTeams;
`,formSandbox,{filename:'daily-form-teams.js'});

const livePlayer=name=>({
  name,level:4,gender:'M',ageGroup:'20대',partnerName:'',
  partnerCount:{},opponentCount:{}
});
const repeated=['A','B','C','D'].map(livePlayer);
repeated[0].partnerCount.B=2;repeated[1].partnerCount.A=2;
repeated[2].partnerCount.D=2;repeated[3].partnerCount.C=2;
const diversified=formSandbox.formTeams(repeated,false,'men',99,true);
const diversifiedTeams=[
  [diversified.team1A.name,diversified.team1B.name].sort().join(''),
  [diversified.team2C.name,diversified.team2D.name].sort().join('')
];
assert(!diversifiedTeams.includes('AB')&&!diversifiedTeams.includes('CD'),'민턴LIVE는 반복 파트너보다 가능한 새 파트너 조합을 골라야 합니다.');

const tinyPool=['A','B','C','D'].map(livePlayer);
tinyPool.forEach(a=>tinyPool.forEach(b=>{if(a!==b){a.partnerCount[b.name]=3;a.opponentCount[b.name]=4;}}));
assert(formSandbox.formTeams(tinyPool,false,'men',99,true),'네 명뿐인 상황은 반복이 불가피해도 대진을 생성해야 합니다.');

const fixedPair=['A','B','C','D'].map(livePlayer);
fixedPair[0].partnerName='B';fixedPair[1].partnerName='A';
fixedPair[0].partnerCount.B=3;fixedPair[1].partnerCount.A=3;
const fixedMatch=formSandbox.formTeams(fixedPair,false,'men',99,false);
assert.deepStrictEqual([fixedMatch.team1A.name,fixedMatch.team1B.name].sort(),['A','B'],'사전 지정 파트너는 반복 회피보다 우선해야 합니다.');

const women=['여A','여B','여C','여D'].map(name=>({...livePlayer(name),gender:'F'}));
assert.strictEqual(formSandbox.formTeams(women,false,'any',99,true).type,'여복','여성 4명은 여복으로 편성해야 합니다.');
const mixed=[
  {...livePlayer('남A'),gender:'M'},
  {...livePlayer('여A'),gender:'F'},
  {...livePlayer('남B'),gender:'M'},
  {...livePlayer('여B'),gender:'F'}
];
assert.strictEqual(formSandbox.formTeams(mixed,false,'any',99,true).type,'혼복','남녀 각 2명은 양 팀에 한 명씩 나눠 혼복으로 편성해야 합니다.');
const mixedWithRepeatedPairs=[
  {...livePlayer('남1'),gender:'M'},
  {...livePlayer('남2'),gender:'M'},
  {...livePlayer('여1'),gender:'F'},
  {...livePlayer('여2'),gender:'F'}
];
for(const man of mixedWithRepeatedPairs.slice(0,2)){
  for(const woman of mixedWithRepeatedPairs.slice(2)){
    man.partnerCount[woman.name]=2;
    woman.partnerCount[man.name]=2;
  }
}
assert.strictEqual(formSandbox.formTeams(mixedWithRepeatedPairs,false,'any',99,true).type,'혼복','남남 대 여여 점수가 더 좋아도 유효한 혼복 조합을 버리면 안 됩니다.');

console.log('match quality regression ok');
