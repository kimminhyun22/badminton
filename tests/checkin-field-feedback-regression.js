'use strict';
/**
 * 2026-08-16 실전 피드백 3건 (운영자, 민턴LIVE 실운영 후).
 *
 * ① "참가선수 이름이 폰에 따라 잘리거나 '**' 처럼 깨짐 — 커서 깨질 경우 자동으로
 *    사이즈를 조절해줘야" → OS 글자 확대 차단 + 굵기 900 상한(로드된 폰트의 최대,
 *    1000 요구는 가짜 볼드 합성으로 글리프가 깨짐) + 넘치면 자동 축소.
 * ② "임원이 추가 참여 선수 등록 시 연령 옵션이 빠져 있었어" → 연령은 실효급수의
 *    큰 항(50대 −1.2)이라 기본값 고정이면 매칭이 틀어진다.
 * ③ "예약 게임 추가 시 4명 강제 대신 2명만 예약해도 자동 매칭" → 기존 파트너
 *    접수(official-partner-reservation)를 대진 짜기 시트에서 재사용.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const checkin = fs.readFileSync(path.join(__dirname, '..', 'checkin.html'), 'utf8');

// ① 이름 깨짐 방지 3중 장치
assert(checkin.includes('text-size-adjust:100%'),
  '폰의 시스템 글자 확대(font boosting)를 차단해야 이름 칸이 밀리지 않습니다.');
assert(checkin.includes('.event-active-player.replaceable{font-size:23px;font-weight:900'),
  '진행 중 이름은 900 굵기여야 합니다 — 폰트에 없는 1000은 일부 폰에서 글리프를 깨뜨립니다.');
assert(checkin.includes('.event-next-player.replaceable{font-size:19px;font-weight:900'),
  '다음 대진 이름도 900 굵기여야 합니다.');
assert(!/\.event-(active|next)-player[^{]*\{[^}]*font-weight:1000/.test(checkin),
  '이름 요소에 1000 굵기가 남아 있으면 안 됩니다.');
assert(checkin.includes('function autoFitNames()') && checkin.includes('el.scrollWidth>el.clientWidth'),
  '이름이 칸을 넘치면 자동으로 글자를 줄여야 합니다.');
assert(checkin.includes('new MutationObserver('),
  '자동 축소는 렌더 때마다 다시 걸려야 합니다.');
assert(/autoFitNames[\s\S]{0,400}size<=13/.test(checkin),
  '자동 축소 하한(13px)이 있어야 무한 축소로 안 읽히는 글자가 되지 않습니다.');

// ② 임원 선수 추가 연령 옵션
assert(checkin.includes('officialAddAge_'), '선수 추가 폼에 연령 선택이 있어야 합니다.');
for (const age of ['20대', '30대', '40대', '50대', '60대+']){
  assert(checkin.includes(`value="${age}"`), `연령 옵션 ${age} 가 있어야 합니다.`);
}
assert(checkin.includes("document.getElementById('officialAddAge_'+actorId)?.value||'40대'"),
  '전송 시 폼의 연령 값을 읽어야 합니다(하드코딩 금지).');
assert(!checkin.includes("ageGroup:'40대',"),
  "ageGroup 하드코딩('40대')이 남아 있으면 안 됩니다.");

// ③ 2명 예약 자동 매칭
assert(checkin.includes('function submitOfficialComposePair()'),
  '대진 짜기에서 2명 예약 제출 함수가 있어야 합니다.');
assert(/submitOfficialComposePair[\s\S]{0,300}sendOfficialPartnerReservation\(ctx\.actorId,aId,bId\)/.test(checkin),
  '2명 예약은 기존 파트너 접수 명령을 재사용해야 합니다(새 서버 명령 금지).');
assert(checkin.includes('ctx.picked.length===2') && checkin.includes('두 명만 예약'),
  '정확히 2명을 골랐을 때만 예약 버튼이 보여야 합니다.');
assert(checkin.includes('2명만 고르면 예약 버튼이 나옵니다'),
  '시트 안내문이 2명 예약 경로를 알려줘야 합니다.');

console.log('checkin field feedback regression ok');

// ④ 2026-08-16 운영자: "게임 게시 후부터 완료게임수 표시와 대진도 볼 수 있으면" —
//    서버가 종료마다 completedLog(이름 스냅샷, 최근 80)를 남기고, 임원 화면과
//    관리자 운영 기록이 완료 수 + 지난 대진 목록을 보여준다. 되돌리기 스냅샷에도
//    포함되어 종료 취소 시 로그가 남지 않는다.
const mm = fs.readFileSync(path.join(__dirname, '..', 'functions', 'daily-server-matchmaker.js'), 'utf8');
const eng = fs.readFileSync(path.join(__dirname, '..', 'functions', 'daily-official-engine.js'), 'utf8');
const dailySrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'daily.js'), 'utf8');
assert(mm.includes('session.completedLog = Array.isArray(session.completedLog)')
  && mm.includes('session.completedLog.length > 80'),
  '서버는 완료 로그를 이름 스냅샷으로 최근 80개 유지해야 합니다.');
assert(eng.includes('recordCompletedMatchHistory(session, match, now)'),
  '완료 시각(now)이 로그에 실려야 합니다.');
assert(eng.includes('completedLog: session.completedLog || []')
  && eng.includes('session.completedLog = clone(snapshot.completedLog || [])'),
  '되돌리기 스냅샷·복원에 completedLog 가 포함돼야 종료 취소가 로그를 되돌립니다.');
assert(checkin.includes('function officialCompletedLogHtml()')
  && checkin.includes('완료 ${log.length}경기'),
  '임원 화면에 완료 경기 수 + 지난 대진 접이식 목록이 있어야 합니다.');
assert(dailySrc.includes('completedLog:_dailyMatches'),
  '관리자 게시(자동 처리·콜드 복구)에도 완료 로그가 실려야 합니다.');
// 시작 시각 — 실제 게임 소요시간(21점제 검증)은 startAt~endAt 에서만 잴 수 있다
assert(mm.includes('startAt: number(match.startedAt)'),
  '서버 완료 로그에 시작 시각이 남아야 소요시간을 잴 수 있습니다.');
assert(dailySrc.includes('startAt:Number(m.startedAt)'),
  '관리자 게시 완료 로그에도 시작 시각이 실려야 합니다.');
assert(checkin.includes('oc-dur'),
  '임원 완료 목록에 게임 소요시간이 보여야 합니다.');
assert(dailySrc.includes('daily-result-list'),
  '관리자 운영 기록 카드가 완료 대진 목록을 보여줘야 합니다.');
