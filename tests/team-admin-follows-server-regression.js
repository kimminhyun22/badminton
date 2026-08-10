'use strict';
/**
 * 팀전 4단계 — 관리자는 서버를 따른다 (운영자 2026-08-13).
 *
 *   "관리자는 최초 게임을 생성하는 역할만 하고 이후는 임원이 모두 운영하는
 *    민턴라이브 방식… 임원 운영을 중심으로 서버 동기화"
 *
 * 임원이 현장에서 대체 투입을 하면 서버의 대진이 바뀝니다. 관리자 화면이
 * 자기 로컬 대진을 그대로 들고 있으면 두 가지가 조용히 깨집니다:
 *   1) 승패를 하나 누르는 순간 옛 명단으로 **덮어쓴다** (교체가 사라진다)
 *   2) 앱을 다시 열면 대진 지문이 달라 **"다른 대진"으로 연결이 끊긴다**
 * 그리고 상대 팀 선수를 땜방으로 넣으면 그 경기의 청/홍이 **뒤집혀** 팀 점수가
 * 반대로 붙습니다.
 *
 * 여기서 고정하는 것: 받아 적기 · 청홍 유지 · 다른 대진 구분 · 배선.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'team.js'), 'utf8');

function slice(startMarker, endMarker){
  const start = src.indexOf(startMarker);
  assert(start >= 0, `${startMarker} 가 있어야 합니다.`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert(end > start, `${startMarker} 의 끝(${endMarker})을 찾을 수 있어야 합니다.`);
  return src.slice(start, end);
}

// 실제 소스를 그대로 실행합니다 — 재현본을 쓰면 실물과 어긋납니다.
const code = `
var currentMatches=[], currentParticipants=[], currentSettings={teamMode:true};
var calls={render:0,scores:0,save:0,warn:[]};
function renderResults(){ calls.render++; }
function updateScores(){ calls.scores++; }
function saveState(){ calls.save++; }
function showWarn(m){ calls.warn.push(m); }
${slice('function _teamLiveSigName', 'function _teamLiveSignature(){')}
${slice('function _teamMatchIsBlueFirst', 'function _teamRoundLevelBias')}
${slice('const _TEAM_MATCH_SLOTS', 'function _unbindLiveAdminListener')}
this.api={
  set(matches, participants){ currentMatches=matches; currentParticipants=participants; },
  matches(){ return currentMatches; },
  calls(){ return calls; },
  reset(){ calls={render:0,scores:0,save:0,warn:[]}; },
  _teamAdoptServerMatches, _teamAdoptServerMatchesAndRender, _teamMatchIsBlueFirst,
  _teamLiveSignatureFromData, _teamLiveSignatureFromMatches
};
`;
const sandbox = { console, assert };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const api = sandbox.api;

const BLUE = '청팀', RED = '홍팀';
// 대진에 든 8명 + 쉬고 있는 2명(현장에서 땜방으로 들어갈 사람).
const roster = [
  ['청하나', BLUE], ['청두리', BLUE], ['청세찌', BLUE], ['청너리', BLUE],
  ['홍하나', RED], ['홍두리', RED], ['홍세찌', RED], ['홍너리', RED],
  ['청벤치', BLUE], ['홍벤치', RED]
].map(([name, team], i) => ({name, team, level: 4, grade: 'C', gender: i % 2 ? 'F' : 'M'}));
const P = name => roster.find(p => p.name === name);

function localMatch(num, court, a, b, c, d){
  return {matchNumber: num, round: 1, court, type: '혼복',
    team1A: P(a), team1B: P(b), team2C: P(c), team2D: P(d)};
}
function serverRow(num, court, t1, t2){
  return {num, round: 1, court, type: '혼복', t1, t2, t1g: ['C', 'C'], t2g: ['C', 'C']};
}
function fresh(){
  api.set(
    [localMatch(1, 1, '청하나', '청두리', '홍하나', '홍두리'),
     localMatch(2, 2, '청세찌', '청너리', '홍세찌', '홍너리')],
    roster
  );
  api.reset();
}

// 1) 임원이 바꾼 사람을 받아 적습니다.
{
  fresh();
  const out = api._teamAdoptServerMatches({matches: [
    serverRow(1, 1, ['청하나', '청벤치'], ['홍하나', '홍두리']),
    serverRow(2, 2, ['청세찌', '청너리'], ['홍세찌', '홍너리'])
  ]});
  assert.strictEqual(out.applied, true, '구조가 같으면 받아 적어야 합니다.');
  assert.strictEqual(out.changed, 1, '바뀐 자리는 하나입니다.');
  assert.strictEqual(api.matches()[0].team1B.name, '청벤치', '로컬 대진이 서버를 따라가야 합니다.');
  assert.strictEqual(out.swaps.length, 1, '무엇이 바뀌었는지 남아야 합니다.');
  assert.strictEqual(`${out.swaps[0].out}→${out.swaps[0].in}`, '청두리→청벤치');
  console.log('  임원 교체 받아 적기: 1자리');
}

// 2) 상대 팀 선수를 땜방으로 넣어도 그 경기의 청/홍은 그대로여야 합니다.
//    (뒤집히면 팀 점수가 반대로 붙고, 회원 화면 집계(t1=청팀)와도 어긋납니다)
{
  fresh();
  const before = api._teamMatchIsBlueFirst(api.matches()[0]);
  assert.strictEqual(before, true, '대진 생성은 t1 을 청팀으로 만듭니다.');
  const out = api._teamAdoptServerMatches({matches: [
    serverRow(1, 1, ['홍벤치', '청두리'], ['홍하나', '홍두리']),   // 1번 자리에 상대 팀
    serverRow(2, 2, ['청세찌', '청너리'], ['홍세찌', '홍너리'])
  ]});
  assert.strictEqual(out.changed, 1);
  assert.strictEqual(api.matches()[0].team1A.name, '홍벤치', '땜방은 들어가야 합니다.');
  assert.strictEqual(api.matches()[0].team1Side, BLUE, '원래 청홍을 적어 둬야 합니다.');
  assert.strictEqual(api._teamMatchIsBlueFirst(api.matches()[0]), true,
    '상대 팀 땜방이 그 경기의 청/홍을 뒤집으면 안 됩니다.');
  console.log('  상대 팀 땜방: 청/홍 유지');
}

// 3) 정말 다른 대진이면 받아 적지 않습니다 — 기존 "다른 대진" 경고가 살아 있어야 합니다.
{
  const cases = [
    ['경기 수가 다름', {matches: [serverRow(1, 1, ['청하나', '청두리'], ['홍하나', '홍두리'])]}],
    ['코트가 다름', {matches: [
      serverRow(1, 9, ['청하나', '청두리'], ['홍하나', '홍두리']),
      serverRow(2, 2, ['청세찌', '청너리'], ['홍세찌', '홍너리'])]}],
    ['라운드가 다름', {matches: [
      {...serverRow(1, 1, ['청하나', '청두리'], ['홍하나', '홍두리']), round: 3},
      serverRow(2, 2, ['청세찌', '청너리'], ['홍세찌', '홍너리'])]}],
    ['명단 밖 이름', {matches: [
      serverRow(1, 1, ['청하나', '모르는사람'], ['홍하나', '홍두리']),
      serverRow(2, 2, ['청세찌', '청너리'], ['홍세찌', '홍너리'])]}],
    ['대진 없음', {}]
  ];
  cases.forEach(([label, data]) => {
    fresh();
    const out = api._teamAdoptServerMatches(data);
    assert.strictEqual(out.applied, false, `${label}: 받아 적으면 안 됩니다.`);
    assert.strictEqual(out.changed, 0, `${label}: 로컬을 건드리면 안 됩니다.`);
    assert.strictEqual(api.matches()[0].team1B.name, '청두리', `${label}: 원본이 그대로여야 합니다.`);
  });
  console.log('  다른 대진 5종: 받아 적지 않음');
}

// 4) 바뀐 게 없으면 아무것도 하지 않습니다(다시 그리기·재게시 되돌이표 방지).
{
  fresh();
  const same = {matches: [
    serverRow(1, 1, ['청하나', '청두리'], ['홍하나', '홍두리']),
    serverRow(2, 2, ['청세찌', '청너리'], ['홍세찌', '홍너리'])
  ]};
  const out = api._teamAdoptServerMatchesAndRender(same);
  assert.strictEqual(out.changed, 0);
  const quiet = api.calls();
  assert.strictEqual(`${quiet.render}/${quiet.scores}/${quiet.save}/${quiet.warn.length}`, '0/0/0/0',
    '같은 데이터가 다시 와도 화면을 흔들면 안 됩니다.');

  // 이름 표기가 흔들려도(공백) 같은 사람으로 봅니다.
  fresh();
  const spaced = api._teamAdoptServerMatches({matches: [
    serverRow(1, 1, ['청 하나', '청두리'], ['홍하나', '홍두리']),
    serverRow(2, 2, ['청세찌', '청너리'], ['홍세찌', '홍너리'])
  ]});
  assert.strictEqual(spaced.changed, 0, '공백 차이는 교체가 아닙니다.');
  console.log('  변화 없음: 재렌더·재게시 없음 · 공백 무시');
}

// 5) 받아 적었으면 화면·점수·저장까지 맞춥니다.
//    updateScores 가 pushLiveState 를 부르므로, 재게시는 **바뀐 명단으로** 나갑니다.
{
  fresh();
  api._teamAdoptServerMatchesAndRender({matches: [
    serverRow(1, 1, ['청하나', '청벤치'], ['홍하나', '홍두리']),
    serverRow(2, 2, ['청세찌', '청너리'], ['홍세찌', '홍너리'])
  ]});
  const calls = api.calls();
  assert.strictEqual(calls.render, 1, '대진을 다시 그려야 합니다.');
  assert.strictEqual(calls.scores, 1, '팀 합계를 다시 세고 재게시해야 합니다.');
  assert.strictEqual(calls.save, 1, '새로고침해도 남도록 저장해야 합니다.');
  assert.strictEqual(calls.warn.length, 1, '관리자에게 알려야 합니다.');
  assert(/청두리→청벤치/.test(calls.warn[0]), `무엇이 바뀌었는지 말해야 합니다: ${calls.warn[0]}`);
  console.log('  받아 적은 뒤: 재렌더 · 재집계 · 저장 · 안내');
}

// 6) 배선 — 서버를 읽는 세 길목 모두에서 받아 적어야 합니다.
{
  const listener = slice('_liveAdminHandler=snap=>{', '_liveAdminRef.on(');
  assert(/_teamAdoptServerMatchesAndRender\(data\)[\s\S]*_syncLiveWinsFromData\(data\)/.test(listener),
    '중계 중에는 승패 동기화보다 먼저 교체를 받아 적어야 합니다.');

  const resume = slice('async function _tryResumeLive', 'async function resumeTeamLiveBroadcast');
  assert(/_teamAdoptServerMatchesAndRender\(data\);\s*\n\s*if\(!_teamValidateLiveDataForCurrent\(data\)\)/.test(resume),
    '이어가기는 지문 검사 **전에** 받아 적어야 연결이 끊기지 않습니다.');

  const start = slice('async function startLiveBroadcast', 'function _teamStoredLiveMatchesCurrentBracket');
  assert(/_teamAdoptServerMatchesAndRender\(prevData\);\s*\n\s*if\(!_teamValidateLiveDataForCurrent\(prevData\)\)/.test(start),
    '중계 시작도 지문 검사 전에 받아 적어야 합니다.');

  // 청/홍 판정이 한 곳으로 모여 있어야 합니다 — 한 군데라도 새면 팀 점수가 뒤집힙니다.
  const raw = src.match(/team1A\.team\s*===\s*'청팀'/g) || [];
  assert.strictEqual(raw.length, 1,
    `청/홍 판정은 _teamMatchIsBlueFirst 안에서만 해야 합니다(발견 ${raw.length}곳).`);
  assert(/function _teamMatchIsBlueFirst[\s\S]{0,220}team1A\.team==='청팀'/.test(src),
    '그 한 곳은 _teamMatchIsBlueFirst 여야 합니다.');

  // 새로고침해도 남아야 합니다(저장·복원 양쪽).
  assert(/team1Side:m\.team1Side\|\|''/.test(src), '저장에 team1Side 가 실려야 합니다.');
  assert.strictEqual((src.match(/team1Side:m\.team1Side\|\|''/g) || []).length, 2,
    '저장과 복원 양쪽에 있어야 합니다.');
  console.log('  배선: 중계중 · 이어가기 · 시작 · 청홍 단일 판정 · 저장/복원');
}

// 7) 대진 지문 — 서버와 관리자가 **같은 문자열**을 만들어야 합니다.
//    여기가 어긋나면 관리자가 자기 팀전에서 "다른 대진입니다"로 튕겨 나갑니다.
{
  const {applyTeamOfficialRequest, bracketKey} = require('../functions/team-official-engine');
  const rows = [
    serverRow(1, 1, ['청하나', '청두리'], ['홍하나', '홍두리']),
    serverRow(2, 2, ['청세찌', '청너리'], ['홍세찌', '홍너리'])
  ];
  const session = {
    liveId: 'TEAMFOLLOW', isTeam: true, expiresAt: Date.now() + 3600_000,
    matches: rows,
    members: {blue: roster.filter(p => p.team === BLUE).map(p => ({name: p.name, level: p.level, grade: p.grade})),
              red: roster.filter(p => p.team === RED).map(p => ({name: p.name, level: p.level, grade: p.grade})),
              all: []},
    officials: {clubOfficials: [{memberId: 'm1', name: '청하나'}]},
    bracketKey: api._teamLiveSignatureFromData({matches: rows})
  };
  assert.strictEqual(bracketKey(session), session.bracketKey,
    '서버와 관리자의 지문 계산이 같아야 합니다.');

  // 임원이 교체 → 서버가 지문을 다시 적는다 → 관리자가 받아 적은 대진과 일치한다.
  const applied = applyTeamOfficialRequest(session, {
    type: 'team-official-substitute', actorPlayerName: '청하나',
    matchNum: 1, outName: '청두리', inName: '청벤치'
  }, {now: Date.now()});
  assert.strictEqual(applied.status, 'applied', `교체가 적용돼야 합니다: ${applied.reason}`);
  assert.notStrictEqual(applied.session.bracketKey, session.bracketKey, '지문이 갱신돼야 합니다.');

  fresh();
  const adopted = api._teamAdoptServerMatchesAndRender(applied.session);
  assert.strictEqual(adopted.changed, 1, '관리자가 그 교체를 받아 적어야 합니다.');
  assert.strictEqual(api._teamLiveSignatureFromMatches(api.matches()), applied.session.bracketKey,
    '교체 뒤 관리자 지문과 서버 지문이 같아야 합니다(“다른 대진” 오판 방지).');
  console.log('  지문: 서버=관리자 · 교체 후에도 일치');
}

console.log('\nteam admin follows server regression ok');
