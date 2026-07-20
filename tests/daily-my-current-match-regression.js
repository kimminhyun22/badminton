const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'checkin.html'), 'utf8');

function extractFunction(name, nextName) {
  const start = src.indexOf(`function ${name}`);
  assert(start >= 0, `${name} 함수가 있어야 합니다.`);
  const end = src.indexOf(`function ${nextName}`, start);
  assert(end > start, `${name} 함수의 끝을 찾을 수 있어야 합니다.`);
  return src.slice(start, end);
}

const code = `
let session=null;
function esc(value){
  return String(value==null?'':value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function remainText(row){ return row.remain<=0?'종료임박':\`약 \${row.remain}분 남음\`; }
${extractFunction('currentMatchForPlayer', 'myCurrentMatchHtml')}
${extractFunction('myCurrentMatchHtml', 'queueIdentity')}
this.api={
  setSession(value){ session=value; },
  currentMatchForPlayer,
  myCurrentMatchHtml
};
`;

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const match = {
  id: 'm1',
  court: 2,
  t1: ['김민현', '박소연'],
  t2: ['이정훈', '최은지'],
  t1Ids: ['p1', 'p2'],
  t2Ids: ['p3', 'p4'],
  playerIds: ['p1', 'p2', 'p3', 'p4'],
  remain: 7
};
sandbox.api.setSession({event:{active:[match]}});

const firstSide = sandbox.api.myCurrentMatchHtml('p1');
assert(firstSide.includes('지금 경기 중'), '내 카드에서 현재 경기 상태가 보여야 합니다.');
assert(firstSide.includes('2코트'), '내 카드에서 현재 코트가 보여야 합니다.');
assert(firstSide.includes('박소연'), '같은 편의 파트너가 보여야 합니다.');
assert(firstSide.includes('이정훈 · 최은지'), '상대 두 명이 함께 보여야 합니다.');
assert(firstSide.includes('약 7분 남음'), '현재 경기 남은 시간이 보여야 합니다.');

const secondSide = sandbox.api.myCurrentMatchHtml('p3');
assert(secondSide.includes('최은지'), '반대편 선수도 자신의 파트너를 확인할 수 있어야 합니다.');
assert(secondSide.includes('김민현 · 박소연'), '반대편 선수도 상대를 올바르게 확인해야 합니다.');
assert.strictEqual(sandbox.api.myCurrentMatchHtml('missing'), '', '진행 중이 아닌 선수에게 현재 경기 카드를 보이면 안 됩니다.');

const renderMyCard = extractFunction('renderMyCard', 'requestPlayerOptions');
const refreshTimers = extractFunction('refreshLiveTimers', 'activeMatchLabel');
assert(renderMyCard.includes('myCurrentMatchHtml(selected.id)'), '선택한 회원의 내 카드에 현재 경기를 렌더링해야 합니다.');
assert(renderMyCard.includes("selected.locked&&selectedState!=='경기중'"), '경기중 상태칩을 중복 표시하면 안 됩니다.');
assert(refreshTimers.includes('refreshMyCurrentMatch()'), '남은 시간과 경기 종료 상태를 주기적으로 갱신해야 합니다.');
assert(src.includes('.my-current-match{'), '현재 경기 정보의 모바일 가독성 스타일이 있어야 합니다.');

console.log('daily my current match regression ok');
