# 민턴LIVE 운영 절차

리포 `~/Documents/Codex/2026-06-09/new-chat-2/badminton` · 배포 https://kimminhyun22.github.io/badminton/ · Firebase `kokmatch-23b31`

## 1. 시작 전
```bash
git status --short                 # 비어 있어야 한다. 모르는 변경이 있으면 멈추고 보고
git pull --rebase origin main
grep -m1 '현재 버전' README.md
```

## 2. 검사
```bash
node scripts/test-all.js                    # 전체: tests/*.js + functions 문법 (약 25초)
node scripts/test-all.js daily- checkin-    # 파일 이름으로 골라서
```
- 기준은 전부 통과. 실패를 「오탐」이라 넘기기 전에 테스트 기준이 낡았는지 본다.
- 판정은 **종료 코드**로 한다. `node scripts/test-all.js | tail -3 && git commit …` 은 실패해도 커밋·푸시까지 간다 — 2026-09-14 실제로 94/95 상태를 푸시했다. `node scripts/test-all.js && git commit …` 처럼 실행기 자체의 종료 코드에 잇는다.
- README·안내 문구를 고쳐도 테스트가 깨질 수 있다. 몇몇 테스트가 운영 원칙 문장을 고정해 둔다(`grep -l README tests/*.js`).
- 새 동작에는 테스트를 붙인다. 문자열 핀만으로 끝내지 말고, 가능하면 엔진·함수를 실제로 돌리는 케이스를 둔다(예: `tests/daily-official-delegation-regression.js`).
- **훼손 시험**: 고친 줄을 잠시 되돌려 새 테스트가 깨지는지 보고 원복한다. 사본으로 하려면 루트를 바꿀 수 있게 만든다(예: `PARITY_ROOT=<사본> node tests/daily-command-lists-parity-regression.js`).
- 대진 로직을 바꿨으면 시뮬도 본다: `tests/sim-live.js` · `tests/daily-36p-150m-regression.js` · `tests/kokmatch-type-diagnosis.js`.

## 3. 버전
```bash
node scripts/bump-version.js 1.10.663
```
HTML 5개·manifest·js 3개·sw.js·README, 모두 11개 파일을 바꾼다. 배포되는 변경마다 하나씩 올린다. 문서·테스트만 바꿨으면 올리지 않는다.

## 4. 정적 배포 (html·js·css)
```bash
git add -A
git commit -m "Say what changed and why in one line"
git push origin main
curl -s https://kimminhyun22.github.io/badminton/index.html | grep -o 'app-version" content="[^"]*'
```
1~3분 뒤 버전이 바뀌면 반영된 것이다. 폰은 서비스워커 때문에 새로고침·재실행 뒤 바뀐다.

## 5. 서버 배포 (functions/)
```bash
firebase deploy --only functions --project kokmatch-23b31
```
- `--only functions` 를 절대 빼지 않는다. 빼면 DB 규칙까지 배포된다(운영자 보류 중).
- 정적과 서버가 같이 바뀌면 **서버 먼저**. 새 화면이 옛 서버에 새 명령을 보내면 거절된다.
- 호환성: 서버는 옛 화면과 새 화면을 모두 받게 **추가만** 한다. 명령·필드를 없애는 변경은 화면을 먼저 내리고 다음 배포에서 서버를 정리한다.
- 새 능력 표시는 기본적으로 관리자 게시로 실린다. `officialRosterSetupV1`처럼 클레임 때 서버가 옛 세션에 보강하는 경로가 있으면 관리자 재게시가 필요 없다. 보강 경로가 없는 새 표시라면 상시 세션에서 버튼이 안 뜰 수 있으므로 배포 보고에 적는다.
- 팀전 콜러블도 함께 올라간다. 팀전 테스트까지 통과한 상태에서만 배포한다.

## 6. 되돌리기
```bash
git revert <커밋>
git push origin main
firebase deploy --only functions --project kokmatch-23b31    # 서버를 바꾼 커밋이었다면
```
되돌리기는 배포의 **역순**이다: 정적을 먼저 되돌려 새 화면이 새 명령을 그만 보내게 한 뒤 서버를 되돌린다. 히스토리를 고치지 않는다(force push 금지). `STABLE_VERSIONS.md` 의 안정 태그는 지금 코드와 거리가 멀어 비상용이다.

## 7. 실배포 E2E
서버 명령·관리자 추종·게시 경로를 건드렸으면 필수. 절차와 스니펫은 `E2E.md`.

## 8. 실전 사후 감사
```bash
firebase database:get /live/checkin_<ID> --project kokmatch-23b31 > ../_handoff/live-<ID>.json
node tools/audit-live-session.js ../_handoff/live-<ID>.json
```
- 인당 게임 분포·공정성 잔차·게임 소요·팀 밸런스·반복·대기를 본다.
- 롤오버로 접힌 지난 운동은 세션에 없다. `firebase database:get /liveArchive/checkin_<ID> --project kokmatch-23b31` 로 받는다. 보관은 최근 80경기까지의 기록과 선수 id·이름·경기 수뿐이라(급수 없음) 감사 도구로는 게임 수·소요시간 같은 일부 항목만 나온다.
- **세션 JSON에는 실명이 있다. 리포 안에 저장·커밋하지 않는다.** 리포 밖 `../_handoff/` 에 둔다.

## 9. 현장 피드백 처리
1. 운영자의 말(원문)과 상황을 적는다: 세션 ID, 시각, 누가 무엇을 눌렀나.
2. 가능하면 서버 세션을 받아 사실부터 확인한다(8번). 추측으로 고치지 않는다.
3. 재현 → 원인 → 수정 → 테스트(+훼손 시험) → 배포 → 실배포 확인.
4. 「○○가 무슨 말이야?」처럼 이름을 묻는 피드백은 그 자체가 답이다. 문구를 늘리지 말고 누르는 곳과 고치는 곳을 붙인다.
5. 결과는 `WORKLOG.md`, 운영자 결정이면 `DECISIONS.md`.

## 10. 기록
- `WORKLOG.md` 맨 위: 날짜·버전 / 요청(원문 요지) / 무엇을 왜 / 검증(검사 결과 줄·배포 버전·E2E) / 남은 것.
- 감리가 필요한 변경이면 `AUDIT-LOG.md` 에 「감리 요청」 줄.
- 배포 뒤 WORKLOG·AUDIT-LOG 갱신도 커밋·푸시한다(문서만 바뀐 커밋은 버전을 올리지 않는다).
