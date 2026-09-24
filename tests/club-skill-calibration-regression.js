'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const core=require('../functions/skill-calibration-core');
const {handle}=require('../functions/skill-calibration');
const fixtures=()=>Array.from({length:5},(_,i)=>({name:'E2E회원'+i,grade:'C',gender:'남',ageGroup:'40대',skillStep:0,level:4}));
const players=core.players(fixtures()),questions=core.pairs(players);
assert.equal(questions.length,10);
const answers=Object.fromEntries(questions.filter(q=>q.a==='p0').map(q=>[q.id,'a']));
const result=core.proposals(players,questions,{e0:answers});
assert.equal(result[0].step,1);assert.equal(result[0].ready,true);
assert(result.every(p=>Math.abs(p.step)<=2));
assert(core.proposals(players,questions,{}).every(p=>p.step===0&&!p.ready));
const two=Object.fromEntries(Object.entries(answers).slice(0,2));
assert(core.proposals(players,questions,{e0:two}).every(p=>!p.ready),'insufficient opponents');
const disagree={e0:answers,e1:Object.fromEntries(Object.keys(answers).map(k=>[k,'b']))};
assert.equal(core.proposals(players,questions,disagree)[0].ready,false);
assert.equal(core.proposals(players,questions,disagree)[0].state,'의견 나뉨');
const skip={e0:Object.fromEntries(Object.keys(answers).map(k=>[k,'skip']))};
assert(core.proposals(players,questions,skip).every(p=>p.opponents===0));
assert.throws(()=>core.players([...fixtures(),fixtures()[0]]));
assert.throws(()=>core.players(fixtures().map(p=>({...p,level:'bad'}))));
const agePlayers=core.players(fixtures().map((p,i)=>({...p,ageGroup:i?'40대':'30대'})));
assert.equal(core.proposals(agePlayers,core.pairs(agePlayers),{e0:answers})[0].step,0,'existing age advantage is not counted twice');
const mixed=core.players(fixtures().map((p,i)=>i===1?{...p,grade:'B',level:5}:p));
assert(core.pairs(mixed).every(q=>q.a!=='p1'&&q.b!=='p1'));
const source=fs.readFileSync('functions/skill-calibration-core.js','utf8');
const mutated={module:{exports:{}}};vm.runInNewContext(source.replace('support.length>=3','support.length>=1'),mutated);
assert.throws(()=>assert(mutated.module.exports.proposals(players,questions,{e0:two}).every(p=>!p.ready)));
// Approval hands off to the existing member editor, never writes the roster automatically.
for(const stale of [false,true]){
  const original=fixtures()[0],club={id:'test',members:[{...original,level:stale?4.2:4}]};
  const values={kokmatch_skill_apply_v1:JSON.stringify({clubId:'test',original,step:1,createdAt:Date.now()}),badminton_rosters_v1:JSON.stringify({clubs:[club]})};
  let edited=0,selected=null,warned=0,ready;
  const ctx={URL,URLSearchParams,Date,AbortSignal,rosters:{clubs:[club]},location:{pathname:'/team.html',search:'?skillReviewApply=1',href:'https://example.com/team.html?skillReviewApply=1'},history:{replaceState(){}},
    localStorage:{getItem:k=>values[k]??null,removeItem:k=>delete values[k],setItem(){throw Error('unexpected write');}},
    document:{hidden:true,addEventListener:(name,fn)=>{if(name==='DOMContentLoaded')ready=fn;},getElementById:()=>null},
    window:{addEventListener(){}},setTimeout:fn=>fn(),setInterval(){},switchNav(){},editMember(){edited++;},selectMemberSkill:s=>selected=s,alert(){warned++;}};
  vm.runInNewContext(fs.readFileSync('js/club-skill-notice.js','utf8'),ctx);ready();
  assert.equal(edited,stale?0:1);assert.equal(selected,stale?null:1);assert.equal(warned,stale?1:0);
  assert.equal(club.members[0].skillStep,0);
}
function fakeDb(){
  const values={};return {values,ref(path){return {
    async once(){return {val:()=>structuredClone(values[path]??null)};},
    async transaction(fn){
      const first=fn(null);
      if(first===undefined)return {committed:false,snapshot:{val:()=>structuredClone(values[path]??null)}};
      const next=fn(structuredClone(values[path]??null));if(next!==undefined)values[path]=next;
      return {committed:next!==undefined,snapshot:{val:()=>structuredClone(values[path]??null)}};
    }
  };}};
}
// Quarterly notice survives expired survey cleanup and routes to the right club.
function reminder(days,source=fs.readFileSync('js/club-skill-notice.js','utf8')){
  let ready,box;
  const values={badminton_rosters_v1:JSON.stringify({clubs:[{id:'test',name:'E2E클럽'}]}),kokmatch_club_skill_links_v1:JSON.stringify([{id:'old',clubId:'test',createdAt:Date.now()-120*86400000,reviewedAt:Date.now()-days*86400000}])};
  vm.runInNewContext(source,{URLSearchParams,Date,location:{pathname:'/team.html',search:''},localStorage:{getItem:k=>values[k]},document:{hidden:true,getElementById:()=>box,createElement:()=>({style:{},setAttribute(){},replaceChildren(...items){this.items=items;}}),querySelector:()=>({after:b=>box=b}),addEventListener:(name,fn)=>{if(name==='DOMContentLoaded')ready=fn;}},window:{addEventListener(){}},setTimeout:fn=>fn(),setInterval(){}});
  ready();return box;
}
assert(!reminder(89));assert(reminder(90).items[0].href.includes('club=test'));
assert(reminder(100).items[0].textContent.includes('5문제'));
assert.throws(()=>assert(reminder(90,fs.readFileSync('js/club-skill-notice.js','utf8').replace('>=90*86400000','>=900*86400000'))));
(async()=>{
  const db=fakeDb(),now=Date.now(),id='1'.repeat(32),key='2'.repeat(32),invites=['3','4','5'].map(v=>v.repeat(32));
  const request={action:'create',id,key,invites,clubName:'E2E클럽',players:fixtures()};
  const created=await handle(db,request,'test',now);assert.equal(created.players.length,5);
  assert(!('owner' in created));assert(!('invites' in created));
  const again=await handle(db,request,'test',now);assert.equal(again.id,id);
  await assert.rejects(handle(db,{action:'read',id,key:'9'.repeat(32)},'test',now));
  const expert=await handle(db,{action:'read',id,key:invites[0]},'test',now);
  assert(!('level' in expert.players[0]));assert.deepEqual(expert.proposals,[]);
  await assert.rejects(handle(db,{action:'answer',id,key,answers},'test',now));
  await assert.rejects(handle(db,{action:'answer',id,key:invites[0],answers:{bad:'a'}},'test',now));
  const input={action:'answer',id,key:invites[0],answers};
  await handle(db,input,'test',now);await handle(db,input,'test',now);
  assert.equal((await handle(db,{action:'read',id,key},'test',now)).count,4,'retries do not add evidence');
  await Promise.all([handle(db,{...input,key:invites[1]},'test',now),handle(db,{...input,key:invites[2]},'test',now)]);
  const owner=await handle(db,{action:'read',id,key},'test',now);
  assert.equal(owner.proposals[0].experts,3);assert.equal(owner.count,12);
  await assert.rejects(handle(db,{action:'close',id,key:invites[0]},'test',now));
  await handle(db,{action:'close',id,key},'test',now);
  await assert.rejects(handle(db,input,'test',now));
  const id2='6'.repeat(32);await handle(db,{...request,id:id2},'test',now);
  assert.equal((await handle(db,{action:'read',id:id2,key},'test',now)).count,0,'club isolation');
  const five=Object.fromEntries(questions.slice(0,5).map(q=>[q.id,'tie']));
  const skipped=Object.fromEntries(questions.slice(0,5).map(q=>[q.id,'skip']));
  assert.equal((await handle(db,{...input,id:id2,answers:skipped},'test',now)).reviewedAt,0);
  assert.equal((await handle(db,{...input,id:id2,answers:five},'test',now)).reviewedAt,now);
  assert.equal((await handle(db,{...input,id:id2,answers:five},'test',now+1000)).reviewedAt,now,'retry must not reset reminder');
  await assert.rejects(handle(db,{...input,id:id2},'test',now+31*86400000));
  console.log('club skill calibration: bounded residuals, no demographic double count, consistency, mutation, capabilities, idempotency, concurrency, isolation, expiry passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
