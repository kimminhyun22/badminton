'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.join(__dirname,'..'),src=fs.readFileSync(path.join(root,'js/team.js'),'utf8');
function build(mutate=false){
 const c={};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'js/match-quality.js'),'utf8'),c);
 const cut=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)+a.length));
 let repair=cut('function _teamImproveRoundDiversity(','function shuffleArray(');
 if(mutate)repair=repair.replace('next.sBalance>=quality.sBalance-1e-9','next.sBalance>quality.sBalance+0.001');
 vm.runInContext(src.split('let _currentRound=1;')[0]+cut('function _matchGenderErrorCount(','function formTeams(')
  +cut('function _qualityAssessment(','/* ═══ 대진 품질 대시보드')+repair,c);return c;
}
const levels=[5,5,5,5,4,4,3,2,1,4,5,5,4,4,3,3,2,5,5,4,4,3,3,2,2,6,6,5,4,4,3,3];
const games=[[3,6,18,21],[0,4,19,17],[7,5,23,20],[1,8,24,22],[12,10,29,27],[9,14,30,31],[13,11,26,28],[15,2,25,16],[6,4,20,22],[1,5,19,18],[3,7,24,17],[0,8,23,21],[13,12,29,30],[11,14,27,31],[9,10,25,28],[15,2,26,16],[6,1,21,17],[3,4,18,20],[7,5,24,19],[0,8,23,22],[9,13,29,31],[10,14,27,30],[12,11,25,28],[15,2,26,16],[0,5,20,17],[4,7,23,19],[6,1,18,22],[3,8,24,21],[9,11,29,27],[12,15,30,28],[13,10,25,31],[2,14,26,16]];
const fields=['team1A','team1B','team2C','team2D'];
function fixture(c){
 const participants=levels.map((level,i)=>({name:'E2E'+i,level,gender:i<9||(i>=16&&i<25)?'F':'M',ageGroup:[16,28].includes(i)?'79':'40대',team:i<16?'청팀':'홍팀'}));
 const matches=games.map((ids,i)=>{const m={round:Math.floor(i/4)+1,court:i%4+1,matchNumber:i+1};ids.forEach((id,k)=>m[fields[k]]=participants[id]);const females=ids.filter(id=>participants[id].gender==='F').length;m.type=females===4?'여복':females===0?'남복':'혼복';m.team1Level=c.effLevel(m.team1A)+c.effLevel(m.team1B);m.team2Level=c.effLevel(m.team2C)+c.effLevel(m.team2D);m.levelDiff=Math.round(Math.abs(m.team1Level-m.team2Level)*10)/10;return m;});
 return {participants,matches};
}
const settings={teamMode:true,gamesPerPlayer:4,courts:4};
function run(c){const x=fixture(c);
 // Isolate the equal-balance contract from the new worst-tail metric.
 x.participants.forEach(p=>{p.level=3;p.ageGroup='20대';});
 x.matches.forEach(m=>{m.team1Level=c.effLevel(m.team1A)+c.effLevel(m.team1B);m.team2Level=c.effLevel(m.team2C)+c.effLevel(m.team2D);m.levelDiff=Math.abs(m.team1Level-m.team2Level);});
 const before=c._qualityAssessment(x.matches,x.participants,settings);
 const rounds=()=>JSON.stringify(Array.from({length:8},(_,i)=>x.matches.filter(m=>m.round===i+1).flatMap(m=>fields.map(f=>m[f].name)).sort()));
 const originalRounds=rounds();c._teamImproveRoundDiversity(x,settings);const after=c._qualityAssessment(x.matches,x.participants,settings);
 assert(after.total>before.total,'Repair equal-balance diversity even through the zero-score plateau');
 assert.equal(after.avoidableExact,0);assert(after.sBalance>=before.sBalance);assert(after.avgLD<=before.avgLD+1e-9);
 assert(after.maxLD<=before.maxLD);assert(after.asymMatches.length<=before.asymMatches.length);
 assert.equal(rounds(),originalRounds);assert.deepStrictEqual(after.counts,before.counts);
 assert.equal(after.structureErr,0);assert.equal(after.genderErr,0);assert.equal(after.sInterval,before.sInterval);
 return {before:before.total,after:after.total,diversity:after.sDiversity};}
console.log('Equal-balance diversity repair',run(build()));
assert.throws(()=>run(build(true)),/Repair equal-balance diversity/,'Old strict-balance gate mutation must fail');
for(const lock of ['partner','completed','voided']){
 const c=build(),x=fixture(c);
 if(lock==='partner')x.participants.forEach(p=>p.partnerName='E2E-fixed');else x.matches.forEach(m=>{if(lock==='voided')m.voided=true;else m.win='t1';});
 const before=JSON.stringify(x);c._teamImproveRoundDiversity(x,settings);assert.equal(JSON.stringify(x),before,lock+' unchanged');
}
assert(src.includes('_teamImproveRoundDiversity(candidate,settings);'),'Wire into candidate refinement');
console.log('PASS round membership, appearance counts, fixed partners, completed games and mutation');

function refined(old=false){
 const c=build();
 let code=src.slice(src.indexOf('function _isBetterQualityKey('),src.indexOf('function shuffleArray('));
 if(old)code=code.replace('next.sBalance>=quality.sBalance&&next.maxLD<quality.maxLD-0.001&&next.avgLD<=quality.avgLD','false').replace('attempts>320','attempts>160');
 vm.runInContext(code,c);c._buildHistoryFromMatches=()=>({});
 const x=fixture(c),before=c._qualityAssessment(x.matches,x.participants,settings);
 const rounds=()=>JSON.stringify(x.matches.map(m=>fields.map(f=>m[f].name)).reduce((a,n,i)=>{const r=Math.floor(i/4);a[r]=(a[r]||[]).concat(n).sort();return a;},[]));
 const original=rounds();c._teamRefineRoundPairs(x,settings);
 const after=c._qualityAssessment(x.matches,x.participants,settings);
 assert.equal(rounds(),original);assert.deepStrictEqual(after.counts,before.counts);
 assert(after.maxLD<=before.maxLD);assert(after.balanceHardCount<=before.balanceHardCount);
 assert(after.total>=before.total-3);assert.equal(after.genderErr,0);
 for(const m of x.matches)m.win='t1';const locked=JSON.stringify(x);
 c._teamRefineRoundPairs(x,settings);assert.equal(JSON.stringify(x),locked,'Completed matches must not change in either refinement pass');
 return {total:after.total,max:after.maxLD,avg:after.avgLD};
}
const prior=refined(true),current=refined();
assert(current.max<=prior.max);console.log('Full refinement',JSON.stringify({prior,current}));

function plateau(mutate=false){
 const ps=Array.from({length:8},(_,i)=>({name:'E2E'+i,gender:'M',level:3}));
 const x={participants:ps,matches:[0,4].map(start=>Object.fromEntries([['round',1],...fields.map((f,i)=>[f,ps[start+i]])]))};
 const c={effLevel:p=>p.level,_buildHistoryFromMatches:()=>({}),_teamImproveRoundDiversity:()=>{}};
 c._qualityAssessment=ms=>({sBalance:30,total:90,maxLD:ms[0].team1A.name==='E2E4'?1.5:2,avgLD:1,avoidableExact:0});
 c._teamFinalQualityKey=ms=>[c._qualityAssessment(ms).maxLD];c._isBetterQualityKey=(a,b)=>a[0]<b[0];
 vm.createContext(c);
 let code=src.slice(src.indexOf('function _teamRefineRoundPairs('),src.indexOf('function _teamImproveRoundDiversity('));
 if(mutate)code=code.replace('next.sBalance>=quality.sBalance&&next.maxLD<quality.maxLD-0.001&&next.avgLD<=quality.avgLD','false');
 vm.runInContext(code,c);c._teamRefineRoundPairs(x,{});
 return c._qualityAssessment(x.matches).maxLD;
}
assert.equal(plateau(),1.5,'Equal rounded score must allow a smaller worst gap');
assert.equal(plateau(true),2,'Old strict score gate misses the improvement');
