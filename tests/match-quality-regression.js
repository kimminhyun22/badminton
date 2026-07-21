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

const player=(level,gender='M',ageGroup='20대')=>({level,gender,ageGroup});
assert.strictEqual(q.effectiveLevel(player(4,'M','20대')),4);
assert.strictEqual(q.effectiveLevel(player(4,'F','20대')),3.5);
assert.strictEqual(q.effectiveLevel(player(4,'남','40대')),3.5);
assert.strictEqual(q.effectiveLevel(player(4,'여','60대+')),1.5);
assert.strictEqual(q.teamDiff([player(4),player(3)],[player(3),player(3)]),1);
assert(q.teamDiffPenalty(2.1)>q.teamDiffPenalty(1.9),'팀 실력차 2 초과는 강하게 회피해야 합니다.');
assert.strictEqual(q.partnerRepeatPenalty(0),0);
assert.strictEqual(q.partnerRepeatPenalty(1),140);
assert.strictEqual(q.partnerRepeatPenalty(2),1200);
assert.strictEqual(q.partnerRepeatPenalty(1,'pool'),120);
assert.strictEqual(q.partnerRepeatPenalty(2,'pool'),900);
assert(Number.isFinite(q.partnerRepeatPenalty(3))&&q.partnerRepeatPenalty(3)>=1e9,'소수 인원에서도 대진은 멈추지 않는 유한 최후 패널티여야 합니다.');
assert.strictEqual(q.opponentRepeatPenalty(4),1e9);

assert(indexHtml.indexOf('js/match-quality.js')<indexHtml.indexOf('js/daily.js'),'민턴LIVE보다 공통 품질 정책을 먼저 로드해야 합니다.');
assert(teamHtml.indexOf('js/match-quality.js')<teamHtml.indexOf('js/team.js'),'팀전LIVE보다 공통 품질 정책을 먼저 로드해야 합니다.');
assert(sw.includes('/badminton/js/match-quality.js'),'공통 품질 정책을 오프라인 캐시에 포함해야 합니다.');
assert(dailySrc.includes("MATCH_QUALITY.partnerRepeatPenalty(pc,'pool')"),'민턴LIVE 후보군의 파트너 반복 정책도 공통 기준을 사용해야 합니다.');
assert(dailySrc.includes('_dailyPartnerRepeatPenalty(t1[0].partnerCount'),'민턴LIVE 실제 팀 조합에 단계형 파트너 반복 감점을 적용해야 합니다.');
assert(dailySrc.includes('_dailyExactRepeatPenalty(_dailyExactRepeatCount(m))'),'민턴LIVE는 같은 네 명과 완전히 같은 팀 구성을 구분해 회피해야 합니다.');
assert(teamSrc.includes('MATCH_QUALITY.partnerRepeatPenalty(count)'),'팀전LIVE 실제 조합도 공통 반복 정책을 사용해야 합니다.');

function sourceBetween(src,startName,nextName){
  const start=src.indexOf(`function ${startName}`);
  const end=src.indexOf(`function ${nextName}`,start+1);
  assert(start>=0&&end>start,`${startName} 함수 범위를 찾을 수 있어야 합니다.`);
  return src.slice(start,end);
}

const formSandbox={KokMatchQuality:q};
vm.createContext(formSandbox);
vm.runInContext(`
const MATCH_QUALITY=KokMatchQuality;
function effLevel(player){return MATCH_QUALITY.effectiveLevel(player);}
function _dailyTeamDiffPenalty(diff){return MATCH_QUALITY.teamDiffPenalty(diff);}
function _dailyPartnerLevelGapPenalty(team){return MATCH_QUALITY.partnerGapPenalty(team);}
function _dailyPartnerRepeatPenalty(count){return MATCH_QUALITY.partnerRepeatPenalty(count);}
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

console.log('match quality regression ok');
