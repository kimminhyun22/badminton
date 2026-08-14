'use strict';
/**
 * 예측 설문 (예측왕 퀴즈) — 급수 영점 조정의 수집 경로 (2026-08-14 운영자).
 *
 *   "각 클럽의 고수에게 이런 설문을 진행해서 영점을 맞추면 보다 박빙의 게임을
 *    설계할 수 있지 않을까"  /  "관리자 페이지에서 카톡 링크 형식으로 보내고
 *    정보를 수집하는 형태"
 *
 * 여기서 고정하는 것:
 *   1) 설문 payload 에는 **이름만** — 급수·합계·실효 숫자가 실리면 응답이
 *      급수를 되읽는다(앵커링). 어제 실측: 운영자도 우세 6경기를 6개 전부
 *      급수대로 찍었다.
 *   2) 집계는 **기대 점수** — 픽 개수 집계는 박빙 10개를 통승 10개로 부풀린다
 *      (청 5:20 오판의 원인). 낙승 .9 / 승 .675 / 박빙 .5 로 환산해 평균.
 *   3) 응답 페이지: 본인 경기 자동 제외 · 문항 순서는 이름 씨앗으로 결정적 셔플.
 *   4) 진입점은 공유 메뉴 하나 (데스크탑 드롭다운 + 모바일 바텀시트).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const teamSrc = fs.readFileSync(path.join(root, 'js', 'team.js'), 'utf8');
const teamHtml = fs.readFileSync(path.join(root, 'team.html'), 'utf8');
const quizHtml = fs.readFileSync(path.join(root, 'quiz.html'), 'utf8');

function cut(src, a, b, label){
  const i = src.indexOf(a);
  assert(i >= 0, `${label}: 시작 표지를 못 찾음: ${a}`);
  const j = src.indexOf(b, i + a.length);
  assert(j > i, `${label}: 끝 표지를 못 찾음: ${b}`);
  return src.slice(i, j);
}

// 1) payload 에는 이름만 — 급수가 새면 앵커링 차단이 무너진다.
{
  const sandbox = {console, Object, Number, String, Array, JSON, Math, Date};
  vm.createContext(sandbox);
  const P = (name, team, level) => ({name, team, level, gender: 'M'});
  vm.runInContext(`
function _teamLiveSignature(){ return 'sig-test'; }
${cut(teamSrc, 'function _teamMatchIsBlueFirst(m)', '\nfunction ', 'team.js')}
let currentMatches=[];
let currentParticipants=[];
${cut(teamSrc, 'function _teamQuizPayload()', '\nfunction _teamQuizUrl', 'team.js')}
this.api={_teamQuizPayload, set(m,p){currentMatches=m;currentParticipants=p;}};
`, sandbox);
  const api = sandbox.api;
  api.set([
    {matchNumber: 1, round: 1, court: 2, type: '남복', levelDiff: 1, team1Level: 8, team2Level: 7,
     team1A: P('청A', '청팀', 4), team1B: P('청B', '청팀', 4),
     team2C: P('홍C', '홍팀', 4), team2D: P('홍D', '홍팀', 3)},
    // team1 이 홍팀인 낡은 배열도 청이 t1 으로 정렬되어야 한다
    {matchNumber: 2, round: 1, court: 3, type: '혼복', levelDiff: 0, team1Level: 7, team2Level: 7,
     team1A: P('홍E', '홍팀', 4), team1B: P('홍F', '홍팀', 3),
     team2C: P('청G', '청팀', 4), team2D: P('청H', '청팀', 3)}
  ], [P('청A', '청팀', 4), P('홍C', '홍팀', 4)]);
  const payload = api._teamQuizPayload();
  assert.strictEqual(payload.kind, 'expertQuiz');
  payload.matches.forEach(m => {
    assert.deepEqual(Object.keys(m).sort(), ['court', 'num', 'round', 't1', 't2', 'type'],
      `payload 경기에 허용된 칸만 있어야 합니다: ${Object.keys(m)}`);
  });
  assert(!/level|Level|effLevel|급수/.test(JSON.stringify(payload)),
    'payload 어디에도 급수·레벨 숫자가 실리면 안 됩니다.');
  assert.deepEqual(payload.matches[0].t1, ['청A', '청B'], 't1 은 청팀이어야 합니다.');
  assert.deepEqual(payload.matches[1].t1, ['청G', '청H'],
    'team1 이 홍팀인 데이터도 청이 t1 으로 정렬되어야 합니다.');
  assert.deepEqual(payload.players, ['청A', '홍C'], '참가자 이름 목록이 실려야 합니다.');
  console.log('  payload: 이름만 · 청=t1 정렬 · 급수 미노출');
}

// 2) 집계는 기대 점수 — 낙승 .9 / 승 .675 / 박빙 .5, 응답 없는 경기는 반반.
{
  const sandbox = {console, Object, Number, String, Array, JSON, Math};
  vm.createContext(sandbox);
  vm.runInContext(`
${cut(teamSrc, 'function _teamQuizConsensus(responses,matches)', '\nfunction _teamQuizPanel', 'team.js')}
this.api={_teamQuizConsensus};
`, sandbox);
  const matches = [{matchNumber: 1}, {matchNumber: 2}, {matchNumber: 3}];
  const responses = {
    r1: {n: '고수1', a: {1: 1, 2: 3}},        // 1번 청낙승, 2번 박빙
    r2: {n: '고수2', a: {1: 4}}                // 1번 홍
  };
  const c = sandbox.api._teamQuizConsensus(responses, matches);
  // 1번: (0.9+0.325)/2 = 0.6125, 2번: 0.5, 3번(무응답): 0.5 → 청 1.6125 ≈ 1.6
  assert.strictEqual(c.blue, 1.6, `기대 점수 환산이 틀렸습니다: ${c.blue}`);
  assert.strictEqual(c.red, 1.4);
  assert.deepEqual(c.split, [1], '청·홍으로 갈린 경기는 1번뿐입니다(박빙은 갈림이 아님).');
  console.log('  집계: 기대 점수 · 무응답 반반 · 갈림 감지');
}

// 3) 응답 페이지 — 자기 경기 제외 · 이름 씨앗 셔플 · 숫자 미노출.
{
  // 값이 샐 수 있는 통로(레벨 식별자)를 막는다 — payload 쪽은 1)에서 검사.
  assert(!/effLevel|levelDiff|team1Level|team2Level/.test(quizHtml),
    'quiz.html 은 급수·레벨 값을 다루는 코드가 없어야 합니다.');
  assert(/낙승.*8점차/.test(quizHtml.replace(/\n/g, '')), '낙승 정의(8점차)가 안내에 있어야 합니다.');
  assert(quizHtml.includes('js/storage.js'), '공용 Firebase 초기화(storage.js)를 써야 합니다.');
  assert(quizHtml.includes("responses/'"[0]) || quizHtml.includes('/responses/'),
    '응답은 quiz/<id>/responses/ 아래에 저장돼야 합니다.');

  const sandbox = {console, Object, Number, String, Array, JSON, Math, Set};
  vm.createContext(sandbox);
  vm.runInContext(`
${cut(quizHtml, 'function quizSeededOrder(name,count)', '\nfunction quizOwnMatches', 'quiz.html')}
${cut(quizHtml, 'function quizOwnMatches(name,matches)', '\nconst $', 'quiz.html')}
this.api={quizSeededOrder,quizOwnMatches};
`, sandbox);
  const api = sandbox.api;
  const o1 = api.quizSeededOrder('김민현', 25);
  const o2 = api.quizSeededOrder('김민현', 25);
  const o3 = api.quizSeededOrder('김동균', 25);
  assert.deepEqual(o1, o2, '같은 이름은 같은 순서여야 합니다(새로고침에도 안정).');
  assert(JSON.stringify(o1) !== JSON.stringify(o3), '다른 이름은 다른 순서여야 합니다.');
  assert.deepEqual([...o1].sort((a, b) => a - b), Array.from({length: 25}, (_, i) => i),
    '셔플은 전 문항을 정확히 한 번씩 포함해야 합니다.');
  const matches = [
    {num: 1, t1: ['김민현', 'A'], t2: ['B', 'C']},
    {num: 2, t1: ['D', 'E'], t2: ['F', '김민현']},
    {num: 3, t1: ['D', 'E'], t2: ['F', 'G']}
  ];
  assert.deepEqual([...api.quizOwnMatches('김민현', matches)].sort(), [1, 2],
    '본인이 낀 경기는 어느 편이든 제외돼야 합니다.');
  assert.strictEqual(api.quizOwnMatches('없는사람', matches).size, 0);
  console.log('  응답 페이지: 결정적 셔플 · 자기 경기 제외 · 숫자 미노출');
}

// 4) 진입점 — 공유 메뉴 두 UI(드롭다운·바텀시트) 모두에서 열리고, 집계 패널이 있다.
{
  const menuCount = (teamHtml.match(/teamQuizShare\(\)/g) || []).length;
  assert.strictEqual(menuCount, 2,
    `설문 버튼은 데스크탑 드롭다운과 모바일 바텀시트 두 곳이어야 합니다: ${menuCount}곳`);
  assert(teamHtml.includes('id="quizPanel"'), '응답 집계 패널 자리가 있어야 합니다.');
  assert(teamSrc.includes('_teamQuizAutoWatch();'),
    '대진을 다시 그릴 때 저장된 설문을 자동으로 감시해야 합니다(새로고침 생존).');
  assert(quizHtml.includes('og:title'), '카톡 미리보기 제목이 있어야 합니다 — 대진 내용은 싣지 않습니다.');
  console.log('  진입점: 공유 메뉴 2곳 · 집계 패널 · 자동 감시 · 카톡 미리보기');
}

console.log('\nteam quiz regression ok');
