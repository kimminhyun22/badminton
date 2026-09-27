'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(require('path').join(__dirname,'../js/daily.js'),'utf8');
function extract(name){
 const start=source.indexOf('async function '+name+'('),open=source.indexOf('{',start);let depth=0;
 for(let i=open;i<source.length;i++){if(source[i]==='{')depth++;if(source[i]==='}'&&!--depth)return source.slice(start,i+1);}
 throw Error(name);
}
(async()=>{
 for(const kind of ['Queue','Active'])for(const mode of ['cancel','decline','apply','stale']){
  let applied=0,confirmed=0,alerts=0;
  const p={id:'out',name:'선수가'},candidate={id:'in',name:'선수나'};
  const match={id:'m',court:1,team1:['out','b'],team2:['c','d'],startedAt:10};
  const c={_dailyQueue:[match],_dailyMatches:[match],_dailyCheckinId:'fixture',
   _dailyBlockPaused:()=>false,_dailyQueueLockCount:()=>1,_dailyPlayer:()=>p,
   _dailyQueueReplacementCandidates:()=>[candidate],_dailyActiveReplacementCandidates:()=>[candidate],
   _dailyActiveMatches:()=>[match],_dailyMatchPlayers:()=>[p],_dailyGenderLabel:()=> '남',_dailyQueuedPlayerLocation:()=>null,
   _dailyChooseReplacement:async(name,list)=>{assert.equal(name,p.name);assert.equal(list[0].player.id,'in');if(mode==='stale')match.team1[0]='changed';return mode==='cancel'?null:list[0];},
   confirm:msg=>{confirmed++;assert(msg.includes('선수가'));assert(msg.includes('선수나'));return mode!=='decline';},
   alert:()=>alerts++,dailyEditQueuePlayer:()=>applied++,
   _dailySendAdminCommand:async()=>{applied++;return {ok:true};}};
  const fn='dailyPick'+kind+'Replacement',code=extract(fn);assert(!code.includes('prompt('));
  vm.createContext(c);vm.runInContext(code,c);await c[fn]('m','team1',0);
  assert.equal(applied,mode==='apply'?1:0,kind+mode);
  assert.equal(confirmed,['decline','apply'].includes(mode)?1:0);
  assert.equal(alerts,mode==='stale'?1:0);
 }
 assert(!extract('dailyPickQueueReplacement').includes('.slice(0,12)'));
 console.log('PASS touch replacement: cancel, confirmation, apply, stale match, unlimited candidates');
})().catch(e=>{console.error(e);process.exit(1);});
