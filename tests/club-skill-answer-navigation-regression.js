'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('js/club-skill-review.js','utf8');
function fixture(code=source){
  const nodes={},values={},buttons=['a','b','tie','skip'].map(v=>({dataset:{vote:v},setAttribute(k,value){this[k]=value;}}));
  const $=id=>nodes[id]||(nodes[id]={hidden:false,disabled:false,textContent:'',querySelectorAll:()=>buttons});
  const q=[{id:'q0',a:'p0',b:'p1'},{id:'q1',a:'p0',b:'p2'}];
  const ctx={$,Object,Date,Math,parseInt,window:{matchMedia:()=>({matches:true})},esc:String,at:0,batch:q,answers:{},busy:false,flipped:false,active:{id:'test',key:'00'},
    session:{questions:q,answers:{},expiresAt:Date.now()+86400000,players:[0,1,2].map(i=>({id:'p'+i,name:'E2E'+i,grade:'C',gender:'남',ageGroup:'40대'})),clubName:'E2E'},
    write:(k,v)=>values[k]=JSON.parse(JSON.stringify(v)),read:(k,f)=>values[k]??f,localStorage:{removeItem:k=>delete values[k]},
    ownerLink:()=>null,persist(){},message:s=>ctx.messageText=s,panels:s=>ctx.panel=s,reviewQuestions:()=>q,
    api:async data=>{ctx.calls++;ctx.session={...ctx.session,answers:{...ctx.session.answers,...data.answers}};return ctx.session;},calls:0};
  vm.createContext(ctx);
  vm.runInContext(code.slice(code.indexOf('  const draftKey='),code.indexOf("  $('ownerReturn').onclick=")),ctx);
  ctx.startBatch();
  return {ctx,$,values,buttons,vote:async value=>$('choices').onclick({target:{closest:()=>({dataset:{vote:value}})}})};
}
async function run(f){
  const {ctx,$,vote,buttons}=f;
  assert($('previousQuestion').disabled);
  assert.equal($('quizProgress').value,0);assert.equal($('quizProgress').max,2);
  await vote('a');assert.equal(ctx.at,1);assert.equal(ctx.calls,0);
  assert.equal($('quizProgress').value,1);
  $('previousQuestion').onclick();assert.equal(ctx.at,0);
  assert.equal($('quizProgress').value,1,'navigation must not erase response progress');
  assert.equal(buttons[0]['aria-pressed'],'true');
  await vote('tie');assert.equal(ctx.answers.q0,'tie');
  await vote('a');assert.equal(ctx.answers.q1,'b','flipped side must retain canonical identity');
  assert.equal(ctx.calls,0,'final selection does not submit');assert(!$('finishReview').hidden);
  $('previousQuestion').onclick();assert.equal(ctx.at,1);
  await vote('skip');assert.equal(ctx.answers.q1,'skip');
  assert.equal($('quizProgress').value,2,'skip counts as completed, not as skill evidence');
  assert.equal($('contribution').textContent,'2명의 실력을 1번 비교했어요.');
  ctx.startBatch();assert(!$('finishReview').hidden,'completed local draft remains editable');
  await $('saveAnswers').onclick();assert.equal(ctx.calls,1);assert.equal(ctx.panel,'done');
  assert.equal(ctx.session.answers.q0,'tie');assert.equal(ctx.session.answers.q1,'skip');
  assert($('doneText').textContent.includes('2명의 실력을 1번 비교했어요.'));
  assert(!$('editAnswers').hidden);
  $('editAnswers').onclick();assert.equal(ctx.at,0);assert.equal(buttons[2]['aria-pressed'],'true');
  await vote('b');$('nextQuestion').onclick();
  await $('saveAnswers').onclick();
  assert.equal(ctx.session.answers.q0,'b');assert.equal(ctx.session.answers.q1,'skip');
  assert.equal(Object.keys(ctx.session.answers).length,2,'correction overwrites instead of adding votes');
  ctx.session.closed=true;ctx.showOwnerReturn();assert($('editAnswers').hidden);
}
(async()=>{
  await run(fixture());
  await assert.rejects(run(fixture(source.replace('at--;renderQuestion();','renderQuestion();'))));
  await assert.rejects(run(fixture(source.replace("v&&v!=='skip'","v"))));
  console.log('skill answer navigation: back, selected answer, final confirmation, draft resume, saved correction, canonical sides, closed session, mutation passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
