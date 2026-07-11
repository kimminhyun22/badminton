const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js', 'team.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'team.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'team.css'), 'utf8');

assert(html.includes('id="bracketSaveQuick"'), '상황판에 가대진 빠른 저장 영역이 있어야 합니다.');
assert(html.includes('id="bracketSavePrimaryMeta"'), '대진 생성 버튼 아래에 저장 상태 안내가 있어야 합니다.');
assert((html.match(/data-bracket-save/g) || []).length >= 2, '상황판과 진행 설정에서 모두 가대진을 저장할 수 있어야 합니다.');
assert((html.match(/data-slot-count/g) || []).length >= 2, '상황판과 진행 설정에서 저장본 개수를 보여야 합니다.');
assert(html.includes('<summary>백업·기타 관리</summary>'), '저빈도 백업 기능은 별도 보조 영역으로 구분해야 합니다.');
assert(html.includes('현재 가대진을 별도 보관합니다.'), '저장 모달이 현재 가대진을 보관한다는 목적을 알려야 합니다.');
assert(html.includes('id="slotListCount"'), '저장 목록에서 사용 중인 슬롯 수를 보여야 합니다.');

assert(css.includes('.bracket-save-quick'), '상황판 빠른 저장 영역 스타일이 있어야 합니다.');
assert(css.includes('.bracket-save-primary'), '진행 설정의 상시 저장 버튼 스타일이 있어야 합니다.');
assert(css.includes('.bracket-save-action:disabled'), '대진 생성 전 저장 버튼은 비활성 상태가 보여야 합니다.');

const nameStart = src.indexOf('function _defaultBracketSlotName');
const nameEnd = src.indexOf('function renderBracketSaveQuick', nameStart);
assert(nameStart >= 0 && nameEnd > nameStart, '가대진 기본 이름 생성 함수를 찾을 수 있어야 합니다.');
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(`
var currentSettings={teamMode:false};
var teamNames={blue:'청 팀',white:'홍 팀'};
${src.slice(nameStart, nameEnd)}
this.api={
  name:_defaultBracketSlotName,
  setTeam(v){ currentSettings={teamMode:v}; }
};
`, sandbox);
assert(/^자유대진 \d{1,2}\/\d{1,2} \d{2}:\d{2}$/.test(sandbox.api.name()), '자유 대진 기본 저장명에 날짜와 시간이 들어가야 합니다.');
sandbox.api.setTeam(true);
assert(/^청팀-홍팀 \d{1,2}\/\d{1,2} \d{2}:\d{2}$/.test(sandbox.api.name()), '청·홍 가대진 기본 저장명에 팀과 시간이 들어가야 합니다.');

const confirmStart = src.indexOf('function confirmSaveSlot');
const confirmEnd = src.indexOf('function openLoadSlotModal', confirmStart);
const confirmBody = src.slice(confirmStart, confirmEnd);
assert(confirmBody.indexOf('saveState();') < confirmBody.indexOf('localStorage.getItem(SAVE_KEY)'), '이름 저장 직전에 최신 대진을 자동저장해야 합니다.');
assert(confirmBody.includes('existing<0&&slots.length>=MAX_SLOTS'), '기존 이름 덮어쓰기는 슬롯이 가득 차도 허용해야 합니다.');
assert(confirmBody.includes('slots.splice(existing,1)'), '덮어쓴 저장본은 기존 위치에서 제거해야 합니다.');
assert(confirmBody.includes('slots.unshift(slot)'), '가장 최근 저장본이 목록 맨 위에 와야 합니다.');

const statusStart = src.indexOf('function setSaveStatus');
const statusEnd = src.indexOf('function saveState', statusStart);
assert(src.slice(statusStart, statusEnd).includes('renderBracketSaveQuick()'), '자동저장 상태가 빠른 저장 영역에도 즉시 반영되어야 합니다.');
assert(src.includes("quick.classList.toggle('hidden',sample||_liveOn||(!hasBracket&&count===0))"), 'LIVE 중에는 저장 UI가 운영 집중을 방해하지 않아야 합니다.');

console.log('team save access regression ok');
