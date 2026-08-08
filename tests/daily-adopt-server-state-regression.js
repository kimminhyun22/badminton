'use strict';
/**
 * 관리자 게시는 서버 리비전을 순서대로 따라잡아야 하는데 명령 기록은 60분만
 * 남습니다. 한 시간 이상 어긋나면 스스로는 절대 복구되지 않습니다
 * (2026-08-02 사고, 2026-08-08 재발: 서버 rev 21, 관리자는 낮 12시에 멈춤).
 *
 * dailyAdoptServerState 는 그 덫의 탈출구입니다 — 따라잡기를 포기하고
 * 서버 상태를 관리자 원본의 새 기준으로 받아들입니다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const daily = fs.readFileSync(path.join(__dirname, '..', 'js', 'daily.js'), 'utf8');

// 1) 탈출구가 존재하고, 동기화 오류 카드에서 누를 수 있어야 합니다.
assert(daily.includes('async function dailyAdoptServerState'), '서버 상태 채택 함수가 있어야 합니다.');
assert(daily.includes('function _dailyAdoptServerSnapshot'), '채택 변환 함수가 있어야 합니다.');
assert(/서버 운영 동기화 확인 필요[\s\S]{0,400}dailyAdoptServerState\(\)/.test(daily),
  '동기화가 막힌 바로 그 자리에서 복구 버튼을 눌러야 합니다.');
console.log('  탈출구 존재 + 오류 카드에 버튼');

const fn = daily.slice(daily.indexOf('async function dailyAdoptServerState'),
                       daily.indexOf('function _dailyServerRuntimePayload'));

// 2) 채택의 핵심은 리비전을 서버 머리로 맞추는 것입니다.
['_dailyServerRevision=Math.max(0,Number(remote.serverRevision||0))',
 '_dailyServerLastRequestId=String(remote.serverLastRequestId||\'\')',
 '_dailyObservedServerRevision=_dailyServerRevision',
 '_dailyPersistServerIdentity()'
].forEach(line=>{
  assert(fn.includes(line), `리비전 채택이 빠졌습니다: ${line}`);
});
console.log('  리비전을 서버 머리로 맞춤');

// 3) 완료 기록은 지키고, 진행분만 교체해야 합니다.
assert(fn.includes('m.completedAt||m.cancelledAt'), '완료·취소된 경기 기록은 남겨야 합니다.');
assert(fn.includes('_dailyQueueFromServerSyncItem'), '대기표는 기존 서버 동기화 변환기를 써야 합니다.');
console.log('  완료 기록 보존 + 진행분 교체');

// 4) 남의 세션을 덮어쓰면 안 됩니다. 실행 전 확인도 받아야 합니다.
assert(fn.includes('tokenHash')&&fn.includes('_dailyOfficialInviteHash'), '초대 해시가 다르면 거절해야 합니다.');
assert(fn.includes('confirm('), '한 번의 오클릭으로 기준이 바뀌면 안 됩니다.');
// 이미 적용된 옛 명령을 다시 재생하면 경기 수가 두 번 오릅니다.
assert(fn.includes('!r.serverAppliedAt&&!r.serverRejectedAt'), '적용된 옛 명령은 재생 대기열에서 빠져야 합니다.');
console.log('  세션 소유 확인 · confirm · 이중 재생 방지');

console.log('\ndaily adopt server state regression ok');
