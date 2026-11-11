'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm'),E=require('../js/team-event-skill'),B=require('../js/club-skill-batch');
const clone=v=>JSON.parse(JSON.stringify(v));
function memory(){const data=new Map();return {data,fail:false,getItem:k=>data.get(k)??null,setItem(k,v){if(this.fail)throw Error('storage full');data.set(k,v);}};}
const raw=(name,id)=>({name,grade:'C',gender:'남',ageGroup:'40대',level:4,skillStep:0,skillRating:3.5,...(id?{memberId:id}:{}),isClubOfficial:false});
function setup(){
  const storage=memory(),bridge=E.create(storage),state={version:1,clubs:[{id:'A',name:'E2E클럽A',members:[raw('E2E동명이인'),raw('E2E둘'),raw('E2E비참가')]},{id:'B',name:'E2E클럽B',members:[raw('E2E동명이인','b0'),raw('E2E넷','b1'),raw('E2E보존')]}]};
  const refs=[['A','a0',state.clubs[0].members[0]],['A','a1',state.clubs[0].members[1]],['B','b0',state.clubs[1].members[0]],['B','b1',state.clubs[1].members[1]]];
  const players=refs.map(([clubId,memberId,m])=>({...clone(m),memberKey:E.key({clubId,memberId})}));
  players.push({...raw('E2E게스트'),memberKey:E.key({memberId:'guest0'}),isGuest:true});
  const bindings=Object.fromEntries(refs.map(([clubId,memberId,m])=>[E.key({clubId,memberId}),{clubId,memberId,name:m.name,original:clone(m)}]));
  const context={id:'E2E-event',title:'E2E팀전',clubId:'A',clubName:'E2E클럽A',players,evaluators:[{memberKey:E.key({clubId:'A',memberId:'official'}),name:'E2E임원'}],bindings,draft:{participants:clone(players)}};
  bridge.saveContext(context);bridge.updateAssessment(context.id,{eventId:context.id,id:'E2E-review',key:'E2E-owner',createdAt:100,scopeSignature:bridge.signature(context)});
  const makeSession=(targets={p0:4.1,p2:4.2,p4:4.3},revision='result-1')=>{
    const ps=players.map((p,i)=>({...clone(p),id:'p'+i,base:3.5}));
    return {id:'E2E-review',event:{id:context.id,revision:1},players:ps,evaluators:clone(context.evaluators),resultRevision:revision,proposals:ps.map(p=>({id:p.id,name:p.name,skillRating:targets[p.id]??3.5,step:0,ready:Object.hasOwn(targets,p.id),basis:clone(p),eventRevision:1}))};
  };
  return {storage,bridge,state,context,players,session:makeSession(),makeSession};
}
function staged(){const x=setup();assert.equal(x.bridge.stageResults(x.context.id,x.session),'team.html?skillEvent=E2E-event');return x;}
function rejectSession(change){const x=setup(),before=JSON.stringify([...x.storage.data]);change(x.session,x);assert.throws(()=>x.bridge.stageResults(x.context.id,x.session));assert.equal(JSON.stringify([...x.storage.data]),before);}
{
  const x=setup(),input=JSON.stringify([x.context,x.state,x.session,x.players]),before=clone(x.state);
  assert.equal(E.key({clubId:'A',club:'ignored',memberId:'x'}),'["A","x"]');
  assert.equal(x.bridge.signature(x.context),x.bridge.signature({...x.context,players:x.players.slice().reverse().map(p=>({...p,skillRating:99,level:99,skillStep:4}))}),'scope excludes ratings and ordering');
  x.bridge.stageResults(x.context.id,x.session);assert.deepEqual(x.state,before,'staging cannot write official roster');
  const plan=x.bridge.planApply(x.context.id,x.session,x.state,x.players,200);
  assert.equal(plan.count,2);assert.equal(plan.guestCount,1);
  assert.equal(plan.state.clubs[0].members[0].skillRating,4.1);assert.equal(plan.state.clubs[1].members[0].skillRating,4.2,'same name in another club has its own binding');
  for(const [club,index] of [[0,1],[0,2],[1,1],[1,2]])assert.deepEqual(plan.state.clubs[club].members[index],before.clubs[club].members[index],'not-ready and nonparticipants stay intact');
  assert.equal(plan.newContext.applied[x.players[4].memberKey].skillRating,4.3);assert(plan.newContext.applied[x.players[4].memberKey].guest);
  assert.equal(JSON.stringify([x.context,x.state,x.session,x.players]),input,'all input objects remain unchanged');
  assert(x.bridge.readContext(x.context.id).pending,'planning does not consume pending data');
  x.bridge.commitApplied(plan.newContext);assert(!x.bridge.readContext(x.context.id).pending);
  x.bridge.stageResults(x.context.id,x.session);
  const again=x.bridge.planApply(x.context.id,x.session,plan.state,x.players,201);assert.equal(again.count,0);assert.equal(again.guestCount,0);assert.deepEqual(again.state,plan.state,'replay is a true no-op');
  x.bridge.commitApplied(again.newContext);
  const later=x.makeSession({p0:3.8,p2:4.2,p4:4.4},'result-2');x.bridge.stageResults(x.context.id,later);
  const next=x.bridge.planApply(x.context.id,later,plan.state,x.players,300);assert.equal(next.count,1);assert.equal(next.guestCount,1);assert.equal(next.state.clubs[0].members[0].skillRating,3.8,'further answers replace the absolute score, not add it');
  assert.equal(next.newContext.applied[x.players[0].memberKey].basis.skillRating,3.5,'survey prior remains frozen after multiple applications');
}
{
  const x=staged(),plan=x.bridge.planApply(x.context.id,x.session,x.state,x.players,200);
  // Simulate the roster write succeeding, followed by context storage failure.
  const before=JSON.stringify([...x.storage.data]);x.storage.fail=true;assert.throws(()=>x.bridge.commitApplied(plan.newContext),/storage full/);assert.equal(JSON.stringify([...x.storage.data]),before);x.storage.fail=false;
  const recovered=x.bridge.planApply(x.context.id,x.session,plan.state,x.players,201);assert.equal(recovered.count,0);assert.deepEqual(recovered.state,plan.state);x.bridge.commitApplied(recovered.newContext);
  assert.equal(x.bridge.readContext(x.context.id).appliedRevision,'result-1');
}
{
  const x=staged(),planned=x.bridge.planApply(x.context.id,x.session,x.state,x.players,200),manual=clone(planned.state);
  delete manual.clubs[0].skillReview.sources;
  assert.throws(()=>x.bridge.planApply(x.context.id,x.session,manual,x.players,201),/저장 기록/,'same target profile without our exact write receipt is not interruption recovery');
  const different=clone(planned.state),source=Object.values(different.clubs[0].skillReview.sources)[0];source.batchId='different-result';
  assert.throws(()=>x.bridge.planApply(x.context.id,x.session,different,x.players,201),/저장 기록/,'same review with another result receipt cannot claim this interrupted batch');
}
{
  const x=staged(),plan=x.bridge.planApply(x.context.id,x.session,x.state,x.players,200);x.bridge.commitApplied(plan.newContext);
  const saved=x.bridge.saveContext({...x.context,players:x.players.map(p=>({...p,skillRating:8,level:8})),assessment:{id:'foreign'},applied:{},bindings:{}});
  assert.equal(saved.players[0].skillRating,3.5);assert.equal(saved.assessment.id,'E2E-review');assert.equal(saved.applied[x.players[0].memberKey].skillRating,4.1);assert.deepEqual(saved.bindings[x.players[0].memberKey].original,x.context.bindings[x.players[0].memberKey].original);
  x.bridge.saveContext({...x.context,players:x.players.slice(1)});
  const rejoined=x.bridge.saveContext({...x.context,players:x.players.map(p=>({...p,skillRating:8}))});
  assert.equal(rejoined.players[0].skillRating,3.5,'exclude and rejoin cannot reset a returning participant prior');
  const fresh=x.makeSession({p0:4.4},'result-2');x.bridge.stageResults(x.context.id,fresh);
  const manual=clone(plan.state);manual.clubs[0].members[0].skillRating=4.9;
  assert.throws(()=>x.bridge.planApply(x.context.id,fresh,manual,x.players,300),/変更|변경/);assert.equal(manual.clubs[0].members[0].skillRating,4.9);
  const profile=clone(plan.state);profile.clubs[0].members[0].isClubOfficial=true;
  assert.throws(()=>x.bridge.planApply(x.context.id,fresh,profile,x.players,300),'concurrent profile edits are not overwritten');
}
for(const change of [
  s=>s.event.id='another-event',s=>s.id='another-review',s=>s.players[1].memberKey=s.players[0].memberKey,
  s=>s.players[1].id=s.players[0].id,s=>s.players.pop(),s=>s.players[0].grade='B',s=>s.evaluators[0].name='E2E다른임원',
  s=>s.proposals[0].basis.memberKey=s.players[1].memberKey,s=>s.proposals[0].basis.skillRating=99,
  s=>s.proposals[0].skillRating=Infinity,s=>s.proposals.push(clone(s.proposals[0])),s=>s.proposals[0].eventRevision=0,
  s=>s.proposals.forEach(p=>p.ready=false),s=>s.resultRevision='',s=>s.players=s.players.slice(0,3),
  s=>{s.players[0].skillRating=4.1;s.proposals[0].basis.skillRating=4.1;}
])rejectSession(change);
for(const change of [
  (s,x)=>s.resultRevision='new-answer',s=>s.event.revision++,s=>s.proposals[0].skillRating=4.9,
  s=>s.proposals[0].ready=false,s=>s.players[0].grade='B'
]){
  const x=staged(),before=JSON.stringify([...x.storage.data]);change(x.session,x);
  assert.throws(()=>x.bridge.planApply(x.context.id,x.session,x.state,x.players,200));assert.equal(JSON.stringify([...x.storage.data]),before);
}
for(const change of [
  x=>x.state.clubs.shift(),x=>x.state.clubs[0].members.shift(),x=>x.state.clubs[0].members.push(clone(x.state.clubs[0].members[0])),
  x=>x.state.clubs.push(clone(x.state.clubs[0])),x=>x.state.clubs[1].members[0].memberId='replaced-id',
  x=>x.state.clubs[0].members[0].level=5,x=>x.players.pop(),x=>x.players[0].grade='A'
]){
  const x=staged();change(x);const before=JSON.stringify(x.state);assert.throws(()=>x.bridge.planApply(x.context.id,x.session,x.state,x.players,200));assert.equal(JSON.stringify(x.state),before);
}
{
  const x=setup();delete x.context.bindings[x.players[0].memberKey];const clean=memory(),bridge=E.create(clean);bridge.saveContext(x.context);bridge.updateAssessment(x.context.id,{id:'E2E-review',key:'E2E-owner',createdAt:100,scopeSignature:bridge.signature(x.context)});bridge.stageResults(x.context.id,x.session);
  assert.throws(()=>bridge.planApply(x.context.id,x.session,x.state,x.players,200),/공식 명부 연결/,'registered participant cannot silently become guest');
}
{
  const x=staged(),plan=x.bridge.planApply(x.context.id,x.session,x.state,x.players,200);x.bridge.saveContext({...x.context,title:'E2E수정'});
  assert.throws(()=>x.bridge.commitApplied(plan.newContext),/저장 중/,'stale plan cannot overwrite a newer context');
}
{
  const x=staged(),first=x.bridge.planApply(x.context.id,x.session,x.state,x.players,200);x.bridge.commitApplied(first.newContext);
  const source={kind:'club',createdAt:250},member=first.state.clubs[0].members[0];
  const newer=B.prepare(first.state,'A',[{id:'p0',original:member,step:0,skillRating:4.6}],'newer-review','newer-1',300,source);
  const restored=B.prepare(newer.state,'A',[{id:'p0',original:newer.state.clubs[0].members[0],step:0,skillRating:4.1}],'newer-review','newer-2',310,source);
  const next=x.makeSession({p0:4.4},'result-2');x.bridge.stageResults(x.context.id,next);
  assert.throws(()=>x.bridge.planApply(x.context.id,next,restored.state,x.players,400),/최신 점수/,'newer assessment ownership blocks even when its value matches our previous after profile');
}
{
  const x=setup(),before=JSON.stringify([...x.storage.data]);x.storage.fail=true;assert.throws(()=>x.bridge.stageResults(x.context.id,x.session),/storage full/);assert.equal(JSON.stringify([...x.storage.data]),before);
  assert.throws(()=>x.bridge.saveContext({...x.context,title:'다른 제목'}),/storage full/);assert.equal(JSON.stringify([...x.storage.data]),before);
}
// The browser build uses the same API and receives its official writer explicitly.
{
  const ctx={localStorage:memory(),KokSkillBatch:B};vm.runInNewContext(fs.readFileSync('js/team-event-skill.js','utf8'),ctx);assert.equal(typeof ctx.KokTeamEventSkill.planApply,'function');assert.equal(ctx.KokTeamEventSkill.key({memberId:'guest'}),'["","guest"]');
}
// Removing the fresh-result guard must allow stale votes, proving the test detects it.
{
  const ctx={module:{exports:{}},require:p=>p==='./club-skill-batch'?B:require(p)};
  vm.runInNewContext(fs.readFileSync('js/team-event-skill.js','utf8').replace("if(!same(latest,pending))throw Error('평가 답변 또는 신청자가 변경됐습니다. 최신 결과를 다시 확인해 주세요.');",''),ctx);
  const x=staged(),mutant=ctx.module.exports.create(x.storage),newer=clone(x.session);newer.resultRevision='later';
  assert.doesNotThrow(()=>mutant.planApply(x.context.id,newer,x.state,x.players,200),'mutation removes the stale vote rejection');
}
console.log('PASS team-event bridge: frozen priors, exact bindings, ready-only atomic plans, same-name clubs, guests, replay/further answers, concurrent changes, freshness, interruption recovery, storage preservation and mutation');
