# 로컬 추가 평가 접속 복구 · 2026-10-09

이전 도구 실행에 묶인 서버가 종료되어65300포트 리스너가 없고 HTTP000이었다. 파일은 존재했고620응답/65명/296질문 및 sandbox 지문은 동일했다.

macOS launchd의 별도 작업 `gui/501/local.minton.personal-review-20261009`로 복구했다. 문서 폴더에서 시작한 별도 프로세스는 파일 읽기에서 대기하며 node 문서 접근 창이 표시되어, 권한을 확대하지 않고 동일 자료를 전용 Library/Application Support 폴더에 복사해 실행했다. 기존 문서 사본은 변경 없이 보존했다.

- 실제 URL: http://127.0.0.1:65300/preview. 맥북127.0.0.1에만 바인딩, 원격/폰 공개 없음.
- 실제 사용자 기존 Chrome 창에서 주소 리다이렉트/페이지 제목/첫 화면의 미르클럽 개인 평가 및 경계 선수 목록 렌더를 확인했다. OS 브라우저 화면 캡처는 비공개 파일로 보관했다. 내부 HTTP200만으로 성공을 판정하지 않았다.
- Chrome Apple Events JavaScript 실행은 비활성화 상태이며 활성화하지 않았다. 별도 스크린샷/기존 창 읽기로 확인했다.
- 현재 저장 경로: `/Users/gimminhyeon/Library/Application Support/MintonLocalReview/minton-personal-20261009/sandbox-assessment.json`. 내보내기 파일도 같은 폴더에 저장된다. 이전 Documents 경로는 보존본이다. localhost포트와로컬키는 같아 기존 브라우저 임시 답안 경로를 유지한다.
- 실행은 도구/대화 수명과 분리되어 현재 로그인 세션 동안 유지된다. 로그아웃/재부팅 뒤 자동 시작 등록은 하지 않았다. 같은 폴더의 `start-review.command`를 열면 기존 서버 확인 후 재시작/브라우저 열기를 수행한다. 다른 포트 사용 프로세스는 종료하지 않는다.
- 원본620 및 기존 사본의 before/after SHA256: `4306df5f1dbe640a999407efd28199463e4afe50c2d88195a254fbec20e1e893`. 신규평가 제출0,운영DB쓰기0,배포0,권한설정확대0. 다른 앱/서버 종료0.

복구 증거: `/tmp/minton-local-recovery-result.json`, `/tmp/minton-recovery-browser-window-private.png`.
