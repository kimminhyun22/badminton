'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
require('../js/match-quality');
require('../js/team-competition');
const recap=require('../js/team-prediction-recap');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js/team.js'),'utf8');
const admin=fs.readFileSync(path.join(root,'team.html'),'utf8');

function game(num,levels=[8,4,6,6]){
  const players=levels.map((rating,i)=>({name:'선수'+num+'-'+i,skillRating:rating}));
  return {matchNumber:num,round:1,court:num,team1A:players[0],team1B:players[1],team2C:players[2],team2D:players[3]};
}
const rows=[game(1),game(2,[5.2,5.2,5,5]),game(3,[5.1,5.1,5,5]),game(4),game(5),game(6),game(7)];
const roster=rows.flatMap(m=>[m.team1A,m.team1B,m.team2C,m.team2D]);
const clone=x=>JSON.parse(JSON.stringify(x));
const wins={0:'t2',1:'t2',2:'t1',3:'t2',4:'t2',6:'t1'};

// A non-published tournament gets its snapshot strictly before any wins, in the generation path.
recap.recordDraw(rows,roster);
const draft=recap.snapshot();
assert.equal(draft.source,'draw');
assert.deepEqual(draft.rows.map(row=>row.expected),['t2','t1','close','t2','t2','t2','t2']);
assert.equal(recap.preparePublication(rows,roster,'FRESH1',true,true),draft);
const frozen=recap.preparePublication(rows,roster,'FRESH1',true,false);
assert.equal(frozen.liveId,'FRESH1');
assert.equal(frozen.source,'publication');
recap.restore(frozen);
const results=clone(rows);
results[0].court=11;
results[0].team1A.skillRating=99; // Never score the finished lineup retrospectively.
[results[1].team1A,results[1].team1B]=[results[1].team1B,results[1].team1A];
results[3].team2C.name='교체 선수';
results[4].voided=true;
results[6].forfeit=true;
assert.deepEqual(recap.summarize(frozen,results,wins),{expected:1,upset:1,close:1,changed:1,unplayed:3});
assert.match(recap.text(frozen,results,wins),/우세 예상 2경기 중 예상대로 1 · 반전 1 · 접전 예상 1경기/);
assert.equal(recap.preparePublication(results,roster,'FRESH1',false,true),frozen);
assert.equal(recap.preparePublication(results,roster,'OTHER1',true,false).unavailable,true);
assert.deepEqual(recap.summarize(clone(frozen),results,wins),recap.summarize(frozen,results,wins));
results[3].team2C.name=rows[3].team2C.name;
assert.equal(recap.summarize(frozen,results,wins).changed,0); // Reverted change; originals played.
const ambiguous=recap.capture(rows,[...roster,roster[0]],'draw');
assert.equal(recap.summarize(ambiguous,rows,wins).changed,1);
const duplicate=clone(rows);
duplicate[1].matchNumber=1;
assert.equal(recap.summarize(frozen,duplicate,wins).changed,2);
assert.equal(recap.summarize({...frozen,version:0},rows,wins),null);

const el={hidden:false,description:{},querySelector(){return this.description;},
  classList:{toggle(name,hide){assert.equal(name,'hidden');el.hidden=!!hide;}}};
recap.render(el,rows,{},true,false);
assert.equal(el.hidden,true);
recap.setOfficialFinish(true);
recap.render(el,rows,wins,true,false);
assert.equal(el.hidden,false);
recap.setOfficialFinish(false);
recap.render(el,rows,wins,true,false);
assert.equal(el.hidden,true);
recap.render(el,rows,Object.fromEntries(rows.map((_,i)=>[i,'t2'])),true,false);
assert.equal(el.hidden,false);
recap.render(el,rows,wins,false,true);
assert.equal(el.hidden,true);
recap.reset();
recap.restore(null,true);
assert.equal(recap.preparePublication(rows,roster,'FRESH1',true,false).unavailable,true);
assert.equal(recap.summarize(recap.snapshot(),rows,wins),null);
recap.render(el,rows,wins,true,true);
assert.match(el.description.textContent,/경기 전 예측 기록이 없습니다/);

// Execute the actual publishing entry point, including a failed update, retry, and resumed archive.
const start=source.slice(source.indexOf('async function startLiveBroadcast(){'),source.indexOf('function _teamStoredLiveMatchesCurrentBracket'));
async function run(){
  let published,server=null,failWrite=true,failRead=false;
  const ctx={KokTeamPredictionRecap:recap,currentMatches:rows,currentParticipants:roster,currentSettings:{teamMode:true},
    _liveId:null,_rsvpId:null,_liveMatchStartedAt:null,_teamFinishedAt:null,_liveOn:false,temporaryOperators:[],
    _genLiveId:()=>'FRESH1',_duplicateNames:()=>[],_fbInit:()=>true,_teamValidateLiveDataForCurrent:()=>true,
    _isMatchDone:()=>false,_currentBracketRsvpId:()=>null,_teamNormalizeTemporaryOperators:()=>[],
    _buildLiveState:()=>({matches:[{num:1}]}),
    _fbDb:{ref:()=>({once:async()=>{if(failRead)throw Error('read');return {exists:()=>!!server,val:()=>server};},
      update:async data=>{if(failWrite)throw Error('update');published=data;server=data;}})}};
  for(const fn of ['_rsvpEnsureCurrentEventLink','_teamAdoptServerMatchesAndRender','_teamResolveTemporaryOperators',
    '_bindLiveAdminListener','_renderLiveOpsSummary','_teamSaveLiveId','_updateLiveUI','saveState','rsvpPushEventState','alert'])ctx[fn]=()=>{};
  vm.createContext(ctx);
  vm.runInContext(start,ctx);
  recap.reset();
  recap.recordDraw(rows,roster);
  const before=recap.snapshot();
  await ctx.startLiveBroadcast();
  assert.equal(recap.snapshot(),before);
  assert.equal(ctx._liveMatchStartedAt,null);
  failWrite=false;failRead=true;
  await ctx.startLiveBroadcast();
  assert.equal(published,undefined);
  assert.equal(ctx._liveMatchStartedAt,null);
  failRead=false;
  await ctx.startLiveBroadcast();
  assert.equal(recap.snapshot().source,'publication');
  assert.equal(Object.hasOwn(published,'predictionBaseline'),false);
  const memo=recap.snapshot();
  await ctx.startLiveBroadcast();
  assert.equal(recap.snapshot(),memo);
  recap.reset();
  server={matchStartedAt:100,matches:[{num:1,win:'t2'}]};
  await ctx.startLiveBroadcast();
  assert.equal(recap.snapshot().unavailable,true);
  console.log('PASS team-prediction-recap — frozen win-only forecasts, changed/void games, close band, admin visibility, private publish/retry and legacy restore');
}
const body=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to,source.indexOf(from)+from.length));
assert.match(body('function saveState()', 'function slim('),/predictionBaseline:globalThis.KokTeamPredictionRecap/);
assert.match(body('function restoreState(', 'function getSlots('),/restore\(state.predictionBaseline/);
assert.match(body('currentMatches=matches;currentParticipants=participants;currentSettings=settings;', 'scheduleSave();'),/recordDraw\(matches,participants\)/);
for(const [from,to] of [['function _buildLiveState()', 'function _liveKey('],['function _rsvpEventPayload()', 'async function rsvpPushEventState('],['function _rsvpSessionPayload()', 'function rsvpSaveLocal(']]){
  const payload=body(from,to);assert.ok(payload.length>20);assert.doesNotMatch(payload,/predictionBaseline|PredictionRecap/);
}
assert.match(admin,/id="teamPredictionRecap"/);
assert.doesNotMatch(fs.readFileSync(path.join(root,'view.html'),'utf8'),/team-prediction-recap|teamPredictionRecap/);
run().catch(error=>{console.error(error);process.exitCode=1;});
