'use strict';
const assert=require('node:assert/strict');
const adaptive=require('../functions/skill-adaptive-batch');
const core=require('../functions/skill-calibration-core');
const event=require('../functions/skill-event-core');
const plan=require('../functions/skill-boundary-plan');
const now=1900000000000;
const req=n=>n.toString(16).padStart(32,'0');
const fixtures=Array.from({length:24},(_,i)=>({name:'E2E선수'+i,memberKey:'E2E-'+i,grade:['D','C','B','A'][i%4],gender:'남',ageGroup:'40대'}));
const officers=[17,18,19,20,21,22].map(i=>fixtures[i]);
const players=core.players(fixtures);
const club={id:req(123),assessmentVersion:2,expiresAt:now+86400000,players,questions:core.pairs(players),votes:{}};
const team={...club,...event.creation({clubName:'E2E',event:{id:'E2E',title:'E2E'},players:fixtures,evaluators:officers})};
const checks=b=>b.questions.filter(q=>q.reason==='급수 간 비교 확인');
function waves(state,eventMode){
  let current=state;
  const original=JSON.stringify(state),leases=[];
  for(let i=0;i<officers.length;i++){
    const role='u_'+(eventMode?'r'+i:'p'+(17+i));
    const allocation=adaptive.allocate(current,role,req(i+1),now);
    const {batch}=allocation;current=allocation.state;
    assert.equal(batch.questions.length,10);
    assert(checks(batch).length<=2);
    for(const q of batch.questions){
      assert(![q.a,q.b].includes('p'+(17+i)));
      assert.deepEqual(Object.keys(q).sort(),['a','b','boundary','id','kind','phase','reason']);
    }
    assert.deepEqual(adaptive.allocate(current,role,req(i+1),now).batch,batch);
    assert.deepEqual(adaptive.allocate(current,role,req(i+20),now+1).batch,batch);
    leases.push(batch);
  }
  assert.equal(JSON.stringify(state),original);
  const first=checks(leases[0]).map(q=>q.id);
  assert.equal(first.length,2);
  assert.deepEqual(checks(leases[1]).map(q=>q.id),first,'two named evaluators get the same boundary pair');
  const selected=new Set(leases.flatMap(b=>checks(b).map(q=>q.id)));
  for(const qid of selected)assert.equal(leases.filter(b=>b.questions.some(q=>q.id===qid)).length,2,'unanswered pair held by two named judges at most');
  assert.equal(new Set(leases.flatMap(b=>checks(b).map(q=>q.boundary))).size,3);
  assert.deepEqual(current.votes,state.votes);
  const reissued=adaptive.allocate(current,eventMode?'u_r4':'u_p21',req(30),now+adaptive.ttl+1).batch;
  assert.equal(checks(reissued).length,2,'expired reservations free the pair');
}
function serial(){
  const allowed=club.questions.filter(q=>q.id==='p0_p1'||(players[Number(q.a.slice(1))].grade===players[Number(q.b.slice(1))].grade));
  const state={...club,questions:allowed};
  const allocate=(votes,role='u_p18')=>adaptive.allocate({...state,votes},role,req(90),now).batch;
  const pair={p0_p1:'a'},opposite={p0_p1:'b'},tie={p0_p1:'tie'};
  assert.equal(checks(allocate({u_p17:pair}))[0].id,'p0_p1');
  assert.equal(checks(allocate({u_p17:pair,u_p16:pair})).length,0,'one pair with two agreeing people settles its boundary');
  for(const v of [opposite,tie,{p0_p1:'skip'}]){
    assert.equal(checks(allocate({u_p17:pair,u_p16:v}))[0].id,'p0_p1','a split, tie or skip does not establish direction');
  }
  assert(checks(allocate({e0:pair,e1:pair,'owner-review':pair})).length,'anonymous links and owner cannot establish two identities');
  assert(checks(allocate({u_p17:pair,u_p0:pair})).length,'previous self comparison never confirms independent support');
  assert(checks(allocate({u_p17:pair,'member:p17':pair})).length,'mapped aliases stay one person');
  assert.equal(checks(allocate({u_p17:pair},'u_p17')).length,0,'same respondent never confirms own answer');
  assert.equal(checks(allocate({},'e0')).length,0);
  const fittedBallot=Object.fromEntries(allowed.map(q=>[q.id,'tie']));fittedBallot.p0_p1='b';
  assert.equal(checks(allocate({e0:fittedBallot,e1:fittedBallot,e2:fittedBallot}))[0].id,'p0_p1','well-covered historical anonymous votes leave a named-confirmation slot');
  const q=club.questions.find(q=>q.id==='p0_p1');
  const oldBatch={id:req(100),requestId:req(102),expiresAt:now+777,issuedAt:now-1,questions:[q]};
  const legacy={...state,votes:{u_p0:pair},adaptiveBatches:{u_p0:{current:oldBatch,history:{[req(102)]:oldBatch}}}};
  const replay=adaptive.allocate(legacy,'u_p0',req(102),now);
  assert.deepEqual(replay.batch.questions,[]);assert.deepEqual(replay.state.votes.u_p0,pair);
  assert.deepEqual(replay.state.adaptiveBatches.u_p0.current,oldBatch);
  assert(adaptive.allocate(legacy,'u_p0',req(103),now).batch.questions.every(q=>q.a!=='p0'&&q.b!=='p0'));
}
function late(){
  const joined={...fixtures[0],name:'E2E현장추가',memberKey:'E2E-late'};
  const next=event.sync(team,{expectedRevision:1,players:[...fixtures,joined]},now);
  const batch=adaptive.allocate(next,'u_r0',req(200),now).batch;
  const questions=batch.questions.filter(q=>[q.a,q.b].includes('p24'));
  assert.equal(questions.length,3,'three different opportunities for late registrant while other members also progress');
  const settled=Object.fromEntries(questions.map(q=>[q.id,'a']));
  const after=adaptive.allocate({...next,votes:{u_r0:settled}},'u_r1',req(201),now).batch;
  assert(!after.questions.some(q=>q.reason==='추가 신청자 비교'),'late-arrival boost ends after three resolved opponents');
}
function lateGroup(){
  const ps=players.slice(0,8),questions=core.pairs(ps);
  const state={players:ps,questions,proposals:ps.map((p,i)=>({...p,resolved:3,assessment:i>=4?{waitingForAnchor:true}:{}})),
    eventOnly:true,latePlayerIds:['p4','p5','p6','p7'],
    evidence:Object.fromEntries(['p0_p1','p1_p2','p2_p3','p4_p5','p5_p6','p6_p7'].map(id=>[id,{count:1}])),
    allowedQuestionIds:['p1_p3','p4_p6','p2_p5'],reservationCounts:{}};
  assert.equal(plan.nextQuestions(state,1)[0].id,'p2_p5','connect an isolated late group even after everyone has three comparisons');
}
function sparse(){
  const ps=core.players(fixtures.slice(0,4)),initial=plan.recommend({players:ps,proposals:ps,questions:[]},{initialOnly:true}).initial;
  assert.equal(initial.filter(q=>q.phase==='sparse-coverage').length,3);
  assert.equal(new Set(initial.map(q=>q.id)).size,6);
  const sparseClub={...club,players:ps,questions:initial};
  const active=adaptive.allocate(sparseClub,'u_p0',req(225),now).batch.questions;
  assert.equal(active.length,3);assert(active.some(q=>q.id==='p1_p3'));
  const unmarked=initial.map(({phase,...q})=>q);
  assert(!adaptive.allocate({...sparseClub,questions:unmarked},'u_p0',req(226),now).batch.questions.some(q=>q.id==='p1_p3'),'old explicit pools keep adjacent-only behavior');
}
function spareOpponent(){
  const ps=players.slice(0,8).map(p=>({...p,grade:'C',skillRating:p.id==='p0'?5:4}));
  const questions=core.pairs(ps);
  // Connected comparison graph. p0 has just reached the three-opponent floor;
  // the other candidates have four. The p1/p5 pair is closer in score.
  const edges=new Set(['p0_p1','p1_p2','p2_p3','p3_p4','p4_p5','p5_p6','p6_p7']);
  const state={players:ps,questions,proposals:ps.map(p=>({...p,resolved:p.id==='p0'?3:4})),
    evidence:Object.fromEntries([...edges].map(id=>[id,{count:1}])),
    allowedQuestionIds:['p0_p4','p1_p5'],reservationCounts:{}};
  assert.equal(plan.nextQuestions(state,1)[0].id,'p0_p4','leave room for a split in an existing three-opponent result');
  const pending={...state,reservationCounts:{p0_p6:1,p0_p7:1}};
  assert.equal(plan.nextQuestions(pending,1)[0].id,'p1_p5','pending distinct opponents spread other evaluators across the roster');
  assert.equal(state.proposals[0].resolved,3,'reservations do not change the number of resolved opponents');
}
waves(club,false);waves(team,true);serial();late();lateGroup();sparse();spareOpponent();
console.log('balance allocations: both modes; two priority slots, three grade boundaries, retries and expired reservations; directional majority, identity, self exclusion, legacy history, late entrants and sparse roster passed');
