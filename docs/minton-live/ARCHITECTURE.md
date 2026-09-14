# 민턴LIVE 구조

평소 운동(자유 회전 복식)을 돌리는 반자동 운영 도구다. 세 부분으로 나뉜다.

| 부분 | 파일 | 누가 쓰나 |
|---|---|---|
| 관리자 화면 | `index.html` + `js/daily.js` + `css/app.css` | 운영자 한 명, 한 기기. 상태는 그 브라우저 localStorage 에 있다 |
| 회원·임원 화면 | `checkin.html`(CSS·JS 인라인) + `css/member-shell.css` | 회원 전원. 클럽 임원·운영 도우미는 같은 링크에서 운영 도구가 열린다 |
| 서버 | `functions/`(Cloud Functions, us-central1) + Realtime Database | 임원·회원 명령을 트랜잭션으로 적용하고 대기표를 보충한다 |

## 하루의 흐름

1. **관리자 첫 게시**(한 번): 명부에서 참가자를 불러와 현장/도착 전을 나누고 게시 → 세션과 링크가 생긴다(`dailyPublishCheckinSession`).
2. **임원 운영 준비**(게시 전): 참가 등록 → 진행 중 코트 등록(4명 고르기) → 「대진 게시」(`official-operation-start`). 이 순간부터 서버가 대기표를 짠다.
3. **운영**: 임원·도우미가 경기 종료·교체·순서 조정·선수 상태를 처리한다. 서버 매치메이커가 빈 코트와 대기표를 자동 보충한다.
4. **마무리**: `official-finish-mode` 로 새 대진 생성을 멈추고 남은 대진만 진행한다.
5. **다음 주**: 클럽 임원이 「새 운동일 시작」(`official-session-rollover`). 같은 링크·같은 명단, 누른 임원만 현장이고 나머지는 도착 전. 관리자 게시가 다시 필요 없다.

관리자 화면은 열려 있으면 서버를 따라가는 추종자로 동작하고, 닫혀 있어도 운영은 돈다.

## 데이터 경로 (Realtime Database)

| 경로 | 내용 | 쓰는 쪽 |
|---|---|---|
| `live/checkin_<ID>/session` | 세션 원본: `players` · `event`(courts·active·next·expected·operationStarted·finishMode…) · `reservations` · `completedLog`(최근 80) · `archive`(최근 4, 요약) · `serverRevision` · `officialInvite` · `capabilities` · `expiresAt` · `rolloverAt` · `rolloverCount` | 관리자 게시 트랜잭션, 서버 명령 트랜잭션 |
| `live/checkin_<ID>/requests/<key>` | 회원·임원 요청과 서버 결과(`serverAppliedAt`·`serverRejectedAt`·`serverResult`). 행은 생성 15분 뒤 다음 명령 트랜잭션 때 정리(`pruneCommandLedger`) | 회원·임원 화면, 서버 |
| `live/checkin_<ID>/serverCommands` · `serverOps` | 서버 명령 장부와 영수증(중복·재시도 판정, 되돌리기) | 서버 |
| `live/checkin_<ID>/officialClaims/<clientId>` | 임원·관리자 연결(클레임) 기록 | 서버 |
| `live/checkin_<ID>/operator` | 관리자 하트비트(10초) | 관리자 |
| `live/checkin_<ID>/party` | 뒷풀이 신청 | 회원 |
| `liveArchive/checkin_<ID>/<at>` | 롤오버 때 지난 운동 기록: 최근 80경기까지의 completedLog·미종료 경기·선수 id/이름/경기 수(급수는 없다). 세션은 명령마다 통째로 트랜잭션되고 회원 전원이 구독하므로 세션 밖에 둔다 | 서버(콜러블) |

`live/<6자리>` 는 팀전이다(범위 밖). `cleanupExpiredLive`(6시간마다)는 만료 7일 뒤(만료값이 없으면 마지막 갱신 14일 뒤) `live/*` 와 짝이 되는 `liveArchive/*` 를 지운다. 링크 종료로 `live` 노드가 먼저 사라진 `liveArchive` 는 청소가 찾지 못한다(BACKLOG 결함 4).

## 콜러블 (`functions/index.js`)

| 이름 | 하는 일 |
|---|---|
| `claimDailyOfficialInvite` | 임원·관리자 연결. 초대 토큰 또는 명부 신원으로 확인하고 grant 토큰을 준다. 성공할 때마다 세션·초대 만료를 30일 뒤로 민다(`functions/daily-official-claim.js` `applyOfficialClaimTransaction`) |
| `submitDailyOfficialRequest` | 임원·관리자 명령. `live/checkin_<ID>` 전체를 한 트랜잭션으로 → 래퍼 `applyCommandTransaction`(`functions/daily-official-command.js`) → 엔진 `applyOfficialRequest`(`functions/daily-official-engine.js`). 롤오버면 커밋 뒤 `liveArchive` 에 기록을 쓴다(기다리지 않고 실패를 삼킨다 — BACKLOG 결함 3). 명령 크기 상한 24KiB(`MAX_COMMAND_BYTES`) |
| `submitDailyMemberStatusRequest` | 회원 본인 상태(휴식·복귀·종료) — `functions/daily-member-command.js` |
| `getDailyOfficialReconcile` | 검증된 연결에 특정 리비전 이후 서버가 적용한 요청 행(`requests`)을 돌려준다. 관리자 추종자가 쓴다 |
| `cleanupExpiredLive` | 만료 노드 청소(스케줄) |

grant 서명 비밀값 `OFFICIAL_GRANT_SECRET` 은 `defineSecret` 으로 주입된다.

## 명령 한 건의 길

임원 화면 `sendOfficial*()`(29종) 또는 4명 고르기 시트 제출 → `pushOfficialRequest()` → 콜러블 `submitDailyOfficialRequest`
→ 래퍼 `applyCommandTransaction`: 요청 행 확인·중복·**상태 게이트 1**
→ 엔진 `validateCommon`: grant 검증 → 관리자 전용 검사(`adminOnlyCommand`) → **상태 게이트 2** → `applyByType`(되돌리기 둘은 `applyUndo`)
→ `session.serverRevision + 1`, 요청 행에 결과 → 필요하면 `replenishPrepared` 로 대기표 보충

- **상태 게이트**: 행위자가 `invited`·`planned`·`done` 이면 거절한다(도착 전·종료한 사람은 운영하지 못한다). 예외는 롤오버 하나 — 지난주 「종료」로 남은 클럽 임원이 보낼 수 있어야 해서 래퍼와 엔진 두 곳 모두 예외를 둔다. 서버 밖에서도 클레임(`applyOfficialClaimTransaction`, 도착 전 임원의 연결 거절)과 임원 화면(`isLiveOperatorPlayer`)이 같은 상태를 본다.
- **관리자 명령**: 게시 뒤에는 관리자도 로컬을 직접 고치지 않고 같은 경로로 보낸다(`_dailySendAdminCommand`). 보내기 전에 먼저 게시해 서버가 모르는 경기를 만들지 않는다. 관리자 연결은 선수에 묶이지 않은 grant(`adminClaim`)라 행위자 게이트를 건너뛴다. 예외로 관리자가 세션에 직접 쓰는 곳이 둘 있다: 일시정지 상태 동기화(`_dailySyncPauseState`, 트랜잭션)와 도착 후보 명단(`_dailySyncArrivalCandidates` → `session/arrivalClub`·`arrivalCandidates`).
- **지문**: 명령은 전제한 상태(`expectedPlayerIds`·`expectedStatus`·`expectedLastStatusAt` 등)를 싣고, 서버가 다르면 「이미 바뀌었습니다」로 거절한다. 동시 조작은 이것으로만 거른다.

## 명령 목록 (엔진 `SUPPORTED_TYPES`, 34종)

- 참가: `official-player-arrival` · `-add` · `-add-cancel` · `-unarrive` · `-status` · `-create` · `-rename` · `-remove`
- 코트·경기: `official-court-complete` · `-cancel` · `-renumber` · `official-active-yield` · `official-active-replace` · `official-manual-match`(전환 등록 포함)
- 대기표: `official-queue-enter-free` · `-yield` · `-hold` · `-resume` · `-replace` · `-add` · `-delete` · `-regenerate`
- 파트너·신청: `official-partner-reservation` · `official-partner-cancel` · `official-reservation-promote`(관리자 화면에서만 씀)
- 권한: `official-temporary-grant` · `official-temporary-revoke` · `official-player-official`(관리자 전용)
- 운영: `official-settings-update`(코트 수만) · `official-finish-mode` · `official-operation-start` · `official-session-rollover`
- 되돌리기: `official-court-complete-undo` · `official-operation-undo`(45초 안)

새 명령을 넣는 곳은 `PITFALLS.md` 1번이고, `tests/daily-command-lists-parity-regression.js` 가 목록을 대조한다.

## 신원과 권한

| 역할 | 연결 방법 | 범위 |
|---|---|---|
| 관리자 | 게시한 브라우저가 초대 토큰으로 클레임(`adminClaim`) | 전부 |
| 클럽 임원 | 명부의 `isClubOfficial`. 회원 링크에서 본인을 고르면 명부 신원으로 클레임(`claimOfficialInvite`) | 관리자 전용 1종을 뺀 운영 명령 전부 + 롤오버 |
| 운영 도우미 | 클럽 임원이 현장 회원을 임시 지정(최대 4명, `isTemporaryOfficial`), 그 운동일에만 | 현장 진행(아래 표) |
| 회원 | 링크에서 본인 선택 | 자기 상태·뒷풀이·확인 |

도우미와 클럽 임원의 구분은 대부분 **임원 화면**이 건다(`sendOfficial*` 안의 `isClubOfficial` 검사). 서버가 따로 클럽 임원만 받는 것은 롤오버와 도우미 지정·해제이고, 관리자만 받는 것은 임원 자격 부여다. **알려진 결함**: 선수 추가(`official-player-create`)가 요청의 `isClubOfficial` 을 그대로 저장해 임원·도우미가 이 경계를 우회할 수 있다(BACKLOG 결함 1).

## 관리자 화면 = 서버 추종자

관리자 화면은 자기 로컬 상태로 게시본을 **다시 만들어** 올린다. 서버에서 바뀐 것을 따라 적지 않으면 다음 게시에 덮인다. 따라가는 길은 셋이다.

1. **재생**: `dailyProcessCheckinRequests` 가 요청 행의 서버 적용분을 하나씩 재검사(`_dailyOfficialRequestError`)하고 반영한다(인라인 처리 또는 라우팅 배열 → `_dailyApplyAdminOperation`). 관리자 리비전은 `_dailyServerRevision`.
2. **대조**: `_dailyPullServerReconcile` 이 `getDailyOfficialReconcile` 로 빠진 리비전을 받아 재생한다. 기록이 정리돼 이을 수 없으면 `_dailyServerReconcileError` 를 띄우고 멈춘다 — 이때의 탈출구가 채택이다.
3. **채택**: `_dailyAdoptServerSnapshot`, 수동 「서버 기준으로 다시 맞추기」(`dailyAdoptServerState`). 롤오버는 재생하지 않고 항상 채택한다(`session/rolloverAt` 리스너 → `_dailyMaybeAdoptRollover`). 지난 운동은 localStorage `daily_day_archive_v1`(최근 8건)에 남긴다.

게시 트랜잭션 `_dailyWriteCheckinPayload` 는 서버 소유 키(`archive`·`rolloverAt`·`rolloverCount`)를 옮겨 담고 만료를 서버 값보다 줄이지 않는다. 날짜가 바뀌어도 게시된 상시 세션은 보존한다(`_dailyCanResumeCrossDay`). 되돌리던 다섯 패턴은 `PITFALLS.md` 2번.

## 능력 표시 (`capabilities`)

임원 화면의 버튼은 게시 페이로드의 능력 표시가 켜져 있어야 뜬다. 옛 관리자가 게시한 세션에서 새 버튼이 헛돌지 않게 하는 장치다. 현재 17종: `officialOpsV1` · `officialOpsServerV2` · `memberStatusServerV1` · `temporaryOfficialV1` · `officialArrivalV1` · `officialLiveAdditionCancelV1` · `officialPartnerOpsV1` · `officialQueueYieldV1` · `officialQueueYieldOneStepV1` · `officialQueueHoldV1` · `officialQueueCardOpsV1` · `officialAutoHandoffV1` · `officialOperationStartV1` · `officialSessionRolloverV1` · `officialOperationUndoV1` · `pauseV1` · `afterPartyV1`. 새 임원 기능에 버튼을 달면 표시도 하나 늘린다.

**상시 세션 주의**: 능력 표시는 관리자 게시 페이로드로만 실린다. 관리자 없이 롤오버로 이어지는 세션에는 관리자가 새 버전으로 한 번 게시하기 전까지 새 버튼이 뜨지 않는다(BACKLOG).

## 시간 상수

| 상수 | 값 | 위치 |
|---|---|---|
| `STANDING_SESSION_WINDOW_MS` 상시 창 | 30일, 대진 게시·롤오버·클레임마다 다시 민다 | engine · claim |
| `ROLLOVER_MIN_AGE_MS` 롤오버 조건 | 게시 뒤 4시간 | engine |
| `ROLLOVER_ARCHIVE_KEEP` 세션 안 요약 | 4회 | engine |
| `OFFICIAL_OPERATION_TTL_MS` 명령 유효 | 30분 | engine |
| `OFFICIAL_UNDO_MS` 되돌리기 | 45초 | engine |
| `REQUEST_DONE_RETAIN_MS` 요청 행(생성 기준) | 15분 | engine |
| `LIVE_RETAIN_AFTER_EXPIRY_MS` 만료 뒤 청소까지 | 7일(만료값이 없으면 갱신 뒤 14일) | functions/index.js |
| `MAX_COMMAND_BYTES` 명령 크기 상한 | 24KiB | functions/index.js |
| `TEMPORARY_OFFICIAL_LIMIT` 운영 도우미 | 4명 | engine |
| `DAILY_CHECKIN_TTL_MS` 관리자 첫 게시 만료 | 48시간(대진 게시·클레임 때 30일로 늘어남) | daily.js |

## 대진 짜기

- 게시 뒤 대기표 보충은 서버(`functions/daily-server-matchmaker.js`, 엔진의 `replenishPrepared`)가 한다. `event.operationStarted===false` 면 짜지 않는다 — 그래서 「대진 게시」 명령이 필요했다.
- 관리자 화면에도 로컬 편성 로직이 있다(게시 전 준비·자동 배정 `dailyMaybeAutoAssign`). 가중치를 바꿀 때는 두 사본을 함께 본다.
- 혼복은 고정 문턱 `MIXED_PENALTY` 3,200 으로 나온다(동성복식 쪽 문제가 두세 개 겹칠 때). 운영자 방침의 「운동 후반」 조건은 현재 코드에서 확인되지 않는다(BACKLOG 운영자 확인 5).
- 점수 우선순위와 실측 한계는 `MATCHMAKING_NOTES.md`, 사후 감사는 `tools/audit-live-session.js`.

## 파일 지도 (grep 할 이름)

- `js/daily.js`: 저장 `dailySave` · 단계 `_dailyUiStage` · 게시 `dailyPublishCheckinSession` `dailyPushCheckinSession` `_dailyWriteCheckinPayload` `_dailyCheckinPayload` · 명령 송신 `_dailySendAdminCommand` · 추종 `dailyProcessCheckinRequests` `_dailyOfficialRequestError` `_dailyApplyAdminOperation` `_dailyPullServerReconcile` `_dailyAdoptServerSnapshot` `_dailyMaybeAdoptRollover` · 교차일 `_dailyCanResumeCrossDay` · 임원 링크 빌더(`checkin.html?official=`) · 종료·초기화 `dailyStopCheckinLink` `dailyReset`.
- `checkin.html`: 본인 선택 `selectPlayerIdentity` · 임원 연결 `claimOfficialInvite` · 송신 `pushOfficialRequest` · 운영 준비 `officialPrepPanelHtml` · 롤오버 카드 `officialRolloverCardHtml` · 운영 현황 `officialOperationsSummaryHtml` · 운영자 판정 `isLiveOperatorPlayer`.
- `functions/daily-official-engine.js`: `applyOfficialRequest` · `validateCommon` · `applyByType` · `applyUndo` · `applyOperationStart` · `applySessionRollover`.
- `functions/daily-official-command.js` `applyCommandTransaction` · `functions/daily-official-claim.js` `applyOfficialClaimTransaction` · `functions/daily-server-matchmaker.js` · `functions/daily-member-command.js`.

## 관리자 · 클럽 임원 · 운영 도우미 (2026-09-14)

| 영역 | 관리자 | 클럽 임원 | 운영 도우미 |
|---|---|---|---|
| 세션 첫 게시 | ○ | ✕ | ✕ |
| 새 운동일 시작(롤오버) | 자동 채택 | ○ | ✕ |
| 대진 게시 · 진행 중 코트 등록 | ○ | ○ | ✕ |
| 도착 처리 | ○ | ○ | ○ |
| 선수 추가 · 이름 변경 · 제외 · 도착 전 되돌리기 | ○ | ○ | ✕ |
| 코트 수 · 코트 번호 정정 | ○ | ○ | ✕ |
| 다음 대진 짜기 · 순서 이동 · 교체 · 보류/재개 | ○ | ○ | ○ |
| 대기표 삭제 · 다시 짜기 | ○ | ○ | ✕ |
| 경기 종료 · 되돌리기 · 진행 중 교체 · 선수 상태 | ○ | ○ | ○ |
| 경기 취소 | ○ | ○ | ✕ |
| 마무리 | ○ | ○ | ✕ |
| 운영 도우미 지정/해제 | ○ | ○ | ✕ |
| 클럽 임원 자격 부여 | ○ | ✕ | ✕ |
| 일시정지 | 재개만(시작 버튼은 2026-08-08 결정으로 없앴다) | ✕ | ✕ |
| 자동대진·운영 시간 | ○ | ✕ (서버 명령 없음) | ✕ |
| 명부 관리 · 백업 · 팀전 명단 가져오기 | ○ | ✕ | ✕ |
| 링크 종료 · 초기화 | ○ | ✕ | ✕ |
