'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm'),build=require('./helpers/team-competition-context');
const source=fs.readFileSync('js/team.js','utf8');
const assignment=src=>src.slice(src.indexOf('function doTeamAssign('),src.indexOf('// Same +5 display translation'));
function assignmentCalls(gpp,src=source){
 const c=build(),ps=Array.from({length:8},(_,i)=>({name:'E2E편성'+i,memberId:'test-'+i,gender:i%2?'남':'여',level:3,grade:'C'}));
 const old={blue:ps.slice(0,4),white:ps.slice(4)},calls=[];
 Object.assign(c,{_teamBlockFullReassignment:()=>false,currentMatches:[],_directPlayers:ps,teamAssignment:old,captains:{blue:{leader:ps[0].name},white:{leader:ps[7].name}},_partners:[],getPartnerInfo:()=>null,getPartnerOf:()=>null,
  document:{getElementById:id=>({value:id==='gamesPerPlayer'?String(gpp):'4',classList:{add(){},remove(){}}})},showErr:m=>{throw Error(m);},showWarn(){},updateTeamModeBadge(){},renderTeamList(){},updateSettingsMiniSummary(){},
  _teamJointAllocation:(b,w,s,locked)=>{calls.push({s,locked});return{blue:b,white:w};}});
 vm.runInContext(assignment(src),c);assert.equal(c.doTeamAssign(),true);
 assert.equal(calls.length,[3,4].includes(gpp)?1:0,'only supported game counts reach complete-bracket comparison');
 if(calls.length){assert.equal(calls[0].s.gamesPerPlayer,gpp);assert.equal(calls[0].s.courts,4);assert(calls[0].locked.includes(ps[0].name));assert(calls[0].locked.includes(ps[7].name));}
}
[2,3,4,5].forEach(g=>assignmentCalls(g));
const mutant=source.replace('if([3,4].includes(gpp)){','if(gpp===4){');assert.notEqual(mutant,source);assert.throws(()=>assignmentCalls(3,mutant),assert.AssertionError,'old four-only assignment gate loses three-game comparison');
function readOnlyReview(gpp,started=false){
 const c=build(),players=Array.from({length:8},(_,i)=>({name:'E2E비교'+i,gender:'M',level:3,grade:'C',team:i<4?'청팀':'홍팀'})),s={teamMode:true,gamesPerPlayer:gpp,courts:2};
 const split=[players.slice(0,4),players.slice(4)],b=c._teamAllocationBracket(...split,s),sig=c.KokTeamCompetition.scheduleKey(b.matches),snapshot=JSON.stringify(b);let previews=0,saved=0,warnings=0;
 Object.assign(c,{currentMatches:b.matches,currentParticipants:b.participants,currentSettings:s,_liveMatchStartedAt:started?1:0,_teamFinishedAt:0,_isMatchDone:()=>false,showWarn(){warnings++;},showErr:m=>{throw Error(m);},setTimeout:fn=>fn(),document:{getElementById:()=>({classList:{add(){},remove(){}}})},renderQualityDashboard(){},saveState(){saved++;},console,
 _teamAllocationBracket:()=>{previews++;return c._teamCopyFinalCandidate(b);}});
 c.teamReviewCurrentBracket();
 assert.equal(previews,[3,4].includes(gpp)&&!started?6:0);assert.equal(saved,previews?1:0);assert.equal(warnings,previews?0:1);
 assert.equal(JSON.stringify(b),snapshot,'read-only comparison must not modify the bracket');assert.equal(c.KokTeamCompetition.scheduleKey(c.currentMatches),sig);
 if(previews){assert.equal(s.conditionalReview.version,4);const restored=JSON.parse(JSON.stringify(s));assert.equal(c._teamConditionalAssessment(b.matches,b.participants,restored).verified,c._teamConditionalAssessment(b.matches,b.participants,s).verified);}
}
readOnlyReview(3);readOnlyReview(4);readOnlyReview(2);readOnlyReview(3,true);
console.log('PASS three/four-game assignment and read-only review, fixed captains, unsupported/live guards, original bracket preservation, comparison v4 restore and gate mutation');
