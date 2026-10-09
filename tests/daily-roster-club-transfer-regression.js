'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const text=fs.readFileSync('js/daily.js','utf8');
const source=text.slice(text.indexOf('async function importDailySelected(){'),text.indexOf('/* ═══ TEAM NAME CHANGE ═══ */'));
async function run(code){
 const members=[{name:'E2Enew',skillRating:-.123},{name:'E2Eexisting',skillRating:4.567}],existing={id:'existing',name:'E2Eexisting',status:'planned',clubId:'stale'};
 const ctx={_dailyPlayers:[existing],rosters:{clubs:[{id:'e2e-scope',name:'E2E',members}]},_dailyImportClubIdx:0,_dailySessionClubName:'',_dailyCheckinId:null,_dailyNext:null,document:{querySelectorAll:()=>members.map((_,i)=>({checked:true,value:String(i)}))},_dailyBlockServerSync:()=>false,_dailyCanChangeRoster:()=>true,_rsvpMemberId:p=>p.name,_dailyNormalize:p=>({...p}),_dailyNormalizeStatus:s=>s,_dailyApplyPlayerStatus:(p,s)=>p.status=s,_dailyMarkLiveAddition:()=>{},_dailyPruneForeignDormantCarryover:()=>0,closeDailyImportModal:()=>{},dailySave:()=>{},dailyRender:()=>{},dailyMaybeAutoAssign:()=>{},alert:()=>{}};
 vm.createContext(ctx);vm.runInContext(code,ctx);await ctx.importDailySelected();
 assert.equal(ctx._dailyPlayers.length,2);for(const m of members){const p=ctx._dailyPlayers.find(x=>x.name===m.name);assert.equal(p.clubId,'e2e-scope');assert.equal(p.skillRating,m.skillRating);assert.equal(p.status,'wait');}assert.equal(existing.id,'existing');
}
(async()=>{await run(source);await assert.rejects(run(source.replace('clubId:club.id,','')));await assert.rejects(run(source.replace('existing.clubId=refreshed.clubId;','')));console.log('daily roster transfer: new/reactivated players preserve club scope and raw rating; both scope mutations caught');})().catch(e=>{console.error(e);process.exitCode=1});
