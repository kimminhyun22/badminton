# 콕매치 안정 버전 보관 기록

이 문서는 실전에서 검증한 안정 버전을 잃어버리지 않기 위한 보관 기록입니다.

## 현재 안정화 버전

- 이름: 콕매치 민턴LIVE / 팀전LIVE 통합 안정화 버전
- 앱 버전: `v1.10.361`
- 기준 커밋: `v1.10.361-stable` 태그와 `stable/kokmatch-v1.10.361` 브랜치가 가리키는 커밋
- 커밋 메시지: `Prepare v1.10.361 stable recovery point`
- 보관 태그: `v1.10.361-stable`
- 보관 브랜치: `stable/kokmatch-v1.10.361`
- 상태: 실전 테스트 직전 안정화 버전
- 주요 파일: `index.html`, `team.html`, `checkin.html`, `rsvp.html`, `view.html`, `js/daily.js`, `js/team.js`, `js/live-view.js`, `sw.js`

### 검증 포인트

- 민턴LIVE: 명부 불러오기, 링크 공유, 진행 중 코트 등록, 다음 대진 입장, 이번만 뒤로, 마무리 후 자율게임 전환
- 팀전LIVE: 명부 불러오기, 링크 공유, 게스트 추가, 참가자 불러오기, 청/홍 배정, 대진 생성, 승패 입력, 전체 초기화

### 복구 방법

```bash
git checkout stable/kokmatch-v1.10.361
```

또는 태그 기준으로 확인:

```bash
git checkout v1.10.361-stable
```

## 팀전 안정 버전

- 이름: 콕매치 팀전 안정 버전
- 앱 버전: `v1.10.93`
- 기준 커밋: `c30f237c6577ba7710a9da3a5a299ab23652c013`
- 커밋 메시지: `Move live ops summary above bracket`
- 보관 태그: `v1.10.93-team-stable`
- 보관 브랜치: `stable/team-v1.10.93`
- 주요 파일: `index.html`, `team.html`, `view.html`, `sw.js`

### 보관 이유

- 팀전 실전 운영에 필요한 대진 생성, 품질 점검, 승패 집계, 실시간 현황, 출석 확인 UX가 안정화된 지점입니다.
- 민턴LIVE 전환 작업 중 팀전 안정본을 잃지 않기 위해 태그와 브랜치로 고정했습니다.

### 나중에 확인하는 방법

```bash
git checkout stable/team-v1.10.93
```

또는 태그 기준으로 확인:

```bash
git checkout v1.10.93-team-stable
```

### 다시 현재 개발 버전으로 돌아오기

```bash
git checkout main
```

## 현재 개발 방향

- 현재 `main`은 민턴LIVE와 팀전LIVE를 별도 진입점으로 함께 유지합니다.
- 민턴LIVE는 평소 클럽 운동 자동 운영에 집중합니다.
- 팀전LIVE는 월례 청/홍 팀전의 출석, 게스트, 팀배정, 대진표, 승패 입력에 집중합니다.
- 새 기능은 실전 테스트 이후 꼭 필요한 것만 작게 추가하는 방향을 권장합니다.

## 민턴LIVE 안정 버전

- 이름: 민턴LIVE 완전자동화 안정 버전
- 앱 버전: `v1.10.169`
- 기준 커밋: `3a26671`
- 커밋 메시지: `Auto cancel member reservations on status changes`
- 보관 태그: `v1.10.169-minton-live-stable`
- 보관 브랜치: `stable/minton-live-v1.10.169`
- 주요 파일: `index.html`, `checkin.html`, `view.html`, `sw.js`

### 보관 이유

- 회원이 직접 참석, 시작, 휴식, 종료, 파트너/게임 신청을 입력하고 관리자는 최소 개입하는 완전자동화 흐름이 안정화된 지점입니다.
- 게임신청은 관리자 승인 없이 자동 접수되며, 휴식/종료 등으로 신청이 깨질 때 회원에게 자동 취소 사유가 표시됩니다.
- 팀전 안정본과 통합하기 전 민턴LIVE만 단독으로 되돌릴 수 있는 기준점입니다.

### 나중에 확인하는 방법

```bash
git checkout stable/minton-live-v1.10.169
```

또는 태그 기준으로 확인:

```bash
git checkout v1.10.169-minton-live-stable
```

### 통합 전 원칙

- 민턴LIVE 안정본과 팀전 안정본을 직접 섞지 않습니다.
- 팀전은 `team.html` 같은 별도 진입점으로 먼저 복구하고, 민턴LIVE는 `index.html` 중심으로 유지합니다.
- 공통으로 써야 하는 기능은 충분히 검증한 뒤 작은 단위로만 공유합니다.
