'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/team.js'),'utf8');
const source=src.slice(src.indexOf("let _teamReassignmentNotice="),src.indexOf('function doTeamAssign('));
const results=[];
function makeElement(){const s=new Set();return {textContent:'',value:'',hidden:true,disabled:false,dataset:{},classList:{add:x=>s.add(x),remove:x=>s.delete(x),contains:x=>s.has(x)},setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];}};}
function harness(sourceText=source){
 const elements={};for(const id of ['teamAssignStatus','teamReshuffleStatus','teamAssignBtn','teamReassignBtn','teamReshuffleBtn','loadingOverlay','loadingText','errBar','courts','gamesPerPlayer','s1_0','s2_0'])elements[id]=makeElement();
 elements.loadingText.textContent='original';elements.courts.value='1';elements.gamesPerPlayer.value='4';
 let generationResolve;const selected={matches:[{round:9}],participants:[{name:'E2Eselected'}],settings:{teamMode:true}};
 const state={assigned:0,generated:0,saves:0,painted:0,published:0};
 const ctx={Promise,setTimeout,console:{error:()=>{}},document:{getElementById:id=>elements[id]},
 _liveLate:{a:1},_liveParty:{b:1},_liveResultInputs:{c:1},_liveResultConflicts:{d:1},_liveSubstitutions:[1],liveWinAt:{e:1},_liveMatchStartedAt:null,
 _directPlayers:[{name:'E2E0'}],_partners:[],captains:{},winOverride:{},_lockedBeforeRound:null,temporaryOperators:[{name:'E2Eop'}],
 teamAssignment:{blue:[{name:'E2E0'}],white:[{name:'E2E1'}]},currentMatches:[{round:1}],currentParticipants:[{name:'E2E0'}],currentSettings:{teamMode:true,courts:1},
 _undoStack:Array.from({length:20},(_,i)=>({label:'E2E'+i})),_teamWanted:true,_teamModeOverride:null,
 _teamFullReassignmentLocked:()=>false,_teamBlockFullReassignment:()=>false,_teamConfirmDetachLiveBeforeChange:()=>true,_teamConfirmOverwriteGeneratedBracket:()=>true,
 _captureUndoSnapshot:()=>{ctx._undoStack.push({label:'new'});ctx._undoStack.shift();},hideErr:()=>{},hideWarn:()=>{},_updateUndoBtn:()=>{},updateScores:()=>{},updateTeamModeBadge:()=>{},renderTeamList:()=>{},scheduleSave:()=>state.saves++,
 renderResults:()=>{elements.teamReshuffleBtn=makeElement();elements.teamReshuffleBtn.disabled=vm.runInContext('_teamAssignmentBusy',ctx);elements.teamReshuffleStatus=makeElement();elements.teamReshuffleStatus.textContent=vm.runInContext('_teamReshuffleMessage',ctx);elements.teamReshuffleStatus.hidden=!elements.teamReshuffleStatus.textContent;},
 doTeamAssign:opts=>{state.assigned++;opts.onCandidate(selected);ctx.teamAssignment={blue:[{name:'E2E1'}],white:[{name:'E2E0'}]};return true;},
 generate:opts=>{state.generated++;state.options=opts;return new Promise(resolve=>{generationResolve=resolve;});}};
 vm.createContext(ctx);vm.runInContext(sourceText,ctx);
 ctx._teamAssignmentPaint=async()=>{await new Promise(r=>setTimeout(r,0));state.painted++;};
 return {ctx,elements,state,selected,finish(ok,result={changed:true,beforeScore:70,score:75}){if(state.options.onResult)state.options.onResult(result);generationResolve(ok);}};
}
const tick=()=>new Promise(r=>setTimeout(r,10));
(async()=>{
 // Current candidate identity, duplicate guard, delayed completion, and replaced button.
 const h=harness(),{ctx,elements,state}=h,before={matches:ctx.currentMatches,participants:ctx.currentParticipants,settings:ctx.currentSettings,teams:ctx.teamAssignment};
 const work=ctx.doTeamAssignFromUI({bracketOnly:true});
 assert(elements.teamReshuffleBtn.disabled);assert.equal(elements.teamReshuffleBtn['aria-busy'],'true');assert.equal(elements.teamReshuffleStatus.dataset.state,'busy');assert(!elements.teamReshuffleStatus.hidden);
 assert.equal(await ctx.doTeamAssignFromUI({bracketOnly:true}),false);
 await tick();assert.equal(state.generated,1);assert.equal(state.assigned,0);assert.equal(state.options.preserveCandidate.matches,before.matches);assert.equal(state.options.preserveCandidate.participants,before.participants);assert.equal(state.options.preserveCandidate.settings,before.settings);
 const oldButton=elements.teamReshuffleBtn;ctx.currentMatches=[{round:2}];ctx.renderResults();assert.notEqual(elements.teamReshuffleBtn,oldButton);assert(elements.teamReshuffleBtn.disabled);
 h.finish(true);assert.equal(await work,true);assert(!elements.teamReshuffleBtn.disabled);assert.equal(elements.teamReshuffleBtn['aria-busy'],undefined);assert(!elements.loadingOverlay.classList.contains('on'));assert(elements.teamReshuffleStatus.textContent.includes('70'));assert(elements.teamReshuffleStatus.textContent.includes('75'));assert.equal(ctx.teamAssignment,before.teams);
 results.push('bracket-only preserve identity + busy duplicate + new DOM reenable');
 // A persistent result survives another quality render.
 const message=elements.teamReshuffleStatus.textContent;ctx.renderResults();assert.equal(elements.teamReshuffleStatus.textContent,message);assert(!elements.teamReshuffleStatus.hidden);
 for(let i=0;i<2;i++){const p=ctx.doTeamAssignFromUI({bracketOnly:true});await tick();h.finish(true,{changed:false,beforeScore:75,score:75});assert.equal(await p,true);assert(!elements.teamReshuffleBtn.disabled);assert(elements.teamReshuffleStatus.textContent.includes('유지'));}
 results.push('second/third operation + persistent unchanged notice');
 const u=harness(),undo=u.ctx._undoStack.slice(),ms=u.ctx.currentMatches;const uw=u.ctx.doTeamAssignFromUI({bracketOnly:true});await tick();u.finish(true,{changed:false,beforeScore:75,score:75});assert.equal(await uw,true);assert.equal(u.ctx.currentMatches,ms);assert.deepEqual(u.ctx._undoStack,undo);results.push('unchanged candidate exact undo preservation');
 // The selected team-comparison candidate is handed to generation, without replacement.
 const s=harness(),sw=s.ctx.doTeamAssignFromUI();await tick();assert.equal(s.state.assigned,1);assert.strictEqual(s.state.options.preferredCandidate,s.selected);assert.equal(s.state.options.preserveCandidate,null);s.finish(true);assert.equal(await sw,true);results.push('selected candidate exact object handoff');
 // Simulate failed generation after local commit; then ensure original refs and full history.
 const e=harness(),eBefore={teams:e.ctx.teamAssignment,matches:e.ctx.currentMatches,participants:e.ctx.currentParticipants,settings:e.ctx.currentSettings,undo:e.ctx._undoStack.slice(),late:e.ctx._liveLate,party:e.ctx._liveParty,inputs:e.ctx._liveResultInputs,conflicts:e.ctx._liveResultConflicts,subs:e.ctx._liveSubstitutions,operators:e.ctx.temporaryOperators};
 const ew=e.ctx.doTeamAssignFromUI({bracketOnly:true});await tick();e.ctx.currentMatches=[{round:99}];e.ctx.currentParticipants=[];e.ctx.currentSettings={};e.ctx._liveLate={};e.ctx._liveParty={};e.ctx._liveResultInputs={};e.ctx._liveResultConflicts={};e.ctx._liveSubstitutions=[];e.ctx.temporaryOperators=[];e.ctx.renderResults();e.finish(false);assert.equal(await ew,false);
 for(const [field,key]of [['teamAssignment','teams'],['currentMatches','matches'],['currentParticipants','participants'],['currentSettings','settings'],['_liveLate','late'],['_liveParty','party'],['_liveResultInputs','inputs'],['_liveResultConflicts','conflicts'],['_liveSubstitutions','subs']])assert.strictEqual(e.ctx[field],eBefore[key],field);
 assert.deepEqual(e.ctx.temporaryOperators,eBefore.operators);assert.deepEqual(e.ctx._undoStack,eBefore.undo);assert(!e.elements.teamReshuffleBtn.disabled);assert(!e.elements.teamReshuffleStatus.hidden);assert(e.elements.teamReshuffleStatus.textContent.includes('완료하지 못했습니다'));results.push('postcommit failure full ref/undo rollback and visible error');
 const retry=e.ctx.doTeamAssignFromUI({bracketOnly:true});await tick();e.finish(true,{changed:false,beforeScore:75,score:75});assert.equal(await retry,true);results.push('retry after rollback');
 // Detect mutations inside existing objects, including a team edit after our
 // own staged assignment. Preserve the external state instead of undoing it.
 for(const edit of [c=>{c.teamAssignment.white.push(c.teamAssignment.blue.pop());},c=>{c._teamModeOverride=false;},c=>{c.currentMatches[0].round=12;},c=>{c.currentSettings.courts=9;}]){
   const x=harness();x.ctx._teamAssignmentPaint=async()=>{edit(x.ctx);};
   assert.equal(await x.ctx.doTeamAssignFromUI({bracketOnly:true}),false);assert.equal(x.state.generated,0);
   assert(x.elements.teamReshuffleStatus.textContent.includes('중단'));
 }
 const inplace=harness(),ip=inplace.ctx.doTeamAssignFromUI();await tick();
 inplace.ctx.teamAssignment.white.push(inplace.ctx.teamAssignment.blue.pop());
 const external=JSON.stringify(inplace.ctx.teamAssignment);
 assert.throws(()=>inplace.state.options.checkCurrent(),/상태가 변경/);inplace.finish(false);assert.equal(await ip,false);
 assert.equal(JSON.stringify(inplace.ctx.teamAssignment),external,'do not replace externally edited staged teams');
 const detached=harness();detached.ctx._teamConfirmDetachLiveBeforeChange=()=>false;
 assert.equal(await detached.ctx.doTeamAssignFromUI({bracketOnly:true}),false);assert.equal(detached.state.generated,0);
 results.push('in-place teams/mode/bracket/settings stale preservation and recovery-link guard');
 const handoffMutant=source.replace('preferredCandidate:selectedCandidate','preferredCandidate:null');assert.notEqual(handoffMutant,source);
 const bad=harness(handoffMutant),bp=bad.ctx.doTeamAssignFromUI();await tick();
 assert.notStrictEqual(bad.state.options.preferredCandidate,bad.selected,'removing exact handoff is observable');bad.finish(true);await bp;
 console.log(JSON.stringify({pass:results.length,results}));
})().catch(e=>{console.error(e);process.exitCode=1;});
