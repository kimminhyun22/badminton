# 콕매치 — 에이전트 작업 지침

2026-09-14부터 **민턴LIVE는 코덱스가 생산을 맡는다.** 클로드는 감리(교차 검토)와 팀전을 맡는다.
이 파일은 작업마다 자동으로 읽힌다. 절차·구조·함정의 상세는 `docs/minton-live/` 에 있다 — 해당 작업 전에 연다.

## 1. 범위와 파일 소유

| 구분 | 파일 | 규칙 |
|---|---|---|
| 민턴LIVE (담당) | `js/daily.js` · `index.html` · `css/app.css` · `checkin.html` · `functions/daily-*.js` · `functions/index.js` 의 daily 콜러블 · `tools/audit-live-session.js` · `docs/minton-live/` | 자유롭게 고친다 |
| 공용 (조심) | `js/storage.js` · `js/match-quality.js` · `js/mobile-nav.js` · `css/member-shell.css` · `sw.js` · `manifest.json` · `scripts/` · `tests/` · `README.md` | 민턴LIVE에 필요한 만큼만. 팀전 테스트까지 전부 통과해야 한다 |
| 팀전 (범위 밖) | `team.html` · `js/team.js` · `css/team.css` · `rsvp.html` · `view.html` · `js/live-view.js` · `css/live.css` · `quiz.html` · `functions/team-*.js` | 운영자가 직접 요청할 때만 |
| 동결 | `database.rules.json` | 수정·배포 금지 |

`index.html` 이 민턴LIVE 관리자 화면이자 앱의 기본 시작 화면이다. `functions/index.js` 에는 팀전 콜러블도 함께 있다 — functions 배포는 팀전 서버도 함께 올린다는 뜻이다. 버전 올리기(`scripts/bump-version.js`)는 팀전 파일의 버전 문자열도 바꾸는데, 이것은 허용된 예외다.

## 2. 절대 하지 않는 것

1. `database.rules.json` 수정·배포. 맨몸 `firebase deploy` 도 금지(규칙까지 나간다). 서버 배포는 언제나 `firebase deploy --only functions --project kokmatch-23b31`.
2. 공개 저장소다. 회원 실명, 실전 세션 원본 JSON, 토큰·비밀값을 커밋하지 않는다. 테스트·문서의 사람은 가명(E2E임원, E2E가…)만.
3. 운영자의 실제 관리자 화면이나 진행 중인 실전 링크에 시험 명령·초기화·링크 종료를 하지 않는다. 실배포 시험은 버리는 세션에서만(`docs/minton-live/E2E.md`).
4. force push·히스토리 재작성. `main` 에 커밋·푸시하는 것이 곧 정적 배포다.
5. 검사를 통과시키려고 기준을 낮추거나 실패를 숨기기. 테스트가 틀렸으면 근거를 적고 고친다.
6. `codex/design-refresh` 브랜치 병합(운영자 결정 대기).

## 3. 작업 한 바퀴

0. `git status` 가 깨끗한지 본다. 내가 만들지 않은 변경이 있으면 멈추고 보고한다 — 다른 에이전트가 작업 중일 수 있다.
1. 고친다. 먼저 `docs/minton-live/PITFALLS.md` 에서 해당 항목을 읽는다.
2. 버전: `node scripts/bump-version.js 1.10.<다음>` — 11개 파일을 한 번에 바꾼다. 현재 버전은 README 「현재 버전」 줄.
3. 검사: `node scripts/test-all.js` — 전부 통과. 판정은 종료 코드로 한다(`| tail` 로 받으면 실패해도 뒤 명령이 이어진다). 새 동작엔 테스트를 붙이고, 고친 줄을 되돌리면 그 테스트가 깨지는지 **훼손 시험**을 한 번 한다.
4. 커밋(영어 명령문 제목, 왜 바꿨는지 드러나게).
5. `functions/` 를 바꿨으면 **먼저** 서버 배포. 정적 푸시만으로는 서버가 바뀌지 않고, 새 화면이 옛 서버에 새 명령을 보내면 거절된다.
6. `git push origin main` → 1~3분 뒤 배포본 버전 확인.
7. 서버 명령·관리자 추종·게시 경로를 건드렸으면 **실배포 E2E(관리자 탭을 켜 둔 채 임원 링크로 끝까지)** 까지가 완료다.
8. `docs/minton-live/WORKLOG.md` 맨 위에 무엇·왜·검증·남은 것을 적고, 이 기록도 커밋·푸시한다.

## 4. 이미 여러 번 터진 것 (새 코드 전에 확인)

- **새 임원 명령은 여섯 곳**: 엔진 `SUPPORTED_TYPES`·`applyByType`, 관리자 `_dailyOfficialRequestError`(재검사)·`dailyProcessCheckinRequests`(재생·라우팅 배열)·`_dailyApplyAdminOperation`(처리), 임원 화면 전송기(+능력 표시). `tests/daily-command-lists-parity-regression.js` 가 대조한다(능력 표시·버튼 연결·중복 재생 판정은 대조하지 못한다 — PITFALLS 1).
- **행위자 상태 게이트는 네 곳**: 래퍼 `functions/daily-official-command.js`, 엔진 `validateCommon`, 클레임 `functions/daily-official-claim.js`, 임원 화면 `isLiveOperatorPlayer`. 예외를 넣으면 넷 다 본다.
- **관리자 화면은 서버의 추종자다**: 추론하지 않는다 · 서버 소유 키를 지우지 않는다 · 서버 값보다 짧게 만들지 않는다 · 「있으면 안 덮음」 헬퍼를 조심한다 · 날짜로 세션 정체를 지우지 않는다. 통째 리셋(롤오버)은 재생이 아니라 채택.
- **같은 검사가 두 벌**(서버·관리자): 한쪽만 넓히면 서버가 적용한 명령을 관리자가 거절해 동기화가 멈춘다.
- 요청 페이로드에 `type` 같은 예약 필드를 다른 뜻으로 싣지 않는다(명령 종류를 덮는다).
- 위 부류는 단위 테스트가 못 잡았고 **관리자 탭을 켠 실배포 E2E** 에서만 잡혔다.

## 5. 제품 원칙 (운영자 확정, 상세는 DECISIONS.md)

- 임원의 게임 설정 자유를 최대로, 시스템은 그 뒤를 안정적으로 보정한다. 예외는 보안 경계(초대 토큰·grant)와 기록 무결성(지문 대조)뿐.
- 관리자가 없어도 임원만으로 운영이 돈다. 관리자를 불러야 하는 일이 남아 있으면 그게 다음 할 일이다.
- 디자인은 심플, 기능은 직관. 버튼·문구가 많을수록 혼란이다. 같은 사실은 한 곳에서만 말하고, 처리할 게 없는 상자는 그리지 않는다.
- 이름 하나·장치 하나: 같은 것을 다르게 부르지 않고, 같은 일을 하는 입구를 여러 개 두지 않는다. 새 기능은 새 카드가 아니라 상황판에 얹는다.
- 검수 기준은 폰: 375px, 320px에서도 가로 스크롤 없음, 폰 글자 하한 12px, font-weight 900 상한, 긴 한글 이름은 잘리지 않게.
- 「정리했다」고 말하기 전에 그 문구가 실제로 화면에 보이는지 확인한다(숨겨진 사본을 지운 건 정리가 아니다).
- 후보 목록은 정렬로 뒤에 둘 수는 있어도 지우지 않는다 — 임원이 지목한 사람이 없으면 그 일을 못 한다.
- 대진 가중치는 `MATCHMAKING_NOTES.md` 를 먼저 읽는다. 가중치를 올릴수록 좋아지지 않았다 — 시뮬로 분포까지 본다.

## 6. 이 Mac과 샌드박스

- node: PATH 에 없으면 `~/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`.
- 네트워크가 필요한 일: `git push`, `firebase deploy`, `firebase database:*`, 배포본 확인(`curl`), 실배포 E2E. 샌드박스가 막으면 승인을 요청하거나 `-c sandbox_workspace_write.network_access=true`.
- 헤드리스 크롬은 샌드박스에서 뜨지 않는다. 화면 확인과 E2E는 브라우저 도구로 **실제 배포 주소**에서 한다. 로컬 HTTPS 리그를 만들지 않는다.
- firebase CLI 는 `/usr/local/bin/firebase`(로그인됨). 서버 비밀값 `OFFICIAL_GRANT_SECRET` 은 이미 설정돼 있으니 건드리지 않는다.

## 7. 보고와 감리

- 완료 보고는 실측 증거로: 검사 결과 줄, 배포 버전, E2E 결과. 못 한 것은 못 했다고 쓴다.
- 운영자만 정할 수 있는 것(`BACKLOG.md` 「운영자 확인」)만 묻고, 되돌릴 수 있는 구현 선택은 스스로 정해 진행한다.
- 다음 경우 `docs/minton-live/AUDIT-LOG.md` 에 「감리 요청」 한 줄을 남기고 다음 일을 계속한다: functions 배포, 새 명령 종류, 관리자 추종·게시 경로 변경, 실전 전날 배포.

## 문서 지도 (`docs/minton-live/`)

| 파일 | 내용 |
|---|---|
| `RUNBOOK.md` | 검사·버전·배포·되돌리기·실전 사후 감사·현장 피드백 처리 |
| `E2E.md` | 실배포 E2E 절차와 콘솔 스니펫, 버리는 세션 정리 |
| `ARCHITECTURE.md` | 데이터 경로·명령 흐름·신원과 권한·추종자·상수·파일 지도·관리자 vs 임원 표 |
| `PITFALLS.md` | 실측으로 확인된 결함 계열과 막는 검사 |
| `DECISIONS.md` | 운영자 결정 기록(날짜순) |
| `BACKLOG.md` | 남은 일, 운영자 확인이 필요한 것 |
| `WORKLOG.md` | 작업 기록(새 작업은 맨 위) |
| `AUDIT-LOG.md` | 감리 요청과 결과 |
