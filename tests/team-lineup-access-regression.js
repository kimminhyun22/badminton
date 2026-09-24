'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync(path.join(__dirname,'../js/team.js'),'utf8');
const code=src.slice(src.indexOf('function movePlayer('),src.indexOf('let _teamModeOverride='));
function run({locked=false,accept=true}={}){
 const ctx={_teamBlockFullReassignment:()=>locked,teamAssignment:{blue:[{name:'E2EA'},{name:'E2EB'},{name:'E2EC'}],white:[{name:'E2ED'},{name:'E2EE'}]},currentMatches:[{}],confirm:()=>accept,getPartnerOf:()=>null,alert:()=>{},_captureUndoSnapshot:()=>{},captains:{blue:{},white:{}},renderTeamList:()=>{},generate:o=>ctx.generated=o,scheduleSave:()=>{}};
 vm.createContext(ctx);vm.runInContext(code,ctx);ctx.movePlayer('E2EA','white');return ctx;
}
assert.equal(run({locked:true}).teamAssignment.blue.length,3);
assert.equal(run({accept:false}).teamAssignment.blue.length,3);
const moved=run();assert.equal(moved.teamAssignment.blue.length,2);assert.equal(moved.teamAssignment.white.length,3);assert(moved.generated.skipExistingConfirm&&moved.generated.skipUndoSnapshot);
assert(src.includes("if(target==='team'){"));
assert(fs.readFileSync(path.join(__dirname,'../team.html'),'utf8').includes('id="teamLineupOpenBtn"'));
console.log('team lineup access regression passed');
