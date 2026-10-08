'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');const src=fs.readFileSync('js/daily.js','utf8'),html=fs.readFileSync('index.html','utf8');
const cut=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)+a.length));
const nodes={};for(const id of ['participantPrepRoster','participantPrepRosterList','participantPrepRosterCount','participantPrepCount','participantPrepRegisterMeta','participantPrepHint','participantChooseDaily','participantChooseTeam'])nodes[id]={};
let saved=0;const c={_dailyPlayers:[{id:'b',name:'나',status:'planned'},{id:'a',name:'가',status:'wait'},{id:'gone',name:'취소됨',registrationCancelled:true}],_dailyPreparedOperation:'',_dailyOperationStarted:false,_dailyPaused:false,_dailyCheckinId:null,_dailyQueue:[],_dailyPairSelectId:null,_dailyNext:null,
 document:{getElementById:id=>nodes[id]||null},sessionStorage:{removeItem:()=>{}},esc:s=>String(s),_dailyNormalizeStatus:s=>s,
 _dailyBlockServerSync:()=>false,_dailyCanChangeRoster:()=>true,_dailyIsQueued:()=>false,_dailyIsLockedQueued:()=>false,_dailyCancelReservationsForPlayer:()=>{},confirm:()=>true,alert:()=>{},dailySave:()=>saved++,dailyEnsureQueue:()=>{}};
c._dailyPlayer=id=>c._dailyPlayers.find(p=>p.id===id);vm.createContext(c);vm.runInContext(cut('function renderParticipantPreparation(','function dailyChooseOperation(')+cut('async function dailyRemovePlayer(','function dailyReset('),c);c.dailyRender=()=>c.renderParticipantPreparation();
(async()=>{
 c.dailyRender();assert.equal(nodes.participantPrepRosterCount.textContent,'2명');assert(!nodes.participantPrepRosterList.innerHTML.includes('취소됨'));
 assert(nodes.participantPrepRosterList.innerHTML.indexOf('data-player-id="a"')<nodes.participantPrepRosterList.innerHTML.indexOf('data-player-id="b"'),'Sorted display keeps identity');
 assert(nodes.participantPrepRosterList.innerHTML.includes('dailyRemovePlayer(this.dataset.playerId)'),'Use existing guarded removal');
 await c.dailyRemovePlayer('a');assert.equal(saved,1);assert.equal(nodes.participantPrepRosterCount.textContent,'1명');assert(!c._dailyPlayers.some(p=>p.id==='a'));assert(!nodes.participantPrepRosterList.innerHTML.includes('data-player-id="a"'));
 c.confirm=()=>false;await c.dailyRemovePlayer('b');assert(c._dailyPlayers.some(p=>p.id==='b'),'Cancelled confirmation keeps player');
 c._dailyPlayers[0].currentMatchId='active';c.dailyRender();assert(nodes.participantPrepRosterList.innerHTML.includes('disabled'));c.confirm=()=>true;await c.dailyRemovePlayer('b');assert(c._dailyPlayers.some(p=>p.id==='b'),'Playing player remains');
 c._dailyPlayers=[];c.dailyRender();assert(nodes.participantPrepRoster.hidden);assert(nodes.participantChooseTeam.disabled);
 assert(html.includes('id="participantPrepRosterList"'));assert(html.includes('참가 명단 확인 · 취소'));
 const mutant=src.replace('onclick="dailyRemovePlayer(this.dataset.playerId)"','onclick=""');const checkConnection=code=>assert(code.includes('onclick="dailyRemovePlayer(this.dataset.playerId)"'),'Missing working removal connection');checkConnection(src);assert.throws(()=>checkConnection(mutant),/Missing working removal connection/);console.log('participant preparation cancellation, identity, persistence call, active-game guards and mutation passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
