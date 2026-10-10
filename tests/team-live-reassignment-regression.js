'use strict';
const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const src=fs.readFileSync(require('path').join(__dirname,'../js/team.js'),'utf8');
const helpers=src.slice(src.indexOf('function _teamFullReassignmentLocked(){'),src.indexOf('function reshuffleMatches(){'));
for(const state of ['preparation','live','started','finished','scored']){
  const context={currentMatches:[{round:1}],_teamAssignmentBusy:false,_liveOn:state==='live',_liveMatchStartedAt:state==='started'?1:null,_teamFinishedAt:state==='finished'?1:null,_isMatchDone:()=>state==='scored',alert:()=>{}};
  vm.createContext(context);
  vm.runInContext(helpers,context);
  assert.equal(context._teamFullReassignmentLocked(),state!=='preparation',state);
  for(const name of ['reshuffleMatches','generate','doTeamAssign','_teamConfirmOverwriteGeneratedBracket']){
    const start=src.indexOf('function '+name+'(');
    const body=src.indexOf('{',src.indexOf('){',start));
    const lines=src.slice(body+1).trimStart().split('\n');
    // A read-only duplicate guard may precede the live-state guard. No mutation
    // or other statement may run before both safety exits have been considered.
    const count=lines[0].trim()==='if(_teamAssignmentBusy)return false;'?2:1;
    const guards=lines.slice(0,count).join('\n');
    assert(lines[count-1].includes('_teamBlockFullReassignment()'),name+' must guard before mutations');
    vm.runInContext('function attempt(){'+guards+'; throw new Error("mutation reached");}',context);
    if(state!=='preparation')assert.equal(context.attempt(),false,name+': '+state);
    else assert.throws(()=>context.attempt(),/mutation reached/);
  }
}
console.log('team live reassignment regression passed');
