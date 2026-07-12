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
  assert(start >= 0 && end > start, `${name} 함수 범위를 찾을 수 있어야 합니다.`);
  return src.slice(start, end);
}

assert(teamHtml.includes('id="matchDirectorPanel"'), '참가자 확인에 경기이사 지정 영역이 있어야 합니다.');
assert(teamSrc.includes("roleRow('primary','정','정')"), '정 경기이사를 별도로 선택할 수 있어야 합니다.');
assert(teamSrc.includes("roleRow('deputy','부','부')"), '부 경기이사를 별도로 선택할 수 있어야 합니다.');
assert(teamSrc.includes('정·부 모두 승패 입력 가능'), '두 경기이사의 권한을 관리자에게 명확히 안내해야 합니다.');
assert(teamSrc.includes('officials: _teamSerializeOfficials()'), '자동저장과 되돌리기에 두 경기이사를 포함해야 합니다.');
assert(teamSrc.includes('state.officials?.deputyMatchDirector'), '구형 호환 부 경기이사도 복원해야 합니다.');
assert(teamSrc.includes('matchDirectors=_teamEmptyMatchDirectors()'), '초기화 시 두 경기이사 권한을 제거해야 합니다.');
assert(teamSrc.includes('matchDirectors:{primary:primaryOfficial,deputy:deputyOfficial}'), 'LIVE payload에 정·부 경기이사를 포함해야 합니다.');
assert(teamSrc.includes('matchDirector:primaryOfficial||deputyOfficial'), '구버전 LIVE용 단일 경기이사 키를 유지해야 합니다.');
assert(teamSrc.includes('memberId:p.memberId||_teamEnsureMemberId(p),name:p.name'), '고정팀 배정에서도 회원 ID를 보존해야 합니다.');
assert(teamSrc.includes("club:p.club||'',isGuest"), '고정팀 배정에서도 회원 ID 원본인 클럽을 보존해야 합니다.');

const normalizeCode = `${functionSource(teamSrc, '_teamEmptyMatchDirectors', '_teamNormalizeOfficial')}
${functionSource(teamSrc, '_teamNormalizeOfficial', '_teamNormalizeMatchDirectors')}
${functionSource(teamSrc, '_teamNormalizeMatchDirectors', '_teamSerializeOfficials')}
this.api={normalize:_teamNormalizeMatchDirectors};`;
const normalizeSandbox = {};
vm.createContext(normalizeSandbox);
vm.runInContext(normalizeCode, normalizeSandbox);
const normalized = value => JSON.parse(JSON.stringify(value));

assert.deepStrictEqual(normalized(normalizeSandbox.api.normalize(null,{memberId:'m1',name:'김정'})), {
  primary:{memberId:'m1',name:'김정'},deputy:{memberId:'',name:''}
}, '구형 단일 경기이사는 정 경기이사로 이관해야 합니다.');
assert.deepStrictEqual(normalized(normalizeSandbox.api.normalize(null,{memberId:'m1',name:'김정'},{memberId:'m2',name:'이부'})), {
  primary:{memberId:'m1',name:'김정'},deputy:{memberId:'m2',name:'이부'}
}, '호환 저장본의 부 경기이사도 복원해야 합니다.');
assert.deepStrictEqual(normalized(normalizeSandbox.api.normalize({
  primary:{memberId:'m1',name:'김정'},deputy:{memberId:'m1',name:'김정'}
})), {
  primary:{memberId:'m1',name:'김정'},deputy:{memberId:'',name:''}
}, '한 회원에게 정·부 역할이 중복되면 부 역할을 비워야 합니다.');

const setDirectorCode = `${normalizeCode.replace('this.api={normalize:_teamNormalizeMatchDirectors};','')}
var matchDirectors=_teamEmptyMatchDirectors();
var _directPlayers=[{memberId:'m1',name:'김정'},{memberId:'m2',name:'이부'}];
var currentMatches=[{}];
var _liveOn=false;
function _teamEnsureMemberId(p){return String(p&&p.memberId||'');}
function _captureUndoSnapshot(){}
function renderMatchDirectorPanel(){}
function scheduleSave(){}
function pushLiveState(){}
${functionSource(teamSrc, '_teamResolveMatchDirectors', '_teamMatchDirectorRole')}
${functionSource(teamSrc, 'setMatchDirector', 'renderMatchDirectorPanel')}
this.api={set:setMatchDirector,state:()=>JSON.parse(JSON.stringify(matchDirectors))};`;
const setDirectorSandbox = {};
vm.createContext(setDirectorSandbox);
vm.runInContext(setDirectorCode, setDirectorSandbox);
setDirectorSandbox.api.set('primary','m1');
setDirectorSandbox.api.set('deputy','m2');
setDirectorSandbox.api.set('primary','m2');
assert.deepStrictEqual(normalized(setDirectorSandbox.api.state()), {
  primary:{memberId:'m2',name:'이부'},deputy:{memberId:'m1',name:'김정'}
}, '이미 지정된 회원을 다른 역할로 고르면 정·부가 자연스럽게 교대해야 합니다.');

const fixedStart = liveSrc.indexOf('function _usesFixedTeams');
const fixedEnd = liveSrc.indexOf('const content=', fixedStart);
assert(fixedStart >= 0 && fixedEnd > fixedStart, '_usesFixedTeams 함수 범위를 찾을 수 있어야 합니다.');
const resultRoleSource = functionSource(liveSrc, '_resultRoleForSubmit', 'submitLiveWin').replace(/\s*async\s*$/,'');
const permissionCode = `${liveSrc.slice(fixedStart, fixedEnd)}
var viewer=null;
function _viewerInfo(){return viewer;}
function _isTeamLiveData(d){return !!d&&d.kind==='teamLive';}
${functionSource(liveSrc, '_canSubmitResult', '_resultRoleForSubmit')}
${resultRoleSource}
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
const primary={n:'김정',isDirector:true,directorRole:'primary'};
const deputy={n:'이부',isDirector:true,directorRole:'deputy'};

assert.strictEqual(permissionSandbox.api.can(openMatch,free,primary),true, '정 경기이사는 자유대진 전체 승패를 입력할 수 있어야 합니다.');
assert.strictEqual(permissionSandbox.api.can(openMatch,team,deputy),true, '부 경기이사는 청홍팀전 전체 승패를 입력할 수 있어야 합니다.');
assert.strictEqual(permissionSandbox.api.can(openMatch,team,{n:'단장',isLeader:true}),true, '단장은 청홍팀전 전체 경기 권한을 유지해야 합니다.');
assert.strictEqual(permissionSandbox.api.can(openMatch,free,{n:'단장',isLeader:true}),false, '자유대진에서 과거 단장 플래그만으로 전체 권한을 주면 안 됩니다.');
assert.strictEqual(permissionSandbox.api.can(openMatch,free,{n:'선수1'}),true, '선수는 자기 경기 결과를 입력할 수 있어야 합니다.');
assert.strictEqual(permissionSandbox.api.can(openMatch,free,{n:'일반회원'}),false, '일반 회원은 다른 경기 결과를 입력할 수 없어야 합니다.');
assert.strictEqual(permissionSandbox.api.can(doneMatch,free,deputy),false, '부 경기이사도 완료 결과를 임의 정정할 수 없어야 합니다.');
assert.strictEqual(permissionSandbox.api.role(openMatch,free,primary),'director', '기존 감사 역할 director를 유지해야 합니다.');
assert.strictEqual(permissionSandbox.api.role(openMatch,free,deputy),'director', '부 경기이사도 기존 감사 역할 director로 기록해야 합니다.');

const memberCode = `${functionSource(liveSrc, '_normalizeMembers', '_sortMembers')}
${functionSource(liveSrc, '_allLiveMembers', '_viewerInfo')}
this.api={all:_allLiveMembers};`;
const memberSandbox = {};
vm.createContext(memberSandbox);
vm.runInContext(memberCode, memberSandbox);
const members = normalized(memberSandbox.api.all({
  members:{blue:[],red:[],all:[
    {id:'m1',n:'김정'},{id:'m2',n:'이부'},{id:'m3',n:'김정'},{id:'m4',n:'일반'}
  ]},
  officials:{matchDirectors:{
    primary:{memberId:'m1',name:'김정'},deputy:{memberId:'m2',name:'이부'}
  }}
}));
assert.strictEqual(members.find(p=>p.id==='m1').directorRole,'primary', '회원 ID로 정 경기이사 권한을 복원해야 합니다.');
assert.strictEqual(members.find(p=>p.id==='m2').directorRole,'deputy', '회원 ID로 부 경기이사 권한을 복원해야 합니다.');
assert.strictEqual(members.find(p=>p.id==='m3').isDirector,false, '동명이인의 다른 회원에게 권한이 번지면 안 됩니다.');
assert.strictEqual(members.find(p=>p.id==='m4').isDirector,false, '일반 회원에게 경기이사 권한이 번지면 안 됩니다.');

const legacyMembers = normalized(memberSandbox.api.all({
  members:{blue:[],red:[],all:[{id:'m1',n:'구형이사'}]},
  officials:{matchDirector:{memberId:'m1',name:'구형이사'}}
}));
assert.strictEqual(legacyMembers[0].directorRole,'primary', '구형 LIVE의 단일 경기이사는 정 역할로 읽어야 합니다.');

assert(liveSrc.includes("localStorage.setItem(_viewerStorageKey()+'_member',_viewerMemberId)"), '본인 확인 회원 ID를 LIVE별로 보존해야 합니다.');
assert(liveSrc.includes("if(playerId&&officialId)return playerId===officialId"), 'ID가 있는 회원은 이름 fallback으로 권한을 얻으면 안 됩니다.');
assert(liveSrc.includes('winByDirectorRole=directorRole'), '승패 감사정보에 정·부 역할을 별도로 남겨야 합니다.');
assert(liveSrc.includes('단장/부단장·경기이사'), '권한 안내에 경기이사를 포함해야 합니다.');
const submitSource = functionSource(liveSrc, 'submitLiveWin', '_resultSideLabel');
assert(submitSource.includes('.transaction(data=>'), '동시 승패 입력은 Firebase 트랜잭션으로 보호해야 합니다.');
assert(submitSource.includes('resultConflicts'), '반대 결과 동시 입력은 관리자 확인 건으로 남겨야 합니다.');

const exportBracketSource = functionSource(teamSrc, 'exportBracketJson', 'importBracketJson');
const exportAllSource = functionSource(teamSrc, 'exportBracketAll', 'importBracketAll');
assert(exportBracketSource.includes('saveState();'), '대진표 내보내기 전에 최신 경기이사 지정을 저장해야 합니다.');
assert(exportAllSource.includes('saveState();'), '전체 백업 전에 최신 경기이사 지정을 저장해야 합니다.');

console.log('team match director regression ok');
