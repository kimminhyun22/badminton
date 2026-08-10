'use strict';
/**
 * 팀전 임원 운영은 **관리자가 실제로 게시하는 그 데이터** 위에서 돌아야 합니다.
 *
 * 왜 이 시험이 따로 있는가 — 1~3단계의 회귀는 모두 손으로 만든 픽스처
 * (`{name, level, grade}`)를 썼습니다. 그런데 관리자가 진짜 올리는 팀원 한 줄은
 * `{id, n, l, g, gr}` 로 줄여 실립니다. 두 표기가 다르니 시험은 전부 통과하는데
 * **현장에서는 대체 투입이 한 번도 성공하지 못합니다** — 후보는 0명으로 뜨고,
 * 눌러도 "명단에서 찾지 못했습니다"로 돌아옵니다.
 * ([[verify-with-real-markup]] 과 같은 덫)
 *
 * 그래서 여기서는 픽스처를 만들지 않고, `_buildLiveState()` 를 **그대로 실행해**
 * 나온 게시본을 서버 엔진에 먹입니다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {applyTeamOfficialRequest, suggestSubstitutes, teamOf, isOfficial} =
  require('../functions/team-official-engine');
const {applyTeamOfficialClaim} = require('../functions/team-official-claim');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'team.js'), 'utf8');
const buildLiveState = src.slice(
  src.indexOf('function _buildLiveState'),
  src.indexOf('function _liveKey')
);

// 관리자 화면의 나머지는 스텁이지만, 게시본을 만드는 코드 자체는 실물입니다.
const code = `
const LIVE_TTL_MS=48*60*60*1000;
var _pointSystem=25, _liveMatchStartedAt=1830000000000;
var _liveResultInputs={}, _liveResultConflicts={};
var currentSettings={teamMode:true,courts:2,gamesPerPlayer:4};
var currentParticipants=[], currentMatches=[], teamAssignment=null;
var teamNames={blue:'청 팀',white:'홍 팀'};
var captains={blue:{leader:'',sub:''},white:{leader:'',sub:''}};
var winOverride={}, liveWinAt={};
const document={getElementById(){ return null; }};
function _isMatchDone(){ return false; }
function _teamEnsureMemberId(p){ return p&&p.memberId||''; }
function _teamResolveTemporaryOperators(){ return []; }
function getPartnerOf(){ return ''; }
function _teamLiveEventLabel(){ return '팀전'; }
function _teamLiveSignature(){ return 'sig'; }
function _currentBracketRsvpId(){ return ''; }
${buildLiveState}
this.api={
  setup(participants, matches, assignment, caps){
    currentParticipants=participants; currentMatches=matches;
    teamAssignment=assignment; captains=caps;
  },
  build:_buildLiveState
};
`;
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

function player(name, team, level, grade, extra){
  return {memberId: 'm_' + name, name, team, level, grade, gender: 'M',
    isClubOfficial: false, isGuest: false, ...(extra || {})};
}
const blue = [
  player('청단장', '청팀', 5, 'B'), player('청부단', '청팀', 4, 'C'),
  player('청셋', '청팀', 4, 'C'), player('청넷', '청팀', 3, 'D'),
  player('청벤치', '청팀', 5, 'B')
];
const red = [
  player('홍단장', '홍팀', 5, 'B'), player('홍부단', '홍팀', 4, 'C'),
  player('홍셋', '홍팀', 4, 'C'), player('홍넷', '홍팀', 3, 'D'),
  player('홍벤치', '홍팀', 2, 'E')
];
const participants = [...blue, ...red];
const P = n => participants.find(p => p.name === n);
function bracketMatch(matchNumber, court, a, b, c, d){
  return {matchNumber, round: 1, court, type: '남복',
    team1A: P(a), team1B: P(b), team2C: P(c), team2D: P(d)};
}
sandbox.api.setup(
  participants,
  [bracketMatch(1, 1, '청단장', '청부단', '홍단장', '홍부단'),
   bracketMatch(2, 2, '청셋', '청넷', '홍셋', '홍넷')],
  {blue, white: red},
  {blue: {leader: '청단장', sub: '청부단'}, white: {leader: '홍단장', sub: '홍부단'}}
);
const published = JSON.parse(JSON.stringify(sandbox.api.build()));

// 0) 게시본이 정말 줄인 표기인지 — 이 전제가 깨지면 아래 시험의 의미가 사라집니다.
{
  const row = published.members.blue[0];
  assert.strictEqual(row.n, '청단장', '팀원 이름은 `n` 으로 실립니다.');
  assert.strictEqual(row.name, undefined, '`name` 은 실리지 않습니다 — 그래서 이 시험이 필요합니다.');
  assert.strictEqual(row.l, 5, '급수 숫자는 `l` 로 실립니다.');
  assert.strictEqual(row.level, undefined, '`level` 도 실리지 않습니다.');
  assert.strictEqual(published.members.all.length, 0, '팀전은 `all` 을 비웁니다.');
  console.log('  게시본 표기 확인: n/l · all 비어 있음');
}

// 1) 그 게시본에서 팀과 임원을 알아볼 수 있어야 합니다.
{
  assert.strictEqual(teamOf(published, '청셋'), 'blue', '청팀을 알아봐야 합니다.');
  assert.strictEqual(teamOf(published, '홍셋'), 'red', '홍팀을 알아봐야 합니다.');
  assert.strictEqual(isOfficial(published, '청단장'), true, '단장은 운영할 수 있어야 합니다.');
  assert.strictEqual(isOfficial(published, '홍부단'), true, '부단장도 운영할 수 있어야 합니다.');
  assert.strictEqual(isOfficial(published, '청셋'), false, '일반 팀원은 운영자가 아닙니다.');
  assert(published.officials.leaders.some(r => r.name === '청단장'),
    '게시본에 단장·부단장이 실려야 합니다.');
  console.log('  팀·임원 인식: 단장/부단장 포함');
}

// 2) 연결(grant)도 그 게시본으로 되어야 합니다.
{
  const now = Date.now();
  const ok = applyTeamOfficialClaim(published, {clientId: 'c1', requestedName: '홍단장',
    now, maxGrantMs: 3600_000, claimNonce: 'n'});
  assert.strictEqual(ok.action, 'commit', `단장이 연결돼야 합니다: ${ok.failureMessage || ''}`);
  const no = applyTeamOfficialClaim(published, {clientId: 'c2', requestedName: '청셋',
    now, maxGrantMs: 3600_000, claimNonce: 'n'});
  assert.strictEqual(no.action, 'abort', '일반 팀원은 연결되면 안 됩니다.');
  console.log('  연결: 단장 commit · 일반 팀원 abort');
}

// 3) AI 후보가 실제로 나와야 합니다(예전 표기로는 **0명**이 떴습니다).
{
  const cands = suggestSubstitutes(published, 1, '청부단');
  assert(cands.length > 0, '후보가 나와야 합니다 — 0명이면 임원이 손을 못 씁니다.');
  assert.strictEqual(cands[0].name, '청벤치', `같은 팀·급수 근접이 먼저여야 합니다: ${cands.map(c => c.name)}`);
  assert.strictEqual(cands[0].crossTeam, false, '같은 팀 후보입니다.');
  assert.strictEqual(cands[0].level, 5, '급수를 `l` 에서 읽어야 합니다(기본값 4로 뭉개지면 정렬이 죽습니다).');
  const cross = cands.find(c => c.crossTeam);
  assert(cross, '상대 팀 후보도 뒤쪽에 있어야 합니다(임원 자유 최대).');
  console.log(`  AI 후보 ${cands.length}명 · 1순위 ${cands[0].name}(같은 팀)`);
}

// 4) 실제 교체가 적용되고, 급수 표시도 따라가야 합니다.
{
  const out = applyTeamOfficialRequest(published, {
    type: 'team-official-substitute', actorPlayerName: '청단장',
    matchNum: 1, outName: '청부단', inName: '청벤치'
  }, {now: Date.now()});
  assert.strictEqual(out.status, 'applied', `교체가 적용돼야 합니다: ${out.reason}`);
  const m = out.session.matches.find(x => x.num === 1);
  assert.deepEqual([...m.t1], ['청단장', '청벤치'], '대진에 반영돼야 합니다.');
  assert.strictEqual(m.t1g[1], 'B', '급수 표시도 새 선수를 따라가야 합니다.');
  assert.strictEqual(out.session.substitutions.at(-1).by, '청단장', '누가 바꿨는지 남아야 합니다.');
  console.log('  교체 적용: 이름 · 급수 · 기록');
}

// 5) 상대 팀 투입은 경고 한 번을 거칩니다(운영자 확정: 막지는 않는다).
{
  const warn = applyTeamOfficialRequest(published, {
    type: 'team-official-substitute', actorPlayerName: '청단장',
    matchNum: 1, outName: '청부단', inName: '홍벤치'
  }, {now: Date.now()});
  assert.strictEqual(warn.status, 'rejected', '확인 없이는 팀을 넘기지 않습니다.');
  assert(/상대 팀/.test(warn.reason), `이유가 분명해야 합니다: ${warn.reason}`);
  const ok = applyTeamOfficialRequest(published, {
    type: 'team-official-substitute', actorPlayerName: '청단장',
    matchNum: 1, outName: '청부단', inName: '홍벤치', allowCrossTeam: true
  }, {now: Date.now()});
  assert.strictEqual(ok.status, 'applied', `확인하면 넣을 수 있어야 합니다: ${ok.reason}`);
  assert.strictEqual(ok.session.substitutions.at(-1).crossTeam, true, '팀을 넘은 사실이 남아야 합니다.');
  console.log('  상대 팀 투입: 경고 → 확인 후 적용');
}

// 6) 승패 정정도 게시본 위에서 돌아야 합니다.
{
  const decided = applyTeamOfficialRequest(published, {
    type: 'team-official-result', actorPlayerName: '홍단장', matchNum: 1, win: 't1'
  }, {now: Date.now()});
  assert.strictEqual(decided.status, 'applied', `승패 입력이 돼야 합니다: ${decided.reason}`);
  assert.strictEqual(decided.session.blueWins, 1, 't1 은 청팀입니다.');
  const fixed = applyTeamOfficialRequest(decided.session, {
    type: 'team-official-result', actorPlayerName: '홍단장', matchNum: 1, win: 't2',
    expectedWin: 't1'
  }, {now: Date.now()});
  assert.strictEqual(fixed.status, 'applied', `정정이 돼야 합니다: ${fixed.reason}`);
  assert.strictEqual(fixed.session.blueWins, 0);
  assert.strictEqual(fixed.session.whiteWins, 1, '정정하면 팀 점수가 함께 옮겨가야 합니다.');
  console.log('  승패 입력·정정: 팀 점수 재계산');
}

console.log('\nteam official published payload regression ok');
