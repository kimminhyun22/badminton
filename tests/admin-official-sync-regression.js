'use strict';
/**
 * 관리자↔임원 싱크 (운영자 2026-08-12).
 *
 *   "관리자 페이지 게임만 생성하고 나머진 임원운영으로 진행할 거야.
 *    싱크 안맞는 경우나 갑자기 대진 종료되는 상황 없겠지?"
 *
 * 관리자 화면을 켜 두면 `pushLiveState` 가 **자기 로컬 상태로 서버를 덮어씁니다.**
 * 그래서 임원이 서버에서 바꾼 것을 관리자가 먼저 받아 적지 못하면, 다음 게시
 * 한 번에 되돌아갑니다.
 *
 * 임원 명령은 **진짜 서버 엔진**으로 적용하고, 그 결과를 **진짜 관리자 수신부**
 * 에 먹인 뒤, 관리자가 다시 게시할 값이 임원의 결과와 같은지 봅니다.
 *
 * 2026-08-12 실측으로 잡은 것 — 셋 다 **코트 번호**가 원인이었습니다:
 *   · 코트 변경이 관리자에 의해 되돌아감
 *   · 코트를 바꾼 뒤로는 대체 투입이 영영 반영되지 않음(적용을 통째로 포기)
 *   · 승패가 **다른 경기로 옮겨 붙음**(`라운드_코트` 로 맞춰서)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '..');
const teamSrc = fs.readFileSync(path.join(REPO, 'js', 'team.js'), 'utf8');
const {applyTeamOfficialRequest} = require(path.join(REPO, 'functions', 'team-official-engine'));

function cut(a, b){
  const i = teamSrc.indexOf(a);
  if(i < 0) throw new Error('시작 표지 없음: ' + a);
  const j = teamSrc.indexOf(b, i + a.length);
  if(j < 0) throw new Error('끝 표지 없음: ' + b);
  return teamSrc.slice(i, j);
}

const NAMES_B = ['청A','청B','청C','청D','청E','청F','청G','청H'];
const NAMES_R = ['홍A','홍B','홍C','홍D','홍E','홍F','홍G','홍H'];
const P = (n, team, lv) => ({name:n, team, level:lv, grade:'C', gender:'M', memberId:'m_'+n, isGuest:false, isClubOfficial:n==='청A'});
const blue = NAMES_B.map((n,i)=>P(n,'청팀',3+(i%3)));
const red  = NAMES_R.map((n,i)=>P(n,'홍팀',3+(i%3)));
const all = [...blue, ...red];
const F = n => all.find(p=>p.name===n);

// 2코트 × 3라운드 = 6경기
const localMatches = [
  {matchNumber:1, round:1, court:1, type:'남복', team1A:F('청A'), team1B:F('청B'), team2C:F('홍A'), team2D:F('홍B')},
  {matchNumber:2, round:1, court:2, type:'남복', team1A:F('청C'), team1B:F('청D'), team2C:F('홍C'), team2D:F('홍D')},
  {matchNumber:3, round:2, court:1, type:'남복', team1A:F('청E'), team1B:F('청F'), team2C:F('홍E'), team2D:F('홍F')},
  {matchNumber:4, round:2, court:2, type:'남복', team1A:F('청G'), team1B:F('청H'), team2C:F('홍G'), team2D:F('홍H')},
  {matchNumber:5, round:3, court:1, type:'남복', team1A:F('청A'), team1B:F('청C'), team2C:F('홍A'), team2D:F('홍C')},
  {matchNumber:6, round:3, court:2, type:'남복', team1A:F('청B'), team1B:F('청D'), team2C:F('홍B'), team2D:F('홍D')}
];

function makeAdmin(){
  const box = {console, JSON, Date, Object, Set, Map, Number, String, Array, Math};
  vm.createContext(box);
  vm.runInContext(`
    const LIVE_TTL_MS = 48*60*60*1000;
    var _pointSystem = 25, _liveMatchStartedAt = 1830000000000;
    var _liveResultInputs = {}, _liveResultConflicts = {}, _liveSubstitutions = [];
    var _liveLate = {}, _liveParty = {};
    var currentSettings = {teamMode:true, courts:2, gamesPerPlayer:3};
    var currentParticipants = [], currentMatches = [], teamAssignment = null;
    var teamNames = {blue:'청팀', white:'홍팀'};
    var captains = {blue:{leader:'청A',sub:'청B'}, white:{leader:'홍A',sub:'홍B'}};
    var winOverride = {}, liveWinAt = {};
    var temporaryOperators = [], _teamQualitySummary = null;
    var scoreUpdates = 0, renders = 0, warns = [];
    const document = {getElementById(){ return null; }};
    function _isMatchDone(i){ return !!winOverride[i]; }
    function _teamEnsureMemberId(p){ if(p&&!p.memberId)p.memberId='m_'+p.name; return p?p.memberId:''; }
    function _teamResolveTemporaryOperators(){ return []; }
    function getPartnerOf(){ return ''; }
    function _teamLiveEventLabel(){ return '테스트 팀전'; }
    function _teamLiveSignature(){ return 'sig'; }
    function _currentBracketRsvpId(){ return ''; }
    function _teamLiveSigName(n){ return String(n||'').replace(/\\s+/g,''); }
    function renderResults(){ renders++; }
    function updateScores(){ scoreUpdates++; }
    function saveState(){}
    function showWarn(m){ warns.push(m); }
    ${cut('const _TEAM_MATCH_SLOTS', 'function _unbindLiveAdminListener')}
    ${cut('function _syncLiveWinsFromData', '/* ── 임원 운영을 서버에서 받아 적기')}
    ${cut('function _buildLiveState', 'function _liveKey')}
    this.api = {
      setup(p, m, a){ currentParticipants = p; currentMatches = m; teamAssignment = a; },
      receive(data){ _teamAdoptServerMatchesAndRender(data); _syncLiveWinsFromData(data); },
      publish(){ return JSON.parse(JSON.stringify(_buildLiveState())); },
      warns(){ return warns.slice(); },
      state(){ return {courts:currentMatches.map(m=>m.court),
        names:currentMatches.map(m=>[m.team1A.name,m.team1B.name,m.team2C.name,m.team2D.name].join('/')),
        wins:currentMatches.map((m,i)=>winOverride[i]||null)}; }
    };
  `, box);
  box.api.setup(all.map(p=>({...p})), JSON.parse(JSON.stringify(localMatches)).map((m,i)=>({
    ...m,
    team1A:F(localMatches[i].team1A.name), team1B:F(localMatches[i].team1B.name),
    team2C:F(localMatches[i].team2C.name), team2D:F(localMatches[i].team2D.name)
  })), {blue, white:red});
  return box.api;
}

const NOW = 1830000000000;
function officialSession(payload){
  return JSON.parse(JSON.stringify(payload));
}
function official(session, req){
  return applyTeamOfficialRequest(session,
    {actorPlayerName:'청A', expiresAt:NOW+9e5, ...req}, {now:NOW+1000});
}

const results = [];
function scenario(label, run){
  const admin = makeAdmin();
  const published = admin.publish();
  let server = officialSession(published);
  const out = run(admin, server);
  results.push({label, ...out});
}

function report(label, ok, detail){ return {ok, detail}; }

// ── 1) 임원이 승패를 넣으면 관리자가 받아 적는가 ──────────────────────────
scenario('임원 승패 입력', (admin, server) => {
  const r = official(server, {type:'team-official-result', matchNum:1, win:'t1'});
  admin.receive(r.session);
  const after = admin.publish();
  const win = after.matches.find(m=>m.num===1).win;
  return report('', win === 't1', `관리자가 다시 게시한 1번 승패 = ${win}`);
});

// ── 2) 임원이 대체 투입하면 ───────────────────────────────────────────────
scenario('임원 대체 투입', (admin, server) => {
  const r = official(server, {type:'team-official-substitute',
    matchNum:1, outName:'청B', inName:'청E', allowStarted:true});
  if(r.status !== 'applied') return report('', false, '엔진 거절: ' + r.reason);
  admin.receive(r.session);
  const after = admin.publish();
  const t1 = after.matches.find(m=>m.num===1).t1.join('/');
  return report('', t1 === '청A/청E', `관리자가 다시 게시한 1번 청팀 = ${t1}`);
});

// ── 3) 임원이 코트 번호를 바꾸면 ──────────────────────────────────────────
scenario('임원 코트 변경', (admin, server) => {
  const r = official(server, {type:'team-official-court', matchNum:1, court:2, allowSwap:true});
  if(r.status !== 'applied') return report('', false, '엔진 거절: ' + r.reason);
  admin.receive(r.session);
  const after = admin.publish();
  const c1 = after.matches.find(m=>m.num===1).court;
  const c2 = after.matches.find(m=>m.num===2).court;
  return report('', c1 === 2 && c2 === 1, `관리자가 다시 게시한 코트 = 1번:${c1}, 2번:${c2} (서버는 1번:2, 2번:1)`);
});

// ── 4) 코트 변경 + 대체 투입이 겹치면 ─────────────────────────────────────
scenario('코트 변경 뒤 대체 투입', (admin, server) => {
  let s = official(server, {type:'team-official-court', matchNum:1, court:2, allowSwap:true}).session;
  const r = official(s, {type:'team-official-substitute',
    matchNum:1, outName:'청B', inName:'청E', allowStarted:true});
  if(r.status !== 'applied') return report('', false, '엔진 거절: ' + r.reason);
  admin.receive(r.session);
  const after = admin.publish();
  const m1 = after.matches.find(m=>m.num===1);
  return report('', m1.t1.join('/') === '청A/청E',
    `관리자가 다시 게시한 1번 청팀 = ${m1.t1.join('/')} (서버는 청A/청E)`);
});

// ── 5) 코트 변경 뒤 승패 입력 ─────────────────────────────────────────────
scenario('코트 변경 뒤 승패 입력', (admin, server) => {
  let s = official(server, {type:'team-official-court', matchNum:1, court:2, allowSwap:true}).session;
  const r = official(s, {type:'team-official-result', matchNum:1, win:'t1'});
  admin.receive(r.session);
  const after = admin.publish();
  const m1 = after.matches.find(m=>m.num===1);
  const m2 = after.matches.find(m=>m.num===2);
  return report('', m1.win === 't1' && !m2.win,
    `관리자가 다시 게시한 승패 = 1번:${m1.win}, 2번:${m2.win} (서버는 1번만 t1)`);
});

// ── 6) 임원 지각 표시를 관리자가 덮어쓰는가 ───────────────────────────────
scenario('임원 지각 표시', (admin, server) => {
  const r = official(server, {type:'team-official-late', playerName:'청C', late:true});
  admin.receive(r.session);
  const after = admin.publish();
  const keeps = !('late' in after);
  return report('', keeps, keeps ? '게시본에 late 키가 없어 서버 값이 살아남음'
                                 : '게시본이 late 를 덮어씀: ' + JSON.stringify(after.late));
});

// ── 7) 임원 명단 추가 ─────────────────────────────────────────────────────
scenario('임원 선수 추가', (admin, server) => {
  const r = official(server, {type:'team-official-roster', action:'add',
    playerName:'늦은손님', team:'red', level:4, grade:'C'});
  if(r.status !== 'applied') return report('', false, '엔진 거절: ' + r.reason);
  admin.receive(r.session);
  const after = admin.publish();
  const has = (after.members.red||[]).some(m=>m.n === '늦은손님');
  return report('', has, has ? '관리자 명단에도 들어감' : '관리자가 다시 게시하면서 지움');
});

// ── 8) 임원 마무리 ────────────────────────────────────────────────────────
scenario('임원 마무리', (admin, server) => {
  let s = server;
  [1,2,3,4,5,6].forEach(n=>{ s = official(s, {type:'team-official-result', matchNum:n, win:'t1'}).session; });
  const r = official(s, {type:'team-official-finish', finished:true});
  if(r.status !== 'applied') return report('', false, '엔진 거절: ' + r.reason);
  admin.receive(r.session);
  const after = admin.publish();
  const keeps = !('finishedAt' in after);
  return report('', keeps, keeps ? '게시본에 finishedAt 키가 없어 서버 값이 살아남음'
                                 : '게시본이 finishedAt 을 덮어씀');
});

// ── 결과 ──────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r.ok);
results.forEach(r => console.log(`  ${r.ok ? '✓' : '✗'} ${r.label} — ${r.detail}`));
assert.strictEqual(failed.length, 0,
  '임원이 한 조작이 관리자 게시로 되돌아갑니다:\n  ' +
  failed.map(r => `${r.label}: ${r.detail}`).join('\n  '));

console.log('admin-official-sync-regression: OK');
