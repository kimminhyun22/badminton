# 실배포 E2E

관리자 추종 결함(PITFALLS 1·2·4)은 단위 테스트가 못 잡고 이 시험에서만 잡혔다. 서버 명령·관리자 추종·게시 경로를 바꿨으면 배포 뒤 반드시 돌린다.

## 원칙
- **실제 배포 주소**(https://kimminhyun22.github.io/badminton/)에서 브라우저 도구로 한다.
- **운영자의 실제 관리자 브라우저에서 돌리지 않는다.** 아래 정리 스니펫은 링크를 종료하고 로컬을 초기화한다. 시작 가드가 진행 중 세션이나 실제 명부를 감지하면 멈춘다. 같은 브라우저의 탭은 저장소를 공유하므로 명부가 비어 있는 **새 프로필**(또는 시크릿 창)에서 한다 — 불러오기는 세션 클럽 → 회원 있는 첫 클럽 순으로 고르므로, 다른 명부가 있으면 엉뚱한 클럽을 불러온다.
- 관리자 탭은 **처음부터 끝까지 열어 둔다** — 추종자는 열려 있을 때만 돈다.
- 임원 동작은 **임원 화면의 실제 전송기**(`sendOfficial*` 또는 화면 버튼)로 한다. 페이로드를 손으로 만들지 않는다(PITFALLS 4).
- 사람은 가명만(E2E임원, E2E가…). 끝나면 반드시 정리한다.
- 스니펫은 페이지 콘솔(브라우저 도구의 JS 실행)에서 돈다. 페이지가 로드 직후 한 번 스스로 새로고침할 수 있으니 열고 3초쯤 기다린 뒤 실행한다.

## 1. 관리자 탭 — 최초 상시 링크 기반
`https://kimminhyun22.github.io/badminton/index.html`

```js
// 가드: 진행 중 세션이나 참가자가 있으면 멈춘다
if(_dailyCheckinId || _dailyPlayers.length) throw new Error('이 브라우저에 진행 중 세션/참가자가 있습니다 — E2E 중단');
if(rosters.clubs.some(c=>c.name!=='E2E테스트' && (c.members||[]).length)) throw new Error('실제 명부가 있는 브라우저입니다 — 새 프로필에서 하세요');
JSON.stringify({버전:document.querySelector('meta[name=app-version]')?.content, 명부클럽:rosters.clubs.map(c=>c.name)})
```

```js
// 가명 클럽 → 정식 임원 한 명만 도착 전으로 등록 → 상시 링크 기반 생성
window.confirm=()=>true; window.alert=()=>{};
const mk=(name,grade,official)=>({name,grade,gender:'남',level:gradeToLevel(grade,'남'),ageGroup:'40대',isClubOfficial:!!official});
rosters.clubs=rosters.clubs.filter(c=>c.name!=='E2E테스트');
rosters.clubs.push({name:'E2E테스트',members:[mk('E2E임원','C',true),mk('E2E가','C'),mk('E2E나','C'),mk('E2E다','D'),mk('E2E라','D'),mk('E2E마','C')]});
saveRosters(); try{renderClubList();}catch(e){}
dailyImportRoster(); await new Promise(r=>setTimeout(r,500));
const list=document.getElementById('dailyImportMemberList');
[...list.querySelectorAll('label.import-member-row')].find(row=>row.textContent.includes('E2E임원'))?.querySelector('input')?.click();
await importDailySelected('wait'); await new Promise(r=>setTimeout(r,800));
if(_dailyPlayers.some(p=>!String(p.name).startsWith('E2E'))){ dailyReset(); throw new Error('가명 외 선수가 섞였습니다 — 초기화하고 중단'); }
const official=_dailyPlayers.find(p=>p.name==='E2E임원');
_dailyApplyPlayerStatus(official,'planned'); _dailySessionClubName='E2E테스트'; dailySave(); dailyRender();
const id=await dailyPublishCheckinSession(true); await new Promise(r=>setTimeout(r,1500));
const payload=_dailyCheckinPayload();
JSON.stringify({세션ID:_dailyCheckinId, 임원ID:_dailyPlayers.find(p=>p.name==='E2E임원')?.id, 게시전:payload.event?.operationStarted, 능력:payload.capabilities})
```
세션 ID와 임원 ID를 적어 둔다. 이 관리 작업은 실제 운영에서는 최초 상시 링크를 만들 때 한 번만 필요하다.

## 2. 임원 탭 — 본인 확인
`https://kimminhyun22.github.io/badminton/checkin.html?id=<세션ID>`

```js
window.__msgs=[]; window.confirm=()=>true; window.alert=m=>window.__msgs.push(String(m));
selectPlayerIdentity('<임원ID>'); await new Promise(r=>setTimeout(r,3500));
JSON.stringify({본인:getLastSent()?.playerName, 준비패널:!!document.querySelector('.official-prep'), 알림:window.__msgs})
```
클럽 임원은 명부 신원으로 자동 연결된다(`claimOfficialInvite`). 운영 시작 전이면 도착 전 상태여도 준비 패널과 `명부 불러오기`가 보여야 한다.

## 3. 시나리오 실행 (예시)
```js
// 임원 탭: 명부 전원 현장 등록 — 실제 시트·전송기
openOfficialRosterPick('<임원ID>');
toggleOfficialRosterSetupAll();
await sendOfficialRosterSetup('<임원ID>','wait'); await new Promise(r=>setTimeout(r,5000));
JSON.stringify({선수:(session?.players||[]).map(p=>p.name+':'+p.status), 서버리비전:session?.serverRevision,
  내요청:(officialRequests||[]).slice(-2).map(r=>r.type+':'+(r.serverAppliedAt?'적용':r.serverRejectedAt?'거절':'대기')), 알림:window.__msgs})
```
전원 이름이 `E2E`로 시작하고 `wait`, 요청이 `official-roster-setup:적용`이어야 한다. 이어서 화면에서 코트 수를 바꾸고, 이미 뛰는 경기가 있으면 코트별 4명을 등록한다.

```js
// 임원 탭: 대진 게시
const startBtn=document.querySelector('.official-prep-start');
if(!startBtn||startBtn.disabled) throw new Error('게시 버튼이 없거나 비활성');
startBtn.click(); await new Promise(r=>setTimeout(r,5000));
JSON.stringify({게시됨:session?.event?.operationStarted, 진행중:(session?.event?.active||[]).length, 대기표:(session?.event?.next||[]).length,
  내요청:(officialRequests||[]).slice(-3).map(r=>r.type+':'+(r.serverAppliedAt?'적용':r.serverRejectedAt?'거절('+(r.serverReason||'')+')':'대기')), 알림:window.__msgs})
```

## 4. 관리자 탭 — 따라왔는지
```js
// 리비전이 따라올 때까지 최대 20초 기다린 뒤 선수별로 대조한다
const read=async()=>(await _fbDb.ref(_dailyCheckinPath()+'/session').once('value')).val()||{};
let s=await read();
for(let i=0;i<20&&_dailyServerRevision!==s.serverRevision;i++){ await new Promise(r=>setTimeout(r,1000)); s=await read(); }
const byId=ps=>Object.fromEntries((ps||[]).map(p=>[p.id,p.status]));
const a=byId(_dailyPlayers), b=byId(s.players);
const 상태차이=Object.keys({...a,...b}).filter(id=>a[id]!==b[id]).map(id=>`${id}:${a[id]}≠${b[id]}`);
JSON.stringify({관리자리비전:_dailyServerRevision, 서버리비전:s.serverRevision, 동기화오류:_dailyServerReconcileError||'',
  게시:[_dailyOperationStarted, s.event?.operationStarted], 상태차이,
  만료일후:Math.round((Number(s.expiresAt||0)-Date.now())/864e5)})
```
합격 기준:
- 두 리비전이 같고, 동기화 오류가 비어 있고, `상태차이` 가 빈 배열이다.
- 바꾼 사실(게시 표시·코트)이 관리자와 서버에서 같다.
- 관리자가 한 번 더 게시해도(`await dailyPushCheckinSession()`) 서버 값이 되돌아가지 않는다(추종자 패턴 2~4).

## 5. 시간이 필요한 시험 (버리는 세션에서만)
롤오버는 게시 뒤 4시간이 지나야 한다. 게시 시각을 되돌린다 — 관리자 로컬도 같이 맞춰야 다음 게시가 되돌리지 않는다.
```js
// 관리자 탭
const t=Date.now()-5*3600e3;
await _fbDb.ref(_dailyCheckinPath()+'/session/event/operationStartedAt').set(t);
_dailyOperationStartedAt=t; dailySave();
```
그다음 임원 탭에서 마무리 → 코트 종료로 진행 코트·대기표를 비우고 「새 운동일 시작」을 누른다(`sendOfficialSessionRollover`). 관리자 탭에서 `_dailyRolloverAt` 이 서버 `rolloverAt` 과 같아지는지 본다. 보관 기록도 따로 확인한다 — 콜러블이 저장 성공을 기다리지 않는다:
```bash
firebase database:get /liveArchive/checkin_<세션ID> --project kokmatch-23b31 --shallow
```
지금은 임원 화면이 진행 코트가 하나라도 있으면 롤오버 버튼을 막으므로, 4시간 넘은 미종료 코트를 접는 서버 경로는 화면에서 닿지 않는다(BACKLOG 결함 2).

## 6. 정리 (반드시)
```js
// 관리자 탭
window.confirm=()=>true; window.alert=()=>{};
const sid=_dailyCheckinId;
try{ await dailyStopCheckinLink(); }catch(e){}
await new Promise(r=>setTimeout(r,1200));
try{ dailyReset(); }catch(e){}
rosters.clubs=rosters.clubs.filter(c=>c.name!=='E2E테스트'); saveRosters(); try{renderClubList();}catch(e){}
try{ localStorage.removeItem('daily_day_archive_v1'); }catch(e){}
JSON.stringify({정리한세션:sid, 이후세션:_dailyCheckinId||'', 이후선수:_dailyPlayers.length, 남은클럽:rosters.clubs.map(c=>c.name)})
```
```bash
# 롤오버를 시험했으면 세션 밖 보관 전문도 지운다
firebase database:remove /liveArchive/checkin_<세션ID> --project kokmatch-23b31 --force
```
정리 스니펫은 예외를 삼키므로 로컬 출력만으로 원격 삭제를 확정할 수 없다. 두 경로가 `null` 인지 확인한다:
```bash
firebase database:get /live/checkin_<세션ID> --project kokmatch-23b31
firebase database:get /liveArchive/checkin_<세션ID> --project kokmatch-23b31
```
그다음 임원 탭을 닫고, `WORKLOG.md` 에 세션 ID·결과·정리 완료를 적는다.

## 지금까지 돌린 시나리오
| 날짜 | 시나리오 | 결과 |
|---|---|---|
| 2026-09-13 | 임원 운영 준비 → 코트 등록 → 대진 게시 → 선수 추가 → 서버 자동 투입, 관리자 추종 | 관리자 재생의 운영 시작 추론(659)·라우팅 배열 누락(660)을 잡았다 |
| 2026-09-14 | 어제 게시 → 오늘 관리자 재로드 → 임원 대진 게시 → 게시 시각 되돌림 → 마무리·종료로 임원 done → 롤오버 → 관리자 채택 → 재게시 | 추종자 패턴 1~5 수정 확인 |
| 2026-09-14 | 롤오버 뒤 실제 전송기로 도착 3건 → 관리자 리비전 추종 → 재게시 | 통과. 손으로 만든 페이로드의 가짜 결함을 가려냈다 |
| 2026-09-14 | 도착 전 정식 임원 연결 → 명부 6명 일괄 현장 등록 → 코트 3→1 → 대진 게시 → 자동 투입 → 관리자 추종 | 통과. 세션 `DL3TR7JY`, 서버 revision 3, 진행 1·대기 0, 관리자 현장 6명 일치. `/live`·`liveArchive` 정리 뒤 모두 `null` 확인 |
