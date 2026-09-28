'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const {ageFromYear,merge,build}=require('../js/roster-image-import');
const {analyzeParticipantImages,rosterImagePrompt}=require('../functions/daily-image-import');
assert.equal(ageFromYear('90',2026),'30대');assert.equal(ageFromYear('1978',2026),'40대');
assert.equal(ageFromYear('00',2026),'20대');assert.equal(ageFromYear('70',2026),'50대');
assert.equal(ageFromYear('',2026),'');assert.equal(ageFromYear('용인',2026),'');
const raw={members:[{name:'E2E가',birthYear:'90',grade:'D',sourceText:'E2E가/90/D/지역'},{name:'E2E나',grade:'A',sourceText:'E2E나/지역/A'}]};
let rows=merge([],raw,2026);assert.equal(rows.length,2);assert.equal(rows[0].gender,'');assert.equal(rows[1].ageGroup,'');
assert.equal(merge([],{members:[{name:'E2E가',gender:'남',sourceText:'E2E가/90/C'}]},2026)[0].gender,'','gender without textual evidence is not accepted');
assert.equal(merge([],{members:[{name:'E2E가',gender:'여',sourceText:'E2E가/90/C/여'}]},2026)[0].gender,'여');
assert.equal(merge(rows,raw,2026).length,2,'overlapping images are deduped');
assert.throws(()=>build({clubs:[]},'','E2E클럽',rows,()=>4,()=>1),/성별/);
rows=rows.map(r=>({...r,gender:'여',ageGroup:'40대'}));
const current={clubs:[{id:'c',name:'E2E기존',members:[{name:'E2E가',grade:'S',gender:'남',level:6,skillStep:4,isClubOfficial:true}]}]};
const before=JSON.stringify(current);let id=0;
const out=build(current,'c','',rows,()=>3,()=>++id);
assert.equal(out.added,1);assert.equal(out.skipped,1);assert.equal(JSON.stringify(current),before);
assert.deepStrictEqual(out.data.clubs[0].members[0],current.clubs[0].members[0]);
assert.equal(out.data.clubs[0].members[1].isClubOfficial,false);
assert.throws(()=>build(current,'gone','',rows,()=>3,()=>1),/없어졌/);
assert.throws(()=>build(current,'','E2E기존',rows,()=>3,()=>1),/같은 이름/);
const conflict=merge(rows,{members:[{name:'E2E가',grade:'B',gender:'남',sourceText:'E2E가/B/남'}]},2026);
assert(conflict[0].conflicts.includes('grade'));assert.equal(conflict[0].grade,'');
assert.throws(()=>build({clubs:[]},'','E2E클럽',conflict,()=>3,()=>1),/확인/);
const ctx={module:{exports:{}}};vm.runInNewContext(fs.readFileSync('js/roster-image-import.js','utf8').replace("if(explicitGender(row.sources[0])!==row.gender)row.gender='';",''),ctx);
assert.notEqual(ctx.module.exports.merge([],{members:[{name:'E2E가',gender:'남',sourceText:'E2E가/C'}]},2026)[0].gender,'','gender-evidence mutation caught');
assert(rosterImagePrompt().includes('사진으로 성별/연령/실력을 추측하지'));
const source=fs.readFileSync('js/roster-image-import.js','utf8');
const deletion=source.match(/const remove=button\('삭제',\(\)=>\{([\s\S]*?)\n        \},head\)/)[1];
function checkDeletion(code){
  const row={name:'E2E가'},other={name:'E2E나'};
  const context={busy:false,confirm:()=>false,rows:[row,other],row,i:0,notice:{},render:()=>{}};
  vm.runInNewContext('(function(){'+code+'})()',context);
  assert.equal(context.rows.length,2,'cancel preserves draft');
  context.confirm=()=>true;context.busy=true;
  vm.runInNewContext('(function(){'+code+'})()',context);
  assert.equal(context.rows.length,2,'busy preserves draft');
  context.busy=false;vm.runInNewContext('(function(){'+code+'})()',context);
  assert.deepStrictEqual(context.rows,[other],'only selected draft row removed');
}
checkDeletion(deletion);
assert.throws(()=>checkDeletion(deletion.replace('rows.splice(i,1);','')),'deletion mutation must fail');
(async()=>{
  let body;
  const result=await analyzeParticipantImages({mode:'roster',images:[{mimeType:'image/png',data:'YWJj'}],projectId:'test',accessToken:'test',fetchImpl:async(url,opts)=>{
    body=JSON.parse(opts.body);return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(raw)}]}}]})};
  }});
  assert.deepStrictEqual(result,raw);assert(body.generationConfig.responseSchema.properties.members);
  assert(body.contents[0].parts[0].text.includes('참석 신청/투표 여부는 판단하지'));
  await assert.rejects(()=>analyzeParticipantImages({mode:'bad'}),/invalid-mode/);
  for(const file of ['index.html','team.html']){
    const html=fs.readFileSync(file,'utf8');
    for(const entry of ['openRosterImageImport()','js/roster-image-import.js','js/daily-image-import.js','firebase-app-check-site-key'])assert(html.includes(entry),file+': '+entry);
  }
  console.log('roster screenshot draft, missing data, merge, append-only, mode routing passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
