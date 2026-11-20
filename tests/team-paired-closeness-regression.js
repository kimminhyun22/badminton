'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const build = require('./helpers/team-competition-context');
const fixture = require('./fixtures/team-reassign-swap.json');
const source = fs.readFileSync('js/team.js', 'utf8');
const slots = ['team1A','team1B','team2C','team2D'];

function assignedRoster(games, code = source, captain = null) {
  const c = build(71, true, code);
  const players = Array.from({length:24}, (_,i) => ({
    name:'E2E'+i,memberId:'test-'+i,gender:[0,1,4,5,8,9].includes(i)?'여':'남',
    grade:'C',level:4,ageGroup:'40대',skillRating:i<10?3:2.5+(i%5)*.25
  }));
  const pairs = [0,2,4,6,8].map(i=>({members:[players[i].name,players[i+1].name]}));
  const mate = name=>pairs.find(p=>p.members.includes(name))?.members.find(n=>n!==name)||null;
  Object.assign(c,{
    _teamBlockFullReassignment:()=>false,currentMatches:[],_directPlayers:players,teamAssignment:null,
    _teamAssignmentPreviews:new WeakMap(),captains:{blue:{leader:captain||''},white:{}},_partners:pairs,
    getPartnerInfo:()=>null,getPartnerOf:mate,document:{getElementById:id=>({
      value:id==='gamesPerPlayer'?String(games):'3',classList:{add(){},remove(){}}
    })},showErr:m=>{throw Error(m);},showWarn(){},updateTeamModeBadge(){},renderTeamList(){},updateSettingsMiniSummary(){}
  });
  vm.runInContext(code.slice(code.indexOf('function doTeamAssign('),code.indexOf('// Same +5 display translation')),c);
  assert.equal(c.doTeamAssign(),true);
  const {blue,white} = c.teamAssignment, roster = [...blue,...white];
  assert.equal(blue.length,12);assert.equal(white.length,12);
  assert.deepEqual([blue,white].map(t=>t.filter(p=>p.gender==='F').length).sort(),[2,4],'seed pairs without stranding all women');
  if(captain)assert(blue.some(p=>p.name===captain)&&blue.some(p=>p.name===mate(captain)));
  const preview=c._teamAssignmentPreviews.get(c.teamAssignment);
  assert(preview?.candidate&&preview.notice.includes('모의 대진'),'compare complete schedules and mark comparison time');
  const {candidate}=preview,settings={teamMode:true,gamesPerPlayer:games,courts:3};
  assert(c._teamCompetitionEvaluation(candidate,settings).score.eligible);
  assert(candidate.participants.every(p=>p.gamesPlayed===games));
  assert(candidate.matches.every(m=>[[m.team1A,m.team1B],[m.team2C,m.team2D]].every(([a,b])=>
    (!a.partnerName||a.partnerName===b.name)&&(!b.partnerName||b.partnerName===a.name))));
  for(const split of c._teamPartnerBlockSplits(blue,white,[captain].filter(Boolean))){
    if(captain)assert(split.blue.some(p=>p.name===captain));
    for(const side of [split.blue,split.white]){
      assert.equal(side.length,12);
      assert(side.every(p=>!p.partnerName||side.some(q=>q.name===p.partnerName)));
    }
  }
  assert.throws(()=>c._teamValidatePreferredCandidate(candidate,roster,{...settings,courts:4}),/다릅니다/);
  return candidate;
}
const four=assignedRoster(4),three=assignedRoster(3);
assert(four.participants.filter(p=>p.gender==='F').every(p=>p.womenDoublesPlayed>=2));
assert(three.matches.some(m=>m.type==='여복'));
assignedRoster(4,source,'E2E4');
const oldCapacity = source.replace('[...excess(seedBlue,pair),sum(seedBlue)]','[sum(seedBlue)]')
  .replace('[...excess(seedWhite,pair),sum(seedWhite)]','[sum(seedWhite)]');
assert.notEqual(oldCapacity,source);
assert.throws(()=>assignedRoster(4,oldCapacity),assert.AssertionError);

// Use the same complete schedule that won the existing team-reassignment test.
const c=build(),s=fixture.settings,ps=fixture.players.map(p=>({...p,_goal:s.gamesPerPlayer}));
const current=c._teamCopyFinalCandidate({participants:ps,matches:fixture.matches.map(([round,court,type,...ids])=>({
  round,court,type,...Object.fromEntries(slots.map((key,i)=>[key,ps[ids[i]]]))
}))});
const winner=c._teamJointAllocation(ps.filter(p=>p.team==='청팀'),ps.filter(p=>p.team==='홍팀'),s,[],{currentCandidate:current}).bracket;
const snapshot=JSON.stringify(winner);
const polished=c._teamPolishComparedBracket(winner,s,current);
const before=c._teamCompetitionEvaluation(winner,s),after=c._teamCompetitionEvaluation(polished,s);
assert(after.score.total>before.score.total&&after.score.diagnostics.meanAdjustedGap<before.score.diagnostics.meanAdjustedGap);
assert(c._teamFinalCandidateSafe(winner,polished,s,before,after));
assert(c._teamAllocationCandidateSafe(current,polished,s,c._teamCompetitionEvaluation(current,s),after));
assert.equal(JSON.stringify(winner),snapshot);
assert(source.includes('womenChoice=_teamPolishComparedBracket(womenChoice,settings,opts.allocationOrigin)'));
console.log('PASS paired initial teams, complete previews, women coverage, captain and partner locks, stale preview, final polishing',before.score.total,after.score.total);
