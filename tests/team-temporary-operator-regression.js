const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const teamSrc = fs.readFileSync(path.join(root, 'js', 'team.js'), 'utf8');
const liveSrc = fs.readFileSync(path.join(root, 'js', 'live-view.js'), 'utf8');
const teamHtml = fs.readFileSync(path.join(root, 'team.html'), 'utf8');

function functionSource(src, name, nextName) {
  const start = src.indexOf(`function ${name}`);
  const end = src.indexOf(`function ${nextName}`, start + 1);
  const endAsync = end >= 6 && src.slice(end-6, end) === 'async ' ? end-6 : end;
  assert(start >= 0 && end > start, `${name} 함수 범위를 찾을 수 있어야 합니다.`);
  return src.slice(start,endAsync);
}

assert(teamHtml.includes('id="teamTemporaryOperatorPanel"'),
  '상단 운영 보드에 자유대진 운영 도우미 영역이 있어야 합니다.');
assert(!teamHtml.includes('matchDirectorPanel'), '경기이사 정·부 지정 영역은 제거되어야 합니다.');
assert(!teamSrc.includes('matchDirectors'), '관리자 상태에서 경기이사 정·부 모델을 제거해야 합니다.');
assert(!teamSrc.includes('경기이사'), '관리자 안내에서 경기이사 표현을 제거해야 합니다.');
assert(!liveSrc.includes('isDirector'), '회원 권한에서 경기이사 플래그를 제거해야 합니다.');
assert(!liveSrc.includes('directorRole'), '승패 감사정보에서 경기이사 정·부 역할을 제거해야 합니다.');

const normalizeCode = `
const TEAM_TEMPORARY_OPERATOR_MAX=4;
${functionSource(teamSrc, '_teamNormalizeOfficial', '_teamNormalizeTemporaryOperators')}
${functionSource(teamSrc, '_teamNormalizeTemporaryOperators', '_teamResolveTemporaryOperators')}
this.api={normalize:_teamNormalizeTemporaryOperators};`;
const normalizeSandbox = {};
vm.createContext(normalizeSandbox);
vm.runInContext(normalizeCode, normalizeSandbox);
const normalized = value => JSON.parse(JSON.stringify(value));

const fiveOperators = [
  {memberId:'m1',name:'하나'},
  {memberId:'m1',name:'중복'},
  {memberId:'m2',name:'둘'},
  {memberId:'m3',name:'셋'},
  {memberId:'m4',name:'넷'},
  {memberId:'m5',name:'다섯'}
];
assert.deepStrictEqual(normalized(normalizeSandbox.api.normalize(fiveOperators)), [
  {memberId:'m1',name:'하나'},
  {memberId:'m2',name:'둘'},
  {memberId:'m3',name:'셋'},
  {memberId:'m4',name:'넷'}
], '운영 도우미는 회원 ID 중복 없이 최대 4명이어야 합니다.');

const resolveCode = `
const TEAM_TEMPORARY_OPERATOR_MAX=4;
var temporaryOperators=[];
function _teamEnsureMemberId(player){return String(player&&player.memberId||'');}
${functionSource(teamSrc, '_teamNormalizeOfficial', '_teamNormalizeTemporaryOperators')}
${functionSource(teamSrc, '_teamNormalizeTemporaryOperators', '_teamResolveTemporaryOperators')}
${functionSource(teamSrc, '_teamResolveTemporaryOperators', 'setTeamTemporaryOperator').replace(/\s*async\s*$/,'')}
this.api={
  set(value){temporaryOperators=value;},
  resolve(players){return _teamResolveTemporaryOperators(players);},
  state(){return JSON.parse(JSON.stringify(temporaryOperators));}
};`;
const resolveSandbox = {};
vm.createContext(resolveSandbox);
vm.runInContext(resolveCode, resolveSandbox);
resolveSandbox.api.set([
  {memberId:'same-1',name:'동명이인'},
  {memberId:'official',name:'정식임원'},
  {memberId:'guest',name:'게스트'}
]);
const resolved = normalized(resolveSandbox.api.resolve([
  {memberId:'same-1',name:'동명이인'},
  {memberId:'same-2',name:'동명이인'},
  {memberId:'official',name:'정식임원',isClubOfficial:true},
  {memberId:'guest',name:'게스트',isGuest:true}
]));
assert.deepStrictEqual(resolved, [{memberId:'same-1',name:'동명이인'}],
  '정확한 회원 ID의 일반 회원만 운영 도우미로 남아야 합니다.');
assert.deepStrictEqual(normalized(resolveSandbox.api.state()), [{memberId:'same-1',name:'동명이인'}],
  '정식 임원과 게스트 권한은 자동 정리되어야 합니다.');

const fixedStart = liveSrc.indexOf('function _usesFixedTeams');
const fixedEnd = liveSrc.indexOf('const content=', fixedStart);
assert(fixedStart >= 0 && fixedEnd > fixedStart, '_usesFixedTeams 함수 범위를 찾을 수 있어야 합니다.');
const permissionCode = `${liveSrc.slice(fixedStart, fixedEnd)}
var viewer=null;
function _viewerInfo(){return viewer;}
function _isTeamLiveData(d){return !!d&&d.kind==='teamLive';}
${functionSource(liveSrc, '_canSubmitResult', '_resultRoleForSubmit')}
${functionSource(liveSrc, '_resultRoleForSubmit', 'submitLiveWin').replace(/\s*async\s*$/,'')}
${liveSrc.slice(liveSrc.indexOf('function _settled(m)'), liveSrc.indexOf('function _matchKey'))}
this.api={
  can(m,d,v){viewer=v;return _canSubmitResult(m,d);},
  role(m,d,v){viewer=v;return _resultRoleForSubmit(d,m);}
};`;
const permissionSandbox = {};
vm.createContext(permissionSandbox);
vm.runInContext(permissionCode, permissionSandbox);

const openMatch={t1:['선수1','선수2'],t2:['선수3','선수4'],win:null};
const doneMatch={...openMatch,win:'t1'};
const free={kind:'teamLive',matchMode:'free',isTeam:false};
const team={kind:'teamLive',matchMode:'team',isTeam:true};
const helper={id:'helper',n:'도우미',isTemporaryOperator:true};

assert.strictEqual(permissionSandbox.api.can(openMatch,free,helper),true,
  '자유대진 운영 도우미는 전체 경기 승패를 입력할 수 있어야 합니다.');
// 2026-08-14 계약 갱신: 운영 도우미는 **팀전에서도** 둘 수 있습니다(운영자
// "꼭 필수는 아니니까 설정해둬도 좋을 듯"). 단장 혼자 여러 코트를 돌지 않아도 됩니다.
assert.strictEqual(permissionSandbox.api.can(openMatch,team,helper),true,
  '팀전에서도 운영 도우미는 승패를 입력할 수 있어야 합니다.');
assert.strictEqual(permissionSandbox.api.can(openMatch,team,{n:'단장',isLeader:true}),true,
  '청홍팀전 단장은 기존 전체 경기 권한을 유지해야 합니다.');
assert.strictEqual(permissionSandbox.api.can(openMatch,free,{n:'단장',isLeader:true}),false,
  '자유대진에서는 과거 단장 플래그로 전체 권한을 주면 안 됩니다.');
assert.strictEqual(permissionSandbox.api.can(openMatch,free,{n:'선수1'}),true,
  '선수는 자기 경기 결과를 입력할 수 있어야 합니다.');
assert.strictEqual(permissionSandbox.api.can(openMatch,free,{n:'일반회원'}),false,
  '일반 회원은 다른 경기 결과를 입력할 수 없어야 합니다.');
assert.strictEqual(permissionSandbox.api.can(openMatch,free,{n:'임원',isClubOfficial:true}),true,
  '클럽 임원은 자유대진 전체 경기 권한을 유지해야 합니다.');
assert.strictEqual(permissionSandbox.api.can(doneMatch,free,helper),false,
  '운영 도우미도 완료 결과를 임의 정정할 수 없어야 합니다.');
assert.strictEqual(permissionSandbox.api.role(openMatch,free,helper),'temporaryOperator',
  '운영 도우미 입력은 별도 감사 역할로 기록해야 합니다.');

const memberCode = `${functionSource(liveSrc, '_normalizeMembers', '_sortMembers')}
${functionSource(liveSrc, '_allLiveMembers', '_viewerInfo')}
this.api={all:_allLiveMembers};`;
const memberSandbox = {};
vm.createContext(memberSandbox);
vm.runInContext(memberCode, memberSandbox);
const members = normalized(memberSandbox.api.all({
  members:{blue:[],red:[],all:[
    {id:'same-1',n:'동명이인'},
    {id:'same-2',n:'동명이인'},
    {id:'m3',n:'일반회원'}
  ]},
  officials:{temporaryOperators:[{memberId:'same-1',name:'동명이인'}]}
}));
assert.strictEqual(members.find(p=>p.id==='same-1').isTemporaryOperator,true,
  '지정한 회원 ID에만 운영 권한이 붙어야 합니다.');
assert.strictEqual(members.find(p=>p.id==='same-2').isTemporaryOperator,false,
  '동명이인의 다른 회원에게 운영 권한이 번지면 안 됩니다.');
assert.strictEqual(members.find(p=>p.id==='m3').isTemporaryOperator,false,
  '일반 회원에게 운영 권한이 번지면 안 됩니다.');

const setSource = functionSource(teamSrc, 'setTeamTemporaryOperator', 'grantTeamTemporaryOperator');
assert(setSource.includes("if(!_liveOn||!_liveId)"), '실제 LIVE 중에만 운영 도우미를 지정해야 합니다.');
assert(setSource.includes("ref('live/'+_liveId).update({"), '지정·해제는 현재 LIVE에 직접 저장해야 합니다.');
assert(setSource.includes('officials:state.officials'), '권한 원본을 Firebase에 즉시 반영해야 합니다.');
assert(setSource.includes('members:state.members'), '열린 회원 화면의 권한 표시도 즉시 갱신해야 합니다.');
assert(!setSource.includes('scheduleSave()'), '임시 권한을 가대진 자동저장에 포함하면 안 됩니다.');

const saveSource = functionSource(teamSrc, 'saveState', 'slim');
const undoSource = functionSource(teamSrc, '_captureUndoSnapshot', '_updateUndoBtn');
assert(!saveSource.includes('temporaryOperators'), '임시 권한을 가대진 저장·내보내기에 포함하면 안 됩니다.');
assert(!undoSource.includes('temporaryOperators'), '임시 권한을 가대진 되돌리기에 포함하면 안 됩니다.');
assert(teamSrc.includes("temporaryOperators=_teamNormalizeTemporaryOperators(data.officials?.temporaryOperators)"),
  '앱 재실행 후 같은 LIVE를 이어갈 때 Firebase 권한을 복원해야 합니다.');
assert(teamSrc.includes('temporaryOperators=[];'), 'LIVE 종료와 초기화에서 임시 권한을 비워야 합니다.');

const submitSource = functionSource(liveSrc, 'submitLiveWin', '_resultSideLabel');
assert(submitSource.includes('.transaction(data=>'), '동시 승패 입력은 Firebase 트랜잭션으로 보호해야 합니다.');
assert(submitSource.includes('_canSubmitResult({...liveMatch,win:null},data)'),
  '저장 직전에 Firebase 최신 권한을 다시 확인해야 합니다.');
assert(submitSource.includes('permissionRevoked'), '해제된 오래된 화면의 입력을 거부해야 합니다.');
assert(submitSource.includes('resultConflicts'), '반대 결과 동시 입력은 관리자 확인 건으로 남겨야 합니다.');

const transactionCode = `
${liveSrc.slice(liveSrc.indexOf('function _settled(m)'), liveSrc.indexOf('function _matchKey'))}
var _viewerName='운영자',_viewerMemberId='helper';
var liveId='live-test',alerts=[],remoteData=null;
var window={_lastLiveData:null};
var firebase={database:{ServerValue:{TIMESTAMP:12345}}};
function alert(message){alerts.push(message);}
function hydrateLiveViewerName(){}
function _matchKey(m){return (m.round||0)+'_'+(m.court||0);}
function _attKey(name){return String(name||'');}
function _isTeamLiveData(d){return !!d&&d.kind==='teamLive';}
function _usesFixedTeams(d){return !!(d&&(d.matchMode==='team'||d.isTeam===true));}
${functionSource(liveSrc, '_normalizeMembers', '_sortMembers')}
${functionSource(liveSrc, '_allLiveMembers', '_viewerInfo')}
${functionSource(liveSrc, '_viewerInfo', '_findViewerByName')}
${functionSource(liveSrc, '_canSubmitResult', '_resultRoleForSubmit')}
${functionSource(liveSrc, '_resultRoleForSubmit', 'submitLiveWin').replace(/\s*async\s*$/,'')}
${submitSource.replace(/^function /,'async function ')}
var liveDb={ref(){
  return {
    async transaction(fn){
      const next=fn(remoteData);
      if(next===undefined)return {committed:false};
      remoteData=next;
      return {committed:true};
    },
    async set(){return true;}
  };
}};
this.api={
  async submit(local,remote){
    alerts=[];
    window._lastLiveData=JSON.parse(JSON.stringify(local));
    remoteData=JSON.parse(JSON.stringify(remote));
    await submitLiveWin(0,'t1');
    return {alerts:[...alerts],remote:JSON.parse(JSON.stringify(remoteData))};
  }
};`;
const transactionSandbox = {};
vm.createContext(transactionSandbox);
vm.runInContext(transactionCode, transactionSandbox);

const liveBase = {
  kind:'teamLive',
  matchMode:'free',
  isTeam:false,
  currentRound:1,
  members:{blue:[],red:[],all:[
    {id:'helper',n:'운영자'},
    {id:'p1',n:'선수1'},
    {id:'p2',n:'선수2'},
    {id:'p3',n:'선수3'},
    {id:'p4',n:'선수4'}
  ]},
  officials:{temporaryOperators:[{memberId:'helper',name:'운영자'}]},
  matches:[{round:1,court:1,t1:['선수1','선수2'],t2:['선수3','선수4'],win:null}]
};

(async()=>{
  const granted = await transactionSandbox.api.submit(liveBase, liveBase);
  assert.strictEqual(granted.remote.matches[0].win,'t1',
    '운영 도우미의 승패 입력이 Firebase 최신 권한 확인 후 저장되어야 합니다.');
  assert.strictEqual(granted.remote.matches[0].winByRole,'temporaryOperator',
    '운영 도우미 입력은 감사 역할로 남아야 합니다.');

  const revokedRemote = JSON.parse(JSON.stringify(liveBase));
  revokedRemote.officials.temporaryOperators=[];
  const revoked = await transactionSandbox.api.submit(liveBase, revokedRemote);
  assert.strictEqual(revoked.remote.matches[0].win,null,
    '권한 해제 전 열린 화면으로 누른 승패는 저장되면 안 됩니다.');
  assert(revoked.alerts.some(message=>message.includes('운영 권한이 변경')),
    '권한 해제 직후 입력에는 이해 가능한 안내가 있어야 합니다.');

  console.log('team temporary operator regression ok');
})().catch(error=>{
  console.error(error);
  process.exit(1);
});
