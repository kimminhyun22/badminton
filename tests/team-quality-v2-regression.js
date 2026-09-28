'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.join(__dirname,'..'),src=fs.readFileSync(path.join(root,'js/team.js'),'utf8');
const c={};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'js/match-quality.js'),'utf8'),c);
const cut=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)+a.length));
vm.runInContext(src.split('let _currentRound=1;')[0]+cut('function _matchGenderErrorCount(','function formTeams(')+cut('function _qualityAssessment(','/* ═══ 대진 품질 대시보드'),c);
function fixture(count=10,bad=1){
 const participants=[],matches=[];
 for(let i=0;i<count;i++){
  const ps=Array.from({length:4},(_,j)=>({name:`E2E${i}-${j}`,gender:'M',level:j<2&&i<bad?4:3,team:j<2?'청팀':'홍팀',_goal:1}));
  participants.push(...ps);matches.push({team1A:ps[0],team1B:ps[1],team2C:ps[2],team2D:ps[3],round:1,court:i+1,type:'남복',matchNumber:i+1});
 }
 return {participants,matches};
}
function score(x,s={}){return c._qualityAssessment(x.matches,x.participants,{teamMode:false,gamesPerPlayer:1,courts:x.matches.length,...s});}
const perfect=score(fixture(10,0)),one=score(fixture(10,1)),ten=score(fixture(100,10));
assert.equal(perfect.total,100);assert.equal(perfect.sBalance,50);assert.equal(perfect.sFair,20);assert.equal(perfect.sDiversity,20);assert.equal(perfect.sInterval,10);
assert.equal(one.sBalance,ten.sBalance,'Same risk distribution must not be penalized by event size');
assert(one.sBalance<perfect.sBalance);assert(!perfect.gradeLabel.includes('완벽'));
for(let bad=0;bad<=10;bad++){
 const q=score(fixture(10,bad));assert.equal(q.total,q.sBalance+q.sFair+q.sDiversity+q.sInterval);assert(q.total>=0&&q.total<=100);
 if(bad)assert(q.sBalance<=score(fixture(10,bad-1)).sBalance,'More imbalance must never improve score');
}
const unsafe=fixture(10,0);unsafe.matches[0].team1A.level=7;
assert(score(unsafe).safetyIssues.includes('심각한 실력 불균형'));
const malformed=fixture(10,0);malformed.matches[0].team1B=malformed.matches[0].team1A;
assert(score(malformed).safetyIssues.includes('경기 구성 오류'));
const repeated=fixture(1,0);repeated.participants.forEach(p=>p._goal=4);
repeated.matches=Array.from({length:4},(_,i)=>({...repeated.matches[0],round:i+1,matchNumber:i+1}));
const forced=score(repeated,{teamMode:true,gamesPerPlayer:4,courts:1});
assert.equal(forced.sDiversity,20,'Only four fixed-team players have no alternative partners or opponents');
assert.equal(forced.sInterval,10,'Four players on one court cannot avoid consecutive play');
const fair=fixture(2,0);fair.participants[0]._goal=0;
assert(Number.isFinite(score(fair).total),'Zero appearance goal must not create NaN');
console.log('PASS v2 maxima/sum, size invariance, monotonic imbalance, safety, forced repeats, zero goals');
console.log(JSON.stringify({perfect:perfect.total,oneBadBalance:one.sBalance,tenBadBalance:ten.sBalance}));
