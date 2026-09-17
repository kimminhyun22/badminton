const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const memberShell = read('css/member-shell.css');
const appCss = read('css/app.css');
const teamCss = read('css/team.css');
const checkin = read('checkin.html');

assert(memberShell.includes('@media(min-width:700px)'),
  '회원 화면은 iPad 세로 폭부터 적용되는 태블릿 규칙이 필요합니다.');
assert(memberShell.includes('body.km-checkin-page .wrap{') && memberShell.includes('max-width:min(94vw,1040px);'),
  '민턴LIVE 회원 화면을 430px 기둥에 가두면 안 됩니다.');
assert(memberShell.includes('body.km-checkin-page .event-list{') && memberShell.includes('grid-template-columns:repeat(2,minmax(0,1fr));'),
  '태블릿에서는 진행 중·다음 대진을 두 열로 스캔할 수 있어야 합니다.');
assert(memberShell.includes('body.km-checkin-page .official-overview-list{') && memberShell.includes('grid-template-columns:repeat(2,minmax(0,1fr));'),
  '태블릿 임원 현황 명단은 두 열을 사용해야 합니다.');
assert(memberShell.includes('body.km-checkin-page .complete-picker{') && memberShell.includes('width:min(680px,100%);'),
  '태블릿 운영 선택창은 휴대폰 폭에 갇히면 안 됩니다.');
assert(memberShell.includes('body.km-live-page{') && memberShell.includes('max-width:min(94vw,1120px)!important;'),
  '팀전 실중계는 태블릿 가로 공간을 사용해야 합니다.');
assert(memberShell.includes('body.km-rsvp-page .wrap{') && memberShell.includes('max-width:min(94vw,960px);'),
  '팀전 참가 화면도 태블릿 폭을 사용해야 합니다.');
assert(checkin.includes('class="event-row event-undo"'),
  '되돌리기 행은 태블릿 두 열에서 전체 폭을 차지할 식별자가 필요합니다.');

for(const [name, css] of [['민턴LIVE 관리자', appCss], ['팀전LIVE 관리자', teamCss]]){
  assert(css.includes('@media(min-width:700px) and (max-width:1100px)'),
    `${name}에 태블릿 운영 규칙이 필요합니다.`);
  assert(css.includes('max-width:min(720px,calc(100vw - 64px));'),
    `${name}의 명부·대진 조작창은 태블릿 폭을 사용해야 합니다.`);
}

console.log('tablet layout regression ok');
