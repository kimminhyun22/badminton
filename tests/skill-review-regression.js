'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
function context(core=read('js/skill-review-core.js')){
  const c={};vm.createContext(c);vm.runInContext(read('js/match-quality.js')+core,c);return c;
}
const {KokMatchQuality:Q,KokSkillReview:C}=context();
const server=require('../functions/daily-server-matchmaker');
let count=0;
for(const grade of ['S','A','B','C','D','E'])for(const gender of ['남','여','M','F'])for(const ageGroup of Object.keys(Q.skillPolicy.age))for(const skillStep of [-2,-1,0,1,2]){
  const player={grade,gender,ageGroup,skillStep};
  const level=Math.round((Q.gradeLevel(grade,gender)+skillStep*.2)*10)/10;
  const result=Q.skillBreakdown(player);
  assert.equal(result.total,Q.effectiveLevel({...player,level}));
  assert.equal(result.total,server.effectiveLevel({...player,level}));
  assert.equal(Q.skillBreakdown({...player,level}).total,result.total,'stored adjustment applied once');
  assert.equal(C.preview({...player,level}).total,result.total,'100% trial preserves production');
  assert(Math.abs(result.base+result.gender+result.age+result.personal-result.total)<1e-8);
  count++;
}
assert.equal(C.preview(C.profile(),{ageScale:0,genderScale:0}).total,4);
assert.equal(Q.skillBreakdown({grade:'C',gender:'남'}).missing,true);
assert.equal(Q.skillBreakdown({grade:'C',gender:'남',ageGroup:'40대',level:4.4,skillStep:2}).personal,.4);
assert.equal(C.pair([C.profile('A'),C.profile('C')]).sum,C.pair([C.profile('B'),C.profile('B')]).sum);
assert.equal(C.pair([C.profile('A'),C.profile('C')]).gap,2);
const make=(id='r-12345678',value=-1)=>({version:C.version,policyId:Q.skillPolicy.id,scope:'E2E survey',respondent:id,answers:{[C.questions[0].id]:value}});
const one=C.merge([], [make(),make()]);assert.equal(one.length,1,'duplicate files');
assert.throws(()=>C.merge(one,[make('r-12345678',1)]),/같은 응답자/);
assert.equal(one[0].answers[C.questions[0].id],-1,'conflict must not mutate existing');
assert.throws(()=>C.validate({...make(),policyId:'future'}));
assert.throws(()=>C.validate({...make(),answers:{bad:0}}));
assert.throws(()=>C.validate({...make(),answers:{[C.questions[0].id]:0.5}}));
assert.throws(()=>C.validate({...make(),answers:{}}));
assert.throws(()=>C.validate({...make(),scope:''}));
assert.equal(C.summarize([make('r-12345678',null)])[0].n,0,'unknown is not an even vote');
assert.equal(C.summarize([make('r-12345678',null)])[0].unknown,1);
assert.equal(C.summarize(one)[0].state,'응답 부족');
const five=Array.from({length:5},(_,i)=>make('r-1234567'+i));
assert.equal(C.summarize(five)[0].state,'의견 모임');
five[0]=make('r-12345670',2);five[1]=make('r-12345671',0);
assert.equal(C.summarize(five)[0].state,'의견 나뉨');
assert.equal(C.merge(one,[{...make(),scope:'other'}]).length,2,'independent survey scopes');
// Mutation proof: count duplicate respondents and this assertion must fail.
const mutant=context(read('js/skill-review-core.js').replace('return [...map.values()];','return incoming;')).KokSkillReview;
assert.throws(()=>assert.equal(mutant.merge([], [make(),make()]).length,1));
for(const page of ['index.html','team.html'])assert(read(page).includes('href="skill-review.html?from='));
const ui=read('js/skill-review.js');
assert(!ui.includes('firebase'),'No production server writes');
assert(!/localStorage\.setItem\(['"]badminton_rosters/.test(ui),'No roster writes');
assert(ui.includes('data.records.some(r=>r.scope!==scope)'));
assert(!read('js/match-quality.js').includes('localStorage'),'Production policy cannot read trial settings');
console.log(`skill review: ${count} profile/server parity cases, trial isolation, survey validation, atomic deduplication and mutation passed`);
