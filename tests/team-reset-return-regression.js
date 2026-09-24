const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const root=path.join(__dirname,'..');
const team=fs.readFileSync(path.join(root,'js/team.js'),'utf8');
const daily=fs.readFileSync(path.join(root,'js/daily.js'),'utf8');
const reset=team.slice(team.indexOf('async function resetAll()'),team.indexOf('/* ═══ DIRECT ENTRY ═══ */',team.indexOf('async function resetAll()')));
assert(reset.includes("location.replace('index.html?from=team-reset')"));
assert(reset.indexOf('await _rsvpClearActiveLinkData()')<reset.indexOf('location.replace('));
assert(reset.indexOf('if(!confirm(')<reset.indexOf('location.replace('));
const fn=daily.slice(daily.indexOf('function dailyApplyTeamResetReturn()'),daily.indexOf('function renderParticipantPreparation()'));
for(const active of [false,true]){
  const removed=[];const urls=[];
  const ctx={URL,location:{href:'https://example.test/index.html?from=team-reset'},
    history:{replaceState:(_a,_b,url)=>urls.push(url)},sessionStorage:{removeItem:key=>removed.push(key)},
    _dailyCheckinId:active?'live-1':'',_dailyOperationStarted:active,_dailyMatches:active?[{id:'m1'}]:[],
    _dailyPreparedOperation:'daily',_dailyPlayers:[{id:'p1'}]};
  vm.createContext(ctx);vm.runInContext(fn+';dailyApplyTeamResetReturn();',ctx);
  assert.equal(ctx._dailyPreparedOperation,active?'daily':'');
  assert.equal(removed.length,active?0:1);
  assert.equal(ctx._dailyPlayers.length,1,'다른 운영 명단은 보존');
  assert.equal(ctx._dailyMatches.length,active?1:0);
  assert.deepEqual(urls,['/index.html'],'복귀 지시를 한 번만 사용');
}
assert(daily.includes('  dailyApplyTeamResetReturn();'),'실제 부팅에 연결');
console.log('team reset return regression ok');
