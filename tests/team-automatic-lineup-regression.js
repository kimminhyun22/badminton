'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync(path.join(__dirname,'../js/team.js'),'utf8');
const fn=src.slice(src.indexOf('function _teamPrepareAutomaticLineup(){'),src.indexOf('function renderAutoFlowDashboard(){'));
function run(opts={}){
 const review={open:false};const c={_teamUsesFixedTeams:()=>!opts.free,_directPlayers:Array(opts.count??4).fill({}),currentMatches:opts.matches?[{}]:[],_liveOn:!!opts.live,_teamFinishedAt:opts.finished?1:null,teamAssignment:opts.assignment||null,document:{querySelector:()=>review},calls:0};
 c.doTeamAssign=()=>{c.calls++;c.teamAssignment={blue:[],white:[]};};vm.createContext(c);vm.runInContext(fn,c);c._teamPrepareAutomaticLineup();return {c,review};
}
let r=run();assert.equal(r.c.calls,1);assert(r.review.open);r.c._teamPrepareAutomaticLineup();assert.equal(r.c.calls,1);
const manual={blue:[{name:'E2E'}],white:[]};r=run({assignment:manual});assert.strictEqual(r.c.teamAssignment,manual);assert.equal(r.c.calls,0);assert(r.review.open);
for(const opts of [{free:true},{count:3},{matches:true},{live:true},{finished:true}])assert.equal(run(opts).c.calls,0);
assert(src.includes("if(!savedBracketRestore&&!_teamHasResumeLiveHint())_teamPrepareAutomaticLineup();"));
assert(src.includes("broadcast:_autoFlowAction('대진 게시','onLiveBtnClick','live-start')"));
console.log('team automatic lineup regression passed');
