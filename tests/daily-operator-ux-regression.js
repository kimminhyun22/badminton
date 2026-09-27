'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.join(__dirname,'..');
const daily=fs.readFileSync(path.join(root,'js/daily.js'),'utf8');
const member=fs.readFileSync(path.join(root,'checkin.html'),'utf8');
function fn(source,name){
  const re=new RegExp(`(?:async )?function ${name}\\(`),start=source.search(re);
  assert(start>=0,name);
  const open=source.indexOf('{',start);let depth=0;
  for(let i=open;i<source.length;i++){
    if(source[i]==='{')depth++;
    if(source[i]==='}'&&--depth===0)return source.slice(start,i+1);
  }
  throw new Error('Unclosed function '+name);
}
function load(source,name,context){vm.createContext(context);vm.runInContext(fn(source,name),context);return context[name];}
const players=[{id:'a',name:'가회원',status:'wait'},{id:'b',name:'나임원',status:'playing',isClubOfficial:true},{id:'c',name:'하운영',status:'wait',isTemporaryOfficial:true}];
const admin={_dailyPlayerSort:'name',_dailyPlayerTool:'helper'};
const sort=load(daily,'_dailySortPlayersForManage',admin);
assert.deepStrictEqual(Array.from(sort(players),p=>p.id),['c','b','a']);
admin._dailyPlayerTool='';assert.deepStrictEqual(Array.from(sort(players),p=>p.id),['a','b','c']);
assert.deepStrictEqual(players.map(p=>p.id),['a','b','c'],'원본 선수 순서는 바꾸지 않습니다.');
const official={session:{players},officialOverviewMode:'helper'};
const list=load(member,'officialOverviewPlayers',official);
assert.deepStrictEqual(Array.from(list('current'),p=>p.id),['c','b','a']);
official.officialOverviewMode='';assert.deepStrictEqual(Array.from(list('current'),p=>p.id),['a','b','c']);
for(const [src,name] of [[daily,'_dailyPlayerRowActions']]){
  const row=load(src,name,{_dailyPaused:false,_dailyNormalizeStatus:x=>x,_dailyPlayerTool:''});
  const html=row({id:'a',status:'playing'});
  assert(html.includes('>휴식</button>')&&html.includes('>종료</button>'));
  assert(!html.includes('경기 후'));
}
for(const name of ['index.html','team.html']){
 const html=fs.readFileSync(path.join(root,name),'utf8');
 assert.strictEqual((html.match(/href="skill-review.html\?from=/g)||[]).length,1);
 assert(html.indexOf('main-balance-entry')<html.indexOf('class="nav-bar"'),'메인 상단에 상시 노출');
}
const officialRow=load(member,'officialOverviewStatusButtons',{
 eventFlowPaused:()=>false,sendingKey:'',claimingOfficial:false,officialOverviewMode:'',esc:x=>x
});
const officialHtml=officialRow({id:'actor'},{id:'p',status:'playing'},'current');
assert(officialHtml.includes('>휴식</button>')&&officialHtml.includes('>종료</button>'));
assert(!officialHtml.includes('경기 후'));
(async()=>{
 for(const status of ['rest','done'])for(const accept of [false,true]){
  let sent=0,asked=0;
  const p={id:'p',name:'시험선수',status:'playing',currentMatchId:'m'};
  const c={_dailyBlockServerSync:()=>false,_dailyBlockPaused:()=>false,_dailyPlayer:()=>p,
    _dailyNormalizeStatus:x=>x,_dailyCheckinId:'fixture',confirm:text=>{asked++;assert(text.includes('경기가 끝난 뒤'));return accept;},
    _dailySendAdminCommand:async()=>{sent++;return {live:true,ok:true};}};
  await load(daily,'dailySetStatus',c)('p',status);
  assert.equal(asked,1);assert.equal(sent,accept?1:0);assert.equal(p.status,'playing');
  sent=0;asked=0;
  const d={officialActor:()=>({id:'actor',name:'임원'}),document:{getElementById:()=>null},session:{players:[p]},
    compactLabel:x=>({rest:'휴식',done:'종료'}[x]||x),confirm:c.confirm,
    pushOfficialRequest:async()=>{sent++;return false;},OFFICIAL_OPERATION_TTL_MS:10000};
  await load(member,'sendOfficialPlayerStatus',d)('actor',status,'p');
  assert.equal(asked,1);assert.equal(sent,accept?1:0);
 }
 const self=load(member,'confirmStatusChange',{getSelectedStatus:()=> 'playing',confirm:text=>{assert(text.includes('경기가 끝난 뒤'));return false;}});
 assert.equal(self({name:'본인',status:'playing'},'rest'),false);
 console.log('operator sorting, concise status labels, confirmation cancel/accept, main quiz entry ok');
})().catch(e=>{console.error(e);process.exit(1);});
