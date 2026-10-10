'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../js/team.js'),'utf8');
const ui=source.slice(source.indexOf("let _teamReassignmentNotice="),source.indexOf('function doTeamAssign('));
function harness({existing=false,locked=false,accept=true,fail='',sourceText=ui}={}){
  const elements={};
  for(const id of ['teamAssignStatus','teamAssignBtn','teamReassignBtn','loadingOverlay','loadingText','errBar']){
    const classes=new Set();elements[id]={textContent:'',dataset:{},hidden:true,disabled:false,
      classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)},
      setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];}};
  }
  elements.loadingText.textContent='original loading';
  let generationResolve;const state={assigned:0,generated:0,saves:0,confirms:0,painted:0};
  const ctx={Promise,setTimeout,console:{error:()=>{}},document:{getElementById:id=>elements[id]},
    _liveLate:{},_liveParty:{},_liveResultInputs:{},_liveResultConflicts:{},_liveSubstitutions:[],liveWinAt:{},_liveMatchStartedAt:null,
    _directPlayers:[],_partners:[],captains:{},winOverride:{},_lockedBeforeRound:null,temporaryOperators:[],
    teamAssignment:{blue:[{name:'E2E0'}],white:[{name:'E2E1'}]},currentMatches:existing?[{round:1}]:[],
    currentParticipants:[{name:'E2E0'}],currentSettings:{courts:1},_undoStack:[],_teamWanted:true,_teamModeOverride:null,
    _teamFullReassignmentLocked:()=>locked,_teamBlockFullReassignment:()=>locked,_teamConfirmDetachLiveBeforeChange:()=>accept,_teamConfirmOverwriteGeneratedBracket:()=>{state.confirms++;return accept;},
    _captureUndoSnapshot:()=>ctx._undoStack.push({}),hideErr:()=>{elements.errBar.textContent='';},hideWarn:()=>{},
    _updateUndoBtn:()=>{},updateScores:()=>{},updateTeamModeBadge:()=>{},renderTeamList:()=>{},renderResults:()=>{},scheduleSave:()=>state.saves++,
    doTeamAssign:()=>{
      state.assigned++;assert(elements.loadingOverlay.classList.contains('on'),'show loader before calculation');
      assert(state.painted>0,'yield before calculation');
      if(fail==='assignment')throw Error('E2E comparison failed');
      ctx.teamAssignment={blue:[{name:'E2E1'}],white:[{name:'E2E0'}]};
      vm.runInContext("_teamReassignmentNotice='같은 팀안을 유지했습니다.'",ctx);return true;
    },
    generate:opts=>{
      state.generationOptions=opts;
      state.generated++;assert(opts.skipExistingConfirm&&opts.skipUndoSnapshot&&opts.cooperative);
      if(fail==='preflight')return false;
      return new Promise(resolve=>{generationResolve=resolve;});
    }};
  vm.createContext(ctx);vm.runInContext(sourceText,ctx);
  ctx._teamAssignmentPaint=async()=>{await new Promise(resolve=>setTimeout(resolve,0));state.painted++;};
  return {ctx,elements,state,finish:ok=>generationResolve(ok)};
}
async function cases(sourceText=ui){
  const a=harness({sourceText}),original=a.ctx.teamAssignment;
  const pending=a.ctx.doTeamAssignFromUI();
  assert(a.elements.teamReassignBtn.disabled,'disable synchronously');
  assert.equal(await a.ctx.doTeamAssignFromUI(),false,'ignore duplicate tap');
  assert.equal(await pending,true);assert.equal(a.state.assigned,1);assert.equal(a.state.generated,0);
  assert(a.elements.teamAssignStatus.textContent.includes('같은 팀안'));assert.equal(a.elements.teamAssignStatus.hidden,false);
  assert.equal(a.elements.teamReassignBtn.disabled,false);assert(!a.elements.loadingOverlay.classList.contains('on'));
  assert.equal(a.elements.loadingText.textContent,'original loading');assert.notEqual(a.ctx.teamAssignment,original);
  for(const opts of [{locked:true},{existing:true,accept:false}]){
    const c=harness({...opts,sourceText}),before=JSON.stringify([c.ctx.teamAssignment,c.ctx.currentMatches]);
    assert.equal(await c.ctx.doTeamAssignFromUI(),false);assert.equal(c.state.assigned,0);
    assert.equal(JSON.stringify([c.ctx.teamAssignment,c.ctx.currentMatches]),before);
  }
  for(const failure of ['assignment','preflight','generation']){
    const c=harness({existing:true,fail:failure,sourceText}),before=c.ctx.teamAssignment,oldMatches=c.ctx.currentMatches;
    const p=c.ctx.doTeamAssignFromUI();
    if(failure==='generation'){
      await new Promise(resolve=>setTimeout(resolve,10));
      assert(c.elements.teamReassignBtn.disabled,'wait for actual generation, not scheduling');
      assert(c.elements.loadingOverlay.classList.contains('on'));
      c.ctx.currentMatches=[{round:99}];c.finish(false);
    }
    assert.equal(await p,false);assert.equal(c.ctx.teamAssignment,before);assert.equal(c.ctx.currentMatches,oldMatches);
    assert.equal(c.ctx._undoStack.length,0);assert.equal(c.state.confirms,1);
    assert.equal(c.elements.teamAssignStatus.dataset.state,'error');assert.equal(c.elements.teamReassignBtn.disabled,false);
  }
  const c=harness({existing:true,sourceText}),p=c.ctx.doTeamAssignFromUI();
  await new Promise(resolve=>setTimeout(resolve,10));c.finish(true);
  assert.equal(await p,true);assert.equal(c.state.generated,1);assert.equal(c.ctx._undoStack.length,1);
  assert(c.elements.teamAssignStatus.textContent.includes('대진표에 반영했습니다'));
  // Full undo history must survive a failure even when capture shifts its head.
  const full=harness({existing:true,fail:'preflight',sourceText});
  full.ctx._undoStack=Array.from({length:20},(_,i)=>({label:'E2E'+i}));
  const undoBefore=JSON.stringify(full.ctx._undoStack);
  full.ctx._captureUndoSnapshot=()=>{full.ctx._undoStack.push({label:'failed'});full.ctx._undoStack.shift();};
  assert.equal(await full.ctx.doTeamAssignFromUI(),false);assert.equal(JSON.stringify(full.ctx._undoStack),undoBefore);
  // A newer external state must not be overwritten by the canceled work.
  const stale=harness({existing:true,sourceText}),newMatches=[{round:27}],newAssignment={blue:[],white:[]};
  stale.ctx._teamAssignmentPaint=async()=>{stale.ctx.currentMatches=newMatches;stale.ctx.teamAssignment=newAssignment;stale.ctx._undoStack.push({label:'new state'});};
  assert.equal(await stale.ctx.doTeamAssignFromUI(),false);assert.equal(stale.ctx.currentMatches,newMatches);
  assert.equal(stale.ctx.teamAssignment,newAssignment);assert.equal(stale.state.assigned,0);
  assert.equal(stale.ctx._undoStack[0].label,'new state');
  assert(stale.elements.teamAssignStatus.textContent.includes('상태가 변경'));
  // Cancel after team assignment, while generation awaits; restore only our
  // staged teams and retain an external edit and its undo entry.
  const late=harness({existing:true,sourceText}),oldTeams=late.ctx.teamAssignment,lateWork=late.ctx.doTeamAssignFromUI();
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.notEqual(late.ctx.teamAssignment,oldTeams);
  const externalUndo={label:'external'};late.ctx._undoStack.push(externalUndo);late.ctx._directPlayers.push({name:'E2E new'});
  assert.throws(()=>late.state.generationOptions.checkCurrent(),/상태가 변경/);
  late.finish(false);assert.equal(await lateWork,false);assert.equal(late.ctx.teamAssignment,oldTeams);
  assert.deepEqual(late.ctx._undoStack,[externalUndo]);assert.equal(late.ctx._directPlayers.length,1);
}
(async()=>{
  await cases();
  const mutant=ui.replace('  if(_teamAssignmentBusy)return false;','');assert.notEqual(mutant,ui);
  await assert.rejects(()=>cases(mutant),assert.AssertionError);
  const rollbackMutant=ui.replace('teamAssignment=before.assignment;','');assert.notEqual(rollbackMutant,ui);
  await assert.rejects(()=>cases(rollbackMutant));
  const saveGuard=source.slice(source.indexOf('function saveState(){'),source.indexOf('function saveState(){')+300);
  assert(saveGuard.indexOf('if(_teamAssignmentBusy)return;')<saveGuard.indexOf('_teamSaveRosterBridge();'));
  const build=require('./helpers/team-competition-context');
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/women-flex-roster.json')));
  const b=fixture.players.filter(p=>p.team==='청팀'),w=fixture.players.filter(p=>p.team==='홍팀');
  const sync=build(71),cooperative=build(71),settings={teamMode:true,gamesPerPlayer:4,courts:5};
  const expected=sync._teamJointAllocation(b,w,settings),before=JSON.stringify([b,w]);
  let pauses=0;
  vm.runInContext(ui.slice(ui.indexOf('async function _teamRunAssignmentComparison('),ui.indexOf('// Only user-facing')),cooperative);
  cooperative._teamAssignmentPaint=async()=>{pauses++;assert.equal(cooperative.Math.random,random,'seed override must not escape across yields');};
  const random=cooperative.Math.random,actual=await cooperative._teamRunAssignmentComparison(b,w,settings,[]);
  assert.deepEqual(JSON.parse(JSON.stringify(actual)),JSON.parse(JSON.stringify(expected)));
  assert.equal(JSON.stringify([b,w]),before);assert(pauses>=3);
  cooperative._teamAllocationBracket=()=>{throw Error('E2E preview');};
  await assert.rejects(()=>cooperative._teamRunAssignmentComparison(b,w,settings,[]),/E2E preview/);
  assert.equal(cooperative.Math.random,random);
  const html=fs.readFileSync(path.join(__dirname,'../team.html'),'utf8');
  for(const id of ['teamAssignBtn','teamReassignBtn'])assert(new RegExp('id="'+id+'" onclick="doTeamAssignFromUI\\(\\)"').test(html));
  assert(html.includes('id="teamAssignStatus"'));assert(source.includes("playerReview:_autoFlowAction('청·홍 배정','doTeamAssignFromUI')"));
  console.log('PASS reassignment feedback, duplicate/lock/cancel guards, async completion, failure rollback, unchanged seeded comparison and mutations');
})().catch(error=>{console.error(error);process.exit(1);});
