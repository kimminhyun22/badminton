const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.join(__dirname,'..');
const dailySrc=fs.readFileSync(path.join(root,'js','daily.js'),'utf8');
const checkinSrc=fs.readFileSync(path.join(root,'checkin.html'),'utf8');

function functionSource(src,name,nextName){
  const start=src.indexOf(`function ${name}`);
  const end=src.indexOf(`function ${nextName}`,start+1);
  const endAsync = end >= 6 && src.slice(end-6, end) === 'async ' ? end-6 : end;
  assert(start>=0&&end>start,`${name} 함수 범위를 찾을 수 있어야 합니다.`);
  return src.slice(start,endAsync);
}

const pruneSource=functionSource(dailySrc,'_dailyPruneForeignDormantCarryover','_dailyLoadAsNewDay');
const pruneSandbox={};
vm.createContext(pruneSandbox);
vm.runInContext(`
let _dailyPlayers=[];
let _dailyMatches=[];
let _dailyQueue=[];
let _dailyReservations=[];
function _dailyNormalizeStatus(status){return status||'wait';}
${pruneSource}
function player(id,club,status,stamp,index){
  return {
    id,name:'선수'+id,club,status,isGuest:false,games:status==='playing'&&index<12?1:0,
    mixedGames:0,typeTrackedGames:0,currentMatchId:status==='playing'?'m'+(index%4):'',
    joinedAt:stamp,lastStatusAt:stamp,waitFrom:stamp
  };
}
this.api={
  seed(){
    const carryStamp=1000;
    _dailyPlayers=[
      ...Array.from({length:43},(_,index)=>player('old'+index,'이전클럽','invited',carryStamp,index)),
      ...Array.from({length:43},(_,index)=>player('today'+index,'오늘클럽',index<16?'playing':'wait',2000+index,index))
    ];
    _dailyMatches=[];
    _dailyQueue=[];
    _dailyReservations=[];
  },
  prune:_dailyPruneForeignDormantCarryover,
  players:()=>_dailyPlayers.map(player=>({...player})),
  setTie(){
    _dailyPlayers=[
      ...Array.from({length:4},(_,index)=>player('a'+index,'A클럽','wait',2000+index,index)),
      ...Array.from({length:4},(_,index)=>player('b'+index,'B클럽','wait',3000+index,index)),
      ...Array.from({length:8},(_,index)=>player('old'+index,'이전클럽','invited',1000,index))
    ];
  }
};
`,pruneSandbox);

pruneSandbox.api.seed();
assert.strictEqual(pruneSandbox.api.prune(),43,'이전 날짜에서 일괄 승계된 다른 클럽 등록 전 명단은 제거해야 합니다.');
const prunedPlayers=pruneSandbox.api.players();
assert.strictEqual(prunedPlayers.length,43,'오늘 현장 등록한 43명만 관리자 원본에 남아야 합니다.');
assert(prunedPlayers.every(player=>player.club==='오늘클럽'),'현재 운영 중인 클럽 선수는 모두 보존해야 합니다.');

pruneSandbox.api.setTie();
assert.strictEqual(pruneSandbox.api.prune(),0,'두 클럽이 함께 실제 참가 중이면 임의로 한 클럽 명단을 지우면 안 됩니다.');

const newDaySource=functionSource(dailySrc,'_dailyLoadAsNewDay','dailyLoad');
assert(newDaySource.includes('_dailyPreparationState(s,now)'),'날짜 전환 시 진행 세션과 미시작 준비 명단을 구분해야 합니다.');
assert(newDaySource.includes('_dailyPreparationPlayers(s.players)'),'LIVE를 시작하지 않은 최근 준비 명단은 새날에도 보존해야 합니다.');
assert(newDaySource.includes('_dailyMatches=[]')&&newDaySource.includes('_dailyQueue=[]'),'준비 명단을 보존해도 이전 경기와 대기표는 새날에 승계하면 안 됩니다.');

// 후보를 클럽 하나로 좁히던 격리는 2026-08-11 실전에서 뒤집혔습니다 — 이름이
// 겹치는 클럽이 여럿이면 클럽 추정이 틀려 일만클럽 세션에 미르클럽 명부가
// 실렸습니다. 이제 격리 대신 **라벨**로 지킵니다: 모든 클럽을 클럽명과 함께
// 싣고, 오늘 명단과 겹침이 큰 클럽이 앞에 오며, 같은 이름은 앞선 클럽 것만.
const arrivalSource=functionSource(dailySrc,'_dailyOfficialArrivalCandidates','_dailyCheckinPayload');
assert(!arrivalSource.includes("String(player.club)===clubName"),'클럽 추정으로 후보를 좁히면 안 됩니다 — 추정이 틀리면 엉뚱한 명부가 실립니다.');
assert(arrivalSource.includes('_dailyOfficialArrivalRoster()')&&arrivalSource.includes('clubRank'),
  '겹침이 큰 클럽이 먼저 오도록 순서를 매겨야 합니다.');
assert(arrivalSource.includes('seenNames'),'같은 이름은 앞선 클럽 것만 남겨야 합니다.');
const importSource=functionSource(dailySrc,'importDailySelected','syncFixedTeamNames');
assert(importSource.includes('_dailyPruneForeignDormantCarryover()'),'다른 클럽 명부를 불러오면 앱 재실행 없이 이전 승계 명단을 정리해야 합니다.');

const identitySource=functionSource(checkinSrc,'memberIdentityPlayers','voteDeadlineText');
const identitySandbox={};
vm.createContext(identitySandbox);
vm.runInContext(`
let session={players:[]};
${identitySource}
this.api={
  setPlayers(players){session.players=players;},
  list:memberIdentityPlayers
};
`,identitySandbox);
const oldPlayers=Array.from({length:43},(_,index)=>({
  id:'old'+index,memberId:'old_member'+index,name:'이전'+index,status:'invited'
}));
const todayPlayers=Array.from({length:43},(_,index)=>({
  id:'today'+index,memberId:'today_member'+index,name:'오늘'+index,status:index<16?'playing':'wait'
}));
identitySandbox.api.setPlayers([...oldPlayers,...todayPlayers]);
assert.strictEqual(identitySandbox.api.list().length,43,'회원 내 이름 찾기에는 현장 등록된 오늘 선수만 보여야 합니다.');

identitySandbox.api.setPlayers([
  ...todayPlayers,
  {id:'late',memberId:'late_member',name:'오늘지각',status:'planned',preArrivalVisible:true},
  {id:'cancelled',memberId:'cancelled_member',name:'오등록취소',status:'planned',preArrivalVisible:false,registrationCancelled:true}
]);
assert.strictEqual(identitySandbox.api.list().length,44,'이번 세션에 도착 전 등록한 선수는 도착 전에도 이름을 찾아 실중계를 볼 수 있어야 합니다.');
assert(!identitySandbox.api.list().some(player=>player.registrationCancelled),'오등록 취소한 숨김 선수는 이름 찾기에서 다시 나타나면 안 됩니다.');

identitySandbox.api.setPlayers([
  {id:'a',memberId:'same',name:'동일회원',status:'wait'},
  {id:'b',memberId:'same',name:'동일회원 복제',status:'rest'},
  {id:'c',memberId:'done',name:'운동종료회원',status:'done'}
]);
const uniqueIdentityPlayers=identitySandbox.api.list();
assert.strictEqual(uniqueIdentityPlayers.length,2,'같은 명부 회원 ID가 중복 게시되어도 이름 찾기에는 한 번만 보여야 합니다.');
assert(uniqueIdentityPlayers.some(player=>player.status==='done'),'운동 종료 회원은 필요할 때 복귀할 수 있도록 이름 찾기에 남겨야 합니다.');

console.log('daily roster isolation regression ok');
