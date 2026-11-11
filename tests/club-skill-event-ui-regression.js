'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm'),crypto=require('crypto');
const source=fs.readFileSync('js/club-skill-review.js','utf8'),html=fs.readFileSync('skill-review.html','utf8');
const C=require('../functions/skill-calibration-core'),B=require('../js/club-skill-batch');
const clone=x=>JSON.parse(JSON.stringify(x)),members=Array.from({length:4},(_,i)=>({memberKey:'m'+i,name:'E2E신청'+i,grade:'C',gender:'남',ageGroup:'40대',level:4,skillRating:3.5+i*.1}));
const signature=c=>JSON.stringify({players:c.players.map(p=>[p.memberKey,p.name,p.grade,p.gender,p.ageGroup]).sort(),evaluators:(c.evaluators||[]).map(p=>[p.memberKey,p.name]).sort()});
async function fixture(code=source,{hash='',event=true,count=4,pendingScopeChanged=false}={}){
 const calls=[],staged=[],values={},nodes={},base={id:'event-e2e',title:'E2E신청자전',clubId:'club-e2e',clubName:'E2E클럽',players:clone(members.slice(0,count)),evaluators:[{memberKey:'officer-e2e',name:'E2E비출전임원'}]};
 let context=base,state=null,projectRead=null,batchCalls=0;
 const $=id=>nodes[id]||(nodes[id]={hidden:true,disabled:false,value:'0',textContent:'',innerHTML:'',dataset:{},href:'',querySelectorAll:()=>[],setAttribute(){},append(){}});
 for(const m of html.matchAll(/\bid="([^"]+)"/g))$(m[1]);
 const keys={id:'a'.repeat(32),key:'b'.repeat(32),shared:'c'.repeat(32)};
 const projection=()=>({...clone(state),proposals:state.players.map(p=>({id:p.id,name:p.name,currentRating:p.skillRating,skillRating:p.skillRating+.2,current:p.skillStep||0,step:0,ready:true,reviewed:true,opponents:3,experts:1,resolved:3,basis:p,assessment:{reason:'E2E근거충족',linkedGrades:['C'],sameGradeOpponents:3,crossGradeOpponents:0}}))});
 function make(players=base.players){return{id:keys.id,clubId:base.clubId,clubName:base.clubName,event:{id:base.id,title:base.title,revision:1},players:C.players(players).map((p,i)=>({...p,memberKey:players[i].memberKey})),evaluators:[{id:'r0',memberKey:'officer-e2e',name:'E2E비출전임원'}],questions:C.pairs(C.players(players)),ownerAnswers:{},answers:{},evidence:{},count:4,assessmentVersion:2,adaptiveSupported:true,closed:false,expiresAt:Date.now()+86400000,resultRevision:'results1'};}
 const bridge={readContext:()=>context,signature,updateAssessment(id,own){assert.equal(id,context.id);context.assessment={id:own.id,key:own.key,scopeSignature:own.scopeSignature};},async stageResults(id,result){assert.equal(id,base.id);staged.push(clone(result));return 'team.html?skillEvent='+id;}};
 const ctx={console,URL,URLSearchParams,Date,Math,JSON,Map,Set,Array,Object,Number,String,Uint8Array,Promise,AbortController,crypto:crypto.webcrypto,setTimeout,clearTimeout,setInterval(){},confirm:()=>true,prompt(){},location:{search:event?'?from=team&event=event-e2e':'',hash,href:'https://example.test/skill-review.html'},navigator:{share:async data=>calls.push({action:'navigator-share',...data}),clipboard:{writeText:async()=>{}}},localStorage:{getItem:k=>values[k]??null,setItem:(k,v)=>values[k]=String(v),removeItem:k=>delete values[k]},document:{title:'',hidden:false,getElementById:$,querySelector:s=>s.includes('app-version')?{content:'1.10.804'}:null,querySelectorAll:()=>[],addEventListener(){},createElement:()=>({})},window:{KokClubSkill:C,KokSkillBatch:{...B,prepare(){batchCalls++;throw Error('event UI cannot write club batch directly');}},KokTeamEventSkill:bridge,KokSkillReadiness:{overall:(ps,proposals)=>({percent:100,total:ps.length,ready:proposals.filter(p=>p.ready).length,remaining:0}),player:()=>null},matchMedia:()=>({matches:true})},fetch:async(url,opts)=>{
  const data=JSON.parse(opts.body).data;calls.push(clone(data));let result;
  if(data.action==='create'){state=make(data.players);state.id=data.id;keys.id=data.id;keys.key=data.key;assert.deepEqual(data.players.map(p=>p.memberKey),base.players.map(p=>p.memberKey));result=projection();}
  else if(data.action==='read'){result=projectRead?projectRead(data):projection();}
  else if(data.action==='share'){keys.shared=data.sharedKey;result=projection();}
  else if(data.action==='eventSync'){assert.equal(data.expectedRevision,state.event.revision);const old=new Map(state.players.map(p=>[p.memberKey,p]));state.players=data.players.map((p,i)=>old.get(p.memberKey)||{...C.player(p,i),id:'p'+(i+10),memberKey:p.memberKey});state.questions=C.pairs(state.players);state.event.revision++;result=projection();}
  else if(data.action==='join'){assert.equal(data.playerId,'r0');result={...projection(),needsIdentity:false,respondentName:'E2E비출전임원'};}
  else if(data.action==='batch'){assert.equal(data.expectedRevision,state.event.revision);result={...projection(),adaptiveBatch:{requestId:data.requestId,questions:state.questions.slice(0,2)}};}
  else if(data.action==='answer'){assert.equal(data.expectedRevision,state.event.revision);result=projection();}
  else throw Error('Unexpected API '+data.action);
  return{ok:true,json:async()=>({result})};
 }};
 if(hash){state=make();values.kokmatch_club_skill_links_v1='[]';projectRead=()=>({...projection(),needsIdentity:true,evaluators:[{id:'r0',name:'E2E비출전임원'}]});}
 if(pendingScopeChanged){const old={id:keys.id,key:keys.key,invites:['d','e','f'].map(v=>v.repeat(32)),eventId:base.id,createdAt:Date.now(),pending:true,scopeSignature:'previous-invalid-scope',snapshots:[]};values.kokmatch_club_skill_links_v1=JSON.stringify([old]);context.assessment={...old};}
 vm.createContext(ctx);vm.runInContext(code,ctx);
 const idle=async()=>{for(let i=0;i<30;i++)await new Promise(r=>setImmediate(r));};await idle();
 return{ctx,$,calls,staged,values,keys,base,idle,state:()=>state,context:()=>context,setRead:f=>projectRead=f,projection,replaceContext:c=>context=c,batchCalls:()=>batchCalls};
}
async function check(code=source){
 const e=await fixture(code);assert.equal(e.$('reviewTitle').textContent,'팀전 신청자 밸런스게임');assert(!e.$('owner').hidden);assert.equal(e.calls.filter(c=>c.action==='create').length,1);
 for(const id of['measurementSetup','recommendationSetup','referenceExisting','referenceInfo','undoBatch','scoreFormula'])assert(e.$(id).hidden,id+' club-only hidden');
 assert(e.$('applyAll').textContent.includes('명부에 저장하고 팀전에 적용'));assert(!e.$('applyAll').disabled);assert(e.$('eventInfo').textContent.includes('명부에 등록되지 않은'));
 await e.$('refresh').onclick();await e.idle();assert(e.calls.filter(c=>c.action==='read').every(c=>!('baselines'in c)),'event read cannot rebase frozen club baseline');
 await e.$('share').onclick();assert(e.calls.some(c=>c.action==='navigator-share'&&c.title.includes('신청자')));
 await e.$('applyAll').onclick();assert.equal(e.staged.length,1);assert.equal(e.ctx.location.href,'team.html?skillEvent=event-e2e');assert.equal(e.staged[0].resultRevision,'results1');assert(!e.values.kokmatch_skill_apply_v1,'no general club apply handoff');assert.equal(e.batchCalls(),0);
 e.context().applied=Object.fromEntries(e.state().players.map(p=>[p.memberKey,{skillRating:p.skillRating+.2}]));await e.$('refresh').onclick();await e.idle();assert(e.$('applyAll').disabled,'identical already-applied result disabled');
 e.context().players=e.context().players.slice(0,3);await e.$('refresh').onclick();await e.idle();assert(!e.$('eventSync').hidden);assert(e.$('applyAll').disabled);
 const draft='kokmatch_skill_draft_'+e.keys.id+'_'+e.keys.key;e.values[draft]=JSON.stringify({p0_p1:'a',p2_p3:'b'});e.values[draft+'_adaptiveRequest']='"stale-lease"';await e.$('eventSync').onclick();await e.idle();assert.equal(e.state().event.revision,2);assert(e.$('applyAll').disabled,'three applicants cannot apply');assert.deepEqual(JSON.parse(e.values[draft]),{p0_p1:'a'});assert(JSON.parse(e.values[draft+'_eventArchived'])[0].answers.p2_p3==='b');assert(!e.values[draft+'_adaptiveRequest'],'scope change clears old lease');
 const count=e.calls.length;await e.$('proposals').onclick({target:{dataset:{apply:'p0'}}});await e.$('undoBatch').onclick();await e.$('referenceExisting').onclick();await e.$('configureMeasurement').onclick();assert.equal(e.calls.length,count,'club-only handlers cannot mutate event');
 // Owner enters the shared identity path, never owner-review voting.
 e.setRead(data=>data.key===e.keys.shared?{...e.projection(),needsIdentity:true}:e.projection());await e.$('answerSelf').onclick();await e.idle();assert(!e.$('identity').hidden);assert(e.$('respondent').innerHTML.includes('r0'));assert(e.$('respondent').innerHTML.includes('E2E비출전임원'));assert(!e.$('respondent').innerHTML.includes('E2E신청0'));
 e.$('respondent').value='r0';await e.$('join').onclick();await e.idle();assert(e.calls.some(c=>c.action==='join'&&c.playerId==='r0'));assert(e.calls.some(c=>c.action==='batch'&&c.expectedRevision===2));assert(!e.calls.some(c=>c.action==='assess'));
 const shared=await fixture(code,{event:false,hash:'#'+'a'.repeat(32)+'.'+'c'.repeat(32)});assert(!shared.$('identity').hidden);assert(shared.$('reviewTitle').textContent.includes('신청자'));assert(shared.$('respondent').innerHTML.includes('E2E비출전임원'));
 const tooFew=await fixture(code,{count:3});assert(!tooFew.calls.length,'fewer than four cannot create an event assessment');assert(tooFew.$('status').textContent.includes('4명'));
 const retried=await fixture(code,{pendingScopeChanged:true});assert(!retried.$('owner').hidden);assert(!retried.$('applyAll').disabled,'successful creation retry adopts the server-accepted applicant scope');assert.equal(retried.context().assessment.scopeSignature,signature(retried.context()));
}
(async()=>{await check();await assert.rejects(check(source.replace("session.event?(session.evaluators||[]):session.players","session.players")),assert.AssertionError,'mutation: nonparticipant evaluator selector protection');assert(html.indexOf('js/team-event-skill.js')<html.indexOf('js/club-skill-review.js'));console.log('event UI: applicant-only create, no baseline read, frozen scope sync/draft archive, member-key evaluator join, no owner double vote, async result handoff/replay/membership guards, existing club handlers isolated, min4 and mutation passed');})().catch(e=>{console.error(e);process.exitCode=1;});
