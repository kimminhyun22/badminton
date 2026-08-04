# 관리자 쓰기를 임원과 같은 명령 경로로 (1단계 설계)

작성 2026-08-03. 배경은 그날 밤의 사고다. 관리자 화면과 회원 화면의 대진이 갈라졌고,
회원 화면 저장이 계속 실패했다. 원인은 기능이 아니라 구조였다.

```
관리자 앱  ──[세션 전체를 통째로 덮어쓰기]──▶  Firebase 세션
임원 화면  ──[명령]──▶ 서버 함수 ──[부분 수정 + revision +1]──▶  같은 세션
```

한 문서에 통째로 쓰는 쪽과 조금씩 고치는 쪽이 동시에 붙어 있다. 관리자 앱은 서버가
고친 것을 **번호 순서대로 하나도 빠짐없이** 따라잡아야 다음 게시를 할 수 있는데,
처리된 명령 기록은 60분만 보관된다(`REQUEST_STALE_RETAIN_MS`). 한 시간 이상 어긋나면
스스로는 절대 복구되지 않는다. 실제로 그날 서버는 19번까지 가 있었고 기록에는 19번
하나만 남아 있었다.

**관리자가 쓰기를 멈추면 이 문제군 자체가 성립하지 않는다.** 그것이 이 문서의 목표다.

## 관리자 쓰기 동작 25개의 분류

`_dailyBlockServerSync({action:…})` 가 붙은 자리가 곧 쓰기 동작이다.

### A. 서버 명령이 이미 있는 것 — 갈아끼우면 된다

| 관리자 동작 | 서버 명령 | 비고 |
|---|---|---|
| 선수 상태 변경 | `official-player-status` | |
| 선수 추가 | `official-player-add` | |
| 참가자 등록 | `official-player-arrival` | |
| 다음 대진 투입 | `official-queue-enter-free` | |
| 대진 순서 변경 (2곳) | `official-queue-yield` | |
| 대진 선수 변경 | `official-queue-replace` | |
| 파트너 지정 · 해제 | `official-partner-reservation` · `-cancel` | ⚠ 아래 gap-2 |
| 게임신청 등록 · 취소 | 위와 같은 계열 | ⚠ 아래 gap-2 |
| 경기 완료 | `official-court-complete` | ⚠ 아래 gap-1 |
| 운영 도우미 지정 · 해제 | `official-temporary-grant` · `-revoke` | 이미 서버 경유 |

### B. 명령을 새로 만들어야 하는 것 — 운영 중에도 쓴다

- 선수 제외, 이름 변경
- 대진 재생성 · 대기 경기 재생성 · 대기 경기 삭제 · 수동 경기 등록
- 마무리 전환
- 게임신청 반영 (2곳)

### C. 준비 단계로 분리 — 명령으로 만들 필요가 없다

운동이 시작된 뒤에는 건드리지 않는 것들이다. **세션 게시 전에만 허용**하면 된다.

- 코트 설정 변경, 운영 시간 변경, 자동 진행 설정 변경
- 참가자 불러오기, 팀전 선수 명단 가져오기
- 대진 게시 시작

## 그대로 옮기면 깨지는 곳 두 군데

### gap-1 · 승패가 사라진다

관리자는 `dailyCompleteMatch(id, winnerSide)` 로 **누가 이겼는지**를 함께 기록한다.
서버의 `applyComplete` 는 `matchId` · `expectedStartedAt` · `expectedPlayerIds` 만 받고
**승자 필드가 없다**. 임원 화면은 승패를 입력하지 않기 때문이다.

그대로 갈아끼우면 관리자가 기록하던 승패가 조용히 사라진다. 서버 명령에 승자를
선택 항목으로 추가해야 한다.

### gap-2 · 파트너를 저장하는 자리가 다르다

- 관리자: 선수 객체에 `partnerName` · `partnerId` 를 직접 박는다 (즉시 확정)
- 임원: `session.reservations` 목록에 **게임신청으로 접수**한다 (대진 편성 때 반영)

둘은 저장 위치도 시점도 다르다. 통일하려면 관리자도 예약 목록 방식으로 가야 하고,
그러면 "관리자가 지정하면 즉시 확정"이라는 지금의 사용감이 바뀐다.

## 단계

1. **gap-1 · gap-2 를 먼저 메운다** — 서버 명령에 승자 추가, 파트너 저장 자리 통일
2. **A 를 갈아끼운다** — 관리자 동작이 서버 명령을 호출하고 결과를 받아 그린다
3. **C 를 준비 단계로 잠근다** — 세션 게시 후에는 설정 변경 차단
4. **B 의 명령을 만든다** — 남은 운영 동작
5. 관리자 앱의 세션 직접 쓰기(`_dailyWriteCheckinPayload`)를 제거한다. 여기까지 오면
   revision 따라잡기 자체가 없어진다

3번까지만 해도 그날 밤의 사고는 재발하지 않는다. 5번은 마무리다.

## 운영자 판단 (2026-08-03 확정)

**① 승패 — 서버 명령을 고치지 않는다.** "민턴LIVE는 팀전과 달리 승패 입력이 큰 의미가
없다." 실제로 `winnerSide` 는 daily.js 에서 두 곳에만 쓰이고, 대진 공정성 계산에는
들어가지 않는다. 경기 완료를 서버 명령으로 보낼 때 승자는 싣지 않는다. gap-1 소멸.

**② 파트너 — 예약(게임신청) 방식으로 통일한다.** 아래 gap-2 보강 참조.

**③ 준비 단계를 잠그지 않는다.** 현장 융통성을 남긴다. 다만 그러면 코트 수·운영
시간·자동 진행 설정도 운동 중에 바뀌므로, C 를 "잠금"이 아니라 **설정 변경 명령 1종
신설**로 처리한다. 융통성은 그대로 두고 기록하는 주체만 서버로 모은다.

## gap-2 보강 — 관리자에는 이미 예약 시스템이 있다

파고들어 보니 관리자 화면에는 **두 갈래가 공존**하고 있었다.

| 갈래 | 저장 위치 | 편성 반영 방식 |
|---|---|---|
| 관리자 파트너 지정 | 선수의 `partnerName` · `partnerId` | 대진 점수에서 가산 (`isPartnerPair`, daily.js 10527·10642) |
| 게임신청(예약) | `_dailyReservations[]` | 큐 항목에 `reservationId` 를 달아 **직접 편성** |

임원이 접수하는 파트너는 두 번째 갈래로 들어간다. 즉 통일은 새 구조를 만드는 일이
아니라 **`partnerName` 갈래를 걷어내고 예약 하나로 모으는 정리**다.

부수 효과가 하나 있다. 예약은 큐로 승격되어 직접 편성되므로, 지금의 "점수 가산"보다
오히려 확정력이 강하다. 운영자가 지정한 짝이 더 확실히 붙는다.

정리 대상: `dailyStartPair` · `dailyConfirmPair` · `dailyClearPair`, 선수 행의 파트너
표시(`daily-paired`), 편성 점수의 `isPartnerPair` 두 곳, 그리고 오늘 만든 파트너 지정
도구 모드의 호출부.

## gap-2 완료 (2026-08-03, v1.10.502)

`partnerName` 갈래를 걷어내고 예약 하나로 모았습니다.

| 자리 | 전 | 후 |
|---|---|---|
| 관리자 파트너 지정 | 선수에 `partnerName`·`partnerId` | `mode:'pair'` 예약 (`source:'admin-pair'`) |
| 파트너 해제 | 두 선수의 필드를 null | 예약 삭제 + 그 대기표 정리 |
| 화면 표시 | `p.partnerName` | `_dailyPartnerNameOf(id)` 가 예약에서 조회 |
| 세션 payload | `partnerName`·`partnerId` 를 씀 | 안 씀 |

같이 사라진 것들:

- `_dailyPartnerConstraintOk` · `_dailyValidTeamPairing` · `_dailyPairedLabels` ·
  `_dailyPairButton` · `_dailyReservationPairConflict` (모두 `partnerName` 만 읽던 함수)
- 서버 `reservationConflictsWithPairing` — **두 갈래가 겹칠 때 예약을 통째로
  버리던 방어 코드입니다.** 갈래가 하나가 되어 충돌 자체가 성립하지 않습니다
- 임원 화면의 "관리자 지정" 안내 3곳 — 이제 `접수됨` 하나로 덮입니다

바뀐 것 두 가지:

- 서버 선수 교체 거절 사유가 `파트너로 묶인 선수` 에서 `게임신청으로 잡힌 대진` 으로
  바뀌었습니다. 예약이 걸린 대기표 전체를 보므로 범위가 조금 넓어집니다
- 편성 점수의 "지정 파트너는 반복 감점 면제"가 없어졌습니다. 예약은 `-1200` 으로
  들어가므로 반복 감점보다 훨씬 셉니다

`js/daily.js` 9200줄 아래의 `partnerName` 은 **팀전·대진표의 `_partners` 시스템**
으로, 민턴LIVE와 무관합니다. 공유 함수 `formTeams` · `diversityScore` 의
`isPartnerPair` 도 그쪽이 쓰므로 남겨 두었습니다(민턴LIVE 선수에는 이제 그 필드가
없어 자동으로 비활성입니다).

회귀: `tests/kokmatch-partner-conflict.js` 를 통합 경로 기준으로 다시 썼습니다.
낡은 세션에 `partnerName` 이 남아 있어도 예약이 이기는지 봅니다 — 이 필드를 다시
읽기 시작하면 그때 예전 충돌이 되살아납니다.

## 2단계 진행 (2026-08-03, v1.10.503)

### 먼저 막혀 있던 것 — 서버가 관리자 명령을 안 받았다

관리자는 세션을 만든 주체라 명단에 **선수로 들어 있지 않습니다.** 서버의
`validateCommon` 은 `isLiveOperator(actor)` 로 임원 본인만 확인하고 있었고,
관리자 자격(`adminClaim`)은 운영 도우미 지정·해제와 오등록 취소 3종에만 열려
있었습니다. 그대로 두면 관리자가 보낸 명령은 전부 거절됩니다.

그래서 초대 토큰으로 확인한 관리자 연결이면 운영 명령 전체를 받도록 열었습니다.

> **알아 둘 것** (2026-08-04 정정): 처음에는 "임원 링크를 가진 사람이 관리자
> 명령을 쓸 수 있다"고 적었는데, **실제 운영에서는 해당되지 않습니다.**
>
> - 운영자는 지금까지 **회원·임원 공용 링크(`링크 공유`)만** 써 왔고 임원 링크는
>   한 번도 배포하지 않았습니다
> - 임원은 공용 링크에서 **본인 이름을 고르면** 권한이 붙습니다
>   (`claimOfficialInvite(p)` → roster claim). 초대 토큰이 필요 없습니다
> - 게시되는 세션에는 `officialInvite.tokenHash`(해시)만 실립니다.
>   **원문 토큰은 관리자 브라우저 localStorage 밖으로 나가지 않습니다**
>
> 즉 초대 토큰은 사실상 관리자 전용 자격이고, `adminClaim` 확대로 새로 열린
> 것은 없습니다. 단, **앞으로도 임원 링크를 배포하지 마십시오.** 배포하는 순간
> 받은 사람이 관리자 명령을 쓸 수 있게 됩니다.
>
> 진짜 구멍은 따로 있습니다 — `database.rules.json` 이 세션 id 만 알면 인증 없이
> 세션 전체를 읽고 쓸 수 있게 열려 있습니다. 명령 경로는 보안 경계가 아니라
> 사고 방지 장치입니다.

### 공통 경로

`_dailySendAdminCommand(command, options)` 하나로 모았습니다.

- 게시 전(`_dailyCheckinId` 없음)이면 `{live:false}` — 그때만 호출부가 직접 씁니다
- 게시 후에는 명령을 보내고 `_dailyPullServerReconcile()` 로 **결과를 받아 그립니다**
- **실패하면 로컬을 건드리지 않습니다.** 현장에서 그 동작이 막히더라도 관리자
  원본과 서버가 갈라지는 것보다 낫다는 판단입니다(운영자 확정)

`dailySetTemporaryOfficial` 도 이 경로로 정리했습니다.

### 옮긴 것

| 관리자 동작 | 서버 명령 | 남은 조건 |
|---|---|---|
| 선수 상태 변경 | `official-player-status` | wait·rest·done 만. 도착 전(planned)은 명령 없음 |
| 파트너 지정 | `official-partner-reservation` | |
| 파트너 해제 | `official-partner-cancel` | |
| 게임신청 취소 | `official-partner-cancel` | |
| 참가자 등록(현장 참가) | `official-player-arrival` · `official-player-add` | 선수마다 1건. '도착 전 등록'은 명령 없음 |
| 다음 대진 투입 | `official-queue-enter-free` | 빈 코트 입장 대기 상태만 |
| 대진 순서 변경 | `official-queue-yield` | 한 칸 뒤로만 |
| 경기 완료 | `official-court-complete` | 승자는 안 싣습니다(gap-1 결정) |
| 운영 도우미 지정·해제 | `official-temporary-grant` · `-revoke` | 공통 경로로 정리 |

`dailyCompleteMatch` 와 `dailyStartQueueItem` 은 **재생(replay)과 자동 투입이
그대로 호출**합니다. 그래서 운영자 버튼만 `dailyOperatorCompleteMatch` ·
`dailyOperatorStartQueueItem` 래퍼를 거치게 했습니다. 원본 함수를 그대로 바꾸면
서버 결과를 관리자 원본에 옮기는 재생 경로가 자기 자신에게 명령을 보냅니다.

### 옮기지 못한 것 — 문서의 A 분류가 낙관적이었다

| 동작 | 왜 안 되나 |
|---|---|
| 선수 추가(직접·게스트) | `official-player-add` 는 **클럽 명부 후보 전용**입니다. 직접 입력·게스트를 넣는 명령이 없습니다 |
| 대진 선수 변경 | `official-queue-replace` 는 **서버가 교체 선수를 직접 고릅니다.** 관리자처럼 "이 선수로"를 지정할 수 없고, 일시정지한 대진에서만 됩니다 |
| 대진 순서 — 앞으로·드래그 | `official-queue-yield` 는 한 칸 뒤로만 표현합니다 |
| 게임신청 등록(4명 경기) | 같은 편 2명 접수 명령만 있습니다 |

이 넷은 실질적으로 **B(명령 신설)** 입니다. 4번 단계로 넘깁니다.

### 확인 중 알게 된 것

`dailyAddReservation` 과 `dailyMoveQueueItem` 은 **지금 부르는 데가 없습니다.**
관리자 화면의 게임신청 등록 폼(`dailyResA1` 등)과 순서 버튼이 `index.html` 에서
빠져 있어, `dailyRenderReservations` 도 `dailyReservationBox` 를 못 찾고 바로
돌아옵니다. 서버 경로는 붙여 두었지만 화면에서 닿지는 않습니다.

회귀: `tests/daily-admin-command-path-regression.js`.
관리자 자격이면 적용되고, 아니면 예전처럼 거절되는지(임원 본인 확인은 그대로),
그리고 명령 전송 경로가 실패 시 관리자 원본을 건드리지 않는지 봅니다.

## 3단계 완료 — 설정 변경 명령 (2026-08-03, v1.10.504)

`official-settings-update` 하나가 코트 수·운영 시간·자동 진행을 모두 받습니다.
③ 결정대로 **잠그지 않았습니다.** 운동 중에도 바꿀 수 있고, 기록하는 주체만
서버로 옮겼습니다.

거절하는 것: 1~12 밖의 코트 수, `HH:MM` 아닌 시각, 종료가 시작보다 앞선 시간,
바꿀 값이 없는 요청, 기대한 코트 수와 어긋난 요청, 그리고 **진행 중인 코트를
잘라내는 축소**(3코트에서 경기 중인데 2코트로 줄이기).

이 명령은 **관리자 전용**입니다. 임원 연결로는 거절합니다.

회귀: `tests/daily-settings-command-regression.js`

## 4단계 완료 — B 명령 (2026-08-03, v1.10.504)

### 먼저 한 일: 화면에서 실제로 닿는 동작만 골랐습니다

문서의 25개 동작 중 상당수가 이미 `index.html` 에서 빠져 있었습니다.
호출부가 아예 없는 것들:

`dailyForceRebuildQueue`(대진 재생성) · `dailyAddReservation`(게임신청 등록) ·
`dailyToggleAutoAssign`(자동 진행) · `dailyUpdateOperatingHours`(운영 시간) ·
`dailyCancelMatch` · `dailyImportDirect`(참가자 불러오기) ·
`dailyApproveReservationRequest`

입력칸도 없습니다 — `dailyStartTime` · `dailyEndTime` · `dailyAutoAssign` ·
`dailyReservationType` · `dailyResA1` · `dailyReservationBox` 전부 없습니다.
그래서 `dailyRenderReservations` 는 상자를 못 찾고 바로 돌아옵니다.
**되살릴지 지울지 정해야 합니다.** 명령은 붙여 뒀지만 화면에서 닿지 않습니다.

### 새로 만든 명령 7종

| 관리자 동작 | 명령 |
|---|---|
| 선수 제외 | `official-player-remove` |
| 이름 변경 | `official-player-rename` |
| 선수 추가(직접·게스트) | `official-player-create` |
| 대기 경기 삭제 | `official-queue-delete` |
| 대기 경기 재생성 | `official-queue-regenerate` |
| 게임신청 반영 | `official-reservation-promote` |
| 마무리 전환 | `official-finish-mode` |

전부 **관리자 전용**입니다. 이름 변경은 `partnerCount` 처럼 이름을 키로 쓰는
기록과 화면용 이름 배열까지 함께 옮깁니다.

### 넓힌 명령 2종

- `official-queue-replace` 에 `inPlayerId` — 관리자는 "이 선수로"를 지정합니다.
  임원은 여전히 지정 못 하고 서버가 고릅니다. 관리자 지정일 때는 '일시정지한
  대진에서만' 제약과 균형 점수 하한을 적용하지 않습니다(운영자가 보고 고른 것이라)
- `official-queue-yield` 에 `allowFreeMove` — 관리자 드래그는 임의 위치로,
  임원의 '이번만 뒤로'는 그대로 한 칸만

두 옵션 다 관리자 연결이 아니면 거절합니다. 안 그러면 임원이 기본 규칙을
우회하게 됩니다.

회귀: `tests/daily-admin-operation-command-regression.js`

### 덤: 테스트 헬퍼가 `async function` 을 몰랐습니다

여러 테스트가 `src.indexOf('function 이름')` 으로 소스를 잘라 씁니다.
끝 표시 함수가 `async function` 이 되면 잘린 조각 끝에 `async` 만 남아
평가할 때 깨집니다. 17개 파일의 헬퍼에 보정을 넣었습니다.
같은 이유로 래퍼 이름은 원본의 접두사가 되지 않게 지었습니다
(`dailyOperatorCompleteMatch`, `dailyCompleteMatchByOperator` 아님).

## 5단계 차단 요소 해제 (2026-08-04, v1.10.507)

`_dailyWriteCheckinPayload` 는 `dailySave()` 안에서 **무조건** 불립니다. 즉 관리자
로컬 상태가 바뀔 때마다 세션 전체를 다시 씁니다. 없애려면 **라이브 중 로컬을
고치는 동작이 하나도 없어야** 합니다.

### 명령을 붙인 둘

| 동작 | 명령 |
|---|---|
| 수동 경기 등록 (`dailyConfirmManualActiveMatch`) | `official-manual-match` (신설) |
| 도착 전 등록 (`importDailySelected('planned')`) | `official-player-create` 에 `status:'planned'` 추가 |

수동 경기는 편성기를 거치지 않으므로 코트와 선수 4명만 검사하고 그대로 올립니다.
'계속 경기'는 이미 코트에서 뛰던 선수를 옮기는 것이라 `playing` 을 허용합니다.
도착 전 선수는 아직 뛰지 않으므로 **라이브 후 추가로 기록하지 않습니다.**

### 차단 요소가 아니었던 셋 — 어제 목록이 틀렸습니다

| 동작 | 실제 |
|---|---|
| 일시정지·재개 | `_dailySyncPauseState` 가 **세션 전체가 아니라 `event.paused` 계열만** 트랜잭션으로 고칩니다. 자체 `pauseRevision` 가드도 있어 통째 쓰기 문제군이 아닙니다 |
| 팀전 명단 가져오기 | `_dailyCheckinId` 가 있으면 **아예 거부**하는 게시 전 전용입니다 |
| 회원 신청 승인 | `_dailyReservationRequestError` 가 `type==='reservation'` 을 **항상 거절**합니다. 파트너 요청은 임원 화면 전담이라 이 경로는 실행되지 않습니다 |

이 셋의 판정 근거는 회귀에 고정해 뒀습니다. 전제가 바뀌면 테스트가 먼저 깨집니다.

회귀: `tests/daily-manual-prearrival-command-regression.js`

### 이제 남은 것은 게시 자체뿐입니다

라이브 중 관리자가 세션을 직접 고치는 동작은 **대진 게시 시작
(`dailyFinishLiveTransition`) 하나만** 남았고, 그건 최초 게시라 전체 쓰기가
맞습니다.

**그래도 실측 없이 5단계에 손대지 마십시오.** 2~5단계 전부 엔진을 직접 호출하는
테스트로만 검증했습니다. callable 왕복(`submitDailyOfficialRequest`)과 grant
갱신은 실제 Firebase 로 한 번도 확인하지 않았습니다.

## 죽은 코드 정리 (2026-08-04, v1.10.505)

### 지운 것 — 호출부가 하나도 없던 6종

`dailyAddReservation` · `dailyUpdateOperatingHours` · `dailyToggleAutoAssign` ·
`dailyForceRebuildQueue` · `dailyMoveQueueItem` · `dailyImportDirect`

각각 대체 경로가 있어서 기능이 줄지 않습니다.

| 지운 것 | 대체 |
|---|---|
| 게임신청 등록 폼 | 파트너 지정 도구 + 회원·임원 접수 |
| 대진 재생성(전체) | 대기 경기 재생성(개별) |
| 순서 한 칸 이동 버튼 | 드래그(`dailyMoveQueueTo`) |
| 참가자 불러오기 | 클럽 명부 참가 등록 |

### 되돌린 것 — 설정 명령에서 운영 시간·자동 진행을 뺐습니다

어젯밤 `official-settings-update` 에 셋을 다 넣었는데, **둘은 다음 게시 한 번에
사라집니다.** 관리자 게시 payload(`_dailyPublicEvent`)가

- `queuePolicy.auto` 를 `flowInfo.auto` 로 **매번 다시 계산해 덮어쓰고**
- 운영 시간은 **아예 싣지 않습니다**

서버에 저장은 되지만 `dailySave()` 한 번이면 없어집니다. 저장한 척하는 설정은
없느니만 못해서 코트 수만 남겼습니다. 화면을 되살릴 때 payload 부터 같이
고치고 나서 추가하십시오.

### 알게 된 것 — 자동 진행은 이미 자동입니다

`_dailyAutoAssign` 은 **`false` 로만 설정되는 사실상 죽은 플래그**입니다.
자동 진행을 실제로 굴리는 것은 `_dailyOperationStarted`(대진 게시 시작)이고,
`_dailyNaturalAutoInfo()` 가 인원·코트·운영 시간으로 `auto` 를 계산합니다.
체크박스가 빠진 것은 사고가 아니라 설계 변경으로 보입니다.

### 어제 감사에서 틀린 것 하나

`dailyApproveReservationRequest` 는 **살아 있습니다.** `dailyApproveCheckinRequest`
가 회원 신청 승인 때 부릅니다. 로컬을 직접 고치고 명령이 없으므로 5단계 차단
목록에 들어갑니다.

### 경기 취소는 되살렸습니다 (2026-08-04, v1.10.506)

`dailyCancelMatch` 는 호출부가 없었지만 **지우면 안 되는 것**이었습니다.
완료와 정반대의 기능이기 때문입니다.

| | 경기 완료 | 경기 취소 |
|---|---|---|
| `games` | **+1** | 그대로 |
| `partnerCount`·`opponentCount` | 기록함 | 기록 안 함 |
| 공정성 기대치 | 소모 | **되돌림** |
| 선수 상태 | 경기 후 상태 또는 대기 | **경기 전 상태로 복원** |
| 경기 기록 | `completedAt` | `cancelledAt` |

취소 버튼이 없는 동안에는 **오투입도 종료로 처리할 수밖에 없었습니다.** 그러면
안 뛴 4명의 경기 수가 올라가고, 대진이 경기 수 적은 사람 우선이라 그날 남은
순번이 계속 틀어집니다. 한 번의 오투입이 하루치 공정성을 흔듭니다.

그래서 **명령까지 같이 만들었습니다** — `official-court-cancel`(관리자 전용).
서버는 상태 전이만 맡고, 관리자 원본은 자기가 가진 `previousStatuses` 로 더
정확히 복원합니다(`_dailyApplyMatchCancel`). 코트 카드의 「종료」 옆에
「취소」 버튼을 되살렸습니다.

회귀: `tests/daily-court-cancel-regression.js` — 완료를 **대조군으로 함께** 검사해
둘이 같아지면 잡힙니다.

### 지우려다 되돌린 것 — 임원 링크는 죽은 코드가 아닙니다

`dailyShareOfficialLink` · `_dailyOfficialCheckinUrl` 을 "호출부 없음"으로 보고
지웠다가 **되돌렸습니다.** `tests/daily-official-link-regression.js` 가 두 가지를
동시에 요구합니다.

- 관리자 화면에 **별도 임원 링크 버튼을 두면 안 된다**(line 73) — 버튼이 없는 게 의도
- 그래도 **함수는 유지**하고 클립보드 폴백·Web Share 형식을 지켜야 한다(line 78·88)

설계는 이렇습니다: **「링크 공유」 하나가 회원·임원 공용 링크**이고
(`index.html` 문구도 "회원·임원 공용 링크 공유"), 임원은 그 링크에서 본인 이름을
고르면 권한이 붙습니다. 임원 전용 링크는 예비 경로로만 남아 있습니다.

교훈: **"호출부 없음"이 곧 "죽은 코드"는 아닙니다.** 지우기 전에 테스트가 그
함수를 왜 붙잡고 있는지 먼저 읽으십시오.

## 다음 착수 지점

1. ~~gap-2 — `partnerName` 폐지, 예약으로 일원화~~ ✅
2. ~~A 를 서버 명령으로 교체~~ ✅ (9종)
3. ~~설정 변경 명령 1종 신설~~ ✅ (코트 수만)
4. ~~B 명령 신설~~ ✅ (신설 7종 + 확장 2종)
5. ~~죽은 코드 정리~~ ✅ (6종 삭제)
6. ~~경기 취소 명령 + 버튼 복원~~ ✅ 2026-08-04
7. ~~남은 차단 요소 해제~~ ✅ 2026-08-04 (명령 2종 신설, 나머지 셋은 애초에 차단 요소 아님)
8. **라이브 세션 하나로 명령 경로 실측** ← 여기부터. **코드로는 더 못 나갑니다**
9. 그 다음에야 `_dailyWriteCheckinPayload` 제거 —
   `dailySave()` 안의 무조건 게시를 떼고 최초 게시·준비 단계·복구에서만 부르기 →
   한 판 돌려 확인 → 리비전 따라잡기 분기 제거

### 5단계를 어떻게 할 것인가

한 번에 걷어내지 마십시오. `dailySave()` 가 무조건 전체 세션을 다시 쓰기 때문에,
로컬을 고치는 동작이 **하나라도** 남으면 그 동작이 서버에 반영되지 않습니다.

권하는 순서:

1. **7번을 먼저 끝냅니다.** 남은 5종에 명령이 생기면 라이브 중 로컬 변경이
   사라집니다
2. **게시를 게시 전용으로 좁힙니다.** `dailySave()` 안의 무조건 호출을 떼고,
   최초 게시·준비 단계·복구에서만 부르게 합니다
3. **한 판 돌려 보고** 회원 화면이 뒤처지지 않는지 확인합니다
4. 그때 `_dailyWriteCheckinPayload` 의 리비전 따라잡기 분기
   (`remoteRevision>payloadServerRevision` 거절)를 지웁니다. 여기까지 와야
   60분 보관 한계에 걸려 복구 불능이 되는 문제가 사라집니다

2번을 3번 없이 하지 마십시오. 그게 그날 밤 사고와 같은 종류의 변경입니다.
