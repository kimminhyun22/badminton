# +5 점수 단위 감사 · 2026-10-09

범위: 공개v781 c0113fa, 로컬시험65명/656답안, 2026-10-08 21:11:30 KST 보관 경기35명 게시본. 최신 운영 서버·사용자 브라우저 localStorage는 직접 조회/변경하지 않음.

확인: core base/raw skillRating에+5없음. club-skill-review 기본·결과표 기본표시는 base+5, 결과표시는 rating+5. 로컬 설명에 ‘기본 표시(+5)’와 음수 방지 목적 명시.
시험 p46: raw기본2.8 / 기본표시7.8 / 보정+.523 / raw결과3.323 / 표시8.323. 보관 경기의 같은 참가자는 l=2.8(연령 전, 수동-.2 포함), age30-.2→raw2.6→표시7.6. 원본 출발점·수동보정·시점이 다름; 동일2.8을 같은 필드로 읽으면 혼동.
실제65명 복사본에 B.prepare 적용→JSON재로드→cloud.cleanClub→roster bridge→team slim→live-view→browser/server effectiveLevel 확인:65명 raw rating 보존. 최초 anchors 재계산 및 공개781코어와65명 결과동일. 외부 쓰기0.
시험 raw기본[-.7,4.8], raw결과[-1.095,5.602], 표시[3.905,10.602]. 음수raw 유지;0/10클램프 없음. level 역변환범위[.399,6.802], 현행cloud level[0,10] 입력검사65명 통과. 이 level 범위검사는 skillRating 클램프가 아님.
과거35명 모두 학습skillRating 없음. raw[-.7,4.8], 표시[4.3,9.8].36경기 동일인원 양팀 차이 확인; 대진 함수는raw차로 동작하고 표시값 미입력.18/17 전체팀 표시합140/130.6은 인원별+5 영향이 있으므로 비교는1인평균 차.09542484 사용. sum은 설명용이고 대진에 전달되지 않음을 호출부 확인.
API/저장: skill-calibration 결과raw, apply패킷raw, batch/roster-cloud clean raw보존, learnedrating이 있으면 대진에서 성별·연령재감점 없음. 실제Firebase 저장·재로그인·현재기기원본 값은 미확인; JSON/API정제/브리지 사본검증과 구분.
별도 주의: CSV명부 export는 학습skillRating과 연령을 쓰지 않아 재수입하면 학습점수 보존 안 됨(코드정적확인, 실제작업 미실행). +5중복원인은 아니며 학습점수 왕복보존 기능 별도개선 대상. JSON packet은학습값보존.
확인범위 내+5중복/누락/대진유입 없음. 숫자산식수정근거 없음. 내부base/명부level/기본표시의 단위·시점 차이가 핵심 설명 문제. 운영점수/산식미수정.
증거: /tmp/minton-unit-audit.cjs, /tmp/minton-unit-audit-private.json. 원본지문 보존. 개인정보 포함 private자료 커밋제외.
