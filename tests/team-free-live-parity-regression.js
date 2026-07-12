const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const teamSrc = fs.readFileSync(path.join(root, 'js', 'team.js'), 'utf8');
const dailySrc = fs.readFileSync(path.join(root, 'js', 'daily.js'), 'utf8');
const liveSrc = fs.readFileSync(path.join(root, 'js', 'live-view.js'), 'utf8');
const rsvpHtml = fs.readFileSync(path.join(root, 'rsvp.html'), 'utf8');

function functionSource(src, name, nextName) {
  const start = src.indexOf(`function ${name}`);
  const end = src.indexOf(`function ${nextName}`, start + 1);
  assert(start >= 0 && end > start, `${name} 함수 범위를 찾을 수 있어야 합니다.`);
  return src.slice(start, end);
}

const teamKindCode = `${functionSource(teamSrc, '_teamIsTeamLiveData', '_teamValidateLiveDataForCurrent')}
this.api={isTeamLive:_teamIsTeamLiveData};`;
const teamSandbox = {};
vm.createContext(teamSandbox);
vm.runInContext(teamKindCode, teamSandbox);

assert.strictEqual(teamSandbox.api.isTeamLive({kind:'teamLive',matchMode:'free',isTeam:false}), true,
  '새 자유대진 LIVE는 Team LIVE로 판정해야 합니다.');
assert.strictEqual(teamSandbox.api.isTeamLive({isTeam:false,lateMode:'explicit',members:{all:[]}}), true,
  '기존 자유대진 LIVE도 Team LIVE로 복구해야 합니다.');
assert.strictEqual(teamSandbox.api.isTeamLive({kind:'dailyLive',isTeam:false}), false,
  '민턴LIVE 데이터는 Team LIVE로 연결하면 안 됩니다.');

const dailyKindCode = `${functionSource(dailySrc, '_dailyIsTeamLiveData', '_dailyValidateLiveDataForCurrent')}
this.api={isTeamLive:_dailyIsTeamLiveData};`;
const dailySandbox = {};
vm.createContext(dailySandbox);
vm.runInContext(dailyKindCode, dailySandbox);
assert.strictEqual(dailySandbox.api.isTeamLive({isTeam:false,lateMode:'explicit',members:{all:[]}}), true,
  '민턴LIVE도 기존 자유대진 Team LIVE 표식을 구분해야 합니다.');
assert.strictEqual(dailySandbox.api.isTeamLive({kind:'dailyLive',isTeam:false}), false,
  '민턴LIVE 자체 payload는 정상적으로 유지해야 합니다.');

assert(teamSrc.includes("kind:'teamLive'"), 'Team LIVE payload에 서비스 종류가 있어야 합니다.');
assert(teamSrc.includes("matchMode,"), 'Team LIVE payload에 청홍/자유 대진 방식이 있어야 합니다.');
assert(teamSrc.includes('if(!_teamIsTeamLiveData(data))'), 'LIVE 재개는 isTeam이 아니라 서비스 종류로 검증해야 합니다.');
assert(dailySrc.includes("kind:'dailyLive'"), '민턴LIVE payload도 서비스 종류를 명시해야 합니다.');
assert(dailySrc.includes('if(_dailyIsTeamLiveData(data))'), '민턴LIVE 재개가 자유대진 Team LIVE를 가져가면 안 됩니다.');

const fixedStart = liveSrc.indexOf('function _usesFixedTeams');
const fixedEnd = liveSrc.indexOf('const content=', fixedStart);
assert(fixedStart >= 0 && fixedEnd > fixedStart, '_usesFixedTeams 함수 범위를 찾을 수 있어야 합니다.');
const labelCode = `${liveSrc.slice(fixedStart, fixedEnd)}
${functionSource(liveSrc, '_resultSideLabel', 'buildResultInputControls')}
this.api={label:_resultSideLabel};`;
const labelSandbox = {};
vm.createContext(labelSandbox);
vm.runInContext(labelCode, labelSandbox);
assert.strictEqual(labelSandbox.api.label({kind:'teamLive',matchMode:'free',isTeam:false},'t1'),'A 승');
assert.strictEqual(labelSandbox.api.label({kind:'teamLive',matchMode:'free',isTeam:false},'t2'),'B 승');
assert.strictEqual(labelSandbox.api.label({kind:'teamLive',matchMode:'team',isTeam:true},'t1'),'청 승');
assert.strictEqual(labelSandbox.api.label({kind:'teamLive',matchMode:'team',isTeam:true},'t2'),'홍 승');

const partySource = functionSource(liveSrc, 'buildPartySpotlight', 'buildRanking');
assert(partySource.includes('_isTeamLiveData(d)'), '뒷풀이 현황은 Team LIVE 서비스 기준으로 표시해야 합니다.');
assert(partySource.includes('_allLiveMembers(d)'), '자유대진 members.all도 뒷풀이 현황에 포함해야 합니다.');
assert(liveSrc.includes("isTeam?'청':'A'"), '자유대진 사용자 경기판에 A 라벨이 있어야 합니다.');
assert(liveSrc.includes("isTeam?'홍':'B'"), '자유대진 사용자 경기판에 B 라벨이 있어야 합니다.');

assert(teamSrc.includes("matchMode:currentSettings?.teamMode===false?'free'"), 'RSVP 세션에 자유대진 방식을 전송해야 합니다.');
assert(rsvpHtml.includes("session?.matchMode==='free'?'자유대진':'청·홍 팀전'"), '회원 페이지가 자유대진을 표시해야 합니다.');
assert(rsvpHtml.includes("session?.matchMode==='free'?'자유대진 LIVE 진행 중':'팀전LIVE 진행 중'"), '회원 LIVE 안내가 대진 방식에 맞아야 합니다.');

const changeSource = functionSource(teamSrc, 'executeChangeModal', 'showTab');
assert(changeSource.includes('rsvpPushSession();'), '선수 변경 후 RSVP 본인확인 명단을 다시 발행해야 합니다.');
assert(changeSource.includes('if(_liveOn)pushLiveState();'), '선수 변경 후 사용자 LIVE 명단도 다시 발행해야 합니다.');
const panelSource = functionSource(teamSrc, 'teamLiveOpenPanel', '_autoFlowSetResultSections');
assert(panelSource.includes("target='summary'"), '자유대진 결과 탭은 청홍 스코어보드 대신 개인 요약으로 이동해야 합니다.');

console.log('team free live parity regression ok');
