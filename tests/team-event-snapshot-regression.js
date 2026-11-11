'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('js/team.js','utf8');
function cut(src,name){const start=src.indexOf('function '+name+'('),end=src.indexOf('\nfunction ',start+1);assert(start>=0&&end>start);return src.slice(start,end);}
function check(src=source){
 const old={memberId:'e2e-a',name:'E2E가',skillRating:3.5,grade:'C',gender:'M',ageGroup:'40대'},next={...old,skillRating:4.2};
 const c={_directPlayers:[next],currentSettings:{skillScoresFrozen:true},teamAssignment:{blue:[{...old}],white:[]},currentParticipants:[{...old}],currentMatches:[{team1A:{...old}}],_teamRecalcMatchLevels(){},_teamApplyDirectProfileToPlayer(p,map){if(!p)return false;p.skillRating=map.get(p.name).skillRating;return true;}};
 vm.createContext(c);vm.runInContext(cut(src,'_teamSyncGeneratedProfilesFromDirectPlayers'),c);
 const before=JSON.stringify([c.teamAssignment,c.currentParticipants,c.currentMatches]);
 assert.equal(c._teamSyncGeneratedProfilesFromDirectPlayers(),false);
 assert.equal(JSON.stringify([c.teamAssignment,c.currentParticipants,c.currentMatches]),before,'a later official rating cannot rewrite existing games');
 c.currentMatches=[];assert.equal(c._teamSyncGeneratedProfilesFromDirectPlayers(),true);assert.equal(c.teamAssignment.blue[0].skillRating,4.2,'pre-bracket team preview accepts the next rating');
 const start=src.indexOf('const settings={',src.indexOf('function generate(')),end=src.indexOf('\n  };',start);
 assert(src.slice(start,end).includes('skillScoresFrozen:true'),'new brackets carry the persisted snapshot contract');
 const expression=src.match(/teamAssignment=(state.settings\?\.skillScoresFrozen[^;]+);/)[1];
 const state={settings:{skillScoresFrozen:true},teamAssignment:{blue:[old],white:[]},directPlayers:[next],participants:[old]};
 const restored=vm.runInNewContext(expression,{state,_directPlayers:[next],_teamEnrichAssignmentProfiles:()=>({blue:[next],white:[]})});
 assert.equal(restored.blue[0].skillRating,3.5,'restore retains recorded event rating');
 assert.notEqual(restored,state.teamAssignment,'restored snapshot is independently owned');
 c.currentMatches=[{team1A:{...old}}];c.currentSettings={};c.window={teamEventProtectsBracket:()=>true};
 assert.equal(c._teamSyncGeneratedProfilesFromDirectPlayers(),false,'older bracket also preserves ratings when an event updates the official roster');
}
check();
const mutant=source.replace("if(typeof currentSettings!=='undefined'&&currentSettings?.skillScoresFrozen&&currentMatches.length)return false;",'');
assert.notEqual(mutant,source);assert.throws(()=>check(mutant),assert.AssertionError,'mutation exposes live rating overwrite');
console.log('team event rating snapshot: generated matches immutable, pre-bracket refresh, persisted restore and mutation passed');
