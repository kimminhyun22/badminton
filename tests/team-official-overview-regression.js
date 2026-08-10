const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const liveSrc = fs.readFileSync(path.join(root, 'js', 'live-view.js'), 'utf8');
const liveCss = fs.readFileSync(path.join(root, 'css', 'live.css'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const development = fs.readFileSync(path.join(root, 'DEVELOPMENT_SUMMARY.md'), 'utf8');

const overviewStart = liveSrc.indexOf('function _teamOfficialOverviewData');
const overviewEnd = liveSrc.indexOf('function _viewerNextHtml', overviewStart);
assert(overviewStart >= 0 && overviewEnd > overviewStart,
  '팀전 임원 운영 현황 함수 묶음을 찾을 수 있어야 합니다.');
const overviewSource = liveSrc.slice(overviewStart, overviewEnd);

// 2026-08-13 계약 갱신: 팀전을 실제로 이끄는 사람은 단장·부단장입니다. 서버는
// 이미 이들에게 운영 권한을 주는데 화면이 가려 두면 버튼이 아예 안 뜹니다.
assert(overviewSource.includes("viewer.isClubOfficial")
  && overviewSource.includes("(!_usesFixedTeams(d)&&viewer.isTemporaryOperator)")
  && overviewSource.includes("(_usesFixedTeams(d)&&(viewer.isLeader||viewer.isSub))"),
  '정식 임원·자유대진 운영 도우미·청홍팀전 단장/부단장이 운영 현황을 볼 수 있어야 합니다.');
['등록','현장','경기중','대기','지각','운영진','뒷풀이'].forEach(label=>{
  assert(overviewSource.includes(`label:'${label}'`), `운영 현황에 ${label} 항목이 있어야 합니다.`);
});
assert(overviewSource.includes('resultConflicts')&&overviewSource.includes('승패 확인'),
  '서로 다른 승패 입력은 임원 현황에서 확인 건으로 보여야 합니다.');

// 2026-08-04 설계 변경: 운영진에게는 운영 현황이 '내 카드 직후'가 아니라 '맨 앞'입니다.
// 민턴LIVE 와 같은 원칙 — 임원은 본인 이름표보다 운영 대시보드를 먼저 봅니다.
const renderStart = liveSrc.indexOf('function render(d)');
const renderBlock = liveSrc.slice(renderStart, liveSrc.indexOf('\nfunction toggleRoster', renderStart));
const operatorOrder = (renderBlock.match(/\?\s*(overview\+scoreboard\+[A-Za-z+]+)/) || [])[1] || '';
assert(operatorOrder.indexOf('overview') === 0,
  '임원은 운영 현황을 가장 먼저 봐야 합니다.');
assert(operatorOrder.indexOf('scoreboard') > 0 && operatorOrder.indexOf('identity') > operatorOrder.indexOf('scoreboard'),
  '임원 화면에서 본인 이름표는 점수·경기 현황보다 뒤여야 합니다.');

assert(liveCss.includes('grid-template-columns:repeat(4,minmax(0,1fr))'),
  '모바일 운영 현황은 한눈에 보이는 4열 요약이어야 합니다.');
assert(liveCss.includes('@media(max-width:360px)')&&liveCss.includes('grid-template-columns:repeat(3,minmax(0,1fr))'),
  '아주 좁은 화면에서는 운영 현황을 3열로 줄여야 합니다.');

const sandbox = {
  viewer:null,
  rendered:0,
  _teamOfficialOverviewFilter:'',
  window:{_lastLiveData:null},
  Object,
  Set
};
vm.createContext(sandbox);
vm.runInContext(`
function _attKey(name){return String(name||'');}
// 대체 투입 알림(2026-08-13)은 이 검사 범위 밖입니다. 실제 함수가 추출 범위에
// 함께 들어오므로, 권한 판정만 막아 알림이 안 뜨게 둡니다.
function _canSubstitute(){return false;}
function _usesFixedTeams(d){return d&&d.matchMode!=='free';}
function _lateMapFromData(d){return d&&d.late||{};}
function _viewerInfo(){return viewer;}
function _viewerRoleText(player){
  if(player&&player.isClubOfficial)return '클럽 임원';
  if(player&&player.isTemporaryOperator)return '운영 도우미';
  return '선수';
}
function _allLiveMembers(d){
  const helpers=(d&&d.officials&&d.officials.temporaryOperators)||[];
  return (d&&d.members&&d.members.all||[]).map(player=>({
    ...player,
    team:'all',
    isTemporaryOperator:helpers.some(helper=>String(helper.memberId)===String(player.id))
  }));
}
function _viewerMatches(d,name){
  return (d&&d.matches||[]).filter(match=>[...(match.t1||[]),...(match.t2||[])].includes(name));
}
function liveTeamLabel(){return '참가자';}
function esc(value){return String(value==null?'':value);}
function render(){rendered++;}
${overviewSource}
this.api={
  data:_teamOfficialOverviewData,
  build:buildTeamOfficialOverview,
  setViewer(value){viewer=value;},
  filter(value){setTeamOfficialOverviewFilter(value);},
  rendered(){return rendered;}
};`, sandbox);

const liveData = {
  kind:'teamLive',
  matchMode:'free',
  currentRound:1,
  members:{all:[
    {id:'official',n:'정식임원',isClubOfficial:true},
    {id:'helper',n:'운영도우미'},
    {id:'party',n:'뒷풀이회원'},
    {id:'p1',n:'현재선수1'},
    {id:'p2',n:'현재선수2'},
    {id:'late',n:'늦은회원'},
    {id:'p3',n:'대기선수1'},
    {id:'p4',n:'대기선수2'}
  ]},
  officials:{temporaryOperators:[{memberId:'helper',name:'운영도우미'}]},
  late:{늦은회원:{name:'늦은회원'}},
  party:{뒷풀이회원:{name:'뒷풀이회원'}},
  resultConflicts:{'1_1':{a:{},b:{}}},
  matches:[
    {round:1,court:1,t1:['정식임원','뒷풀이회원'],t2:['현재선수1','현재선수2'],win:null},
    {round:2,court:1,t1:['운영도우미','늦은회원'],t2:['대기선수1','대기선수2'],win:null}
  ]
};

const summary = JSON.parse(JSON.stringify(sandbox.api.data(liveData)));
assert.strictEqual(summary.members.length,8,'확정 참가자 전원을 등록 인원으로 집계해야 합니다.');
assert.strictEqual(summary.onSite.length,7,'현장은 등록 인원에서 명시적 지각만 제외해야 합니다.');
assert.strictEqual(summary.playing.length,4,'현재 라운드의 현장 선수를 경기중으로 집계해야 합니다.');
assert.strictEqual(summary.waiting.length,3,'현장에 있으나 현재 경기 밖인 선수를 대기로 집계해야 합니다.');
assert.strictEqual(summary.late.length,1,'지각은 명시적 지각 지도만 사용해야 합니다.');
assert.strictEqual(summary.operators.length,2,'정식 임원과 자유대진 운영 도우미를 운영진으로 집계해야 합니다.');
assert.strictEqual(summary.party.length,1,'뒷풀이 신청 인원을 별도로 집계해야 합니다.');
assert.strictEqual(summary.conflictCount,2,'승패 충돌 입력 수를 정확히 집계해야 합니다.');

sandbox.api.setViewer({id:'official',n:'정식임원',isClubOfficial:true});
const officialHtml = sandbox.api.build(liveData);
assert(officialHtml.includes('team-official-overview')&&officialHtml.includes('R1 · 0/2경기'),
  '정식 임원에게 현재 라운드와 운영 현황을 보여야 합니다.');

sandbox.api.setViewer({id:'helper',n:'운영도우미',isTemporaryOperator:true});
assert(sandbox.api.build(liveData).includes('운영 현황'),
  '자유대진 운영 도우미에게도 같은 운영 현황을 보여야 합니다.');

const fixedData = {...liveData,matchMode:'team',isTeam:true};
assert.strictEqual(sandbox.api.build(fixedData),'',
  '청홍팀전에서는 남아 있는 임시 도우미 플래그로 운영 현황을 열면 안 됩니다.');

// 단장·부단장은 청홍팀전의 운영자입니다(2026-08-13). 자유대진에서는 아닙니다.
sandbox.api.setViewer({id:'leader',n:'청단장',isLeader:true});
assert(sandbox.api.build(fixedData).includes('운영 현황'),
  '청홍팀전 단장에게 운영 현황을 보여야 합니다.');
sandbox.api.setViewer({id:'sub',n:'청부단',isSub:true});
assert(sandbox.api.build(fixedData).includes('운영 현황'),
  '부단장에게도 같은 운영 현황을 보여야 합니다.');
assert.strictEqual(sandbox.api.build(liveData),'',
  '자유대진에는 단장이 없으므로 이 표시로 열리면 안 됩니다.');

sandbox.api.setViewer({id:'p3',n:'대기선수1'});
assert.strictEqual(sandbox.api.build(liveData),'',
  '일반 회원에게 전체 운영 현황을 노출하면 안 됩니다.');

sandbox.api.setViewer({id:'official',n:'정식임원',isClubOfficial:true});
sandbox.window._lastLiveData=liveData;
sandbox.api.filter('late');
const lateHtml = sandbox.api.build(liveData);
assert(lateHtml.includes('지각 1명')&&lateHtml.includes('늦은회원'),
  '현황 숫자를 누르면 해당 상태의 선수 이름을 바로 보여야 합니다.');
assert.strictEqual(sandbox.api.rendered(),1,'상태 필터 변경은 현재 LIVE 화면만 다시 그려야 합니다.');

assert(readme.includes('시스템 관리자 세팅·예외')||readme.includes('시스템 관리자는 명부·참가자·코트'),
  '운영지침에 시스템 관리자 세팅·예외 역할을 명시해야 합니다.');
assert(readme.includes('스마트폰 사용은 참가 조건이 아닙니다.'),
  '운영지침에 스마트폰 없이도 참여 가능한 원칙을 명시해야 합니다.');
assert(development.includes('클럽 임원·임시 도우미 현장 운영'),
  '개발 원칙에도 임원·도우미 중심 현장 운영을 고정해야 합니다.');

console.log('team official overview regression ok');
