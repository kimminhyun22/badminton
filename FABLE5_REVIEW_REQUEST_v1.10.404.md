# 콕매치 Fable 5 교차 검증 요청서

## 검증 목적

콕매치가 단순히 기능이 많은 앱이 아니라, 현장에서 운영자와 회원이 앱을 의식하지 않고 자연스럽게 운동에 몰입할 수 있는 시스템인지 검증해 주세요.

가장 중요한 기준은 다음입니다.

> 가장 좋은 시스템은 사용자가 불편을 느끼지 못하고, 흐름이 너무 자연스러워서 오로지 즐겁게 운동에 몰두하다가 끝나는 시스템입니다.

## 프로젝트 정보

- 프로젝트: 콕매치 badminton
- 경로: `/Users/gimminhyeon/Documents/Codex/2026-06-09/new-chat-2/badminton`
- GitHub: `kimminhyun22/badminton`
- 기준 버전: `v1.10.404`
- 현재 상태: `v1.10.404` 안정화 변경은 로컬 working tree에 반영되어 있으며, 아직 푸시 전일 수 있습니다.
- 최근 핵심 변경:
  - 팀전LIVE 앱 재실행 후 이어가기 CTA 단순화
  - 저장 LIVE ID와 현재 대진의 로컬 정합성 필터 추가
  - 복구 화면을 큰 빨간 CTA 중심으로 강조
  - LIVE/대진/명단 섞임 방지 회귀 테스트 보강

## 콕매치의 핵심 목표

운영자는 앱을 신경 쓰지 않고, 회원은 설명을 듣지 않아도 되고, 모두가 자연스럽게 운동에 몰입한 채 모임이 끝나는 시스템.

즉 콕매치는 대진표 생성기가 아니라, 운동 흐름을 방해하지 않는 무대 뒤 운영 시스템이어야 합니다.

## 핵심 원칙 3가지

1. 흐름의 자연스러움
   - 현재 상태에서 다음 행동이 하나로 명확해야 합니다.
   - 앱이 꺼졌다 켜져도 운영자가 기억하거나 추리하지 않아야 합니다.
   - 초보 운영자도 첫 화면만 보고 다음 버튼을 누를 수 있어야 합니다.

2. 상태의 절대 정합성
   - 명부, 참가자, 청/홍팀, 대진표, LIVE 링크, 승패 결과가 항상 같은 경기 하나를 가리켜야 합니다.
   - 서로 다른 경기 정보가 섞일 가능성이 있으면 진행을 막아야 합니다.
   - 기존 회원 링크에 다른 대진이 송출되는 상황은 치명적 오류로 봐야 합니다.

3. 공정성의 자동 신뢰
   - 팀 밸런스, 경기 실력차, 출전 횟수, 파트너 반복, 연속 출전, 성비 보정을 시스템이 먼저 커버해야 합니다.
   - 사용자가 점수표를 해석해서 납득하는 수준이 아니라, 처음부터 이의가 적은 대진이 나와야 합니다.
   - 품질 점수는 설명 도구이고, 핵심은 자동 배정 결과의 실제 납득성입니다.

## 검증해야 할 핵심 시나리오

1. 팀전LIVE 진행 중 앱이 꺼진 뒤 다시 켰을 때
   - 첫 화면에서 바로 이어갈 수 있는가?
   - 저장 대진표 불러오기와 LIVE 이어가기가 헷갈리지 않는가?
   - 버튼 색상, 문구, 위치가 긴급 복구 행동으로 충분히 눈에 띄는가?

2. LIVE 링크와 대진표 정합성
   - 기존 LIVE ID가 현재 대진과 다를 때 잘 막는가?
   - 저장본, 현재 화면, Firebase LIVE 데이터가 서로 다른 경기를 가리킬 가능성이 남아 있는가?
   - `restoreLive`, `restoreBracket`, `resume`, `live` 단계 전환이 논리적으로 안전한가?

3. 명부/급수 수정 후 흐름
   - 대진 생성 후 명부에서 급수를 수정했을 때 팀 목록, 대진표, 품질 점수 반영이 사용자가 오해하지 않게 처리되는가?
   - 팀 밸런스를 다시 맞추려면 어떤 행동이 필요한지 자연스럽게 안내되는가?

4. 대진 공정성
   - 실력 균형, 출전 횟수, 파트너 반복, 같은 4명 반복, 연속 출전이 실제 운영자 기준에서 납득 가능한가?
   - 품질 점수 항목과 감점 기준이 실제 체감 공정성과 어긋나는 지점은 없는가?
   - 재배정 버튼을 누를 필요가 과도하게 자주 생기지 않는가?

5. 초보 운영자 UX
   - 설명 없이 `team.html` 첫 화면만 보고 운영을 시작할 수 있는가?
   - 화면에 운영 개념이 너무 많이 노출되어 있지는 않은가?
   - “다음 할 일”이 정말 하나로 보이는가?

## 우선 검토 파일

- `README.md`
- `team.html`
- `js/team.js`
- `css/team.css`
- `tests/simulation-smoke.js`
- `tests/team-isolation-regression.js`
- `tests/team-balance-priority-regression.js`
- `tests/team-balance-restore-regression.js`

## 특히 봐야 할 코드 위치

- `js/team.js`
  - `_teamStoredLiveMatchesCurrentBracket`
  - `_teamHasResumeLiveHint`
  - `_tryResumeLive`
  - `restoreTeamLiveAndResume`
  - `restoreState`
  - `_teamSavedBracketRestoreInfo`
  - `_teamValidateLiveDataForCurrent`
  - `renderAutoFlowDashboard`
  - `_qualityAssessment`

- `css/team.css`
  - `.auto-flow-btn.live-start`
  - `.auto-flow-card.live-resume-ready`
  - `.auto-flow-resume-note`
  - `.live-btn.resume`

## 실행해 볼 테스트

```bash
node --check js/team.js
git diff --check
node tests/simulation-smoke.js
node tests/team-isolation-regression.js
node tests/team-balance-priority-regression.js
node tests/team-balance-restore-regression.js
```

## 요청하는 출력 형식

1. 전체 평가
   - 잘 설계됨 / 부분 개선 필요 / 구조 재검토 필요 중 하나로 판단

2. 점수
   - “운동에 몰입하고 앱은 사라지는 시스템” 기준 10점 만점
   - 점수 이유를 간결하게 설명

3. 가장 큰 강점 3개

4. 가장 위험한 설계 리스크 5개
   - 실제 현장에서 문제가 될 가능성이 큰 순서로 정렬

5. 반드시 추가해야 할 회귀 테스트
   - 테스트 이름 또는 시나리오 단위로 제안

6. UX 문구/버튼 배치에서 헷갈릴 수 있는 지점

7. 코드 정합성 관점에서 위험한 지점
   - LIVE ID, 저장본, 대진 signature, RSVP session, Firebase 데이터 흐름 중심

8. 새 기능 추가 없이 완성도를 높이는 개선안
   - 큰 리팩토링보다 현장 안정성과 자연스러움을 높이는 작은 개선 위주

## 리뷰 기준

칭찬보다 리스크를 우선해 주세요.  
다만 단순 취향이나 과한 리팩토링 제안보다, 실제 운동 현장에서 운영자가 멈칫하거나 회원 링크가 꼬일 가능성을 중심으로 판단해 주세요.

최종적으로 이 프로그램이 “운영자는 앱을 잊고, 회원은 운동에 집중하고, 모임은 자연스럽게 끝나는 시스템”에 얼마나 가까운지 냉정하게 평가해 주세요.
