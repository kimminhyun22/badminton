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
assert(teamSrc.includes("officials: {matchDirector:JSON.parse(JSON.stringify(matchDirector))}"),
  '자동저장과 되돌리기에 경기이사를 포함해야 합니다.');
assert(teamSrc.includes("state.officials?.matchDirector"), '저장된 경기이사를 복원해야 합니다.');
assert(teamSrc.includes("matchDirector={memberId:'',name:''}"), '초기화 시 경기이사 권한을 제거해야 합니다.');
assert(teamSrc.includes('id:_teamEnsureMemberId(p)'), 'LIVE 회원에는 안정적인 회원 ID가 있어야 합니다.');
assert(teamSrc.includes('isDirector:_teamIsMatchDirector(p)'), '지정된 회원에게 경기이사 플래그를 발행해야 합니다.');
assert(teamSrc.includes('officials:{matchDirector:'), 'LIVE payload에 경기이사 원본 정보를 포함해야 합니다.');

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
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(permissionCode, sandbox);

const openMatch={t1:['선수1','선수2'],t2:['선수3','선수4'],win:null};
const doneMatch={...openMatch,win:'t1'};
const free={kind:'teamLive',matchMode:'free',isTeam:false};
const team={kind:'teamLive',matchMode:'team',isTeam:true};

assert.strictEqual(sandbox.api.can(openMatch,free,{n:'경기이사',isDirector:true}),true,
  '경기이사는 자유대진의 모든 미완료 경기 승패를 입력할 수 있어야 합니다.');
assert.strictEqual(sandbox.api.can(openMatch,team,{n:'경기이사',isDirector:true}),true,
  '경기이사는 청홍팀전의 모든 미완료 경기 승패를 입력할 수 있어야 합니다.');
assert.strictEqual(sandbox.api.can(openMatch,team,{n:'단장',isLeader:true}),true,
  '단장은 청홍팀전 전체 경기 권한을 유지해야 합니다.');
assert.strictEqual(sandbox.api.can(openMatch,free,{n:'단장',isLeader:true}),false,
  '자유대진에서 과거 단장 플래그만으로 전체 권한을 주면 안 됩니다.');
assert.strictEqual(sandbox.api.can(openMatch,free,{n:'선수1'}),true,
  '선수는 양 모드에서 자기 경기 결과를 입력할 수 있어야 합니다.');
assert.strictEqual(sandbox.api.can(openMatch,free,{n:'일반회원'}),false,
  '일반 회원은 다른 경기 결과를 입력할 수 없어야 합니다.');
assert.strictEqual(sandbox.api.can(doneMatch,free,{n:'경기이사',isDirector:true}),false,
  '경기이사는 완료 결과를 사용자 페이지에서 임의 정정할 수 없어야 합니다.');
assert.strictEqual(sandbox.api.role(openMatch,free,{n:'경기이사',isDirector:true}),'director',
  '경기이사 입력은 감사 역할을 director로 기록해야 합니다.');

const memberCode = `${functionSource(liveSrc, '_normalizeMembers', '_sortMembers')}
${functionSource(liveSrc, '_allLiveMembers', '_viewerInfo')}
this.api={all:_allLiveMembers};`;
const memberSandbox = {};
vm.createContext(memberSandbox);
vm.runInContext(memberCode, memberSandbox);
const members = JSON.parse(JSON.stringify(memberSandbox.api.all({
  members:{blue:[],red:[],all:[{id:'m1',n:'김이사'},{id:'m2',n:'이회원'}]},
  officials:{matchDirector:{memberId:'m1',name:'김이사'}}
})));
assert.strictEqual(members.find(p=>p.id==='m1').isDirector,true, '회원 ID로 경기이사 권한을 복원해야 합니다.');
assert.strictEqual(members.find(p=>p.id==='m2').isDirector,false, '일반 회원에게 경기이사 권한이 번지면 안 됩니다.');

assert(liveSrc.includes("const memberId=viewer.id||viewer.memberId||''"), '승패 입력 감사정보에 회원 ID를 남겨야 합니다.');
assert(liveSrc.includes('단장/부단장·경기이사'), '권한 안내에 경기이사를 포함해야 합니다.');
const submitSource = functionSource(liveSrc, 'submitLiveWin', '_resultSideLabel');
assert(submitSource.includes('.transaction(data=>'), '동시 승패 입력은 Firebase 트랜잭션으로 보호해야 합니다.');
assert(submitSource.includes('resultConflicts'), '반대 결과 동시 입력은 관리자 확인 건으로 남겨야 합니다.');

console.log('team match director regression ok');
