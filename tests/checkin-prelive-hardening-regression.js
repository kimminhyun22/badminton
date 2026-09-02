'use strict';
/**
 * 2026-08-16 실전 전날 감사(32명·3코트·21점 대비)에서 확정된 보강들.
 * 핵심 발견: 임원 패널은 세션 갱신마다 innerHTML 통째 재작성이라, 보존 코드가
 * 없으면 (1) 선수 추가 폼 입력이 타이핑 중 지워지고 연령이 40대로 무음 복귀,
 * (2) 분배 보드·완료 목록 내부 스크롤이 매번 맨 위로 리셋된다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'checkin.html'), 'utf8');

// ① 재렌더 보존: 입력값·포커스·스크롤
const panelBlock = src.slice(src.indexOf('if(officialPanel){'), src.indexOf('if(isLiveOperatorPlayer(selected)){'));
assert(panelBlock.includes("querySelectorAll('input,select')") && panelBlock.includes('keep[el.id]'),
  '임원 패널 재렌더 전 입력·선택값을 저장해야 합니다 — 없으면 연령 선택이 40대로 무음 복귀합니다.');
assert(panelBlock.includes('document.activeElement') && panelBlock.includes('setSelectionRange'),
  '포커스·캐럿 위치도 복원해야 타이핑이 끊기지 않습니다.');
assert(panelBlock.includes('.official-fair-board-list') && panelBlock.includes('.official-completed-list')
  && panelBlock.includes('scrollTop'),
  '분배 보드·완료 목록 스크롤 위치를 복원해야 합니다.');
assert(panelBlock.indexOf('officialPanel.innerHTML=officialHtml') > panelBlock.indexOf('keep[el.id]'),
  '저장은 innerHTML 교체보다 먼저여야 합니다.');

// ② 2명 예약: 성공했을 때만 픽커를 닫는다 (거절 시 고른 두 명 유지)
assert(/const ok=await sendOfficialPartnerReservation\(ctx\.actorId,aId,bId\);\s*if\(ok\)closeOfficialReplacePicker\(\)/.test(src),
  '2명 예약은 성공 반환 후에만 픽커를 닫아야 합니다.');
assert(src.includes('return !!ok;   // 호출부(2명 예약 픽커)가 성공 여부로 닫을지 결정한다'),
  'sendOfficialPartnerReservation 이 성공 여부를 반환해야 합니다.');
// 실력차 게이트는 3중 방어(클라·서버 접수·매치메이커)라 우회 금지 — 대신 안내 문구
assert(src.includes('실력 차가 큰 두 명은 자동 매칭 예약이 안 됩니다'),
  '2명 예약의 실력차 제한을 시트 안내문이 예고해야 합니다.');

// ③ 완료 로그 null 홀 방어 — 여기서 터지면 임원 화면 렌더 전체가 멎는다
assert(src.includes("(session?.completedLog||[]).filter(r=>r&&typeof r==='object')"),
  '완료 로그 렌더는 null 홀을 걸러야 합니다.');

// ④ 이름 자동 축소는 페인트 전(마이크로태스크)에 — 원크기 노출 깜빡임 방지
assert(src.includes('queueMicrotask') && !/autoFitNames\._t=setTimeout/.test(src),
  '자동 축소 디바운스는 타이머가 아니라 마이크로태스크여야 페인트 전에 줄어듭니다.');

// ⑤ 분배 보드 가로 넘침 방어 (fr-name 은 autoFitNames 대상이 아니다)
assert(src.includes('overflow-wrap:anywhere'),
  '긴 이름이 보드 행을 가로로 뚫지 않아야 합니다.');
assert(src.includes('overflow-y:auto;overflow-x:hidden'),
  '보드 목록은 세로만 스크롤돼야 합니다.');

// ⑥ 마무리 모드 일관성 — 경보가 침묵하는데 보드만 부족 칩·죽은 버튼을 내면 모순
assert(/const finish=!!session\?\.event\?\.finishMode;/.test(src)
  && src.includes('if(!finish&&r.gap>=FAIR_PRIORITY_GAP)'),
  '마무리 모드에서는 분배 보드가 부족 칩·대진 짜기 버튼을 접어야 합니다.');
assert(src.includes('마무리 중 — 게임 수 확정 단계'),
  '마무리 모드 요약 줄은 부족 경고 대신 확정 단계임을 알려야 합니다.');

// ⑦ 일시정지 대진은 대기 크레딧 제외 — 갇힌 선수의 부족 경보가 침묵하면 안 된다
assert(src.includes("!item?.restPass&&((item?.playerIds)||[]).map(String).includes(target)"),
  '일시정지(restPass) 대진에 묶인 선수는 대기 크레딧을 받으면 안 됩니다.');

// ⑧ 시트 첫 열기 — display:none 상태에서 채우고 보이므로, 보인 뒤 한 번 더 재야 한다
assert((src.match(/requestAnimationFrame\(\(\)=>\{try\{autoFitNames\(\);\}catch\(e\)\{\}\}\);/g) || []).length === 3,
  '시트를 여는 세 경로 모두 보인 다음 프레임에 이름 크기를 다시 재야 합니다(두 번 탭 문제).');
// 「현재 다음 대진」 줄은 overflow:hidden 이라 최소 크기가 0 — 트랙이 눌러 겹쳐 보일 수 있다
assert(src.includes('.replace-picker-current{flex-shrink:0;min-height:34px;}'),
  '예약현황 줄은 눌리지 않도록 최소 높이가 있어야 합니다.');

console.log('checkin prelive hardening regression ok');
