const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const section = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `${start} 설명서 구간을 찾을 수 없습니다.`);
  return source.slice(from, to);
};

const indexHtml = read('index.html');
const teamHtml = read('team.html');
const readme = read('README.md');
const simulation = read('tests/simulation.html');

const mintonManual = section(indexHtml, '<!-- ═══════════════ MANUAL PAGE ═══════════════ -->', '<script src="js/match-quality.js');
const mintonMemberGuide = section(mintonManual, '<h2>📱 회원에게 알려줄 말</h2>', '<h2>👥 도착 전·운영 도우미</h2>');

assert(mintonManual.includes('도착 전에는 실중계만 볼 수 있고 대진에서는 제외됩니다.'), '민턴LIVE 설명서는 도착 전 선수가 자동대진에서 제외됨을 안내해야 합니다.');
assert(mintonManual.includes('임원·도우미의 처리는 관리자 앱 없이도 즉시 반영됩니다.'), '민턴LIVE 설명서는 임원·도우미의 독립 운영을 안내해야 합니다.');
assert(mintonManual.includes('한 순번만 미룹니다.'), '민턴LIVE 설명서는 이번만 뒤로가 한 순번 이동임을 안내해야 합니다.');
assert(mintonManual.includes('휴식·종료 옆의 작은 뒷풀이 버튼'), '민턴LIVE 설명서는 현재 뒷풀이 버튼 위치를 안내해야 합니다.');
assert(mintonManual.includes('라이브 후 추가') && mintonManual.includes('아직 경기하지 않은 오등록만'), '민턴LIVE 설명서는 운영 시작 뒤 추가 선수의 정확한 확인·취소 범위를 안내해야 합니다.');
assert(mintonManual.includes('경기 종료·입장·이번만 뒤로는 45초 안에 취소'), '민턴LIVE 설명서는 되돌릴 수 있는 운영 처리와 시간을 정확히 안내해야 합니다.');
assert(!mintonMemberGuide.includes('이번만 뒤로'), '일반회원 안내에 임원 전용 이번만 뒤로 권한을 넣으면 안 됩니다.');
assert(!mintonManual.includes('예상 대진'), '민턴LIVE 설명서에 제거된 예상 대진 표현이 남으면 안 됩니다.');
assert(indexHtml.includes('<span class="card-title">다음 대진</span>') && !indexHtml.includes('<span class="card-title">다음·예상 대진</span>'), '민턴LIVE 관리자 화면도 다음 대진만 간결하게 표시해야 합니다.');

const teamManual = section(teamHtml, '<!-- ═══════════════ MANUAL PAGE ═══════════════ -->', '<script src="js/match-quality.js');
assert(!teamManual.includes('출석'), '팀전 설명서에 폐기한 출석 개념이 다시 노출되면 안 됩니다.');
assert(teamManual.includes('회원 응답 없이 관리자가 명단을 확정합니다.'), '팀전 설명서는 관리자 확정 명단 방식을 안내해야 합니다.');
assert(teamManual.includes('별도 단계 없이 진행 중인 실중계로 바로 들어갑니다.'), '팀전 설명서는 본인 확인 후 즉시 실중계로 이어짐을 안내해야 합니다.');
assert(teamManual.includes('민턴LIVE 선수 명단을 가져옵니다.'), '팀전 설명서는 서비스 간 명단 재사용을 안내해야 합니다.');
assert(teamManual.includes('관리자 앱이 꺼져 있어도 승패는 즉시 반영됩니다.'), '팀전 설명서는 임원 승패 입력이 관리자 앱과 독립적임을 안내해야 합니다.');
assert(teamManual.includes('팀전 이어가기'), '팀전 설명서는 앱 재실행 후 이어가기 동선을 안내해야 합니다.');
assert(teamManual.includes('운영 현황의 숫자를 누르면 운영진과 뒷풀이 신청 인원·이름을 확인'), '팀전 설명서는 실제 운영 현황 명단 확인 동선을 안내해야 합니다.');
assert(!teamManual.includes('92점 이상'), '팀전 설명서는 구현과 다른 고정 품질점수 기준을 안내하면 안 됩니다.');
assert(teamManual.includes('48시간까지만 이어갈 수 있습니다.'), '팀전 설명서는 중계 재개 기한과 정리 시점을 정확히 안내해야 합니다.');
assert(!teamManual.includes('뒤풀이'), '팀전 설명서의 뒷풀이 표기를 통일해야 합니다.');

assert(!readme.includes('예상 대진'), 'README에 제거된 예상 대진 표현이 남으면 안 됩니다.');
assert(!readme.includes('뒤풀이'), 'README의 뒷풀이 표기를 통일해야 합니다.');
assert(!simulation.includes('뒤풀이'), '시뮬레이션 안내의 뒷풀이 표기를 통일해야 합니다.');

console.log('live manual policy regression ok');
