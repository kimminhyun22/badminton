/* ═══ APP VERSION ═══ */
/* 코드 수정 시 이 값을 올리세요 (예: 1.0.1 → 1.1.0).
   푸터 버전 표시가 자동 갱신되고, 본문이 바뀌어 iOS PWA 캐시도 갱신됩니다. */
const APP_VERSION = '1.10.439';
const DAILY_EXPECTED_DETAIL = '예상 · 바뀔 수 있어요';

/* ═══ GLOBALS ═══ */
const LV_LABEL={7:'S',6:'S',5:'A',4:'B',3:'C',2:'D',1:'E',0:'E'};
const MATCH_QUALITY=(typeof globalThis!=='undefined'&&globalThis.KokMatchQuality)||null;
// 실효 레벨: 같은 급수라도 여성은 남성보다 0.5 낮게 평가 (남녀 실력차 1.5 반영)
// 예: C급 남(4) vs C급 여(3) → 실효 4 vs 2.5 → 격차 1.5
function effLevel(p){
  if(MATCH_QUALITY)return MATCH_QUALITY.effectiveLevel(p);
  const isF = p.gender==='F' || p.gender==='여';
  const _AGE_BONUS={'20대':0,'30대':-0.2,'40대':-0.5,'50대':-1.2,'60대+':-2.0};
  const ageMod = _AGE_BONUS[p.ageGroup] || 0;
  return Math.round((p.level - (isF ? 0.5 : 0) + ageMod) * 10) / 10;
}
let _currentRound=1;
let _partnerGapThreshold=2; // 파트너 최소 간격 (generateMatches에서 자동 설정)
/* 경기 점수제 & 점수제별 경기당 예상 시간(분, 코트전환·휴식 포함) */
let _pointSystem=25;
const _POINT_MINUTES={25:15, 21:12, 15:9};
function setPointSystem(pt){
  _pointSystem=pt;
  document.querySelectorAll('.pseg-btn').forEach(b=>b.classList.toggle('active', +b.dataset.pt===pt));
  // 이미 대진표가 있으면 예상 시간만 즉시 갱신
  if(currentMatches.length) renderResults(currentMatches,currentParticipants,currentSettings);
}
let _skipNewFirstRound=true; // 신규선수 1라운드 제외 여부 (라운드 직접선택 시 false)
let teamAssignment=null;
let currentMatches=[];
let currentParticipants=[];
let currentSettings={};
let _operationPreset='daily';
const OPERATION_PRESETS={
  monthlyTeam:{
    label:'민턴LIVE',
    hint:'민턴LIVE 중심 운영입니다. 클럽 명부와 상태 변경을 기준으로 대기표를 자동 보충합니다.'
  },
  monthlyPersonal:{
    label:'민턴LIVE',
    hint:'개인전 운영은 민턴LIVE 흐름에서 처리합니다. 클럽 명부와 상태 변경을 중심으로 대기표를 보충하세요.'
  },
  daily:{
    label:'민턴LIVE',
    hint:'민턴LIVE 모드입니다. 클럽 임원이 현장 참가자를 등록하고 대진을 게시한 뒤 휴식 상태를 반영해 운영합니다.'
  }
};
function setOperationPreset(mode,hintOverride){
  mode='daily';
  _operationPreset=mode;
  if(document.body&&document.body.classList){
    document.body.classList.remove('monthly-team-mode');
  }
  document.querySelectorAll('[data-operation-option]').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.operationOption===mode);
  });
  const summary=document.getElementById('operationModeSummary');
  if(summary)summary.textContent='현재: '+OPERATION_PRESETS[mode].label;
  const hint=document.getElementById('operationModeHint');
  if(hint)hint.textContent=hintOverride||OPERATION_PRESETS[mode].hint;
  const playersTitle=document.getElementById('playersCardTitle');
  if(playersTitle)playersTitle.textContent='📋 참가자 입력';
  const settingsTitle=document.getElementById('settingsCardTitle');
  if(settingsTitle)settingsTitle.textContent='⚙️ 대진 설정';
  syncMonthlyTeamFolds();
}
function syncMonthlyTeamFolds(){
  const rsvp=document.getElementById('sec-rsvp');
  if(rsvp&&rsvp.tagName==='DETAILS'){
    rsvp.open=true;
  }
}
function inferOperationPreset(){
  return 'daily';
}
let _fastPlayOn=false;
let _fastActive={};
let _fastLastFinishedPlayers=[];
let _fastLastNote='';
function _fastResetState(){
  _fastPlayOn=false;
  _fastActive={};
  _fastLastFinishedPlayers=[];
  _fastLastNote='';
}
function _fastStartFresh(){
  _fastPlayOn=true;
  _fastActive={};
  _fastLastFinishedPlayers=[];
  _fastLastNote='';
  _fastFillOpenCourts();
}

/* ═══ 되돌리기(Undo) 스택 ═══ */
const _UNDO_MAX=20;
let _undoStack=[];   // 스냅샷 배열 (최신이 마지막)
let _undoInProgress=false; // 되돌리기 실행 중 플래그 (중복 push 방지)

function _captureUndoSnapshot(label){
  if(_undoInProgress) return;
  if(!currentMatches.length && !_directPlayers.length) return;
  // 현재 점수 읽기
  const scores=currentMatches.map((m,i)=>{
    const s1=document.getElementById('s1_'+i);
    const s2=document.getElementById('s2_'+i);
    return{s1:s1?parseInt(s1.value)||0:0,s2:s2?parseInt(s2.value)||0:0};
  });
  const snap={
    label: label||'변경',
    ts: Date.now(),
    directPlayers: JSON.parse(JSON.stringify(_directPlayers)),
    teamAssignment: teamAssignment?JSON.parse(JSON.stringify(teamAssignment)):null,
    matches: JSON.parse(JSON.stringify(currentMatches)),
    participants: JSON.parse(JSON.stringify(currentParticipants)),
    settings: JSON.parse(JSON.stringify(currentSettings)),
    operationPreset: _operationPreset,
    winOverride: JSON.parse(JSON.stringify(winOverride)),
    lockedBeforeRound: _lockedBeforeRound,
    pointSystem: _pointSystem,
    scores,
    courtsVal: document.getElementById('courts')?.value,
    gppVal: document.getElementById('gamesPerPlayer')?.value,
    mixedDblVal: document.getElementById('mixedDbl')?.value,
  };
  _undoStack.push(snap);
  if(_undoStack.length>_UNDO_MAX) _undoStack.shift();
  _updateUndoBtn();
}

function _updateUndoBtn(){
  const label=_undoStack.length>0?_undoStack[_undoStack.length-1].label:null;
  ['undoBtn','undoBtnMain'].forEach(id=>{
    const btn=document.getElementById(id);
    if(!btn) return;
    btn.disabled=!label;
    btn.title=label?'되돌리기: '+label:'되돌릴 내역 없음';
    btn.style.opacity=label?'1':'0.4';
    // undoBtnMain은 텍스트를 짧게 (↩ 아이콘만)
    // undoBtn은 전체 텍스트 유지
  });
}

function undoAction(){
  if(!_undoStack.length){ alert('되돌릴 내역이 없습니다.'); return; }
  _undoInProgress=true;
  try{
    const snap=_undoStack.pop();
    // ① 데이터 복원 (UI 이전에 먼저 완료)
    _directPlayers.length=0;
    (snap.directPlayers||[]).forEach(p=>_directPlayers.push(p));
    teamAssignment=snap.teamAssignment||null;
    currentMatches=JSON.parse(JSON.stringify(snap.matches||[]));
    currentParticipants=JSON.parse(JSON.stringify(snap.participants||[]));
    currentSettings=JSON.parse(JSON.stringify(snap.settings||{}));
    setOperationPreset(snap.operationPreset||currentSettings.operationPreset||(currentSettings.teamMode?'monthlyTeam':'daily'));
    _fastResetState();
    _lockedBeforeRound=snap.lockedBeforeRound!=null?snap.lockedBeforeRound:null;
    _pointSystem=snap.pointSystem||25;
    Object.keys(winOverride).forEach(k=>delete winOverride[k]);
    Object.assign(winOverride, snap.winOverride||{});
    // ② 설정 입력값 복원
    const _setVal=(id,v)=>{const el=document.getElementById(id);if(el&&v!=null)el.value=v;};
    _setVal('courts',snap.courtsVal);
    _setVal('gamesPerPlayer',snap.gppVal);
    _setVal('mixedDbl',snap.mixedDblVal);
    // ③ UI 렌더링 (각각 try-catch로 보호)
    try{renderDirectPlayerList();}catch(e){console.warn('undo:renderDirectPlayerList',e);}
    try{if(teamAssignment) renderTeamList();}catch(e){console.warn('undo:renderTeamList',e);}
    if(currentMatches.length){
      try{
        renderResults(currentMatches,currentParticipants,currentSettings);
        show('resultArea');
      }catch(e){console.warn('undo:renderResults',e);}
      setTimeout(()=>{
        try{
          (snap.scores||[]).forEach((sc,i)=>{
            const s1=document.getElementById('s1_'+i);
            const s2=document.getElementById('s2_'+i);
            if(s1) s1.value=sc.s1||'';
            if(s2) s2.value=sc.s2||'';
          });
          updateScores();
          scheduleSave();
        }catch(e){console.warn('undo:scores',e);}
      },100);
    }
    _showUndoToast(snap.label||'변경');
    setSaveStatus('saving');
  } catch(e){
    console.error('undoAction 오류:', e);
    alert('되돌리기 오류: '+e.message);
  } finally {
    _undoInProgress=false;
    _updateUndoBtn();
  }
}

function _showUndoToast(label){
  let t=document.getElementById('undoToast');
  if(!t){
    t=document.createElement('div');t.id='undoToast';
    t.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(30,30,30,.9);color:#fff;padding:8px 18px;border-radius:20px;font-size:.78rem;z-index:9999;pointer-events:none;transition:opacity .3s;';
    document.body.appendChild(t);
  }
  t.textContent='↩ 되돌렸습니다: '+label;
  t.style.opacity='1';
  clearTimeout(t._timer);
  t._timer=setTimeout(()=>{t.style.opacity='0';},2200);
}
let teamNames={blue:'청 팀',white:'홍 팀'};

/* ═══ NAV ═══ */
function switchNav(p){
  if(p==='main')p='daily';
  const pages=['main','daily','roster','manual'];
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.toggle('active',t.dataset.nav===p));
  ['pageMain','pageDaily','pageRoster','pageManual'].forEach((id,i)=>document.getElementById(id).classList.toggle('active',pages[i]===p));
  if(p==='daily')setOperationPreset('daily');
}

function selectOperationPreset(mode){
  setOperationPreset('daily');
  switchNav('daily');
  if(typeof syncBottomNav==='function') syncBottomNav('daily');
  window.scrollTo({top:0,behavior:'smooth'});
}

/* 설명서 열기 (PC·모바일 공통) */
function openManual(){
  switchNav('manual');
  // 하단 탭바 활성 상태 해제 (모바일)
  document.querySelectorAll('.bnav-btn').forEach(b=>b.classList.remove('active'));
  window.scrollTo({top:0,behavior:'smooth'});
}

/* ═══ DAILY MODE: 민턴LIVE 실시간 추천 ═══ */
const DAILY_KEY='kokmatch_daily_v1';
const DAILY_CHECKIN_KEY='kokmatch_daily_checkin_id';
const DAILY_CHECKIN_CREATED_KEY='kokmatch_daily_checkin_created_at';
const DAILY_MATCH_MINUTES=15;
const DAILY_AUTO_MIN_START=8;
const DAILY_AUTO_FULL_START=12;
const DAILY_AUTO_GRACE_MS=3*60*1000;
const DAILY_CHECKIN_TTL_MS=48*60*60*1000;
const DAILY_CROSS_DAY_RESUME_MS=6*60*60*1000;
const DAILY_REST_AUTO_DONE_MS=60*60*1000;
const DAILY_QUEUE_REST_PASS_MS=45*60*1000;
const DAILY_OPERATOR_HEARTBEAT_MS=10000;
const DAILY_OFFICIAL_REQUEST_TTL_MS=10*60*1000;
const DAILY_OFFICIAL_OPERATION_TTL_MS=30*60*1000;
const DAILY_COMPLETE_UNDO_MS=45*1000;
const DAILY_OFFICIAL_COMMAND_PROTOCOL=2;
const DAILY_PAUSE_REASON='생일축하·공지';
const DAILY_STATUS={
  invited:{label:'등록 전',eligible:false},
  planned:{label:'등록 전',eligible:false},
  wait:{label:'참가',eligible:true},
  playing:{label:'경기중',eligible:false},
  rest:{label:'휴식',eligible:false},
  done:{label:'종료',eligible:false}
};
function _dailyNormalizeStatus(status){
  if(status==='lesson')return 'rest';
  if(status==='last'||status==='leaving')return 'done';
  return DAILY_STATUS[status]?status:'wait';
}
let _dailyPlayers=[];
let _dailyMatches=[];
let _dailyNext=null;
let _dailyQueue=[];
let _dailyReservations=[];
let _dailySeq=1;
let _dailyAutoAssign=false;
let _dailyOperationStarted=false;
let _dailyFinishMode=false;
let _dailyFinishStartedAt=0;
let _dailyPaused=false;
let _dailyPausedAt=0;
let _dailyPauseReason='';
let _dailyPauseRevision=0;
let _dailyResumedAt=0;
let _dailyTeamMode=false;
let _dailyTeamLocked=false;
let _dailyAutoBusy=false;
let _dailyPairSelectId=null;
let _dailyTimerId=null;
let _dailyIsGuest=false;
let _dailyPlayerSort='status';
let _dailyPlayerFilter='all';
let _dailyPlayerSearch='';
let _dailyPlayerSheetId=null;
let _dailyWaveStarts=0;
let _dailyFourRepeatCache=null;
let _dailyExactRepeatCache=null;
let _dailyCheckinId=null;
let _dailyCheckinCreatedAt=0;
let _dailyCheckinListening=false;
let _dailyCheckinListeningPath='';
let _dailyCheckinRequests=[];
let _dailyCheckinParty={};
let _dailyCheckinApplying=false;
let _dailyVoteDeadlineAt='';
let _dailyStartTime='19:00';
let _dailyEndTime='22:00';
let _dailyCourtOrder=[];
let _dailyManualActiveDraft={mode:'manual',court:null,ids:[],registeredCount:0};
let _dailyEmergencyEditQueueId=null;
let _dailyLastCompleteUndo=null;
let _dailyOperatorHeartbeatId=null;
let _dailyOperatorWakeLock=null;
let _dailyServerRevision=0;
let _dailyOfficialInviteToken='';
let _dailyOfficialInviteHash='';
let _dailyCapabilityPromise=null;
let _dailyServerReconcileError='';
let _dailyAdminGrantToken='';
let _dailyAdminGrantExpiresAt=0;
let _dailyServerSyncBusy=false;
let _dailyServerSyncQueued=false;
let _dailyPauseSyncBusy=false;

function _dailyNow(){return Date.now();}
function _dailyEffectiveNow(){return _dailyPaused&&_dailyPausedAt?_dailyPausedAt:_dailyNow();}
function _dailyPauseLabel(){return _dailyPauseReason||DAILY_PAUSE_REASON;}
function _dailyFlowOperationType(type){
  return [
    'official-player-arrival',
    'official-player-add',
    'official-player-status',
    'official-court-complete',
    'official-active-yield',
    'official-queue-enter-free',
    'official-queue-yield',
    'official-partner-reservation',
    'official-partner-cancel'
  ].includes(String(type||''));
}
function _dailyBlockPaused(options){
  if(!_dailyPaused||options?.allowWhilePaused)return false;
  if(!options?.silent)alert(`현재 진행이 일시 정지되어 있습니다.\n재개한 뒤 ${options?.action||'처리'}해 주세요.`);
  return true;
}
function _dailyId(){return 'dp_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7);}
function _dailyPlayer(id){return _dailyPlayers.find(p=>p.id===id)||null;}
function _dailyGender(g){return (g==='여'||g==='F')?'F':'M';}
function _dailyGenderLabel(g){return (g==='F'||g==='여')?'여':'남';}
function _dailyLevel(p){return p.level || gradeToLevel(p.grade||'C',_dailyGenderLabel(p.gender)) || 4;}
function _dailyNormalizeTimeValue(value,fallback){
  const m=String(value||'').match(/^(\d{1,2}):(\d{2})$/);
  if(!m)return fallback;
  const h=Math.max(0,Math.min(23,parseInt(m[1],10)||0));
  const min=Math.max(0,Math.min(59,parseInt(m[2],10)||0));
  return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
}
function _dailyTimeMinutes(value){
  const t=_dailyNormalizeTimeValue(value,'19:00');
  const [h,m]=t.split(':').map(Number);
  return h*60+m;
}
function _dailyOperatingInfo(nowMs){
  nowMs=nowMs||_dailyNow();
  const startTime=_dailyNormalizeTimeValue(_dailyStartTime,'19:00');
  const endTime=_dailyNormalizeTimeValue(_dailyEndTime,'22:00');
  const startMin=_dailyTimeMinutes(startTime);
  const endMin=_dailyTimeMinutes(endTime);
  const base=new Date(nowMs);
  base.setHours(0,0,0,0);
  let startAt=base.getTime()+startMin*60000;
  let endAt=base.getTime()+endMin*60000;
  if(endAt<=startAt)endAt+=24*60*60*1000;
  if(nowMs<startAt&&startAt-nowMs>12*60*60*1000){
    const prevStart=startAt-24*60*60*1000;
    const prevEnd=endAt-24*60*60*1000;
    if(nowMs<=prevEnd){startAt=prevStart;endAt=prevEnd;}
  }
  const msToStart=startAt-nowMs;
  const msToEnd=endAt-nowMs;
  const label='참고 시간';
  return {startTime,endTime,startAt,endAt,before:false,started:true,ended:false,msToStart,msToEnd,closingSoon:false,closingStop:false,label};
}
function _dailyNormalize(raw){
  const g=_dailyGender(raw.gender||'남');
  const grade=raw.grade||levelToGrade(raw.level||4,g)||'C';
  const now=_dailyNow();
  return {
    id:raw.id||_dailyId(),
    memberId:raw.memberId||'',
    name:(raw.name||'').trim(),
    grade,
    level:raw.level||gradeToLevel(grade,_dailyGenderLabel(g))||4,
    gender:g,
    ageGroup:raw.ageGroup||'40대',
    status:_dailyNormalizeStatus(raw.status||'wait'),
    joinedAt:raw.joinedAt||now,
    waitFrom:raw.waitFrom||now,
    lastStatusAt:raw.lastStatusAt||now,
    restPausedMs:Number(raw.restPausedMs||0),
    games:raw.games||0,
    mixedGames:Number(raw.mixedGames||0),
    typeTrackedGames:Number(raw.typeTrackedGames||0),
    lastPlayedSeq:raw.lastPlayedSeq||0,
    partnerCount:raw.partnerCount||{},
    opponentCount:raw.opponentCount||{},
    partnerName:null,
    partnerId:null,
    currentMatchId:raw.currentMatchId||null,
    afterMatchStatus:raw.afterMatchStatus||null,
    deferUntil:Number(raw.deferUntil||0),
    deferReason:raw.deferReason||'',
    team:raw.team||'',
    club:raw.club||'',
    isGuest:!!raw.isGuest,
    isClubOfficial:!!raw.isClubOfficial,
    arrivalConfirmedBy:raw.arrivalConfirmedBy||'',
    arrivalConfirmedByName:raw.arrivalConfirmedByName||'',
    arrivalConfirmedAt:Number(raw.arrivalConfirmedAt||0),
    arrivalConfirmedSource:raw.arrivalConfirmedSource||'',
    arrivalRequestKey:raw.arrivalRequestKey||''
  };
}
function _dailyRebuildLiveTypeCounts(){
  _dailyPlayers.forEach(p=>{p.mixedGames=0;p.typeTrackedGames=0;});
  _dailyMatches.forEach(m=>{
    if(!m||!m.completedAt||m.cancelledAt)return;
    const t1=(m.team1||[]).map(_dailyPlayer).filter(Boolean);
    const t2=(m.team2||[]).map(_dailyPlayer).filter(Boolean);
    const isMixed=t1.length===2&&t2.length===2&&_dailyQueueType(t1,t2)==='혼복';
    [...t1,...t2].forEach(p=>{
      p.typeTrackedGames=(p.typeTrackedGames||0)+1;
      if(isMixed)p.mixedGames=(p.mixedGames||0)+1;
    });
  });
}
function _dailyClearSimpleTeamState(){
  _dailyTeamMode=false;
  _dailyTeamLocked=false;
  _dailyPlayers.forEach(p=>{p.team='';});
  _dailyMatches.forEach(m=>{m.teamMode=false;});
  _dailyQueue.forEach(q=>{q.teamMode=false;});
}
function _dailyTeamSide(p){
  return p&&(p.team==='청팀'||p.team==='홍팀')?p.team:'';
}
function _dailyTeamCounts(){
  const live=_dailyPlayers.filter(p=>p.status!=='done');
  const blue=live.filter(p=>p.team==='청팀').length;
  const white=live.filter(p=>p.team==='홍팀').length;
  const unassigned=live.length-blue-white;
  return {live,blue,white,unassigned};
}
function _dailyEnsureCaptains(){
  if(!captains||!captains.blue||!captains.white)captains={blue:{leader:'',sub:''},white:{leader:'',sub:''}};
  ['blue','white'].forEach(side=>{
    captains[side]=captains[side]||{leader:'',sub:''};
    captains[side].leader=captains[side].leader||'';
    captains[side].sub=captains[side].sub||'';
  });
}
function _dailyCleanCaptains(){
  _dailyEnsureCaptains();
  const teamBySide={blue:'청팀',white:'홍팀'};
  ['blue','white'].forEach(side=>{
    ['leader','sub'].forEach(role=>{
      const name=captains[side][role];
      if(!name)return;
      const p=_dailyPlayers.find(x=>x.name===name&&x.status!=='done');
      if(!p||p.team!==teamBySide[side])captains[side][role]='';
    });
  });
}
function _dailyTeamRoster(side){
  const team=side==='blue'?'청팀':'홍팀';
  return _dailyPlayers.filter(p=>p.status!=='done'&&p.team===team);
}
function _dailyTeamStat(list){
  const men=list.filter(p=>p.gender==='M').length;
  const women=list.filter(p=>p.gender==='F').length;
  const level=Math.round(list.reduce((s,p)=>s+_dailyLevel(p),0)*10)/10;
  return {men,women,level};
}
function _dailyRoleLabel(side,role){
  const name=captains?.[side]?.[role]||'';
  return name||'미지정';
}
function dailySetCaptain(side,role,playerId){
  _dailyEnsureCaptains();
  const p=_dailyPlayer(playerId);
  if(!p)return;
  const expected=side==='blue'?'청팀':'홍팀';
  if(p.team!==expected){
    alert(`${p.name} 선수는 ${side==='blue'?teamNames.blue:teamNames.white} 소속이 아닙니다.`);
    return;
  }
  const was=captains[side][role]===p.name;
  ['blue','white'].forEach(s=>['leader','sub'].forEach(r=>{
    if(captains[s][r]===p.name)captains[s][r]='';
  }));
  if(!was)captains[side][role]=p.name;
  dailySave();
  dailyRender();
}
function _dailyCanChangeRoster(){
  return !_dailyBlockPaused({action:'참가 명단을 변경'});
}
function _dailyMinutes(ts){
  if(!ts)return 0;
  return Math.max(0,Math.floor((_dailyEffectiveNow()-ts)/60000));
}
function _dailyNameHtml(p){
  if(!p)return '';
  return `<span class="daily-name-chip">${esc(p.name)}${p.isGuest?'<span class="guest-badge">G</span>':''}${p.isClubOfficial?'<span class="club-official-badge">임원</span>':''}</span>`;
}
function _dailyNameText(p){
  if(!p)return '';
  return `${p.name}${p.isGuest?'(게스트)':''}`;
}
function toggleDailyGuestMode(force){
  _dailyIsGuest=typeof force==='boolean'?force:!_dailyIsGuest;
  const btn=document.getElementById('dailyGuestBtn');
  if(btn){
    btn.classList.toggle('on',_dailyIsGuest);
    btn.title=_dailyIsGuest?'게스트 추가 중 — 클릭해서 해제':'게스트로 추가';
  }
  const name=document.getElementById('dailyName');
  if(name)name.placeholder=_dailyIsGuest?'게스트 이름':'이름';
}
function dailyToggleTeamMode(on){
  _dailyClearSimpleTeamState();
  dailySave();
  dailyRender();
}
function dailyAssignTeams(){
  alert('민턴LIVE에서는 간단 팀 나눔을 제거했습니다. 지금은 상태 관리, 대기표, 코트 진행에 집중합니다.');
}
function dailyToggleTeamLock(){
  _dailyClearSimpleTeamState();
  dailySave();
  dailyRender();
}
function dailyRenderTeamControls(){
  _dailyClearSimpleTeamState();
}
function dailyRenderTeamRoster(){
  _dailyClearSimpleTeamState();
}
function _dailyStatusBadge(status){
  const s=DAILY_STATUS[status]||DAILY_STATUS.wait;
  return `<span class="daily-status ${status}">${s.label}</span>`;
}
function _dailyStatusSelect(p){
  const keys=['invited','wait','playing','rest','done'];
  const selectedStatus=p.status==='planned'?'invited':p.status;
  return `<select class="daily-select" onchange="dailySetStatus('${p.id}',this.value)" ${(p.status==='playing'||p.currentMatchId)?'disabled':''}>
    ${keys.map(k=>`<option value="${k}" ${selectedStatus===k?'selected':''}>${DAILY_STATUS[k].label}</option>`).join('')}
  </select>`;
}
function _dailyPartnerConstraintOk(four){
  return four.every(p=>!p.partnerName||four.some(x=>x.name===p.partnerName));
}
function _dailyValidTeamPairing(t1,t2){
  const all=[...t1,...t2];
  return all.every(p=>{
    if(!p.partnerName)return true;
    const partner=all.find(x=>x.name===p.partnerName);
    if(!partner)return false;
    return t1.includes(p)===t1.includes(partner);
  });
}
function _dailyPairedLabels(all){
  const labels=[];
  all.forEach(p=>{
    if(!p.partnerName||!all.some(x=>x.name===p.partnerName))return;
    const label=[p.name,p.partnerName].sort().join('·');
    if(!labels.includes(label))labels.push(label);
  });
  return labels;
}
function _dailyPairButton(p){
  return '';
}
function _dailyReservationIds(r){
  return [...(r.team1||[]),...(r.team2||[])].filter(Boolean);
}
function _dailyReservationPreservesOrder(r){
  return !!(r&&(r.preserveOrder===true||r.source==='member-request'||r.source==='club-official-request'));
}
function _dailyReservationPlayerConflict(ids,exceptId){
  const target=new Set(ids.filter(Boolean));
  if(!target.size)return null;
  return _dailyReservations.find(r=>r.id!==exceptId&&_dailyReservationIds(r).some(id=>target.has(id)))||null;
}
function _dailyReservationHeldIds(exceptId){
  const held=new Set();
  _dailyReservations.forEach(r=>{
    if(exceptId&&r.id===exceptId)return;
    _dailyReservationIds(r).forEach(id=>held.add(id));
  });
  return held;
}
function _dailyReservationRequestRefByKey(key){
  return key&&_fbDb&&_dailyCheckinId?_fbDb.ref(_dailyCheckinPath()+'/requests/'+key):null;
}
function _dailyMarkReservationCancelled(r,reason,actor){
  if(!r)return;
  const ref=_dailyReservationRequestRefByKey(r.requestKey);
  if(ref){
    ref.update({
      ignoredAt:_dailyNow(),
      ignoredBy:actor||'member-auto-cancel',
      reason:reason||'상태 변경으로 신청이 자동 취소되었습니다.'
    }).catch(()=>{});
  }
  if(r.requestKey)_dailyCheckinRequests=_dailyCheckinRequests.filter(req=>req.key!==r.requestKey);
}
function _dailyCancelReservationById(id,reason,actor){
  const r=_dailyReservations.find(x=>x.id===id);
  if(r)_dailyMarkReservationCancelled(r,reason,actor);
  _dailyReservations=_dailyReservations.filter(x=>x.id!==id);
}
function _dailyCancelReservationsForPlayer(playerId,reason,actor){
  const removed=_dailyReservations.filter(r=>_dailyReservationIds(r).includes(playerId));
  if(!removed.length)return false;
  removed.forEach(r=>_dailyMarkReservationCancelled(r,reason,actor));
  const ids=new Set(removed.map(r=>r.id));
  _dailyReservations=_dailyReservations.filter(r=>!ids.has(r.id));
  _dailyQueue.forEach(q=>{
    if(q.reservationId&&ids.has(q.reservationId)){
      q.reservationId=null;
      q.reservationLabel=null;
    }
  });
  return true;
}
function _dailyReservationNames(ids){
  return ids.map(id=>_dailyPlayer(id)).filter(Boolean).map(_dailyNameText);
}
function _dailyReservationLabel(r){
  const a=_dailyReservationNames(r.team1||[]);
  const b=_dailyReservationNames(r.team2||[]);
  if(r.mode==='pair')return `${a.join('·')} 같은 편`;
  return `${a.join('·')} vs ${b.join('·')}`;
}
function _dailyReservationSelectOptions(current,optional){
  const players=[..._dailyPlayers].sort((a,b)=>a.name.localeCompare(b.name,'ko'));
  return `${optional?'<option value="">상대 자동</option>':'<option value="">선택</option>'}`+
    players.map(p=>`<option value="${p.id}" ${p.id===current?'selected':''}>${p.isGuest?'[G] ':''}${esc(p.name)} · ${_dailyGenderLabel(p.gender)} · ${esc(p.grade||'C')} · ${DAILY_STATUS[p.status]?.label||'참가'}</option>`).join('');
}
function _dailyReservationPlayerSelects(){
  const typeEl=document.getElementById('dailyReservationType');
  const mode=typeEl?.value||'pair';
  const ids=['dailyResA1','dailyResA2','dailyResB1','dailyResB2'];
  const selected={};
  ids.forEach(id=>{selected[id]=document.getElementById(id)?.value||'';});
  ids.forEach(id=>{
    const el=document.getElementById(id);
    if(!el)return;
    const isOpponent=id==='dailyResB1'||id==='dailyResB2';
    el.innerHTML=_dailyReservationSelectOptions(selected[id],isOpponent||mode==='pair');
    if(selected[id])el.value=selected[id];
    el.disabled=mode==='pair'&&isOpponent;
    if(mode==='pair'&&isOpponent)el.value='';
  });
}
function _dailyReservationPairConflict(team1Ids,team2Ids){
  const selected=[...team1Ids,...team2Ids].filter(Boolean).map(_dailyPlayer).filter(Boolean);
  return selected.some(p=>{
    if(!p.partnerName)return false;
    const partner=selected.find(x=>x.name===p.partnerName);
    if(!partner)return true;
    const sameSide=team1Ids.includes(p.id)===team1Ids.includes(partner.id);
    return !sameSide;
  });
}
function _dailyTeamGenderShape(team){
  const f=team.filter(p=>p&&p.gender==='F').length;
  if(f===0)return '남복';
  if(f===2)return '여복';
  return '혼복';
}
function _dailySameOpponentShape(team1,team2){
  return _dailyTeamGenderShape(team1)===_dailyTeamGenderShape(team2);
}
function _dailyReservationMatchFromTeams(r,t1,t2){
  const team1Level=_dailyTeamLevel(t1);
  const team2Level=_dailyTeamLevel(t2);
  const levelDiff=Math.round(Math.abs(team1Level-team2Level)*10)/10;
  return {
    team1A:t1[0],team1B:t1[1],team2C:t2[0],team2D:t2[1],
    type:_dailyQueueType(t1,t2),
    levelDiff,team1Level,team2Level,
    isFlexible:_dailyQueueType(t1,t2)==='예외',
    reservationId:r.id,
    reservationLabel:_dailyReservationLabel(r)
  };
}
function _dailyReservationToQueueItem(r,excludeIds){
  if(!r||_dailyQueue.some(q=>q.reservationId===r.id))return null;
  const team1=(r.team1||[]).map(_dailyPlayer).filter(Boolean);
  if(team1.length!==2)return null;
  if(team1.some(p=>excludeIds.has(p.id)||!DAILY_STATUS[p.status]?.eligible||p.currentMatchId))return null;
  if(r.mode==='match'){
    const team2=(r.team2||[]).map(_dailyPlayer).filter(Boolean);
    if(team2.length!==2)return null;
    const all=[...team1,...team2];
    if(new Set(all.map(p=>p.id)).size!==4)return null;
    if(all.some(p=>excludeIds.has(p.id)||!DAILY_STATUS[p.status]?.eligible||p.currentMatchId))return null;
    if(!_dailyValidTeamPairing(team1,team2))return null;
    const m=_dailyReservationMatchFromTeams(r,team1,team2);
    if(!_dailyMatchTeamBalanceOk(m))return null;
    const strict=m.type!=='예외'&&_dailyMatchPartnerGapOfficialOk(m);
    if(!strict)return null;
    return _dailyQueueFromMatch(m,_dailyScoreMatch(m,strict)-1200,strict);
  }
  const heldByOthers=_dailyReservationHeldIds(r.id);
  const candidates=_dailyEligible()
    .filter(p=>!excludeIds.has(p.id)&&!heldByOthers.has(p.id)&&!team1.some(x=>x.id===p.id))
    .sort((a,b)=>{
      if((a.games||0)!==(b.games||0))return (a.games||0)-(b.games||0);
      return (a.waitFrom||0)-(b.waitFrom||0);
    }).slice(0,20);
  let best=null,bestScore=Infinity,bestStrict=false;
  for(let i=0;i<candidates.length-1;i++)for(let j=i+1;j<candidates.length;j++){
    const team2=[candidates[i],candidates[j]];
    if(!_dailySameOpponentShape(team1,team2))continue;
    if(!_dailyValidTeamPairing(team1,team2))continue;
    const m=_dailyReservationMatchFromTeams(r,team1,team2);
    if(!_dailyMatchTeamBalanceOk(m))continue;
    const strict=m.type!=='예외'&&_dailyMatchPartnerGapOfficialOk(m);
    if(!strict)continue;
    const score=_dailyScoreMatch(m,strict)-1200;
    if(score<bestScore){best=m;bestScore=score;bestStrict=strict;}
  }
  return best?_dailyQueueFromMatch(best,bestScore,bestStrict):null;
}
function _dailyBuildReservationQueueItem(excludeIds,onlyId){
  const list=onlyId?_dailyReservations.filter(r=>r.id===onlyId):_dailyReservations;
  for(const r of list){
    const q=_dailyReservationToQueueItem(r,excludeIds);
    if(q)return q;
  }
  return null;
}
function _dailyTryApplyReservationToExistingQueue(r){
  if(!r||!r.id||_dailyQueue.some(q=>q.reservationId===r.id))return false;
  const ids=_dailyReservationIds(r);
  if(!ids.length)return false;
  const locs=ids.map(_dailyQueuedPlayerLocation);
  if(locs.some(x=>!x))return false;
  const idx=locs[0].idx;
  if(!locs.every(x=>x.idx===idx))return false;
  const q=locs[0].q;
  if(q.reservationId&&q.reservationId!==r.id)return false;
  const before=JSON.parse(JSON.stringify(q));
  const restore=()=>{
    Object.keys(q).forEach(k=>delete q[k]);
    Object.assign(q,before);
  };
  const mark=()=>{
    q.reservationId=r.id;
    q.reservationLabel=_dailyReservationLabel(r);
    _dailyRecalcQueueItem(q);
    return true;
  };
  if(r.mode==='match'){
    const all=[...(r.team1||[]),...(r.team2||[])].filter(Boolean);
    if(all.length!==4||new Set(all).size!==4)return false;
    if(new Set(_dailyQueueIds(q)).size!==4||!all.every(id=>_dailyQueueIds(q).includes(id)))return false;
    q.team1=[...(r.team1||[])];
    q.team2=[...(r.team2||[])];
    _dailyRecalcQueueItem(q);
    if(_dailyQueueItemValid(q,null))return mark();
    restore();
    return false;
  }
  const pair=(r.team1||[]).filter(Boolean);
  if(pair.length!==2)return false;
  const pairLocs=pair.map(_dailyQueuedPlayerLocation);
  if(pairLocs.some(x=>!x||x.idx!==idx))return false;
  if(pairLocs[0].side===pairLocs[1].side)return mark();
  const others=_dailyQueueIds(q).filter(id=>!pair.includes(id));
  if(others.length!==2)return false;
  const tryTeams=[
    {team1:[...pair],team2:[...others]},
    {team1:[...others],team2:[...pair]}
  ];
  for(const next of tryTeams){
    q.team1=next.team1;
    q.team2=next.team2;
    _dailyRecalcQueueItem(q);
    if(_dailyQueueItemValid(q,null))return mark();
  }
  restore();
  return false;
}
function _dailyApplyReservationsToExistingQueue(){
  let changed=false;
  _dailyReservations.forEach(r=>{
    if(_dailyTryApplyReservationToExistingQueue(r))changed=true;
  });
  return changed;
}
function _dailyReservationStatus(r){
  _dailyTryApplyReservationToExistingQueue(r);
  const qIdx=_dailyQueue.findIndex(q=>q.reservationId===r.id);
  if(qIdx>=0){
    return {
      cls:'queued',
      text:`다음 대진 ${qIdx+1}순위`,
      detail:_dailyReservationPreservesOrder(r)?'파트너 접수가 반영됐어요. 기존 순번은 그대로 유지돼요.':'대기표에 반영됐습니다.',
      ready:false
    };
  }
  const ids=_dailyReservationIds(r).map(id=>_dailyPlayer(id)).filter(Boolean);
  if(ids.length<(r.mode==='match'?4:2))return {cls:'',text:'선수 선택 필요',ready:false};
  const reservedQueued=ids.filter(p=>_dailyIsLockedQueued(p.id));
  if(reservedQueued.length)return {cls:'queued',text:`다른 신청대기 포함: ${reservedQueued.map(_dailyNameText).join(', ')}`,ready:false};
  const queued=ids.filter(p=>_dailyIsQueued(p.id));
  if(queued.length&&_dailyReservationPreservesOrder(r)){
    return {
      cls:'queued',
      text:'현재 대진 순번 유지',
      detail:'앞선 대진을 밀지 않고, 해당 경기 뒤 빈 순서에 반영돼요.',
      ready:false
    };
  }
  const blocked=ids.filter(p=>!DAILY_STATUS[p.status]?.eligible||p.currentMatchId);
  if(blocked.length){
    const playing=blocked.filter(p=>p.currentMatchId||_dailyNormalizeStatus(p.status)==='playing');
    if(playing.length){
      const names=playing.map(p=>`${_dailyNameText(p)}님`).join(', ');
      const subject=playing.length===1?names:`${names} 모두`;
      return {
        cls:'waiting-player',
        text:'상대 경기 중',
        detail:`${subject} 경기 종료 후 기존 대진 뒤 빈 순서에 반영돼요.`,
        ready:false
      };
    }
    return {
      cls:'blocked',
      text:`현재 참가 아님: ${blocked.map(_dailyNameText).join(', ')}`,
      detail:'모두 참가 상태가 되면 순번을 앞당기지 않고 빈 순서에 반영돼요.',
      ready:false
    };
  }
  if(r.mode==='pair'){
    const heldByOthers=_dailyReservationHeldIds(r.id);
    const pool=_dailyEligible().filter(p=>!ids.some(x=>x.id===p.id)&&!heldByOthers.has(p.id));
    let sameShapeReady=false;
    for(let i=0;i<pool.length-1&&!sameShapeReady;i++)for(let j=i+1;j<pool.length;j++){
      if(_dailySameOpponentShape(ids,[pool[i],pool[j]])&&_dailyValidTeamPairing(ids,[pool[i],pool[j]])){
        sameShapeReady=true;
        break;
      }
    }
    if(!sameShapeReady)return {cls:'',text:`${_dailyTeamGenderShape(ids)} 상대 후보 대기 필요`,ready:false};
  }
  const used=new Set();
  _dailyQueue.forEach(q=>{
    if(q.reservationId===r.id)return;
    _dailyQueueIds(q).forEach(id=>used.add(id));
  });
  const q=_dailyBuildReservationQueueItem(used,r.id);
  if(q&&_dailyReservationPreservesOrder(r)&&_dailyQueue.length>=_dailyQueueCapacity().target){
    return {
      cls:'',
      text:'기존 대진 뒤 반영 대기',
      detail:'순번은 앞당기지 않고 빈 순서가 생기면 들어가요.',
      ready:false
    };
  }
  return q?{cls:'ready',text:'반영 가능',ready:true}:{cls:'',text:'신청 조건 확인 필요',ready:false};
}
function _dailyReservationReadyCount(){
  return _dailyReservations.filter(r=>_dailyReservationStatus(r).ready).length;
}
function _dailyPromoteReadyReservations(silent){
  if(_dailyFinishMode){
    if(!silent)alert('마무리 중에는 새 게임신청을 반영하지 않습니다.');
    return false;
  }
  let changed=false;
  for(const r of _dailyReservations){
    const preserveOrder=_dailyReservationPreservesOrder(r);
    const existingIdx=_dailyQueue.findIndex(q=>q.reservationId===r.id);
    if(existingIdx>=0){
      continue;
    }
    if(preserveOrder&&_dailyTryApplyReservationToExistingQueue(r)){
      changed=true;
      continue;
    }
    const locked=_dailyQueue.filter(q=>q.reservationId&&q.reservationId!==r.id);
    const lockedIds=new Set();
    locked.forEach(q=>_dailyQueueIds(q).forEach(pid=>lockedIds.add(pid)));
    const q=_dailyBuildReservationQueueItem(lockedIds,r.id);
    if(!q)continue;
    if(preserveOrder){
      if(_dailyQueue.length>=_dailyQueueCapacity().target)continue;
      _dailyQueue.push(q);
      changed=true;
      continue;
    }
    const ids=new Set(_dailyQueueIds(q));
    const lockedQueueIds=new Set(locked.map(item=>item.id));
    const flex=_dailyQueue
      .filter(item=>item.reservationId!==r.id&&!lockedQueueIds.has(item.id)&&!_dailyQueueIds(item).some(pid=>ids.has(pid)));
    _dailyQueue=[...locked,q,...flex].slice(0,_dailyQueueCapacity().target);
    changed=true;
  }
  if(!changed){
    if(!silent)alert('지금 바로 반영 가능한 게임신청이 없습니다. 신청 선수들이 모두 참가 상태인지 확인해 주세요.');
    return;
  }
  _dailyRefreshNextFromQueue();
  dailySave();
  dailyRender();
}
function dailyPromoteReadyReservations(){
  _dailyPromoteReadyReservations(false);
}
function dailyForceRebuildQueue(){
  if(!confirm('다음 대진을 현재 대기자 기준으로 다시 짤까요?\n이미 준비된 대진도 함께 바뀔 수 있습니다.'))return;
  _dailyEmergencyEditQueueId=null;
  _dailyQueue=[];
  dailyEnsureQueue();
  dailySave();
  dailyRender();
}
function dailyMoveQueueItem(queueId,dir){
  if(_dailyBlockPaused({action:'대진 순서를 변경'}))return;
  const idx=_dailyQueue.findIndex(q=>q.id===queueId);
  if(idx<0)return;
  const nextIdx=idx+(dir<0?-1:1);
  if(nextIdx<0||nextIdx>=_dailyQueue.length)return;
  const item=_dailyQueue.splice(idx,1)[0];
  _dailyQueue.splice(nextIdx,0,item);
  _dailyRefreshNextFromQueue();
  dailySave();
  dailyRender();
}
function dailyMoveQueueTo(sourceId,targetId){
  if(_dailyBlockPaused({action:'대진 순서를 변경'}))return;
  if(!sourceId||!targetId||sourceId===targetId)return;
  const from=_dailyQueue.findIndex(q=>q.id===sourceId);
  const to=_dailyQueue.findIndex(q=>q.id===targetId);
  if(from<0||to<0||from===to)return;
  const item=_dailyQueue.splice(from,1)[0];
  _dailyQueue.splice(to,0,item);
  _dailyRefreshNextFromQueue();
  dailySave();
  dailyRender();
}
let _dailyQueueDrag=null;
function _dailyQueueDragClear(){
  document.querySelectorAll('.daily-queue-item.drag-over,.daily-queue-item.dragging')
    .forEach(el=>el.classList.remove('drag-over','dragging'));
}
function dailyQueueDragStart(ev,id){
  if(!ev.target.closest('.daily-drag-handle')){
    ev.preventDefault();
    return false;
  }
  _dailyQueueDrag={id,targetId:id};
  ev.currentTarget?.classList?.add('dragging');
  if(ev.dataTransfer){
    ev.dataTransfer.effectAllowed='move';
    ev.dataTransfer.setData('text/plain',id);
  }
}
function dailyQueueDragOver(ev,id){
  if(!_dailyQueueDrag)return;
  ev.preventDefault();
  _dailyQueueDrag.targetId=id;
  _dailyQueueDragClear();
  const el=document.querySelector(`[data-daily-queue-id="${id}"]`);
  if(el)el.classList.add('drag-over');
}
function dailyQueueDrop(ev,id){
  if(ev)ev.preventDefault();
  const source=(_dailyQueueDrag&&_dailyQueueDrag.id)||(ev?.dataTransfer&&ev.dataTransfer.getData('text/plain'));
  _dailyQueueDragClear();
  _dailyQueueDrag=null;
  dailyMoveQueueTo(source,id);
}
function dailyQueueDragEnd(){
  _dailyQueueDragClear();
  _dailyQueueDrag=null;
}
function dailyQueuePointerDown(ev,id){
  if(ev.button!==undefined&&ev.button!==0)return;
  ev.preventDefault();
  _dailyQueueDrag={id,targetId:id};
  const item=ev.target.closest('[data-daily-queue-id]');
  if(item)item.classList.add('dragging');
  document.addEventListener('pointermove',dailyQueuePointerMove);
  document.addEventListener('pointerup',dailyQueuePointerUp,{once:true});
  document.addEventListener('pointercancel',dailyQueuePointerCancel,{once:true});
}
function dailyQueuePointerMove(ev){
  if(!_dailyQueueDrag)return;
  const el=document.elementFromPoint(ev.clientX,ev.clientY)?.closest?.('[data-daily-queue-id]');
  if(!el)return;
  const id=el.dataset.dailyQueueId;
  if(!id)return;
  _dailyQueueDrag.targetId=id;
  _dailyQueueDragClear();
  el.classList.add('drag-over');
}
function dailyQueuePointerUp(){
  if(!_dailyQueueDrag)return;
  const {id,targetId}=_dailyQueueDrag;
  document.removeEventListener('pointermove',dailyQueuePointerMove);
  document.removeEventListener('pointercancel',dailyQueuePointerCancel);
  _dailyQueueDragClear();
  _dailyQueueDrag=null;
  dailyMoveQueueTo(id,targetId);
}
function dailyQueuePointerCancel(){
  document.removeEventListener('pointermove',dailyQueuePointerMove);
  document.removeEventListener('pointerup',dailyQueuePointerUp);
  dailyQueueDragEnd();
}
function dailyDeleteQueueItem(queueId){
  if(_dailyBlockPaused({action:'대기 경기를 삭제'}))return;
  const idx=_dailyQueue.findIndex(q=>q.id===queueId);
  if(idx<0)return;
  if(!confirm('이 대기 경기를 삭제하고 현재 대기자로 다시 채울까요?'))return;
  _dailyQueue.splice(idx,1);
  _dailyEmergencyEditQueueId=null;
  dailyEnsureQueue();
  dailySave();
  dailyRender();
}
function dailyToggleEmergencyQueueEdit(queueId){
  const q=_dailyQueue.find(x=>x.id===queueId);
  if(!q)return;
  if(q.reservationId){
    alert('회원 게임신청은 신청 의도를 보호하기 위해 선수 직접 수정이 잠겨 있습니다. 신청 삭제 후 다시 등록해 주세요.');
    return;
  }
  if(_dailyEmergencyEditQueueId===queueId){
    _dailyEmergencyEditQueueId=null;
  }else{
    if(!confirm('이 다음 대진은 이미 준비된 대진입니다.\n비상 상황으로 선수 교체 권한을 열까요?'))return;
    _dailyEmergencyEditQueueId=queueId;
  }
  dailyRender();
}
function _dailyMatchEndAt(m){
  return Number(m?.endAt)||(m.startedAt||_dailyNow())+(m.expectedMinutes||DAILY_MATCH_MINUTES)*60000;
}
function _dailyClock(ts){
  return new Date(ts).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
}
function _dailyRemainingMinutes(m){
  return Math.max(0,Math.ceil((_dailyMatchEndAt(m)-_dailyEffectiveNow())/60000));
}
function _dailyTimerState(m){
  if(m.completedAt)return 'done';
  const remain=_dailyRemainingMinutes(m);
  if(remain<=0)return 'due';
  if(remain<=5)return 'soon';
  return 'normal';
}
function _dailyTimerText(m){
  if(m.completedAt)return '완료';
  const remain=_dailyRemainingMinutes(m);
  if(_dailyPaused)return `정지 · ${remain}분`;
  if(remain<=0)return '종료임박';
  if(remain<=5)return `${remain}분 남음`;
  return `${remain}분`;
}
function _dailyCompleteButtonText(m){
  return '종료';
}
function _dailyQueueRestPassActive(q){
  if(!q||!q.restPass)return false;
  const created=parseInt(q.restPass.createdAt,10)||0;
  return created&&_dailyEffectiveNow()-created<DAILY_QUEUE_REST_PASS_MS;
}
function _dailyQueueRestPassLabel(q){
  if(!_dailyQueueRestPassActive(q))return '';
  const name=q.restPass?.playerName||'대기 선수';
  return `${name}님이 조금 쉬고 입장`;
}
function _dailyClearQueueRestPasses(reason){
  let changed=false;
  _dailyQueue.forEach(q=>{
    if(q.restPass){
      q.restPassClearedAt=_dailyNow();
      q.restPassClearReason=reason||'new-opportunity';
      delete q.restPass;
      changed=true;
    }
  });
  return changed;
}
function _dailyFirstStartableQueueForCourt(court){
  dailyEnsureQueue();
  return _dailyQueue.find(q=>_dailyQueueItemValid(q,null)&&!_dailyQueueRestPassActive(q)&&(!court||_dailyCourtAvailable(court,null)))||null;
}
function _dailyQueueStartInfo(idx){
  if(_dailyPaused)return {state:'paused',text:'진행 일시 정지',detail:'재개 후 순서 유지',court:null,matchId:''};
  const active=_dailyActiveMatches()
    .filter(m=>!m.cancelledAt)
    .sort((a,b)=>{
      const ah=a.transitionStarted?0:1;
      const bh=b.transitionStarted?0:1;
      if(ah!==bh)return ah-bh;
      return (_dailyMatchEndAt(a)-_dailyMatchEndAt(b))||(a.court-b.court);
    });
  const freeCourts=_dailyFreeCourts();
  const q=_dailyQueue[idx]||null;
  const usableBefore=_dailyQueue.slice(0,idx).filter(item=>_dailyQueueItemValid(item,null)&&!_dailyQueueRestPassActive(item)).length;
  if(_dailyQueueRestPassActive(q)&&usableBefore<freeCourts.length){
    return {state:'hold',text:'조금 쉬고',detail:'',court:null,matchId:''};
  }
  if(!_dailyQueueRestPassActive(q)&&usableBefore<freeCourts.length){
    const court=freeCourts[usableBefore];
    const hold=_dailyCourtEntryHold(court);
    return {state:'free',text:`${court}코트`,detail:'입장 가능',court,matchId:'',holdId:_dailyCourtEntryHoldId(hold),holdAt:Number(hold?.officialEntryPendingAt||0)};
  }
  const m=active[usableBefore-freeCourts.length];
  if(!m)return {state:'normal',text:'코트 배정 대기',detail:'진행중 경기 없음',court:null,matchId:''};
  if(m.transitionStarted)return {state:'handoff',text:`${m.court}코트`,detail:'',court:m.court,matchId:m.id};
  const state=_dailyTimerState(m);
  const remain=_dailyRemainingMinutes(m);
  if(state==='due')return {state:'due',text:`${m.court}코트`,detail:'입장',court:m.court,matchId:m.id};
  if(state==='soon')return {state:'soon',text:`${m.court}코트`,detail:`${remain}분`,court:m.court,matchId:m.id};
  return {state:'normal',text:`${m.court}코트`,detail:`${_dailyClock(_dailyMatchEndAt(m))} 전후`,court:m.court,matchId:m.id};
}
function _dailyQueueStartCueHtml(idx){
  const info=_dailyQueueStartInfo(idx);
  const label=[info.text,info.detail].filter(Boolean).join(' · ');
  return `<span class="daily-start-cue ${info.state}" data-daily-queue-cue="${idx}">${esc(label)}</span>`;
}
function dailyRefreshTimers(){
  if(!_dailyPaused&&_dailyAutoEndIdleRestPlayers()){
    dailyEnsureQueue();
    dailySave();
    dailyRender();
    return;
  }
  const beforeTarget=_dailyQueueCapacity().target;
  document.querySelectorAll('[data-daily-timer]').forEach(el=>{
    const m=_dailyMatches.find(x=>x.id===el.dataset.dailyTimer);
    if(!m)return;
    const state=_dailyTimerState(m);
    el.textContent=_dailyTimerText(m);
    el.classList.toggle('soon',state==='soon');
    el.classList.toggle('due',state==='due');
  });
  document.querySelectorAll('[data-daily-complete]').forEach(el=>{
    const m=_dailyMatches.find(x=>x.id===el.dataset.dailyComplete);
    if(!m)return;
    el.textContent=_dailyCompleteButtonText(m);
  });
  document.querySelectorAll('[data-daily-court-state]').forEach(el=>{
    const m=_dailyMatches.find(x=>x.id===el.dataset.dailyCourtState);
    if(!m)return;
    const state=_dailyTimerState(m);
    el.textContent=state==='due'?'종료임박':state==='soon'?'곧 종료':'진행중';
    el.className=`daily-court-state ${state==='due'?'due':state==='soon'?'soon':'busy'}`;
  });
  document.querySelectorAll('[data-daily-court-card]').forEach(el=>{
    const m=_dailyMatches.find(x=>x.id===el.dataset.dailyCourtCard);
    if(!m)return;
      const state=_dailyTimerState(m);
      el.className=`daily-court-card busy ${state==='due'?'due':state==='soon'?'soon':''}`;
    });
  dailyRefreshUndoCountdown();
  document.querySelectorAll('[data-daily-queue-cue]').forEach(el=>{
    const info=_dailyQueueStartInfo(parseInt(el.dataset.dailyQueueCue)||0);
    el.textContent=`${info.text} · ${info.detail}`;
    el.className=`daily-start-cue ${info.state}`;
  });
  if(_dailyPaused)return;
  if(_dailyQueueCapacity().target!==beforeTarget){
    dailyEnsureQueue();
    dailySave();
    dailyRender();
    return;
  }
  const flow=_dailyNaturalAutoInfo();
  if(flow.auto&&!_dailyAutoBusy){
    dailyMaybeAutoAssign();
  }else if(flow.phase==='grace'){
    dailyRenderOpsStats();
  }
}
function dailyRefreshUndoCountdown(){
  if(!_dailyLastCompleteUndo)return;
  const remain=Math.max(0,Math.ceil((_dailyLastCompleteUndo.expiresAt-_dailyNow())/1000));
  document.querySelectorAll('[data-daily-undo-sec]').forEach(el=>{el.textContent=`${remain}초`;});
  if(remain<=0){
    _dailyLastCompleteUndo=null;
    dailyRenderAdminAlerts();
  }
}
function _dailyAutoEndIdleRestPlayers(){
  const now=_dailyNow();
  let changed=0;
  _dailyPlayers.forEach(p=>{
    if(_dailyNormalizeStatus(p.status)!=='rest')return;
    if(p.currentMatchId||_dailyIsQueued(p.id))return;
    const since=p.lastStatusAt||p.waitFrom||p.joinedAt||0;
    if(!since||now-since-Number(p.restPausedMs||0)<DAILY_REST_AUTO_DONE_MS)return;
    _dailyCancelReservationsForPlayer(p.id,`${p.name} 선수가 60분 이상 휴식 상태라 게임신청이 자동 취소됐습니다.`,'auto-rest-done');
    p.status='done';
    p.afterMatchStatus=null;
    p.waitFrom=now;
    p.lastStatusAt=now;
    p.restPausedMs=0;
    changed++;
  });
  if(changed){
    const doneIds=new Set(_dailyPlayers.filter(p=>p.status==='done').map(p=>p.id));
    _dailyQueue=_dailyQueue.filter(q=>!_dailyQueueIds(q).some(id=>doneIds.has(id)));
    _dailyRefreshNextFromQueue();
    _dailyMarkFourCacheDirty();
  }
  return changed;
}
function _dailyActiveMatches(){return _dailyMatches.filter(m=>!m.completedAt&&!m.cancelledAt);}
function _dailyCourtCount(){
  return Math.max(1,parseInt(document.getElementById('dailyCourts')?.value)||3);
}
function _dailyDefaultCourtOrder(count){
  const n=Math.max(1,Math.min(12,parseInt(count)||_dailyCourtCount()));
  return Array.from({length:n},(_,i)=>i+1);
}
function _dailyNormalizeCourtOrder(order,count){
  const n=Math.max(1,Math.min(12,parseInt(count)||_dailyCourtCount()));
  const out=[];
  (Array.isArray(order)?order:[]).forEach(v=>{
    const c=parseInt(v,10);
    if(c>=1&&c<=n&&!out.includes(c))out.push(c);
  });
  for(let c=1;c<=n;c++)if(!out.includes(c))out.push(c);
  return out;
}
function _dailyCourtOrderForUse(limit){
  const count=_dailyCourtCount();
  _dailyCourtOrder=_dailyDefaultCourtOrder(count);
  const cap=limit==null?count:Math.max(0,Math.min(count,parseInt(limit)||0));
  return cap?_dailyCourtOrder.slice(0,cap):[];
}
function _dailyFreeCourts(limit){
  const used=new Set(_dailyActiveMatches().map(m=>parseInt(m.court,10)));
  return _dailyCourtOrderForUse(limit).filter(c=>!used.has(c));
}
function _dailyStartedPoolPlayers(){
  let list=_dailyPlayers.filter(p=>{
    const st=_dailyNormalizeStatus(p.status);
    return st==='wait'||st==='playing';
  });
  if(_dailyTeamMode)list=list.filter(p=>!!_dailyTeamSide(p));
  return list;
}
function _dailyStartedPoolCount(){
  return _dailyStartedPoolPlayers().length;
}
function _dailyAutoLastStartAt(players){
  return players.reduce((max,p)=>Math.max(max,p.lastStatusAt||p.waitFrom||p.joinedAt||0),0);
}
function _dailyAutoGraceLeftMs(players){
  const last=_dailyAutoLastStartAt(players);
  if(!last)return DAILY_AUTO_GRACE_MS;
  return Math.max(0,DAILY_AUTO_GRACE_MS-(_dailyNow()-last));
}
function _dailyAutoGraceLabel(ms){
  const minutes=Math.max(1,Math.ceil(ms/60000));
  return `약 ${minutes}분`;
}
function _dailyNaturalAutoInfo(){
  const courts=_dailyCourtCount();
  const started=_dailyStartedPoolPlayers();
  const pool=started.length;
  const eligible=_dailyEligible().length;
  const active=_dailyActiveMatches().length;
  const operating=_dailyOperatingInfo();
  let auto=false,operatingCourts=0,phase='waiting',label='참가 등록 대기',hint='현장 참가 등록',graceLeftMs=0;
  if(_dailyTeamLocked){
    auto=true;
    operatingCourts=courts;
    phase='team';
    label='팀전 진행';
    hint=`${courts}코트 기준으로 진행`;
  }else if(_dailyFinishMode){
    const queued=_dailyQueue.filter(q=>_dailyQueueItemValid(q,null)).length;
    if(queued){
      auto=true;
      operatingCourts=courts;
      phase='finish';
      label='마무리';
      hint=queued?`남은 대진 ${queued}경기`:'새 대진 없음';
    }else{
      phase='finished';
      label='자율게임 전환';
      hint='새 자동대진 없음 · 빈 코트 자유 사용';
    }
  }else if(!_dailyOperationStarted&&!_dailyAutoAssign){
    phase='free';
    label='자유게임';
    hint=pool>=4
      ? `${pool}명 참가 · 게시 전`
      : '현장 참가 등록';
  }else if(_dailyAutoAssign){
    auto=true;
    operatingCourts=courts;
    phase='manual';
    label='자동 운영';
    hint=`${courts}코트 기준 자동 투입`;
  }else if(active>0){
    auto=true;
    operatingCourts=courts;
    phase='active';
    label='자동 운영';
    hint=`진행 중 · ${courts}코트 기준 유지`;
  }else if(_dailyOperationStarted){
    if(pool>=4){
      auto=true;
      operatingCourts=courts;
      phase='manual';
      label='자동 운영';
      hint=`${courts}코트 기준 자동 운영`;
    }else{
      phase='started';
      label='운영 중';
      hint=`참가 ${pool}명 · 4명부터 편성`;
    }
  }else if(pool>=DAILY_AUTO_FULL_START){
    auto=true;
    operatingCourts=courts;
    phase='run';
    label='자동 운영';
    hint=phase==='run'
      ? `${courts}코트 기준 자동 흐름`
      : `${pool}명 참가 · ${courts}코트 기준`;
  }else if(pool>=DAILY_AUTO_MIN_START){
    graceLeftMs=_dailyAutoGraceLeftMs(started);
    if(graceLeftMs<=0){
      auto=true;
      operatingCourts=courts;
      phase='delayed';
      label='자연 시작';
      hint=`몸풀기 흐름 후 ${courts}코트 기준 시작`;
    }else{
      phase='grace';
      label='몸풀기 대기';
      hint=`${pool}명 참가 · ${_dailyAutoGraceLabel(graceLeftMs)} 뒤 자연 시작`;
    }
  }else if(pool>=4){
    phase='warmup';
    label='몸풀기';
    hint=`${pool}명 참가 · ${Math.max(0,DAILY_AUTO_MIN_START-pool)}명 더 필요`;
  }
  return {courts,pool,eligible,active,auto,operatingCourts,phase,label,hint,min:DAILY_AUTO_MIN_START,fullStart:DAILY_AUTO_FULL_START,graceLeftMs,operating};
}
function _dailyAutoFlowEnabled(){
  return _dailyNaturalAutoInfo().auto;
}
function _dailyAutoCourtLimit(){
  const info=_dailyNaturalAutoInfo();
  return info.auto?info.operatingCourts:0;
}
function _dailyCourtEntryHold(court){
  const target=parseInt(court,10);
  if(!target)return null;
  return _dailyMatches
    .filter(m=>m&&m.completedAt&&!m.cancelledAt&&m.officialEntryPending&&parseInt(m.officialEntryCourt||m.court,10)===target)
    .sort((a,b)=>Number(b.officialEntryPendingAt||b.completedAt||0)-Number(a.officialEntryPendingAt||a.completedAt||0))[0]||null;
}
function _dailyCourtEntryHoldId(hold){
  return hold?`${hold.id||''}:${hold.completedAt||hold.officialEntryPendingAt||''}`:'';
}
function _dailyCourtEntryHeld(court){
  return !!_dailyCourtEntryHold(court);
}
function _dailyReleaseCourtEntryHold(court,queueId){
  const target=parseInt(court,10);
  if(!target)return false;
  let changed=false;
  _dailyMatches.forEach(m=>{
    if(!m||!m.officialEntryPending||parseInt(m.officialEntryCourt||m.court,10)!==target)return;
    m.officialEntryPending=false;
    m.officialEntryStartedAt=_dailyNow();
    m.officialEntryQueueId=queueId||'';
    changed=true;
  });
  return changed;
}
function _dailyAvailableCourt(limit,options){
  const courts=_dailyCourtCount();
  const cap=limit==null?courts:Math.max(0,Math.min(courts,parseInt(limit)||0));
  if(!cap)return null;
  if(_dailyActiveMatches().length>=cap)return null;
  const used=new Set(_dailyActiveMatches().map(m=>m.court));
  for(const c of _dailyCourtOrderForUse(cap)){
    if(used.has(c))continue;
    if(options?.auto&&_dailyCourtEntryHeld(c))continue;
    return c;
  }
  return null;
}
function _dailyCourtAvailable(court,limit){
  court=parseInt(court);
  if(!court||court<1||court>_dailyCourtCount())return false;
  const cap=limit==null?_dailyCourtCount():Math.max(0,Math.min(_dailyCourtCount(),parseInt(limit)||0));
  if(!cap||_dailyActiveMatches().length>=cap)return false;
  if(limit!=null&&!_dailyCourtOrderForUse(cap).includes(court))return false;
  return !_dailyActiveMatches().some(m=>m.court===court);
}
function _dailyEligible(){
  let list=_dailyPlayers.filter(p=>DAILY_STATUS[p.status]?.eligible&&!p.currentMatchId);
  if(_dailyTeamMode)list=list.filter(p=>!!_dailyTeamSide(p));
  return list;
}
function _dailyIsDeferred(p){
  return false;
}
function _dailyStartedWaitingPlayers(){
  let list=_dailyPlayers.filter(p=>DAILY_STATUS[p.status]?.eligible&&!p.currentMatchId);
  if(_dailyTeamMode)list=list.filter(p=>!!_dailyTeamSide(p));
  return list;
}
function _dailyDeferredWaitingPlayers(){
  return [];
}
function _dailyDeferLabel(p){
  return '';
}
function _dailyQueueBaseTarget(){
  const info=_dailyNaturalAutoInfo();
  if(!info.auto)return 0;
  return Math.max(1,info.operatingCourts);
}
function _dailyQueueBoostNeeded(){
  if(!_dailyNaturalAutoInfo().auto)return false;
  const urgent=_dailyActiveMatches().filter(m=>{
    const state=_dailyTimerState(m);
    return state==='soon'||state==='due';
  }).length;
  return urgent>=2;
}
function _dailyQueueBoostAmount(){
  return _dailyQueueBoostNeeded()?1:0;
}
function _dailyQueueExtraTarget(base,flowInfo){
  const info=flowInfo||_dailyNaturalAutoInfo();
  if(!info.auto||_dailyTeamLocked)return 0;
  const baseTarget=Math.max(0,Number(base)||0);
  const maxGames=Math.floor(_dailyEligible().length/4);
  const spareGames=Math.max(0,maxGames-baseTarget);
  if(spareGames>=4)return 2;
  if(spareGames>=2)return 1;
  return 0;
}
function _dailyQueueTarget(){
  const info=_dailyNaturalAutoInfo();
  if(!info.auto)return 0;
  if(_dailyFinishMode)return _dailyQueue.length;
  const base=_dailyQueueBaseTarget();
  const boost=_dailyQueueBoostAmount();
  const extra=_dailyQueueExtraTarget(base,info);
  return Math.min((info.operatingCourts||0)+2,base+boost+extra);
}
function _dailyQueueCapacity(){
  const maxGames=Math.floor(_dailyEligible().length/4);
  const goal=_dailyQueueTarget();
  const baseGoal=_dailyQueueBaseTarget();
  const boostGoal=_dailyQueueBoostAmount();
  const extraGoal=Math.max(0,goal-baseGoal-boostGoal);
  const target=Math.min(goal,maxGames);
  return {target,maxGames,goal,baseGoal,boostGoal,extraGoal,boosted:boostGoal>0,short:maxGames<goal};
}
function _dailyExpectedQueueTarget(cap){
  const info=_dailyNaturalAutoInfo();
  if(_dailyFinishMode)return 0;
  if(!info.auto||_dailyTeamLocked)return 0;
  const c=cap||_dailyQueueCapacity();
  const projectedMaxGames=Math.floor(_dailyProjectedCandidatePlayers().length/4);
  const spare=Math.max(0,projectedMaxGames-(c.target||0));
  if(spare>=4)return 2;
  if(spare>=2)return 1;
  return 0;
}
function _dailyProjectedCandidatePlayers(){
  const candidates=[];
  const byId=new Map();
  const add=p=>{
    if(!p||byId.has(p.id))return;
    byId.set(p.id,p);
    candidates.push(p);
  };
  _dailyEligible().forEach(add);
  const activeByPlayer=new Map();
  _dailyActiveMatches()
    .slice()
    .sort((a,b)=>_dailyMatchEndAt(a)-_dailyMatchEndAt(b))
    .forEach((m,rank)=>{
      _dailyMatchPlayers(m).forEach(p=>{
        if(!p)return;
        activeByPlayer.set(p.id,{match:m,rank});
      });
    });
  _dailyPlayers.forEach(p=>{
    const active=activeByPlayer.get(p.id);
    if(!active||byId.has(p.id))return;
    if(_dailyNormalizeStatus(p.status)!=='playing'&&!p.currentMatchId)return;
    if(p.afterMatchStatus&&!DAILY_STATUS[_dailyNormalizeStatus(p.afterMatchStatus)]?.eligible)return;
    if(_dailyTeamMode&&!_dailyTeamSide(p))return;
    add({
      ...p,
      status:'wait',
      currentMatchId:null,
      games:(p.games||0)+1,
      mixedGames:(p.mixedGames||0)+(active.match.type==='혼복'?1:0),
      typeTrackedGames:(p.typeTrackedGames||0)+1,
      lastPlayedSeq:active.match.seq||p.lastPlayedSeq||_dailySeq,
      waitFrom:_dailyNow(),
      projectedActive:true,
      projectedReadyAt:_dailyMatchEndAt(active.match),
      projectedRank:active.rank
    });
  });
  return candidates;
}
function _dailyProjectedQueue(extraCount){
  const out=[],used=new Set();
  const target=_dailyQueueCapacity().target;
  const projectedCandidates=_dailyProjectedCandidatePlayers();
  _dailyQueue.slice(0,target).forEach(q=>_dailyQueueIds(q).forEach(id=>used.add(id)));
  let guard=0;
  while(out.length<extraCount&&guard++<extraCount+4){
    const q=_dailyBuildQueueItem(used,{candidates:projectedCandidates,expectedOnly:true,allowReservations:false});
    if(!q)break;
    out.push(q);
    _dailyQueueIds(q).forEach(id=>used.add(id));
  }
  return out;
}
function _dailyBalancePolicyText(flowInfo){
  const info=flowInfo||_dailyNaturalAutoInfo();
  if(!info.auto)return '밸런스 보호 중';
  const cap=_dailyQueueCapacity();
  const extra=Math.max(0,cap.extraGoal||0);
  const parts=[`${info.operatingCourts||_dailyCourtCount()}코트 기준`];
  if(extra)parts.push(`예상 +${extra}`);
  parts.push('밸런스 보호 중');
  return parts.join(' · ');
}
function _dailyCourtRecommendation(flowInfo){
  return null;
}
function _dailyQueueLockCount(){
  return _dailyQueueCapacity().target;
}
function _dailyQueueIds(q){
  return [...(q.team1||[]),...(q.team2||[])].filter(Boolean);
}
function _dailyQueuePlayers(q){
  return _dailyQueueIds(q).map(_dailyPlayer).filter(Boolean);
}
function _dailyCompactPairNames(players){
  return players.map(p=>`<span class="daily-pair-name">${_dailyNameHtml(p)}</span>`).join('');
}
function _dailyQueueMatch(q){
  const t1=(q.team1||[]).map(_dailyPlayer),t2=(q.team2||[]).map(_dailyPlayer);
  if(t1.length!==2||t2.length!==2||t1.some(p=>!p)||t2.some(p=>!p))return null;
  return {team1A:t1[0],team1B:t1[1],team2C:t2[0],team2D:t2[1],type:q.type||'예외',levelDiff:q.levelDiff||0,team1Level:q.team1Level||0,team2Level:q.team2Level||0,isFlexible:!!q.flexible,teamMode:!!q.teamMode,reservationId:q.reservationId||null,reservationLabel:q.reservationLabel||null};
}
function _dailyIsQueued(id){
  return _dailyQueue.some(q=>_dailyQueueIds(q).includes(id));
}
function _dailyIsLockedQueued(id){
  return _dailyQueue.some(q=>q.reservationId&&_dailyQueueIds(q).includes(id));
}
function _dailyQueueLabelForPlayer(id){
  const idx=_dailyQueue.findIndex(q=>_dailyQueueIds(q).includes(id));
  if(idx<0)return '';
  const q=_dailyQueue[idx];
  if(q.reservationId)return `<span class="daily-pair-badge">신청대기 ${idx+1}</span>`;
  return idx<_dailyQueueLockCount()?`<span class="daily-pair-badge">다음대진 ${idx+1}</span>`:`<span class="daily-pair-badge">대기 ${idx+1}</span>`;
}
function _dailyQueueType(t1,t2){
  const all=[...t1,...t2];
  const f=all.filter(p=>p.gender==='F').length;
  if(f===4)return '여복';
  if(f===0)return '남복';
  if(t1.filter(p=>p.gender==='F').length===1&&t2.filter(p=>p.gender==='F').length===1)return '혼복';
  return '예외';
}
function _dailyRecalcQueueItem(q){
  const t1=(q.team1||[]).map(_dailyPlayer).filter(Boolean),t2=(q.team2||[]).map(_dailyPlayer).filter(Boolean);
  if(t1.length!==2||t2.length!==2)return q;
  q.team1Level=_dailyTeamLevel(t1);
  q.team2Level=_dailyTeamLevel(t2);
  q.levelDiff=Math.round(Math.abs(q.team1Level-q.team2Level)*10)/10;
  const computedType=_dailyQueueType(t1,t2);
  q.type=(q.teamMode&&q.type==='보정')?'보정':computedType;
  q.flexible=q.type==='예외';
  q.strict=!q.flexible;
  q.score=Math.round(_dailyScoreMatch({team1A:t1[0],team1B:t1[1],team2C:t2[0],team2D:t2[1],type:computedType,levelDiff:q.levelDiff,team1Level:q.team1Level,team2Level:q.team2Level},q.strict));
  return q;
}
function _dailyQueueItemValid(q,used){
  const ids=_dailyQueueIds(q);
  if(ids.length!==4||new Set(ids).size!==4)return false;
  if(used&&ids.some(id=>used.has(id)))return false;
  const players=ids.map(_dailyPlayer);
  if(players.some(p=>!p||!DAILY_STATUS[p.status]?.eligible||p.currentMatchId))return false;
  if(!_dailyPartnerConstraintOk(players))return false;
  const t1=(q.team1||[]).map(_dailyPlayer),t2=(q.team2||[]).map(_dailyPlayer);
  if(t1.some(p=>!p)||t2.some(p=>!p))return false;
  if(_dailyTeamMode){
    if(![...t1,...t2].every(_dailyTeamSide))return false;
    if(t1[0].team!==t1[1].team||t2[0].team!==t2[1].team||t1[0].team===t2[0].team)return false;
  }
  if(!_dailyValidTeamPairing(t1,t2))return false;
  const team1Level=_dailyTeamLevel(t1);
  const team2Level=_dailyTeamLevel(t2);
  const m={team1A:t1[0],team1B:t1[1],team2C:t2[0],team2D:t2[1],levelDiff:Math.round(Math.abs(team1Level-team2Level)*10)/10,team1Level,team2Level};
  return _dailyMatchTeamBalanceOk(m)&&_dailyMatchPartnerGapOfficialOk(m);
}
function _dailyQueueFromMatch(m,score,strict){
  const q={
    id:'dq_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6),
    createdAt:_dailyNow(),
    team1:[m.team1A.id,m.team1B.id],
    team2:[m.team2C.id,m.team2D.id],
    type:m.type,
    levelDiff:m.levelDiff,
    team1Level:m.team1Level,
    team2Level:m.team2Level,
    flexible:!!m.isFlexible,
    teamMode:!!m.teamMode||!!_dailyTeamMode,
    reservationId:m.reservationId||null,
    reservationLabel:m.reservationLabel||null,
    score:Math.round(score||0),
    strict:!!strict
  };
  _dailyRecalcQueueItem(q);
  q.score=Math.round(score||q.score||0);
  q.strict=!!strict;
  return q;
}
function _dailyBuildQueueItem(excludeIds,options){
  options=options||{};
  const source=Array.isArray(options.candidates)?options.candidates:_dailyEligible();
  const projectedActiveIds=new Set(source.filter(p=>p&&p.projectedActive).map(p=>p.id));
  const baseEligible=source.filter(p=>!excludeIds.has(p.id));
  if(baseEligible.length<4)return null;
  if(options.allowReservations!==false){
    const reserved=_dailyBuildReservationQueueItem(excludeIds);
    if(reserved&&(!_dailyTeamMode||_dailyQueueItemValid(reserved,null)))return reserved;
  }
  const heldIds=_dailyReservationHeldIds();
  const eligible=baseEligible.filter(p=>!heldIds.has(p.id));
  if(eligible.length<4)return null;
  if(_dailyTeamMode){
    const b=eligible.filter(p=>p.team==='청팀').length;
    const w=eligible.filter(p=>p.team==='홍팀').length;
    if(b<2||w<2)return null;
  }
  const ranked=[...eligible].sort((a,b)=>{
    if(!!a.projectedActive!==!!b.projectedActive)return a.projectedActive?1:-1;
    if((a.projectedRank??999)!==(b.projectedRank??999))return (a.projectedRank??999)-(b.projectedRank??999);
    const priority=_dailyQueuePriorityScore(a)-_dailyQueuePriorityScore(b);
    if(priority)return priority;
    return (a.waitFrom||0)-(b.waitFrom||0);
  }).slice(0,22);
  let best=null,bestScore=Infinity,strictBest=false;
  const pick=(avoidExactRepeat)=>{
    best=null;bestScore=Infinity;strictBest=false;
    for(const four of _dailyCombos(ranked)){
      if(!_dailyPartnerConstraintOk(four))continue;
      if(avoidExactRepeat&&_dailyFourRepeatCount(four)>0)continue;
      const m=_dailyTeamMode
        ? (formTeams(four,true,'any',DAILY_TEAM_DIFF_LIMIT)||formTeams(four,true,'adjust',DAILY_TEAM_DIFF_LIMIT))
        : formTeams(four,false,'any',DAILY_TEAM_DIFF_LIMIT);
      if(!m)continue;
      if(_dailyTeamMode)m.teamMode=true;
      if(!_dailyValidTeamPairing([m.team1A,m.team1B],[m.team2C,m.team2D]))continue;
      if(!_dailyMatchTeamBalanceOk(m))continue;
      if(!_dailyMatchPartnerGapOfficialOk(m))continue;
      const score=_dailyScoreMatch(m,true);
      if(score<bestScore){best=m;bestScore=score;strictBest=true;}
    }
    if(best)return true;
    if(_dailyTeamMode)return false;
    for(const four of _dailyCombos(ranked)){
      if(!_dailyPartnerConstraintOk(four))continue;
      if(avoidExactRepeat&&_dailyFourRepeatCount(four)>0)continue;
      const m=_dailyFlexibleMatch(four);
      if(!m)continue;
      if(!_dailyMatchTeamBalanceOk(m))continue;
      const score=_dailyScoreMatch(m,false);
      if(score<bestScore){best=m;bestScore=score;strictBest=false;}
    }
    return !!best;
  };
  if(!pick(ranked.length>=8))pick(false);
  if(!best)return null;
  const q=_dailyQueueFromMatch(best,bestScore,strictBest);
  if(options.expectedOnly){
    const activeIds=_dailyQueueIds(q).filter(id=>projectedActiveIds.has(id));
    if(activeIds.length){
      q.expectedOnly=true;
      q.projectedActiveIds=activeIds;
      q.projectedDetail=DAILY_EXPECTED_DETAIL;
    }
  }
  return q;
}
function _dailyRefreshNextFromQueue(){
  _dailyNext=_dailyQueue[0]?{queueId:_dailyQueue[0].id,match:_dailyQueueMatch(_dailyQueue[0]),score:_dailyQueue[0].score,strict:_dailyQueue[0].strict,createdAt:_dailyQueue[0].createdAt,label:'1순위 대기'}:null;
}
function dailyRebuildQueue(options){
  options=options||{};
  const target=_dailyQueueCapacity().target;
  const preserveCount=Math.max(0,Math.min(options.preserveCount||0,target));
  const next=[],used=new Set();
  let changed=_dailyQueue.length!==target;
  for(const q of _dailyQueue){
    if(next.length>=target)break;
    const shouldPreserve=next.length<preserveCount||q.reservationId||(options.preserveNotified&&q.notifiedAt);
    if(!shouldPreserve)continue;
    if(!_dailyQueueItemValid(q,used)){changed=true;continue;}
    _dailyRecalcQueueItem(q);
    next.push(q);
    _dailyQueueIds(q).forEach(id=>used.add(id));
  }
  while(next.length<target){
    if(_dailyFinishMode)break;
    const q=_dailyBuildQueueItem(used);
    if(!q)break;
    next.push(q);
    _dailyQueueIds(q).forEach(id=>used.add(id));
  }
  _dailyQueue=next;
  _dailyRefreshNextFromQueue();
  return changed;
}
function dailyEnsureQueue(){
  const target=_dailyQueueCapacity().target;
  const next=[],used=new Set();
  let changed=_dailyQueue.length!==Math.min(_dailyQueue.length,target);
  for(const q of _dailyQueue){
    if(next.length>=target)break;
    if(!_dailyQueueItemValid(q,used)){changed=true;continue;}
    _dailyRecalcQueueItem(q);
    next.push(q);
    _dailyQueueIds(q).forEach(id=>used.add(id));
  }
  _dailyQueue=next;
  if(!_dailyFinishMode&&_dailyApplyReservationsToExistingQueue())changed=true;
  used.clear();
  _dailyQueue.forEach(q=>_dailyQueueIds(q).forEach(id=>used.add(id)));
  while(_dailyQueue.length<target){
    if(_dailyFinishMode)break;
    const q=_dailyBuildReservationQueueItem(used)||_dailyBuildQueueItem(used);
    if(!q)break;
    _dailyQueue.push(q);
    _dailyQueueIds(q).forEach(id=>used.add(id));
    changed=true;
  }
  if(_dailyEmergencyEditQueueId&&!_dailyQueue.some(q=>q.id===_dailyEmergencyEditQueueId))_dailyEmergencyEditQueueId=null;
  _dailyRefreshNextFromQueue();
  return changed;
}
function _dailyPersistedCompleteUndo(){
  const undo=_dailyLastCompleteUndo;
  if(!undo||!undo.token||!undo.state||_dailyNow()>=Number(undo.expiresAt||0))return null;
  return JSON.parse(JSON.stringify(undo));
}
function dailySave(){
  try{
    _dailyClearSimpleTeamState();
    if(!_dailyPaused)dailyEnsureQueue();
    localStorage.setItem(DAILY_KEY,JSON.stringify({
      mode:'daily',
      appMode:'dailyLive',
      savedAt:_dailyNow(),
      courts:document.getElementById('dailyCourts')?.value||3,
      autoAssign:_dailyAutoAssign,
      operationStarted:_dailyOperationStarted,
      finishMode:_dailyFinishMode,
      finishStartedAt:_dailyFinishStartedAt,
      paused:_dailyPaused,
      pausedAt:_dailyPausedAt,
      pauseReason:_dailyPauseReason,
      pauseRevision:_dailyPauseRevision,
      resumedAt:_dailyResumedAt,
      teamMode:false,
      teamLocked:false,
      teamNames:{...teamNames},
      captains:JSON.parse(JSON.stringify(captains)),
      closing:false,
      closingAt:'',
      voteDeadlineAt:_dailyVoteDeadlineAt,
      operatingStart:_dailyStartTime,
      operatingEnd:_dailyEndTime,
      courtOrder:_dailyDefaultCourtOrder(_dailyCourtCount()),
      players:_dailyPlayers,
      matches:_dailyMatches,
      queue:_dailyQueue,
      reservations:_dailyReservations,
      seq:_dailySeq,
      waveStarts:_dailyWaveStarts,
      checkinId:_dailyCheckinId,
      checkinCreatedAt:_dailyCheckinCreatedAt,
      serverRevision:_dailyServerRevision,
      officialInviteToken:_dailyOfficialInviteToken,
      officialInviteHash:_dailyOfficialInviteHash,
      lastCompleteUndo:_dailyPersistedCompleteUndo()
    }));
    dailyPushCheckinSession();
  }catch(e){console.warn('daily save 실패',e);}
}
function _dailySameLocalDay(a,b){
  const da=new Date(a),db=new Date(b);
  return da.getFullYear()===db.getFullYear()&&da.getMonth()===db.getMonth()&&da.getDate()===db.getDate();
}
function _dailyCanResumeCrossDay(s,now){
  if(!s||!s.savedAt)return false;
  const age=now-Number(s.savedAt||0);
  if(age<0||age>DAILY_CROSS_DAY_RESUME_MS)return false;
  const players=(s.players||[]).filter(p=>p&&p.name);
  const active=(s.matches||[]).some(m=>m&&!m.completedAt&&!m.cancelledAt);
  const queued=(s.queue||[]).length>0;
  return !!(players.length&&(s.operationStarted||s.checkinId||active||queued));
}
function _dailySavedDateLabel(ts){
  if(!ts)return '이전';
  return new Date(ts).toLocaleDateString('ko-KR',{month:'numeric',day:'numeric',weekday:'short'});
}
function _dailySyncControls(courts){
  const c=document.getElementById('dailyCourts');
  if(c)c.value=courts||3;
  _dailyCourtOrder=_dailyDefaultCourtOrder(courts||3);
  const autoEl=document.getElementById('dailyAutoAssign');
  if(autoEl)autoEl.checked=_dailyAutoAssign;
  const autoTopEl=document.getElementById('dailyAutoAssignTop');
  if(autoTopEl)autoTopEl.checked=_dailyAutoAssign;
  const voteEl=document.getElementById('dailyVoteDeadlineAt');
  if(voteEl)voteEl.value=_dailyVoteDeadlineAt||'';
  const startEl=document.getElementById('dailyStartTime');
  if(startEl)startEl.value=_dailyStartTime||'19:00';
  const endEl=document.getElementById('dailyEndTime');
  if(endEl)endEl.value=_dailyEndTime||'22:00';
  dailyRenderCourtSettings();
}
function dailyRenderCourtSettings(){
  _dailyCourtOrder=_dailyDefaultCourtOrder(_dailyCourtCount());
}
function _dailyLoadAsNewDay(s){
  const now=_dailyNow();
  const staleCheckinId=s.checkinId||localStorage.getItem(DAILY_CHECKIN_KEY)||'';
  _dailyPlayers=(s.players||[]).map(_dailyNormalize).filter(p=>p.name).map(p=>({
    ...p,
    status:'invited',
    joinedAt:now,
    waitFrom:now,
    lastStatusAt:now,
    games:0,
    mixedGames:0,
    typeTrackedGames:0,
    lastPlayedSeq:0,
    partnerCount:{},
    opponentCount:{},
    currentMatchId:null,
    afterMatchStatus:null
  }));
  _dailyMatches=[];_dailyNext=null;_dailyQueue=[];_dailyReservations=[];_dailySeq=1;_dailyWaveStarts=0;
  _dailyAutoAssign=false;_dailyOperationStarted=false;_dailyFinishMode=false;_dailyFinishStartedAt=0;_dailyPaused=false;_dailyPausedAt=0;_dailyPauseReason='';_dailyPauseRevision=0;_dailyResumedAt=0;_dailyTeamMode=false;_dailyTeamLocked=false;
  _dailyVoteDeadlineAt='';
  _dailyStartTime=s.operatingStart||_dailyStartTime||'19:00';
  _dailyEndTime=s.operatingEnd||_dailyEndTime||'22:00';
  _dailyCourtOrder=_dailyDefaultCourtOrder(s.courts||3);
  captains={blue:{leader:'',sub:''},white:{leader:'',sub:''}};
  _dailyPairSelectId=null;
  _dailyStopCheckinListener();
  if(staleCheckinId&&_fbInit())_fbDb.ref('live/checkin_'+staleCheckinId).remove().catch(()=>{});
  _dailyClearAdminGrant();
  _dailyCheckinId=null;_dailyCheckinCreatedAt=0;_dailyCheckinRequests=[];_dailyCheckinParty={};
  _dailyServerRevision=0;_dailyOfficialInviteToken='';_dailyOfficialInviteHash='';_dailyCapabilityPromise=null;_dailyServerReconcileError='';
  localStorage.removeItem(DAILY_CHECKIN_KEY);
  localStorage.removeItem(DAILY_CHECKIN_CREATED_KEY);
  _dailyMarkFourCacheDirty();
  _dailySyncControls(s.courts||3);
  localStorage.removeItem(DAILY_KEY);
  dailySave();
}
function dailyLoad(){
  try{
    const raw=localStorage.getItem(DAILY_KEY);
    if(!raw)return;
    const s=JSON.parse(raw);
    if(s.mode&&s.mode!=='daily'&&s.appMode!=='dailyLive'){
      localStorage.removeItem(DAILY_KEY);
      return;
    }
    const now=_dailyNow();
    if(s.savedAt&&!_dailySameLocalDay(s.savedAt,now)&&!_dailyCanResumeCrossDay(s,now)){
      _dailyLoadAsNewDay(s);
      return;
    }
    _dailyPlayers=(s.players||[]).map(_dailyNormalize).filter(p=>p.name);
    _dailyMatches=s.matches||[];
    _dailyRebuildLiveTypeCounts();
    _dailyQueue=s.queue||[];
    _dailyReservations=(s.reservations||[]).filter(r=>r&&r.id);
    _dailySeq=s.seq||((_dailyMatches.reduce((m,x)=>Math.max(m,x.seq||0),0))+1);
    _dailyWaveStarts=s.waveStarts||0;
    _dailyAutoAssign=false;
    _dailyOperationStarted=s.operationStarted!=null?!!s.operationStarted:!!((_dailyMatches||[]).length||(_dailyQueue||[]).length);
    _dailyFinishMode=!!s.finishMode;
    _dailyFinishStartedAt=parseInt(s.finishStartedAt||'0',10)||0;
    _dailyPaused=!!s.paused;
    _dailyPausedAt=_dailyPaused?(parseInt(s.pausedAt||'0',10)||now):0;
    _dailyPauseReason=_dailyPaused?String(s.pauseReason||DAILY_PAUSE_REASON):'';
    _dailyPauseRevision=Math.max(0,Number(s.pauseRevision||0));
    _dailyResumedAt=Math.max(0,Number(s.resumedAt||0));
    _dailyTeamMode=false;
    _dailyTeamLocked=false;
    if(s.teamNames){
      teamNames={...teamNames,...s.teamNames};
      if(teamNames.white==='백 팀'||teamNames.white==='백팀')teamNames.white='홍 팀';
    }
    if(s.captains)captains=s.captains;
    _dailyEnsureCaptains();
    _dailyCleanCaptains();
    _dailyClearSimpleTeamState();
    _dailyVoteDeadlineAt=s.voteDeadlineAt||'';
    _dailyStartTime=s.operatingStart||'19:00';
    _dailyEndTime=s.operatingEnd||'22:00';
    _dailyCourtOrder=_dailyDefaultCourtOrder(s.courts||3);
    _dailyCheckinId=s.checkinId||localStorage.getItem(DAILY_CHECKIN_KEY)||null;
    _dailyCheckinCreatedAt=s.checkinCreatedAt||parseInt(localStorage.getItem(DAILY_CHECKIN_CREATED_KEY)||'0',10)||(_dailyCheckinId?(s.savedAt||_dailyNow()):0);
    _dailyServerRevision=Math.max(0,Number(s.serverRevision||0));
    _dailyOfficialInviteToken=String(s.officialInviteToken||'');
    _dailyOfficialInviteHash=String(s.officialInviteHash||'');
    _dailyServerReconcileError='';
    const savedUndo=s.lastCompleteUndo;
    _dailyLastCompleteUndo=savedUndo&&savedUndo.token&&savedUndo.state&&Number(savedUndo.expiresAt||0)>now
      ?JSON.parse(JSON.stringify(savedUndo))
      :null;
    if(_dailyCheckinId){
      localStorage.setItem(DAILY_CHECKIN_KEY,_dailyCheckinId);
      if(_dailyCheckinCreatedAt)localStorage.setItem(DAILY_CHECKIN_CREATED_KEY,String(_dailyCheckinCreatedAt));
    }
    if(_dailyCheckinExpired())_dailyExpireCheckinLink(true);
    _dailyMarkFourCacheDirty();
    _dailySyncControls(s.courts||3);
  }catch(e){console.warn('daily load 실패',e);}
}
function dailyApplyReviewSample(){
  const params=new URLSearchParams(location.search);
  if(!params.has('sample'))return;
  const now=_dailyNow();
  const names=['김병주','김민선','금민경','김종길','김미정','최경민','박대현','박지은','최애랑','조태환','이현','현지영','정인기','조병훈','백철민','김재관','이성원','송은정','장세훈','윤성호','안세원','김민정','이준원','이은하'];
  const genders=['M','F','F','M','F','F','M','F','F','M','M','F','M','M','M','M','M','F','M','M','M','F','M','F'];
  const grades=['B','A','A','B','B','C','A','C','A','C','C','B','A','C','B','C','A','B','A','B','B','A','B','A'];
  _dailyPlayers=names.map((name,i)=>_dailyNormalize({
    id:'s'+(i+1),
    name,
    gender:genders[i],
    grade:grades[i],
    level:grades[i]==='A'?5:grades[i]==='B'?4:3,
    ageGroup:'40대',
    isGuest:i>=22,
    status:i<12?'playing':(i<22?'wait':'invited'),
    joinedAt:now-60*60*1000+i*60000,
    waitFrom:now-30*60*1000+i*45000,
    lastStatusAt:now-20*60*1000+i*30000,
    games:i%5,
    lastPlayedSeq:i%4,
    currentMatchId:i<4?'dm1':i<8?'dm2':i<12?'dm3':null
  }));
  const p=id=>_dailyPlayer(id);
  const match=(id,court,seq,ids,remain,type)=>({
    id,court,seq,type,teamMode:false,
    startedAt:now-(15-remain)*60000,
    durationMin:15,
    completedAt:null,
    cancelledAt:null,
    team1:ids.slice(0,2),
    team2:ids.slice(2,4),
    team1A:p(ids[0]),team1B:p(ids[1]),team2C:p(ids[2]),team2D:p(ids[3]),
    levelDiff:.8
  });
  const queue=(id,ids,score,type)=>({
    id,teamMode:false,type,score,strict:true,createdAt:now,
    team1A:p(ids[0]),team1B:p(ids[1]),team2C:p(ids[2]),team2D:p(ids[3])
  });
  _dailyMatches=[
    match('dm1',1,1,['s1','s2','s3','s4'],5,'혼복'),
    match('dm2',2,2,['s5','s6','s7','s8'],8,'혼복'),
    match('dm3',3,3,['s9','s10','s11','s12'],11,'남복')
  ];
  _dailyQueue=[
    queue('dq1',['s13','s14','s15','s16'],95,'남복'),
    queue('dq2',['s17','s18','s19','s20'],91,'혼복'),
    queue('dq3',['s21','s22','s23','s24'],88,'혼복')
  ];
  _dailyReservations=[];
  _dailySeq=7;
  _dailyWaveStarts=3;
  _dailyAutoAssign=false;
  _dailyOperationStarted=true;
  _dailyFinishMode=false;
  _dailyFinishStartedAt=0;
  _dailyPaused=false;
  _dailyPausedAt=0;
  _dailyPauseReason='';
  _dailyPauseRevision=0;
  _dailyResumedAt=0;
  _dailyTeamMode=false;
  _dailyTeamLocked=false;
  _dailyVoteDeadlineAt='';
  _dailyStartTime='19:00';
  _dailyEndTime='22:00';
  _dailyCourtOrder=[1,2,3];
  _dailyStopCheckinListener();
  _dailyCheckinId='DFAKE201';
  _dailyCheckinCreatedAt=now;
  _dailyServerRevision=0;
  _dailyOfficialInviteToken='';
  _dailyOfficialInviteHash='';
  _dailyServerReconcileError='';
  _dailyCheckinRequests=[];
  _dailyCheckinParty={};
  _dailyLastCompleteUndo=null;
  _dailyMarkFourCacheDirty();
  _dailySyncControls(3);
  localStorage.setItem(DAILY_CHECKIN_KEY,_dailyCheckinId);
  localStorage.setItem(DAILY_CHECKIN_CREATED_KEY,String(_dailyCheckinCreatedAt));
}
function dailyStepCourts(delta){
  if(_dailyBlockPaused({action:'코트 설정을 변경'}))return;
  const el=document.getElementById('dailyCourts');
  if(!el)return;
  el.value=Math.max(1,Math.min(12,(parseInt(el.value)||3)+delta));
  _dailyCourtOrder=_dailyDefaultCourtOrder(parseInt(el.value)||3);
  _dailySyncControls(parseInt(el.value)||3);
  dailySave();
  dailyRender();
  dailyMaybeAutoAssign();
}
function dailyUpdateOperatingHours(){
  if(_dailyBlockPaused({action:'운영 시간을 변경'}))return;
  const startEl=document.getElementById('dailyStartTime');
  const endEl=document.getElementById('dailyEndTime');
  _dailyStartTime=_dailyNormalizeTimeValue(startEl?.value,'19:00');
  _dailyEndTime=_dailyNormalizeTimeValue(endEl?.value,'22:00');
  _dailySyncControls(_dailyCourtCount());
  dailyEnsureQueue();
  dailySave();
  dailyRender();
  dailyMaybeAutoAssign();
}
function dailyAddPlayer(){
  if(!_dailyCanChangeRoster())return;
  const nameEl=document.getElementById('dailyName');
  const name=(nameEl?.value||'').trim();
  if(!name){nameEl?.focus();return;}
  if(_dailyPlayers.some(p=>p.name===name)){
    alert('민턴LIVE 명단에 이미 있는 선수입니다.');
    nameEl.select();return;
  }
  const grade=document.getElementById('dailyGrade')?.value||'C';
  const gender=document.getElementById('dailyGender')?.value||'남';
  const ageGroup=document.getElementById('dailyAge')?.value||'40대';
  _dailyPlayers.push(_dailyNormalize({name,grade,gender,ageGroup,isGuest:_dailyIsGuest}));
  _dailyNext=null;
  if(_dailyIsGuest)toggleDailyGuestMode(false);
  nameEl.value='';
  nameEl.focus();
  dailySave();
  dailyRender();
  dailyMaybeAutoAssign();
}
function dailyImportDirect(){
  if(!_dailyCanChangeRoster())return;
  if(!_directPlayers.length){
    alert('기존 대진표 참가자 입력에 선수를 먼저 추가하거나, 민턴LIVE에서 직접 추가하세요.');
    return;
  }
  let added=0;
  _directPlayers.forEach(p=>{
    if(!p.name||_dailyPlayers.some(x=>x.name===p.name))return;
    _dailyPlayers.push(_dailyNormalize({...p,status:'wait'}));
    added++;
  });
  if(added)_dailyNext=null;
  dailySave();dailyRender();
  dailyMaybeAutoAssign();
  alert(added?`${added}명을 오늘 현장 참가자로 등록했습니다.`:'기존 참가자에서 새로 등록할 선수가 없습니다.');
}
function dailyImportRoster(){
  if(!_dailyCanChangeRoster())return;
  loadRosters();
  const clubs=(rosters.clubs||[]).filter(c=>(c.members||[]).length);
  if(!clubs.length){alert('명부에 등록된 회원이 없습니다.');return;}
  _dailyImportClubIdx=Math.max(0,(rosters.clubs||[]).findIndex(c=>(c.members||[]).length));
  _dailyImportSort='reg';
  const memberList=document.getElementById('dailyImportMemberList');
  if(memberList)memberList.innerHTML='';
  renderDailyImportTabs();
  renderDailyImportMembers();
  document.getElementById('dailyImportModal').classList.remove('hidden');
}
function _dailyApplyPlayerStatus(p,status,operationAt){
  status=_dailyNormalizeStatus(status);
  const previous=_dailyNormalizeStatus(p.status);
  const newlyArrived=status==='wait'&&(previous==='invited'||previous==='planned');
  const now=Number(operationAt)||_dailyNow();
  if(newlyArrived){
    p.joinedAt=now;
    p.arrivalConfirmedBy='';
    p.arrivalConfirmedByName='';
    p.arrivalConfirmedAt=0;
    p.arrivalConfirmedSource='';
    p.arrivalRequestKey='';
  }
  p.status=status;
  p.afterMatchStatus=null;
  p.deferUntil=0;
  p.deferReason='';
  p.lastStatusAt=now;
  p.restPausedMs=0;
  if(status==='wait') p.waitFrom=now;
  if(status==='done'||status==='rest'||status==='planned'||status==='invited') p.currentMatchId=null;
  _dailyNext=null;
  if(newlyArrived&&!_dailyFinishMode&&_dailyLatePriorityInfo(p).late){
    dailyRebuildQueue({preserveCount:1,preserveNotified:true});
  }
}
function _dailySetAfterMatchStatus(p,status,operationAt){
  if(!p||(p.status!=='playing'&&!p.currentMatchId))return false;
  const nextStatus=_dailyNormalizeStatus(status);
  if(!['rest','done'].includes(nextStatus))return false;
  const clearing=p.afterMatchStatus===nextStatus;
  p.afterMatchStatus=clearing?null:nextStatus;
  if(!clearing){
    _dailyCancelReservationsForPlayer(p.id,`${p.name}님의 경기 후 ${_dailyCheckinStatusLabel(nextStatus)} 예정으로 게임신청이 자동 취소됐습니다.`,'after-match-status');
  }
  p.lastStatusAt=Number(operationAt)||_dailyNow();
  _dailyNext=null;
  return true;
}
function _dailyApplyQueueYield(playerId,queueId,source,options){
  dailyEnsureQueue();
  let idx=_dailyQueue.findIndex(q=>String(q.id||'')===String(queueId||'')&&_dailyQueueIds(q).includes(playerId));
  if(idx<0&&!options?.strict)idx=_dailyQueue.findIndex(q=>_dailyQueueIds(q).includes(playerId));
  if(idx<0)return {ok:false,reason:'뒤로 보낼 다음 대진을 찾지 못했습니다.'};
  const requestedTarget=Number(options?.targetQueueIndex||idx+2);
  if(!Number.isInteger(requestedTarget)||requestedTarget<=idx+1||requestedTarget>_dailyQueue.length)return {ok:false,reason:'이동할 다음 대진 순번이 올바르지 않습니다.'};
  const targetIdx=requestedTarget-1;
  const item=_dailyQueue.splice(idx,1)[0];
  let promotedQueueId='';
  if(options?.expectedCueState==='free'){
    const promoted=_dailyQueue[idx]||null;
    const promotedInfo=_dailyQueueStartInfo(idx);
    const sameCourt=Number(promotedInfo.court||0)===Number(options.expectedTargetCourt||0);
    const sameHold=String(promotedInfo.holdId||'')===String(options.expectedHoldId||'');
    if(!promoted||promotedInfo.state!=='free'||!sameCourt||!sameHold){
      _dailyQueue.splice(idx,0,item);
      return {ok:false,reason:'다음 대진이 같은 빈 코트 입장 순서를 이어받지 못했습니다.'};
    }
    promotedQueueId=promoted.id||'';
  }
  const operationAt=Number(options?.operationAt)||_dailyNow();
  item.yieldedAt=operationAt;
  item.yieldedBy=options?.yieldedBy||playerId;
  item.yieldedSource=source||'member';
  item.yieldedCount=Number(item.yieldedCount||0)+1;
  item.yieldedSteps=targetIdx-idx;
  item.yieldedFromIndex=idx+1;
  item.yieldedToIndex=targetIdx+1;
  if(options?.expectedCueState==='free'){
    item.yieldedHeldCourt=Number(options.expectedTargetCourt)||null;
    item.yieldedHoldId=options.expectedHoldId||'';
    item.yieldedPromotedQueueId=promotedQueueId;
  }
  if(options?.clearRestPass&&item.restPass){
    item.restPassClearedAt=operationAt;
    item.restPassClearReason='club-official-queue-yield';
    delete item.restPass;
  }
  _dailyQueue.splice(targetIdx,0,item);
  _dailyNext=null;
  return {ok:true,fromIndex:idx+1,toIndex:targetIdx+1,moveBy:targetIdx-idx,promotedQueueId,heldCourt:item.yieldedHeldCourt||null};
}
function _dailyApplyQueueDefer(playerId,source,queueId){
  return _dailyApplyQueueYield(playerId,queueId,source).ok;
}
function _dailyMemberQueueYieldError(req){
  const now=_dailyNow();
  if((req.expiresAt&&now>Number(req.expiresAt))||now-Number(req.createdAt||0)>DAILY_OFFICIAL_REQUEST_TTL_MS)return '뒤로 미루기 요청 시간이 지나 현재 대진을 다시 확인해야 합니다.';
  const idx=_dailyQueue.findIndex(q=>String(q.id||'')===String(req.queueId||''));
  if(idx<0)return '뒤로 보낼 다음 대진을 찾지 못했습니다.';
  const q=_dailyQueue[idx];
  const ids=_dailyQueueIds(q);
  if(!ids.includes(req.playerId))return '본인이 포함된 다음 대진만 뒤로 보낼 수 있습니다.';
  const expectedIndex=Number(req.expectedQueueIndex||req.queueIndex||0);
  if(!expectedIndex||expectedIndex!==idx+1)return '다음 대진 순서가 이미 바뀌었습니다.';
  if(Object.prototype.hasOwnProperty.call(req,'expectedPlayerIds')){
    if(!Array.isArray(req.expectedPlayerIds)||req.expectedPlayerIds.length!==4)return '다음 대진 선수를 다시 확인해야 합니다.';
    if(_dailyOfficialFingerprint(req.expectedPlayerIds)!==_dailyOfficialFingerprint(ids))return '다음 대진 선수가 이미 바뀌었습니다.';
  }
  if(Object.prototype.hasOwnProperty.call(req,'expectedTeam1Ids')||Object.prototype.hasOwnProperty.call(req,'expectedTeam2Ids')){
    if(!Array.isArray(req.expectedTeam1Ids)||req.expectedTeam1Ids.length!==2||!Array.isArray(req.expectedTeam2Ids)||req.expectedTeam2Ids.length!==2)return '다음 대진 팀 구성을 다시 확인해야 합니다.';
    if(_dailyOfficialTeamFingerprint(req.expectedTeam1Ids,req.expectedTeam2Ids)!==_dailyOfficialTeamFingerprint(q.team1,q.team2))return '다음 대진 팀 구성이 이미 바뀌었습니다.';
  }
  if(_dailyQueueRestPassActive(q))return '이미 조금 쉬고 처리된 대진입니다.';
  if(idx>=_dailyQueue.length-1)return '뒤에 보낼 다음 대진이 없습니다.';
  if(!_dailyQueueItemValid(q,null))return '다음 대진 선수 상태가 바뀌었습니다.';
  const info=_dailyQueueStartInfo(idx);
  if(info.state==='free'&&info.court)return '빈 코트 입장 단계에서는 조금 쉬고 처리를 이용해야 합니다.';
  return '';
}
function _dailyApplyQueueRestPass(playerId,queueId,court){
  dailyEnsureQueue();
  const idx=_dailyQueue.findIndex(q=>String(q.id||'')===String(queueId||'')&&_dailyQueueIds(q).includes(playerId));
  if(idx<0)return {ok:false,reason:'조금 쉬고 입장할 다음 대진을 찾지 못했습니다.'};
  const q=_dailyQueue[idx];
  if(!_dailyQueueItemValid(q,null))return {ok:false,reason:'다음 대진 선수 상태가 바뀌었습니다.'};
  const info=_dailyQueueStartInfo(idx);
  const requestedCourt=parseInt(court,10)||null;
  const targetCourt=requestedCourt||parseInt(info.court,10)||null;
  if(info.state!=='free'||!targetCourt||!_dailyCourtAvailable(targetCourt,null)||parseInt(info.court,10)!==targetCourt){
    return {ok:false,reason:'지금 비어 있는 코트가 있을 때만 조금 쉬고 입장할 수 있습니다.'};
  }
  q.restPass={
    playerId,
    playerName:_dailyPlayer(playerId)?.name||'',
    court:targetCourt,
    createdAt:_dailyNow()
  };
  _dailyNext=null;
  return {ok:true};
}
function _dailyFreeCourtRequestError(req){
  const idx=_dailyQueue.findIndex(x=>String(x.id||'')===String(req.queueId||''));
  if(idx<0)return '다음 대진을 찾지 못했습니다.';
  const q=_dailyQueue[idx];
  if(!_dailyQueueIds(q).includes(req.playerId))return '다음 대진 선수만 입장 처리할 수 있습니다.';
  if(!_dailyQueueItemValid(q,null))return '다음 대진 선수 상태가 바뀌었습니다.';
  const court=parseInt(req.court,10);
  if(!court||!_dailyCourtAvailable(court,null))return '입장할 빈 코트를 찾지 못했습니다.';
  const info=_dailyQueueStartInfo(idx);
  if(info.state!=='free'||parseInt(info.court,10)!==court)return '현재 이 대진에 배정된 빈 코트가 아닙니다.';
  return '';
}
function dailySetStatus(id,status){
  if(_dailyBlockPaused({action:'선수 상태를 변경'}))return;
  const p=_dailyPlayer(id);
  if(!p)return;
  const nextStatus=_dailyNormalizeStatus(status);
  if(p.status==='playing'||p.currentMatchId){
    if(!_dailySetAfterMatchStatus(p,nextStatus)){
      alert('경기중에는 경기 후 휴식 또는 경기 후 종료만 표시할 수 있습니다.');
    }
    dailySave();dailyRender();
    return;
  }
  const nextLabel=_dailyCheckinStatusLabel(nextStatus);
  if(!DAILY_STATUS[nextStatus]?.eligible){
    _dailyCancelReservationsForPlayer(id,`${p.name}님이 ${nextLabel} 상태로 바뀌어 게임신청이 자동 취소됐습니다.`,'admin-status-change');
    if(_dailyIsQueued(id)){
      if(!_dailyTryReplaceQueuedPlayer(id,`${p.name}님이 ${nextLabel} 상태로 바뀌어 신청 대기표가 자동 조정됐습니다.`))_dailyRemoveQueuedPlayer(id,`${p.name}님이 ${nextLabel} 상태로 바뀌어 신청 대기표가 자동 취소됐습니다.`);
    }
  }
  _dailyApplyPlayerStatus(p,nextStatus);
  _dailyPromoteReadyReservations(true);
  dailySave();dailyRender();
  dailyMaybeAutoAssign();
}
function dailyStartPair(id){
  if(_dailyBlockPaused({action:'파트너를 지정'}))return;
  const p=_dailyPlayer(id);
  if(!p||p.status==='playing')return;
  if(p.partnerName){dailyClearPair(id);return;}
  _dailyPairSelectId=id;
  dailyRender();
}
function dailyCancelPair(){
  _dailyPairSelectId=null;
  dailyRender();
}
function dailyConfirmPair(id){
  if(_dailyBlockPaused({action:'파트너를 지정'}))return;
  const a=_dailyPlayer(_dailyPairSelectId);
  const b=_dailyPlayer(id);
  if(!a||!b||a.id===b.id){dailyCancelPair();return;}
  if(a.currentMatchId||b.currentMatchId){
    alert('경기중 선수는 경기 완료 또는 취소 후 묶을 수 있습니다.');
    dailyCancelPair();return;
  }
  if(a.partnerName||b.partnerName){
    alert('이미 게임신청이 있는 선수가 포함되어 있습니다. 먼저 신청을 정리해 주세요.');
    dailyCancelPair();return;
  }
  const pairId='dpair_'+Date.now().toString(36);
  a.partnerName=b.name;a.partnerId=pairId;
  b.partnerName=a.name;b.partnerId=pairId;
  _dailyPairSelectId=null;
  _dailyNext=null;
  dailySave();dailyRender();dailyRecommend();
}
function dailyClearPair(id){
  if(_dailyBlockPaused({action:'파트너 지정을 해제'}))return;
  const p=_dailyPlayer(id);
  if(!p)return;
  const partner=_dailyPlayers.find(x=>(p.partnerId&&x.partnerId===p.partnerId)||x.name===p.partnerName);
  if(partner&&partner.id!==p.id){
    partner.partnerName=null;
    partner.partnerId=null;
  }
  p.partnerName=null;
  p.partnerId=null;
  _dailyPairSelectId=null;
  _dailyNext=null;
  dailySave();dailyRender();dailyRecommend();
}
function dailyAddReservation(){
  if(_dailyBlockPaused({action:'게임신청을 등록'}))return;
  const mode=document.getElementById('dailyReservationType')?.value||'pair';
  const a1=document.getElementById('dailyResA1')?.value||'';
  const a2=document.getElementById('dailyResA2')?.value||'';
  const b1=mode==='match'?(document.getElementById('dailyResB1')?.value||''):'';
  const b2=mode==='match'?(document.getElementById('dailyResB2')?.value||''):'';
  const team1=[a1,a2].filter(Boolean);
  const team2=[b1,b2].filter(Boolean);
  const ids=[...team1,...team2];
  if(team1.length!==2||new Set(team1).size!==2){
    alert('A팀에 서로 다른 선수 2명을 선택해 주세요.');
    return;
  }
  if(mode==='match'&&(team2.length!==2||new Set(ids).size!==4)){
    alert('4명 경기 신청은 A팀 2명, B팀 2명을 모두 다르게 선택해야 합니다.');
    return;
  }
  if(_dailyReservationPlayerConflict(ids)){
    alert('이미 게임신청이 있는 선수가 포함되어 있습니다. 먼저 신청을 정리해 주세요.');
    return;
  }
  if(_dailyReservationPairConflict(team1,team2)){
    alert('기존 게임신청과 충돌합니다. 먼저 신청을 정리해 주세요.');
    return;
  }
  const note=(document.getElementById('dailyResNote')?.value||'').trim();
  _dailyReservations.push({
    id:'dres_'+_dailyNow().toString(36)+'_'+Math.random().toString(36).slice(2,5),
    mode,team1,team2,note,createdAt:_dailyNow()
  });
  ['dailyResA1','dailyResA2','dailyResB1','dailyResB2'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const noteEl=document.getElementById('dailyResNote');
  if(noteEl)noteEl.value='';
  const reservedIds=_dailyReservationIds(_dailyReservations[_dailyReservations.length-1]);
  _dailyReleaseTemporaryQueueForReservationIds(reservedIds);
  dailySave();dailyRender();
}
function dailyDeleteReservation(id){
  if(_dailyBlockPaused({action:'게임신청을 취소'}))return;
  _dailyReservations=_dailyReservations.filter(r=>r.id!==id);
  _dailyQueue=_dailyQueue.filter(q=>q.reservationId!==id);
  dailySave();dailyRender();
}
function dailyPromoteReservation(id){
  if(_dailyBlockPaused({action:'게임신청을 대진에 반영'}))return;
  const locked=_dailyQueue.filter(q=>q.reservationId&&q.reservationId!==id);
  const lockedIds=new Set();
  locked.forEach(q=>_dailyQueueIds(q).forEach(pid=>lockedIds.add(pid)));
  const q=_dailyBuildReservationQueueItem(lockedIds,id);
  if(!q){
    alert('아직 게임신청을 반영할 수 없습니다. 신청 선수가 모두 참가 상태인지 확인해 주세요.');
    return;
  }
  const ids=new Set(_dailyQueueIds(q));
  const lockedQueueIds=new Set(locked.map(item=>item.id));
  const flex=_dailyQueue
    .filter(item=>item.reservationId!==id&&!lockedQueueIds.has(item.id)&&!_dailyQueueIds(item).some(pid=>ids.has(pid)));
  _dailyQueue=[...locked,q,...flex].slice(0,_dailyQueueCapacity().target);
  _dailyRefreshNextFromQueue();
  dailySave();dailyRender();
}
function dailyRenderReservations(){
  _dailyReservationPlayerSelects();
  const box=document.getElementById('dailyReservationBox');
  if(!box)return;
  if(!_dailyReservations.length){
    box.className='daily-empty';
    box.textContent='게임신청이 없습니다.';
    return;
  }
  box.className='daily-res-list';
  box.innerHTML=_dailyReservations.map(r=>{
    const st=_dailyReservationStatus(r);
    const a=_dailyReservationNames(r.team1||[]);
    const b=r.mode==='match'?_dailyReservationNames(r.team2||[]):['상대 자동 배정'];
    const type=r.mode==='match'?'4명 경기 신청':'같은 편 신청';
    const note=r.note?` · ${r.note}`:'';
    return `<div class="daily-res-card ${st.cls}">
      <div class="daily-res-head">
        <div>
          <div class="daily-res-title">${esc(type)} · ${esc(st.text)}</div>
          <div class="daily-res-meta">${esc(_dailyReservationLabel(r))}${esc(note)}</div>
        </div>
        <div class="daily-queue-actions">
          ${st.ready?`<button class="daily-mini-btn" onclick="dailyPromoteReservation('${r.id}')">수동 반영</button>`:''}
          <button class="daily-mini-btn danger" onclick="dailyDeleteReservation('${r.id}')">삭제</button>
        </div>
      </div>
      <div class="daily-res-body">
        <div class="daily-res-team">A팀<br>${a.map(esc).join('<br>')}</div>
        <div class="daily-res-vs">VS</div>
        <div class="daily-res-team b">B팀<br>${b.map(esc).join('<br>')}</div>
      </div>
    </div>`;
  }).join('');
}
function setDailyPlayerSort(mode){
  _dailyPlayerSort=['status','name','gender'].includes(mode)?mode:'status';
  dailyRender();
}
function setDailyPlayerSearch(value){
  _dailyPlayerSearch=String(value||'').trim();
  dailyRender();
}
function setDailyPlayerFilter(mode){
  _dailyPlayerFilter=['all','wait','playing','rest','queued'].includes(mode)?mode:'all';
  dailyRender();
}
function _dailyUpdatePlayerSortButtons(){
  ['status','name','gender'].forEach(mode=>{
    const el=document.getElementById('dailyPlayerSort'+mode.charAt(0).toUpperCase()+mode.slice(1));
    if(el)el.classList.toggle('active',_dailyPlayerSort===mode);
  });
}
function _dailyUpdatePlayerToolState(){
  const search=document.getElementById('dailyPlayerSearch');
  if(search&&search.value!==_dailyPlayerSearch)search.value=_dailyPlayerSearch;
  ['all','wait','playing','rest','queued'].forEach(mode=>{
    const el=document.getElementById('dailyPlayerFilter'+mode.charAt(0).toUpperCase()+mode.slice(1));
    if(el)el.classList.toggle('active',_dailyPlayerFilter===mode);
  });
}
function _dailyHangulInitials(text){
  const CHO='ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  return String(text||'').split('').map(ch=>{
    const code=ch.charCodeAt(0)-44032;
    if(code>=0&&code<11172)return CHO[Math.floor(code/588)]||ch;
    return ch;
  }).join('');
}
function _dailyPlayerMatchesSearch(p){
  const q=String(_dailyPlayerSearch||'').trim().toLowerCase();
  if(!q)return true;
  const name=String(p.name||'').toLowerCase();
  const initials=_dailyHangulInitials(p.name).toLowerCase();
  return name.includes(q)||initials.includes(q);
}
function _dailyPlayerMatchesFilter(p){
  if(_dailyPlayerFilter==='all')return true;
  if(_dailyPlayerFilter==='queued')return _dailyIsQueued(p.id);
  return _dailyNormalizeStatus(p.status)===_dailyPlayerFilter;
}
function _dailyFilterPlayersForManage(players){
  return players.filter(p=>_dailyPlayerMatchesFilter(p)&&_dailyPlayerMatchesSearch(p));
}
function _dailySortPlayersForManage(players){
  const statusOrder={wait:0,playing:1,rest:2,done:3,planned:4,invited:4};
  const nameSort=(a,b)=>a.name.localeCompare(b.name,'ko');
  if(_dailyPlayerSort==='name')return [...players].sort(nameSort);
  if(_dailyPlayerSort==='gender'){
    return [...players].sort((a,b)=>{
      const ga=a.gender==='남'?0:1;
      const gb=b.gender==='남'?0:1;
      return (ga-gb)||nameSort(a,b);
    });
  }
  return [...players].sort((a,b)=>
    (statusOrder[_dailyNormalizeStatus(a.status)]??9)-(statusOrder[_dailyNormalizeStatus(b.status)]??9)||
    (a.games-b.games)||
    ((a.waitFrom||0)-(b.waitFrom||0))||
    nameSort(a,b)
  );
}
function _dailyPlayerMetaText(p){
  return `${_dailyGenderLabel(p.gender)} · ${esc(p.grade||'C')}급 · ${esc(p.ageGroup||'40대')} · ${p.games||0}게임 · 대기 ${_dailyMinutes(p.waitFrom)}분`;
}
function _dailyRenamePlayerEverywhere(oldName,newName){
  const renameMapKey=map=>{
    if(!map||!Object.prototype.hasOwnProperty.call(map,oldName))return;
    map[newName]=(map[newName]||0)+(map[oldName]||0);
    delete map[oldName];
  };
  _dailyPlayers.forEach(p=>{
    if(p.partnerName===oldName)p.partnerName=newName;
    renameMapKey(p.partnerCount);
    renameMapKey(p.opponentCount);
  });
  const touchPlayer=obj=>{if(obj&&obj.name===oldName)obj.name=newName;};
  _dailyMatches.forEach(m=>{
    ['team1A','team1B','team2C','team2D'].forEach(k=>touchPlayer(m[k]));
  });
}
function dailyRenamePlayer(id){
  if(!_dailyCanChangeRoster())return;
  const p=_dailyPlayer(id);
  if(!p)return;
  const name=prompt('이름 변경',p.name);
  if(name==null)return;
  const next=name.trim();
  if(!next)return;
  if(_dailyPlayers.some(x=>x.id!==id&&x.name===next)){
    alert('민턴LIVE 명단에 이미 있는 선수입니다.');
    return;
  }
  const prev=p.name;
  p.name=next;
  _dailyRenamePlayerEverywhere(prev,next);
  dailySave();
  dailyRender();
  dailyOpenPlayerSheet(id);
}
function dailyClosePlayerSheet(){
  _dailyPlayerSheetId=null;
  document.getElementById('dailyPlayerSheet')?.classList.add('hidden');
}
function dailyOpenPlayerSheet(id){
  const p=_dailyPlayer(id);
  if(!p)return;
  _dailyPlayerSheetId=id;
  const overlay=document.getElementById('dailyPlayerSheet');
  const title=document.getElementById('dailyPlayerSheetTitle');
  const body=document.getElementById('dailyPlayerSheetBody');
  if(!overlay||!title||!body)return;
  title.textContent=p.name;
  const playing=p.status==='playing'||!!p.currentMatchId;
  const statusKeys=playing?['rest','done']:['wait','rest','done'];
  const statusButtons=statusKeys.map(st=>{
    const active=playing?p.afterMatchStatus===st:_dailyNormalizeStatus(p.status)===st;
    const label=playing?`경기 후 ${DAILY_STATUS[st].label}`:DAILY_STATUS[st].label;
    return `<button class="daily-player-sheet-action ${active?'active':''}" onclick="dailySheetSetStatus('${id}','${st}')">${esc(label)}</button>`;
  }).join('');
  const playingNote=playing?`<div class="daily-player-sheet-note">${p.afterMatchStatus?`경기 종료 후 ${esc(_dailyCheckinStatusLabel(p.afterMatchStatus))} 예정입니다.`:'경기가 끝난 뒤 쉴지 귀가할지 미리 표시할 수 있습니다.'}</div>`:'';
  body.innerHTML=`<div class="daily-player-sheet-summary">
      <div class="daily-player-sheet-name">${_dailyNameHtml(p)} ${_dailyStatusBadge(p.status)} ${_dailyQueueLabelForPlayer(p.id)}</div>
      <div class="daily-player-sheet-meta">${_dailyPlayerMetaText(p)}</div>
    </div>
    ${playingNote}
    <div class="daily-player-sheet-actions">${statusButtons}</div>
    <div class="daily-player-sheet-actions secondary">
      <button class="daily-player-sheet-action" onclick="dailyRenamePlayer('${id}')">이름 변경</button>
      <button class="daily-player-sheet-action danger" onclick="dailySheetRemovePlayer('${id}')">삭제</button>
    </div>`;
  overlay.classList.remove('hidden');
}
function dailySheetSetStatus(id,status){
  dailyClosePlayerSheet();
  dailySetStatus(id,status);
}
function dailySheetRemovePlayer(id){
  dailyClosePlayerSheet();
  dailyRemovePlayer(id);
}
function dailyRemovePlayer(id){
  if(!_dailyCanChangeRoster())return;
  const p=_dailyPlayer(id);
  if(!p)return;
  if(p.currentMatchId){alert('경기중 선수는 먼저 경기 완료 또는 취소를 해주세요.');return;}
  const queued=_dailyIsQueued(id);
  const locked=_dailyIsLockedQueued(id);
  const msg=queued
    ? `${p.name} 선수를 민턴LIVE 명단에서 제외할까요?\n\n현재 다음 대진/대기표에 포함되어 있어 해당 대기표에서도 빠지고 가능한 경우 자동으로 보충됩니다.`
    : `${p.name} 선수를 민턴LIVE 명단에서 제외할까요?`;
  if(!confirm(msg))return;
  const partner=_dailyPlayers.find(x=>(p.partnerId&&x.partnerId===p.partnerId)||x.name===p.partnerName);
  if(partner&&partner.id!==p.id){
    partner.partnerName=null;
    partner.partnerId=null;
  }
  _dailyCancelReservationsForPlayer(id,`${p.name} 선수가 명단에서 제외되어 게임신청이 자동 취소됐습니다.`,'admin-remove-player');
  _dailyPlayers=_dailyPlayers.filter(x=>x.id!==id);
  _dailyQueue=_dailyQueue.filter(q=>!_dailyQueueIds(q).includes(id));
  if(_dailyPairSelectId===id)_dailyPairSelectId=null;
  _dailyNext=null;
  if(queued||locked)dailyEnsureQueue();
  dailySave();dailyRender();
}
function dailyReset(){
  if(!_dailyConfirmDetachLiveBeforeChange('민턴LIVE 데이터 초기화'))return;
  if(!confirm('민턴LIVE 기록을 모두 초기화할까요?\n기존 대진표와 명부는 지워지지 않습니다.'))return;
  if(typeof _dailyStopOperatorHeartbeat==='function')_dailyStopOperatorHeartbeat();
  _dailyStopCheckinListener();
  _dailyPlayers=[];_dailyMatches=[];_dailyNext=null;_dailyQueue=[];_dailyReservations=[];_dailySeq=1;_dailyWaveStarts=0;
  _dailyPairSelectId=null;
  _dailyAutoAssign=false;
  _dailyOperationStarted=false;
  _dailyFinishMode=false;
  _dailyFinishStartedAt=0;
  _dailyPaused=false;
  _dailyPausedAt=0;
  _dailyPauseReason='';
  _dailyPauseRevision=0;
  _dailyResumedAt=0;
  _dailyTeamMode=false;
  _dailyTeamLocked=false;
  _dailyVoteDeadlineAt='';
  if(_dailyCheckinId&&_fbDb)_fbDb.ref(_dailyCheckinPath()).remove().catch(()=>{});
  _dailyClearAdminGrant();
  _dailyCheckinId=null;
  _dailyCheckinCreatedAt=0;
  _dailyServerRevision=0;
  _dailyOfficialInviteToken='';
  _dailyOfficialInviteHash='';
  _dailyCapabilityPromise=null;
  _dailyServerReconcileError='';
  _dailyCheckinRequests=[];
  _dailyCheckinParty={};
  localStorage.removeItem(DAILY_CHECKIN_KEY);
  localStorage.removeItem(DAILY_CHECKIN_CREATED_KEY);
  _dailyMarkFourCacheDirty();
  toggleDailyGuestMode(false);
  const autoEl=document.getElementById('dailyAutoAssign');
  if(autoEl)autoEl.checked=false;
  const autoTopEl=document.getElementById('dailyAutoAssignTop');
  if(autoTopEl)autoTopEl.checked=false;
  const voteEl=document.getElementById('dailyVoteDeadlineAt');
  if(voteEl)voteEl.value='';
  localStorage.removeItem(DAILY_KEY);
  dailyRender();
}
function dailyToggleAutoAssign(on){
  _dailyAutoAssign=!!on;
  if(_dailyAutoAssign)_dailyOperationStarted=true;
  dailySave();
  _dailySyncControls(_dailyCourtCount());
  dailyRender();
  dailyMaybeAutoAssign();
}
function _dailyFinishPlanInfo(){
  const queued=_dailyQueue.filter(q=>_dailyQueueItemValid(q,null)).length;
  const courts=_dailyCourtCount();
  const active=_dailyActiveMatches();
  const free=Math.max(0,courts-active.length);
  if(!queued){
    return {queued,active:active.length,etaMin:0,label:'바로 자율게임'};
  }
  const slots=active
    .map(m=>Math.max(0,_dailyRemainingMinutes(m)))
    .sort((a,b)=>a-b);
  for(let i=0;i<free;i++)slots.push(0);
  if(!slots.length)slots.push(0);
  let remain=queued;
  let eta=0;
  const queue=slots.sort((a,b)=>a-b);
  while(remain>0){
    const t=queue.shift()??0;
    eta=t;
    remain--;
    queue.push(t+DAILY_MATCH_MINUTES);
    queue.sort((a,b)=>a-b);
  }
  return {queued,active:active.length,etaMin:Math.max(0,Math.ceil(eta)),label:_dailyFinishEtaLabel(Math.max(0,Math.ceil(eta)))};
}
function _dailyFinishEtaLabel(minutes){
  if(!minutes)return '곧 자율게임';
  if(minutes<=3)return '곧 자율게임';
  return `약 ${minutes}분 후 자율게임`;
}
function dailyToggleFinishMode(){
  if(_dailyBlockPaused({action:'마무리를 변경'}))return;
  dailyEnsureQueue();
  if(!_dailyFinishMode){
    const plan=_dailyFinishPlanInfo();
    const msg=plan.queued
      ? `마무리 시작\n\n남은 자동대진 ${plan.queued}경기\n${plan.label}\n\n새 대진은 더 만들지 않습니다.`
      : '마무리 시작\n\n새 자동대진 없음\n빈 코트는 자율게임으로 전환됩니다.';
    if(!confirm(msg))return;
    _dailyOperationStarted=true;
    _dailyFinishMode=true;
    _dailyFinishStartedAt=_dailyNow();
    _dailyAutoAssign=false;
  }else{
    if(!confirm('마무리를 취소하고 자동대진을 다시 이어갈까요?'))return;
    _dailyFinishMode=false;
    _dailyFinishStartedAt=0;
  }
  dailyEnsureQueue();
  dailySave();
  dailyRender();
  if(!_dailyFinishMode)dailyMaybeAutoAssign();
}
function _dailyShiftMatchTimes(match,duration){
  if(!match||!duration)return;
  if(Number(match.endAt))match.endAt=Number(match.endAt)+duration;
  if(Number(match.autoHandoffExpiresAt))match.autoHandoffExpiresAt=Number(match.autoHandoffExpiresAt)+duration;
}
function _dailyFreezeActiveMatchDeadlines(){
  _dailyMatches
    .filter(match=>!match.completedAt&&!match.cancelledAt)
    .forEach(match=>{
      if(!Number(match.endAt))match.endAt=_dailyMatchEndAt(match);
    });
}
function _dailyResumePausedClocks(pausedAt,resumedAt){
  const duration=Math.max(0,Number(resumedAt||_dailyNow())-Number(pausedAt||0));
  if(!duration)return 0;
  _dailyMatches.filter(match=>!match.completedAt&&!match.cancelledAt).forEach(match=>_dailyShiftMatchTimes(match,duration));
  _dailyPlayers.forEach(player=>{
    if(_dailyNormalizeStatus(player.status)==='wait'&&Number(player.waitFrom))player.waitFrom=Number(player.waitFrom)+duration;
    if(_dailyNormalizeStatus(player.status)==='rest')player.restPausedMs=Number(player.restPausedMs||0)+duration;
    if(Number(player.deferUntil)>Number(pausedAt||0))player.deferUntil=Number(player.deferUntil)+duration;
  });
  _dailyQueue.forEach(item=>{
    if(Number(item?.restPass?.createdAt))item.restPass.createdAt=Number(item.restPass.createdAt)+duration;
  });
  return duration;
}
function _dailyPersistPauseState(){
  try{
    const raw=localStorage.getItem(DAILY_KEY);
    if(!raw)return;
    const state=JSON.parse(raw);
    if(state.mode&&state.mode!=='daily'&&state.appMode!=='dailyLive')return;
    state.paused=_dailyPaused;
    state.pausedAt=_dailyPausedAt;
    state.pauseReason=_dailyPauseReason;
    state.pauseRevision=_dailyPauseRevision;
    state.resumedAt=_dailyResumedAt;
    state.players=_dailyPlayers;
    state.matches=_dailyMatches;
    state.queue=_dailyQueue;
    state.savedAt=_dailyNow();
    localStorage.setItem(DAILY_KEY,JSON.stringify(state));
  }catch(e){}
}
function _dailyAdoptRemotePauseEvent(event,options){
  const remoteRevision=Math.max(0,Number(event?.pauseRevision||0));
  if(remoteRevision<=_dailyPauseRevision)return false;
  const wasPaused=_dailyPaused;
  const localPausedAt=_dailyPausedAt;
  if(wasPaused&&!event?.paused)_dailyResumePausedClocks(localPausedAt,Number(event?.resumedAt||_dailyNow()));
  const activeById=new Map((event?.active||[]).map(match=>[String(match?.id||''),match]));
  _dailyMatches
    .filter(match=>!match.completedAt&&!match.cancelledAt)
    .forEach(match=>{
      const remote=activeById.get(String(match.id||''));
      if(!remote)return;
      if(Number(remote.endAt))match.endAt=Number(remote.endAt);
      if(Number(remote.autoHandoffExpiresAt))match.autoHandoffExpiresAt=Number(remote.autoHandoffExpiresAt);
    });
  _dailyPaused=!!event?.paused;
  _dailyPausedAt=_dailyPaused?Math.max(0,Number(event?.pausedAt||_dailyNow())):0;
  _dailyPauseReason=_dailyPaused?String(event?.pauseReason||DAILY_PAUSE_REASON):'';
  _dailyPauseRevision=remoteRevision;
  _dailyResumedAt=Math.max(0,Number(event?.resumedAt||0));
  _dailyPersistPauseState();
  if(!options?.silent)dailyRender();
  return true;
}
async function _dailySyncPauseState(paused,pausedAt,changedAt,reason){
  if(!_dailyCheckinId||!_fbDb)return null;
  const ref=_fbDb.ref(_dailyCheckinPath()+'/session');
  const result=await ref.transaction(current=>{
    if(!current||typeof current!=='object')return current;
    const event=current.event&&typeof current.event==='object'?current.event:{};
    if(Array.isArray(event.active)){
      event.active.forEach(match=>{
        if(!Number(match?.endAt)){
          match.endAt=(Number(match?.startedAt)||Number(changedAt))+(Number(match?.expectedMinutes)||DAILY_MATCH_MINUTES)*60000;
        }
      });
    }
    if(paused){
      event.paused=true;
      event.pausedAt=Number(event.pausedAt||pausedAt||changedAt);
      event.pauseReason=reason||DAILY_PAUSE_REASON;
      event.resumedAt=0;
    }else if(event.paused){
      const remotePausedAt=Number(event.pausedAt||pausedAt||changedAt);
      const duration=Math.max(0,Number(changedAt)-remotePausedAt);
      if(duration&&Array.isArray(event.active))event.active.forEach(match=>_dailyShiftMatchTimes(match,duration));
      if(duration&&Array.isArray(current.players)){
        current.players.forEach(player=>{
          if(String(player?.status||'')==='wait'&&Number(player.waitFrom))player.waitFrom=Number(player.waitFrom)+duration;
          if(String(player?.status||'')==='rest')player.restPausedMs=Number(player.restPausedMs||0)+duration;
          if(Number(player?.deferUntil)>remotePausedAt)player.deferUntil=Number(player.deferUntil)+duration;
        });
      }
      event.paused=false;
      event.pausedAt=0;
      event.pauseReason='';
      event.resumedAt=Number(changedAt);
    }else{
      event.paused=false;
      event.pausedAt=0;
      event.pauseReason='';
      event.resumedAt=Number(changedAt);
    }
    event.pauseRevision=Math.max(0,Number(event.pauseRevision||current.pauseRevision||0))+1;
    event.updatedAt=Number(changedAt);
    current.event=event;
    current.pauseRevision=event.pauseRevision;
    current.updatedAt=Number(changedAt);
    return current;
  },undefined,false);
  return result;
}
async function dailyTogglePause(){
  if(_dailyPauseSyncBusy)return;
  if(!_dailyOperationStarted){
    alert('대진 게시 후 진행을 일시 정지할 수 있습니다.');
    return;
  }
  const pausing=!_dailyPaused;
  const changedAt=_dailyNow();
  const previousPausedAt=_dailyPausedAt;
  if(pausing){
    _dailyFreezeActiveMatchDeadlines();
    _dailyPaused=true;
    _dailyPausedAt=changedAt;
    _dailyPauseReason=DAILY_PAUSE_REASON;
    _dailyResumedAt=0;
  }else{
    _dailyResumePausedClocks(previousPausedAt,changedAt);
    _dailyPaused=false;
    _dailyPausedAt=0;
    _dailyPauseReason='';
    _dailyResumedAt=changedAt;
  }
  _dailyPauseSyncBusy=true;
  dailySave();
  dailyRender();
  try{
    const result=await _dailySyncPauseState(pausing,pausing?changedAt:previousPausedAt,changedAt,pausing?DAILY_PAUSE_REASON:'');
    const synced=!_dailyCheckinId||!!result?.committed;
    if(result?.committed)_dailyAdoptRemotePauseEvent(result.snapshot?.val()?.event||{},{silent:true});
    if(!synced&&_dailyCheckinId)alert(`이 기기에서는 ${pausing?'일시 정지':'진행 재개'}됐지만 회원 화면 동기화를 확인하지 못했습니다.\n네트워크를 확인해 주세요.`);
    if(_dailyOfficialInviteHash)_dailyPullServerReconcile().catch(()=>{});
  }catch(e){
    if(_dailyCheckinId)alert(`이 기기에서는 ${pausing?'일시 정지':'진행 재개'}됐지만 회원 화면에 전달하지 못했습니다.\n네트워크를 확인해 주세요.`);
  }finally{
    _dailyPauseSyncBusy=false;
    dailyRenderOpsStats();
  }
}
function _dailyMinutesOfDay(hhmm){
  const m=String(hhmm||'').match(/^(\d{2}):(\d{2})$/);
  if(!m)return null;
  return parseInt(m[1])*60+parseInt(m[2]);
}
function _dailyVoteDeadlineTs(){
  if(!_dailyVoteDeadlineAt)return 0;
  const [h,m]=_dailyVoteDeadlineAt.split(':').map(n=>parseInt(n,10));
  if(!Number.isFinite(h)||!Number.isFinite(m))return 0;
  const d=new Date();
  d.setHours(h,m,0,0);
  return d.getTime();
}
function _dailyVoteClosed(){
  const ts=_dailyVoteDeadlineTs();
  return !!ts&&_dailyNow()>=ts;
}
function _dailyVoteDeadlineLabel(){
  if(!_dailyVoteDeadlineAt)return '마감 시간 없음';
  return `${_dailyVoteDeadlineAt}${_dailyVoteClosed()?' 마감됨':' 마감 예정'}`;
}
function dailySetVoteDeadline(value){
  _dailyVoteDeadlineAt=value||'';
  dailySave();
  dailyRender();
}
function dailyClearVoteDeadline(){
  _dailyVoteDeadlineAt='';
  const el=document.getElementById('dailyVoteDeadlineAt');
  if(el)el.value='';
  dailySave();
  dailyRender();
}
function dailyFilterAttendees(){
  const removable=_dailyPlayers.filter(p=>p.status==='invited'||(p.status==='done'&&!(p.games||0)&&!p.currentMatchId));
  if(!removable.length){
    alert('제외할 미응답 회원이 없습니다.');
    return;
  }
  const invited=removable.filter(p=>p.status==='invited').length;
  const declined=removable.length-invited;
  if(!confirm(`참석자만 남기고 미응답 ${invited}명${declined?`, 불참 ${declined}명`:''}을 제외할까요?\n\n이미 경기한 선수 기록은 삭제하지 않습니다.`))return;
  const removeIds=new Set(removable.map(p=>p.id));
  removable.forEach(p=>_dailyCancelReservationsForPlayer(p.id,`${p.name} 선수가 참석자 정리에서 제외되어 게임신청이 자동 취소됐습니다.`,'admin-filter-attendees'));
  _dailyPlayers=_dailyPlayers.filter(p=>!removeIds.has(p.id));
  _dailyQueue=_dailyQueue.filter(q=>!_dailyQueueIds(q).some(id=>removeIds.has(id)));
  if(_dailyPairSelectId&&removeIds.has(_dailyPairSelectId))_dailyPairSelectId=null;
  _dailyNext=null;
  dailyEnsureQueue();
  dailySave();
  dailyRender();
}
function dailyRenderClosingSchedule(){
  const voteEl=document.getElementById('dailyVoteDeadlineAt');
  if(voteEl&&voteEl.value!==_dailyVoteDeadlineAt)voteEl.value=_dailyVoteDeadlineAt||'';
  const voteHint=document.getElementById('dailyVoteDeadlineHint');
  if(voteHint){
    const invited=_dailyPlayers.filter(p=>p.status==='invited').length;
    voteHint.textContent=_dailyVoteDeadlineAt
      ? `${_dailyVoteDeadlineLabel()} · 미응답 ${invited}명은 참석자만 남기기로 제외할 수 있습니다.`
      : '마감 후 미응답 회원을 제외하면 참석한 회원만 운영 명단에 남습니다.';
  }
}
function dailyRunAutoAssign(){
  if(_dailyBlockPaused({action:'대진을 투입'}))return;
  const made=dailyMaybeAutoAssign(true);
  if(!made){
    const free=_dailyAvailableCourt(_dailyAutoCourtLimit()||_dailyCourtCount());
    const eligible=_dailyEligible().length;
    const info=_dailyNaturalAutoInfo();
    alert(!free?'빈 코트가 없습니다.':`참가 인원 ${info.pool}명입니다. ${info.hint}. 현재 대기선수는 ${eligible}명입니다.`);
  }
}
function dailyMaybeAutoRecommend(){
  if(_dailyPaused||_dailyAutoBusy)return false;
  return dailyEnsureQueue();
}
function dailyMaybeAutoAssign(force){
  if(_dailyPaused)return 0;
  if(force)_dailyOperationStarted=true;
  const flow=_dailyNaturalAutoInfo();
  const allow=force||flow.auto;
  if((!allow)||_dailyAutoBusy){
    if(!_dailyAutoBusy)dailyEnsureQueue();
    return 0;
  }
  _dailyAutoBusy=true;
  let made=0;
  try{
    const limit=force?_dailyCourtCount():_dailyAutoCourtLimit();
    while(_dailyAvailableCourt(limit,{auto:true})&&made<Math.max(1,limit)){
      dailyEnsureQueue();
      const court=_dailyAvailableCourt(limit,{auto:true});
      const q=_dailyFirstStartableQueueForCourt(court);
      if(!q)break;
      if(!dailyStartQueueItem(q.id,{silent:true,auto:true,court,courtLimit:limit}))break;
      made++;
    }
  }finally{
    _dailyAutoBusy=false;
  }
  if(made){dailySave();dailyRender();}
  else dailyEnsureQueue();
  return made;
}
function _dailyCombos(arr){
  const out=[];
  for(let i=0;i<arr.length-3;i++)for(let j=i+1;j<arr.length-2;j++)for(let k=j+1;k<arr.length-1;k++)for(let l=k+1;l<arr.length;l++)out.push([arr[i],arr[j],arr[k],arr[l]]);
  return out;
}
function _dailyFourKey(players){
  return players.map(p=>String(p.id||p.name)).sort((a,b)=>a.localeCompare(b,'ko')).join('|');
}
function _dailyMatchFourKey(m){
  if(m?.fourKey)return m.fourKey;
  const ids=[...(m?.team1||[]),...(m?.team2||[])].filter(Boolean).map(String);
  return ids.length===4?ids.sort((a,b)=>a.localeCompare(b,'ko')).join('|'):'';
}
function _dailyExactKey(team1,team2){
  const teamKey=team=>(team||[]).map(p=>String(p&&typeof p==='object'?(p.id||p.name):p)).filter(Boolean).sort((a,b)=>a.localeCompare(b,'ko')).join('|');
  const keys=[teamKey(team1),teamKey(team2)];
  if(keys.some(key=>!key))return '';
  return keys.sort((a,b)=>a.localeCompare(b,'ko')).join(' VS ');
}
function _dailyMatchExactKey(m){
  if(m?.exactKey)return m.exactKey;
  if(m?.team1A&&m?.team1B&&m?.team2C&&m?.team2D)return _dailyExactKey([m.team1A,m.team1B],[m.team2C,m.team2D]);
  return _dailyExactKey(m?.team1||[],m?.team2||[]);
}
function _dailyMarkFourCacheDirty(){_dailyFourRepeatCache=null;_dailyExactRepeatCache=null;}
function _dailyFourCache(){
  if(_dailyFourRepeatCache)return _dailyFourRepeatCache;
  const map=new Map();
  _dailyMatches.forEach(m=>{
    if(!m||m.cancelledAt)return;
    const key=_dailyMatchFourKey(m);
    if(!key)return;
    m.fourKey=key;
    map.set(key,(map.get(key)||0)+1);
  });
  _dailyFourRepeatCache=map;
  return map;
}
function _dailyFourRepeatCount(players){
  return _dailyFourCache().get(_dailyFourKey(players))||0;
}
function _dailyExactCache(){
  if(_dailyExactRepeatCache)return _dailyExactRepeatCache;
  const map=new Map();
  _dailyMatches.forEach(m=>{
    if(!m||m.cancelledAt)return;
    const key=_dailyMatchExactKey(m);
    if(!key)return;
    m.exactKey=key;
    map.set(key,(map.get(key)||0)+1);
  });
  _dailyExactRepeatCache=map;
  return map;
}
function _dailyExactRepeatCount(m){
  return _dailyExactCache().get(_dailyMatchExactKey(m))||0;
}
const DAILY_PARTNER_GAP_OK=MATCH_QUALITY?.constants.partnerGapOk??1.25;
const DAILY_PARTNER_GAP_CAUTION=MATCH_QUALITY?.constants.partnerGapCaution??2.25;
const DAILY_PARTNER_GAP_HARD=MATCH_QUALITY?.constants.partnerGapHard??3;
const DAILY_TEAM_DIFF_TARGET=MATCH_QUALITY?.constants.teamDiffTarget??1.5;
const DAILY_TEAM_DIFF_LIMIT=MATCH_QUALITY?.constants.teamDiffLimit??2;
const DAILY_RECENT_SOFT_MIN=6;
const DAILY_RECENT_RECOVERY_MIN=12;
const DAILY_LATE_GRACE_MIN=5;
const DAILY_LATE_PRIORITY_GAMES=2;
function _dailyPartnerRepeatPenalty(count){
  return MATCH_QUALITY?MATCH_QUALITY.partnerRepeatPenalty(count):(count===0?0:count===1?140:count===2?1200:1e9);
}
function _dailyOpponentRepeatPenalty(count){
  const base=MATCH_QUALITY?MATCH_QUALITY.opponentRepeatPenalty(count):(count===0?0:count===1?2:count===2?15:count===3?80:1e9);
  return base*4;
}
function _dailyExactRepeatPenalty(count){
  return count===0?0:count===1?5000:count===2?50000:1e9;
}
function _dailyTeamLevel(team){
  if(MATCH_QUALITY)return MATCH_QUALITY.teamLevel(team);
  if(!team||team.length<2)return 0;
  return effLevel(team[0])+effLevel(team[1]);
}
function _dailyTeamLevelDiff(t1,t2){
  if(MATCH_QUALITY)return MATCH_QUALITY.teamDiff(t1,t2);
  return Math.round(Math.abs(_dailyTeamLevel(t1)-_dailyTeamLevel(t2))*10)/10;
}
function _dailyMatchTeamLevelDiff(m){
  if(!m)return 0;
  if(m.team1A&&m.team1B&&m.team2C&&m.team2D){
    return _dailyTeamLevelDiff([m.team1A,m.team1B],[m.team2C,m.team2D]);
  }
  if(Number.isFinite(+m.levelDiff))return Math.round(Math.abs(+m.levelDiff)*10)/10;
  return _dailyTeamLevelDiff([m.team1A,m.team1B],[m.team2C,m.team2D]);
}
function _dailyMatchTeamBalanceOk(m){
  return _dailyMatchTeamLevelDiff(m)<=DAILY_TEAM_DIFF_LIMIT;
}
function _dailyTeamDiffPenalty(diff){
  if(MATCH_QUALITY)return MATCH_QUALITY.teamDiffPenalty(diff);
  const d=Math.max(0,Number.isFinite(+diff)?+diff:0);
  let penalty=d*360;
  if(d>DAILY_TEAM_DIFF_TARGET)penalty+=(d-DAILY_TEAM_DIFF_TARGET)*1600;
  if(d>DAILY_TEAM_DIFF_LIMIT)penalty+=50000+(d-DAILY_TEAM_DIFF_LIMIT)*12000;
  return penalty;
}
function _dailyPartnerLevelGap(team){
  if(MATCH_QUALITY)return MATCH_QUALITY.partnerGap(team);
  if(!team||team.length<2)return 0;
  return Math.abs(effLevel(team[0])-effLevel(team[1]));
}
function _dailyPartnerLevelGapPenalty(team){
  if(MATCH_QUALITY)return MATCH_QUALITY.partnerGapPenalty(team);
  const gap=_dailyPartnerLevelGap(team);
  if(gap<=DAILY_PARTNER_GAP_OK)return 0;
  let penalty=(gap-DAILY_PARTNER_GAP_OK)*900;
  if(gap>DAILY_PARTNER_GAP_CAUTION)penalty+=1200+(gap-DAILY_PARTNER_GAP_CAUTION)*2200;
  if(gap>=DAILY_PARTNER_GAP_HARD)penalty+=4200+(gap-DAILY_PARTNER_GAP_HARD)*3200;
  return penalty;
}
function _dailyMatchMaxPartnerGap(m){
  if(!m)return 0;
  return Math.max(
    _dailyPartnerLevelGap([m.team1A,m.team1B]),
    _dailyPartnerLevelGap([m.team2C,m.team2D])
  );
}
function _dailyMatchPartnerGapOfficialOk(m){
  return _dailyMatchMaxPartnerGap(m)<DAILY_PARTNER_GAP_HARD;
}
function _dailyMatchLevelSpreadPenalty(players){
  const levels=(players||[]).map(effLevel).filter(v=>Number.isFinite(v));
  if(levels.length<4)return 0;
  const spread=Math.max(...levels)-Math.min(...levels);
  return Math.max(0,spread-3)*120 + Math.max(0,spread-4)*360;
}
function _dailyRecoveryPoolStrength(ref){
  const count=Array.isArray(ref)?ref.length:_dailyEligible().length;
  const courts=Math.max(1,_dailyCourtCount());
  if(count>=courts*6)return 'plenty';
  if(count>=courts*4)return 'normal';
  return 'tight';
}
function _dailyRecentRecoveryMinutes(p){
  if(!p||!p.lastPlayedSeq)return Infinity;
  const from=p.waitFrom||p.lastStatusAt||0;
  return from?_dailyMinutes(from):0;
}
function _dailyRecentRecoveryPenalty(p,ref){
  if(!p||!p.lastPlayedSeq)return 0;
  const seqGap=Math.max(0,_dailySeq-(p.lastPlayedSeq||0));
  const elapsed=_dailyRecentRecoveryMinutes(p);
  const strength=_dailyRecoveryPoolStrength(ref);
  if(strength==='tight'){
    return seqGap<=1&&elapsed<DAILY_RECENT_SOFT_MIN
      ? 70+Math.max(0,DAILY_RECENT_SOFT_MIN-elapsed)*18
      : 0;
  }
  let penalty=0;
  if(seqGap<=1)penalty+=strength==='plenty'?520:320;
  else if(seqGap===2)penalty+=strength==='plenty'?180:80;
  if(elapsed<DAILY_RECENT_SOFT_MIN)penalty+=(DAILY_RECENT_SOFT_MIN-elapsed)*(strength==='plenty'?85:50);
  if(strength==='plenty'&&elapsed<DAILY_RECENT_RECOVERY_MIN)penalty+=(DAILY_RECENT_RECOVERY_MIN-elapsed)*18;
  return penalty;
}
function _dailyLatePriorityInfo(p){
  const startedAt=_dailyFirstMatchStartedAt();
  const joinedAt=Number(p?.joinedAt||0);
  const lateMinutes=startedAt&&joinedAt>startedAt?Math.floor((joinedAt-startedAt)/60000):0;
  const remaining=Math.max(0,DAILY_LATE_PRIORITY_GAMES-Number(p?.games||0));
  return {late:lateMinutes>=DAILY_LATE_GRACE_MIN,lateMinutes,remaining};
}
function _dailyLatePriorityBonus(p){
  const info=_dailyLatePriorityInfo(p);
  if(!info.late||!info.remaining)return 0;
  const games=Number(p.games||0);
  if(games>0&&_dailyRecentRecoveryMinutes(p)<DAILY_RECENT_RECOVERY_MIN)return 0;
  const raw=(games===0?180:90)+Math.min(info.lateMinutes,30)*2;
  return Math.min(raw,games===0?240:150);
}
function _dailyQueuePriorityScore(p){
  const wait=_dailyMinutes(p.waitFrom||p.joinedAt);
  return Number(p.games||0)*170-Math.min(wait,60)*4-_dailyLatePriorityBonus(p);
}
function _dailyMixedTargetRange(games){
  const total=Math.max(0,Number(games||0));
  return {min:Math.floor(total/4),max:Math.floor(total/4)*2+Math.min(2,total%4)};
}
function _dailyMixedQuotaPenalty(p,isMixed){
  const nextGames=Math.max(1,Number(p?.typeTrackedGames||0)+1);
  const nextMixed=Math.max(0,Number(p?.mixedGames||0)+(isMixed?1:0));
  const range=_dailyMixedTargetRange(nextGames);
  const ideal=nextGames*0.375;
  let penalty=Math.abs(nextMixed-ideal)*35;
  if(nextMixed<range.min)penalty+=(range.min-nextMixed)*3600;
  if(nextMixed>range.max)penalty+=(nextMixed-range.max)*3600;
  if(nextGames>=3&&nextMixed===0)penalty+=640;
  return Math.min(600,penalty);
}
function _dailyFlexibleMatch(four){
  const combos=[[0,1,2,3],[0,2,1,3],[0,3,1,2]];
  let best=null,bestScore=Infinity;
  combos.forEach(c=>{
    const t1=[four[c[0]],four[c[1]]],t2=[four[c[2]],four[c[3]]];
    if(!_dailyValidTeamPairing(t1,t2))return;
    const team1Level=_dailyTeamLevel(t1);
    const team2Level=_dailyTeamLevel(t2);
    const ld=Math.round(Math.abs(team1Level-team2Level)*10)/10;
    const match={team1A:t1[0],team1B:t1[1],team2C:t2[0],team2D:t2[1],type:'예외',levelDiff:ld,team1Level,team2Level,isFlexible:true};
    if(!_dailyMatchTeamBalanceOk(match))return;
    if(!_dailyMatchPartnerGapOfficialOk(match))return;
    let score=_dailyTeamDiffPenalty(ld)+Math.abs(effLevel(t1[0])-effLevel(t1[1]))*18+Math.abs(effLevel(t2[0])-effLevel(t2[1]))*18;
    score+=_dailyPartnerLevelGapPenalty(t1)+_dailyPartnerLevelGapPenalty(t2)+_dailyMatchLevelSpreadPenalty([t1[0],t1[1],t2[0],t2[1]]);
    t1.forEach(a=>t2.forEach(b=>{score+=_dailyOpponentRepeatPenalty(a.opponentCount[b.name]||0);}));
    if(t1[0].partnerName!==t1[1].name)score+=_dailyPartnerRepeatPenalty(t1[0].partnerCount[t1[1].name]||0);
    if(t2[0].partnerName!==t2[1].name)score+=_dailyPartnerRepeatPenalty(t2[0].partnerCount[t2[1].name]||0);
    if(score<bestScore){
      bestScore=score;
      best=match;
    }
  });
  return best;
}
function _dailyScoreMatch(m,strict){
  const all=[m.team1A,m.team1B,m.team2C,m.team2D];
  const matchType=m.type||_dailyQueueType([m.team1A,m.team1B],[m.team2C,m.team2D]);
  const isMixed=matchType==='혼복';
  const fairnessPool=_dailyEligible();
  const ref=fairnessPool.length?fairnessPool:_dailyPlayers;
  const minGames=ref.length?Math.min(...ref.map(p=>p.games||0)):0;
  const maxGames=ref.length?Math.max(...ref.map(p=>p.games||0)):0;
  let score=_dailyTeamDiffPenalty(_dailyMatchTeamLevelDiff(m));
  let latePriorityTotal=0;
  let mixedQuotaTotal=0;
  all.forEach(p=>{
    const wait=_dailyMinutes(p.waitFrom||p.joinedAt);
    score+=(p.games-minGames)*170;
    score-=Math.min(wait,60)*4;
    score+=_dailyRecentRecoveryPenalty(p,ref);
    latePriorityTotal+=_dailyLatePriorityBonus(p);
    mixedQuotaTotal+=_dailyMixedQuotaPenalty(p,isMixed);
  });
  score-=Math.min(360,latePriorityTotal);
  score+=Math.min(1200,mixedQuotaTotal);
  const teams=[[m.team1A,m.team1B],[m.team2C,m.team2D]];
  teams.forEach(t=>{if(t[0].partnerName!==t[1].name)score+=_dailyPartnerRepeatPenalty(t[0].partnerCount[t[1].name]||0);});
  teams.forEach(t=>{score+=_dailyPartnerLevelGapPenalty(t);});
  score+=_dailyMatchLevelSpreadPenalty(all);
  teams[0].forEach(a=>teams[1].forEach(b=>{score+=_dailyOpponentRepeatPenalty(a.opponentCount[b.name]||0);}));
  score+=_dailyFourRepeatCount(all)*1600;
  score+=_dailyExactRepeatPenalty(_dailyExactRepeatCount(m));
  score-=_dailyPairedLabels(all).length*650;
  if(maxGames-minGames>=2) all.filter(p=>p.games===minGames).forEach(()=>score-=90);
  if(!strict)score+=260;
  return score;
}
function dailyRecommend(){
  _dailyQueue=[];
  dailyEnsureQueue();
  dailyRender();
}
function _dailyMatchNames(m){
  return {
    a:[m.team1A,m.team1B].map(_dailyNameText),
    b:[m.team2C,m.team2D].map(_dailyNameText)
  };
}
function _dailyReasons(next){
  const m=next.match, all=[m.team1A,m.team1B,m.team2C,m.team2D];
  const fairnessPool=_dailyEligible();
  const ref=fairnessPool.length?fairnessPool:_dailyPlayers;
  const minGames=ref.length?Math.min(...ref.map(p=>p.games||0)):0;
  const low=all.filter(p=>p.games===minGames).map(_dailyNameText);
  const wait=[...all].sort((a,b)=>(_dailyMinutes(b.waitFrom)-_dailyMinutes(a.waitFrom)))[0];
  const paired=_dailyPairedLabels(all);
  const recent=all.filter(p=>_dailyRecentRecoveryPenalty(p,ref)>0).map(_dailyNameText);
  const late=all.filter(p=>_dailyLatePriorityBonus(p)>0).map(_dailyNameText);
  const label=next.label||`대기 ${next.queueIndex?next.queueIndex+1:1}순위`;
  const reasons=[
    `${label} · ${m.type}${m.isFlexible?' 조합':''} · 팀 실력차 ${m.levelDiff}`,
    `${low.length?low.join(', '):'대상자'} 선수의 오늘 경기 수가 가장 적습니다.`,
    `${_dailyNameText(wait)} 선수가 약 ${_dailyMinutes(wait.waitFrom)}분 대기했습니다.`,
    `25점 기준 약 ${DAILY_MATCH_MINUTES}분 경기로 보고 종료 시간을 예측합니다.`
  ];
  if(m.reservationLabel)reasons.unshift(`게임신청: ${m.reservationLabel} 요청을 반영했습니다.`);
  if(paired.length)reasons.push(`${paired.join(', ')} 신청을 같은 편으로 반영했습니다.`);
  if(recent.length)reasons.push(`${recent.join(', ')} 선수는 최근 경기자라 대기 인원 여유에 따라 우선순위를 낮춰 반영했습니다.`);
  if(late.length)reasons.push(`${late.join(', ')} 선수는 늦게 도착해 남은 운동시간을 고려하여 첫 2경기까지 우선 반영했습니다.`);
  if(m.type==='혼복')reasons.push('개인별 4경기 중 혼복 1~2회 목표를 함께 반영했습니다.');
  if(!next.strict)reasons.push('표준 남복/여복/혼복 조합이 어려워 실력 균형을 맞춘 예외 조합입니다.');
  return reasons;
}
function _dailyQueueSelect(q,side,pos,currentId){
  const blocked=new Set();
  _dailyQueue.forEach(other=>{
    if(other.id===q.id)return;
    _dailyQueueIds(other).forEach(id=>blocked.add(id));
  });
  const current=_dailyPlayer(currentId);
  const requiredTeam=(_dailyTeamMode&&current)?_dailyTeamSide(current):'';
  const currentQueueIds=new Set(_dailyQueueIds(q));
  const players=_dailyEligible()
    .filter(p=>!blocked.has(p.id)&&!currentQueueIds.has(p.id))
    .filter(p=>!requiredTeam||p.team===requiredTeam)
    .sort((a,b)=>(a.games-b.games)||a.name.localeCompare(b.name,'ko'));
  return `<select class="daily-queue-select" onchange="dailyEditQueuePlayer('${q.id}','${side}',${pos},this.value)">
    <option value="">${players.length?'대기선수 선택':'교체 후보 없음'}</option>
    ${players.map(p=>`<option value="${p.id}">${p.isGuest?'[G] ':''}${esc(p.name)} · ${_dailyGenderLabel(p.gender)} · ${esc(p.grade||'C')} · ${p.games||0}G</option>`).join('')}
  </select>`;
}
function _dailyQueuedPlayerLocation(playerId){
  for(let idx=0;idx<_dailyQueue.length;idx++){
    const q=_dailyQueue[idx];
    const t1=q.team1||[],t2=q.team2||[];
    const p1=t1.indexOf(playerId),p2=t2.indexOf(playerId);
    if(p1>=0)return {idx,q,side:'team1',pos:p1};
    if(p2>=0)return {idx,q,side:'team2',pos:p2};
  }
  return null;
}
function _dailyQueueReplacementCandidates(q,currentId){
  const blocked=new Set();
  _dailyQueue.forEach(other=>{
    if(other.id===q.id)return;
    _dailyQueueIds(other).forEach(id=>blocked.add(id));
  });
  const current=_dailyPlayer(currentId);
  const requiredTeam=(_dailyTeamMode&&current)?_dailyTeamSide(current):'';
  const currentQueueIds=new Set(_dailyQueueIds(q));
  return _dailyEligible()
    .filter(p=>p.id!==currentId&&!blocked.has(p.id)&&!currentQueueIds.has(p.id))
    .filter(p=>p.status==='wait'&&!p.currentMatchId)
    .filter(p=>!requiredTeam||p.team===requiredTeam)
    .sort((a,b)=>{
      if((a.games||0)!==(b.games||0))return (a.games||0)-(b.games||0);
      if((a.waitFrom||0)!==(b.waitFrom||0))return (a.waitFrom||0)-(b.waitFrom||0);
      return a.name.localeCompare(b.name,'ko');
    });
}
function _dailyExpectedReplacementCandidates(q,currentId){
  const cap=_dailyQueueCapacity();
  const expected=_dailyProjectedQueue(_dailyExpectedQueueTarget(cap));
  const current=_dailyPlayer(currentId);
  const requiredTeam=(_dailyTeamMode&&current)?_dailyTeamSide(current):'';
  const currentQueueIds=new Set(_dailyQueueIds(q));
  const seen=new Set();
  const out=[];
  expected.forEach((item,expectedIdx)=>{
    _dailyQueueIds(item).forEach(id=>{
      if(id===currentId||currentQueueIds.has(id)||seen.has(id))return;
      const p=_dailyPlayer(id);
      if(!p||!DAILY_STATUS[p.status]?.eligible||p.currentMatchId)return;
      if(requiredTeam&&p.team!==requiredTeam)return;
      seen.add(id);
      out.push({player:p,source:'expected',expectedIdx});
    });
  });
  return out;
}
function _dailyTailQueueReplacementCandidates(q,currentId,idx){
  const current=_dailyPlayer(currentId);
  const requiredTeam=(_dailyTeamMode&&current)?_dailyTeamSide(current):'';
  const currentQueueIds=new Set(_dailyQueueIds(q));
  const out=[];
  for(let sourceIdx=_dailyQueue.length-1;sourceIdx>idx;sourceIdx--){
    const sourceQ=_dailyQueue[sourceIdx];
    if(!sourceQ||sourceQ.reservationId)continue;
    _dailyQueueIds(sourceQ).forEach(id=>{
      if(id===currentId||currentQueueIds.has(id))return;
      const p=_dailyPlayer(id);
      if(!p||!DAILY_STATUS[p.status]?.eligible||p.currentMatchId)return;
      if(requiredTeam&&p.team!==requiredTeam)return;
      out.push({player:p,source:'tail',sourceIdx,sourceId:sourceQ.id});
    });
  }
  return out;
}
function _dailyActiveReplacementCandidates(match,currentId){
  const blocked=new Set();
  _dailyActiveMatches().forEach(other=>{
    if(other.id===match.id)return;
    _dailyMatchPlayers(other).forEach(p=>blocked.add(p.id));
  });
  _dailyQueue.forEach(q=>_dailyQueueIds(q).forEach(id=>blocked.add(id)));
  const current=_dailyPlayer(currentId);
  const requiredTeam=(_dailyTeamMode&&current)?_dailyTeamSide(current):'';
  return _dailyEligible()
    .filter(p=>p.id!==currentId&&!blocked.has(p.id))
    .filter(p=>p.status==='wait'&&!p.currentMatchId)
    .filter(p=>!requiredTeam||p.team===requiredTeam)
    .sort((a,b)=>{
      if((a.games||0)!==(b.games||0))return (a.games||0)-(b.games||0);
      if((a.waitFrom||0)!==(b.waitFrom||0))return (a.waitFrom||0)-(b.waitFrom||0);
      return a.name.localeCompare(b.name,'ko');
    });
}
function _dailyFindQueueReplacement(playerId){
  const loc=_dailyQueuedPlayerLocation(playerId);
  if(!loc)return null;
  const before={team1:[...(loc.q.team1||[])],team2:[...(loc.q.team2||[])]};
  const direct=_dailyQueueReplacementCandidates(loc.q,playerId).map(player=>({player,source:'free'}));
  const expected=_dailyExpectedReplacementCandidates(loc.q,playerId);
  const tail=_dailyTailQueueReplacementCandidates(loc.q,playerId,loc.idx);
  const candidates=[...direct,...expected,...tail];
  const seen=new Set();
  let best=null,bestScore=Infinity;
  for(const item of candidates){
    const candidate=item.player;
    if(!candidate||seen.has(candidate.id))continue;
    seen.add(candidate.id);
    loc.q[loc.side][loc.pos]=candidate.id;
    const ok=new Set(_dailyQueueIds(loc.q)).size===4&&_dailyQueueItemValid(loc.q,null);
    if(ok){
      const match=_dailyQueueMatch(loc.q);
      const sourcePenalty=item.source==='free'?0:item.source==='expected'?120:240;
      const score=match?_dailyScoreMatch(match,loc.q.strict!==false)+sourcePenalty:Infinity;
      if(score<bestScore){bestScore=score;best={loc,candidate,source:item.source,sourceIdx:item.sourceIdx,sourceId:item.sourceId};}
    }
    loc.q.team1=[...before.team1];
    loc.q.team2=[...before.team2];
  }
  loc.q.team1=[...before.team1];
  loc.q.team2=[...before.team2];
  return best;
}
function _dailyTryReplaceQueuedPlayer(playerId,reason){
  const found=_dailyFindQueueReplacement(playerId);
  if(!found)return false;
  if(found.loc.q.reservationId){
    _dailyCancelReservationById(found.loc.q.reservationId,reason||'신청 선수 상태 변경으로 대기표가 자동 조정됐습니다.','member-auto-cancel');
    found.loc.q.reservationId=null;
    found.loc.q.reservationLabel=null;
  }
  found.loc.q[found.loc.side][found.loc.pos]=found.candidate.id;
  _dailyRecalcQueueItem(found.loc.q);
  if(found.source==='tail'&&found.sourceId){
    _dailyQueue=_dailyQueue.filter(q=>q.id!==found.sourceId);
  }
  return true;
}
function _dailyRemoveQueuedPlayer(playerId,reason){
  let changed=false;
  _dailyQueue=_dailyQueue.filter(q=>{
    if(!_dailyQueueIds(q).includes(playerId))return true;
    if(q.reservationId)_dailyCancelReservationById(q.reservationId,reason||'신청 선수 상태 변경으로 대기표가 자동 취소됐습니다.','member-auto-cancel');
    changed=true;
    return false;
  });
  if(changed)_dailyRefreshNextFromQueue();
  return changed;
}
function dailyEditQueuePlayer(queueId,side,pos,newId){
  if(!newId){dailyRender();return;}
  const idx=_dailyQueue.findIndex(q=>q.id===queueId);
  if(idx<0)return;
  const q=_dailyQueue[idx];
  const urgent=idx<_dailyQueueLockCount();
  if(q.reservationId&&!urgent){
    alert('회원 게임신청은 선수 직접 수정이 잠겨 있습니다. 신청 삭제 후 다시 등록해 주세요.');
    dailyRender();return;
  }
  if(q.reservationId&&urgent){
    _dailyCancelReservationById(q.reservationId,'다음 대진 선수교체로 신청 대진이 자동 조정됐습니다.','admin-queue-replace');
    q.reservationId=null;
    q.reservationLabel=null;
  }
  const before={team1:[...q.team1],team2:[...q.team2]};
  q[side][pos]=newId;
  const ids=_dailyQueueIds(q);
  if(new Set(ids).size!==4||!_dailyQueueItemValid(q,null)){
    q.team1=before.team1;q.team2=before.team2;
    alert('같은 선수가 중복되었거나 게임신청 조건에 맞지 않습니다.');
    dailyRender();return;
  }
  _dailyRecalcQueueItem(q);
  dailySave();dailyRender();
}
function dailyPickQueueReplacement(queueId,side,pos){
  if(_dailyBlockPaused({action:'대진 선수를 교체'}))return;
  const idx=_dailyQueue.findIndex(q=>q.id===queueId);
  if(idx<0)return;
  const q=_dailyQueue[idx];
  const urgent=idx<_dailyQueueLockCount();
  if(q.reservationId&&!urgent){
    alert('회원이 신청한 게임은 선수 교체가 잠겨 있습니다. 신청 삭제 후 다시 등록해 주세요.');
    return;
  }
  const currentId=q[side]?.[pos];
  const candidates=_dailyQueueReplacementCandidates(q,currentId).slice(0,12);
  if(!candidates.length){
    alert('교체 가능한 순수 대기선수가 없습니다.');
    return;
  }
  const current=_dailyPlayer(currentId);
  const list=candidates.map((p,i)=>`${i+1}. ${p.name}${p.isGuest?'(G)':''} · ${_dailyGenderLabel(p.gender)} · ${p.grade||'C'} · ${p.games||0}G`).join('\n');
  const raw=prompt(`${current?.name||'선수'} 대신 넣을 대기선수를 번호로 선택하세요.\n\n${list}`,'1');
  if(raw==null)return;
  const pick=parseInt(String(raw).trim(),10);
  if(!pick||pick<1||pick>candidates.length){
    alert('번호를 다시 확인해 주세요.');
    return;
  }
  dailyEditQueuePlayer(queueId,side,pos,candidates[pick-1].id);
}
function dailyPickActiveReplacement(matchId,side,pos){
  if(_dailyBlockPaused({action:'진행 선수를 교체'}))return;
  const m=_dailyMatches.find(x=>x.id===matchId&&!x.completedAt&&!x.cancelledAt);
  if(!m)return;
  const arr=side==='team2'?m.team2:m.team1;
  if(!arr||!arr[pos])return;
  const currentId=arr[pos];
  const current=_dailyPlayer(currentId);
  const candidates=_dailyActiveReplacementCandidates(m,currentId).slice(0,12);
  if(!candidates.length){
    alert('교체 가능한 순수 대기선수가 없습니다.');
    return;
  }
  const list=candidates.map((p,i)=>`${i+1}. ${p.name}${p.isGuest?'(G)':''} · ${_dailyGenderLabel(p.gender)} · ${p.grade||'C'} · ${p.games||0}G`).join('\n');
  const raw=prompt(`${current?.name||'선수'} 대신 들어갈 대기선수를 번호로 선택하세요.\n기존 선수는 휴식으로 전환됩니다.\n\n${list}`,'1');
  if(raw==null)return;
  const pick=parseInt(String(raw).trim(),10);
  if(!pick||pick<1||pick>candidates.length){
    alert('번호를 다시 확인해 주세요.');
    return;
  }
  const candidate=candidates[pick-1];
  if(_dailyMatchPlayers(m).some(p=>p.id===candidate.id)){
    alert('이미 이 경기에 포함된 선수입니다.');
    return;
  }
  arr[pos]=candidate.id;
  if(current){
    current.status='rest';
    current.currentMatchId=null;
    current.afterMatchStatus=null;
    current.lastStatusAt=_dailyNow();
  }
  _dailyCancelReservationsForPlayer(candidate.id,'진행 중 경기 선수교체로 게임신청이 자동 취소됐습니다.','admin-active-replace');
  candidate.status='playing';
  candidate.currentMatchId=m.id;
  candidate.lastStatusAt=_dailyNow();
  _dailyQueue=_dailyQueue.filter(q=>!_dailyQueueIds(q).includes(candidate.id));
  dailyEnsureQueue();
  dailySave();
  dailyRender();
  dailyMaybeAutoAssign();
}
function dailyEditActiveCourt(matchId){
  if(_dailyBlockPaused({action:'코트를 변경'}))return;
  const m=_dailyMatches.find(x=>x.id===matchId&&!x.completedAt&&!x.cancelledAt);
  if(!m)return;
  const current=parseInt(m.court,10)||1;
  const raw=prompt(`현재 ${current}코트입니다.\n실제 진행 중인 코트 번호를 입력하세요.`, String(current));
  if(raw==null)return;
  const next=parseInt(String(raw).trim(),10);
  if(!Number.isFinite(next)||next<1||next>12){
    alert('코트 번호는 1~12 사이 숫자로 입력해 주세요.');
    return;
  }
  if(next===current)return;
  const other=_dailyActiveMatches().find(x=>x.id!==m.id&&!x.cancelledAt&&(parseInt(x.court,10)||0)===next);
  if(other){
    const ok=confirm(`${next}코트에는 이미 진행 중인 경기가 있습니다.\n두 경기의 코트 번호를 서로 바꿀까요?`);
    if(!ok)return;
    other.court=current;
  }
  m.court=next;
  dailySave();
  dailyRender();
}
function _dailyManualActiveMode(){
  return _dailyManualActiveDraft&&_dailyManualActiveDraft.mode==='transition'?'transition':'manual';
}
function _dailyManualActiveCandidates(mode){
  mode=mode||_dailyManualActiveMode();
  const activeIds=new Set();
  _dailyActiveMatches().forEach(m=>_dailyMatchPlayers(m).forEach(p=>activeIds.add(p.id)));
  return _dailyPlayers
    .filter(p=>{
      if(!p||p.currentMatchId||activeIds.has(p.id))return false;
      const st=_dailyNormalizeStatus(p.status);
      if(mode==='transition')return st==='wait';
      return st==='wait';
    })
    .sort((a,b)=>{
      if((a.games||0)!==(b.games||0))return (a.games||0)-(b.games||0);
      if((a.waitFrom||0)!==(b.waitFrom||0))return (a.waitFrom||0)-(b.waitFrom||0);
      return a.name.localeCompare(b.name,'ko');
    });
}
function _dailyManualEscape(v){
  return String(v==null?'':v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function _dailyManualActiveUsedCourts(){
  return new Set(_dailyActiveMatches().map(m=>parseInt(m.court,10)||0).filter(Boolean));
}
function _dailyManualActiveDefaultCourt(){
  const used=_dailyManualActiveUsedCourts();
  const base=Math.max(1,_dailyCourtCount());
  for(let c=1;c<=base;c++){
    if(!used.has(c))return c;
  }
  return 0;
}
function _dailyManualActiveCourtMax(){
  return Math.max(1,_dailyCourtCount());
}
function _dailyManualActiveSelected(){
  const candidates=new Map(_dailyManualActiveCandidates().map(p=>[p.id,p]));
  return (_dailyManualActiveDraft.ids||[]).map(id=>candidates.get(id)).filter(Boolean);
}
function _dailyManualActiveRegisteredMatches(){
  return _dailyActiveMatches()
    .filter(m=>m&&m.transitionStarted)
    .sort((a,b)=>(a.court||0)-(b.court||0));
}
function _dailyManualActiveMatchLabel(m){
  const name=id=>{
    const p=_dailyPlayer(id);
    return p&&p.name?p.name:'선수';
  };
  const t1=(m.team1||[]).map(name).join(' / ')||'1팀';
  const t2=(m.team2||[]).map(name).join(' / ')||'2팀';
  return `${m.court||'-'}코트 · ${t1} vs ${t2}`;
}
function _dailyManualActiveTeamLabel(ids, fallback){
  const names=(ids||[]).map(id=>{
    const p=typeof id==='string'?_dailyPlayer(id):id;
    return p&&p.name?p.name:'';
  }).filter(Boolean);
  return names.length?names.join(' · '):fallback;
}
function _dailyManualActiveMatchShortLabel(m){
  return `${_dailyManualActiveTeamLabel(m.team1,'1팀')} vs ${_dailyManualActiveTeamLabel(m.team2,'2팀')}`;
}
function _dailyManualActiveSelectionBoard(selected){
  const t1=selected.slice(0,2);
  const t2=selected.slice(2,4);
  const name=p=>p&&p.name?esc(p.name):'선택';
  return `<div class="daily-manual-pick-board">
    <div class="daily-manual-pick-side">
      <b>${name(t1[0])}</b>
      <b>${name(t1[1])}</b>
    </div>
    <div class="daily-manual-pick-vs">vs</div>
    <div class="daily-manual-pick-side">
      <b>${name(t2[0])}</b>
      <b>${name(t2[1])}</b>
    </div>
  </div>`;
}
function dailyCreateActiveMatch(){
  if(_dailyBlockPaused({action:'진행 경기를 등록'}))return;
  const candidates=_dailyManualActiveCandidates('manual');
  if(candidates.length<4){
    alert('수동 등록은 참가 상태 선수가 4명 이상일 때 가능합니다.');
    return;
  }
  const court=_dailyManualActiveDefaultCourt();
  if(!court){
    alert('설정된 코트가 모두 진행 중입니다.');
    return;
  }
  _dailyManualActiveDraft={mode:'manual',court,ids:[],registeredCount:0};
  dailyRenderManualActiveModal();
  const modal=document.getElementById('dailyManualActiveModal');
  if(modal)modal.classList.remove('hidden');
}
function dailyBeginLiveTransition(){
  if(!_dailyStartedPoolCount()){
    alert('먼저 현장에서 확인한 선수를 참가 등록하세요.');
    dailyOpenFold('dailySetupDetails','dailySetupDetails');
    return;
  }
  const candidates=_dailyManualActiveCandidates('transition');
  const court=_dailyManualActiveDefaultCourt();
  if(!court){
    if(confirm('설정된 코트를 모두 등록했습니다. 이제 나머지 대진을 게시할까요?')){
      dailyFinishLiveTransition();
    }
    return;
  }
  if(candidates.length<4){
    if(confirm('계속 진행할 경기가 없다면 참가자 대진을 바로 게시할까요?')){
      dailyFinishLiveTransition();
    }
    return;
  }
  _dailyManualActiveDraft={mode:'transition',court,ids:[],registeredCount:0};
  dailyRenderManualActiveModal();
  const modal=document.getElementById('dailyManualActiveModal');
  if(modal)modal.classList.remove('hidden');
}
function closeDailyManualActiveModal(){
  const modal=document.getElementById('dailyManualActiveModal');
  if(modal)modal.classList.add('hidden');
}
function dailyFinishLiveTransition(skipEmptyConfirm){
  if(!_dailyStartedPoolCount()&&!_dailyActiveMatches().length){
    alert('먼저 현장에서 확인한 선수를 참가 등록하세요.');
    return;
  }
  const modal=document.getElementById('dailyManualActiveModal');
  const modalOpen=modal&&!modal.classList.contains('hidden');
  const transition=modalOpen&&_dailyManualActiveMode()==='transition';
  const selectedCount=(_dailyManualActiveDraft.ids||[]).length;
  const registeredCount=Math.max(_dailyManualActiveDraft.registeredCount||0,_dailyManualActiveRegisteredMatches().length);
  if(transition&&selectedCount>0){
    alert('선택 중인 선수가 있습니다. 먼저 이 코트 등록을 누르거나 선택을 해제해 주세요.');
    dailyRenderManualActiveModal();
    return;
  }
  if(transition&&!registeredCount&&!skipEmptyConfirm){
    const ok=confirm('계속 진행할 경기 등록 없이 대진을 게시할까요?\n현재 코트가 비어 있을 때만 선택하세요.');
    if(!ok)return;
  }
  const active=_dailyActiveMatches().length;
  const pool=_dailyStartedPoolPlayers().length;
  if(!active&&pool<4){
    const ok=confirm(`참가 선수가 ${pool}명입니다.\n4명 미만이면 아직 대진이 만들어지지 않습니다. 그래도 대진 게시를 시작할까요?`);
    if(!ok)return;
  }
  _dailyOperationStarted=true;
  closeDailyManualActiveModal();
  dailyEnsureQueue();
  dailySave();
  dailyRender();
  dailyMaybeAutoAssign();
}
function dailySetManualActiveCourt(court){
  court=parseInt(court,10)||0;
  if(court<1||court>_dailyCourtCount())return;
  if(_dailyManualActiveUsedCourts().has(court)){
    alert(`${court}코트는 이미 진행 중입니다.`);
    return;
  }
  _dailyManualActiveDraft.court=court;
  dailyRenderManualActiveModal();
}
function dailyToggleManualActivePlayer(id){
  const candidates=new Map(_dailyManualActiveCandidates().map(p=>[p.id,p]));
  if(!candidates.has(id)){
    alert(_dailyManualActiveMode()==='transition'?'현장 참가 상태인 선수만 선택할 수 있습니다.':'현재 참가 상태인 선수만 선택할 수 있습니다.');
    dailyRenderManualActiveModal();
    return;
  }
  const ids=_dailyManualActiveDraft.ids||[];
  const idx=ids.indexOf(id);
  if(idx>=0){
    ids.splice(idx,1);
  }else{
    if(ids.length>=4){
      alert('선수는 4명까지 선택합니다.');
      return;
    }
    ids.push(id);
  }
  _dailyManualActiveDraft.ids=ids;
  dailyRenderManualActiveModal();
}
function dailyRenderManualActiveModal(){
  const mode=_dailyManualActiveMode();
  const transition=mode==='transition';
  const candidates=_dailyManualActiveCandidates(mode);
  const used=_dailyManualActiveUsedCourts();
  const court=_dailyManualActiveDraft.court||_dailyManualActiveDefaultCourt();
  if(used.has(court))_dailyManualActiveDraft.court=_dailyManualActiveDefaultCourt();
  const selectedIds=_dailyManualActiveDraft.ids||[];
  const registeredMatches=_dailyManualActiveRegisteredMatches();
  const registeredCount=Math.max(_dailyManualActiveDraft.registeredCount||0,registeredMatches.length);
  const registeredByCourt=new Map(registeredMatches.map(m=>[parseInt(m.court,10)||0,m]));
  const title=document.getElementById('dailyManualModalTitle');
  if(title)title.textContent=transition?'대진 게시':'수동 게임 등록';
  const sub=document.getElementById('dailyManualModalSub');
  if(sub)sub.textContent=transition?'계속 진행할 경기 등록':'비상 수동 등록';
  const note=document.getElementById('dailyManualNote');
  if(note){
    note.textContent=transition
      ? (selectedIds.length===4
        ? '선택한 4명이 계속 진행할 경기와 코트를 확인한 뒤 등록하세요.'
        : (selectedIds.length
          ? '현재 경기를 계속할 선수 4명을 선택하세요.'
          : '계속 진행할 경기만 등록하세요. 나머지 참가자는 자동대진으로 게시됩니다.'))
      : '4명 선택';
  }
  const courtGrid=document.getElementById('dailyManualCourtGrid');
  if(courtGrid){
    const max=_dailyManualActiveCourtMax();
    courtGrid.innerHTML=Array.from({length:max},(_,i)=>{
      const c=i+1;
      const registered=registeredByCourt.get(c);
      const busy=used.has(c);
      const on=!busy&&c===_dailyManualActiveDraft.court;
      const cls=registered?'registered':(busy?'busy':(on?'on':''));
      const state=registered?'완료':(busy?'진행':(on?'선택':'대기'));
      const meta=registered
        ? _dailyManualActiveMatchShortLabel(registered)
        : busy
          ? '사용 중'
          : on
            ? `${selectedIds.length}/4`
            : '선택';
      return `<button type="button" class="daily-manual-court-btn ${cls}" ${busy?'disabled':''} onclick="dailySetManualActiveCourt(${c})">
        <span class="daily-manual-court-main"><b>${c}코트</b><em>${state}</em></span>
        <span class="daily-manual-court-meta">${esc(meta)}</span>
      </button>`;
    }).join('');
  }
  const hint=document.getElementById('dailyManualCourtHint');
  if(hint)hint.textContent=transition
    ? `등록 ${registeredCount} · ${_dailyManualActiveDraft.court||'-'}코트`
    : `${_dailyManualActiveDraft.court||'-'}코트`;
  const count=document.getElementById('dailyManualPickCount');
  if(count)count.textContent=`${selectedIds.length}/4`;
  const grid=document.getElementById('dailyManualPlayerGrid');
  if(grid){
    grid.innerHTML=candidates.map(p=>{
      const idx=selectedIds.indexOf(p.id);
      const on=idx>=0;
      const guest=p.isGuest?'G · ':'';
      const status=transition?`${_dailyCheckinStatusLabel(p.status)} · `:'';
      return `<button type="button" class="daily-manual-player-btn ${on?'on':''}" onclick="dailyToggleManualActivePlayer('${_dailyManualEscape(p.id)}')">
        <span class="daily-manual-player-name">${_dailyManualEscape(p.name)}${p.isGuest?' (G)':''}</span>
        <span class="daily-manual-player-meta">${guest}${status}${_dailyGenderLabel(p.gender)} · ${p.grade||'C'} · ${p.games||0}게임</span>
        ${on?`<span class="daily-manual-pick">${idx+1}</span>`:''}
      </button>`;
    }).join('') || `<div class="daily-empty">${transition?'참가 등록된 선수가 없습니다.':'참가 상태 선수가 없습니다.'}</div>`;
  }
  const selected=_dailyManualActiveSelected();
  const summary=document.getElementById('dailyManualSummary');
  if(summary){
    const currentCourt=_dailyManualActiveDraft.court||'-';
    let main;
    let board='';
    let actionClass='';
    if(transition&&!selected.length){
      main=registeredCount
        ? '대진 게시 가능'
        : '코트 선택';
      actionClass=registeredCount?'go':'pick';
    }else{
      main=selected.length===4
        ? `${currentCourt}코트 준비`
        : `${currentCourt}코트 ${selected.length}/4`;
      actionClass=selected.length===4?'ready':'pick';
      board=_dailyManualActiveSelectionBoard(selected);
    }
    const nextAction=selected.length===4
      ? '코트 등록'
      : selected.length
        ? '4명 선택'
        : registeredCount
          ? '대진 게시'
          : '4명 선택';
    const registeredHtml=registeredMatches.length
      ? `<div class="daily-manual-registered">${registeredMatches.map(m=>`<div class="daily-manual-registered-row"><b>${esc((m.court||'-')+'코트')}</b><span>${esc(_dailyManualActiveMatchShortLabel(m))}</span></div>`).join('')}</div>`
      : '';
    summary.innerHTML=`<div class="daily-manual-next-action ${actionClass}"><strong>${esc(main)}</strong><span>${esc(nextAction)}</span></div>${board}${registeredHtml}`;
  }
  const btn=document.getElementById('dailyManualConfirmBtn');
  if(btn){
    if(transition){
      btn.textContent=selectedIds.length===4?'이 코트 등록':`${selectedIds.length}/4 선택`;
      btn.style.display=selectedIds.length?'block':'none';
    }else{
      btn.textContent='등록';
      btn.style.display='block';
    }
    btn.disabled=selectedIds.length!==4||!_dailyManualActiveDraft.court;
    btn.style.opacity=btn.disabled?'.45':'1';
  }
  const finishBtn=document.getElementById('dailyTransitionFinishBtn');
  if(finishBtn){
    finishBtn.style.display=transition&&!selectedIds.length?'block':'none';
    finishBtn.textContent=registeredCount?'등록 완료 · 대진 게시':'현재 경기 없이 대진 게시';
  }
  const footer=document.querySelector('.daily-manual-footer');
  if(footer){
    footer.classList.toggle('transition-idle',transition&&!selectedIds.length);
    footer.classList.toggle('transition-picking',transition&&!!selectedIds.length);
  }
}
function dailyConfirmManualActiveMatch(){
  if(_dailyBlockPaused({action:'진행 경기를 등록'}))return;
  const mode=_dailyManualActiveMode();
  const transition=mode==='transition';
  const court=parseInt(_dailyManualActiveDraft.court,10)||0;
  if(!Number.isFinite(court)||court<1||court>_dailyCourtCount()){
    alert('코트 번호를 선택해 주세요.');
    return;
  }
  if(_dailyManualActiveUsedCourts().has(court)){
    alert(`${court}코트에는 이미 진행 중인 경기가 있습니다.`);
    dailyRenderManualActiveModal();
    return;
  }
  const candidates=new Map(_dailyManualActiveCandidates(mode).map(p=>[p.id,p]));
  const ids=(_dailyManualActiveDraft.ids||[]).filter(id=>candidates.has(id));
  if(ids.length!==4||new Set(ids).size!==4){
    alert(transition?'현재 코트에서 뛰는 참가자 4명을 다시 선택해 주세요.':'참가 상태 선수 4명을 다시 선택해 주세요.');
    _dailyManualActiveDraft.ids=ids;
    dailyRenderManualActiveModal();
    return;
  }
  const selected=ids.map(id=>candidates.get(id));
  const reservationLabel=transition?'계속 경기':'자율게임';
  const cancelLabel=transition?'계속 경기 등록':'자율게임 등록';
  const idSet=new Set(ids);
  const removedQueues=_dailyQueue.filter(q=>_dailyQueueIds(q).some(id=>idSet.has(id)));
  removedQueues.forEach(q=>{
    if(q.reservationId)_dailyCancelReservationById(q.reservationId,`${cancelLabel}으로 게임신청이 자동 취소됐습니다.`,'admin-manual-active');
  });
  ids.forEach(pid=>_dailyCancelReservationsForPlayer(pid,`${cancelLabel}으로 게임신청이 자동 취소됐습니다.`,'admin-manual-active'));
  _dailyQueue=_dailyQueue.filter(q=>!_dailyQueueIds(q).some(id=>idSet.has(id)));
  const q=_dailyRecalcQueueItem({
    id:'manual_'+_dailyNow().toString(36),
    team1:ids.slice(0,2),
    team2:ids.slice(2,4),
    teamMode:false,
    reservationLabel,
    createdAt:_dailyNow()
  });
  const seq=_dailySeq++;
  const matchId='dm_'+_dailyNow().toString(36)+'_'+seq+'_'+Math.random().toString(36).slice(2,5);
  const startedAt=_dailyNow();
  const previousStatuses={};
  ids.forEach(pid=>{
    const p=_dailyPlayer(pid);
    if(p)previousStatuses[pid]=p.status;
  });
  _dailyMatches.push({
    id:matchId,
    seq,
    court,
    startedAt,
    endAt:startedAt+DAILY_MATCH_MINUTES*60000,
    type:q.type||'자율',
    levelDiff:q.levelDiff||0,
    expectedMinutes:DAILY_MATCH_MINUTES,
    durationMin:DAILY_MATCH_MINUTES,
    team1:ids.slice(0,2),
    team2:ids.slice(2,4),
    teamMode:false,
    fourKey:_dailyFourKey(selected),
    flexible:!!q.flexible,
    reservationId:null,
    reservationLabel,
    previousStatuses,
    manualStarted:true,
    transitionStarted:transition
  });
  selected.forEach(p=>{
    p.status='playing';
    p.currentMatchId=matchId;
    p.afterMatchStatus=null;
    p.lastStatusAt=_dailyNow();
  });
  _dailyMarkFourCacheDirty();
  if(transition){
    const registered=(_dailyManualActiveDraft.registeredCount||0)+1;
    _dailyManualActiveDraft={mode:'transition',court:_dailyManualActiveDefaultCourt(),ids:[],registeredCount:registered};
    dailyEnsureQueue();
    dailySave();
    dailyRender();
    dailyRenderManualActiveModal();
    return;
  }
  _dailyOperationStarted=true;
  closeDailyManualActiveModal();
  dailyEnsureQueue();
  dailySave();
  dailyRender();
  dailyMaybeAutoAssign();
}
function dailyRegenerateQueueItem(queueId){
  if(_dailyBlockPaused({action:'대진을 다시 생성'}))return;
  const idx=_dailyQueue.findIndex(q=>q.id===queueId);
  if(idx<0)return;
  if(_dailyQueue[idx].reservationId){
    alert('회원 게임신청은 자동 재배정하지 않습니다. 신청 삭제 후 다시 등록해 주세요.');
    dailyRender();return;
  }
  const used=new Set();
  _dailyQueue.forEach((q,i)=>{
    if(i===idx)return;
    if(_dailyQueueItemValid(q,null))_dailyQueueIds(q).forEach(id=>used.add(id));
  });
  const next=_dailyBuildQueueItem(used);
  if(!next){alert('현재 대기 인원으로 새 대기 경기를 만들 수 없습니다.');return;}
  _dailyQueue[idx]=next;
  if(_dailyEmergencyEditQueueId===queueId)_dailyEmergencyEditQueueId=null;
  dailySave();dailyRender();
}
function dailyStartQueueItem(queueId,options){
  options=options||{};
  if(_dailyBlockPaused({...options,action:'대진을 투입'}))return false;
  const operationAt=Number(options.startedAt)||_dailyNow();
  dailyEnsureQueue();
  const idx=_dailyQueue.findIndex(q=>q.id===queueId);
  if(idx<0){if(!options.silent)alert('시작할 대기 경기가 없습니다.');return false;}
  const requestedCourt=parseInt(options.court);
  const courtLimit=options.auto?(options.courtLimit!=null?options.courtLimit:_dailyAutoCourtLimit()):null;
  const requestedCourtAvailable=requestedCourt&&_dailyCourtAvailable(requestedCourt,courtLimit);
  const court=requestedCourtAvailable?requestedCourt:options.strictCourt?null:_dailyAvailableCourt(courtLimit,{auto:!!options.auto});
  if(!court){if(!options.silent)alert('빈 코트가 없습니다.');dailyRender();return false;}
  const q=_dailyQueue[idx],m=_dailyQueueMatch(q);
  if(!m||!_dailyQueueItemValid(q,null)){
    _dailyQueue.splice(idx,1);
    if(!options.silent)alert('대기 선수 상태가 바뀌었습니다. 대기표를 다시 정리합니다.');
    dailyEnsureQueue();dailySave();dailyRender();return false;
  }
  if(_dailyQueueRestPassActive(q)&&!options.ignoreRestPass){
    if(!options.silent)alert('이 대진은 조금 쉬고 입장 대기 중입니다. 다음 코트 종료 후 다시 입장할 수 있습니다.');
    return false;
  }
  if(q.restPass)delete q.restPass;
  _dailyReleaseCourtEntryHold(court,q.id);
  const queueSnapshot=options.autoHandoffQueue||{
    id:q.id,queueId:q.id,type:m.type,teamMode:!!(q.teamMode||m.teamMode),
    t1:[m.team1A.name,m.team1B.name],t2:[m.team2C.name,m.team2D.name],
    t1Ids:[m.team1A.id,m.team1B.id],t2Ids:[m.team2C.id,m.team2D.id],
    playerIds:[m.team1A.id,m.team1B.id,m.team2C.id,m.team2D.id],
    levelDiff:Number(q.levelDiff||m.levelDiff||0),team1Level:Number(q.team1Level||m.team1Level||0),team2Level:Number(q.team2Level||m.team2Level||0),
    flexible:!!(q.flexible||m.isFlexible),reservationId:q.reservationId||null,reservationLabel:q.reservationLabel||null
  };
  const autoHandoffReservation=options.autoHandoffReservation||(q.reservationId?_dailyReservations.find(r=>r.id===q.reservationId)||null:null);
  _dailyQueue.splice(idx,1);
  _dailyOperationStarted=true;
  const ids=[m.team1A.id,m.team1B.id,m.team2C.id,m.team2D.id];
  const autoHandoffPlayerStates=Array.isArray(options.autoHandoffPlayerStates)?options.autoHandoffPlayerStates:ids.map(pid=>{
    const p=_dailyPlayer(pid);
    return p?{
      id:pid,status:p.status,statusLabel:p.statusLabel||'',locked:!!p.locked,
      currentMatchId:p.currentMatchId||'',afterMatchStatus:p.afterMatchStatus||'',
      waitFrom:p.waitFrom,lastStatusAt:p.lastStatusAt,
      deferUntil:p.deferUntil||0,deferReason:p.deferReason||''
    }:{id:pid,status:'wait',currentMatchId:'',afterMatchStatus:'',waitFrom:operationAt,lastStatusAt:operationAt};
  });
  const seq=_dailySeq++;
  const id=options.matchId||('dm_'+operationAt.toString(36)+'_'+seq+'_'+Math.random().toString(36).slice(2,5));
  const previousStatuses={};
  ids.forEach(pid=>{
    const p=_dailyPlayer(pid);
    if(p)previousStatuses[pid]=p.status;
  });
  _dailyMatches.push({
    id,seq,court,
    startedAt:operationAt,type:m.type,levelDiff:m.levelDiff,
    endAt:operationAt+DAILY_MATCH_MINUTES*60000,
    expectedMinutes:DAILY_MATCH_MINUTES,
    team1:[m.team1A.id,m.team1B.id],team2:[m.team2C.id,m.team2D.id],
    teamMode:!!(q.teamMode||m.teamMode),
    fourKey:_dailyFourKey([m.team1A,m.team1B,m.team2C,m.team2D]),
    flexible:!!m.isFlexible,
    reservationId:q.reservationId||null,
    reservationLabel:q.reservationLabel||null,
    previousStatuses,
    autoStarted:!!(options.auto||options.autoHandoffAt),
    ...(options.autoHandoffAt?{
      autoHandoffAt:Number(options.autoHandoffAt),
      autoHandoffExpiresAt:Number(options.autoHandoffExpiresAt||0),
      autoHandoffSource:options.autoHandoffSource||'official-complete',
      autoHandoffSourceMatchId:options.autoHandoffSourceMatchId||'',
      autoHandoffSourceRequestId:options.autoHandoffSourceRequestId||'',
      autoHandoffQueueIndex:Number(options.autoHandoffQueueIndex||idx+1),
      autoHandoffQueue:JSON.parse(JSON.stringify(queueSnapshot)),
      autoHandoffPlayerStates:JSON.parse(JSON.stringify(autoHandoffPlayerStates)),
      autoHandoffReservation:autoHandoffReservation?JSON.parse(JSON.stringify(autoHandoffReservation)):null
    }:{})
  });
  ids.forEach(pid=>{
    const p=_dailyPlayer(pid);
    p.afterMatchStatus=null;
    p.status='playing';
    p.currentMatchId=id;
    p.lastStatusAt=operationAt;
  });
  _dailyMarkFourCacheDirty();
  if(q.reservationId){
    _dailyReservations=_dailyReservations.filter(r=>r.id!==q.reservationId);
  }
  if(_dailyFinishMode){
    dailyEnsureQueue();
  }else if(!options.skipWaveTrack){
    if(_dailyTeamMode&&_dailyTeamLocked){
      dailyEnsureQueue();
    }else{
      _dailyWaveStarts++;
      if(_dailyWaveStarts>=_dailyCourtCount()){
        _dailyWaveStarts=0;
        // 한 웨이브가 돌면 곧 시작할 1순위는 지키고, 나머지 미래 대기표는 다시 섞습니다.
        dailyRebuildQueue({preserveCount:1,preserveNotified:true});
      }else{
        dailyEnsureQueue();
      }
    }
  }else{
    dailyEnsureQueue();
  }
  if(!options.silent){dailySave();dailyRender();}
  return true;
}
function _dailyRenderQueueItem(q,idx,mode){
  const m=_dailyQueueMatch(q);
  if(!m)return '';
  const lockCount=_dailyQueueLockCount();
  const reserved=!!q.reservationId;
  const expected=mode==='expected'||!!q.expectedOnly;
  const urgent=!expected&&idx<lockCount;
  const teamA=[m.team1A,m.team1B];
  const teamB=[m.team2C,m.team2D];
  const teamMode=!!(q.teamMode||m.teamMode||_dailyTeamMode);
  const labelA=teamMode?teamNames.blue:'A팀';
  const labelB=teamMode?teamNames.white:'B팀';
  const orderLabel=teamMode?`투입순서 ${idx+1}`:`#${idx+1}`;
  const next={match:m,score:q.score,strict:q.strict,label:`${idx+1}순위 대기`,queueIndex:idx};
  const isRestPass=_dailyQueueRestPassActive(q);
  const restPassBadge=isRestPass?`<span class="daily-queue-badge hold">조금 쉬고 입장</span>`:'';
  const canStart=!_dailyPaused&&!expected&&!!_dailyAvailableCourt()&&!isRestPass;
  const badgeText=expected?'예상 대진':reserved?'게임신청':(urgent?'다음 대진':'대기');
  const compactTitle=`${orderLabel} · ${m.reservationLabel?'신청경기 · ':''}${esc(m.type)}${m.isFlexible?' · 예외':''} · 팀 실력차 ${esc(String(m.levelDiff))}`;
  const playerBtn=(side,pos,p)=>{
    const locked=_dailyPaused||expected||(reserved&&!urgent);
    const disabled=locked?'disabled':'';
    const title=expected?'진행 중 경기 종료 후 예상 대진입니다.':locked?'회원 신청 경기는 신청 삭제 후 변경':'이름을 눌러 대기선수로 교체';
    return `<button class="daily-queue-player" type="button" ${disabled} title="${esc(title)}" onclick="dailyPickQueueReplacement('${q.id}','${side}',${pos})">
      <b>${esc(p.name)}${p.isGuest?'<span class="guest-badge">G</span>':''}</b>
      ${urgent?'':`<small>${_dailyGenderLabel(p.gender)} · ${esc(p.grade||'C')} · ${p.games||0}G</small>`}
    </button>`;
  };
  const nextPlayerBtn=(side,pos,p)=>{
    const locked=_dailyPaused||(reserved&&!urgent);
    const disabled=locked?'disabled':'';
    const title=locked?'회원 신청 경기는 신청 삭제 후 변경':'이름을 눌러 대기선수로 교체';
    return `<button class="daily-next-player" type="button" ${disabled} title="${esc(title)}" onclick="dailyPickQueueReplacement('${q.id}','${side}',${pos})">${esc(p.name)}${p.isGuest?'<span class="guest-badge">G</span>':''}</button>`;
  };
  const boardHtml=`<div class="daily-queue-board">
      <div class="daily-queue-board-side">
        ${urgent?'':`<div class="daily-queue-board-label">${esc(labelA)}</div>`}
        ${playerBtn('team1',0,m.team1A)}
        ${playerBtn('team1',1,m.team1B)}
      </div>
      <div class="daily-queue-vs">VS</div>
      <div class="daily-queue-board-side b">
        ${urgent?'':`<div class="daily-queue-board-label">${esc(labelB)}</div>`}
        ${playerBtn('team2',0,m.team2C)}
        ${playerBtn('team2',1,m.team2D)}
      </div>
    </div>`;
  if(urgent){
    return `<div class="daily-queue-item daily-next-card ${reserved?'locked':'flex'}" data-daily-queue-id="${q.id}" data-daily-queue-idx="${idx}" draggable="true" ondragstart="dailyQueueDragStart(event,'${q.id}')" ondragover="dailyQueueDragOver(event,'${q.id}')" ondrop="dailyQueueDrop(event,'${q.id}')" ondragend="dailyQueueDragEnd()" aria-label="다음 대진 ${idx+1}">
      <div class="daily-next-rank">${idx+1}</div>
      <div class="daily-next-match">
        <div class="daily-next-line">
          <span class="daily-next-pair a">${nextPlayerBtn('team1',0,m.team1A)}${nextPlayerBtn('team1',1,m.team1B)}</span>
          <em>vs</em>
          <span class="daily-next-pair b">${nextPlayerBtn('team2',0,m.team2C)}${nextPlayerBtn('team2',1,m.team2D)}</span>
        </div>
        ${isRestPass?`<div class="daily-next-note hold">${esc(_dailyQueueRestPassLabel(q))}</div>`:''}
      </div>
    </div>`;
  }
  const editHtml=expected?'':reserved
    ? `<details class="daily-queue-editor">
        <summary>신청 관리</summary>
        <div class="daily-queue-editor-actions">
          <button class="daily-mini-btn danger" onclick="dailyDeleteReservation('${q.reservationId}')">신청 삭제</button>
        </div>
      </details>`
    : `<details class="daily-queue-editor">
        <summary>대진 관리</summary>
        <div class="daily-queue-editor-actions">
          <button class="daily-mini-btn" onclick="dailyRegenerateQueueItem('${q.id}')">대진 재배정</button>
          <button class="daily-mini-btn danger" onclick="dailyDeleteQueueItem('${q.id}')">삭제</button>
        </div>
      </details>`;
  const dragAttrs=expected?'':`draggable="true" ondragstart="dailyQueueDragStart(event,'${q.id}')" ondragover="dailyQueueDragOver(event,'${q.id}')" ondrop="dailyQueueDrop(event,'${q.id}')" ondragend="dailyQueueDragEnd()"`;
  return `<div class="daily-queue-item ${expected?'expected':reserved?'locked':'flex'}" data-daily-queue-id="${q.id}" data-daily-queue-idx="${idx}" ${dragAttrs}>
    <div class="daily-queue-head">
      <div class="daily-queue-head-main">
        ${urgent||expected?'':`<button class="daily-drag-handle" type="button" title="끌어서 대기 순서 변경" onpointerdown="dailyQueuePointerDown(event,'${q.id}')">☰</button>`}
        <div>
          <div class="daily-queue-title">${compactTitle}${urgent&&reserved?`<span class="daily-queue-badge locked">신청</span>`:''}${restPassBadge}</div>
          ${urgent?'':`<span class="daily-queue-badge ${expected?'expected':reserved?'locked':'flex'}">${badgeText}</span>`}
        </div>
      </div>
      ${canStart?`<div class="daily-queue-actions single"><button class="daily-mini-btn primary-action" onclick="dailyStartQueueItem('${q.id}')">${teamMode?'배정':'시작'}</button></div>`:''}
    </div>
    ${boardHtml}
    ${urgent?'':editHtml}
    ${expected?`<div class="daily-reasons"><div class="daily-reason">${esc(q.projectedDetail||DAILY_EXPECTED_DETAIL)}</div></div>`:urgent?'':`<div class="daily-reasons">${_dailyReasons(next).slice(0,3).map(r=>`<div class="daily-reason">${esc(r)}</div>`).join('')}</div>`}
  </div>`;
}
function dailyRenderQueue(){
  const urgentBox=document.getElementById('dailyUrgentBox');
  if(!_dailyPaused)dailyEnsureQueue();
  const lockCount=_dailyQueueLockCount();
  const urgent=_dailyQueue.slice(0,lockCount);
  const expected=_dailyProjectedQueue(_dailyExpectedQueueTarget(_dailyQueueCapacity()));
  if(urgentBox){
    if(!urgent.length&&!expected.length){
      urgentBox.className='daily-empty';
      urgentBox.textContent='4명부터 자동';
    }else{
      urgentBox.className='daily-urgent-list';
      const urgentHtml=urgent.map((q,i)=>_dailyRenderQueueItem(q,i,'urgent')).join('');
      const expectedHtml=expected.map((q,i)=>_dailyRenderQueueItem(q,lockCount+i,'expected')).join('');
      urgentBox.innerHTML=urgentHtml+expectedHtml;
    }
  }
}
function dailyRenderRecommend(){
  dailyRenderQueue();
}
function dailyStartRecommended(options){
  dailyEnsureQueue();
  const court=_dailyAvailableCourt();
  const q=_dailyFirstStartableQueueForCourt(court);
  if(!q){alert('시작할 대기 경기가 없습니다.');return false;}
  return dailyStartQueueItem(q.id,options||{court});
}
function _dailyInc(obj,key){obj[key]=(obj[key]||0)+1;}
function _dailyMatchPlayers(m){
  return [...(m?.team1||[]),...(m?.team2||[])].map(_dailyPlayer).filter(Boolean);
}
function _dailyMatchTeams(m){
  return {
    t1:(m?.team1||[]).map(_dailyPlayer).filter(Boolean),
    t2:(m?.team2||[]).map(_dailyPlayer).filter(Boolean)
  };
}
function _dailyMatchTeamKey(m,side){
  const ids=side==='t2'?m.team2:m.team1;
  const p=_dailyPlayer((ids||[])[0]);
  const t=_dailyTeamSide(p);
  if(t==='청팀')return 'blue';
  if(t==='홍팀')return 'white';
  return side==='t2'?'b':'a';
}
function _dailyMatchSideLabel(m,side){
  if(m?.teamMode){
    const key=_dailyMatchTeamKey(m,side);
    if(key==='blue')return teamNames.blue;
    if(key==='white')return teamNames.white;
  }
  return side==='t2'?'B팀':'A팀';
}
function dailySetMatchWinner(id,side){
  const m=_dailyMatches.find(x=>x.id===id);
  if(!m)return;
  m.winner=(m.winner===side)?null:side;
  dailySave();
  dailyRender();
}
function _dailyResultStats(){
  const completed=_dailyMatches.filter(m=>m.completedAt&&!m.cancelledAt);
  const active=_dailyActiveMatches().filter(m=>!m.cancelledAt);
  let teamErrors=0;
  const partnerPairs={},fourKeys={};
  let levelSum=0,levelCnt=0;
  completed.forEach(m=>{
    if(Number.isFinite(+m.levelDiff)){levelSum+=+m.levelDiff;levelCnt++;}
    const teams=_dailyMatchTeams(m);
    const pairKey=arr=>arr.map(p=>p.name).sort().join('|');
    if(teams.t1.length===2)_dailyInc(partnerPairs,pairKey(teams.t1));
    if(teams.t2.length===2)_dailyInc(partnerPairs,pairKey(teams.t2));
    const four=_dailyMatchPlayers(m).map(p=>p.name).sort().join('|');
    if(four)_dailyInc(fourKeys,four);
    if(m.teamMode){
      const t1s=new Set(teams.t1.map(_dailyTeamSide).filter(Boolean));
      const t2s=new Set(teams.t2.map(_dailyTeamSide).filter(Boolean));
      if(t1s.size!==1||t2s.size!==1||[...t1s][0]===[...t2s][0])teamErrors++;
    }
  });
  const partnerRepeat=Object.values(partnerPairs).filter(v=>v>=2).length;
  const sameFourRepeat=Object.values(fourKeys).reduce((sum,v)=>sum+Math.max(0,v-1),0);
  return {
    completed,active,teamErrors,
    partnerRepeat,sameFourRepeat,avgLD:levelCnt?levelSum/levelCnt:0
  };
}
function _dailyResultQualityChips(st){
  const chips=[];
  chips.push({label:`완료 ${st.completed.length}경기`,cls:'ok'});
  chips.push({label:`평균 실력차 ${st.avgLD.toFixed(1)}`,cls:st.avgLD<=1.5?'ok':st.avgLD<=2.5?'warn':'bad'});
  chips.push({label:st.sameFourRepeat?`같은 4명 반복 ${st.sameFourRepeat}`:'같은 4명 반복 없음',cls:st.sameFourRepeat?'warn':'ok'});
  chips.push({label:st.partnerRepeat?`파트너 2회+ ${st.partnerRepeat}쌍`:'파트너 반복 양호',cls:st.partnerRepeat?'warn':'ok'});
  return chips;
}
function _dailyPublicEvent(){
  const st=_dailyResultStats();
  const flowInfo=_dailyNaturalAutoInfo();
  const cap=_dailyQueueCapacity();
  const official=flowInfo.auto?Math.max(0,flowInfo.operatingCourts||_dailyCourtCount()):0;
  const extra=flowInfo.auto?Math.max(0,cap.extraGoal||0):0;
  const free=0;
  const active=st.active.sort((a,b)=>a.court-b.court).map(m=>{
    const teams=_dailyMatchTeams(m);
    return {
      id:m.id,
      court:m.court,seq:m.seq,type:m.type,teamMode:!!m.teamMode,
      labelA:_dailyMatchSideLabel(m,'t1'),labelB:_dailyMatchSideLabel(m,'t2'),
      t1:teams.t1.map(p=>p.name),t2:teams.t2.map(p=>p.name),
      t1Ids:teams.t1.map(p=>p.id),
      t2Ids:teams.t2.map(p=>p.id),
      playerIds:[...teams.t1,...teams.t2].map(p=>p.id),
      remain:_dailyRemainingMinutes(m),
      startedAt:m.startedAt||0,
      endAt:_dailyMatchEndAt(m),
      timerState:_dailyTimerState(m),
      transitionStarted:!!m.transitionStarted,
      autoHandoffAt:Number(m.autoHandoffAt||0),
      autoHandoffExpiresAt:Number(m.autoHandoffExpiresAt||0),
      autoHandoffSource:m.autoHandoffSource||'',
      autoHandoffSourceMatchId:m.autoHandoffSourceMatchId||'',
      autoHandoffSourceRequestId:m.autoHandoffSourceRequestId||'',
      autoHandoffQueueIndex:Number(m.autoHandoffQueueIndex||0),
      autoHandoffQueue:m.autoHandoffQueue||null,
      autoHandoffPlayerStates:m.autoHandoffPlayerStates||null,
      autoHandoffReservation:m.autoHandoffReservation||null
    };
  });
  const queuePayload=(q,idx,extra)=>{
    const m=_dailyQueueMatch(q);
    if(!m)return null;
    const restPass=_dailyQueueRestPassActive(q);
    const info=extra
      ? {matchId:'',court:null,text:'예상 대진',detail:q.projectedDetail||DAILY_EXPECTED_DETAIL,state:'expected'}
      : _dailyQueueStartInfo(idx);
    return {
      idx:idx+1,type:m.type,teamMode:!!(q.teamMode||m.teamMode),
      queueId:q.id,
      levelDiff:Number(q.levelDiff||m.levelDiff||0),
      team1Level:Number(q.team1Level||m.team1Level||0),
      team2Level:Number(q.team2Level||m.team2Level||0),
      flexible:!!(q.flexible||m.isFlexible),
      reservationId:q.reservationId||null,
      reservationLabel:q.reservationLabel||null,
      targetMatchId:info.matchId||'',
      targetCourt:info.court||null,
      targetHoldId:info.holdId||'',
      targetHoldAt:info.holdAt||0,
      labelA:(q.teamMode||m.teamMode)?teamNames.blue:'A팀',
      labelB:(q.teamMode||m.teamMode)?teamNames.white:'B팀',
      t1:[m.team1A.name,m.team1B.name],
      t2:[m.team2C.name,m.team2D.name],
      t1Ids:[m.team1A.id,m.team1B.id],
      t2Ids:[m.team2C.id,m.team2D.id],
      playerIds:[m.team1A.id,m.team1B.id,m.team2C.id,m.team2D.id],
      cue:info.text,
      cueDetail:info.detail,
      restPass:restPass&&!extra,
      restPassText:restPass?_dailyQueueRestPassLabel(q):'',
      cueState:extra?'expected':info.state,
      expected:!!extra
    };
  };
  const next=_dailyQueue.slice(0,cap.target).map((q,idx)=>queuePayload(q,idx,false)).filter(Boolean);
  const expectedGoal=_dailyExpectedQueueTarget(cap);
  const projectedSpare=Math.max(0,Math.floor(_dailyProjectedCandidatePlayers().length/4)-cap.target);
  const preparedGoal=Math.max(expectedGoal,Math.min(6,projectedSpare));
  const prepared=_dailyProjectedQueue(preparedGoal)
    .map((q,idx)=>queuePayload(q,next.length+idx,true))
    .filter(Boolean);
  const expected=prepared.slice(0,expectedGoal);
  const serverStandby=prepared.slice(expectedGoal);
  const readyCount=_dailyEligible().length;
  const visibleReadyCount=_dailyStartedWaitingPlayers().length;
  const assignedReadyIds=new Set();
  [...next,...expected].forEach(item=>(item.playerIds||[]).forEach(id=>assignedReadyIds.add(id)));
  const unassignedReadyCount=_dailyStartedWaitingPlayers().filter(p=>!assignedReadyIds.has(p.id)).length;
  const queuedCount=next.length;
  const expectedCount=expected.length;
  const deferredCount=_dailyDeferredWaitingPlayers().length;
  const finishComplete=!!(_dailyFinishMode&&!queuedCount);
  const policyDetail=finishComplete
    ? '마무리 완료 · 빈 코트는 자율게임'
    : queuedCount
    ? (_dailyFinishMode?`남은 대진 ${queuedCount}경기`:`다음 ${queuedCount}경기 준비됨`)
    : readyCount>=4
      ? (_dailyFinishMode?'새 대진 없음':`미편성 ${unassignedReadyCount}명 · 대진 후보 ${readyCount}명`)
      : (_dailyFinishMode?'새 대진 없음':`미편성 ${unassignedReadyCount}명 · 후보 ${readyCount}명`);
  return {
    mode:_dailyTeamMode?'team':'daily',
    teamMode:_dailyTeamMode,
    operationStarted:_dailyOperationStarted,
    finishMode:_dailyFinishMode,
    paused:_dailyPaused,
    pausedAt:_dailyPausedAt,
    pauseReason:_dailyPaused?_dailyPauseLabel():'',
    pauseRevision:_dailyPauseRevision,
    resumedAt:_dailyResumedAt,
    teamBlue:teamNames.blue,
    teamWhite:teamNames.white,
    completed:st.completed.length,
    activeCount:st.active.length,
    courts:_dailyCourtCount(),
    nextTarget:cap.target,
    nextGoal:cap.goal,
    queuePolicy:{
      auto:!!flowInfo.auto,
      official,
      extra,
      free,
      ready:unassignedReadyCount,
      readyTotal:visibleReadyCount,
      eligible:readyCount,
      deferred:deferredCount,
      queued:queuedCount,
      expected:expectedCount,
      short:!!cap.short,
      finishMode:_dailyFinishMode,
      finishComplete,
      label:finishComplete?'자율게임 전환':(_dailyFinishMode?'마무리':_dailyBalancePolicyText(flowInfo)),
      detail:policyDetail
    },
    active,
    next,
    expected,
    serverExpectedGoal:expectedGoal,
    serverStandby,
    updatedAt:_dailyNow()
  };
}
function dailyRenderResults(){
  const box=document.getElementById('dailyResultBox');
  const summary=document.getElementById('dailyResultSummary');
  if(!box)return;
  const st=_dailyResultStats();
  const hasAny=_dailyMatches.length||st.completed.length||st.active.length;
  if(summary)summary.textContent=hasAny?`(${st.completed.length}경기 완료)`:'';
  if(!hasAny){
    box.className='daily-empty';
    box.textContent='경기가 시작되면 완료 기록과 대진 품질 요약이 여기에 표시됩니다.';
    return;
  }
  const summaryHtml=`<div class="daily-result-banner">완료 ${st.completed.length}경기 · 진행중 ${st.active.length}경기</div>`;
  const chips=_dailyResultQualityChips(st).map(c=>`<span class="daily-quality-chip ${c.cls}">${esc(c.label)}</span>`).join('');
  box.className='daily-result-wrap';
  box.innerHTML=summaryHtml+`<div class="daily-quality-chips">${chips}</div>`;
}
function _dailyCloneStateForUndo(){
  return {
    players:JSON.parse(JSON.stringify(_dailyPlayers)),
    matches:JSON.parse(JSON.stringify(_dailyMatches)),
    queue:JSON.parse(JSON.stringify(_dailyQueue)),
    reservations:JSON.parse(JSON.stringify(_dailyReservations)),
    seq:_dailySeq,
    waveStarts:_dailyWaveStarts
  };
}
function _dailyCompleteUndoGuard(){
  return JSON.stringify({
    players:_dailyPlayers.map(p=>[p.id,p.status,p.currentMatchId||'',p.afterMatchStatus||'',p.games||0,p.lastStatusAt||0]),
    matches:_dailyMatches.map(m=>[m.id,m.court,m.completedAt||0,m.cancelledAt||0,!!m.officialEntryPending,m.officialEntryQueueId||'',...(m.team1||[]),...(m.team2||[])]),
    queue:_dailyQueue.map(q=>[q.id,q.reservationId||'',q.yieldedAt||0,..._dailyQueueIds(q)]),
    reservations:_dailyReservations.map(r=>[r.id,r.mode||'',...(r.team1||[]),...(r.team2||[])])
  });
}
function _dailyCaptureCompleteUndo(token,source){
  if(!token)return;
  _dailyLastCompleteUndo={
    token,
    source:source||'member',
    createdAt:_dailyNow(),
    expiresAt:_dailyNow()+DAILY_COMPLETE_UNDO_MS,
    guard:'',
    state:_dailyCloneStateForUndo()
  };
}
function dailyUndoMemberComplete(token,skipConfirm){
  if(!_dailyLastCompleteUndo||_dailyLastCompleteUndo.token!==token||_dailyNow()>_dailyLastCompleteUndo.expiresAt)return false;
  if(_dailyLastCompleteUndo.guard&&_dailyLastCompleteUndo.guard!==_dailyCompleteUndoGuard()){
    _dailyLastCompleteUndo=null;
    return false;
  }
  if(!skipConfirm&&!confirm('방금 처리한 운영 작업을 되돌릴까요?'))return false;
  const s=_dailyLastCompleteUndo.state;
  _dailyPlayers=JSON.parse(JSON.stringify(s.players||[]));
  _dailyMatches=JSON.parse(JSON.stringify(s.matches||[]));
  _dailyQueue=JSON.parse(JSON.stringify(s.queue||[]));
  _dailyReservations=JSON.parse(JSON.stringify(s.reservations||[]));
  _dailySeq=s.seq||_dailySeq;
  _dailyWaveStarts=s.waveStarts||0;
  _dailyLastCompleteUndo=null;
  _dailyMarkFourCacheDirty();
  dailyEnsureQueue();
  dailySave();
  dailyRender();
  return true;
}
function dailyCompleteMatch(id,winnerSide,options){
  options=options||{};
  if(_dailyBlockPaused({...options,action:'경기를 종료'}))return false;
  const operationAt=Number(options.operationAt)||_dailyNow();
  const m=_dailyMatches.find(x=>x.id===id);
  if(!m||m.completedAt)return false;
  if(options.undoToken)_dailyCaptureCompleteUndo(options.undoToken,options.source||'member-complete');
  if(winnerSide)m.winner=winnerSide;
  const freedCourt=m.court;
  const t1=m.team1.map(_dailyPlayer).filter(Boolean),t2=m.team2.map(_dailyPlayer).filter(Boolean);
  [...t1,...t2].forEach(p=>{
    p.games=(p.games||0)+1;
    p.typeTrackedGames=(p.typeTrackedGames||0)+1;
    if(m.type==='혼복')p.mixedGames=(p.mixedGames||0)+1;
    p.lastPlayedSeq=m.seq;
    const deferredStatus=p.afterMatchStatus?'':_dailyConsumeDeferredStatusRequest(p.id);
    const nextStatus=_dailyNormalizeStatus(p.afterMatchStatus||deferredStatus||'wait');
    p.status=nextStatus;
    p.afterMatchStatus=null;
    p.deferUntil=0;
    p.deferReason='';
    p.currentMatchId=null;
    if(nextStatus==='wait')p.waitFrom=operationAt;
    p.lastStatusAt=operationAt;
    p.restPausedMs=0;
  });
  if(t1.length===2){_dailyInc(t1[0].partnerCount,t1[1].name);_dailyInc(t1[1].partnerCount,t1[0].name);}
  if(t2.length===2){_dailyInc(t2[0].partnerCount,t2[1].name);_dailyInc(t2[1].partnerCount,t2[0].name);}
  t1.forEach(a=>t2.forEach(b=>{_dailyInc(a.opponentCount,b.name);_dailyInc(b.opponentCount,a.name);}));
  m.completedAt=operationAt;
  if(options.awaitOfficialEntry&&freedCourt){
    m.officialEntryPending=true;
    m.officialEntryCourt=freedCourt;
    m.officialEntryPendingAt=operationAt;
    m.officialEntryPendingSource=options.source||'club-official-complete';
  }
  _dailyClearQueueRestPasses('match-complete');
  dailyEnsureQueue();
  const autoStartOk=!options.awaitOfficialEntry&&_dailyAutoFlowEnabled();
  const requestedQueueId=options.queueId||'';
  const nextQueue=autoStartOk
    ? (requestedQueueId?_dailyQueue.find(q=>q.id===requestedQueueId):_dailyQueue[0])
    : null;
  if(nextQueue&&_dailyQueueItemValid(nextQueue,null)){
    dailyStartQueueItem(nextQueue.id,{silent:true,court:freedCourt,auto:true,courtLimit:_dailyAutoCourtLimit()});
  }else{
    dailyEnsureQueue();
  }
  if(options.undoToken&&_dailyLastCompleteUndo?.token===options.undoToken){
    _dailyLastCompleteUndo.guard=_dailyCompleteUndoGuard();
  }
  dailySave();dailyRender();
  return true;
}
function dailyCancelMatch(id){
  if(_dailyBlockPaused({action:'경기를 취소'}))return;
  const m=_dailyMatches.find(x=>x.id===id);
  if(!m||m.completedAt)return;
  if(!confirm('이 진행중 경기를 취소하고 선수들을 참가 상태로 되돌릴까요?'))return;
  [...m.team1,...m.team2].forEach(pid=>{
    const p=_dailyPlayer(pid);
    if(!p)return;
    const afterStatus=_dailyNormalizeStatus(p.afterMatchStatus||'');
    p.status=['rest','done'].includes(afterStatus)?afterStatus:_dailyNormalizeStatus((m.previousStatuses&&m.previousStatuses[pid])||'wait');
    p.afterMatchStatus=null;
    p.deferUntil=0;
    p.deferReason='';
    p.currentMatchId=null;
    if(p.status==='wait')p.waitFrom=_dailyNow();
    p.lastStatusAt=_dailyNow();
    p.restPausedMs=0;
  });
  m.cancelledAt=_dailyNow();
  _dailyWaveStarts=Math.max(0,_dailyWaveStarts-1);
  _dailyMarkFourCacheDirty();
  dailySave();dailyRender();
  dailyMaybeAutoAssign();
}
function dailyOpenFold(detailsId,targetId){
  const details=document.getElementById(detailsId);
  if(details&&details.tagName==='DETAILS')details.open=true;
  const target=document.getElementById(targetId)||details;
  if(target)target.scrollIntoView({behavior:'smooth',block:'start'});
}
function dailyRenderAdminAlerts(){
  const el=document.getElementById('dailyAdminAlerts');
  if(!el)return;
  const area=document.getElementById('dailyAlertArea');
  const flow=_dailyNaturalAutoInfo();
  const alerts=[];
  const activeMatches=_dailyActiveMatches();
  const endingMatches=activeMatches.filter(m=>['soon','due'].includes(_dailyTimerState(m))).sort((a,b)=>(a.court||0)-(b.court||0));
  const readyQueue=_dailyQueue.filter(q=>_dailyQueueItemValid(q,null)&&!_dailyQueueRestPassActive(q)).length;
  const finishPlan=_dailyFinishPlanInfo();
  if(_dailyFinishMode&&readyQueue){
    alerts.push({
      cls:'primary',
      title:'마무리 중',
      desc:`남은 자동대진 ${finishPlan.queued}경기 · ${finishPlan.label}`,
      actions:`<button class="daily-mini-btn" onclick="dailyOpenBoardTarget('queue')">대진 보기</button>`
    });
  }
  if(_dailyFinishMode&&!readyQueue){
    alerts.push({
      cls:'primary',
      title:'자율게임 전환',
      desc:'새 자동대진은 없습니다. 남은 회원은 빈 코트에서 자유게임으로 진행하세요.',
      actions:''
    });
  }
  if(_dailyLastCompleteUndo&&_dailyNow()<=_dailyLastCompleteUndo.expiresAt){
    const remain=Math.max(1,Math.ceil((_dailyLastCompleteUndo.expiresAt-_dailyNow())/1000));
    const undoLabel=['club-official-queue-yield','club-official-active-yield'].includes(_dailyLastCompleteUndo.source)?'이번만 뒤로':_dailyLastCompleteUndo.source==='club-official-queue-enter'?'입장 처리':'코트 종료';
    alerts.push({
      cls:'warn',
      title:`${undoLabel} 완료`,
      desc:'잘못 눌렀다면 바로 취소',
      actions:`<button class="daily-mini-btn danger" onclick="dailyUndoMemberComplete('${_dailyLastCompleteUndo.token}')">${undoLabel} 취소</button><span class="daily-mini-chip" data-daily-undo-sec>${remain}초</span>`
    });
  }
  if(!_dailyStartedPoolCount()&&!_dailyOperationStarted){
    alerts.push({
      cls:'primary',
      title:'현장 참가 등록',
      desc:'도착한 선수만 확인해 등록하세요.',
      actions:`<button class="daily-mini-btn" onclick="dailyImportRoster()">참가자 등록</button>`
    });
  }
  if(_dailyPlayers.length&&endingMatches.length&&readyQueue){
    const courts=endingMatches.map(m=>`${m.court}코트`).join(', ');
    alerts.push({
      cls:'warn',
      title:'입장 준비',
      desc:`${courts} 종료임박 · 다음 대진 ${Math.min(readyQueue,endingMatches.length)}팀 준비`,
      actions:`<button class="daily-mini-btn" onclick="dailyOpenBoardTarget('queue')">대진 보기</button>`
    });
  }
  const courtRec=_dailyCourtRecommendation(flow);
  if(courtRec){
    alerts.push({
      cls:courtRec.cls,
      title:courtRec.title,
      desc:courtRec.desc,
      actions:`<button class="daily-mini-btn" onclick="dailyOpenFold('dailySetupDetails','dailySetupDetails')">코트 설정</button>`
    });
  }
  if(!alerts.length){
    if(area)area.hidden=true;
    el.innerHTML='';
    return;
  }
  if(area)area.hidden=false;
  el.innerHTML=alerts.map(a=>`<div class="daily-admin-alert ${a.cls||''}">
    <div><div class="daily-admin-alert-title">${esc(a.title)}</div>${a.desc?`<div class="daily-admin-alert-desc">${esc(a.desc)}</div>`:''}</div>
    <div class="daily-admin-alert-actions">${a.actions||''}</div>
  </div>`).join('');
}
function dailyCurrentStage(){
  if(!_dailyStartedPoolCount()&&!_dailyOperationStarted)return 'notice';
  if(_dailyActiveMatches().length||_dailyQueue.length)return 'auto';
  return 'ready';
}
function dailyOpenBoardTarget(target){
  const map={
    active:{tab:'daily',id:'dailyActiveCard'},
    queue:{tab:'queue',id:'dailyUrgentCard'},
    request:{tab:'daily',id:'dailyCheckinCard',open:'dailyCheckinDetails'},
    players:{tab:'players',id:'dailyPlayersManage',open:'dailyPlayersManage'},
    rest:{tab:'players',id:'dailyPlayersManage',open:'dailyPlayersManage'},
    setup:{tab:'daily',id:'dailySetupDetails',open:'dailySetupDetails'}
  };
  const cfg=map[target]||map.active;
  if(typeof switchMobileTab==='function')switchMobileTab(cfg.tab||'daily');
  document.querySelectorAll('.bnav-btn').forEach(b=>b.classList.remove('active'));
  const btn=document.getElementById('bnav-'+(cfg.tab||'daily'));
  if(btn)btn.classList.add('active');
  if(cfg.open){
    const fold=document.getElementById(cfg.open);
    if(fold&&fold.tagName==='DETAILS')fold.open=true;
  }
  const el=document.getElementById(cfg.id);
  if(el){
    if(el.tagName==='DETAILS')el.open=true;
    const top=el.getBoundingClientRect().top+window.scrollY-8;
    window.scrollTo({top,behavior:'smooth'});
  }
}
function dailyRenderStartGuide(){
  const el=document.getElementById('dailyStartGuide');
  if(!el)return;
  if(_dailyOperationStarted){
    el.hidden=true;
    el.innerHTML='';
    return;
  }
  const courts=_dailyCourtCount();
  const playerCount=_dailyStartedPoolCount();
  const nextIndex=!playerCount?2:0;
  const steps=[
    {n:1,title:'코트',value:`${courts}코트`,done:true,current:false,action:"dailyOpenFold('dailySetupDetails','dailySetupDetails')"},
    {n:2,title:'현장 참가',value:playerCount?`${playerCount}명`:'등록',done:!!playerCount,current:nextIndex===2,action:playerCount?"dailyOpenBoardTarget('players')":"dailyImportRoster()"}
  ];
  const requiredDone=1+(playerCount?1:0);
  el.hidden=false;
  el.innerHTML=`<div class="daily-start-guide-head">
    <div>
      <div class="daily-start-guide-title">운영 준비</div>
      <div class="daily-start-guide-sub">참가 등록 후 자유게임을 진행하세요. 게시할 때 계속 뛰는 경기만 먼저 등록합니다.</div>
    </div>
    <div class="daily-start-guide-count">${requiredDone}/2</div>
  </div>
  <div class="daily-start-guide-list">
    ${steps.map(s=>`<button type="button" class="daily-start-step ${s.done?'done':''} ${s.current?'current':''}" onclick="${s.action}">
      <span class="daily-start-step-num">${s.done?'✓':s.n}</span>
      <strong>${esc(s.title)}</strong>
      <span>${esc(s.value)}</span>
    </button>`).join('')}
  </div>`;
}
function dailyRenderOpsStats(){
  const el=document.getElementById('dailyOpsStats');
  if(!el)return;
  const transitionBtn=document.getElementById('dailyTransitionBtn');
  const showTransition=!_dailyOperationStarted;
  if(transitionBtn)transitionBtn.style.display=showTransition?'flex':'none';
  const finishBtn=document.getElementById('dailyFinishBtn');
  const showFinish=!!_dailyOperationStarted;
  if(finishBtn){
    finishBtn.style.display=showFinish?'flex':'none';
    const finishPlan=_dailyFinishPlanInfo();
    finishBtn.innerHTML=_dailyFinishMode
      ? `<span>마무리 취소</span><small>${finishPlan.queued?`남은 ${finishPlan.queued}경기 · ${finishPlan.label}`:'자율게임 전환'}</small>`
      : '<span>마무리</span><small>새 대진 중지</small>';
    finishBtn.classList.toggle('active',_dailyFinishMode);
    finishBtn.disabled=_dailyPaused||_dailyPauseSyncBusy;
  }
  const pauseBtn=document.getElementById('dailyPauseBtn');
  const showPause=!!_dailyOperationStarted;
  if(pauseBtn){
    pauseBtn.style.display=showPause?'flex':'none';
    pauseBtn.innerHTML=_dailyPaused
      ? '<span>진행 재개</span><small>멈춘 시간부터 이어가기</small>'
      : '<span>진행 일시 정지</span><small>생일축하·공지</small>';
    pauseBtn.classList.toggle('active',_dailyPaused);
    pauseBtn.disabled=_dailyPauseSyncBusy;
  }
  const controlStrip=document.querySelector('.daily-live-control-strip');
  if(controlStrip)controlStrip.classList.toggle('single',Number(showTransition)+Number(showPause)+Number(showFinish)===1);
  const pauseNotice=document.getElementById('dailyPauseNotice');
  if(pauseNotice){
    pauseNotice.hidden=!_dailyPaused;
    pauseNotice.innerHTML=_dailyPaused
      ? `<strong>진행 일시 정지</strong><span>${esc(_dailyPauseLabel())} 중입니다. 경기 타이머와 다음 대진 순서는 그대로 멈춰 있습니다.</span>`
      : '';
  }
  dailyRenderStartGuide();
  const courts=_dailyCourtCount();
  const activeMatches=_dailyActiveMatches();
  const active=activeMatches.length;
  const endingSoon=activeMatches.filter(m=>['soon','due'].includes(_dailyTimerState(m))).length;
  const locked=Math.min(_dailyQueueLockCount(),_dailyQueue.length);
  const rest=_dailyPlayers.filter(p=>p.status==='rest').length;
  const guestLive=_dailyPlayers.filter(p=>p.status!=='done'&&p.status!=='planned'&&p.status!=='invited'&&p.isGuest).length;
  const cap=_dailyQueueCapacity();
  const expectedCount=_dailyProjectedQueue(_dailyExpectedQueueTarget(cap)).length;
  const flow=_dailyNaturalAutoInfo();
  const finishComplete=!!(_dailyFinishMode&&!locked);
  const finishPlan=_dailyFinishPlanInfo();
  const courtHint=_dailyPaused
    ? '타이머 정지'
    : endingSoon
    ? `${endingSoon}코트 종료임박`
    : active
      ? `${courts}코트 기준`
      : '게시 전';
  const queueValue=expectedCount?`${locked}+${expectedCount}`:String(locked||0);
  const queueHint=_dailyPaused
    ? '재개 후 순서 유지'
    : locked||expectedCount
    ? (_dailyFinishMode?`${finishPlan.label}`:`다음 ${locked} · 예상 ${expectedCount}`)
    : flow.auto
      ? '자동 편성 대기'
      : flow.hint;
  const liveHint=_dailyPaused
    ? _dailyPauseLabel()
    : rest
    ? `휴식 ${rest}`
    : guestLive
      ? `게스트 ${guestLive}`
      : flow.label;
  const cards=[
    {label:'진행',value:`${active}/${courts}`,hint:courtHint,cls:'primary',target:'active'},
    {label:'대진',value:_dailyFinishMode?(locked||0):(flow.auto?queueValue:(_dailyOperationStarted?'대기':'게시 전')),hint:_dailyFinishMode?(finishComplete?'자율게임':(locked?finishPlan.label:'새 대진 없음')):queueHint,cls:'primary',target:'queue'},
    {label:'라이브',value:flow.pool,hint:liveHint,cls:flow.auto?'primary':'warn',target:'players'}
  ];
  el.innerHTML=cards.map(x=>`<button type="button" class="daily-op ${x.cls||''} is-link" onclick="dailyOpenBoardTarget('${esc(x.target)}')" aria-label="${esc(x.label)} 보기"><b>${esc(String(x.value))}</b><span>${esc(x.label)}</span><small>${esc(x.hint)}</small></button>`).join('');
  dailyRenderStatusBar();
  dailyRenderAdminAlerts();
}
function dailyRenderStatusBar(){
  const courts=_dailyCourtCount();
  const todo=dailyCountActionItems();
  const flowInfo=_dailyNaturalAutoInfo();
  const stage=dailyCurrentStage();
  const stageLabel=_dailyPaused?'일시 정지':(_dailyFinishMode?'마무리':(!_dailyOperationStarted?'자유게임':({notice:'참가 등록',ready:'게시 준비',auto:'자동대진',finish:'자동종료'}[stage]||'운영')));
  const entryReady=_dailyActiveMatches().some(m=>['soon','due'].includes(_dailyTimerState(m)))&&_dailyQueue.some(q=>_dailyQueueItemValid(q,null)&&!_dailyQueueRestPassActive(q));
  const chips=[];
  const flow=document.getElementById('dailyFlowState');
  if(flow){
    flow.classList.toggle('need',!_dailyPaused&&!!todo);
    flow.classList.toggle('paused',_dailyPaused);
    flow.innerHTML=`<span class="daily-dot"></span> ${_dailyPaused?'진행 일시 정지':todo?(entryReady?'입장 준비':`조치 ${todo}건`):flowInfo.label}`;
  }
  const autoHint=document.getElementById('dailyAutoFlowHint');
  if(autoHint){
    autoHint.textContent=flowInfo.hint;
  }
  document.querySelectorAll('[data-daily-stage]').forEach(node=>node.classList.toggle('active',node.dataset.dailyStage===stage));
  const el=document.getElementById('dailyStatusBar');
  if(!el)return;
  chips.push(`<span class="daily-sb-chip live">${stageLabel}</span>`);
  chips.push(`<span class="daily-sb-chip ${_dailyPaused?'warn':flowInfo.auto?'on':flowInfo.phase==='warmup'?'warn':'off'}">${_dailyPaused?'타이머·투입 정지':flowInfo.label}</span>`);
  chips.push(`<span class="daily-sb-chip balance">${_dailyBalancePolicyText(flowInfo)}</span>`);
  chips.push(`<span class="daily-sb-chip">참가 ${flowInfo.pool}명</span>`);
  chips.push(`<span class="daily-sb-chip">${flowInfo.auto?`${flowInfo.operatingCourts}/${courts}`:courts}코트</span>`);
  const stateChip=_dailyPaused
    ? `<span class="daily-sb-state need">${esc(_dailyPauseLabel())} 중</span>`
    : todo
    ? `<span class="daily-sb-state need">${entryReady?'입장 준비':`처리 필요 ${todo}건`}</span>`
    : `<span class="daily-sb-state ok">특이사항 없음</span>`;
  el.className='daily-statusbar'+(_dailyPaused||todo?' need':'');
  el.innerHTML=`<div class="daily-sb-chips">${chips.join('')}</div>${stateChip}`;
}
function dailyCountActionItems(){
  if(_dailyPaused)return 0;
  if(!_dailyStartedPoolCount()&&!_dailyOperationStarted)return 1;
  const endingMatches=_dailyActiveMatches().filter(m=>['soon','due'].includes(_dailyTimerState(m)));
  const readyQueue=_dailyQueue.filter(q=>_dailyQueueItemValid(q,null)&&!_dailyQueueRestPassActive(q)).length;
  return endingMatches.length&&readyQueue?1:0;
}
function dailyRenderUnscheduled(){
  const el=document.getElementById('dailyUnscheduledBox');
  if(!el)return;
  const players=_dailyStartedWaitingPlayers().filter(p=>!_dailyIsQueued(p.id)).sort((a,b)=>{
    const da=_dailyIsDeferred(a), db=_dailyIsDeferred(b);
    if(da!==db)return da?1:-1;
    if((a.games||0)!==(b.games||0))return (a.games||0)-(b.games||0);
    return (a.waitFrom||0)-(b.waitFrom||0);
  });
  if(!players.length){
    el.className='daily-empty';
    el.textContent='대기 없음';
    return;
  }
  el.className='daily-unscheduled-list';
  el.innerHTML=players.map(p=>{
    const defer=_dailyDeferLabel(p);
    return `<div class="daily-unscheduled-row">
    <div>
      <div class="daily-unscheduled-name">${_dailyNameHtml(p)} ${_dailyStatusBadge(p.status)}${defer?` <span class="daily-status-badge warn">${esc(defer)}</span>`:''}</div>
      <div class="daily-unscheduled-meta">${_dailyGenderLabel(p.gender)} · ${esc(p.grade||'C')}급 · 오늘 ${p.games||0}게임 · 대기 ${_dailyMinutes(p.waitFrom)}분${defer?` · ${esc(defer)}`:''}</div>
    </div>
    <div class="daily-player-actions"></div>
  </div>`;
  }).join('');
}
function _dailyCheckinStatusLabel(status){
  status=_dailyNormalizeStatus(status);
  return (DAILY_STATUS[status]&&DAILY_STATUS[status].label)||status||'';
}
function _dailyCheckinAllowedStatus(status){
  return ['wait','rest','done'].includes(_dailyNormalizeStatus(status));
}
function _dailyCheckinGenId(){
  const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s='D';for(let i=0;i<7;i++)s+=c[Math.floor(Math.random()*c.length)];
  return s;
}
function _dailyPersistServerIdentity(){
  try{
    const raw=localStorage.getItem(DAILY_KEY);
    if(!raw)return;
    const state=JSON.parse(raw);
    if(state.mode&&state.mode!=='daily'&&state.appMode!=='dailyLive')return;
    state.serverRevision=_dailyServerRevision;
    state.officialInviteToken=_dailyOfficialInviteToken;
    state.officialInviteHash=_dailyOfficialInviteHash;
    localStorage.setItem(DAILY_KEY,JSON.stringify(state));
  }catch(e){}
}
function _dailyCapabilityToken(){
  const cryptoApi=globalThis.crypto;
  if(!cryptoApi?.getRandomValues)return '';
  const bytes=new Uint8Array(24);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
async function _dailyCapabilityDigest(value){
  if(!value||!globalThis.crypto?.subtle||typeof TextEncoder==='undefined')return '';
  const input=new TextEncoder().encode(value);
  const digest=await globalThis.crypto.subtle.digest('SHA-256',input);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
async function _dailyEnsureOfficialCapability(){
  if(_dailyOfficialInviteToken&&_dailyOfficialInviteHash)return true;
  if(_dailyCapabilityPromise)return _dailyCapabilityPromise;
  _dailyCapabilityPromise=(async()=>{
    if(!_dailyOfficialInviteToken)_dailyOfficialInviteToken=_dailyCapabilityToken();
    if(!_dailyOfficialInviteToken)return false;
    _dailyOfficialInviteHash=await _dailyCapabilityDigest(_dailyOfficialInviteToken);
    if(!_dailyOfficialInviteHash){_dailyOfficialInviteToken='';return false;}
    _dailyPersistServerIdentity();
    return true;
  })();
  try{return await _dailyCapabilityPromise;}
  finally{_dailyCapabilityPromise=null;}
}
function _dailyAdminGrantKey(){
  return _dailyCheckinId?`kokmatch_daily_admin_grant_${_dailyCheckinId}`:'';
}
function _dailyClearAdminGrant(preserveSyncState){
  const key=_dailyAdminGrantKey();
  if(key)try{localStorage.removeItem(key);}catch(e){}
  _dailyAdminGrantToken='';
  _dailyAdminGrantExpiresAt=0;
  if(!preserveSyncState){
    _dailyServerSyncBusy=false;
    _dailyServerSyncQueued=false;
  }
}
function _dailyAdminClientId(){
  const key='kokmatch_daily_admin_client_v1';
  try{
    let id=localStorage.getItem(key)||'';
    if(id)return id;
    const bytes=new Uint8Array(18);
    globalThis.crypto.getRandomValues(bytes);
    id='admin_'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    localStorage.setItem(key,id);
    return id;
  }catch(e){return 'admin_'+_dailyNow().toString(36)+'_'+Math.random().toString(36).slice(2,12);}
}
function _dailyLoadAdminGrant(){
  const key=_dailyAdminGrantKey();
  if(!key)return false;
  try{
    const saved=JSON.parse(localStorage.getItem(key)||'null');
    if(!saved?.token||_dailyNow()>=Number(saved.expiresAt||0)){localStorage.removeItem(key);return false;}
    _dailyAdminGrantToken=saved.token;
    _dailyAdminGrantExpiresAt=Number(saved.expiresAt||0);
    return true;
  }catch(e){return false;}
}
async function _dailyEnsureAdminGrant(forceRefresh){
  if(!forceRefresh&&_dailyAdminGrantToken&&_dailyNow()<_dailyAdminGrantExpiresAt)return true;
  if(!forceRefresh&&_dailyLoadAdminGrant())return true;
  if(forceRefresh){
    _dailyAdminGrantToken='';
    _dailyAdminGrantExpiresAt=0;
    try{localStorage.removeItem(_dailyAdminGrantKey());}catch(e){}
  }
  if(!_dailyCheckinId||!_dailyOfficialInviteToken||typeof firebase==='undefined'||typeof firebase.functions!=='function')return false;
  try{
    const callable=firebase.functions().httpsCallable('claimDailyOfficialInvite');
    const result=await callable({checkinId:_dailyCheckinId,inviteToken:_dailyOfficialInviteToken,clientId:_dailyAdminClientId()});
    const grant=result?.data||{};
    if(!grant.grantToken||!grant.expiresAt)return false;
    _dailyAdminGrantToken=grant.grantToken;
    _dailyAdminGrantExpiresAt=Number(grant.expiresAt||0);
    localStorage.setItem(_dailyAdminGrantKey(),JSON.stringify({token:_dailyAdminGrantToken,expiresAt:_dailyAdminGrantExpiresAt}));
    return true;
  }catch(e){
    _dailyServerReconcileError='서버 운영 연결을 확인하지 못했습니다.';
    return false;
  }
}
async function _dailyPullServerReconcile(retriedGrant){
  if(_dailyServerSyncBusy){_dailyServerSyncQueued=true;return false;}
  if(!_dailyCheckinId||!_dailyOfficialInviteHash)return false;
  _dailyServerSyncBusy=true;
  let retryWithFreshGrant=false;
  try{
    if(!await _dailyEnsureAdminGrant())return false;
    const callable=firebase.functions().httpsCallable('getDailyOfficialReconcile');
    const result=await callable({checkinId:_dailyCheckinId,grantToken:_dailyAdminGrantToken,sinceRevision:_dailyServerRevision});
    const data=result?.data||{};
    const serverRevision=Math.max(0,Number(data.serverRevision||0));
    if(serverRevision<=_dailyServerRevision){
      _dailyServerReconcileError='';
      dailyProcessCheckinRequests();
      dailyPushCheckinSession();
      dailyRenderCheckinRequests();
      return true;
    }
    const trusted=(data.commands||[])
      .filter(req=>req&&req.serverAppliedAt&&Number(req.serverRevision||0)>_dailyServerRevision)
      .sort((a,b)=>Number(a.serverRevision||0)-Number(b.serverRevision||0));
    const pending=_dailyCheckinRequests.filter(req=>!req.serverAppliedAt&&!req.serverRejectedAt);
    _dailyCheckinRequests=[...trusted,...pending];
    dailyProcessCheckinRequests();
    if(_dailyServerRevision!==serverRevision){
      _dailyServerReconcileError='서버 운영 기록 일부를 관리자 원본에 연결하지 못했습니다.';
      return false;
    }
    dailyPushCheckinSession();
    dailyRenderCheckinRequests();
    return true;
  }catch(e){
    if(!retriedGrant&&e?.code==='functions/permission-denied'){
      _dailyClearAdminGrant(true);
      retryWithFreshGrant=await _dailyEnsureAdminGrant(true);
    }
    if(!retryWithFreshGrant){
      _dailyServerReconcileError='서버 운영 결과를 가져오지 못했습니다.';
      dailyRenderCheckinRequests();
    }
    return false;
  }finally{
    _dailyServerSyncBusy=false;
    if(retryWithFreshGrant){
      _dailyServerSyncQueued=false;
      setTimeout(()=>_dailyPullServerReconcile(true).catch(()=>{}),0);
    }else if(_dailyServerSyncQueued){
      _dailyServerSyncQueued=false;
      setTimeout(()=>_dailyPullServerReconcile().catch(()=>{}),0);
    }
  }
}
function _dailyServerRuntimePayload(){
  const holds={};
  _dailyMatches.forEach(match=>{
    if(!match?.completedAt||match.cancelledAt||!match.officialEntryPending)return;
    const court=parseInt(match.officialEntryCourt||match.court,10);
    if(!court)return;
    holds[String(court)]={
      id:_dailyCourtEntryHoldId(match),
      court,
      sourceMatchId:match.id||'',
      createdAt:Number(match.officialEntryPendingAt||match.completedAt||0)
    };
  });
  return {holds,nextSeq:_dailySeq};
}
function _dailyFirstMatchStartedAt(){
  const starts=_dailyMatches.map(m=>m.startedAt||0).filter(Boolean);
  return starts.length?Math.min(...starts):0;
}
function _dailyCheckinExpiresAt(){
  const startedAt=_dailyFirstMatchStartedAt();
  const base=startedAt||_dailyCheckinCreatedAt||0;
  return base?base+DAILY_CHECKIN_TTL_MS:0;
}
function _dailyCheckinExpired(){
  const expiresAt=_dailyCheckinExpiresAt();
  return !!(_dailyCheckinId&&expiresAt&&_dailyNow()>=expiresAt);
}
function _dailyExpireCheckinLink(silent){
  if(!_dailyCheckinId)return false;
  if(typeof _dailyStopOperatorHeartbeat==='function')_dailyStopOperatorHeartbeat();
  _dailyStopCheckinListener();
  const path=_dailyCheckinPath();
  if(_fbDb&&path)_fbDb.ref(path).remove().catch(()=>{});
  _dailyClearAdminGrant();
  _dailyCheckinId=null;
  _dailyCheckinCreatedAt=0;
  _dailyCheckinRequests=[];
  _dailyCheckinParty={};
  _dailyServerRevision=0;
  _dailyOfficialInviteToken='';
  _dailyOfficialInviteHash='';
  _dailyCapabilityPromise=null;
  _dailyServerReconcileError='';
  localStorage.removeItem(DAILY_CHECKIN_KEY);
  localStorage.removeItem(DAILY_CHECKIN_CREATED_KEY);
  if(!silent)alert('민턴LIVE 링크가 대진 시작 후 48시간이 지나 자동 종료되었습니다. 새 링크를 만들어 공유해 주세요.');
  return true;
}
function _dailyCheckinUrl(){
  if(!_dailyCheckinId)return '';
  const base=location.origin+location.pathname.replace(/[^/]*$/,'');
  return base+'checkin.html?id='+_dailyCheckinId;
}
function _dailyOfficialCheckinUrl(){
  if(!_dailyCheckinId||!_dailyOfficialInviteToken)return '';
  const base=location.origin+location.pathname.replace(/[^/]*$/,'');
  const capability=`${_dailyCheckinId}.${_dailyOfficialInviteToken}`;
  return base+'checkin.html?official='+encodeURIComponent(capability);
}
function _dailyCheckinPath(){
  return _dailyCheckinId?'live/checkin_'+_dailyCheckinId:'';
}
function _dailyStopOperatorHeartbeat(){
  if(_dailyOperatorHeartbeatId)clearInterval(_dailyOperatorHeartbeatId);
  _dailyOperatorHeartbeatId=null;
  if(_dailyOperatorWakeLock){_dailyOperatorWakeLock.release().catch(()=>{});_dailyOperatorWakeLock=null;}
}
async function _dailyRequestOperatorWakeLock(){
  if(_dailyOperatorWakeLock||document.hidden||!navigator.wakeLock||!_dailyCheckinId)return;
  try{
    _dailyOperatorWakeLock=await navigator.wakeLock.request('screen');
    _dailyOperatorWakeLock.addEventListener('release',()=>{_dailyOperatorWakeLock=null;});
  }catch(e){}
}
function _dailyPushOperatorHeartbeat(){
  if(!_dailyCheckinId||!_fbDb||document.hidden)return;
  _fbDb.ref(_dailyCheckinPath()+'/operator').set({
    heartbeatAt:_dailyNow(),
    version:APP_VERSION,
    serverSessionId:_dailyCheckinId||'',
    operationStarted:!!_dailyOperationStarted
  }).catch(()=>{});
}
function _dailyStartOperatorHeartbeat(){
  if(typeof _dailyStopOperatorHeartbeat==='function')_dailyStopOperatorHeartbeat();
  if(!_dailyCheckinId||!_fbDb)return;
  _dailyPushOperatorHeartbeat();
  _dailyRequestOperatorWakeLock();
  _dailyOperatorHeartbeatId=setInterval(()=>{
    _dailyPushOperatorHeartbeat();
    _dailyRequestOperatorWakeLock();
  },DAILY_OPERATOR_HEARTBEAT_MS);
}
function _dailyOfficialArrivalRoster(){
  const clubs=(rosters.clubs||[]).filter(club=>(club.members||[]).some(member=>member&&member.name));
  if(!clubs.length)return null;
  const players=_dailyPlayers.filter(player=>player&&player.name&&!player.isGuest);
  const ranked=clubs.map(club=>{
    const clubName=String(club.name||'');
    const memberIds=new Set();
    const memberNames=new Set();
    (club.members||[]).forEach(member=>{
      if(!member?.name)return;
      const profile={...member,club:clubName||member.club||''};
      memberIds.add(member.memberId||_rsvpMemberId(profile));
      memberNames.add(_rsvpNameKey(member.name));
    });
    let score=0;
    players.forEach(player=>{
      if(clubName&&String(player.club||'')===clubName)score+=8;
      if(player.memberId&&memberIds.has(player.memberId))score+=5;
      else if(memberNames.has(_rsvpNameKey(player.name)))score+=1;
    });
    return {club,score};
  }).sort((a,b)=>b.score-a.score);
  if(ranked[0].score>0&&(!ranked[1]||ranked[0].score>ranked[1].score))return ranked[0].club;
  return clubs.length===1?clubs[0]:null;
}
function _dailyOfficialArrivalRosterProfile(memberId){
  const club=_dailyOfficialArrivalRoster();
  if(!club||!memberId)return null;
  const clubName=club.name||'';
  const member=(club.members||[]).find(item=>{
    if(!item?.name)return false;
    const profile={...item,club:clubName||item.club||''};
    return String(item.memberId||_rsvpMemberId(profile))===String(memberId);
  });
  if(!member)return null;
  return {...member,club:clubName||member.club||'',memberId:member.memberId||_rsvpMemberId({...member,club:clubName||member.club||''})};
}
function _dailyHasRosterPlayer(profile){
  if(!profile)return false;
  const memberId=String(profile.memberId||'');
  const nameKey=_rsvpNameKey(profile.name);
  return _dailyPlayers.some(player=>{
    if(!player)return false;
    if(memberId&&String(player.memberId||'')===memberId)return true;
    return _rsvpNameKey(player.name)===nameKey&&(!profile.club||!player.club||String(player.club)===String(profile.club));
  });
}
function _dailyOfficialArrivalCandidates(){
  const candidates=_dailyPlayers
    .filter(player=>player?.name&&['invited','planned'].includes(String(player.status||'')))
    .map(player=>({
      candidateKey:`player:${player.id}`,
      kind:'existing',
      playerId:player.id,
      name:player.name,
      status:String(player.status||''),
      lastStatusAt:player.lastStatusAt||0
    }));
  const club=_dailyOfficialArrivalRoster();
  if(club){
    const clubName=club.name||'';
    (club.members||[]).forEach(member=>{
      if(!member?.name)return;
      const profile={...member,club:clubName||member.club||''};
      profile.memberId=member.memberId||_rsvpMemberId(profile);
      if(_dailyHasRosterPlayer(profile))return;
      candidates.push({
        candidateKey:`roster:${profile.memberId}`,
        kind:'roster',
        memberId:profile.memberId,
        name:profile.name,
        grade:profile.grade||'C',
        level:profile.level||gradeToLevel(profile.grade||'C',_dailyGenderLabel(profile.gender))||4,
        gender:_dailyGender(profile.gender||'남'),
        ageGroup:profile.ageGroup||'40대',
        club:profile.club||clubName||'',
        isClubOfficial:!!profile.isClubOfficial
      });
    });
  }
  return candidates.sort((a,b)=>String(a.name).localeCompare(String(b.name),'ko'));
}
function _dailyCheckinPayload(){
  return {
    title:'콕매치 민턴LIVE 내 경기',
    serverSessionId:_dailyCheckinId||'',
    updatedAt:_dailyNow(),
    createdAt:_dailyCheckinCreatedAt||_dailyNow(),
    matchStartedAt:_dailyFirstMatchStartedAt(),
    expiresAt:_dailyCheckinExpiresAt(),
    version:APP_VERSION,
    commandProtocol:_dailyOfficialInviteHash?DAILY_OFFICIAL_COMMAND_PROTOCOL:1,
    serverRevision:_dailyServerRevision,
    pauseRevision:_dailyPauseRevision,
    officialInvite:_dailyOfficialInviteHash?{
      tokenHash:_dailyOfficialInviteHash,
      expiresAt:_dailyCheckinExpiresAt()||(_dailyNow()+DAILY_CHECKIN_TTL_MS),
      maxClaims:Math.min(20,Math.max(8,_dailyPlayers.filter(player=>player.isClubOfficial).length*2+2))
    }:null,
    serverRuntime:_dailyServerRuntimePayload(),
    voteDeadlineAt:'',
    voteDeadlineTs:null,
    voteClosed:false,
    capabilities:{officialOpsV1:true,officialOpsServerV2:!!_dailyOfficialInviteHash,officialArrivalV1:true,officialPartnerOpsV1:true,officialQueueYieldV1:true,officialQueueYieldV2:true,officialQueueCardOpsV1:true,officialAutoHandoffV1:!!_dailyOfficialInviteHash,officialOperationUndoV1:true,pauseV1:true,afterPartyV1:true},
    event:_dailyPublicEvent(),
    arrivalCandidates:_dailyOfficialArrivalCandidates(),
    players:_dailyPlayers
      .filter(p=>p.name)
      .sort((a,b)=>a.name.localeCompare(b.name,'ko'))
      .map(p=>({
        id:p.id,
        memberId:p.memberId||'',
        name:p.name,
        grade:p.grade||'C',
        level:_dailyLevel(p),
        gender:_dailyGender(p.gender),
        ageGroup:p.ageGroup||'40대',
        club:p.club||'',
        status:_dailyNormalizeStatus(p.status),
        statusLabel:_dailyCheckinStatusLabel(p.status),
        lastStatusAt:p.lastStatusAt||0,
        isGuest:!!p.isGuest,
        isClubOfficial:!!p.isClubOfficial,
        games:p.games||0,
        mixedGames:p.mixedGames||0,
        typeTrackedGames:p.typeTrackedGames||0,
        joinedAt:p.joinedAt||0,
        waitFrom:p.waitFrom||0,
        restPausedMs:Number(p.restPausedMs||0),
        deferUntil:Number(p.deferUntil||0),
        afterMatchStatus:p.afterMatchStatus||'',
        currentMatchId:p.currentMatchId||'',
        voteLocked:false,
        locked:p.status==='playing'||!!p.currentMatchId
      })),
    reservations:_dailyReservations.map(r=>{
      const status=_dailyReservationStatus(r);
      return {
        id:r.id,
        mode:r.mode==='match'?'match':'pair',
        team1:[...(r.team1||[])],
        team2:[...(r.team2||[])],
        label:_dailyReservationLabel(r),
        statusText:status.text||'예약 대기 중',
        statusDetail:status.detail||'',
        statusClass:status.cls||'',
        ready:!!status.ready,
        createdAt:r.createdAt||0
      };
    }),
    statuses:[
      {key:'wait',label:'복귀',desc:''},
      {key:'rest',label:'휴식',desc:''},
      {key:'done',label:'종료',desc:''}
    ]
  };
}
function dailyEnsureCheckinId(){
  if(!_dailyCheckinId){
    _dailyCheckinId=localStorage.getItem(DAILY_CHECKIN_KEY)||null;
    _dailyCheckinCreatedAt=parseInt(localStorage.getItem(DAILY_CHECKIN_CREATED_KEY)||'0',10)||0;
  }
  if(_dailyCheckinExpired())_dailyExpireCheckinLink(true);
  if(!_dailyCheckinId){
    _dailyClearAdminGrant();
    _dailyCheckinId=_dailyCheckinGenId();
    _dailyCheckinCreatedAt=_dailyNow();
    _dailyServerRevision=0;
    _dailyOfficialInviteToken='';
    _dailyOfficialInviteHash='';
    localStorage.setItem(DAILY_CHECKIN_KEY,_dailyCheckinId);
    localStorage.setItem(DAILY_CHECKIN_CREATED_KEY,String(_dailyCheckinCreatedAt));
  }
  return _dailyCheckinId;
}
function _dailyWriteCheckinPayload(path){
  const payload=_dailyCheckinPayload();
  const payloadServerRevision=Math.max(0,Number(payload.serverRevision||0));
  const payloadPauseRevision=Math.max(0,Number(payload.event?.pauseRevision||payload.pauseRevision||0));
  return _fbDb.ref(path+'/session').transaction(current=>{
    const remoteRevision=Math.max(0,Number(current?.serverRevision||0));
    const remotePauseRevision=Math.max(0,Number(current?.event?.pauseRevision||current?.pauseRevision||0));
    if(remoteRevision>payloadServerRevision||remotePauseRevision>payloadPauseRevision)return;
    return payload;
  },undefined,false).then(result=>{
    if(!result.committed){
      const remote=result.snapshot?.val()||{};
      if(Number(remote.serverRevision||0)>_dailyServerRevision){
        console.info('민턴LIVE 서버 상태가 더 최신이라 로컬 게시를 보류했습니다.');
      }
      if(Number(remote.event?.pauseRevision||remote.pauseRevision||0)>_dailyPauseRevision){
        _dailyAdoptRemotePauseEvent(remote.event||{});
        console.info('민턴LIVE 일시정지 상태가 더 최신이라 해당 상태를 유지했습니다.');
      }
    }
    return result;
  });
}
function dailyPushCheckinSession(){
  if(!_dailyCheckinId||!_fbDb)return;
  if(_dailyCheckinExpired()){
    _dailyExpireCheckinLink(true);
    dailyRenderCheckinRequests();
    return;
  }
  if(!_dailyOfficialInviteHash){
    _dailyEnsureOfficialCapability().then(ok=>{if(ok&&_dailyCheckinId)dailyPushCheckinSession();}).catch(()=>{});
    return;
  }
  const path=_dailyCheckinPath();
  _fbDb.ref(path).update({kind:'dailyCheckin',updatedAt:_dailyNow()}).catch(()=>{});
  _dailyWriteCheckinPayload(path).catch(()=>{});
  _dailyPushOperatorHeartbeat();
}
async function dailyPublishCheckinSession(silent){
  if(!_dailyPlayers.length){
    if(!silent)alert('먼저 민턴LIVE 명단을 추가하거나 명부를 가져오세요.');
    return null;
  }
  if(!_fbInit()){
    if(!silent)alert('민턴LIVE 공용 링크 서버 연결에 실패했어요. 네트워크를 확인해 주세요.');
    return null;
  }
  const id=dailyEnsureCheckinId();
  await _dailyEnsureOfficialCapability();
  const path=_dailyCheckinPath();
  await _fbDb.ref(path).update({kind:'dailyCheckin',createdAt:_dailyCheckinCreatedAt,matchStartedAt:_dailyFirstMatchStartedAt(),expiresAt:_dailyCheckinExpiresAt(),updatedAt:_dailyNow()});
  await _dailyWriteCheckinPayload(path);
  dailyStartCheckinListener();
  _dailyStartOperatorHeartbeat();
  dailyRenderCheckinRequests();
  return id;
}
async function dailyShareCheckinLink(){
  _dailyVoteDeadlineAt='';
  const id=await dailyPublishCheckinSession(false);
  if(!id)return;
  const url=_dailyCheckinUrl();
  const text='🏸 민턴LIVE\n내 이름을 눌러 오늘 경기를 확인하세요.';
  const clipboardText=`${text}\n\n${url}`;
  try{
    if(navigator.share){
      await navigator.share({title:'민턴LIVE',text,url});
      return;
    }
  }catch(e){
    if(e&&e.name==='AbortError')return;
  }
  try{
    await navigator.clipboard.writeText(clipboardText);
    alert('회원·임원 공용 링크 문구를 복사했습니다. 카톡방에 붙여넣어 주세요.\n\n'+url);
  }catch(e){
    console.warn('민턴LIVE 공유 문구 복사 실패', e);
  }
}
async function dailyShareOfficialLink(){
  _dailyVoteDeadlineAt='';
  const id=await dailyPublishCheckinSession(false);
  if(!id)return;
  if(!_dailyOfficialInviteToken){
    alert('임원 운영 연결을 만들지 못했습니다. 보안 연결을 지원하는 브라우저에서 다시 시도해 주세요.');
    return;
  }
  if(!await _dailyEnsureAdminGrant(true)){
    alert('서버 임원 운영 연결을 확인하지 못했습니다. 네트워크를 확인한 뒤 임원 링크 공유를 다시 눌러 주세요.');
    return;
  }
  const url=_dailyOfficialCheckinUrl();
  const text=`🏸 민턴LIVE 임원 운영\n링크를 열고 내 이름을 선택하세요.\n\n`+url;
  try{
    if(navigator.share){await navigator.share({title:'콕매치 민턴LIVE 임원 운영',text,url});return;}
  }catch(e){}
  try{
    await navigator.clipboard.writeText(text);
    alert('임원 운영 링크를 복사했습니다. 운영을 도울 임원에게만 보내 주세요.');
  }catch(e){
    alert('임원 운영 링크입니다. 운영을 도울 임원에게만 보내 주세요.\n\n'+url);
  }
}
function dailyResumeCheckin(){
  _dailyCheckinId=localStorage.getItem(DAILY_CHECKIN_KEY)||null;
  _dailyCheckinCreatedAt=parseInt(localStorage.getItem(DAILY_CHECKIN_CREATED_KEY)||'0',10)||0;
  if(_dailyCheckinId&&_fbInit()){
    if(_dailyCheckinExpired()){
      _dailyExpireCheckinLink(true);
      return;
    }
    dailyStartCheckinListener();
    _dailyStartOperatorHeartbeat();
    _dailyEnsureOfficialCapability().catch(()=>{});
  }
}
function dailyStartCheckinListener(){
  if(!_dailyCheckinId||!_fbDb)return;
  const path=_dailyCheckinPath();
  if(_dailyCheckinListening&&_dailyCheckinListeningPath===path)return;
  if(_dailyCheckinListeningPath&&_dailyCheckinListeningPath!==path){
    _fbDb.ref(_dailyCheckinListeningPath+'/requests').off();
    _fbDb.ref(_dailyCheckinListeningPath+'/party').off();
    _fbDb.ref(_dailyCheckinListeningPath+'/session/event').off();
  }
  _dailyCheckinListening=true;
  _dailyCheckinListeningPath=path;
  _fbDb.ref(path+'/requests').on('value',snap=>{
    const raw=snap.val()||{};
    _dailyCheckinRequests=Object.keys(raw).map(key=>({key,...raw[key]}))
      .filter(r=>!r.appliedAt&&!r.ignoredAt&&!r.serverAppliedAt&&!r.serverRejectedAt)
      .sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
    if(_dailyOfficialInviteHash){
      _dailyPullServerReconcile().catch(()=>{});
    }else{
      dailyProcessCheckinRequests();
      // 구 세션도 재실행 시 대기 명령을 먼저 원본에 적용한 뒤 공개 화면을 게시합니다.
      dailyPushCheckinSession();
      dailyRenderCheckinRequests();
    }
  });
  _fbDb.ref(path+'/party').on('value',snap=>{
    _dailyCheckinParty=snap.val()||{};
    dailyRenderCheckinRequests();
    dailyRenderAfterPartySpotlight();
  });
  _fbDb.ref(path+'/session/event').on('value',snap=>{
    _dailyAdoptRemotePauseEvent(snap.val()||{});
  });
}
function _dailyStopCheckinListener(){
  if(_fbDb&&_dailyCheckinListeningPath){
    _fbDb.ref(_dailyCheckinListeningPath+'/requests').off();
    _fbDb.ref(_dailyCheckinListeningPath+'/party').off();
    _fbDb.ref(_dailyCheckinListeningPath+'/session/event').off();
  }
  _dailyCheckinListening=false;
  _dailyCheckinListeningPath='';
}
function _dailyCheckinBlockReason(req,p){
  if(!p)return '민턴LIVE 명단에 없는 선수';
  if(_dailyPaused)return '진행 일시 정지 중 · 재개 후 다시 처리';
  if(!_dailyCheckinAllowedStatus(req.status))return '알 수 없는 상태 요청';
  if(p.status==='playing'||p.currentMatchId)return '경기중이라 경기 완료/취소 후 반영 가능';
  const nextStatus=_dailyNormalizeStatus(req.status);
  if(nextStatus==='done')return '';
  if(_dailyIsLockedQueued(p.id)){
    if(nextStatus==='rest')return '';
    return '게임신청 대기표에 포함되어 클럽 임원 확인 필요';
  }
  return '';
}
function _dailyCheckinRequestRef(key){
  return _fbDb&&_dailyCheckinId?_fbDb.ref(_dailyCheckinPath()+'/requests/'+key):null;
}
function _dailyCheckinPendingRequests(){
  return _dailyCheckinRequests.filter(req=>{
    if(['reservation','court-complete','court-complete-undo','queue-enter-free','queue-rest-pass'].includes(req.type))return false;
    const p=_dailyPlayer(req.playerId);
    return _dailyCheckinBlockReason(req,p);
  });
}
function _dailyLatestPendingStatusRequest(playerId){
  return _dailyCheckinRequests
    .filter(req=>req.playerId===playerId&&req.status&&!req.ignoredAt&&!req.appliedAt&&req.type!=='reservation'&&!String(req.type||'').startsWith('official-')&&_dailyCheckinAllowedStatus(req.status))
    .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))[0]||null;
}
function _dailyConsumeDeferredStatusRequest(playerId){
  const req=_dailyLatestPendingStatusRequest(playerId);
  if(!req)return '';
  const ref=_dailyCheckinRequestRef(req.key);
  if(ref)ref.update({appliedAt:_dailyNow(),appliedBy:'after-match-auto'}).catch(()=>{});
  _dailyCheckinRequests=_dailyCheckinRequests.filter(r=>r.key!==req.key);
  return _dailyNormalizeStatus(req.status);
}
function _dailyReservationConsentIds(req){
  const team2=req.mode==='match'?(req.team2||[]):[];
  const ids=(req.consentRequired||[...(req.team1||[]),...team2]).filter(Boolean);
  return [...new Set(ids)];
}
function _dailyReservationConsentState(req,playerId){
  if(!req.consentRequired)return 'accepted';
  const val=req.consents&&req.consents[playerId];
  if(typeof val==='string')return val;
  if(val&&typeof val==='object')return val.status||'pending';
  return req.playerId===playerId?'accepted':'pending';
}
function _dailyReservationConsentPending(req){
  return _dailyReservationConsentIds(req).some(id=>_dailyReservationConsentState(req,id)!=='accepted');
}
function _dailyReservationRequestError(req,options){
  if(req.type==='reservation'&&!options?.official)return '파트너 요청은 클럽 임원이 현장에서 접수합니다.';
  if(req.source==='member-game-request'||req.source==='member-request')return '파트너 요청은 클럽 임원이 현장에서 접수합니다.';
  if(_dailyFinishMode)return '마무리 중에는 새 게임신청을 받지 않습니다.';
  const team1=(req.team1||[]).filter(Boolean);
  const team2=(req.mode==='match'?(req.team2||[]):[]).filter(Boolean);
  const ids=[...team1,...team2];
  if(req.mode==='match'){
    if(team1.length!==2||team2.length!==2||new Set(ids).size!==4)return '4명 경기 신청 정보가 부족하거나 중복되어 있습니다.';
  }else if(team1.length!==2||new Set(team1).size!==2){
    return '같은 편 신청에는 서로 다른 2명이 필요합니다.';
  }
  if(ids.some(id=>!_dailyPlayer(id)))return '신청 선수 중 현재 명단에 없는 선수가 있습니다.';
  const registered=req.key?_dailyReservations.find(r=>r.requestKey===req.key):null;
  if(_dailyReservationPlayerConflict(ids,registered?.id))return '이미 다른 게임신청에 포함된 선수가 있습니다.';
  if(_dailyReservationPairConflict(team1,team2))return '기존 게임신청과 충돌합니다.';
  return '';
}
function _dailyReleaseTemporaryQueueForReservationIds(ids){
  let changed=false;
  ids.filter(Boolean).forEach(id=>{
    const loc=_dailyQueuedPlayerLocation(id);
    if(!loc||loc.q.reservationId)return;
    if(_dailyTryReplaceQueuedPlayer(id))changed=true;
    else if(_dailyRemoveQueuedPlayer(id))changed=true;
  });
  if(changed)_dailyRefreshNextFromQueue();
  return changed;
}
function _dailyRegisterReservationRequest(req,options){
  if(req.key&&_dailyReservations.some(r=>r.requestKey===req.key))return true;
  const error=_dailyReservationRequestError(req,options);
  if(error)return false;
  const team1=(req.team1||[]).filter(Boolean);
  const team2=(req.mode==='match'?(req.team2||[]):[]).filter(Boolean);
  const isMember=req.source==='member-game-request'||req.source==='member-request';
  const isOfficial=options?.official===true&&req.source==='club-official-reservation';
  const preserveOrder=isMember||isOfficial;
  const officialOperationId=String(req.operationId||req.key||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(-80);
  if(!preserveOrder)_dailyReleaseTemporaryQueueForReservationIds([...team1,...team2]);
  const reservation={
    id:isOfficial&&officialOperationId?`sr_${officialOperationId}`:'dres_'+_dailyNow().toString(36)+'_'+Math.random().toString(36).slice(2,5),
    mode:req.mode==='match'?'match':'pair',
    team1,
    team2,
    note:req.note||`회원 신청: ${req.playerName||'이름 없음'}`,
    createdAt:req.createdAt||_dailyNow(),
    source:isMember?'member-request':isOfficial?'club-official-request':'admin-request',
    preserveOrder,
    requestKey:req.key||''
  };
  _dailyReservations.push(reservation);
  if(preserveOrder)_dailyTryApplyReservationToExistingQueue(reservation);
  return true;
}
function _dailyCompleteRequestError(req){
  const m=_dailyMatches.find(x=>x.id===req.matchId&&!x.completedAt&&!x.cancelledAt);
  if(!m)return '종료할 진행중 경기를 찾지 못했습니다.';
  if(req.queueId){
    const idx=_dailyQueue.findIndex(q=>q.id===req.queueId);
    if(idx<0)return '다음 대진을 찾지 못했습니다.';
    const q=_dailyQueue[idx];
    if(!_dailyQueueIds(q).includes(req.playerId))return '다음 대진 선수만 종료 처리할 수 있습니다.';
    if(!_dailyQueueItemValid(q,null))return '다음 대진 선수 상태가 바뀌었습니다.';
    const info=_dailyQueueStartInfo(idx);
    const initialHandoff=info.state==='handoff'&&!!m.transitionStarted;
    if(!initialHandoff&&!['soon','due'].includes(info.state))return '아직 입장 순서가 아닙니다.';
    const matchState=_dailyTimerState(m);
    if(!initialHandoff&&!['soon','due'].includes(matchState))return '아직 입장 가능한 종료임박 코트가 아닙니다.';
    return '';
  }
  return '경기 종료는 다음 입장 대진에서 처리해 주세요.';
}
function _dailyMemberCourtOperationError(req){
  if(!req)return '';
  if(['court-complete','court-complete-undo','queue-enter-free'].includes(req.type)){
    return '코트 진행은 클럽 임원이 처리합니다.';
  }
  return '';
}
function _dailyOfficialFingerprint(ids){
  return (ids||[]).map(String).sort((a,b)=>a.localeCompare(b,'ko')).join('|');
}
function _dailyOfficialTeamFingerprint(team1,team2){
  return _dailyExactKey(team1||[],team2||[]);
}
function _dailyOfficialQueueRequestFingerprint(req){
  if(!Array.isArray(req?.expectedTeam1Ids)||req.expectedTeam1Ids.length!==2)return '';
  if(!Array.isArray(req?.expectedTeam2Ids)||req.expectedTeam2Ids.length!==2)return '';
  return _dailyOfficialTeamFingerprint(req.expectedTeam1Ids,req.expectedTeam2Ids);
}
function _dailyServerQueueResultRequest(result,serverAppliedAt,queueIndex){
  const q=result?.queue||{};
  const team1=[...(result?.team1Ids||q.t1Ids||q.team1||[])];
  const team2=[...(result?.team2Ids||q.t2Ids||q.team2||[])];
  return {
    type:'official-queue-enter-free',
    serverAppliedAt,
    operationId:`restore_${result?.matchId||result?.queueId||serverAppliedAt}`,
    queueId:result?.queueId||q.queueId||q.id||'',
    expectedQueueIndex:Number(queueIndex||result?.queueIndex||1),
    expectedPlayerIds:[...team1,...team2],
    expectedTeam1Ids:team1,
    expectedTeam2Ids:team2,
    queueType:q.type||'',queueTeamMode:!!q.teamMode,
    queueLevelDiff:Number(q.levelDiff||0),queueTeam1Level:Number(q.team1Level||0),queueTeam2Level:Number(q.team2Level||0),
    queueFlexible:!!q.flexible,queueReservationId:q.reservationId||null,queueReservationLabel:q.reservationLabel||null,
    createdAt:serverAppliedAt
  };
}
function _dailyPrepareServerQueueRequest(req){
  if(!req?.serverAppliedAt)return true;
  if(['official-court-complete','official-active-yield'].includes(req.type)){
    const autoEnter=req.serverResult?.autoEnter;
    return !autoEnter||_dailyPrepareServerQueueRequest(_dailyServerQueueResultRequest(autoEnter,req.serverAppliedAt,autoEnter.queueIndex));
  }
  if(!['official-queue-enter-free','official-queue-yield'].includes(req.type))return true;
  if(!_dailyPaused)dailyEnsureQueue();
  const queueId=String(req.queueId||'');
  const requestFingerprint=_dailyOfficialQueueRequestFingerprint(req);
  let idx=_dailyQueue.findIndex(q=>String(q.id||'')===queueId);
  if(idx<0&&requestFingerprint){
    idx=_dailyQueue.findIndex(q=>_dailyOfficialTeamFingerprint(q.team1,q.team2)===requestFingerprint);
  }
  if(idx<0){
    const team1=[...(req.expectedTeam1Ids||[])],team2=[...(req.expectedTeam2Ids||[])];
    const ids=[...team1,...team2];
    if(ids.length!==4||new Set(ids).size!==4||ids.some(id=>!_dailyPlayer(id)))return false;
    const conflicts=new Set(ids);
    _dailyQueue=_dailyQueue.filter(q=>!_dailyQueueIds(q).some(id=>conflicts.has(id)));
    const restored={
      id:queueId||('dq_server_'+String(req.operationId||req.key||_dailyNow())),
      createdAt:Number(req.createdAt||req.serverAppliedAt||_dailyNow()),
      team1,team2,
      type:req.queueType||'예외',
      levelDiff:Number(req.queueLevelDiff||0),
      team1Level:Number(req.queueTeam1Level||0),
      team2Level:Number(req.queueTeam2Level||0),
      flexible:!!req.queueFlexible,
      teamMode:!!req.queueTeamMode,
      reservationId:req.queueReservationId||null,
      reservationLabel:req.queueReservationLabel||null,
      strict:!req.queueFlexible,
      score:0,
      serverRestored:true
    };
    _dailyRecalcQueueItem(restored);
    const desired=Math.max(0,Math.min(_dailyQueue.length,Number(req.expectedQueueIndex||1)-1));
    _dailyQueue.splice(desired,0,restored);
    idx=desired;
  }else{
    if(queueId)_dailyQueue[idx].id=queueId;
    const desired=Math.max(0,Math.min(_dailyQueue.length-1,Number(req.expectedQueueIndex||idx+1)-1));
    if(desired!==idx){
      const item=_dailyQueue.splice(idx,1)[0];
      _dailyQueue.splice(desired,0,item);
      idx=desired;
    }
  }
  _dailyRefreshNextFromQueue();
  return idx>=0;
}
function _dailyServerOperationAlreadyApplied(req){
  if(!req?.serverAppliedAt)return false;
  const operationAt=Number(req.serverAppliedAt||req.createdAt||0);
  if(req.type==='official-player-arrival'){
    const p=_dailyPlayer(req.playerId);
    return !!(p&&p.status==='wait'&&Number(p.lastStatusAt||0)===operationAt);
  }
  if(req.type==='official-player-add')return !!_dailyPlayer(req.playerId);
  if(req.type==='official-player-status'){
    const p=_dailyPlayer(req.playerId);
    if(!p)return false;
    return Number(p.lastStatusAt||0)===operationAt&&(p.status===req.status||p.afterMatchStatus===req.status);
  }
  if(req.type==='official-court-complete'){
    const m=_dailyMatches.find(match=>String(match.id)===String(req.matchId));
    if(!m||Number(m.completedAt||0)!==operationAt)return false;
    const auto=req.serverResult?.autoEnter;
    return !auto?.matchId||_dailyMatches.some(match=>String(match.id)===String(auto.matchId));
  }
  if(req.type==='official-active-yield'){
    const cancelled=_dailyMatches.find(match=>String(match.id)===String(req.matchId));
    const replacementId=String(req.serverResult?.autoEnter?.matchId||'');
    return !!(cancelled&&Number(cancelled.cancelledAt||0)===operationAt&&replacementId&&_dailyMatches.some(match=>String(match.id)===replacementId&&!match.cancelledAt));
  }
  if(req.type==='official-queue-enter-free')return _dailyMatches.some(match=>String(match.id)===String(req.newMatchId||''));
  if(req.type==='official-queue-yield'){
    const q=_dailyQueue.find(item=>String(item.id||'')===String(req.queueId||''));
    return !!(q&&Number(q.yieldedAt||0)===operationAt);
  }
  if(req.type==='official-partner-reservation'){
    const operationId=String(req.operationId||req.key||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(-80);
    return !!(operationId&&_dailyReservations.some(r=>r.id===`sr_${operationId}`));
  }
  if(req.type==='official-partner-cancel')return !_dailyReservations.some(r=>String(r.id)===String(req.reservationId));
  return false;
}
function _dailyOfficialRequestError(req){
  const actor=_dailyPlayer(req.actorPlayerId);
  if(!actor||!actor.isClubOfficial)return '현재 참가 중인 클럽 임원만 운영 지원을 사용할 수 있습니다.';
  const now=_dailyNow();
  if((req.expiresAt&&now>Number(req.expiresAt))||now-Number(req.createdAt||0)>DAILY_OFFICIAL_OPERATION_TTL_MS)return '운영 요청 시간이 지나 현재 상태를 다시 확인해야 합니다.';
  if(_dailyPaused&&_dailyFlowOperationType(req.type)&&!req.serverAppliedAt)return '현재 진행이 일시 정지되어 있습니다. 재개 후 다시 처리해 주세요.';
  if(req.type==='official-player-arrival'){
    if(_dailyFinishMode)return '마무리 전환 후에는 자동대진 참가자를 추가할 수 없습니다.';
    const p=_dailyPlayer(req.playerId);
    if(!p)return '참가 등록할 선수를 찾지 못했습니다.';
    const currentStatus=String(p.status||'');
    if(!['invited','planned'].includes(currentStatus))return '이미 참가 상태가 바뀐 선수입니다.';
    if(req.status!=='wait')return '참가 등록 상태가 올바르지 않습니다.';
    if(!Object.prototype.hasOwnProperty.call(req,'expectedStatus')||!['invited','planned'].includes(String(req.expectedStatus||'')))return '선수의 등록 전 상태를 다시 확인해야 합니다.';
    if(String(req.expectedStatus)!==currentStatus)return '선수 상태가 이미 바뀌었습니다.';
    if(p.currentMatchId)return '이미 경기에 배정된 선수입니다.';
    if(!Object.prototype.hasOwnProperty.call(req,'expectedLastStatusAt'))return '선수의 최신 상태를 다시 확인해야 합니다.';
    if(Number(req.expectedLastStatusAt)!==Number(p.lastStatusAt||0))return '선수 상태가 이미 바뀌었습니다.';
    return '';
  }
  if(req.type==='official-player-add'){
    if(_dailyFinishMode)return '마무리 전환 후에는 자동대진 참가자를 추가할 수 없습니다.';
    const profile=_dailyOfficialArrivalRosterProfile(req.memberId);
    if(!profile)return '현재 클럽 명부에서 참가 등록할 선수를 찾지 못했습니다.';
    if(!req.expectedName||String(req.expectedName).trim()!==String(profile.name||'').trim())return '클럽 명부 정보가 이미 바뀌었습니다.';
    if(_dailyHasRosterPlayer(profile))return '이미 오늘 명단에 있는 선수입니다.';
    return '';
  }
  if(req.type==='official-player-status'){
    const p=_dailyPlayer(req.playerId);
    if(!p)return '상태를 바꿀 선수를 찾지 못했습니다.';
    const nextStatus=_dailyNormalizeStatus(req.status);
    if(!['wait','rest','done'].includes(nextStatus))return '알 수 없는 선수 상태입니다.';
    if(['invited','planned'].includes(String(p.status||'')))return '지각 선수는 참가 등록에서 처리해 주세요.';
    if((p.status==='playing'||p.currentMatchId)&&!['rest','done'].includes(nextStatus))return '경기중에는 경기 후 휴식 또는 종료만 표시할 수 있습니다.';
    if(!Object.prototype.hasOwnProperty.call(req,'expectedLastStatusAt'))return '선수의 최신 상태를 다시 확인해야 합니다.';
    const delayedMatch=req.expectedStatus==='playing'&&req.expectedCurrentMatchId
      ?_dailyMatches.find(m=>String(m.id)===String(req.expectedCurrentMatchId)&&m.completedAt&&!m.cancelledAt&&[...(m.team1||[]),...(m.team2||[])].includes(p.id))
      :null;
    const delayedAfterMatch=!!(delayedMatch&&p.status==='wait'&&!p.currentMatchId&&['rest','done'].includes(nextStatus));
    if(!delayedAfterMatch&&Number(req.expectedLastStatusAt)!==Number(p.lastStatusAt||0))return '선수 상태가 이미 바뀌었습니다.';
    return '';
  }
  if(req.type==='official-court-complete'){
    const m=_dailyMatches.find(x=>x.id===req.matchId&&!x.completedAt&&!x.cancelledAt);
    if(!m)return '종료할 진행중 경기를 찾지 못했습니다.';
    if(!Object.prototype.hasOwnProperty.call(req,'expectedStartedAt'))return '코트의 최신 경기를 다시 확인해야 합니다.';
    if(Number(req.expectedStartedAt)!==Number(m.startedAt||0))return '코트의 진행 경기가 이미 바뀌었습니다.';
    if(!Array.isArray(req.expectedPlayerIds)||req.expectedPlayerIds.length!==4)return '코트의 선수 구성을 다시 확인해야 합니다.';
    if(_dailyOfficialFingerprint(req.expectedPlayerIds)!==_dailyOfficialFingerprint([...(m.team1||[]),...(m.team2||[])]))return '코트의 선수 구성이 이미 바뀌었습니다.';
    return '';
  }
  if(req.type==='official-active-yield'){
    const m=_dailyMatches.find(x=>x.id===req.matchId&&!x.completedAt&&!x.cancelledAt);
    if(!m)return '뒤로 보낼 진행중 경기를 찾지 못했습니다.';
    if(!Object.prototype.hasOwnProperty.call(req,'expectedStartedAt')||Number(req.expectedStartedAt)!==Number(m.startedAt||0))return '코트의 진행 경기가 이미 바뀌었습니다.';
    if(!Object.prototype.hasOwnProperty.call(req,'expectedAutoHandoffAt')||Number(req.expectedAutoHandoffAt)!==Number(m.autoHandoffAt||0))return '자동 투입된 경기 정보를 다시 확인해야 합니다.';
    if(!Array.isArray(req.expectedPlayerIds)||req.expectedPlayerIds.length!==4||_dailyOfficialFingerprint(req.expectedPlayerIds)!==_dailyOfficialFingerprint([...(m.team1||[]),...(m.team2||[])]))return '코트의 선수 구성이 이미 바뀌었습니다.';
    if(!_dailyOfficialTeamFingerprint(req.expectedTeam1Ids,req.expectedTeam2Ids)||_dailyOfficialTeamFingerprint(req.expectedTeam1Ids,req.expectedTeam2Ids)!==_dailyOfficialTeamFingerprint(m.team1,m.team2))return '코트의 팀 구성이 이미 바뀌었습니다.';
    if(!req.serverResult?.autoEnter||!req.serverResult?.deferred)return '서버의 대체 대진 처리 결과를 다시 확인해야 합니다.';
    return '';
  }
  if(req.type==='official-queue-enter-free'){
    const idx=_dailyQueue.findIndex(x=>String(x.id||'')===String(req.queueId||''));
    if(idx<0)return '입장할 다음 대진을 찾지 못했습니다.';
    const q=_dailyQueue[idx];
    const ids=_dailyQueueIds(q);
    if(!Array.isArray(req.expectedPlayerIds)||req.expectedPlayerIds.length!==4)return '다음 대진 선수를 다시 확인해야 합니다.';
    if(_dailyOfficialFingerprint(req.expectedPlayerIds)!==_dailyOfficialFingerprint(ids))return '다음 대진 선수가 이미 바뀌었습니다.';
    const courtError=_dailyFreeCourtRequestError({...req,playerId:ids[0]||''});
    if(courtError)return courtError;
    const info=_dailyQueueStartInfo(idx);
    const currentHoldId=String(info.holdId||'');
    if(currentHoldId&&!Object.prototype.hasOwnProperty.call(req,'expectedHoldId'))return '입장할 코트의 최신 종료 연결을 다시 확인해야 합니다.';
    if(String(req.expectedHoldId||'')!==currentHoldId)return '입장할 코트의 종료 연결이 이미 바뀌었습니다.';
    return '';
  }
  if(req.type==='official-queue-yield'){
    const idx=_dailyQueue.findIndex(x=>String(x.id||'')===String(req.queueId||''));
    if(idx<0)return '뒤로 보낼 다음 대진을 찾지 못했습니다.';
    const q=_dailyQueue[idx];
    const ids=_dailyQueueIds(q);
    if(!Object.prototype.hasOwnProperty.call(req,'expectedQueueIndex')||Number(req.expectedQueueIndex)!==idx+1)return '다음 대진 순서가 이미 바뀌었습니다.';
    if(!Array.isArray(req.expectedPlayerIds)||req.expectedPlayerIds.length!==4)return '다음 대진 선수를 다시 확인해야 합니다.';
    if(_dailyOfficialFingerprint(req.expectedPlayerIds)!==_dailyOfficialFingerprint(ids))return '다음 대진 선수가 이미 바뀌었습니다.';
    if(!Array.isArray(req.expectedTeam1Ids)||req.expectedTeam1Ids.length!==2||!Array.isArray(req.expectedTeam2Ids)||req.expectedTeam2Ids.length!==2)return '다음 대진 팀 구성을 다시 확인해야 합니다.';
    if(_dailyOfficialTeamFingerprint(req.expectedTeam1Ids,req.expectedTeam2Ids)!==_dailyOfficialTeamFingerprint(q.team1,q.team2))return '다음 대진 팀 구성이 이미 바뀌었습니다.';
    const info=_dailyQueueStartInfo(idx);
    const hasExpectedCue=Object.prototype.hasOwnProperty.call(req,'expectedCueState');
    const expectedFree=req.expectedCueState==='free';
    if(info.state==='free'&&info.holdId&&!hasExpectedCue)return '입장할 코트의 최신 종료 연결을 다시 확인해야 합니다.';
    if(hasExpectedCue&&(expectedFree||info.state==='free')){
      if(!expectedFree||info.state!=='free')return '빈 코트 입장 순서가 이미 바뀌었습니다.';
      if(Number(req.expectedTargetCourt||0)!==Number(info.court||0))return '입장 대기 코트가 이미 바뀌었습니다.';
      const currentHoldId=String(info.holdId||'');
      if(currentHoldId&&!Object.prototype.hasOwnProperty.call(req,'expectedHoldId'))return '입장할 코트의 최신 종료 연결을 다시 확인해야 합니다.';
      if(String(req.expectedHoldId||'')!==currentHoldId)return '입장할 코트의 종료 연결이 이미 바뀌었습니다.';
    }
    const targetQueueIndex=Object.prototype.hasOwnProperty.call(req,'targetQueueIndex')?Number(req.targetQueueIndex):idx+2;
    if(!Number.isInteger(targetQueueIndex)||targetQueueIndex<=idx+1||targetQueueIndex>_dailyQueue.length)return '이동할 다음 대진 순번이 올바르지 않습니다.';
    if(!_dailyQueueItemValid(q,null))return '다음 대진 선수 상태가 바뀌었습니다.';
    return '';
  }
  if(req.type==='official-partner-reservation'){
    const ids=(req.playerIds||[]).filter(Boolean);
    if(ids.length!==2||new Set(ids).size!==2)return '파트너 접수 선수 두 명을 다시 확인해야 합니다.';
    if(ids.some(id=>!_dailyPlayer(id)))return '파트너 접수 선수가 현재 명단에 없습니다.';
    return _dailyReservationRequestError({...req,mode:'pair',team1:ids,team2:[],source:'club-official-reservation'},{official:true});
  }
  if(req.type==='official-partner-cancel'){
    const r=_dailyReservations.find(x=>String(x.id)===String(req.reservationId)&&x.mode==='pair');
    if(!r)return '취소할 파트너 접수를 찾지 못했습니다.';
    if(!Array.isArray(req.expectedPlayerIds)||req.expectedPlayerIds.length!==2)return '파트너 접수 선수를 다시 확인해야 합니다.';
    if(_dailyOfficialFingerprint(req.expectedPlayerIds)!==_dailyOfficialFingerprint(r.team1||[]))return '파트너 접수 선수가 이미 바뀌었습니다.';
    return '';
  }
  if(['official-court-complete-undo','official-operation-undo'].includes(req.type))return req.token?'':'되돌릴 운영 기록을 다시 확인해야 합니다.';
  return '지원하지 않는 임원 운영 요청입니다.';
}
function _dailyRecordOfficialArrival(p,req){
  const actor=_dailyPlayer(req.actorPlayerId);
  p.arrivalConfirmedBy=actor?.id||req.actorPlayerId||'';
  p.arrivalConfirmedByName=actor?.name||req.actorPlayerName||'';
  p.arrivalConfirmedAt=p.lastStatusAt||_dailyNow();
  p.arrivalConfirmedSource='club-official-arrival';
  p.arrivalRequestKey=req.key||'';
}
function _dailyApplyOfficialArrival(req){
  const p=_dailyPlayer(req.playerId);
  if(!p||!['invited','planned'].includes(String(p.status||'')))return false;
  _dailyApplyPlayerStatus(p,'wait',req.serverAppliedAt||req.createdAt);
  _dailyRecordOfficialArrival(p,req);
  return true;
}
function _dailyApplyOfficialPlayerAdd(req){
  const profile=_dailyOfficialArrivalRosterProfile(req.memberId);
  if(!profile||_dailyHasRosterPlayer(profile))return false;
  const p=_dailyNormalize({...profile,id:req.playerId||undefined,status:'invited'});
  _dailyPlayers.push(p);
  _dailyApplyPlayerStatus(p,'wait',req.serverAppliedAt||req.createdAt);
  _dailyRecordOfficialArrival(p,req);
  return true;
}
function _dailyApplyOfficialStatus(req){
  const p=_dailyPlayer(req.playerId);
  if(!p)return false;
  const nextStatus=_dailyNormalizeStatus(req.status);
  const operationAt=req.serverAppliedAt||req.createdAt;
  if(p.status==='playing'||p.currentMatchId)return _dailySetAfterMatchStatus(p,nextStatus,operationAt);
  const nextLabel=_dailyCheckinStatusLabel(nextStatus);
  if(!DAILY_STATUS[nextStatus]?.eligible){
    _dailyCancelReservationsForPlayer(p.id,`${p.name}님을 ${nextLabel} 상태로 바꿔 게임신청이 자동 취소됐습니다.`,'official-status-change');
    if(_dailyIsQueued(p.id)&&!_dailyTryReplaceQueuedPlayer(p.id,`${p.name}님을 ${nextLabel} 상태로 바꿔 대기표가 자동 조정됐습니다.`)){
      _dailyRemoveQueuedPlayer(p.id,`${p.name}님을 ${nextLabel} 상태로 바꿔 대기표가 자동 취소됐습니다.`);
    }
  }
  _dailyApplyPlayerStatus(p,nextStatus,operationAt);
  return true;
}
function _dailyStartServerAutoEnter(req,options){
  options=options||{};
  const auto=req.serverResult?.autoEnter;
  if(!auto?.matchId||!auto?.queueId)return false;
  return dailyStartQueueItem(auto.queueId,{
    silent:true,
    allowWhilePaused:true,
    court:parseInt(auto.court,10),
    ignoreRestPass:true,
    strictCourt:true,
    skipWaveTrack:!!options.skipWaveTrack,
    matchId:auto.matchId,
    startedAt:auto.startedAt||req.serverAppliedAt||req.createdAt,
    autoHandoffAt:auto.startedAt||req.serverAppliedAt||req.createdAt,
    autoHandoffExpiresAt:auto.expiresAt||0,
    autoHandoffSource:options.source||'official-complete',
    autoHandoffSourceMatchId:auto.sourceMatchId||req.matchId||'',
    autoHandoffSourceRequestId:req.operationId||req.key||'',
    autoHandoffQueueIndex:auto.queueIndex||1,
    autoHandoffQueue:auto.queue||null,
    autoHandoffPlayerStates:auto.playerStates||null,
    autoHandoffReservation:auto.reservation||null
  });
}
function _dailyApplyOfficialActiveYield(req){
  const m=_dailyMatches.find(match=>String(match.id)===String(req.matchId)&&!match.completedAt&&!match.cancelledAt);
  const result=req.serverResult||{};
  if(!m||!result.autoEnter||!result.deferred)return false;
  const previousUndo=_dailyLastCompleteUndo;
  if(req.token)_dailyCaptureCompleteUndo(req.token,'club-official-active-yield');
  const operationAt=Number(req.serverAppliedAt||req.createdAt||_dailyNow());
  const players=[...(m.team1||[]),...(m.team2||[])].map(_dailyPlayer).filter(Boolean);
  if(players.length!==4){
    if(req.token&&_dailyLastCompleteUndo?.token===req.token)_dailyLastCompleteUndo=previousUndo;
    return false;
  }
  const savedStateRows=Array.isArray(m.autoHandoffPlayerStates)?m.autoHandoffPlayerStates:[];
  const savedStates=new Map(savedStateRows.map(row=>[String(row?.id||''),row]));
  players.forEach(p=>{
    const saved=savedStates.get(String(p.id))||{};
    p.status=_dailyNormalizeStatus(saved.status||'wait');
    p.afterMatchStatus=saved.afterMatchStatus||null;
    p.currentMatchId=saved.currentMatchId||null;
    if(Object.prototype.hasOwnProperty.call(saved,'waitFrom'))p.waitFrom=saved.waitFrom;
    if(Object.prototype.hasOwnProperty.call(saved,'lastStatusAt'))p.lastStatusAt=saved.lastStatusAt;
    p.deferUntil=Number(saved.deferUntil||0);
    p.deferReason=saved.deferReason||'';
    if(Object.prototype.hasOwnProperty.call(saved,'locked'))p.locked=!!saved.locked;
  });
  m.cancelledAt=operationAt;
  m.cancelReason='club-official-active-yield';
  if(result.deferredReservation&&!_dailyReservations.some(r=>String(r.id)===String(result.deferredReservation.id))){
    _dailyReservations.push(JSON.parse(JSON.stringify(result.deferredReservation)));
  }
  const deferredBeforeStart=_dailyServerQueueResultRequest(result.deferred,operationAt,Number(result.deferred.queueIndex||1)+1);
  if(!_dailyPrepareServerQueueRequest(deferredBeforeStart)||!_dailyStartServerAutoEnter(req,{skipWaveTrack:true,source:'official-active-yield'})){
    if(req.token&&_dailyLastCompleteUndo?.token===req.token)dailyUndoMemberComplete(req.token,true);
    else _dailyLastCompleteUndo=previousUndo;
    return false;
  }
  const deferredFinal=_dailyServerQueueResultRequest(result.deferred,operationAt,result.deferred.queueIndex||1);
  if(!_dailyPrepareServerQueueRequest({...deferredFinal,type:'official-queue-yield'})){
    if(req.token&&_dailyLastCompleteUndo?.token===req.token)dailyUndoMemberComplete(req.token,true);
    else _dailyLastCompleteUndo=previousUndo;
    return false;
  }
  if(req.token&&_dailyLastCompleteUndo?.token===req.token)_dailyLastCompleteUndo.guard=_dailyCompleteUndoGuard();
  return true;
}
function dailyProcessCheckinRequests(){
  if(_dailyCheckinApplying)return;
  _dailyCheckinApplying=true;
  let changed=false;
  const now=_dailyNow();
  try{
    const latestByPlayer=new Map();
    const superseded=[];
    const autoApplied=[];
    const autoRejected=[];
    let serverReconcileBlocked=false;
    const finishOfficial=(req,ok,reason,stateChanged)=>{
      if(req.serverAppliedAt){
        if(!ok){
          _dailyServerReconcileError=reason||'서버 운영 결과를 관리자 원본에 연결하지 못했습니다.';
          serverReconcileBlocked=true;
          return;
        }
        _dailyServerRevision=Number(req.serverRevision||_dailyServerRevision);
        _dailyServerReconcileError='';
        autoApplied.push(req);
        changed=true;
        return;
      }
      (ok?autoApplied:autoRejected).push(ok?req:{...req,_completeRejectReason:reason||'운영 요청을 반영하지 못했습니다.'});
      if(ok&&stateChanged!==false)changed=true;
    };
    _dailyCheckinRequests.forEach(req=>{
      if(String(req.type||'').startsWith('official-')){
        const serverRevision=Number(req.serverRevision||0);
        if(!req.serverAppliedAt&&_dailyOfficialInviteHash){
          autoRejected.push({...req,_completeRejectReason:'임원 본인 화면에서 현재 상태를 확인한 뒤 다시 처리해 주세요.'});
          return;
        }
        if(req.serverAppliedAt&&serverRevision&&serverRevision<=_dailyServerRevision){
          autoApplied.push(req);
          return;
        }
        if(req.serverAppliedAt){
          if(serverReconcileBlocked)return;
          if(!serverRevision||serverRevision!==_dailyServerRevision+1){
            _dailyServerReconcileError='서버 운영 기록 순서가 이어지지 않아 자동 동기화를 잠시 멈췄습니다.';
            serverReconcileBlocked=true;
            return;
          }
          if(_dailyServerOperationAlreadyApplied(req)){
            finishOfficial(req,true,'',false);
            return;
          }
          if(!_dailyPrepareServerQueueRequest(req)){
            finishOfficial(req,false,'서버에서 처리한 다음 대진 구성을 관리자 원본에서 복원하지 못했습니다.');
            return;
          }
          if(_dailyServerOperationAlreadyApplied(req)){
            finishOfficial(req,true,'',false);
            return;
          }
        }
        const reason=_dailyOfficialRequestError(req);
        if(reason){
          finishOfficial(req,false,reason,false);
          return;
        }
        if(req.type==='official-player-arrival'){
          const ok=_dailyApplyOfficialArrival(req);
          finishOfficial(req,ok,'지각 선수 참가 등록을 반영하지 못했습니다.');
          return;
        }
        if(req.type==='official-player-add'){
          const ok=_dailyApplyOfficialPlayerAdd(req);
          finishOfficial(req,ok,'클럽 명부 선수를 참가 명단에 추가하지 못했습니다.');
          return;
        }
        if(req.type==='official-player-status'){
          const ok=_dailyApplyOfficialStatus(req);
          finishOfficial(req,ok,'선수 상태를 반영하지 못했습니다.');
          return;
        }
        if(req.type==='official-court-complete'){
          const ok=dailyCompleteMatch(req.matchId,null,{undoToken:req.token,source:'club-official-complete',awaitOfficialEntry:true,allowWhilePaused:!!req.serverAppliedAt,operationAt:req.serverAppliedAt||req.createdAt});
          const entered=ok&&req.serverResult?.autoEntered?_dailyStartServerAutoEnter(req,{source:'official-complete'}):true;
          if(ok&&!entered&&req.token&&_dailyLastCompleteUndo?.token===req.token)dailyUndoMemberComplete(req.token,true);
          if(ok&&entered&&req.token&&_dailyLastCompleteUndo?.token===req.token)_dailyLastCompleteUndo.guard=_dailyCompleteUndoGuard();
          finishOfficial(req,ok&&entered,entered?'종료할 진행중 경기를 관리자 원본에서 찾지 못했습니다.':'자동 투입할 다음 대진을 관리자 원본에서 복원하지 못했습니다.');
          return;
        }
        if(req.type==='official-active-yield'){
          const ok=_dailyApplyOfficialActiveYield(req);
          finishOfficial(req,ok,'방금 자동 투입된 대진을 뒤로 보내지 못했습니다.');
          return;
        }
        if(req.type==='official-queue-enter-free'){
          const previousUndo=_dailyLastCompleteUndo;
          if(req.token)_dailyCaptureCompleteUndo(req.token,'club-official-queue-enter');
          const ok=dailyStartQueueItem(req.queueId,{silent:true,allowWhilePaused:!!req.serverAppliedAt,court:parseInt(req.court,10),ignoreRestPass:true,strictCourt:true,matchId:req.newMatchId||'',startedAt:req.serverAppliedAt||req.createdAt});
          if(!ok&&req.token&&_dailyLastCompleteUndo?.token===req.token)_dailyLastCompleteUndo=previousUndo;
          if(ok&&req.token&&_dailyLastCompleteUndo?.token===req.token){
            dailyEnsureQueue();
            _dailyPromoteReadyReservations(true);
            _dailyLastCompleteUndo.guard=_dailyCompleteUndoGuard();
          }
          finishOfficial(req,ok,'입장 처리 중 대기표가 바뀌었습니다.');
          return;
        }
        if(req.type==='official-queue-yield'){
          const previousUndo=_dailyLastCompleteUndo;
          if(req.token)_dailyCaptureCompleteUndo(req.token,'club-official-queue-yield');
          const playerId=(req.expectedPlayerIds||[])[0]||'';
          const result=_dailyApplyQueueYield(playerId,req.queueId,'club-official-queue-yield',{
            strict:true,
            yieldedBy:req.actorPlayerId,
            targetQueueIndex:req.targetQueueIndex,
            clearRestPass:true,
            expectedCueState:req.expectedCueState||'',
            expectedTargetCourt:req.expectedTargetCourt||null,
            expectedHoldId:req.expectedHoldId||'',
            operationAt:req.serverAppliedAt||req.createdAt
          });
          if(!result.ok&&req.token&&_dailyLastCompleteUndo?.token===req.token)_dailyLastCompleteUndo=previousUndo;
          if(result.ok&&req.token&&_dailyLastCompleteUndo?.token===req.token){
            dailyEnsureQueue();
            _dailyPromoteReadyReservations(true);
            _dailyLastCompleteUndo.guard=_dailyCompleteUndoGuard();
          }
          finishOfficial(req,result.ok,result.reason||'다음 대진을 뒤로 보내지 못했습니다.');
          return;
        }
        if(req.type==='official-partner-reservation'){
          const ok=_dailyRegisterReservationRequest({
            ...req,
            type:'reservation',mode:'pair',team1:[...(req.playerIds||[])],team2:[],
            source:'club-official-reservation',
            note:`임원 접수: ${req.actorPlayerName||'클럽 임원'}`
          },{official:true});
          if(ok)_dailyPromoteReadyReservations(true);
          finishOfficial(req,ok,'파트너 접수를 반영하지 못했습니다.');
          return;
        }
        if(req.type==='official-partner-cancel'){
          const r=_dailyReservations.find(x=>String(x.id)===String(req.reservationId));
          const ok=!!r;
          if(ok){
            _dailyCancelReservationById(r.id,'클럽 임원이 파트너 접수를 취소했습니다.','club-official-support');
            _dailyQueue=_dailyQueue.filter(q=>q.reservationId!==r.id);
            _dailyRefreshNextFromQueue();
          }
          finishOfficial(req,ok,'취소할 파트너 접수를 찾지 못했습니다.');
          return;
        }
        if(['official-court-complete-undo','official-operation-undo'].includes(req.type)){
          const ok=dailyUndoMemberComplete(req.token,true);
          finishOfficial(req,ok,'되돌릴 수 있는 최근 운영 기록이 없습니다.');
          return;
        }
      }
      if(_dailyPaused){
        if(Number(req.createdAt||0)>=_dailyPausedAt){
          autoRejected.push({...req,_completeRejectReason:'진행 일시 정지 중에는 운영 요청을 처리하지 않습니다. 재개 후 다시 눌러 주세요.'});
        }
        return;
      }
      const memberCourtReason=_dailyMemberCourtOperationError(req);
      if(memberCourtReason){
        autoRejected.push({...req,_completeRejectReason:memberCourtReason});
        return;
      }
      if(req.type==='court-complete-undo'){
        const ok=dailyUndoMemberComplete(req.token,true);
        (ok?autoApplied:autoRejected).push(ok?req:{...req,_completeRejectReason:'되돌릴 수 있는 종료 기록이 없습니다.'});
        return;
      }
      if(req.type==='court-complete'){
        const reason=_dailyCompleteRequestError(req);
        if(reason){
          autoRejected.push({...req,_completeRejectReason:reason});
        }else{
          dailyCompleteMatch(req.matchId,null,{undoToken:req.token,source:'member-complete',queueId:req.queueId||''});
          autoApplied.push(req);
        }
        return;
      }
      if(req.type==='queue-enter-free'){
        const reason=_dailyFreeCourtRequestError(req);
        if(reason){
          autoRejected.push({...req,_completeRejectReason:reason});
        }else{
          const ok=dailyStartQueueItem(req.queueId,{silent:true,court:parseInt(req.court,10),ignoreRestPass:true,strictCourt:true});
          (ok?autoApplied:autoRejected).push(ok?req:{...req,_completeRejectReason:'입장 처리 중 대기표가 바뀌었습니다.'});
          if(ok)changed=true;
        }
        return;
      }
      if(req.type==='queue-rest-pass'){
        const result=_dailyApplyQueueRestPass(req.playerId,req.queueId,req.court);
        if(!result.ok){
          autoRejected.push({...req,_completeRejectReason:result.reason||'조금 쉬고 입장 조건이 맞지 않습니다.'});
        }else{
          autoApplied.push(req);
          changed=true;
        }
        return;
      }
      if(req.type==='queue-yield'||req.type==='queue-defer'){
        const p=_dailyPlayer(req.playerId);
        const reason=p?_dailyMemberQueueYieldError(req):'선수를 찾지 못했습니다.';
        const result=reason
          ? {ok:false,reason}
          : _dailyApplyQueueYield(req.playerId,req.queueId,req.type==='queue-yield'?'member-queue-yield':'member-queue-defer',{strict:true});
        if(!result.ok){
          autoRejected.push({...req,_completeRejectReason:result.reason||'뒤로 보낼 다음 대진을 찾지 못했습니다.'});
        }else{
          autoApplied.push(req);
          changed=true;
        }
        return;
      }
      if(req.type==='reservation'){
        autoRejected.push({...req,_completeRejectReason:'파트너 요청은 클럽 임원이 현장에서 접수합니다.'});
        return;
      }
      if(!req.playerId){superseded.push(req);return;}
      const cur=latestByPlayer.get(req.playerId);
      if(!cur||(req.createdAt||0)>=(cur.createdAt||0)){
        if(cur)superseded.push(cur);
        latestByPlayer.set(req.playerId,req);
      }else{
        superseded.push(req);
      }
    });
    superseded.forEach(req=>{
      const ref=_dailyCheckinRequestRef(req.key);
      if(ref)ref.update({appliedAt:now,appliedBy:'admin-superseded'}).catch(()=>{});
    });
    autoApplied.forEach(req=>{
      const ref=_dailyCheckinRequestRef(req.key);
      const isOfficial=String(req.type||'').startsWith('official-');
      const isQueueYield=req.type==='queue-yield'||req.type==='queue-defer';
      const isQueueCourt=req.type==='queue-enter-free'||req.type==='queue-rest-pass';
      const appliedBy=['official-player-arrival','official-player-add'].includes(req.type)?'club-official-arrival':isOfficial?'club-official-support':req.type==='court-complete'?'member-court-complete':req.type==='court-complete-undo'?'member-court-undo':isQueueYield?'member-queue-yield':isQueueCourt?'member-queue-court':'member-auto-reservation';
      if(ref)ref.update({appliedAt:now,appliedBy,serverReconcilePending:false,reconciledAt:req.serverAppliedAt?now:null}).catch(()=>{});
    });
    autoRejected.forEach(req=>{
      const ref=_dailyCheckinRequestRef(req.key);
      const isOfficial=String(req.type||'').startsWith('official-');
      const isQueueYield=req.type==='queue-yield'||req.type==='queue-defer';
      const isQueueCourt=req.type==='queue-enter-free'||req.type==='queue-rest-pass';
      const reason=req._completeRejectReason||(!isQueueYield&&!isQueueCourt?_dailyReservationRequestError(req):'자동 처리 조건 불충족')||'자동 등록 조건 불충족';
      const ignoredBy=['official-player-arrival','official-player-add'].includes(req.type)?'club-official-arrival':isOfficial?'club-official-support':req.type==='court-complete'?'member-court-complete':req.type==='court-complete-undo'?'member-court-undo':isQueueYield?'member-queue-yield':isQueueCourt?'member-queue-court':'member-auto-reservation';
      if(ref)ref.update({ignoredAt:now,ignoredBy,reason,serverReconcilePending:false,reconciledAt:req.serverAppliedAt?now:null}).catch(()=>{});
    });
    if(superseded.length||autoApplied.length||autoRejected.length){
      const keys=new Set([...superseded,...autoApplied,...autoRejected].map(req=>req.key));
      _dailyCheckinRequests=_dailyCheckinRequests.filter(req=>!keys.has(req.key));
    }
    latestByPlayer.forEach(req=>{
      const p=_dailyPlayer(req.playerId);
      const reason=_dailyCheckinBlockReason(req,p);
      if(reason)return;
      const nextStatus=_dailyNormalizeStatus(req.status);
      const nextLabel=_dailyCheckinStatusLabel(nextStatus);
      if(!DAILY_STATUS[nextStatus]?.eligible){
        if(_dailyCancelReservationsForPlayer(p.id,`${p.name}님이 ${nextLabel} 상태로 바꿔 게임신청이 자동 취소됐습니다.`,'member-status-change'))changed=true;
      }
      if(_dailyIsQueued(p.id)&&!DAILY_STATUS[nextStatus]?.eligible){
        const msg=`${p.name}님이 ${nextLabel} 상태로 바꿔 대기표가 자동 조정됐습니다.`;
        if(!_dailyTryReplaceQueuedPlayer(p.id,msg))_dailyRemoveQueuedPlayer(p.id,msg);
        changed=true;
      }
      if(p.status!==req.status){
        _dailyApplyPlayerStatus(p,req.status);
        changed=true;
      }
      const ref=_dailyCheckinRequestRef(req.key);
      if(ref)ref.update({appliedAt:now,appliedBy:'admin-auto'}).catch(()=>{});
    });
  }finally{
    _dailyCheckinApplying=false;
  }
  if(changed){
    if(!_dailyPaused){
      dailyEnsureQueue();
      _dailyPromoteReadyReservations(true);
    }
    if(_dailyLastCompleteUndo&&!_dailyLastCompleteUndo.guard){
      _dailyLastCompleteUndo.guard=_dailyCompleteUndoGuard();
    }
    dailySave();
    dailyRender();
    dailyMaybeAutoAssign();
  }
}
function dailyApproveCheckinRequest(key){
  if(_dailyBlockPaused({action:'회원 요청을 반영'}))return;
  const req=_dailyCheckinRequests.find(r=>r.key===key);
  if(!req)return;
  if(req.type==='reservation'){
    dailyApproveReservationRequest(key);
    return;
  }
  const p=_dailyPlayer(req.playerId);
  if(!p){dailyIgnoreCheckinRequest(key);return;}
  if(p.status==='playing'||p.currentMatchId){
    alert('경기중 선수는 진행중 코트에서 완료 또는 취소한 뒤 반영할 수 있습니다.');
    return;
  }
  if(!_dailyCheckinAllowedStatus(req.status)){
    alert('알 수 없는 상태 요청입니다.');
    return;
  }
  if(_dailyIsQueued(p.id)){
    if(!confirm(`${p.name} 선수가 대기표에 포함되어 있습니다.\n해당 대기표를 빼고 "${_dailyCheckinStatusLabel(req.status)}" 상태로 바꿀까요?`))return;
    _dailyQueue=_dailyQueue.filter(q=>!_dailyQueueIds(q).includes(p.id));
  }
  _dailyApplyPlayerStatus(p,req.status);
  const ref=_dailyCheckinRequestRef(key);
  if(ref)ref.update({appliedAt:_dailyNow(),appliedBy:'admin-confirm'}).catch(()=>{});
  dailyEnsureQueue();
  dailySave();
  dailyRender();
  dailyMaybeAutoAssign();
}
function _dailyReservationRequestIds(req){
  const team1=(req.team1||[]).filter(Boolean);
  const team2=(req.mode==='match'?(req.team2||[]):[]).filter(Boolean);
  return [...team1,...team2];
}
function dailyApproveReservationRequest(key){
  if(_dailyBlockPaused({action:'게임신청을 반영'}))return;
  const req=_dailyCheckinRequests.find(r=>r.key===key);
  if(!req)return;
  const error=_dailyReservationRequestError(req);
  if(error){
    alert(error);
    return;
  }
  _dailyRegisterReservationRequest(req);
  const ref=_dailyCheckinRequestRef(key);
  if(ref)ref.update({appliedAt:_dailyNow(),appliedBy:'admin-reservation'}).catch(()=>{});
  dailyEnsureQueue();
  _dailyPromoteReadyReservations(true);
  dailySave();
  dailyRender();
}
function dailyIgnoreCheckinRequest(key){
  const ref=_dailyCheckinRequestRef(key);
  if(ref)ref.update({ignoredAt:_dailyNow()}).catch(()=>{});
  _dailyCheckinRequests=_dailyCheckinRequests.filter(r=>r.key!==key);
  dailyRenderCheckinRequests();
}
async function dailyStopCheckinLink(){
  if(!_dailyCheckinId)return;
  if(!confirm('민턴LIVE 회원 링크를 종료할까요?\n이미 보낸 링크에서는 더 이상 명단을 볼 수 없습니다.'))return;
  const path=_dailyCheckinPath();
  if(typeof _dailyStopOperatorHeartbeat==='function')_dailyStopOperatorHeartbeat();
  _dailyStopCheckinListener();
  if(_fbDb)await _fbDb.ref(path).remove().catch(()=>{});
  _dailyClearAdminGrant();
  localStorage.removeItem(DAILY_CHECKIN_KEY);
  localStorage.removeItem(DAILY_CHECKIN_CREATED_KEY);
  _dailyCheckinId=null;
  _dailyCheckinCreatedAt=0;
  _dailyCheckinRequests=[];
  _dailyCheckinParty={};
  _dailyServerRevision=0;
  _dailyOfficialInviteToken='';
  _dailyOfficialInviteHash='';
  _dailyCapabilityPromise=null;
  _dailyServerReconcileError='';
  dailySave();
  dailyRender();
}
function _dailyAfterPartyRows(){
  return Object.entries(_dailyCheckinParty||{})
    .filter(([id,row])=>row&&row.attending!==false&&_dailyPlayer(id))
    .map(([id])=>_dailyPlayer(id))
    .filter(Boolean)
    .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'ko'));
}
function _dailyAfterPartyRosterText(){
  const rows=_dailyAfterPartyRows();
  if(!rows.length)return '';
  const names=rows.map(_dailyNameText);
  const lines=[];
  for(let i=0;i<names.length;i+=4)lines.push(names.slice(i,i+4).join(' · '));
  return `민턴LIVE 뒷풀이 신청자 · ${names.length}명\n${lines.join('\n')}`;
}
async function dailyCopyAfterPartyRoster(){
  const text=_dailyAfterPartyRosterText();
  if(!text){
    alert('복사할 뒷풀이 신청자가 없습니다.');
    return;
  }
  try{
    await navigator.clipboard.writeText(text);
    alert('뒷풀이 신청자 명단을 복사했습니다.\n밴드나 단톡방 글에 붙여넣어 주세요.');
  }catch(e){
    prompt('아래 명단을 길게 눌러 복사해 주세요.',text);
  }
}
function dailyRenderAfterPartySpotlight(){
  const el=document.getElementById('dailyAfterPartySpotlight');
  if(!el)return;
  const rows=_dailyAfterPartyRows();
  el.hidden=!rows.length;
  if(!rows.length){
    el.innerHTML='';
    return;
  }
  el.innerHTML=`<div class="daily-party-spotlight-head">
    <div><span>AFTER PARTY</span><strong>오늘 함께하는 ${rows.length}명</strong></div>
    <button type="button" onclick="dailyCopyAfterPartyRoster()">명단 복사</button>
  </div>
  <div class="daily-party-name-cloud">${rows.map(player=>`<span>${esc(_dailyNameText(player))}</span>`).join('')}</div>`;
}
function dailyRenderCheckinRequests(){
  const box=document.getElementById('dailyCheckinBox');
  const summary=document.getElementById('dailyCheckinSummary');
  if(summary){
    const pending=_dailyCheckinPendingRequests().length;
    summary.textContent=_dailyCheckinId?`(${pending}건 확인 필요)`:''; 
  }
  if(!box)return;
  if(!_dailyCheckinId){
    box.className='daily-empty';
    box.textContent='준비가 끝나면 회원·임원 공용 링크 하나만 카톡방에 공유하세요.';
    return;
  }
  const url=_dailyCheckinUrl();
  const pending=_dailyCheckinPendingRequests();
  const partyNames=_dailyAfterPartyRows().map(_dailyNameText);
  const partyHtml=`<div class="daily-checkin-req applied"><div class="daily-checkin-req-head"><div><div class="daily-checkin-req-title">뒷풀이 ${partyNames.length}명</div><div class="daily-checkin-req-meta">${partyNames.length?partyNames.map(esc).join(', '):'신청 없음'}</div></div><div class="daily-checkin-req-actions"><button class="daily-mini-btn" type="button" ${partyNames.length?'':'disabled'} onclick="dailyCopyAfterPartyRoster()">명단 복사</button></div></div></div>`;
  const reconcileHtml=_dailyServerReconcileError?`<div class="daily-checkin-req pending"><div class="daily-checkin-req-head"><div><div class="daily-checkin-req-title">서버 운영 동기화 확인 필요</div><div class="daily-checkin-req-meta">${esc(_dailyServerReconcileError)} 네트워크를 확인한 뒤 이 화면을 다시 열어 주세요. 서버의 실중계 상태는 그대로 유지됩니다.</div></div></div></div>`:'';
  const linkHtml=`<div class="daily-checkin-link">회원·임원 공용 링크<br><strong>${esc(url)}</strong><br>회원은 경기 확인과 상태·뒷풀이 신청을, 명부 임원은 같은 화면에서 경기 운영까지 처리합니다.</div>${reconcileHtml}${partyHtml}`;
  if(!pending.length){
    box.className='daily-checkin-panel';
    box.innerHTML=linkHtml+`<div class="daily-checkin-req applied">
      <div class="daily-checkin-req-head">
        <div><div class="daily-checkin-req-title">확인 필요한 요청 없음</div><div class="daily-checkin-req-meta">안전한 요청은 자동 반영됩니다.</div></div>
      </div>
    </div>`;
    return;
  }
  box.className='daily-checkin-panel';
  box.innerHTML=linkHtml+pending.map(req=>{
    const p=_dailyPlayer(req.playerId);
    const reason=_dailyCheckinBlockReason(req,p);
    const name=req.playerName||p?.name||'알 수 없음';
    const from=p?_dailyCheckinStatusLabel(p.status):'명단 없음';
    const to=_dailyCheckinStatusLabel(req.status);
    return `<div class="daily-checkin-req pending">
      <div class="daily-checkin-req-head">
        <div>
          <div class="daily-checkin-req-title">${esc(name)} · ${esc(from)} → ${esc(to)}</div>
          <div class="daily-checkin-req-meta">${esc(reason)}${req.note?` · ${esc(req.note)}`:''}</div>
        </div>
        <div class="daily-checkin-req-actions">
          <button class="daily-mini-btn" ${_dailyPaused?'disabled':''} onclick="dailyApproveCheckinRequest('${req.key}')">반영</button>
          <button class="daily-mini-btn danger" onclick="dailyIgnoreCheckinRequest('${req.key}')">무시</button>
        </div>
      </div>
    </div>`;
  }).join('');
}
function dailyRender(){
  const queueChanged=_dailyPaused?false:dailyEnsureQueue();
  if(queueChanged)dailySave();
  dailyRenderClosingSchedule();
  dailyRenderCourtSettings();
  dailyRenderTeamControls();
  dailyRenderTeamRoster();
  dailyRenderOpsStats();
  dailyRenderResults();
  dailyRenderCheckinRequests();
  dailyRenderAfterPartySpotlight();
  dailyRenderReservations();
  dailyRenderUnscheduled();
  const stats=document.getElementById('dailyStats');
  if(stats){
    const counts={invited:0,planned:0,wait:0,playing:0,rest:0,done:0};
    _dailyPlayers.forEach(p=>{
      const st=_dailyNormalizeStatus(p.status);
      counts[st]=(counts[st]||0)+1;
    });
    const active=_dailyActiveMatches().length;
    const notRegistered=(counts.invited||0)+(counts.planned||0);
    stats.innerHTML=[
      ['등록 전',notRegistered],
      ['참가',counts.wait],
      ['경기중',counts.playing],
      ['휴식',counts.rest],
      ['완료경기',_dailyMatches.filter(m=>m.completedAt).length]
    ].map(([l,v])=>`<div class="daily-stat"><b>${v}</b><span>${l}</span></div>`).join('');
  }
  const list=document.getElementById('dailyPlayerList');
  if(list){
    _dailyUpdatePlayerSortButtons();
    _dailyUpdatePlayerToolState();
    if(!_dailyPlayers.length)list.innerHTML='<div class="daily-empty">민턴LIVE 명단이 비어 있습니다. 클럽 명부를 가져오거나 선수를 직접 추가하세요.</div>';
    else{
      const filtered=_dailyFilterPlayersForManage(_dailyPlayers);
      const sorted=_dailySortPlayersForManage(filtered);
      list.innerHTML=sorted.length?sorted.map(p=>`<button type="button" class="daily-player ${_dailyPairSelectId===p.id?'daily-pair-selecting':''}" onclick="dailyOpenPlayerSheet('${p.id}')">
        <span class="daily-player-main">
          <span class="daily-player-top">
            <span class="daily-player-name">${_dailyNameHtml(p)} ${_dailyStatusBadge(p.status)} ${_dailyQueueLabelForPlayer(p.id)}</span>
          </span>
          <span class="daily-player-meta">${_dailyPlayerMetaText(p)}</span>
        </span>
        <span class="daily-player-more" aria-hidden="true">›</span>
      </button>`).join(''):`<div class="daily-empty">검색 결과가 없습니다.</div>`;
    }
  }
  dailyRenderRecommend();
  dailyRenderMatches();
}

/* ═══ TOURNAMENT RSVP LINK ═══ */
const RSVP_KEY='kokmatch_rsvp_id';
const RSVP_TITLE_KEY='kokmatch_rsvp_title';
const RSVP_CLUB_KEY='kokmatch_rsvp_club_id';
const RSVP_GUEST_LIMIT_KEY='kokmatch_rsvp_guest_limit';
const RSVP_DIRECT_VALUE='__direct__';
let _rsvpId=null;
let _rsvpListening=false;
let _rsvpResponses={};
let _rsvpSyncTimer=null;

function _rsvpDefaultTitle(){
  const d=new Date();
  return `${d.getMonth()+1}월 민턴LIVE`;
}
function _rsvpTitle(){
  const el=document.getElementById('rsvpTitle');
  const v=(el&&el.value.trim())||localStorage.getItem(RSVP_TITLE_KEY)||_rsvpDefaultTitle();
  return v;
}
function _rsvpGuestLimit(){
  const el=document.getElementById('rsvpGuestLimit');
  const raw=el?el.value.trim():(localStorage.getItem(RSVP_GUEST_LIMIT_KEY)||'');
  const n=parseInt(raw,10);
  return Number.isFinite(n)&&n>0?n:null;
}
function _rsvpGenId(){
  const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s='R';for(let i=0;i<7;i++)s+=c[Math.floor(Math.random()*c.length)];
  return s;
}
function _rsvpPath(){
  return _rsvpId?'live/rsvp_'+_rsvpId:'';
}
function _rsvpUrl(){
  if(!_rsvpId)return '';
  const base=location.origin+location.pathname.replace(/[^/]*$/,'');
  return base+'rsvp.html?id='+_rsvpId;
}
function _liveUrl(){
  if(!_liveId)return '';
  const base=location.origin+location.pathname.replace(/[^/]*$/,'');
  return base+'view.html?id='+_liveId;
}
function _rsvpEventPayload(){
  const roundCount=currentMatches.length?Math.max(...currentMatches.map(m=>m.round||0)):0;
  const liveActive=!!(_liveOn&&_liveId);
  return {
    phase:liveActive?'live':(currentMatches.length?'bracket':'rsvp'),
    bracketReady:!!currentMatches.length,
    matchCount:currentMatches.length||0,
    roundCount,
    liveId:liveActive?_liveId:null,
    liveUrl:liveActive?_liveUrl():null,
    eventUpdatedAt:Date.now()
  };
}
async function rsvpPushEventState(){
  if(!_rsvpId||!_fbDb)return null;
  const payload=_rsvpEventPayload();
  try{
    await _fbDb.ref(_rsvpPath()).update({kind:'tournamentRsvp',updatedAt:Date.now()});
    await _fbDb.ref(_rsvpPath()+'/session').update(payload);
    return payload;
  }catch(e){return null;}
}
function _rsvpHash(str){
  let h=2166136261;
  for(let i=0;i<str.length;i++){
    h^=str.charCodeAt(i);
    h+=(h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24);
  }
  return (h>>>0).toString(36);
}
function _rsvpMemberId(m){
  return 'm_'+_rsvpHash(`${m.club||''}|${m.name||''}`);
}
function _rsvpNameKey(name){
  return String(name||'').replace(/\s+/g,'').toLowerCase();
}
function _rsvpClubs(){
  return (rosters.clubs||[]).filter(c=>(c.members||[]).length);
}
function _rsvpSelectedSource(){
  const clubs=_rsvpClubs();
  const saved=localStorage.getItem(RSVP_CLUB_KEY)||'';
  if(saved===RSVP_DIRECT_VALUE&&_directPlayers.length)return RSVP_DIRECT_VALUE;
  if(clubs.some(c=>c.id===saved))return saved;
  if(clubs.length===1)return clubs[0].id;
  if(!clubs.length&&_directPlayers.length)return RSVP_DIRECT_VALUE;
  return '';
}
function _rsvpSelectedLabel(){
  const src=_rsvpSelectedSource();
  if(src===RSVP_DIRECT_VALUE)return '현재 참가자 입력';
  const club=_rsvpClubs().find(c=>c.id===src);
  return club?club.name:'클럽 미선택';
}
function _rsvpNeedsClubSelection(){
  return !_rsvpSelectedSource()&&_rsvpClubs().length>1;
}
function rsvpRenderClubSelect(){
  const sel=document.getElementById('rsvpClubSelect');
  if(!sel)return;
  const clubs=_rsvpClubs();
  const src=_rsvpSelectedSource();
  const opts=[];
  opts.push(`<option value="">${clubs.length?'발송할 클럽 명부 선택':'등록된 클럽 명부 없음'}</option>`);
  clubs.forEach(c=>opts.push(`<option value="${esc(c.id)}">${esc(c.name)} 명부 (${(c.members||[]).length}명)</option>`));
  if(_directPlayers.length)opts.push(`<option value="${RSVP_DIRECT_VALUE}">현재 참가자 입력 (${_directPlayers.length}명)</option>`);
  sel.innerHTML=opts.join('');
  sel.value=src;
}
function rsvpSetClub(value){
  if(value)localStorage.setItem(RSVP_CLUB_KEY,value);
  else localStorage.removeItem(RSVP_CLUB_KEY);
  rsvpRender();
  if(value)rsvpPushSession();
}
function _rsvpRosterMembers(){
  const src=_rsvpSelectedSource();
  const map=new Map();
  const rosterNameKeys=new Set();
  const selectedClubs=src&&src!==RSVP_DIRECT_VALUE
    ? _rsvpClubs().filter(c=>c.id===src)
    : [];
  selectedClubs.forEach(club=>{
    (club.members||[]).forEach(m=>{
      if(!m||!m.name)return;
      const base={name:m.name,grade:m.grade||'C',gender:m.gender||'남',ageGroup:m.ageGroup||'40대',club:club.name||'',isClubOfficial:!!m.isClubOfficial};
      base.id=_rsvpMemberId(base);
      if(!map.has(base.id))map.set(base.id,base);
      rosterNameKeys.add(_rsvpNameKey(base.name));
    });
  });
  if(src===RSVP_DIRECT_VALUE){
    (_directPlayers||[]).forEach(p=>{
      if(!p||!p.name)return;
      const gender=p.gender||'남';
      const grade=p.grade||levelToGrade(p.level||4,gender)||'C';
      const base={name:p.name,grade,gender,ageGroup:p.ageGroup||'40대',club:p.club||'',isGuest:!!p.isGuest,isClubOfficial:!!p.isClubOfficial};
      if(!base.isGuest&&!base.club&&rosterNameKeys.has(_rsvpNameKey(base.name)))return;
      base.id=_rsvpMemberId(base);
      if(!map.has(base.id))map.set(base.id,base);
    });
  }
  return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name,'ko')||String(a.club||'').localeCompare(String(b.club||''),'ko'));
}
function _rsvpSessionPayload(){
  const src=_rsvpSelectedSource();
  const club=_rsvpClubs().find(c=>c.id===src);
  return {
    kind:'tournamentRsvp',
    title:_rsvpTitle(),
    clubId:src===RSVP_DIRECT_VALUE?'':(club?.id||''),
    clubName:src===RSVP_DIRECT_VALUE?'현재 참가자 입력':(club?.name||''),
    source:src===RSVP_DIRECT_VALUE?'directPlayers':'clubRoster',
    updatedAt:Date.now(),
    version:APP_VERSION,
    guestLimit:_rsvpGuestLimit(),
    gamesPerPlayer:parseInt(document.getElementById('gamesPerPlayer')?.value||'4',10)||4,
    members:_rsvpRosterMembers(),
    ..._rsvpEventPayload()
  };
}
function rsvpSaveLocal(){
  const title=_rsvpTitle();
  localStorage.setItem(RSVP_TITLE_KEY,title);
  const limit=_rsvpGuestLimit();
  if(limit)localStorage.setItem(RSVP_GUEST_LIMIT_KEY,String(limit));
  else localStorage.removeItem(RSVP_GUEST_LIMIT_KEY);
  if(_rsvpId)rsvpPushSession();
}
function rsvpEnsureId(){
  if(!_rsvpId){
    _rsvpId=localStorage.getItem(RSVP_KEY)||_rsvpGenId();
    localStorage.setItem(RSVP_KEY,_rsvpId);
  }
  return _rsvpId;
}
function rsvpPushSession(){
  if(!_rsvpId||!_fbDb)return;
  if(_rsvpNeedsClubSelection()||!_rsvpRosterMembers().length)return;
  const path=_rsvpPath();
  _fbDb.ref(path).update({kind:'tournamentRsvp',updatedAt:Date.now()}).catch(()=>{});
  _fbDb.ref(path+'/session').set(_rsvpSessionPayload()).catch(()=>{});
}
function rsvpSyncRosterChange(){
  rsvpRender();
  if(!_rsvpId||!_fbDb)return;
  if(_rsvpNeedsClubSelection()||!_rsvpRosterMembers().length)return;
  clearTimeout(_rsvpSyncTimer);
  _rsvpSyncTimer=setTimeout(()=>rsvpPushSession(),250);
}
async function rsvpPublishSession(silent){
  if(_rsvpNeedsClubSelection()){
    if(!silent)alert('먼저 공지를 보낼 클럽 명부를 선택해 주세요.');
    return null;
  }
  const members=_rsvpRosterMembers();
  if(!members.length){
    if(!silent)alert('선택한 클럽 명부에 회원이 없습니다. 명부를 확인해 주세요.');
    return null;
  }
  if(!_fbInit()){
    if(!silent)alert('참석 링크 서버 연결에 실패했어요. 네트워크를 확인해 주세요.');
    return null;
  }
  rsvpEnsureId();
  const path=_rsvpPath();
  await _fbDb.ref(path).update({kind:'tournamentRsvp',updatedAt:Date.now()});
  await _fbDb.ref(path+'/session').set(_rsvpSessionPayload());
  rsvpStartListener();
  rsvpRender();
  return _rsvpId;
}
async function rsvpShareLink(){
  const id=await rsvpPublishSession(false);
  if(!id)return;
  const url=_rsvpUrl();
  const title=_rsvpTitle();
  const text=`🏸 ${title}\n참석 여부를 알려주세요.\n\n${url}`;
  try{
    if(navigator.share){
      await navigator.share({title:`${title} 참석 확인`,text});
      return;
    }
  }catch(e){}
  try{
    await navigator.clipboard.writeText(text);
    alert('밴드 공지 문구를 복사했습니다. 네이버 밴드에 붙여넣어 주세요.\n\n'+url);
  }catch(e){
    prompt('아래 문구를 복사해서 밴드에 올려주세요.',text);
  }
}
function rsvpLoad(){
  const titleEl=document.getElementById('rsvpTitle');
  if(titleEl&&!titleEl.value)titleEl.value=localStorage.getItem(RSVP_TITLE_KEY)||_rsvpDefaultTitle();
  const limitEl=document.getElementById('rsvpGuestLimit');
  if(limitEl&&!limitEl.value)limitEl.value=localStorage.getItem(RSVP_GUEST_LIMIT_KEY)||'';
  rsvpRenderClubSelect();
  _rsvpId=localStorage.getItem(RSVP_KEY)||null;
  if(_rsvpId&&_fbInit()){
    if(!_rsvpNeedsClubSelection()&&_rsvpRosterMembers().length)rsvpPushSession();
    rsvpStartListener();
  }
}
function rsvpStartListener(){
  if(!_rsvpId||!_fbDb||_rsvpListening)return;
  _rsvpListening=true;
  _fbDb.ref(_rsvpPath()+'/responses').on('value',snap=>{
    _rsvpResponses=snap.val()||{};
    rsvpRender();
  });
}
function _rsvpResponseList(){
  return Object.keys(_rsvpResponses||{}).map(id=>({id,..._rsvpResponses[id]}));
}
function _rsvpIsAttending(status){
  return status==='attend'||status==='ready';
}
function _rsvpResponseGuests(r){
  const list=[];
  const seen=new Set();
  const add=g=>{
    if(!g||!String(g.name||'').trim())return;
    const item={
      name:String(g.name).trim(),
      gender:g.gender||'남',
      grade:g.grade||'C',
      ageGroup:g.ageGroup||r?.ageGroup||'40대'
    };
    const key=[item.name,item.gender,item.grade,item.ageGroup].join('|');
    if(seen.has(key))return;
    seen.add(key);
    list.push(item);
  };
  if(Array.isArray(r?.guests))r.guests.forEach(add);
  add(r?.guest);
  return list;
}
function _rsvpStats(){
  const members=_rsvpRosterMembers();
  const memberIds=new Set(members.map(m=>m.id));
  const responses=_rsvpResponseList().filter(r=>memberIds.has(r.memberId||r.id));
  const counts={attend:0,decline:0,maybe:0,guest:0,issues:0};
  responses.forEach(r=>{
    const guestList=_rsvpResponseGuests(r);
    if(_rsvpIsAttending(r.status))counts.attend++;
    else if(r.status==='decline')counts.decline++;
    else counts.maybe++;
    counts.guest+=guestList.length;
    if(_rsvpIsAttending(r.status)&&guestList.some(g=>!g.gender||!g.grade))counts.issues++;
  });
  counts.noResponse=Math.max(0,members.length-responses.length);
  counts.total=members.length;
  return {members,responses,counts};
}
function _rsvpStatusLabel(status){
  return status==='attend'?'참석':status==='decline'?'불참':'미정';
}
function rsvpRender(){
  const box=document.getElementById('rsvpBox');
  const summary=document.getElementById('rsvpSummary');
  if(!box)return;
  rsvpRenderClubSelect();
  const {members,responses,counts}=_rsvpStats();
  const guestLimitForSummary=_rsvpGuestLimit();
  const guestSummaryText=guestLimitForSummary?`${counts.guest}/${guestLimitForSummary}`:String(counts.guest);
  if(summary)summary.textContent=_rsvpId?`(${_rsvpSelectedLabel()} · ${counts.attend}명 참석 · 게스트 ${guestSummaryText}명)`:'';
  if(_rsvpNeedsClubSelection()){
    box.className='daily-empty';
    box.textContent='여러 클럽 명부가 있습니다. 먼저 공지를 보낼 클럽 명부를 선택하세요.';
    return;
  }
  if(!_rsvpId){
    box.className='daily-empty';
    box.textContent=members.length?`${_rsvpSelectedLabel()} 대상으로 참석 링크를 만들 준비가 됐습니다. 링크 복사를 누르세요.`:'선택한 클럽 명부에 회원이 없습니다.';
    return;
  }
  const url=_rsvpUrl();
  const guestLimit=_rsvpGuestLimit();
  const guestText=guestLimit?`${counts.guest}/${guestLimit}`:String(counts.guest);
  const latest=[...responses].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,8);
  const guestRows=responses
    .flatMap(r=>_rsvpResponseGuests(r).map(g=>({response:r,guest:g})))
    .filter(item=>_rsvpIsAttending(item.response.status))
    .sort((a,b)=>(b.response.updatedAt||0)-(a.response.updatedAt||0));
  const issueRows=responses.filter(r=>_rsvpIsAttending(r.status)&&_rsvpResponseGuests(r).some(g=>!g.gender||!g.grade));
  box.className='rsvp-panel';
  box.innerHTML=`
    <div class="rsvp-link">대상: <strong>${esc(_rsvpSelectedLabel())}</strong><br>공유 링크<br><strong>${esc(url)}</strong><br>회원이 누른 참석 정보는 이 화면에 자동 집계됩니다.</div>
    <div class="rsvp-stats">
      <div class="rsvp-stat"><b>${counts.attend}</b><span>참석 확정</span></div>
      <div class="rsvp-stat ${guestLimit&&counts.guest>=guestLimit?'warn':''}"><b>${esc(guestText)}</b><span>게스트</span></div>
      <div class="rsvp-stat ${counts.noResponse?'warn':''}"><b>${counts.noResponse}</b><span>미응답</span></div>
      <div class="rsvp-stat ${counts.issues?'warn':''}"><b>${counts.issues}</b><span>확인 필요</span></div>
    </div>
    <div class="daily-checkin-req-actions">
      <button class="daily-mini-btn" onclick="rsvpImportAttendees()">참석자 대진표로 가져오기</button>
      <button class="daily-mini-btn" onclick="rsvpShareLink()">링크 복사</button>
      <button class="daily-mini-btn danger" onclick="rsvpStopLink()">링크 종료</button>
    </div>
    ${guestRows.length?`<div class="rsvp-list"><div class="rsvp-section-title">게스트 신청 ${esc(guestText)}명 · 신청자 확인</div>${guestRows.map(item=>_rsvpGuestRowHtml(item)).join('')}</div>`:''}
    ${issueRows.length?`<div class="rsvp-list">${issueRows.map(r=>_rsvpRowHtml(r,true)).join('')}</div>`:''}
    <div class="rsvp-list">${latest.length?latest.map(r=>_rsvpRowHtml(r,false)).join(''):'<div class="daily-empty">아직 응답이 없습니다.</div>'}</div>`;
}
function _rsvpGuestRowHtml(item){
  const r=item.response||item;
  const g=item.guest||r.guest||{};
  const updated=r.updatedAt?new Date(r.updatedAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}):'';
  return `<div class="rsvp-row guest">
    <div>
      <div class="rsvp-name">${esc(g.name||'게스트 이름 없음')} <span class="rsvp-meta">(${esc(g.gender||'성별?')} · ${esc(g.grade||'급수?')}급)</span></div>
      <div class="rsvp-meta">신청자 ${esc(r.memberName||r.name||'확인 필요')}${r.club?` · ${esc(r.club)}`:''}${updated?` · ${esc(updated)}`:''}</div>
    </div>
    <span class="rsvp-badge attend">게스트</span>
  </div>`;
}
function _rsvpRowHtml(r,warn){
  const guestList=_rsvpResponseGuests(r);
  const guest=guestList.length?` · 게스트 ${guestList.map(g=>`${g.name}(${g.gender||'성별?'}/${g.grade||'급수?'})`).join(', ')}`:'';
  const updated=r.updatedAt?new Date(r.updatedAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}):'';
  return `<div class="rsvp-row ${warn?'warn':''}">
    <div>
      <div class="rsvp-name">${esc(r.memberName||r.name||'이름 없음')}${guest?esc(guest):''}</div>
      <div class="rsvp-meta">${esc(r.club||'')} ${updated?`· ${esc(updated)}`:''}${r.note?` · ${esc(r.note)}`:''}</div>
    </div>
    <span class="rsvp-badge ${esc(r.status||'maybe')}">${esc(_rsvpStatusLabel(r.status))}</span>
  </div>`;
}
function _rsvpBracketHasStarted(){
  if(!currentMatches.length)return false;
  if(_liveOn)return true;
  return currentMatches.some((_,i)=>_isMatchDone(i));
}
function _rsvpClearUnstartedBracket(){
  if(!currentMatches.length)return;
  _captureUndoSnapshot('출석자 가져오기 전');
  teamAssignment=null;
  _teamModeOverride=false;
  _teamWanted=false;
  captains={blue:{leader:'',sub:''},white:{leader:'',sub:''}};
  currentMatches=[];
  currentParticipants=[];
  currentSettings={};
  _fastResetState();
  _lockedBeforeRound=null;
  Object.keys(winOverride).forEach(k=>delete winOverride[k]);
  _resetScoreboard();
  const result=document.getElementById('resultArea');
  if(result)result.classList.add('hidden');
  const teamWrap=document.getElementById('teamListWrap');
  if(teamWrap)teamWrap.classList.remove('show');
  updateTeamModeBadge();
  hideErr();
  rsvpPushEventState();
}
function rsvpImportAttendees(){
  const {members,responses,counts}= _rsvpStats();
  const memberById=new Map(members.map(m=>[m.id,m]));
  const attendees=responses.filter(r=>_rsvpIsAttending(r.status));
  if(!attendees.length){alert('참석 확정자가 아직 없습니다.');return;}
  if(currentMatches.length){
    if(_rsvpBracketHasStarted()){
      alert('이미 진행되었거나 결과가 입력된 기존 대진표가 있습니다.\n기록 보호를 위해 자동 초기화하지 않습니다.\n필요하면 전체 초기화 또는 선수 변동 재배정을 먼저 확인해 주세요.');
      return;
    }
    if(!confirm('기존 대진표가 아직 남아 있습니다.\n미진행 대진표를 초기화하고 출석자를 참가자로 가져올까요?'))return;
    _rsvpClearUnstartedBracket();
  }
  if(_directPlayers.length&&!confirm(`현재 대진표 참가자 ${_directPlayers.length}명을 지우고 참석 확정자 ${counts.attend}명으로 교체할까요?`))return;
  const next=[];
  const seen=new Set();
  const usedNames=new Set();
  const uniqueName=(name,isGuest)=>{
    if(!usedNames.has(name)){
      usedNames.add(name);
      return name;
    }
    const suffix=isGuest?'게스트':'동명이인';
    let candidate=`${name}(${suffix})`;
    let n=2;
    while(usedNames.has(candidate))candidate=`${name}(${suffix}${n++})`;
    usedNames.add(candidate);
    return candidate;
  };
  const add=(p,scope='member')=>{
    const rawName=(p.name||'').trim();
    const key=`${scope}|${_rsvpNameKey(rawName)}|${p.club||''}`;
    if(!rawName||seen.has(key))return;
    seen.add(key);
    const name=uniqueName(rawName,!!p.isGuest);
    const gender=p.gender||'남';
    const grade=p.grade||levelToGrade(p.level||4,gender)||'C';
    next.push({
      name,
      grade,
      gender,
      level:gradeToLevel(grade,gender)||4,
      ageGroup:p.ageGroup||'40대',
      club:p.club||'',
      isGuest:!!p.isGuest,
      isClubOfficial:!!p.isClubOfficial
    });
  };
  attendees.forEach(r=>{
    const profile=memberById.get(r.memberId||r.id)||{};
    add({
      name:profile.name||r.memberName||r.name,
      grade:profile.grade||r.grade,
      gender:profile.gender||r.gender,
      ageGroup:profile.ageGroup||r.ageGroup,
      club:profile.club||r.club,
      isClubOfficial:!!profile.isClubOfficial
    },'member');
    _rsvpResponseGuests(r).forEach((g,idx)=>{
      add({
        name:g.name,
        grade:g.grade||'C',
        gender:g.gender||'남',
        ageGroup:g.ageGroup||r.ageGroup||'40대',
        club:r.club,
        isGuest:true
      },`guest:${_rsvpNameKey(r.memberName||r.name||'')}:${idx}`);
    });
  });
  _directPlayers=next;
  teamAssignment=null;
  _teamWanted=false;
  _teamModeOverride=false;
  captains={blue:{leader:'',sub:''},white:{leader:'',sub:''}};
  setOperationPreset('daily');
  renderDirectPlayerList();
  syncDirectToPaste();
  updateTeamModeBadge();
  switchNav('main');
  if(typeof syncBottomNav==='function')syncBottomNav('daily');
  setTimeout(()=>{
    const el=document.getElementById('sec-settings');
    if(el)window.scrollTo({top:el.getBoundingClientRect().top+window.scrollY-10,behavior:'smooth'});
  },30);
  scheduleSave();
  alert(`참석 확정자 ${counts.attend}명과 게스트 ${counts.guest}명을 참가자로 가져왔습니다.`);
}
async function rsvpStopLink(){
  if(!_rsvpId)return;
  if(!confirm('출석 링크를 종료할까요?\n이미 보낸 링크에서는 더 이상 참석부를 볼 수 없습니다.'))return;
  const path=_rsvpPath();
  if(_fbDb)await _fbDb.ref(path).remove().catch(()=>{});
  localStorage.removeItem(RSVP_KEY);
  _rsvpId=null;_rsvpResponses={};_rsvpListening=false;
  rsvpRender();
  syncMonthlyTeamFolds();
}
function dailyRenderMatches(){
  const el=document.getElementById('dailyMatchList');
  if(!el)return;
  const active=_dailyActiveMatches().filter(m=>!m.cancelledAt).sort((a,b)=>a.court-b.court);
  const pausedAttr=_dailyPaused?'disabled':'';
  const recent=_dailyMatches.filter(m=>m.completedAt&&!m.cancelledAt).sort((a,b)=>b.seq-a.seq).slice(0,4);
  const summary=document.getElementById('dailyMatchSummary');
  if(summary)summary.textContent='';
  const renderRecentMatch=m=>{
    const t1=m.team1.map(_dailyPlayer).filter(Boolean),t2=m.team2.map(_dailyPlayer).filter(Boolean);
    const done=!!m.completedAt;
    const labelA=_dailyMatchSideLabel(m,'t1');
    const labelB=_dailyMatchSideLabel(m,'t2');
    return `<div class="daily-match">
      <div class="daily-match-top">
        <div class="daily-match-title">${done?'최근 완료':'진행중'} · 투입 ${m.seq} · 코트 ${m.court} · ${m.reservationLabel?'신청경기 · ':''}${esc(m.type)}${m.flexible?' · 예외':''} · 25점</div>
        <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
          ${done?`<span class="daily-status done">완료</span>`:`<span class="daily-timer ${_dailyTimerState(m)==='soon'?'soon':''} ${_dailyTimerState(m)==='due'?'due':''}" data-daily-timer="${m.id}">${esc(_dailyTimerText(m))}</span>`}
        </div>
      </div>
      <div class="daily-match-body">
        <div class="daily-team"><div class="daily-team-label">${esc(labelA)}</div><div class="daily-team-name">${t1.map(_dailyNameHtml).join('<br>')}</div></div>
        <div class="daily-vs">VS</div>
        <div class="daily-team b"><div class="daily-team-label">${esc(labelB)}</div><div class="daily-team-name">${t2.map(_dailyNameHtml).join('<br>')}</div></div>
      </div>
      ${done?'':`<div class="daily-win-actions"><button class="daily-mini-btn primary-action" data-daily-complete="${m.id}" ${pausedAttr} onclick="dailyCompleteMatch('${m.id}')">${esc(_dailyCompleteButtonText(m))}</button></div>`}
    </div>`;
  };
  const activeByCourt=new Map(active.map(m=>[m.court,m]));
  const startableQueues=_dailyQueue.filter(q=>_dailyQueueItemValid(q,null)&&!_dailyQueueRestPassActive(q));
  const freeCourtStartMap=new Map(_dailyFreeCourts().map((court,idx)=>[court,startableQueues[idx]||null]));
  const renderCourt=c=>{
    const m=activeByCourt.get(c);
    if(!m){
      const startQueue=freeCourtStartMap.get(c)||null;
      const startIdx=startQueue?_dailyQueue.findIndex(q=>q.id===startQueue.id):-1;
      const canStart=!_dailyPaused&&startQueue&&_dailyQueueItemValid(startQueue,null);
      const startLabel=startIdx>0?`${startIdx+1}순위 경기 시작`:'1순위 경기 시작';
      return `<div class="daily-court-card free">
        <div class="daily-court-head">
          <div class="daily-court-title">${c}코트</div>
          <span class="daily-court-state free">빈 코트</span>
        </div>
        <div class="daily-court-body">
          <div class="daily-court-empty">${canStart?`${startIdx+1}순위 대기 시작 가능`:'대기 없음'}</div>
          ${canStart?`<div class="daily-court-actions single"><button class="daily-mini-btn primary-action" onclick="dailyStartQueueItem('${startQueue.id}',{court:${c}})">${startLabel}</button></div>`:''}
        </div>
      </div>`;
    }
    const t1=m.team1.map(_dailyPlayer).filter(Boolean),t2=m.team2.map(_dailyPlayer).filter(Boolean);
    const state=_dailyTimerState(m);
    const playerButton=(side,p,i)=>`<button class="daily-active-player" type="button" ${pausedAttr} title="이름을 눌러 대기선수로 교체" onclick="dailyPickActiveReplacement('${m.id}','${side}',${i})">${_dailyNameHtml(p)}</button>`;
    return `<div class="daily-court-card busy ${state==='due'?'due':state==='soon'?'soon':''}" data-daily-court-card="${m.id}">
      <div class="daily-court-head">
        <div class="daily-court-title"><button class="daily-court-title-btn" type="button" ${pausedAttr} title="코트 번호 변경" onclick="dailyEditActiveCourt('${m.id}')">${m.court}코트</button></div>
        <span class="daily-timer ${state==='soon'?'soon':''} ${state==='due'?'due':''}" data-daily-timer="${m.id}">${esc(_dailyTimerText(m))}</span>
      </div>
      <div class="daily-court-body">
        <div class="daily-court-teams daily-court-stack">
          <div class="daily-court-team-name">${t1.map((p,i)=>playerButton('team1',p,i)).join('')}</div>
          <div class="daily-court-vs">vs</div>
          <div class="daily-court-team-name b">${t2.map((p,i)=>playerButton('team2',p,i)).join('')}</div>
        </div>
        <div class="daily-court-actions single">
          <button class="daily-mini-btn danger" data-daily-complete="${m.id}" ${pausedAttr} onclick="dailyCompleteMatch('${m.id}')">종료</button>
        </div>
      </div>
    </div>`;
  };
  const courtCount=_dailyCourtCount();
  const maxActiveCourt=active.reduce((max,m)=>Math.max(max,parseInt(m.court)||0),0);
  const displayCourtCount=Math.max(courtCount,maxActiveCourt);
  const courtHtml=`<div class="daily-court-grid">${Array.from({length:displayCourtCount},(_,i)=>renderCourt(i+1)).join('')}</div>`;
  const recentHtml=recent.length
    ? `<details class="daily-completed-fold"><summary>최근 완료 경기 ${recent.length}개</summary><div class="daily-completed-body">${recent.map(renderRecentMatch).join('')}</div></details>`
    : '';
  el.innerHTML=courtHtml+recentHtml;
}

let _dailyImportClubIdx=0;
let _dailyImportSort='reg';

function closeDailyImportModal(){
  document.getElementById('dailyImportModal').classList.add('hidden');
}
function renderDailyImportTabs(){
  const el=document.getElementById('dailyImportClubTabs');
  if(!el)return;
  el.innerHTML=`<div class="club-tabs-bar">${(rosters.clubs||[]).map((c,i)=>
    `<button class="ctab-btn${i===_dailyImportClubIdx?' active':''}" onclick="selectDailyImportClub(${i})">${esc(c.name)}</button>`
  ).join('')}</div>`;
}
function selectDailyImportClub(idx){
  document.querySelectorAll('.daily-import-chk').forEach(c=>{c.checked=false;});
  _dailyImportClubIdx=idx;
  _dailyImportSort='reg';
  ['reg','name','gender'].forEach(m=>{
    const btn=document.getElementById('disb-'+m);
    if(btn)btn.classList.toggle('active',m==='reg');
  });
  renderDailyImportTabs();
  renderDailyImportMembers();
}
function setDailyImportSort(mode){
  _dailyImportSort=mode;
  ['reg','name','gender'].forEach(m=>{
    const btn=document.getElementById('disb-'+m);
    if(btn)btn.classList.toggle('active',m===mode);
  });
  renderDailyImportMembers();
}
function renderDailyImportMembers(){
  const club=(rosters.clubs||[])[_dailyImportClubIdx];
  const el=document.getElementById('dailyImportMemberList');
  if(!el)return;
  if(!club||!(club.members||[]).length){
    el.innerHTML='<div class="dir-empty">이 클럽에 등록된 회원이 없습니다</div>';
    return;
  }
  const existingByName=new Map(_dailyPlayers.map(p=>[p.name,p]));
  const canRegister=m=>{
    const existing=existingByName.get(m.name);
    if(!existing)return true;
    return ['invited','planned'].includes(_dailyNormalizeStatus(existing.status));
  };
  const prevChecked=new Set();
  document.querySelectorAll('.daily-import-chk:not(:disabled)').forEach(c=>{
    if(c.checked)prevChecked.add(parseInt(c.value));
  });
  const indexed=(club.members||[]).map((m,i)=>({...m,_origIdx:i}));
  if(_dailyImportSort==='name'){
    indexed.sort((a,b)=>a.name.localeCompare(b.name,'ko'));
  }else if(_dailyImportSort==='gender'){
    indexed.sort((a,b)=>{
      if(a.gender!==b.gender)return a.gender==='남'?-1:1;
      return a.name.localeCompare(b.name,'ko');
    });
  }
  indexed.sort((a,b)=>{
    const aIn=canRegister(a)?0:1;
    const bIn=canRegister(b)?0:1;
    return aIn-bIn;
  });
  const available=indexed.filter(canRegister).length;
  const total=indexed.length;
  const GC={7:'lv6',6:'lv6',5:'lv5',4:'lv4',3:'lv3',2:'lv2',1:'lv1',0:'lv1'};
  el.innerHTML=`<div style="padding:7px 12px;font-size:.72rem;color:var(--dim);border-bottom:1px solid var(--bdr);background:var(--sur2);">
    오늘 추가 가능 <b style="color:var(--bl)">${available}명</b> · 이미 있음 <b>${total-available}명</b>
  </div>`+indexed.map(m=>{
    const existing=existingByName.get(m.name);
    const isDup=!!existing&&!canRegister(m);
    const checked=!isDup&&prevChecked.has(m._origIdx);
    if(isDup){
      return `<label class="import-member-row" style="opacity:.45;cursor:default;background:#f8f8f8;">
        <input type="checkbox" class="daily-import-chk" value="${m._origIdx}" disabled>
        <span style="flex:1;font-size:.84rem;font-weight:700;color:#999;">${esc(m.name)}</span>
        <span style="font-size:.65rem;color:#bbb;margin-right:6px;">이미 참가 등록</span>
        <span style="font-size:.68rem;color:#ccc;"><span class="lv-badge" style="background:#f0f0f0;color:#bbb;border-color:#e0e0e0;">${esc(m.grade||'')}</span> ${esc(m.gender||'')}</span>
      </label>`;
    }
    return `<label class="import-member-row">
      <input type="checkbox" class="daily-import-chk" value="${m._origIdx}" ${checked?'checked':''}>
      <span style="flex:1;font-size:.84rem;font-weight:700;">${esc(m.name)}</span>
      <span style="font-size:.68rem;color:var(--dim);">
        ${existing?'<span style="color:var(--warn);margin-right:5px;">등록 전</span>':''}
        <span class="lv-badge ${GC[m.level]||'lv3'}">${esc(m.grade||'C')}</span> ${esc(m.gender||'남')}
      </span>
    </label>`;
  }).join('');
}
function toggleDailySelectAll(){
  const chks=[...document.querySelectorAll('.daily-import-chk:not(:disabled)')];
  const all=chks.length&&chks.every(c=>c.checked);
  chks.forEach(c=>c.checked=!all);
}
async function importDailySelected(status){
  if(!_dailyCanChangeRoster())return;
  status='wait';
  const club=(rosters.clubs||[])[_dailyImportClubIdx];
  if(!club)return;
  const sel=[...document.querySelectorAll('.daily-import-chk:not(:disabled)')]
    .filter(c=>c.checked)
    .map(c=>club.members[parseInt(c.value)])
    .filter(Boolean);
  if(!sel.length){alert('선수를 1명 이상 선택해주세요.');return;}
  let added=0,reactivated=0,skipped=0;
  sel.forEach(m=>{
    const clubName=club.name||m.club||'';
    const profile={...m,club:clubName,memberId:m.memberId||_rsvpMemberId({name:m.name,club:clubName}),status};
    const existing=_dailyPlayers.find(p=>p.name===m.name);
    if(!existing){
      _dailyPlayers.push(_dailyNormalize(profile));
      added++;
      return;
    }
    if(['invited','planned'].includes(_dailyNormalizeStatus(existing.status))){
      const refreshed=_dailyNormalize({...profile,id:existing.id,status:'wait'});
      existing.grade=refreshed.grade;
      existing.level=refreshed.level;
      existing.gender=refreshed.gender;
      existing.ageGroup=refreshed.ageGroup;
      existing.memberId=refreshed.memberId;
      existing.club=refreshed.club;
      existing.isClubOfficial=refreshed.isClubOfficial;
      _dailyApplyPlayerStatus(existing,'wait');
      added++;
      reactivated++;
      return;
    }
    skipped++;
  });
  if(added)_dailyNext=null;
  closeDailyImportModal();
  dailySave();
  dailyRender();
  dailyMaybeAutoAssign();
  if(added){
    alert(`${added}명을 오늘 현장 참가자로 등록했습니다.${reactivated?` (등록 전 명단 ${reactivated}명 포함)`:''}${skipped?` (중복 ${skipped}명 제외)`:''}\n\n자유게임을 진행한 뒤 대진 게시를 눌러주세요.`);
  }else{
    alert('새로 참가 등록된 선수가 없습니다.');
  }
}

/* ═══ TEAM NAME CHANGE ═══ */
function syncFixedTeamNames(){
  teamNames.blue='청 팀';
  teamNames.white='홍 팀';
  const bi=document.getElementById('blueNameInput'); if(bi) bi.value=teamNames.blue;
  const wi=document.getElementById('whiteNameInput'); if(wi) wi.value=teamNames.white;
  const sb=document.getElementById('sbBlueName'); if(sb) sb.value=teamNames.blue;
  const sw=document.getElementById('sbWhiteName'); if(sw) sw.value=teamNames.white;
}
function onTeamNameChange(){
  syncFixedTeamNames();
  if(currentMatches.length) refreshScoreLabels();
}
function onSbNameChange(side){
  syncFixedTeamNames();
  if(currentMatches.length) refreshScoreLabels();
}
function refreshScoreLabels(){
  currentMatches.forEach((m,i)=>{
    const t1b=m.team1A.team==='청팀';
    const sl1=currentSettings.teamMode?(t1b?teamNames.blue:teamNames.white):'A';
    const sl2=currentSettings.teamMode?(t1b?teamNames.white:teamNames.blue):'B';
    const el1=document.getElementById('sl1_'+i);
    const el2=document.getElementById('sl2_'+i);
    if(el1)el1.textContent=sl1;
    if(el2)el2.textContent=sl2;
  });
  updateScores();
}

/* ═══ PASTE / PARSE (parseParticipants 유지 — roster 로드에 사용) ═══ */
function onPasteInput(){ /* 미사용 — 직접입력 전용 모드 */ }
function _onPasteInput_UNUSED(){
  const text='';
  const lines=text.split('\n').filter(l=>l.trim());
  const parsed=parseParticipants(text);
  const valid=parsed.filter(p=>p._valid);
  const st=document.getElementById('parseStatus');
  if(valid.length>0){
    const withTeam=valid.filter(p=>p.team==='청팀'||p.team==='홍팀').length;
    st.style.color='var(--green)';
    st.textContent=`✓ ${valid.length}명 인식${withTeam?` (팀 지정 ${withTeam}명)`:''} (오류 ${parsed.filter(p=>!p._valid).length}행)`;
    const hasTeamData=valid.some(p=>p.team==='청팀'||p.team==='홍팀');
    if(hasTeamData) applyColumnTeamAssignment(valid);
    else if(teamAssignment){
      teamAssignment=null;
      document.getElementById('teamListWrap').classList.remove('show');
      document.getElementById('teamAssignBtn').classList.remove('done');
      document.getElementById('teamAssignBtn').innerHTML='⚖️ 청/홍팀 자동 배정 <span style="font-size:.7rem;opacity:.6">(선택)</span>';
      updateTeamModeBadge();
    }
  } else { st.textContent=''; }
}

function applyColumnTeamAssignment(valid){
  valid.forEach(p=>{p.team='';});
  teamAssignment=null;
  _teamWanted=false;
  _teamModeOverride=false;
  updateTeamModeBadge();
}

function parseParticipants(raw){
  const lines=raw.split('\n').map(l=>l.trimEnd()).filter(l=>l.trim());
  const result=[];
  lines.forEach(line=>{
    const cols=line.split(/\t/).map(c=>c.trim());
    let name,levelRaw,genderRaw,teamRaw='';
    // handle row-number prefix (e.g. "1  김민현  3  남")
    if(cols.length>=4&&!isNaN(Number(cols[0]))&&cols[0]!==''){
      name=cols[1];levelRaw=cols[2];genderRaw=cols[3];teamRaw=cols[4]||'';
    } else if(cols.length>=3){
      name=cols[0];levelRaw=cols[1];genderRaw=cols[2];teamRaw=cols[3]||'';
    } else return;
    name=(name||'').trim();
    if(!name||name==='이름'||name==='name'||name==='a') return;
    const gender=genderRaw==='남'?'M':genderRaw==='여'?'F':null;
    // 급수(A~E) 또는 숫자 레벨 처리 — 여자는 남자 대비 -1 레벨
    const _GMAP={'S':7,'A':6,'B':5,'C':4,'D':3,'E':2};
    const _gs=(levelRaw||'').trim().toUpperCase();
    let level=null,_parsedGrade=null;
    if(_gs in _GMAP){
      _parsedGrade=_gs;
      level=_GMAP[_gs]+(gender==='F'?-1:0);
    } else {
      const n=parseFloat(levelRaw);
      if(!isNaN(n)&&n>=0&&n<=5)level=Math.round(n);
    }
    // team column: 청/c/blue → 청팀, 백/w/white → 홍팀
    let team='';
    const tr=teamRaw.trim();
    if(tr==='청'||tr==='청팀') team='청팀';
    else if(tr==='백'||tr==='홍팀') team='홍팀';
    result.push({
      name,level:level!=null?level:1,gender:gender||'M',team,
      _valid:level!==null&&!!gender,_grade:_parsedGrade,_levelRaw:levelRaw,_genderRaw:genderRaw,
      gamesPlayed:0,lastRoundPlayed:0,
      womenDoublesPlayed:0,menDoublesPlayed:0,mixedDoublesPlayed:0,adjustmentPlayed:0,
      partnerCount:{},opponentCount:{}
    });
  });
  return result;
}

/* ═══ TEAM ASSIGNMENT ═══ */
function doTeamAssign(){
  alert('청/홍 팀 나누기는 팀전LIVE 메뉴에서 진행하세요.\n민턴LIVE는 개인 자동운영만 사용합니다.');
  location.href='team.html?v=1.10.439&from=daily';
  return;
  if(!_directPlayers.length){showErr('참가자를 먼저 추가해주세요.');return;}
  if(_directPlayers.length<4){showErr('팀 배정은 최소 4명이 필요합니다.');return;}
  _teamWanted=true; // 팀전 의도 확정
  const all=_directPlayers.map(p=>({
    name:p.name, level:p.level,
    gender:p.gender==='남'?'M':'F',
    grade:p.grade, team:'', isGuest:!!p.isGuest, ageGroup:p.ageGroup||'40대',
    partnerId: (getPartnerInfo(p.name)||{}).id||null,
    partnerName: getPartnerOf(p.name)||null
  }));

  // 단장/부단장 고정. 고정 선수가 파트너를 갖고 있으면 파트너도 같은 팀으로 묶는다.
  const blueFixedNames=new Set([captains.blue.leader, captains.blue.sub].filter(Boolean));
  const whiteFixedNames=new Set([captains.white.leader, captains.white.sub].filter(Boolean));
  for(const pair of _partners){
    const [a,b]=pair.members;
    const aBlue=blueFixedNames.has(a), bBlue=blueFixedNames.has(b);
    const aWhite=whiteFixedNames.has(a), bWhite=whiteFixedNames.has(b);
    if((aBlue&&bWhite)||(aWhite&&bBlue)){
      showErr(`고정 파트너 "${a}"·"${b}"가 청/홍팀 고정 선수로 갈라져 있습니다. 단장/부단장 지정 또는 파트너 지정을 먼저 조정해주세요.`);
      return;
    }
    if(aBlue||bBlue){blueFixedNames.add(a);blueFixedNames.add(b);}
    if(aWhite||bWhite){whiteFixedNames.add(a);whiteFixedNames.add(b);}
  }
  const fixedNames=new Set([...blueFixedNames,...whiteFixedNames]);

  // 파트너 쌍 추출 (두 명 모두 미고정인 경우만 쌍으로 처리)
  const processedNames = new Set([...fixedNames]);
  const partnerPairs = [];
  for(const pair of _partners){
    const [a,b] = pair.members;
    if(!processedNames.has(a) && !processedNames.has(b)){
      const pa = all.find(p=>p.name===a);
      const pb = all.find(p=>p.name===b);
      if(pa&&pb){ partnerPairs.push([pa,pb]); processedNames.add(a); processedNames.add(b); }
    }
  }

  // 고정 선수(단장·부단장)를 시드로 — 이들의 레벨·인원·여성수를 출발점으로 삼는다
  const blueFixed = all.filter(p=>blueFixedNames.has(p.name));
  const whiteFixed = all.filter(p=>whiteFixedNames.has(p.name));

  // 파트너 쌍 배정: 시드 레벨합을 고려해 낮은 팀부터 배정 (시드에 합산해 둠)
  const seedBlue=[...blueFixed], seedWhite=[...whiteFixed];
  const _s=t=>t.reduce((s,p)=>s+effLevel(p),0);
  // 파트너쌍은 레벨합 큰 쌍부터, 그때그때 합 낮은 팀에 배정 (그리디 균형)
  const sortedPairs=[...partnerPairs].sort((x,y)=>(effLevel(y[0])+effLevel(y[1]))-(effLevel(x[0])+effLevel(x[1])));
  for(const [pa,pb] of sortedPairs){
    if(_s(seedBlue)<=_s(seedWhite)) seedBlue.push(pa,pb);
    else seedWhite.push(pa,pb);
  }

  // 자유 선수를 시드 위에서 균형 배분
  const freePool = all.filter(p=>!processedNames.has(p.name));
  const {blue:newBlue, white:newWhite} = balanceTeams(freePool, seedBlue, seedWhite);

  const blue = [...seedBlue, ...newBlue];
  const white = [...seedWhite, ...newWhite];

  teamAssignment={blue,white};
  blue.forEach(p=>p.team='청팀');
  white.forEach(p=>p.team='홍팀');
  setOperationPreset('monthlyTeam');
  updateTeamModeBadge();
  renderTeamList();
  const btn=document.getElementById('teamAssignBtn');
  btn.classList.add('done','hidden');
  const rbtn=document.getElementById('teamReassignBtn');
  if(rbtn) rbtn.classList.remove('hidden');
  btn.innerHTML='🔀 청/홍팀 재배정 (클릭 시 새로 배정)';
}

function renderTeamList(){
  if(!teamAssignment)return;
  const {blue,white}=teamAssignment;
  const bSum=blue.reduce((s,p)=>s+effLevel(p),0);
  const wSum=white.reduce((s,p)=>s+effLevel(p),0);
  const bF=blue.filter(p=>p.gender==='F').length;
  const wF=white.filter(p=>p.gender==='F').length;
  const bM=blue.filter(p=>p.gender==='M').length;
  const wM=white.filter(p=>p.gender==='M').length;
  document.getElementById('blueInfo').textContent=`${blue.length}명 · 남${bM} 여${bF} · 실력합 ${Math.round(bSum*10)/10}`;
  document.getElementById('whiteInfo').textContent=`${white.length}명 · 남${wM} 여${wF} · 실력합 ${Math.round(wSum*10)/10}`;
  const bSumR=Math.round(bSum*10)/10;
  const wSumR=Math.round(wSum*10)/10;
  const diff=Math.round((bSum-wSum)*10)/10;
  const diffStr=diff>0?`+${diff}`:diff<0?`${diff}`:'균형';
  const diffColor=diff===0?'color:var(--green)':'color:var(--acc)';
  document.getElementById('blueDiff').innerHTML=`실력 차: <b style="${diffColor}">${diffStr}</b> (청 ${bSumR} : 백 ${wSumR})`;
  document.getElementById('whiteDiff').textContent='';
  const bn=teamNames.blue, wn=teamNames.white;

  // 정렬 함수: 단장→부단장→일반(실력순)
  const sortWithCaptain=(list, side)=>{
    const ldr=captains[side].leader, sub=captains[side].sub;
    return [...list].sort((a,b)=>{
      const ra=a.name===ldr?0:a.name===sub?1:2;
      const rb=b.name===ldr?0:b.name===sub?1:2;
      if(ra!==rb) return ra-rb;
      return b.level-a.level||a.name.localeCompare(b.name,'ko');
    });
  };

  const renderRow=(p, side, toTeam)=>{
    const isLeader=captains[side].leader===p.name;
    const isSub=captains[side].sub===p.name;
    const nameColor=side==='blue'?'var(--btc)':'var(--wtc)';
    // 직책 아이콘 클릭 → 단장/부단장/해제 순환
    const roleIcon=isLeader?'👑':isSub?'🥈':'·';
    const bothFull=captains[side].leader&&captains[side].sub;
    const roleTitle=isLeader?'클릭: 단장 해제'
      :isSub?'클릭: 부단장 해제'
      :!captains[side].leader?'클릭: 단장 지정'
      :!captains[side].sub?'클릭: 부단장 지정'
      :'직책 해제 후 지정 가능';
    const roleCls=`tlb-role${isLeader?' on leader':isSub?' on sub':''}${bothFull&&!isLeader&&!isSub?' locked':''}`;
    const roleClick=`cycleRole('${side}','${esc(p.name)}')`;
    const genderLabel=p.gender==='F'?'여':'남';
    const gradeLabel=p.grade||LV_LABEL[p.level]||'?';
    return `<div class="tlb-player${isLeader?' tlb-captain':isSub?' tlb-sub':''}">
      <span class="${roleCls}" onclick="${roleClick}" title="${roleTitle}">${roleIcon}</span>
      <div class="tlb-info">
        <span class="tlb-name" style="color:${nameColor}">${esc(p.name)}</span>
        ${p.isGuest?'<span class="guest-badge" style="flex-shrink:0;">G</span>':''}
        <span class="tlb-meta">${gradeLabel} · ${genderLabel}</span>
      </div>
      <button class="move-btn" onclick="movePlayer('${esc(p.name)}','${toTeam}')" title="${toTeam==='white'?wn:bn}으로 이동">⇄</button>
    </div>`;
  };

  document.getElementById('blueList').innerHTML=
    sortWithCaptain(blue,'blue').map(p=>renderRow(p,'blue','white')).join('');
  document.getElementById('whiteList').innerHTML=
    sortWithCaptain(white,'white').map(p=>renderRow(p,'white','blue')).join('');
  // 팀 모드가 꺼진 상태면 목록 표시 안 함
  const _isTeamOn = teamAssignment && _teamModeOverride!==false;
  document.getElementById('teamListWrap').classList.toggle('show', !!_isTeamOn);
}

function cycleRole(team, name){
  if(captains[team].leader===name){
    // 단장 → 해제
    captains[team].leader='';
  } else if(captains[team].sub===name){
    // 부단장 → 해제
    captains[team].sub='';
  } else {
    // 직책 없음: 단장 자리가 비어있으면 단장, 아니면 부단장 자리로
    if(!captains[team].leader){
      captains[team].leader=name;
    } else if(!captains[team].sub){
      captains[team].sub=name;
    }
    // 두 자리 모두 차있으면 무시 (해제 후 재지정 필요)
    // 다른 팀에 있던 직책 제거
    const other=team==='blue'?'white':'blue';
    if(captains[other].leader===name) captains[other].leader='';
    if(captains[other].sub===name) captains[other].sub='';
  }
  renderTeamList();
}

function setCaptain(team, role, name){
  // 이미 지정된 경우 해제
  if(captains[team][role]===name){
    captains[team][role]='';
  } else {
    // 다른 팀에 같은 이름이 있으면 제거
    ['blue','white'].forEach(t=>['leader','sub'].forEach(r=>{
      if(captains[t][r]===name) captains[t][r]='';
    }));
    // 같은 팀 다른 역할에 있으면 역할 스왑
    const otherRole=role==='leader'?'sub':'leader';
    if(captains[team][otherRole]===name) captains[team][otherRole]='';
    captains[team][role]=name;
  }
  renderTeamList();
}

function movePlayer(name,toTeam){
  if(!teamAssignment)return;
  const fi=teamAssignment.blue.findIndex(p=>p.name===name);
  const wi=teamAssignment.white.findIndex(p=>p.name===name);
  let player;
  if(toTeam==='white'&&fi>=0){
    player=teamAssignment.blue.splice(fi,1)[0];player.team='홍팀';teamAssignment.white.push(player);
    // 청팀 단장/부단장이었으면 해제
    if(captains.blue.leader===name) captains.blue.leader='';
    if(captains.blue.sub===name) captains.blue.sub='';
  } else if(toTeam==='blue'&&wi>=0){
    player=teamAssignment.white.splice(wi,1)[0];player.team='청팀';teamAssignment.blue.push(player);
    // 홍팀 단장/부단장이었으면 해제
    if(captains.white.leader===name) captains.white.leader='';
    if(captains.white.sub===name) captains.white.sub='';
  }
  renderTeamList();
}

let _teamModeOverride=null; // null=auto, true=강제켜짐, false=강제꺼짐
let _teamWanted=false; // 사용자가 팀전을 원하는지 (자동배정 버튼 노출 제어)
// 단장/부단장 지정 { blue:{leader:'',sub:''}, white:{leader:'',sub:''} }
let captains={blue:{leader:'',sub:''},white:{leader:'',sub:''}};

function stepVal(id, delta){
  const el=document.getElementById(id);
  if(!el) return;
  const min=parseInt(el.min)||0;
  const max=parseInt(el.max)||99;
  const cur=parseInt(el.value)||0;
  el.value=Math.max(min, Math.min(max, cur+delta));
}

function toggleTeamMode(){
  // 팀전 ON/OFF 토글 (배정 전에도 동작)
  if(_teamModeOverride===false || (!teamAssignment && _teamWanted!==true)){
    // 끄기 상태 → 켜기
    _teamWanted=true;
    _teamModeOverride=null;
    setOperationPreset('monthlyTeam');
  } else {
    // 켜기 상태 → 끄기
    _teamWanted=false;
    _teamModeOverride=false;
    setOperationPreset('daily');
  }
  updateTeamModeBadge();
}

function updateTeamModeBadge(){
  const b=document.getElementById('teamModeBadge');
  const wrap=document.getElementById('teamListWrap');
  const reBtn=document.getElementById('teamReassignBtn');
  const assignBtn=document.getElementById('teamAssignBtn');
  _teamWanted=false;
  _teamModeOverride=false;
  teamAssignment=null;
  if(b){
    b.className='tmb hidden';
    b.textContent='팀 모드는 팀전LIVE 메뉴에서 사용합니다';
  }
  if(assignBtn) assignBtn.classList.add('hidden');
  if(wrap) wrap.classList.remove('show');
  if(reBtn) reBtn.classList.add('hidden');
}

function _forcePersonalOnlyMode(){
  _teamWanted=false;
  _teamModeOverride=false;
  teamAssignment=null;
  if(currentSettings&&typeof currentSettings==='object'){
    currentSettings.teamMode=false;
    currentSettings.operationPreset='daily';
  }
  if(Array.isArray(currentMatches)){
    currentMatches.forEach(m=>{ if(m)m.teamMode=false; });
  }
  updateTeamModeBadge();
}

/* ═══ BALANCE TEAMS ═══ */
function balanceTeams(all, seedBlue=[], seedWhite=[]){
  // seedBlue/seedWhite: 이미 팀이 고정된 선수들(단장·부단장·파트너쌍 등). 이들의 레벨·인원·여성수를 출발점으로 삼아
  // 나머지(all)를 배분하고, 전체(시드 포함)가 균형을 이루도록 최적화한다.
  const sum=t=>t.reduce((s,p)=>s+effLevel(p),0);
  const femCount=t=>t.filter(p=>p.gender==='F'||p.gender==='여').length;
  const isF=p=>p.gender==='F'||p.gender==='여';

  // 균형 비용: 인원차·여성수차·레벨합차를 가중 합산 (작을수록 좋음)
  // 인원/여성 1명 차이는 강하게, 레벨합 차이는 0.1점 단위까지 반영
  const W_CNT=100, W_FEM=100, W_LV=1;
  const cost=(B,Wt)=>{
    const fullB=[...seedBlue,...B], fullW=[...seedWhite,...Wt];
    const cntD=Math.abs(fullB.length-fullW.length);
    const femD=Math.abs(femCount(fullB)-femCount(fullW));
    const lvD=Math.abs(sum(fullB)-sum(fullW));
    return cntD*W_CNT + femD*W_FEM + lvD*W_LV;
  };

  // 한 번의 그리디 배분 (시드 상태를 반영해 부족한 쪽에 채움)
  const buildOnce=(pool)=>{
    const females=pool.filter(isF).sort((a,b)=>effLevel(b)-effLevel(a));
    const males=pool.filter(p=>!isF(p)).sort((a,b)=>effLevel(b)-effLevel(a));
    let B=[],Wt=[];
    const put=(p)=>{
      // 이 선수를 청/홍 중 어디에 넣어야 비용이 작은가
      const cB=cost([...B,p],Wt), cW=cost(B,[...Wt,p]);
      if(cB<cW) B.push(p);
      else if(cW<cB) Wt.push(p);
      else (Math.random()<0.5?B:Wt).push(p); // 동점이면 랜덤
    };
    // 여성 먼저(여성수 균형이 더 깨지기 쉬움), 그다음 남성. 둘 다 레벨 높은 순.
    females.forEach(put);
    males.forEach(put);
    return {B,Wt};
  };

  // 국소 최적화: 동성 1:1 스왑 + 1명 이동(인원 불균형 해소)으로 비용 최소화
  const optimize=(B,Wt)=>{
    let improved=true, guard=0;
    while(improved && guard++<200){
      improved=false;
      // (1) 동성 스왑
      for(let bi=0;bi<B.length;bi++){
        for(let wi=0;wi<Wt.length;wi++){
          if(isF(B[bi])!==isF(Wt[wi]))continue;
          const nB=B.slice(), nW=Wt.slice();
          [nB[bi],nW[wi]]=[nW[wi],nB[bi]];
          if(cost(nB,nW)<cost(B,Wt)-1e-9){ B=nB; Wt=nW; improved=true; }
        }
      }
      // (2) 한 명 이동: 인원 많은 쪽에서 적은 쪽으로 옮기면 더 균형 잡힐 때
      const fullB=seedBlue.length+B.length, fullW=seedWhite.length+Wt.length;
      if(fullB>fullW){
        for(let bi=0;bi<B.length;bi++){
          const nB=B.slice(); const moved=nB.splice(bi,1)[0];
          const nW=[...Wt,moved];
          if(cost(nB,nW)<cost(B,Wt)-1e-9){ B=nB; Wt=nW; improved=true; break; }
        }
      } else if(fullW>fullB){
        for(let wi=0;wi<Wt.length;wi++){
          const nW=Wt.slice(); const moved=nW.splice(wi,1)[0];
          const nB=[...B,moved];
          if(cost(nB,nW)<cost(B,Wt)-1e-9){ B=nB; Wt=nW; improved=true; break; }
        }
      }
    }
    return {B,Wt};
  };

  // 여러 번 시뮬레이션해서 가장 균형 잡힌 결과 채택
  let best=null, bestCost=Infinity;
  const TRIES=24;
  for(let t=0;t<TRIES;t++){
    const pool=fisherYates([...all]);
    let {B,Wt}=buildOnce(pool);
    ({B,Wt}=optimize(B,Wt));
    const c=cost(B,Wt);
    if(c<bestCost){ bestCost=c; best={blue:B,white:Wt}; }
    if(bestCost===0) break; // 완벽 균형이면 조기 종료
  }
  return best || {blue:[],white:[]};
}

/* ═══ GENERATE ═══ */
function generate(){
  hideErr();hideWarn();
  _forcePersonalOnlyMode();
  if(!_directPlayers.length){showErr('참가자를 먼저 추가해주세요.');return;}
  // 이미 대진표가 있으면 덮어쓰기 경고 (특히 점수 입력된 경우)
  if(currentMatches.length){
    const enteredScores=Object.keys(winOverride).filter(k=>winOverride[k]).length;
    const msg=enteredScores>0
      ? `이미 대진표가 있고 ${enteredScores}경기의 승패가 입력되어 있습니다.\n\n새로 생성하면 현재 대진표와 입력된 결과가 모두 사라집니다.\n계속할까요?`
      : `이미 생성된 대진표가 있습니다.\n새로 생성하면 현재 대진표가 사라집니다.\n계속할까요?`;
    if(!confirm(msg)) return;
  }
  let participants=_directPlayers.map(p=>({
    name:p.name,level:p.level,gender:p.gender==='남'?'M':'F',
    team:p.team||'',isGuest:!!p.isGuest,_valid:true,
    grade:p.grade,  // 입력한 실제 급수 (남: B→level5, 여: B→level4 이므로 grade로 표시해야 정확)
    _grade:p.grade, // 하위 호환 유지
    ageGroup:p.ageGroup||'40대',
    _levelRaw:String(p.level),_genderRaw:p.gender,
    partnerName: getPartnerOf(p.name)||null
  }));
  if(!participants.length){showErr('유효한 참가자가 없습니다.');return;}

  participants.forEach(p=>p.team='');
  participants.forEach(p=>{
    p.gamesPlayed=0;p.lastRoundPlayed=0;
    p.womenDoublesPlayed=0;p.menDoublesPlayed=0;p.mixedDoublesPlayed=0;p.adjustmentPlayed=0;
    p.partnerCount={};p.opponentCount={};
  });

  const courts=parseInt(document.getElementById('courts').value)||4;
  const gpp=parseInt(document.getElementById('gamesPerPlayer').value)||4;
  const xDbl=Math.min(parseInt(document.getElementById('mixedDbl').value)||0,gpp);

  if(participants.length<4){showErr('최소 4명 필요합니다.');return;}
  if(courts<1){showErr('코트 수는 1 이상이어야 합니다.');return;}
  if(gpp<1){showErr('인당 게임 수는 1 이상이어야 합니다.');return;}
  if(xDbl>gpp){showErr(`혼복 인당 횟수(${xDbl})는 인당 게임 수(${gpp})를 초과할 수 없습니다.`);return;}
  const total=participants.length*gpp;
  // 4의 배수 강제 없음 — 나머지는 fillMissingGames에서 최선 처리
  const _nonDiv4=(total%4!==0);

  const settings={
    courts,gamesPerPlayer:gpp,
    mixedDoublesPerPerson:xDbl,
    teamMode:false,
    operationPreset:'daily'
  };
  setOperationPreset(settings.operationPreset);

  _captureUndoSnapshot('대진표 생성 전');
  document.getElementById('loadingOverlay').classList.add('on');
  setTimeout(()=>{
    try{
      // 4명 단위 경기이므로 목표 슬롯을 모두 담는 최소 경기 수를 사용한다.
      // 나누어떨어지지 않는 경우에만 1~3명분의 최소 초과가 발생한다.
      const totalMatches=Math.ceil(total/4);
      const numF=participants.filter(p=>p.gender==='F').length;
      const numM=participants.filter(p=>p.gender==='M').length;
      // 혼복 타겟: 입력값 기반
      if(xDbl>0){
        // 혼복 횟수 지정 시: 혼복N회 + 나머지 남복/여복 비율로 배정
        settings.targetMixedDoubles=Math.floor(participants.length*xDbl/4);
        const gppRem=gpp-xDbl;
        settings.targetWomenDoubles=numF>=4?Math.floor(numF*gppRem/4):0;
        settings.targetMenDoubles=numM>=4?Math.floor(numM*gppRem/4):0;
      } else {
        // 혼복 횟수=0 → 남복/여복 우선.
        // 동성복식만으로 출전 균형을 맞추기 어려울 때는 any 폴백으로 혼복을 허용한다.
        settings.targetMixedDoubles=0;
        settings.targetWomenDoubles=numF>=4?Math.floor(numF*gpp/4):0;
        settings.targetMenDoubles=numM>=4?Math.floor(numM*gpp/4):0;
      }
      // ── 여러 번 생성해 가장 품질 좋은 대진 자동 선택 (best-of-N) ──
      // generateMatches가 participants를 직접 변경하므로 매 시도마다 깨끗한 복사본 사용
      const _basePlayers=participants.map(p=>({...p, partnerCount:{}, opponentCount:{}}));
      const _hasFixedPartner=participants.some(p=>p.partnerName);
      const _TRIES=_autoSearchTries(participants.length,false,_hasFixedPartner);
      let matches=null, bestKey=null, bestPlayers=null;
      for(let _t=0;_t<_TRIES;_t++){
        const _try=_basePlayers.map(p=>({...p, gamesPlayed:0, lastRoundPlayed:0,
          womenDoublesPlayed:0, menDoublesPlayed:0, mixedDoublesPlayed:0, adjustmentPlayed:0,
          partnerCount:{}, opponentCount:{}}));
        const _m=generateMatches(_try,settings,totalMatches);
        fillMissingGames(_try,settings,_m,totalMatches);
        _repairParticipation(_m,_try,settings,[]);
        compactSchedule(_m,settings);
        let _sc=_bracketQualityScore(_m,_try,settings);
        // 혼복 0은 금지가 아니라 동성복식 우선이다.
        // 기본 품질이 비슷한 후보끼리는 혼복이 적은 대진을 선택한다.
        if(xDbl===0) _sc+=_m.filter(mx=>mx.type==='혼복').length*6;
        // 팀전: 파트너 중복 추가 패널티
        if(settings.teamMode){
          const _pc={};
          _m.forEach(mx=>[[mx.team1A,mx.team1B],[mx.team2C,mx.team2D]].forEach(pr=>{
            const k=[pr[0].name,pr[1].name].sort().join('|');_pc[k]=(_pc[k]||0)+1;
          }));
          _sc+=Object.values(_pc).filter(c=>c>=2).reduce((s,c)=>s+(c-1)*25,0);
        }
        const _key=_candidateQualityKey(_m,_try,settings,_sc);
        if(_isBetterQualityKey(_key,bestKey)){bestKey=_key;matches=_m;bestPlayers=_try;}
      }
      // 최고 후보 채택
      participants=bestPlayers;
      _optimizeTeamPairRepeats(matches,participants,settings);
      matches.sort((a,b)=>a.round-b.round||a.court-b.court);
      matches.forEach((m,i)=>m.matchNumber=i+1);
      currentMatches=matches;currentParticipants=participants;currentSettings=settings;
      _lockedBeforeRound=null; // 새 대진 생성 시 잠금 해제
      // 이전 점수·승패 완전 초기화
      Object.keys(winOverride).forEach(k=>delete winOverride[k]);
      _resetScoreboard();
      if(settings.teamMode)_fastResetState();
      else _fastStartFresh();
      renderResults(matches,participants,settings);
      show('resultArea');
      // 생성 후 결과 영역으로 부드럽게 이동 (특히 모바일)
      setTimeout(()=>{
        const ra=document.getElementById('qualDash')||document.getElementById('resultSummaryCard')||document.getElementById('resultArea');
        if(ra) ra.scrollIntoView({behavior:'smooth',block:'start'});
      },150);
      // ── 경고 합산 ──
      const _cw=checkEmptyCourts(matches,settings,participants);
      let _warnParts=[];
      if(_nonDiv4){
        const rem=total%4;
        const extra=(4-rem)%4;
        _warnParts.push(`ℹ 참가자(${participants.length}) × 게임(${gpp}) = ${total}명분 → 4명 단위 경기라 ${extra}명은 목표보다 1게임 더 뛸 수 있습니다.\n   이 초과는 품질점검에서 불가피한 초과로 구분합니다.`);
      }
      if(participants.length<=20){
        _warnParts.push('ℹ 20명 이하 소규모 대진은 선택지가 좁아 같은 파트너·상대 반복이 조금 늘 수 있습니다. 품질점검의 "실전 특이사항"을 먼저 확인하세요.');
      }
      if(xDbl===0&&(((numF*gpp)%4)!==0||((numM*gpp)%4)!==0)){
        _warnParts.push('ℹ 혼복 0은 남복·여복 우선이라는 뜻입니다. 성별별 출전 슬롯이 4명 단위로 딱 맞지 않으면 일부 혼복, 반복, 1게임 초과가 생길 수 있습니다.');
      }
      const _adjCnt=matches.filter(m=>m.type==='보정').length;
      if(_adjCnt){
        _warnParts.push(`ℹ 팀 성비 때문에 보정경기 ${_adjCnt}개를 배정했습니다.\n   이는 한 팀 여1/남1 vs 상대 팀 여0/남2 또는 여2/남0처럼 목표 게임 수 공정성을 맞추기 위한 예외 조합입니다.`);
      }
      if(_cw.length){
        const _mc=Math.floor(participants.length/4);
        let _msg='⚠ 일부 라운드에 빈 코트가 있습니다 (최대 압축 후 기준)\n';
        _cw.forEach(w=>{
          _msg+='• 라운드 '+w.round+': 코트 '+w.emptyCourts.join(', ')+' 비어 있음\n';
        });
        _msg+='💡 코트 수를 '+_mc+'개 이하로 줄이거나 참가자를 추가해보세요';
        _warnParts.push(_msg);
      }
      if(_warnParts.length){showWarn(_warnParts.join('\n\n'));}
      else{hideWarn();}
      scheduleSave();
      // 모바일/데스크탑 모두 결과 영역으로 스크롤
      setTimeout(()=>{
        const el=document.getElementById('qualDash')||document.getElementById('resultSummaryCard')||document.getElementById('resultArea');
        if(el){
          const top=el.getBoundingClientRect().top+window.scrollY-8;
          window.scrollTo({top,behavior:'smooth'});
        }
      },100);
    }catch(e){showErr('생성 오류: '+e.message);console.error(e);}
    finally{document.getElementById('loadingOverlay').classList.remove('on');}
  },50);
}

/* ═══ ALGORITHM ═══ */
function generateMatches(participants,settings,totalMatches){
  const matches=[];let womenCount=0,menCount=0,mixedCount=0;
  shuffleArray(participants);
  let currentRound=1,consecutiveEmpty=0;

  // 목표 간격 자동 계산: 전체 예상 라운드 ÷ 인당 게임수
  // 예: 21명, 코트3, 인당4게임 → 예상라운드 = 4*21/4/3 = 7라운드, 목표간격 = 7/4 ≈ 1.75 → 1
  const estRounds = Math.max(1, Math.ceil(totalMatches / settings.courts));
  const targetGap = Math.max(1, Math.floor(estRounds / settings.gamesPerPlayer));
  // 파트너 차단 라운드 수 = 목표간격 - 1 (간격만큼 띄우되 너무 빡빡하지 않게)
  const partnerBlockRounds = Math.max(1, targetGap);
  _partnerGapThreshold = partnerBlockRounds;

  while(matches.length<totalMatches){
    _currentRound=currentRound;
    const used=new Set();let added=0;
    // 직전 1라운드 참가자 (일반 선수 휴식)
    const justPlayed=new Set(
      matches.filter(m=>m.round===currentRound-1)
        .flatMap(m=>[m.team1A.name,m.team1B.name,m.team2C.name,m.team2D.name])
    );
    // 파트너 쌍 차단: 목표 간격만큼의 최근 라운드 (자동 계산)
    const partnerRecentRounds=new Set(
      matches.filter(m=>m.round>=currentRound-partnerBlockRounds&&m.round<currentRound)
        .flatMap(m=>[m.team1A.name,m.team1B.name,m.team2C.name,m.team2D.name])
    );
    for(let pass=1;pass<=2;pass++){
      for(let court=1;court<=settings.courts;court++){
        if(matches.length>=totalMatches)break;
        if(matches.some(m=>m.round===currentRound&&m.court===court))continue;
        const passExtra=pass===1?0:1;

        // avail: 게임 가능 선수 (선수별 목표 _goal 우선, 신규선수는 초과 금지)
        let avail=participants.filter(p=>{
          const base=(p._goal!=null?p._goal:settings.gamesPerPlayer);
          // 혼복 0(동성복식 우선)에서는 2차 패스도 목표 초과를 막는다.
          // 특정 성별 선수를 먼저 초과 배정하면 반대 성별 미달 보완 경기가 늘어난다.
          // 재배정 선수(_goal 보유)는 완료 경기까지 합친 개인 목표를 넘기지 않는다.
          // 먼저 초과 배정하면 다른 선수의 미달을 채우는 보완게임이 연쇄적으로 생긴다.
          const goal=(p.isNewJoiner||p._goal!=null||settings.mixedDoublesPerPerson===0)?base:base+passExtra;
          return p.gamesPlayed<goal && !used.has(p.name);
        });
        // 신규 투입 선수 1라운드 제외 (_skipNewFirstRound가 true일 때만 — 라운드 직접선택 시엔 끔)
        if(_skipNewFirstRound && currentRound===1 && participants.some(p=>p.isNewJoiner)){
          const availNoNew=avail.filter(p=>!p.isNewJoiner);
          if(availNoNew.length>=4) avail=availNoNew;
        }

        // 차단 집합: 일반 선수는 justPlayed(1라운드), 파트너 쌍은 2라운드 차단
        const blockedThisRound=new Set([...justPlayed]);
        // 파트너 쌍: 최근 2라운드 내 뛰었으면 쌍 전체 차단 (pass 무관)
        const partnerBlocked=new Set();
        for(const name of partnerRecentRounds){
          const p=participants.find(x=>x.name===name);
          if(p?.partnerName){
            partnerBlocked.add(name);
            partnerBlocked.add(p.partnerName);
            blockedThisRound.add(name);
            blockedThisRound.add(p.partnerName);
          }
        }

        if(pass===1){
          const availNoRest=avail.filter(p=>!blockedThisRound.has(p.name));
          if(availNoRest.length>=4) avail=availNoRest;
        } else {
          // pass2: 일반 선수 휴식은 풀되, 파트너 쌍 2라운드 차단은 유지
          const availNoPartnerBlock=avail.filter(p=>!partnerBlocked.has(p.name));
          if(availNoPartnerBlock.length>=4) avail=availNoPartnerBlock;
        }

        // 파트너가 avail에 없으면 강제 추가
        // partnerBlocked에 있으면 절대 추가 안 함 (pass 무관)
        const extraPartners=[];
        for(const p of [...avail]){
          if(!p.partnerName) continue;
          const partner=participants.find(x=>x.name===p.partnerName);
          if(!partner||used.has(partner.name)) continue;
          if(avail.includes(partner)) continue;
          if(partnerBlocked.has(partner.name)||partnerBlocked.has(p.name)){
            avail=avail.filter(x=>x.name!==p.name);
            continue;
          }
          extraPartners.push(partner);
        }
        avail=[...avail,...extraPartners];
        if(avail.length<4)continue;

        // 게임 수 적은 선수 우선 배정: gamesPlayed 오름차순 정렬 (동률은 랜덤 유지)
        // 중간 투입 신규선수 및 출전 적은 선수가 먼저 배정되도록 보장
        avail.sort((a,b)=>a.gamesPlayed-b.gamesPlayed);

        // 신규선수 우선 코트: avail에 신규선수(미출전 or 게임수 적음)가 있으면
        // 이 코트를 'any' 먼저 시도 → 신규선수 포함 조합 우선 생성
        // 혼복 비율은 나머지 코트에서 보전
        const hasNewInAvail=avail.some(p=>p.isNewJoiner&&p.gamesPlayed<(p._goal!=null?p._goal:settings.gamesPerPlayer));

        const remX=settings.targetMixedDoubles-mixedCount;
        const remW=settings.targetWomenDoubles-womenCount;
        const remM=settings.targetMenDoubles-menCount;

        // 파트너 혼복 쌍 존재 여부 확인
        const hasPartnerMixed=avail.some(p=>{
          if(!p.partnerName) return false;
          const partner=avail.find(x=>x.name===p.partnerName);
          if(!partner) return false;
          return (p.gender==='M'&&partner.gender==='F')||(p.gender==='F'&&partner.gender==='M');
        });

        const to=[];
        // 신규선수가 avail에 있으면 'any'를 먼저 배치 → 신규선수 포함 조합 우선 생성
        if(hasNewInAvail){ to.push('any'); }
        const needsGenderAdjustment=_shouldTryGenderAdjustment(participants,settings);
        if(needsGenderAdjustment) to.push('adjust');
        if(hasPartnerMixed) to.push('mixed');
        if(remX>0&&!hasPartnerMixed){
          to.push('mixed');
          if(remW>0)to.push('women');
          if(remM>0)to.push('men');
        } else {
          const wR=(remW>0&&settings.targetWomenDoubles>0)?womenCount/settings.targetWomenDoubles:Infinity;
          const mR=(remM>0&&settings.targetMenDoubles>0)?menCount/settings.targetMenDoubles:Infinity;
          if(wR!==Infinity||mR!==Infinity){
            if(wR<mR){to.push('women');if(remM>0)to.push('men');}
            else if(mR<wR){to.push('men');if(remW>0)to.push('women');}
            else{if(settings.targetMenDoubles>=settings.targetWomenDoubles){if(remM>0)to.push('men');if(remW>0)to.push('women');}else{if(remW>0)to.push('women');if(remM>0)to.push('men');}}
          }
        }
        if(needsGenderAdjustment&&!to.includes('adjust')) to.push('adjust');
        to.push('any');

        let match=null;
        const hasRepeat4=(m)=>{if(!m)return false;const t1=[m.team1A,m.team1B],t2=[m.team2C,m.team2D];for(const a of t1)for(const b of t2){if((a.opponentCount[b.name]||0)>=3)return true;}return false;};
        // 1단계: 파트너 쌍 우선 배정 — 실력차 작은 조합부터
        for(const pL of[1,2]){match=tryCreateMatchWithPartners(avail,settings,'any',pL);if(match)break;}
        if(hasRepeat4(match)) match=null; // 4회째 만남이면 파트너매치도 거부
        // 2단계: 일반 배정 (실력차 엄격, 4회째 만남 회피)
        if(!match){
          let fb=null;
          for(const maxLD of[1,2,4]){
            for(const t of to){
              const cand=tryCreateMatch(avail,settings,t,maxLD);
              if(!cand) continue;
              if(!hasRepeat4(cand)){ match=cand; break; }
              if(!fb) fb=cand;
            }
            if(match)break;
          }
          // 4회 회피 실패 시: 혼복 등 다른 종목 + 실력차 무제한으로 4회아닌 매치 탐색
          if(!match){
            for(const t of['mixed','women','men','any']){
              const cand=tryCreateMatch(avail,settings,t,99);
              if(cand && !hasRepeat4(cand)){ match=cand; break; }
            }
          }
          if(!match && fb && !hasRepeat4(fb)) match=fb;
        }
        // 3단계: 종목 완화. 단, 사용자가 지정한 P 파트너는 끝까지 같은 팀으로 유지한다.
        if(!match){
          let fb=null;
          for(const mL of[1,2,4]){
            const four=selectFourFreeMode(avail,'any',mL);
            if(four){
              let cand=formTeams(four,settings.teamMode,'any',mL);
              if(!cand&&settings.teamMode)cand=formTeams(four,settings.teamMode,'adjust',mL);
              if(!cand){const _mf3=four.filter(p=>p.gender==='F').length;const _ft3=_mf3===4?'women':_mf3===0?'men':'any';cand=formTeams(four,settings.teamMode,_ft3,mL);}
              if(cand && !hasRepeat4(cand)){ match=cand; break; }
              if(cand && !fb) fb=cand;
            }
          }
          if(!match && fb && !hasRepeat4(fb)) match=fb;
        }
        if(!match)continue;
        if(match.type==='여복')womenCount++;else if(match.type==='남복')menCount++;else if(match.type==='혼복')mixedCount++;
        match.matchNumber=matches.length+1;match.round=currentRound;match.court=court;
        [match.team1A,match.team1B,match.team2C,match.team2D].forEach(p=>used.add(p.name));
        updatePlayerRecords(match);matches.push(match);added++;
      }
      const filledCourts=new Set(matches.filter(m=>m.round===currentRound).map(m=>m.court));
      let allFull=true;
      for(let c=1;c<=settings.courts;c++){if(!filledCourts.has(c)){allFull=false;break;}}
      if(allFull||matches.length>=totalMatches)break;
    }
    currentRound++;
    if(added===0){consecutiveEmpty++;if(consecutiveEmpty>=3)break;}else consecutiveEmpty=0;
  }
  return matches;
}

function fillMissingGames(participants,settings,matches,maxMatches=Infinity){
  const fillerRepeat4=(m)=>{if(!m)return false;const t1=[m.team1A,m.team1B],t2=[m.team2C,m.team2D];for(const a of t1)for(const b of t2){if((a.opponentCount[b.name]||0)>=3)return true;}return false;};
  const target=settings.gamesPerPlayer;
  const goal=(p)=>(p._goal!=null?p._goal:target); // 선수별 목표 게임수
  // 보완 단계 상한: 신규선수는 목표 초과 금지(+0), 기존은 +extra 허용
  const cap=(p,extra)=>goal(p)+(p.isNewJoiner?0:extra);
  const courts=settings.courts;

  // ── PHASE 1: 기존 라운드의 빈 코트 채우기 ──
  const existingRounds=[...new Set(matches.map(m=>m.round))].sort((a,b)=>a-b);
  for(const r of existingRounds){
    _currentRound=r;
    for(let fpass=1;fpass<=2;fpass++){
      const usedCourts=new Set(matches.filter(m=>m.round===r).map(m=>m.court));
      // 이 라운드에 이미 배정된 선수 (보완 포함)
      const usedPlayers=new Set(
        matches.filter(m=>m.round===r)
          .flatMap(m=>[m.team1A.name,m.team1B.name,m.team2C.name,m.team2D.name])
      );
      for(let court=1;court<=courts;court++){
        if(matches.length>=maxMatches)break;
        if(usedCourts.has(court))continue;
        const maxG=fpass===1?target:target+1;
        const unmet=participants.filter(p=>p.gamesPlayed<goal(p)&&!usedPlayers.has(p.name));
        // 목표 미달자가 없으면 빈 코트를 굳이 채우지 않음 (불필요한 보완게임 방지)
        if(!unmet.length)continue;
        const pool=participants.filter(p=>p.gamesPlayed<cap(p,fpass===1?0:1)&&!usedPlayers.has(p.name));
        if(pool.length<4)continue;
        const four=selectFillerFour(pool,unmet,target,settings);
        if(!four)continue;
        let match=formTeams(four,settings.teamMode,'any',99)||formTeams(four,settings.teamMode,'adjust',99);
        // formTeams null(혼복 조건 불충족) → 실제 성비로 재시도
        if(!match){
          const _mf=four.filter(p=>p.gender==='F').length;
          const _fallType=_mf===4?'women':_mf===0?'men':'any';
          match=formTeams(four,settings.teamMode,_fallType,99)||formTeams(four,settings.teamMode,'adjust',99);
        }
        if(!match)continue;
        if(fillerRepeat4(match)){
          const t1=[match.team1A,match.team1B],t2=[match.team2C,match.team2D];
          let blk=null;
          for(const a of t1){for(const b of t2){if((a.opponentCount[b.name]||0)>=3){blk=a.name;break;}}if(blk)break;}
          const pool2=pool.filter(p=>p.name!==blk);
          if(pool2.length>=4){
            const f2=selectFillerFour(pool2,unmet,target,settings);
            if(f2){const m2=formTeams(f2,settings.teamMode,'any',99)||formTeams(f2,settings.teamMode,'adjust',99);if(m2&&!fillerRepeat4(m2))match=m2;}
          }
        }
        match.matchNumber=matches.length+1;match.round=r;match.court=court;
        match.isFiller=!Number.isFinite(maxMatches);
        [match.team1A,match.team1B,match.team2C,match.team2D].forEach(p=>usedPlayers.add(p.name));
        usedCourts.add(court);
        updatePlayerRecords(match);matches.push(match);
      }
    }
  }

  // ── PHASE 2: 여전히 미달인 선수를 위한 새 라운드 추가 ──
  // 핵심 개선: 한 라운드에 여러 코트를 최대한 채워
  // 동일 선수가 연속 라운드에 배정되는 것을 최소화
  const lastRound=matches.length>0?Math.max(...matches.map(m=>m.round)):0;
  let currentRound=lastRound+1;
  let safety=50;

  while(safety-->0){
    if(matches.length>=maxMatches)break;
    const unmet=participants.filter(p=>p.gamesPlayed<goal(p));
    if(!unmet.length)break;

    _currentRound=currentRound;
    const used=new Set();
    let added=0;

    // 이 라운드에 배정 가능한 선수: 직전 라운드(currentRound-1)에 뛴 선수는
    // 가급적 제외하되, 어쩔 수 없으면 포함
    const justPlayed=new Set(
      matches.filter(m=>m.round===currentRound-1)
        .flatMap(m=>[m.team1A.name,m.team1B.name,m.team2C.name,m.team2D.name])
    );

    for(let court=1;court<=courts;court++){
      if(matches.length>=maxMatches)break;
      const cu=participants.filter(p=>p.gamesPlayed<goal(p)&&!used.has(p.name));
      if(!cu.length)break;

      // 1차: 직전 라운드에 쉰 미달 선수만으로 시도
      const cuRested=cu.filter(p=>!justPlayed.has(p.name));
      const poolRested=participants.filter(p=>
        p.gamesPlayed<cap(p,1)&&!used.has(p.name)&&!justPlayed.has(p.name)
      );

      let four=null;
      if(cuRested.length>=1&&poolRested.length>=4){
        four=selectFillerFour(poolRested,cuRested,target,settings);
        if(four){let m=formTeams(four,settings.teamMode,'any',99)||formTeams(four,settings.teamMode,'adjust',99);if(!m)four=null;}
      }

      // 2차: 직전 라운드 참가자도 포함해 재시도 (불가피한 경우)
      if(!four){
        const pool=participants.filter(p=>p.gamesPlayed<cap(p,1)&&!used.has(p.name));
        if(pool.length<4)break;
        four=selectFillerFour(pool,cu,target,settings);
        if(four){let m=formTeams(four,settings.teamMode,'any',99)||formTeams(four,settings.teamMode,'adjust',99);if(!m)four=null;}
      }

      if(!four)continue;

      let match=formTeams(four,settings.teamMode,'any',99)||formTeams(four,settings.teamMode,'adjust',99);
      if(!match){
        const _mf2=four.filter(p=>p.gender==='F').length;
        const _ft2=_mf2===4?'women':_mf2===0?'men':'any';
        match=formTeams(four,settings.teamMode,_ft2,99);
      }
      if(!match)continue;
      if(fillerRepeat4(match)){
        const t1=[match.team1A,match.team1B],t2=[match.team2C,match.team2D];
        let blk=null;
        for(const a of t1){for(const b of t2){if((a.opponentCount[b.name]||0)>=3){blk=a.name;break;}}if(blk)break;}
        const pool3=participants.filter(p=>p.gamesPlayed<cap(p,1)&&!used.has(p.name)&&p.name!==blk);
        if(pool3.length>=4){
          const f3=selectFillerFour(pool3,pool3,target,settings);
          if(f3){const m3=formTeams(f3,settings.teamMode,'any',99)||formTeams(f3,settings.teamMode,'adjust',99);if(m3&&!fillerRepeat4(m3)){Object.assign(match,m3);}}
        }
      }

      match.matchNumber=matches.length+1;
      match.round=currentRound;
      match.court=court;
      match.isFiller=!Number.isFinite(maxMatches);
      [match.team1A,match.team1B,match.team2C,match.team2D].forEach(p=>{
        used.add(p.name);
        justPlayed.add(p.name); // 이 라운드 배정자도 직전으로 추가
      });
      updatePlayerRecords(match);
      matches.push(match);
      added++;
    }

    currentRound++;
    if(!added)break;
  }

  // ── PHASE 3: 강제 출전균형 보완 ──
  // 미달 선수를 반드시 포함하는 4인조를 직접 구성해 보완게임 생성
  // cap/성별 제약 완화, 팀 구분도 최후 수단으로 무시
  const _forceRound = (matches.length>0?Math.max(...matches.map(m=>m.round)):0)+1;
  let _forceSafety = 40;
  while(_forceSafety-- > 0) {
    if(matches.length>=maxMatches)break;
    const _unmet = participants.filter(p => p.gamesPlayed < (p._goal!=null?p._goal:target));
    if(!_unmet.length) break;

    const _used = new Set();
    let _added = 0;
    _currentRound = _forceRound + (40-_forceSafety-1);

    for(let court=1; court<=courts; court++) {
      if(matches.length>=maxMatches)break;
      const _cu = _unmet.filter(p => !_used.has(p.name));
      if(!_cu.length) break;

      // 미달 선수를 anchor로 해서 4인조 직접 구성
      const _anchor = _cu[0];
      // cap+3까지 완화한 pool (반드시 채우기 위해)
      const _pool = participants.filter(p =>
        p.gamesPlayed < (p._goal!=null?p._goal:target)+(p.isNewJoiner?0:3) && !_used.has(p.name)
      );
      if(_pool.length < 4) break;

      // 팀전: anchor 성별 기준 4인조 직접 구성
      // 혼복: anchor팀 남1+여1 vs 상대팀 남1+여1
      // 남복: anchor팀 남2 vs 상대팀 남2 (anchor가 남성이고 여성 파트너 없을 때)
      // 여복: anchor팀 여2 vs 상대팀 여2
      let _four = null;
      if(settings.teamMode) {
        const _anchorTeam = _anchor.team;
        const _otherTeam = _anchorTeam==='청팀'?'홍팀':'청팀';
        const _sameTeam = _pool.filter(p=>p.team===_anchorTeam&&p.name!==_anchor.name);
        const _otherTeamP = _pool.filter(p=>p.team===_otherTeam);

        // 시도 1: 혼복 (anchor 포함, 같은팀 반대성별 + 상대팀 남1여1)
        const _sameOpp = _sameTeam.filter(p=>p.gender!==_anchor.gender);
        const _otherM = _otherTeamP.filter(p=>p.gender==='M');
        const _otherF = _otherTeamP.filter(p=>p.gender==='F');
        if(_sameOpp.length&&_otherM.length&&_otherF.length){
          const _p2=_sameOpp[0];
          const _p3=_anchor.gender==='M'?_otherF[0]:_otherM[0];
          const _p4=_anchor.gender==='M'?_otherM[0]:_otherF[0];
          if(_p3&&_p4&&_p3.name!==_p4.name) _four=[_anchor,_p2,_p3,_p4];
        }
        // 시도 2: 남복 (anchor가 남성인 경우 같은팀 남1 + 상대팀 남2)
        if(!_four&&_anchor.gender==='M'){
          const _sameM=_sameTeam.filter(p=>p.gender==='M');
          if(_sameM.length&&_otherM.length>=2)
            _four=[_anchor,_sameM[0],_otherM[0],_otherM[1]];
        }
        // 시도 3: 여복 (anchor가 여성인 경우 같은팀 여1 + 상대팀 여2)
        if(!_four&&_anchor.gender==='F'){
          const _sameF=_sameTeam.filter(p=>p.gender==='F');
          if(_sameF.length&&_otherF.length>=2)
            _four=[_anchor,_sameF[0],_otherF[0],_otherF[1]];
        }
        // 시도 4: 어떤 조합도 안 되면 같은팀 1명 + 상대팀 2명 (자유조합)
        if(!_four&&_sameTeam.length&&_otherTeamP.length>=2)
          _four=[_anchor,_sameTeam[0],_otherTeamP[0],_otherTeamP[1]];
      }
      // 자유모드 또는 팀전 실패 → pool에서 anchor 포함 4명
      if(!_four){
        const _rest=_pool.filter(p=>p.name!==_anchor.name);
        if(_rest.length>=3) _four=[_anchor,..._rest.slice(0,3)];
      }
      if(!_four||_four.length<4) continue;
      if(!_fixedPartnersComplete(_four)) continue;

      // 모든 타입으로 formTeams 시도
      let _match = null;
      for(const [_tm,_type] of [[true,'any'],[true,'adjust'],[true,'men'],[true,'women'],[false,'any'],[false,'men'],[false,'women']]) {
        _match = formTeams(_four, _tm, _type, 99);
        if(_match) break;
      }
      if(!_match) continue;

      _match.matchNumber = matches.length+1;
      _match.round = _currentRound;
      _match.court = court;
      _match.isFiller = !Number.isFinite(maxMatches);
      [_match.team1A,_match.team1B,_match.team2C,_match.team2D].forEach(p=>{
        _used.add(p.name);
      });
      updatePlayerRecords(_match);
      matches.push(_match);
      _added++;
    }
    if(!_added) break;
  }
}

// 파트너 정보를 participants에서 조회
function getPartnerInParticipants(participants, name){
  // participants에 partnerName 필드 기반
  const p = participants.find(x=>x.name===name);
  return p?.partnerName || null;
}

function _fixedPartnersComplete(four){
  return four.every(p=>!p.partnerName||four.some(x=>x.name===p.partnerName));
}

function _fixedPartnerSplitCount(matches){
  let count=0;
  matches.forEach((m,mi)=>{
    const sides=[[m.team1A,m.team1B],[m.team2C,m.team2D]];
    const checked=new Set();
    sides.flat().forEach(p=>{
      if(!p||!p.partnerName)return;
      const key=mi+'|'+[p.name,p.partnerName].sort().join('|');
      if(checked.has(key))return;
      checked.add(key);
      const pSide=sides.findIndex(side=>side.some(x=>x.name===p.name));
      const partnerSide=sides.findIndex(side=>side.some(x=>x.name===p.partnerName));
      if(pSide<0||partnerSide!==pSide)count++;
    });
  });
  return count;
}

// 파트너 쌍 강제 배정 시도
// 파트너가 있는 선수가 avail에 있으면 그 쌍을 같은 팀으로 우선 배정
function tryCreateMatchWithPartners(avail, settings, type, maxLD){
  // 파트너 쌍 찾기 (최근 2라운드 내 뛴 쌍은 우선배정 제외 — 간격 3라운드)
  const partnerPairs = [];
  const seen = new Set();
  for(const p of avail){
    if(seen.has(p.name)||!p.partnerName) continue;
    const partner = avail.find(x=>x.name===p.partnerName);
    if(!partner) continue;
    seen.add(p.name); seen.add(partner.name);
    // 간격 체크: 목표 간격 내 뛰었으면 우선 배정 건너뜀
    const gapP=_currentRound-(p.lastRoundPlayed||0);
    const gapPartner=_currentRound-(partner.lastRoundPlayed||0);
    if(gapP<=1||gapPartner<=1) continue;
    const pType = (p.gender==='M'&&partner.gender==='M')?'men'
                :(p.gender==='F'&&partner.gender==='F')?'women':'mixed';
    partnerPairs.push({pair:[p,partner], pType});
  }

  // 우선 배정 가능한 파트너 쌍이 없으면 null (호출부에서 일반 로직 처리)
  if(!partnerPairs.length) return null;

  // 파트너 쌍이 있으면: 종목이 맞는 쌍 우선 사용
  for(const {pair, pType} of partnerPairs){
    // 요청 종목이 any이거나 파트너 종목과 일치할 때만
    if(type!=='any' && type!==pType) continue;
    // 상대 후보: 파트너 쌍 본인 제외
    const rest = avail.filter(p=>p.name!==pair[0].name&&p.name!==pair[1].name);

    // 상대 후보 1순위: 같은 종목의 파트너 쌍
    let oppPair = null;
    const seen2 = new Set();
    for(const r of rest){
      if(seen2.has(r.name)||!r.partnerName) continue;
      const rp = rest.find(x=>x.name===r.partnerName);
      seen2.add(r.name);
      if(!rp) continue;
      seen2.add(rp.name);
      const opType=(r.gender==='M'&&rp.gender==='M')?'men':(r.gender==='F'&&rp.gender==='F')?'women':'mixed';
      // 반드시 같은 종목이어야 함 (여복 파트너 ↔ 여복 파트너만)
      if(opType===pType){ oppPair=[r,rp]; break; }
    }

    // 2순위: 파트너 없는 일반 선수로 상대 구성 (레벨 균형 맞춰 탐색)
    if(!oppPair){
      const freeRest=rest.filter(p=>!p.partnerName);
      const pairLevel=effLevel(pair[0])+effLevel(pair[1]);
      const wouldBe4=(c)=>pair.some(pp=>(pp.opponentCount[c.name]||0)>=3);
      const findBalanced=(pool)=>{
        let bb=null,bd=Infinity;
        for(let i=0;i<pool.length;i++)for(let j=i+1;j<pool.length;j++){
          if(wouldBe4(pool[i])||wouldBe4(pool[j])) continue;
          const d=Math.abs((effLevel(pool[i])+effLevel(pool[j]))-pairLevel);
          const gpen=(pool[i].gamesPlayed+pool[j].gamesPlayed)*0.01;
          if(d+gpen<bd){bd=d+gpen;bb=[pool[i],pool[j]];}
        }
        return bb;
      };
      if(pType==='women'){
        oppPair=findBalanced(freeRest.filter(p=>p.gender==='F'));
      } else if(pType==='men'){
        oppPair=findBalanced(freeRest.filter(p=>p.gender==='M'));
      } else { // mixed
        const mm=freeRest.filter(p=>p.gender==='M');
        const ff=freeRest.filter(p=>p.gender==='F');
        let bb=null,bd=Infinity;
        for(const a of mm)for(const b of ff){
          if(wouldBe4(a)||wouldBe4(b)) continue;
          const d=Math.abs((effLevel(a)+effLevel(b))-pairLevel);
          const gpen=(a.gamesPlayed+b.gamesPlayed)*0.01;
          if(d+gpen<bd){bd=d+gpen;bb=[a,b];}
        }
        oppPair=bb;
      }
    }

    if(!oppPair) continue;
    const four=[...pair,...oppPair];
    // 최종 종목 검증: 4명 구성이 pType과 일치하는지 확인
    const males=four.filter(p=>p.gender==='M').length;
    const females=four.filter(p=>p.gender==='F').length;
    const actualType=(males===4)?'men':(females===4)?'women':'mixed';
    if(actualType!==pType) continue; // 종목 불일치 시 이 쌍 건너뜀
    const m=formTeams(four,settings.teamMode,pType,maxLD);
    if(m) return m;
  }

  // 파트너 쌍 배정 실패 시 null (호출부에서 일반 단계 처리)
  return null;
}

function tryCreateMatch(avail,settings,type,maxLD){
  let pool;
  if(type==='women'){pool=avail.filter(p=>p.gender==='F');if(pool.length<4)return null;}
  else if(type==='men'){pool=avail.filter(p=>p.gender==='M');if(pool.length<4)return null;}
  else if(type==='mixed'){
    // 남녀 모두 있어야 혼복 가능
    if(!avail.some(p=>p.gender==='F')||!avail.some(p=>p.gender==='M'))return null;
    pool=avail;if(pool.length<4)return null;
  }
  else if(type==='adjust'){
    if(!settings.teamMode)return null;
    pool=avail;if(pool.length<4)return null;
    const four=selectFourTeamAdjustment(pool,settings,maxLD);
    return four?formTeams(four,true,'adjust',maxLD):null;
  }
  else{pool=avail;if(pool.length<4)return null;}
  const four=selectBestFour(pool,settings,type,maxLD);
  if(!four)return null;
  return formTeams(four,settings.teamMode,type,maxLD);
}

function selectBestFour(pool,settings,type,maxLD){
  pool.sort((a,b)=>a.gamesPlayed-b.gamesPlayed);
  if(settings.teamMode){const gf=type==='women'?'F':type==='men'?'M':null;return selectFourTeamMode(pool,gf,maxLD);}
  return selectFourFreeMode(pool,type,maxLD);
}

function selectFourTeamMode(pool,gf,maxLD){
  let bp=pool.filter(p=>p.team==='청팀'),wp=pool.filter(p=>p.team==='홍팀');
  if(gf){bp=bp.filter(p=>p.gender===gf);wp=wp.filter(p=>p.gender===gf);}
  if(bp.length<2||wp.length<2)return null;
  // 후보: 게임 적게 한 순 + 오래 쉰 순으로 우선 선발, 최대 12명까지 확장
  const rank=arr=>[...arr].sort((a,b)=>{
    const gd=a.gamesPlayed-b.gamesPlayed;
    if(gd!==0)return gd;
    return (a.lastRoundPlayed||0)-(b.lastRoundPlayed||0); // 오래 쉰 선수 우선
  });
  const bc=rank(bp).slice(0,12),wc=rank(wp).slice(0,12);
  let best=null,bestScore=Infinity;
  for(let i=0;i<bc.length-1;i++)for(let j=i+1;j<bc.length;j++)
    for(let k=0;k<wc.length-1;k++)for(let l=k+1;l<wc.length;l++){
      const four=[bc[i],bc[j],wc[k],wc[l]];
      if(!_fixedPartnersComplete(four))continue;
      const ld=Math.abs((effLevel(four[0])+effLevel(four[1]))-(effLevel(four[2])+effLevel(four[3])));
      if(ld>maxLD)continue;
      const score=diversityScore(four,ld);
      if(score<bestScore){bestScore=score;best=four;}
    }
  return best;
}

function _goalForPlayer(p,settings){
  return p._goal!=null?p._goal:(settings.gamesPerPlayer||4);
}

function _teamGenderRemaining(participants,settings){
  const rem={
    '청팀':{M:0,F:0},
    '홍팀':{M:0,F:0}
  };
  participants.forEach(p=>{
    if(!rem[p.team]||!(p.gender in rem[p.team]))return;
    rem[p.team][p.gender]+=Math.max(0,_goalForPlayer(p,settings)-(p.gamesPlayed||0));
  });
  return rem;
}

function _shouldTryGenderAdjustment(participants,settings){
  if(!settings?.teamMode)return false;
  const rem=_teamGenderRemaining(participants,settings);
  return (rem['청팀'].M>rem['청팀'].F&&rem['홍팀'].F>rem['홍팀'].M)
      || (rem['청팀'].F>rem['청팀'].M&&rem['홍팀'].M>rem['홍팀'].F);
}

function _isAdjustmentFour(four){
  const f=four.filter(p=>p.gender==='F').length;
  return f===1||f===3;
}

function selectFourTeamAdjustment(pool,settings,maxLD){
  const bp=pool.filter(p=>p.team==='청팀');
  const wp=pool.filter(p=>p.team==='홍팀');
  if(bp.length<2||wp.length<2)return null;
  const rank=arr=>[...arr].sort((a,b)=>{
    const needB=Math.max(0,_goalForPlayer(b,settings)-(b.gamesPlayed||0));
    const needA=Math.max(0,_goalForPlayer(a,settings)-(a.gamesPlayed||0));
    if(needB!==needA)return needB-needA;
    const gd=a.gamesPlayed-b.gamesPlayed;
    if(gd!==0)return gd;
    return (a.lastRoundPlayed||0)-(b.lastRoundPlayed||0);
  }).slice(0,14);
  const bc=rank(bp), wc=rank(wp);
  let best=null,bestScore=Infinity;
  for(let i=0;i<bc.length-1;i++)for(let j=i+1;j<bc.length;j++)
    for(let k=0;k<wc.length-1;k++)for(let l=k+1;l<wc.length;l++){
      const four=[bc[i],bc[j],wc[k],wc[l]];
      if(!_isAdjustmentFour(four))continue;
      if(!_fixedPartnersComplete(four))continue;
      const m=formTeams(four,true,'adjust',maxLD);
      if(!m)continue;
      const help=four.reduce((s,p)=>s+Math.max(0,_goalForPlayer(p,settings)-(p.gamesPlayed||0)),0);
      const newOver=four.reduce((s,p)=>s+Math.max(0,(p.gamesPlayed||0)+1-_goalForPlayer(p,settings)),0);
      const wait=four.reduce((s,p)=>s+Math.min(_currentRound-(p.lastRoundPlayed||0),10),0);
      const score=_dailyTeamDiffPenalty(m.levelDiff||0)+diversityScore(four,m.levelDiff||0)*0.35-help*220+newOver*160-wait*8;
      if(score<bestScore){bestScore=score;best=four;}
    }
  return best;
}

function selectFourFreeMode(pool,type,maxLD){
  const minG=pool[0].gamesPlayed;
  // 윈도우를 minG+2로 좁혀 게임 수 적은 선수 우선 보장
  // 단, 신규선수(isNewJoiner)는 반드시 cands 앞에 고정 포함
  let cands=pool.filter(p=>p.gamesPlayed<=minG+2);
  if(cands.length<4)cands=pool.filter(p=>p.gamesPlayed<=minG+4);
  if(cands.length<4)cands=pool.slice(0,20);
  // 신규선수 강제 포함: cands에 없는 신규선수를 앞에 삽입
  const newJoiners=pool.filter(p=>p.isNewJoiner&&!cands.includes(p));
  if(newJoiners.length>0) cands=[...newJoiners,...cands];
  cands=cands.sort((a,b)=>{
    const gd=a.gamesPlayed-b.gamesPlayed;
    if(gd!==0)return gd;
    return (a.lastRoundPlayed||0)-(b.lastRoundPlayed||0);
  }).slice(0,20);

  // 파트너가 있는 선수는 파트너도 cands에 포함 (단, 목표 간격 내 뛴 쌍은 제외)
  const toAdd=[];
  for(const p of cands){
    if(!p.partnerName) continue;
    const gapP=_currentRound-(p.lastRoundPlayed||0);
    if(gapP<=_partnerGapThreshold) continue;
    const partner=pool.find(x=>x.name===p.partnerName);
    if(!partner) continue;
    const gapPartner=_currentRound-(partner.lastRoundPlayed||0);
    if(gapPartner<=_partnerGapThreshold) continue;
    if(!cands.includes(partner)) toAdd.push(partner);
  }
  cands=[...cands,...toAdd];

  let best=null,bestScore=Infinity;const n=cands.length;
  for(let i=0;i<n-3;i++)for(let j=i+1;j<n-2;j++)for(let k=j+1;k<n-1;k++)for(let l=k+1;l<n;l++){
    const four=[cands[i],cands[j],cands[k],cands[l]];
    if(type==='women'&&four.some(p=>p.gender!=='F'))continue;
    if(type==='men'&&four.some(p=>p.gender!=='M'))continue;
    if(type==='mixed'&&(four.every(p=>p.gender==='F')||four.every(p=>p.gender==='M')))continue;
    // 파트너가 있는 선수는 파트너도 반드시 4명 안에 있어야 함
    if(!_fixedPartnersComplete(four)) continue;
    const minLD=Math.min(
      Math.abs((effLevel(four[0])+effLevel(four[1]))-(effLevel(four[2])+effLevel(four[3]))),
      Math.abs((effLevel(four[0])+effLevel(four[2]))-(effLevel(four[1])+effLevel(four[3]))),
      Math.abs((effLevel(four[0])+effLevel(four[3]))-(effLevel(four[1])+effLevel(four[2])))
    );
    if(minLD>maxLD)continue;
    const score=diversityScore(four,minLD);
    if(score<bestScore){bestScore=score;best=four;}
  }
  return best;
}

function selectFillerFour(pool,unmet,target,settings){
  const goal=(p)=>(p._goal!=null?p._goal:target);
  // 미달 선수: 게임 적게+오래 쉰 순으로 정렬 후 전부 후보로
  const su=[...unmet].sort((a,b)=>{
    const gd=a.gamesPlayed-b.gamesPlayed;
    if(gd!==0)return gd;
    return (a.lastRoundPlayed||0)-(b.lastRoundPlayed||0); // 오래 쉰 선수 우선
  });
  const ex=pool.filter(p=>p.gamesPlayed>=goal(p)).sort((a,b)=>a.gamesPlayed-b.gamesPlayed);
  // 후보 풀 확장: 미달 전원 + 초과 선수 상위 8명
  const cands=[...su,...ex.slice(0,8)].slice(0,20);
  if(cands.length<4)return null;
  let best=null,bestScore=Infinity;const n=cands.length;
  for(let i=0;i<n-3;i++)for(let j=i+1;j<n-2;j++)for(let k=j+1;k<n-1;k++)for(let l=k+1;l<n;l++){
    const four=[cands[i],cands[j],cands[k],cands[l]];
    if(!four.some(p=>p.gamesPlayed<goal(p)))continue;
    if(settings.teamMode){const b=four.filter(p=>p.team==='청팀'),w=four.filter(p=>p.team==='홍팀');if(b.length<2||w.length<2)continue;}
    if(!_fixedPartnersComplete(four))continue;
    const minLD=Math.min(
      Math.abs((effLevel(four[0])+effLevel(four[1]))-(effLevel(four[2])+effLevel(four[3]))),
      Math.abs((effLevel(four[0])+effLevel(four[2]))-(effLevel(four[1])+effLevel(four[3]))),
      Math.abs((effLevel(four[0])+effLevel(four[3]))-(effLevel(four[1])+effLevel(four[2])))
    );
    const uc=four.filter(p=>p.gamesPlayed<goal(p)).length;
    // 미달 인원 많을수록, 오래 쉰 선수 포함할수록 우선
    const waitBonus=four.reduce((s,p)=>s+Math.min(_currentRound-(p.lastRoundPlayed||0),10)*5,0);
    const score=minLD*20+diversityScore(four,minLD)-uc*200-waitBonus;
    if(score<bestScore){bestScore=score;best=four;}
  }
  return best;
}

function diversityScore(four,ld){
  // LD 가중치 최우선 — 실력차 최소화
  let score=(ld||0)*80;

  const games=four.map(p=>p.gamesPlayed);
  // 게임 수 분산 패널티 강화: 8→30 (실력차 80과 균형 맞춤)
  score+=(Math.max(...games)-Math.min(...games))*30;

  // 라운드 간격 패널티 — 목표 간격(_partnerGapThreshold) 기준
  const tg=_partnerGapThreshold||2;
  four.forEach(p=>{
    const gap=_currentRound-(p.lastRoundPlayed||0);
    if(gap<=tg) score+=400*(tg-gap+1); // 목표 간격 내일수록 강한 패널티
    else if(gap>=tg*2) score-=30;       // 너무 오래 쉰 선수 우선 배정
  });
  // 파트너 쌍이 목표 간격 내 함께 뛰었으면 극강 패널티
  for(let i=0;i<4;i++){
    if(!four[i].partnerName) continue;
    const j=four.findIndex(p=>p.name===four[i].partnerName);
    if(j<0) continue;
    const gapI=_currentRound-(four[i].lastRoundPlayed||0);
    const gapJ=_currentRound-(four[j].lastRoundPlayed||0);
    if(gapI<=tg||gapJ<=tg) score+=1500;
  }

  // 상대 중복 패널티: 1회는 허용(패널티 낮음), 2회째부터 강하게
  for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){
    // 파트너 카운트(같은팀)는 파트너 쌍이면 무시
    const isPartnerPair=four[i].partnerName===four[j].name;
    if(!isPartnerPair){
      const pc=four[i].partnerCount[four[j].name]||0;
      score+=MATCH_QUALITY?MATCH_QUALITY.partnerRepeatPenalty(pc,'pool'):(pc===0?0:pc===1?120:pc===2?900:1e9);
    }
    const oc=four[i].opponentCount[four[j].name]||0;
    score+=MATCH_QUALITY?MATCH_QUALITY.opponentRepeatPenalty(oc,'pool'):(oc===0?0:oc===1?4:oc===2?30:oc===3?120:1e9);
  }

  // 팀 내 실력 차이 패널티
  const minIntra=Math.min(
    Math.abs(effLevel(four[0])-effLevel(four[1]))+Math.abs(effLevel(four[2])-effLevel(four[3])),
    Math.abs(effLevel(four[0])-effLevel(four[2]))+Math.abs(effLevel(four[1])-effLevel(four[3])),
    Math.abs(effLevel(four[0])-effLevel(four[3]))+Math.abs(effLevel(four[1])-effLevel(four[2]))
  );
  score+=minIntra*25;
  return score;
}

function _matchGenderErrorCount(m){
  if(!m)return 1;
  const players=[m.team1A,m.team1B,m.team2C,m.team2D];
  if(players.some(p=>!p||!p.gender))return 1;
  if(m.type==='남복')return players.every(p=>p.gender==='M')?0:1;
  if(m.type==='여복')return players.every(p=>p.gender==='F')?0:1;
  if(m.type==='혼복'){
    const t1F=[m.team1A,m.team1B].filter(p=>p.gender==='F').length;
    const t2F=[m.team2C,m.team2D].filter(p=>p.gender==='F').length;
    return (t1F===1&&t2F===1)?0:1;
  }
  if(m.type==='보정'){
    const t1F=[m.team1A,m.team1B].filter(p=>p.gender==='F').length;
    const t2F=[m.team2C,m.team2D].filter(p=>p.gender==='F').length;
    const totalF=t1F+t2F;
    return ((totalF===1||totalF===3)&&t1F!==t2F)?0:1;
  }
  return 1;
}

function _participationSlotStats(participants,settings,counts){
  const gpp=settings.gamesPerPlayer||4;
  const goal=p=>p._goal!=null?p._goal:gpp;
  const totalGoalSlots=participants.reduce((s,p)=>s+goal(p),0);
  const minimumMatches=Math.ceil(totalGoalSlots/4);
  const minimumOver=Math.max(0,minimumMatches*4-totalGoalSlots);
  const underSlots=participants.reduce((s,p)=>s+Math.max(0,goal(p)-(counts[p.name]||0)),0);
  const overSlots=participants.reduce((s,p)=>s+Math.max(0,(counts[p.name]||0)-goal(p)),0);
  const femaleTargetSlots=participants
    .filter(p=>p.gender==='F')
    .reduce((s,p)=>s+goal(p),0);
  const femaleActualSlots=participants
    .filter(p=>p.gender==='F')
    .reduce((s,p)=>s+(counts[p.name]||0),0);
  // 유효 종목(남복/여복/혼복)은 경기마다 여성 출전 수가 0/2/4명이라 전체 여성 슬롯은 항상 짝수다.
  // 여성 목표 슬롯이 홀수면 1명은 미달/초과 조정이 불가피할 수 있다.
  const parityAdjustment=(femaleTargetSlots%2===1&&Math.abs(femaleActualSlots-femaleTargetSlots)===1)
    ?Math.min(1,underSlots,overSlots):0;
  const avoidableUnderSlots=Math.max(0,underSlots-parityAdjustment);
  const avoidableOverSlots=Math.max(0,overSlots-minimumOver-parityAdjustment);
  return {goal,totalGoalSlots,minimumMatches,minimumOver,underSlots,overSlots,
    femaleTargetSlots,femaleActualSlots,parityAdjustment,avoidableUnderSlots,avoidableOverSlots};
}

function formTeams(four,teamMode,type,maxLD,allowPartnerSplit){
  const combos=[[0,1,2,3],[0,2,1,3],[0,3,1,2]];
  let best=null,bestScore=Infinity;

  // 파트너 종목 검증: allowPartnerSplit이 아니면 종목 강제
  if(!allowPartnerSplit){
    const males=four.filter(p=>p.gender==='M').length;
    const females=four.filter(p=>p.gender==='F').length;
    const fourType=(males===4)?'men':(females===4)?'women':'mixed';
    for(const p of four){
      if(!p.partnerName) continue;
      const partner=four.find(x=>x.name===p.partnerName);
      if(!partner) continue;
      const reqType=(p.gender==='M'&&partner.gender==='M')?'men'
                   :(p.gender==='F'&&partner.gender==='F')?'women':'mixed';
      if(reqType!==fourType) return null;
    }
  }

  // 파트너 쌍 확인: 파트너가 있으면 반드시 같은 팀 (allowPartnerSplit이면 무시)
  const isValidCombo=(t1,t2)=>{
    if(allowPartnerSplit) return true; // 분리 허용 시 검증 생략
    const allPlayers=[...t1,...t2];
    for(const p of allPlayers){
      if(!p.partnerName) continue;
      const partner=allPlayers.find(x=>x.name===p.partnerName);
      if(!partner) continue; // 파트너가 4명 안에 없으면 무시
      // 파트너가 다른 팀에 있으면 invalid
      const pInT1=t1.includes(p), partnerInT1=t1.includes(partner);
      if(pInT1!==partnerInT1) return false;
    }
    return true;
  };

  for(const combo of combos){
    const t1=[four[combo[0]],four[combo[1]]],t2=[four[combo[2]],four[combo[3]]];
    // 파트너 같은팀 강제
    if(!isValidCombo(t1,t2)) continue;
    if(teamMode){if(t1[0].team!==t1[1].team||t2[0].team!==t2[1].team||t1[0].team===t2[0].team)continue;}
    if(!teamMode&&(type==='any'||type==='mixed')){
      const totalF=four.filter(p=>p.gender==='F').length;
      const t1F=t1.filter(p=>p.gender==='F').length;
      const t2F=t2.filter(p=>p.gender==='F').length;
      if(totalF===2&&(t1F!==1||t2F!==1))continue;
      if(totalF!==0&&totalF!==2&&totalF!==4)continue;
    }
    const ld=Math.abs((effLevel(t1[0])+effLevel(t1[1]))-(effLevel(t2[0])+effLevel(t2[1])));
    if(ld>maxLD)continue;
    let score=_dailyTeamDiffPenalty(ld); // 실력차 최우선
    score+=Math.abs(effLevel(t1[0])-effLevel(t1[1]))*25;
    score+=Math.abs(effLevel(t2[0])-effLevel(t2[1]))*25;
    score+=_dailyPartnerLevelGapPenalty(t1)+_dailyPartnerLevelGapPenalty(t2);
    const p1pair=t1[0].partnerName===t1[1].name;
    const p2pair=t2[0].partnerName===t2[1].name;
    if(!p1pair) score+=_dailyPartnerRepeatPenalty(t1[0].partnerCount[t1[1].name]||0);
    if(!p2pair) score+=_dailyPartnerRepeatPenalty(t2[0].partnerCount[t2[1].name]||0);
    // 상대 중복: 1회 허용, 2회+만 패널티
    t1.forEach(a=>t2.forEach(b=>{const oc=a.opponentCount[b.name]||0;score+=MATCH_QUALITY?MATCH_QUALITY.opponentRepeatPenalty(oc):(oc===0?0:oc===1?2:oc===2?15:oc===3?80:1e9);}));
    if(!teamMode&&type==='any'){const f1=t1.filter(p=>p.gender==='F').length,f2=t2.filter(p=>p.gender==='F').length;if(f1===1&&f2===1)score-=50;}
    if(score<bestScore){bestScore=score;best={team1A:t1[0],team1B:t1[1],team2C:t2[0],team2D:t2[1],levelDiff:Math.round(ld*10)/10,team1Level:effLevel(t1[0])+effLevel(t1[1]),team2Level:effLevel(t2[0])+effLevel(t2[1])};}
  }
  if(!best)return null;
  // 팀 모드: team1이 항상 청팀이 되도록 보장
  if(teamMode&&best.team1A.team==='홍팀'){
    [best.team1A,best.team2C]=[best.team2C,best.team1A];
    [best.team1B,best.team2D]=[best.team2D,best.team1B];
  }
  const all=[best.team1A,best.team1B,best.team2C,best.team2D];
  const t1f=[best.team1A,best.team1B].filter(p=>p.gender==='F').length;
  const t2f=[best.team2C,best.team2D].filter(p=>p.gender==='F').length;
  const allF=all.every(p=>p.gender==='F');
  const allM=all.every(p=>p.gender==='M');
  if(type==='women'){
    if(!allF)return null;
    best.type='여복';
  }
  else if(type==='men'){
    if(!allM)return null;
    best.type='남복';
  }
  else if(type==='adjust'){
    if(!teamMode)return null;
    const totalF=t1f+t2f;
    // 팀전 성비가 반대로 남았을 때 쓰는 예외 경기:
    // 한 팀은 여1/남1, 다른 팀은 여0/남2 또는 여2/남0 형태가 될 수 있다.
    if(!((totalF===1||totalF===3)&&t1f!==t2f))return null;
    best.type='보정';
    best.isAdjustment=true;
  }
  else if(allF) best.type='여복';
  else if(allM) best.type='남복';
  else if(t1f===1&&t2f===1) best.type='혼복';
  else {
    // 혼복 조건 불충족(한 팀에 여성 0명 또는 2명) → 남복/여복으로 재분류 or null
    if(allF) best.type='여복';
    else if(allM) best.type='남복';
    else {
      // 4명 중 남녀 혼합이지만 혼복 조건 불충족 → 종목 무효, null 반환
      return null;
    }
  }
  return _matchGenderErrorCount(best)===0?best:null;
}

function updatePlayerRecords(match){
  const all=[match.team1A,match.team1B,match.team2C,match.team2D];
  all.forEach(p=>{p.gamesPlayed++;p.lastRoundPlayed=match.round;});
  if(match.type==='여복')all.forEach(p=>p.womenDoublesPlayed++);
  else if(match.type==='남복')all.forEach(p=>p.menDoublesPlayed++);
  else if(match.type==='보정')all.forEach(p=>p.adjustmentPlayed=(p.adjustmentPlayed||0)+1);
  else all.forEach(p=>p.mixedDoublesPlayed++);
  const inc=(map,key)=>{map[key]=(map[key]||0)+1;};
  inc(match.team1A.partnerCount,match.team1B.name);inc(match.team1B.partnerCount,match.team1A.name);
  inc(match.team2C.partnerCount,match.team2D.name);inc(match.team2D.partnerCount,match.team2C.name);
  [match.team1A,match.team1B].forEach(a=>[match.team2C,match.team2D].forEach(b=>{inc(a.opponentCount,b.name);inc(b.opponentCount,a.name);}));
}

function _rollbackPlayerRecords(match){
  const all=[match.team1A,match.team1B,match.team2C,match.team2D];
  const dec=(map,key)=>{if(!map||!map[key])return;if(--map[key]<=0)delete map[key];};
  all.forEach(p=>{
    p.gamesPlayed=Math.max(0,(p.gamesPlayed||0)-1);
    if(match.type==='여복')p.womenDoublesPlayed=Math.max(0,(p.womenDoublesPlayed||0)-1);
    else if(match.type==='남복')p.menDoublesPlayed=Math.max(0,(p.menDoublesPlayed||0)-1);
    else if(match.type==='보정')p.adjustmentPlayed=Math.max(0,(p.adjustmentPlayed||0)-1);
    else p.mixedDoublesPlayed=Math.max(0,(p.mixedDoublesPlayed||0)-1);
  });
  dec(match.team1A.partnerCount,match.team1B.name);dec(match.team1B.partnerCount,match.team1A.name);
  dec(match.team2C.partnerCount,match.team2D.name);dec(match.team2D.partnerCount,match.team2C.name);
  [match.team1A,match.team1B].forEach(a=>[match.team2C,match.team2D].forEach(b=>{
    dec(a.opponentCount,b.name);dec(b.opponentCount,a.name);
  }));
}

function _repairParticipation(matches,participants,settings,historyMatches=[]){
  const goal=p=>p._goal!=null?p._goal:settings.gamesPerPlayer;
  const slots=['team1A','team1B','team2C','team2D'];
  const exactKey=m=>{
    const t1=[m.team1A.name,m.team1B.name].sort().join('|');
    const t2=[m.team2C.name,m.team2D.name].sort().join('|');
    return [t1,t2].sort().join(' VS ');
  };
  let safety=participants.length*2;
  while(safety-->0){
    const under=participants.filter(p=>p.gamesPlayed<goal(p))
      .sort((a,b)=>(goal(b)-b.gamesPlayed)-(goal(a)-a.gamesPlayed));
    if(!under.length)break;
    const over=participants.filter(p=>p.gamesPlayed>goal(p)&&!p.isNewJoiner);
    if(!over.length)break;
    const p=under[0];
    let best=null;
    matches.forEach((m,mi)=>{
      const names=new Set(slots.map(k=>m[k].name));
      if(names.has(p.name))return;
      slots.forEach(slot=>{
        const q=m[slot];
        if(!over.includes(q)||q.gender!==p.gender)return;
        if(settings.teamMode&&q.team!==p.team)return;
        if(q.partnerName&&names.has(q.partnerName))return;
        if(p.partnerName&&!names.has(p.partnerName))return;
        const test={...m,[slot]:p};
        if(_matchGenderErrorCount(test)>0)return;
        const team1=effLevel(test.team1A)+effLevel(test.team1B);
        const team2=effLevel(test.team2C)+effLevel(test.team2D);
        const ld=Math.abs(team1-team2);
        const others=[...historyMatches,...matches.filter((_,i)=>i!==mi)];
        const repeat=others.some(x=>exactKey(x)===exactKey(test));
        const score=(repeat?100000:0)+ld*100+(p.partnerCount[
          slot==='team1A'?test.team1B.name:slot==='team1B'?test.team1A.name:
          slot==='team2C'?test.team2D.name:test.team2C.name]||0)*20;
        if(!best||score<best.score)best={m,slot,p,q,team1,team2,ld,score};
      });
      slots.forEach(slot=>{
        const q=m[slot];
        if(!over.includes(q))return;
        if(settings.teamMode&&q.team!==p.team)return;
        const four=slots.map(k=>m[k]===q?p:m[k]);
        if(new Set(four.map(x=>x.name)).size<4)return;
        if(!_fixedPartnersComplete(four))return;
        const rebuilt=formTeams(four,settings.teamMode,'any',99)||formTeams(four,settings.teamMode,'adjust',99);
        if(!rebuilt)return;
        rebuilt.matchNumber=m.matchNumber;
        rebuilt.round=m.round;
        rebuilt.court=m.court;
        rebuilt.isFiller=m.isFiller;
        const others=[...historyMatches,...matches.filter((_,i)=>i!==mi)];
        const repeat=others.some(x=>exactKey(x)===exactKey(rebuilt));
        const score=(repeat?100000:0)+(rebuilt.levelDiff||0)*100+5;
        if(!best||score<best.score)best={m,rebuilt,p,q,score};
      });
    });
    if(!best)break;
    _rollbackPlayerRecords(best.m);
    if(best.rebuilt)Object.assign(best.m,best.rebuilt);
    else{
      best.m[best.slot]=best.p;
      best.m.team1Level=best.team1;
      best.m.team2Level=best.team2;
      best.m.levelDiff=Math.round(best.ld*10)/10;
    }
    updatePlayerRecords(best.m);
  }
  participants.forEach(p=>p.lastRoundPlayed=0);
  matches.forEach(m=>[m.team1A,m.team1B,m.team2C,m.team2D].forEach(p=>{
    p.lastRoundPlayed=Math.max(p.lastRoundPlayed||0,m.round);
  }));
}

/* 대진 품질 점수 (낮을수록 좋음) — 여러 후보 중 최고를 고르는 데 사용 */
function _bracketQualityScore(matches, participants, settings){
  const N=participants.length;
  let penalty=0;
  // ① 실력 균형
  let ldSum=0, ldMax=0;
  matches.forEach(m=>{ const ld=Math.abs(m.levelDiff||0); ldSum+=ld; if(ld>ldMax)ldMax=ld; });
  penalty += ldSum*2 + ldMax*3;
  penalty += matches.reduce((s,m)=>s+_matchGenderErrorCount(m),0)*10000;
  penalty += _fixedPartnerSplitCount(matches)*100000;
  // ② 게임 수 보장 (미달 페널티 큼)
  const goal=(p)=>(p._goal!=null?p._goal:settings.gamesPerPlayer);
  // generateMatches/fillMissingGames가 완료 경기까지 포함한 누적 출전 수를 갱신한다.
  const gc={}; participants.forEach(p=>gc[p.name]=p.gamesPlayed||0);
  let under=0; participants.forEach(p=>{ if(gc[p.name]<goal(p)) under+=(goal(p)-gc[p.name]); });
  penalty += under*50;
  // ③ 대진 간격 (회피 가능한 연속만)
  let excess=0;
  const maxR=Math.max(...matches.map(m=>m.round));
  for(let r=2;r<=maxR;r++){
    const prev=new Set(matches.filter(m=>m.round===r-1).flatMap(m=>[m.team1A.name,m.team1B.name,m.team2C.name,m.team2D.name]));
    const cur=matches.filter(m=>m.round===r).flatMap(m=>[m.team1A.name,m.team1B.name,m.team2C.name,m.team2D.name]);
    let rc=0; cur.forEach(nm=>{if(prev.has(nm))rc++;});
    const rPlay=cur.length, rRest=N-rPlay, rMin=Math.max(0,rPlay-rRest);
    excess += Math.max(0, rc-rMin);
  }
  penalty += excess*8;
  // ④ 상대 다양성 (3회+, 4회+)
  const oc={};
  matches.forEach(m=>{const t1=[m.team1A.name,m.team1B.name],t2=[m.team2C.name,m.team2D.name];t1.forEach(a=>t2.forEach(b=>{const k=[a,b].sort().join('|');oc[k]=(oc[k]||0)+1;}));});
  const ov=Object.values(oc);
  penalty += ov.filter(c=>c===3).length*10 + ov.filter(c=>c>=4).length*100;
  // ⑤ 보완 게임 수
  penalty += matches.filter(m=>m.isFiller).length*15;
  // ⑥ 성비 보정경기는 허용하되, 같은 품질이면 적은 쪽을 선호
  penalty += matches.filter(m=>m.type==='보정').length*2;
  return penalty;
}

// 후보 선택 우선순위: 출전 공정성과 경기 수를 먼저 지키고, 같은 조건에서 다양성을 개선한다.
function _candidateQualityKey(matches,participants,settings,baseScore){
  const goal=p=>p._goal!=null?p._goal:settings.gamesPerPlayer;
  // 재배정에서는 gamesPlayed에 이미 완료된 라운드 출전 수도 들어 있다.
  const games={};participants.forEach(p=>games[p.name]=p.gamesPlayed||0);
  const _slotStats=_participationSlotStats(participants,settings,games);
  const {underSlots,overSlots,avoidableUnderSlots,avoidableOverSlots}= _slotStats;
  const partnerCounts={},sameFourCounts={},exactMatchCounts={};
  const genderErr=matches.reduce((s,m)=>s+_matchGenderErrorCount(m),0);
  const fixedPartnerSplit=_fixedPartnerSplitCount(matches);
  const adjustmentCount=matches.filter(m=>m.type==='보정').length;
  matches.forEach(m=>{
    [[m.team1A,m.team1B],[m.team2C,m.team2D]].forEach(pair=>{
      // 사용자가 지정한 고정 파트너는 반복 감점에서 제외한다.
      if(pair[0].partnerName===pair[1].name||pair[1].partnerName===pair[0].name)return;
      const k=[pair[0].name,pair[1].name].sort().join('|');
      partnerCounts[k]=(partnerCounts[k]||0)+1;
    });
    const t1=[m.team1A.name,m.team1B.name].sort();
    const t2=[m.team2C.name,m.team2D.name].sort();
    const four=[...t1,...t2].sort().join('|');
    const exact=[t1.join('|'),t2.join('|')].sort().join(' VS ');
    sameFourCounts[four]=(sameFourCounts[four]||0)+1;
    exactMatchCounts[exact]=(exactMatchCounts[exact]||0)+1;
  });
  const pv=Object.values(partnerCounts);
  const partner2=pv.filter(c=>c===2).length;
  const sameFourRepeats=Object.values(sameFourCounts).reduce((s,c)=>s+Math.max(0,c-1),0);
  const exactMatchRepeats=Object.values(exactMatchCounts).reduce((s,c)=>s+Math.max(0,c-1),0);
  return [
    genderErr,
    fixedPartnerSplit,
    avoidableUnderSlots,
    avoidableOverSlots,
    underSlots,
    overSlots,
    adjustmentCount,
    matches.filter(m=>m.isFiller).length,
    exactMatchRepeats,
    sameFourRepeats,
    pv.filter(c=>c>=4).length,
    pv.filter(c=>c===3).length,
    baseScore+partner2*2
  ];
}
function _isBetterQualityKey(next,best){
  if(!best)return true;
  for(let i=0;i<next.length;i++){
    if(next[i]!==best[i])return next[i]<best[i];
  }
  return false;
}

function _autoSearchTries(playerCount,hasNewJoiner=false,hasFixedPartner=false){
  // 버튼을 여러 번 누르는 대신 한 번에 충분한 후보를 비교한다.
  // 인원이 많거나 중간 투입이 있으면 조합 편차가 커져 더 많이 탐색한다.
  if(hasNewJoiner)return playerCount>=28?120:90;
  if(hasFixedPartner)return playerCount>=24?200:160;
  if(playerCount>=30)return 120;
  if(playerCount>=24)return 90;
  return 50;
}

function shuffleArray(arr){for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}}
function fisherYates(arr){for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}return arr;}

/* ═══ WIN BUTTON ═══ */
// winOverride: {idx -> 't1'|'t2'|null}
const winOverride={};
function clickWin(idx,side){
  const prev=winOverride[idx];
  // 같은 버튼 다시 누르면 취소
  winOverride[idx]=(prev===side)?null:side;
  // 승패 버튼 사용 시 점수 입력 초기화
  if(winOverride[idx]){
    const s1=document.getElementById('s1_'+idx);
    const s2=document.getElementById('s2_'+idx);
    if(s1)s1.value='';if(s2)s2.value='';
  }
  updateScores();
}

function _resetScoreboard(){
  ['blueWins','bW','bL','bScore','whiteWins','wW','wL','wScore'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.textContent='0';
  });
  const wb=document.getElementById('winnerBanner');if(wb)wb.innerHTML='';
}

function _matchPlayerNamesByIdx(idx){
  const m=currentMatches[idx];
  if(!m)return[];
  return [m.team1A,m.team1B,m.team2C,m.team2D].map(p=>p&&p.name).filter(Boolean);
}
function _fastCourtCount(){
  return parseInt(currentSettings.courts||document.getElementById('courts')?.value||'4',10)||4;
}
function _fastNormalize(){
  if(!_fastPlayOn)return;
  Object.keys(_fastActive).forEach(c=>{
    const idx=parseInt(_fastActive[c],10);
    if(!currentMatches[idx]||_isMatchDone(idx))delete _fastActive[c];
  });
}
function _fastActiveIdxSet(exceptCourt){
  _fastNormalize();
  const set=new Set();
  Object.keys(_fastActive).forEach(c=>{
    if(String(c)===String(exceptCourt))return;
    const idx=parseInt(_fastActive[c],10);
    if(Number.isFinite(idx))set.add(idx);
  });
  return set;
}
function _fastActivePlayers(exceptCourt){
  const names=new Set();
  _fastActiveIdxSet(exceptCourt).forEach(idx=>_matchPlayerNamesByIdx(idx).forEach(n=>names.add(n)));
  return names;
}
function _fastPendingIdxs(exceptCourt){
  const active=_fastActiveIdxSet(exceptCourt);
  return currentMatches
    .map((m,i)=>({m,i}))
    .filter(x=>!_isMatchDone(x.i)&&!active.has(x.i))
    .sort((a,b)=>(a.m.matchNumber||a.i+1)-(b.m.matchNumber||b.i+1))
    .map(x=>x.i);
}
function _fastPickNext(court){
  const activeNames=_fastActivePlayers(court);
  const safe=_fastPendingIdxs(court).filter(idx=>!_matchPlayerNamesByIdx(idx).some(n=>activeNames.has(n)));
  if(!safe.length)return null;
  const recent=new Set(_fastLastFinishedPlayers||[]);
  const preferred=safe.find(idx=>!_matchPlayerNamesByIdx(idx).some(n=>recent.has(n)));
  return {idx:preferred!=null?preferred:safe[0], consecutive:preferred==null};
}
function _fastSideLabel(m,side){
  if(!m)return side==='t1'?'A팀':'B팀';
  const t1b=currentSettings.teamMode&&m.team1A.team==='청팀';
  if(!currentSettings.teamMode)return side==='t1'?'A팀':'B팀';
  if(side==='t1')return t1b?'청':'홍';
  return t1b?'홍':'청';
}
function _fastMatchTitle(idx){
  const m=currentMatches[idx];
  if(!m)return'경기 없음';
  return `#${m.matchNumber||idx+1} · ${m.type}${m.isFiller?'(보완)':''}`;
}
function _fastMatchPlayersHtml(idx){
  const m=currentMatches[idx];
  if(!m)return'';
  return `${esc(m.team1A.name)} · ${esc(m.team1B.name)} <b>vs</b> ${esc(m.team2C.name)} · ${esc(m.team2D.name)}`;
}
function _fastAssignCourt(court){
  const pick=_fastPickNext(court);
  if(!pick)return null;
  _fastActive[String(court)]=pick.idx;
  _fastLastNote=pick.consecutive?'현재 경기 중 선수와 겹치지 않는 대안이 적어 방금 끝난 선수가 포함된 경기를 배정했습니다. 이미 뛰고 있는 선수 중복은 없습니다.':'';
  return pick;
}
function _fastFillOpenCourts(){
  if(!_fastPlayOn)return 0;
  _fastNormalize();
  let assigned=0;
  for(let c=1;c<=_fastCourtCount();c++){
    if(_fastActive[String(c)]!=null)continue;
    if(_fastAssignCourt(c))assigned++;
  }
  return assigned;
}
function _fastClearMarks(){
  document.querySelectorAll('.match-card.fast-active').forEach(el=>el.classList.remove('fast-active'));
}
function _fastMarkCards(){
  _fastClearMarks();
  if(!_fastPlayOn)return;
  Object.values(_fastActive).forEach(idx=>{
    const card=document.getElementById('mc_'+idx);
    if(card)card.classList.add('fast-active');
  });
}
function _fastStats(){
  const total=currentMatches.length;
  const done=currentMatches.filter((_,i)=>_isMatchDone(i)).length;
  _fastNormalize();
  const active=Object.keys(_fastActive).length;
  return {total,done,active,pending:Math.max(0,total-done-active)};
}
function renderFastPlayPanel(){
  const sec=document.getElementById('fastPlaySec');
  const box=document.getElementById('fastPlayBox');
  const btn=document.getElementById('fastPlayToggleBtn');
  if(!sec||!box||!btn)return;
  if(!currentMatches.length){
    sec.classList.add('hidden');
    box.innerHTML='';
    _fastClearMarks();
    return;
  }
  sec.classList.remove('hidden');
  btn.textContent=_fastPlayOn?'코트 진행 끄기':'코트 진행 켜기';
  btn.classList.toggle('danger',_fastPlayOn);
  if(!_fastPlayOn){
    _fastClearMarks();
    box.innerHTML=`<div class="fast-play-note">전체 대진표를 먼저 확인한 뒤, 코트가 끝나는 즉시 다음 안전 경기를 넣고 싶을 때만 코트 진행을 켜세요.</div>`;
    return;
  }
  if(sec.tagName==='DETAILS')sec.open=true;
  _fastNormalize();
  const st=_fastStats();
  const activeNames=[..._fastActivePlayers()].sort((a,b)=>a.localeCompare(b,'ko')).join(', ')||'없음';
  let courts='';
  for(let c=1;c<=_fastCourtCount();c++){
    const idx=_fastActive[String(c)];
    if(idx!=null&&currentMatches[idx]){
      const m=currentMatches[idx];
      courts+=`<div class="fast-court">
        <div class="fast-court-head"><span class="fast-court-title">${c}코트</span><span class="fast-court-state on">진행중</span></div>
        <div class="fast-court-body">
          <div class="fast-match-title">${esc(_fastMatchTitle(idx))}</div>
          <div class="fast-match-players">${_fastMatchPlayersHtml(idx)}</div>
          <div class="fast-court-actions">
            <button class="fast-mini-btn primary" onclick="fastFinishCourt(${c},'t1')">${esc(_fastSideLabel(m,'t1'))} 승 종료</button>
            <button class="fast-mini-btn primary" onclick="fastFinishCourt(${c},'t2')">${esc(_fastSideLabel(m,'t2'))} 승 종료</button>
          </div>
        </div>
      </div>`;
    }else{
      const next=_fastPickNext(c);
      courts+=`<div class="fast-court">
        <div class="fast-court-head"><span class="fast-court-title">${c}코트</span><span class="fast-court-state">빈 코트</span></div>
        <div class="fast-court-body">
          <div class="fast-court-empty">${next?`배정 가능: ${esc(_fastMatchTitle(next.idx))}`:'현재 진행중 선수와 겹치지 않는 대기 경기가 없습니다.'}</div>
          <div class="fast-court-actions" style="grid-template-columns:1fr;">
            <button class="fast-mini-btn" onclick="fastAssignEmptyCourt(${c})" ${next?'':'disabled'}>이 코트에 배정</button>
          </div>
        </div>
      </div>`;
    }
  }
  box.innerHTML=`
    <div class="fast-play-stats">
      <div class="fast-play-stat"><b>${st.active}</b><span>진행중</span></div>
      <div class="fast-play-stat"><b>${st.done}/${st.total}</b><span>완료</span></div>
      <div class="fast-play-stat"><b>${st.pending}</b><span>대기</span></div>
    </div>
    <div class="fast-play-note">현재 경기 중 선수: ${esc(activeNames)}<br>코트가 끝나면 이 선수들과 겹치지 않는 다음 경기만 자동 배정합니다.</div>
    ${_fastLastNote?`<div class="fast-play-note warn">${esc(_fastLastNote)}</div>`:''}
    <div class="fast-court-grid">${courts}</div>`;
  _fastMarkCards();
}
function toggleFastPlayMode(){
  if(!currentMatches.length){alert('대진표를 먼저 생성해 주세요.');return;}
  if(_fastPlayOn){
    if(!confirm('코트 진행을 끌까요?\n대진표와 입력된 승패는 그대로 유지됩니다.'))return;
    _fastPlayOn=false;
    _fastActive={};
    _fastLastFinishedPlayers=[];
    _fastLastNote='';
  }else{
    _fastStartFresh();
  }
  renderFastPlayPanel();
  scheduleSave();
  pushLiveState();
}
function fastAssignEmptyCourt(court){
  if(!_fastPlayOn)return;
  const pick=_fastAssignCourt(court);
  if(!pick){alert('현재 경기 중인 선수와 겹치지 않는 대기 경기가 없습니다. 다른 코트 종료 후 다시 시도해 주세요.');}
  renderFastPlayPanel();
  scheduleSave();
  pushLiveState();
}
function fastFinishCourt(court,side){
  if(!_fastPlayOn)return;
  _fastNormalize();
  const idx=parseInt(_fastActive[String(court)],10);
  if(!currentMatches[idx]){alert('이 코트에 진행중인 경기가 없습니다.');renderFastPlayPanel();return;}
  winOverride[idx]=side;
  _fastLastFinishedPlayers=_matchPlayerNamesByIdx(idx);
  delete _fastActive[String(court)];
  updateScores();
  _fastAssignCourt(court);
  renderFastPlayPanel();
  scheduleSave();
  pushLiveState();
}

/* ═══ SCORE ═══ */
function updateScores(){
  const isTeam=currentSettings.teamMode;
  let bW=0,bL=0,wW=0,wL=0;

  // 개인 승패 초기화
  const personalWins={}, personalLosses={};
  currentParticipants.forEach(p=>{ personalWins[p.name]=0; personalLosses[p.name]=0; });

  currentMatches.forEach((m,i)=>{
    const card=document.getElementById('mc_'+i);
    const resEl=document.getElementById('sr_'+i);
    const wb1=document.getElementById('wb1_'+i);
    const wb2=document.getElementById('wb2_'+i);
    if(!card)return;

    const wo=winOverride[i]||null;
    if(wb1)wb1.classList.toggle('active',wo==='t1');
    if(wb2)wb2.classList.toggle('active',wo==='t2');

    card.classList.remove('win-s1','win-s2');

    const t1Players=[m.team1A,m.team1B];
    const t2Players=[m.team2C,m.team2D];

    if(wo==='t1'){
      card.classList.add('win-s1');
      resEl.className='score-result sr-b';
      if(isTeam){
        const t1b=m.team1A.team==='청팀';
        resEl.textContent='';
        if(t1b){bW++;wL++;}else{wW++;bL++;}
      }else{ resEl.textContent='A팀 승'; }
      t1Players.forEach(p=>{ if(personalWins[p.name]!==undefined) personalWins[p.name]++; });
      t2Players.forEach(p=>{ if(personalLosses[p.name]!==undefined) personalLosses[p.name]++; });
    } else if(wo==='t2'){
      card.classList.add('win-s2');
      resEl.className='score-result sr-w';
      if(isTeam){
        const t1b=m.team1A.team==='청팀';
        resEl.textContent='';
        if(t1b){wW++;bL++;}else{bW++;wL++;}
      }else{ resEl.textContent='B팀 승'; }
      t2Players.forEach(p=>{ if(personalWins[p.name]!==undefined) personalWins[p.name]++; });
      t1Players.forEach(p=>{ if(personalLosses[p.name]!==undefined) personalLosses[p.name]++; });
    } else {
      resEl.textContent='';resEl.className='score-result';
    }
  });

  // 개인 승패 저장
  currentParticipants.forEach(p=>{
    p._wins = personalWins[p.name]||0;
    p._losses = personalLosses[p.name]||0;
  });

  if(isTeam){
    set('bW',bW);set('bL',bL);set('blueWins',bW);
    set('wW',wW);set('wL',wL);set('whiteWins',wW);
    const bTotal=bW+bL, wTotal=wW+wL;
    set('bRate', bTotal>0?Math.round(bW/bTotal*100)+'%':'—');
    set('wRate', wTotal>0?Math.round(wW/wTotal*100)+'%':'—');
    const banner=document.getElementById('winnerBanner');
    const bn=teamNames.blue,wn=teamNames.white;
    if(bW+wW===0){banner.innerHTML='';}
    else if(bW>wW) banner.innerHTML=`<div class="winner-banner wb-blue">🔵 ${bn} 승리! ${bW}승 ${bL}패</div>`;
    else if(wW>bW) banner.innerHTML=`<div class="winner-banner wb-white">⚪ ${wn} 승리! ${wW}승 ${wL}패</div>`;
    else banner.innerHTML=`<div class="winner-banner wb-draw">동률 (${bn} ${bW}승 · ${wn} ${wW}승)</div>`;
  }

  // 참가자 현황 테이블 갱신 (승패 컬럼 반영)
  if(_ptParticipants.length) renderPlayersTable();
  updateCurrentRoundHighlight();
  renderFastPlayPanel();
  scheduleSave();
  pushLiveState();
}

/* 팀전 중간 현황 공유 (단톡방/밴드) */
let _liveId=null, _liveOn=false;
const DAILY_LIVE_STORAGE_KEY='badminton_daily_liveId';
const LEGACY_LIVE_STORAGE_KEY='badminton_liveId';

/* 대회 고유 ID 생성 (6자리) */
function _genLiveId(){
  const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s=''; for(let i=0;i<6;i++) s+=c[Math.floor(Math.random()*c.length)];
  return s;
}

function _dailyStoredLiveId(){
  try{return localStorage.getItem(DAILY_LIVE_STORAGE_KEY)||localStorage.getItem(LEGACY_LIVE_STORAGE_KEY)||'';}catch(e){return '';}
}
function _dailySaveLiveId(id){
  try{
    if(id)localStorage.setItem(DAILY_LIVE_STORAGE_KEY,id);
    localStorage.removeItem(LEGACY_LIVE_STORAGE_KEY);
  }catch(e){}
}
function _dailyClearStoredLiveId(id){
  try{
    const dailyId=localStorage.getItem(DAILY_LIVE_STORAGE_KEY);
    if(!id||dailyId===id)localStorage.removeItem(DAILY_LIVE_STORAGE_KEY);
    const legacyId=localStorage.getItem(LEGACY_LIVE_STORAGE_KEY);
    if(!id||legacyId===id)localStorage.removeItem(LEGACY_LIVE_STORAGE_KEY);
  }catch(e){}
}
function _dailyLiveSigName(name){
  return String(name||'').replace(/\s+/g,'').trim();
}
function _dailyLiveSignatureFromMatches(matches){
  return JSON.stringify((matches||[]).map(m=>[
    m.round||0,
    m.court||0,
    String(m.type||''),
    [
      _dailyLiveSigName(m.team1A&&m.team1A.name),
      _dailyLiveSigName(m.team1B&&m.team1B.name)
    ].sort(),
    [
      _dailyLiveSigName(m.team2C&&m.team2C.name),
      _dailyLiveSigName(m.team2D&&m.team2D.name)
    ].sort()
  ]).sort((a,b)=>(a[0]-b[0])||(a[1]-b[1])||String(a[2]).localeCompare(String(b[2]))));
}
function _dailyLiveSignatureFromData(data){
  return JSON.stringify(((data&&data.matches)||[]).map(m=>[
    m.round||0,
    m.court||0,
    String(m.type||''),
    (m.t1||[]).map(_dailyLiveSigName).sort(),
    (m.t2||[]).map(_dailyLiveSigName).sort()
  ]).sort((a,b)=>(a[0]-b[0])||(a[1]-b[1])||String(a[2]).localeCompare(String(b[2]))));
}
function _dailyLiveSignature(){
  return currentMatches.length?_dailyLiveSignatureFromMatches(currentMatches):'';
}
function _dailyResetLocalLiveState(liveId){
  _dailyClearStoredLiveId(liveId);
  _liveOn=false;
  _liveId=null;
  _updateLiveUI();
}
function _dailyConfirmDetachLiveBeforeChange(actionLabel){
  const liveId=_liveId||_dailyStoredLiveId();
  if(!liveId)return true;
  if(_liveOn){
    alert(`민턴LIVE 중계 중입니다.\n\n${actionLabel} 전에 먼저 실시간 중계를 종료해 주세요.\n기존 회원 링크에 다른 대진이 섞이지 않도록 막았습니다.`);
    return false;
  }
  if(!confirm(`진행 중이던 민턴LIVE 복구 정보가 있습니다.\n\n${actionLabel}하면 기존 회원 링크와 관리자 화면이 분리됩니다.\n기존 링크 내용은 건드리지 않고, 이 화면에서만 연결을 끊을까요?`))return false;
  _dailyResetLocalLiveState(liveId);
  return true;
}
function _dailyLiveMismatchMessage(){
  return '현재 대진과 기존 민턴LIVE 링크의 대진이 다릅니다.\n\n기존 회원 링크에 다른 경기가 섞이지 않도록 송출을 막았습니다.\n기존 중계를 종료하거나, 이 대진은 새 링크로 다시 시작해 주세요.';
}
function _dailyIsTeamLiveData(data){
  if(!data||!Object.keys(data).length)return false;
  const kind=String(data.kind||data.appMode||'');
  if(kind)return kind==='teamLive';
  return data.isTeam===true
    ||data.matchMode==='free'
    ||!!data.rsvpId
    ||data.lateMode==='explicit'
    ||Array.isArray(data.members?.all);
}
function _dailyValidateLiveDataForCurrent(data){
  if(!data||!Object.keys(data).length)return true;
  if(_dailyIsTeamLiveData(data)){
    alert('저장된 LIVE ID가 팀전LIVE 링크입니다.\n민턴LIVE와 섞이지 않도록 연결을 끊었습니다.');
    _dailyResetLocalLiveState(_liveId);
    return false;
  }
  const liveSig=data.bracketKey||_dailyLiveSignatureFromData(data);
  const currentSig=_dailyLiveSignature();
  if(liveSig&&currentSig&&liveSig!==currentSig){
    alert(_dailyLiveMismatchMessage());
    _dailyResetLocalLiveState(_liveId);
    return false;
  }
  return true;
}

/* 현재 대진·스코어를 직렬화 (뷰어가 읽을 형태) */
function _buildLiveState(){
  const isTeam=!!(currentSettings && currentSettings.teamMode);
  const _s=(v)=>(v==null?'':String(v));
  const matches=currentMatches.map((m,i)=>({
    round:m.round||0, court:m.court||0, type:_s(m.type), num:m.matchNumber||(i+1),
    isFiller:!!m.isFiller,
    t1:[_s(m.team1A&&m.team1A.name), _s(m.team1B&&m.team1B.name)],
    t2:[_s(m.team2C&&m.team2C.name), _s(m.team2D&&m.team2D.name)],
    t1g:[_s(m.team1A&&m.team1A.grade), _s(m.team1B&&m.team1B.grade)],
    t2g:[_s(m.team2C&&m.team2C.grade), _s(m.team2D&&m.team2D.grade)],
    win: winOverride[i]||null
  }));
  let bW=0,wW=0;
  if(isTeam){
    bW=parseInt(document.getElementById('blueWins')?.textContent||'0',10);
    wW=parseInt(document.getElementById('whiteWins')?.textContent||'0',10);
  }
  // 현재 진행 라운드
  let cur=null;
  const byR={}; currentMatches.forEach((m,idx)=>{(byR[m.round]=byR[m.round]||[]).push(idx);});
  Object.keys(byR).map(Number).sort((a,b)=>a-b).forEach(r=>{
    if(cur===null && !byR[r].every(idx=>_isMatchDone(idx))) cur=r;
  });
  const bn2=teamNames.blue||'청 팀', wn2=teamNames.white||'홍 팀';
  // 팀원 명단 (뷰어에서 팀원 리스트 표시용)
  // 이름+급수+성별 함께 전송 (뷰어 명단 표시용)
  // 단장/부단장 이름 추출
  const _leaderBlue=captains?.blue?.leader||null;
  const _subBlue=captains?.blue?.sub||null;
  const _leaderWhite=captains?.white?.leader||null;
  const _subWhite=captains?.white?.sub||null;
  const membersBlue=isTeam?(teamAssignment?.blue||[]).map(p=>({
    n:p.name||'',l:p.level||0,g:p.gender||'',
    isLeader:p.name===_leaderBlue, isSub:p.name===_subBlue
  })):[];
  const membersRed=isTeam?(teamAssignment?.white||[]).map(p=>({
    n:p.name||'',l:p.level||0,g:p.gender||'',
    isLeader:p.name===_leaderWhite, isSub:p.name===_subWhite
  })):[];
  return {
    kind:'dailyLive',
    appMode:'dailyLive',
    title: (isTeam? (bn2+' vs '+wn2):'콕매치 대진표'),
    bracketKey:_dailyLiveSignature(),
    members: {blue:membersBlue, red:membersRed},
    isTeam: !!isTeam, teamBlue:bn2, teamWhite:wn2,
    blueWins:bW||0, whiteWins:wW||0,
    currentRound: (cur==null?0:cur), matches,
    pointSystem: (typeof _pointSystem!=='undefined'?_pointSystem:25),
    gamesPerPlayer: (currentSettings&&currentSettings.gamesPerPlayer)||4,
    fastPlay:{on:!!_fastPlayOn,active:{..._fastActive}},
    updatedAt: Date.now()
  };
}

/* 실시간 중계 시작 */
async function startLiveBroadcast(){
  if(!currentMatches.length){ alert('대진표를 먼저 생성하세요.'); return; }
  if(!_fbInit()){ alert('실시간 서버 연결에 실패했어요. 네트워크를 확인해주세요.'); return; }
  if(!_liveId) _liveId=_genLiveId();
  // 오래된 중계 데이터 자동 정리 (48시간 경과분 삭제) — 새 중계 시작하는 김에 청소
  _cleanupOldLive();
  try{
    const liveRef=_fbDb.ref('live/'+_liveId);
    const prev=await liveRef.once('value').catch(()=>null);
    const prevData=(prev&&prev.exists())?(prev.val()||{}):{};
    if(!_dailyValidateLiveDataForCurrent(prevData))return;
    _liveOn=true;
    await liveRef.set(_buildLiveState());
  }catch(e){ alert('업로드 실패: '+e.message); _liveOn=false; return; }
  await rsvpPushEventState();
  _dailySaveLiveId(_liveId);
  _updateLiveUI();
}

/* 앱 재시작 시 중계 자동 재연결 */
async function _tryResumeLive(){
  if(_liveOn) return; // 이미 중계 중
  const savedId=_dailyStoredLiveId();
  if(!savedId) return;
  const savedFromDailyKey=(()=>{try{return localStorage.getItem(DAILY_LIVE_STORAGE_KEY)===savedId;}catch(e){return false;}})();
  if(!_fbInit()) return;
  try{
    const snap=await _fbDb.ref('live/'+savedId).once('value');
    if(!snap.exists()){
      _dailyClearStoredLiveId(savedId);
      return;
    }
    const data=snap.val();
    if(_dailyIsTeamLiveData(data)){
      if(savedFromDailyKey)_dailyClearStoredLiveId(savedId);
      return;
    }
    _liveId=savedId;
    if(!_dailyValidateLiveDataForCurrent(data))return;
    _liveId=null;
    const age=Date.now()-(data.updatedAt||0);
    // 48시간 초과 or 데이터 없으면 무시
    if(age>48*60*60*1000){ _dailyClearStoredLiveId(savedId); return; }
    // 사용자에게 확인
    const mins=Math.floor(age/60000);
    const timeStr=mins<60?`${mins}분 전`:`${Math.floor(mins/60)}시간 ${mins%60}분 전`;
    if(confirm(`📡 실시간 중계가 ${timeStr}에 끊겼어요.

이어서 중계를 재개할까요?`)){
      _liveId=savedId;
      _liveOn=true;
      _updateLiveUI();

      // Firebase의 win 데이터로 winOverride 복원 (앱 재시작으로 초기화됐어도 승패 유지)
      // round+court 기준으로 win 매핑 (인덱스 불일치 방지)
      const fbMatches=data.matches||[];
      Object.keys(winOverride).forEach(k=>delete winOverride[k]);
      const fbWinMap={};
      fbMatches.forEach(fm=>{ if(fm.win) fbWinMap[`${fm.round}_${fm.court}`]=fm.win; });
      currentMatches.forEach((m,i)=>{
        const key=`${m.round||0}_${m.court||0}`;
        if(fbWinMap[key]) winOverride[i]=fbWinMap[key];
      });
      if(currentMatches.length) renderResults(currentMatches,currentParticipants,currentSettings);

      await pushLiveState(); // 복원된 승패로 Firebase 업데이트
      await rsvpPushEventState();
      const base=location.origin+location.pathname.replace(/[^/]*$/,'');
      const url=base+'view.html?id='+_liveId;
      alert(`✅ 중계 재개됐어요!
링크: ${url}`);
    } else {
      _dailyClearStoredLiveId(savedId);
    }
  }catch(e){ /* 재연결 실패는 조용히 무시 */ }
}

/* 오래된 실시간 데이터 자동 정리: updatedAt이 48시간 지난 중계 노드 삭제.
   별도 서버 없이, 새 중계를 시작할 때마다 한 번씩 청소한다. */
async function _cleanupOldLive(){
  if(!_fbDb) return;
  const TTL=48*60*60*1000; // 48시간(ms)
  const cutoff=Date.now()-TTL;
  try{
    const snap=await _fbDb.ref('live').once('value');
    const all=snap.val()||{};
    const dead=[];
    for(const id in all){
      const kind=all[id]&&all[id].kind;
      if(kind==='dailyCheckin'||kind==='tournamentRsvp')continue;
      const u=all[id] && all[id].updatedAt;
      // updatedAt이 없거나(구버전) 48시간 지난 것 삭제. 단, 지금 내 중계는 제외.
      if(id!==_liveId && (!u || u<cutoff)) dead.push(id);
    }
    await Promise.all(dead.map(id=>_fbDb.ref('live/'+id).remove().catch(()=>{})));
  }catch(e){ /* 정리는 실패해도 중계엔 영향 없음 */ }
}

/* 실시간 상태 갱신 (점수 입력 시 자동 호출) */
async function pushLiveState(){
  if(!_liveOn || !_liveId || !_fbDb) return;
  try{ await _fbDb.ref('live/'+_liveId).set(_buildLiveState()); }catch(e){ /* 조용히 무시 */ }
}

function _showCopyFallback(label,text){
  alert(label+'\n\n'+text);
}

/* 실시간 중계 종료 */
async function stopLiveBroadcast(){
  if(!_liveId || !_fbDb){ _liveOn=false; _updateLiveUI(); return; }
  if(!confirm('실시간 중계를 종료할까요?\n링크로 접속한 사람들이 더 이상 볼 수 없게 됩니다.')) return;
  try{ await _fbDb.ref('live/'+_liveId).remove(); }catch(e){}
  _dailyClearStoredLiveId(_liveId);
  _liveOn=false; _liveId=null;
  await rsvpPushEventState();
  _updateLiveUI();
  alert('실시간 중계를 종료했어요.');
}

/* 중계 버튼 UI 갱신 */
function _updateLiveUI(){
  const btn=document.getElementById('liveBtn');
  if(!btn) return;
  if(_liveOn){ btn.classList.add('on'); btn.innerHTML='🔴 실시간 중계 중'; }
  else { btn.classList.remove('on'); btn.innerHTML='📡 실시간 중계'; }
}

/* 실시간 버튼 클릭: 켜져있으면 종료, 꺼져있으면 시작 */
function onLiveBtnClick(){
  if(_liveOn){
    stopLiveBroadcast();
  } else {
    startLiveBroadcast();
  }
}

async function shareTeamStatus(){
  if(!currentSettings || !currentSettings.teamMode){
    alert('팀전 모드일 때 사용할 수 있어요.');
    return;
  }
  const bn=teamNames.blue||'청 팀', wn=teamNames.white||'홍 팀';
  const bW=parseInt(document.getElementById('blueWins')?.textContent||'0',10);
  const wW=parseInt(document.getElementById('whiteWins')?.textContent||'0',10);
  // 라운드 진행 현황
  let totalR=0, doneR=0;
  if(currentMatches.length){
    const byR={};
    currentMatches.forEach((m,idx)=>{ (byR[m.round]=byR[m.round]||[]).push(idx); });
    const rns=Object.keys(byR);
    totalR=rns.length;
    doneR=rns.filter(r=>byR[r].every(idx=>_isMatchDone(idx))).length;
  }
  let lead='';
  if(bW>wW) lead=`\n🔵 ${bn} ${bW-wW}점 차로 앞서는 중!`;
  else if(wW>bW) lead=`\n⚪ ${wn} ${wW-bW}점 차로 앞서는 중!`;
  else lead='\n⚖️ 동점! 접전 중';
  const text=`🏸 콕매치 팀전 현황\n\n🔵 ${bn}  ${bW}승\n⚪ ${wn}  ${wW}승`
    + (totalR? `\n\n📊 ${totalR}라운드 중 ${doneR}라운드 완료`:'')
    + lead;
  try{
    if(navigator.share){
      await navigator.share({text, title:'콕매치 팀전 현황'});
    } else if(navigator.clipboard){
      await navigator.clipboard.writeText(text);
      alert('현황을 복사했어요. 단톡방에 붙여넣기 하세요!');
    } else {
      _showCopyFallback('아래 내용을 공유하세요:', text);
    }
  }catch(e){
    if(e.name!=='AbortError'){
      try{ await navigator.clipboard.writeText(text); alert('현황을 복사했어요!'); }
      catch(_){ _showCopyFallback('아래 내용을 공유하세요:', text); }
    }
  }
}


/* 현재 진행 라운드 하이라이트 갱신 (점수 입력에 따라 이동) */
function updateCurrentRoundHighlight(){
  if(!currentMatches.length) return;
  const byRound={};
  currentMatches.forEach(m=>{if(!byRound[m.round])byRound[m.round]=[];byRound[m.round].push(m);});
  const roundNums=Object.keys(byRound).map(Number).sort((a,b)=>a-b);
  let cur=null;
  for(const rn of roundNums){
    const allDone=byRound[rn].every(m=>_isMatchDone(currentMatches.indexOf(m)));
    if(!allDone){ cur=rn; break; }
  }
  window._currentPlayRound=cur;
  // 모든 블록에서 강조 제거 후 현재에만 부여
  document.querySelectorAll('.round-block').forEach(el=>{
    el.classList.remove('round-current');
    const nb=el.querySelector('.round-now-badge'); if(nb) nb.remove();
  });
  const goBtn=document.getElementById('gotoCurrentBtn');
  if(cur!=null){
    const block=document.getElementById('roundBlock_'+cur);
    if(block){
      block.classList.add('round-current');
      const header=block.querySelector('.round-header');
      const badge=block.querySelector('.round-badge');
      if(header && badge && !header.querySelector('.round-now-badge')){
        const span=document.createElement('span');
        span.className='round-now-badge'; span.textContent='● 진행중';
        badge.insertAdjacentElement('afterend', span);
      }
    }
    if(goBtn){ goBtn.style.display='flex'; goBtn.querySelector('.gcb-round').textContent='라운드 '+cur; }
  } else {
    // 전부 완료
    if(goBtn) goBtn.style.display='none';
  }
}

/* 현재 진행 라운드로 스크롤 이동 */
function scrollToCurrentRound(){
  const cur=window._currentPlayRound;
  if(cur==null) return;
  const block=document.getElementById('roundBlock_'+cur);
  if(block) block.scrollIntoView({behavior:'smooth',block:'start'});
}


function _qualityAssessment(matches,participants,settings){
  if(!matches.length||!participants.length)return null;
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const gpp=settings.gamesPerPlayer||4;
  const avgLD=matches.reduce((s,m)=>s+(m.levelDiff||0),0)/matches.length;
  const spikes=matches.filter(m=>(m.levelDiff||0)>=3);
  const maxLD=Math.max(...matches.map(m=>m.levelDiff||0));
  const counts={};participants.forEach(p=>counts[p.name]=0);
  matches.forEach(m=>[m.team1A,m.team1B,m.team2C,m.team2D].forEach(p=>{
    if(p&&counts[p.name]!==undefined)counts[p.name]++;
  }));
  const pGoal=p=>p._goal!=null?p._goal:gpp;
  const under=participants.filter(p=>counts[p.name]<pGoal(p));
  const over=participants.filter(p=>counts[p.name]>pGoal(p));
  const _slotStats=_participationSlotStats(participants,settings,counts);
  const {underSlots,overSlots,totalGoalSlots,minimumMatches,minimumOver,
    parityAdjustment,avoidableUnderSlots,avoidableOverSlots}= _slotStats;
  const extraMatchCount=Math.max(0,matches.length-minimumMatches);
  const rates=participants.map(p=>counts[p.name]/pGoal(p));
  const avgRate=rates.reduce((a,b)=>a+b,0)/rates.length;
  const variance=rates.reduce((s,v)=>s+(v-avgRate)**2,0)/rates.length;

  const nPlayers=participants.length;
  let excessConsec=0,totalSlots=0;
  const excessNames={};
  const maxRound=Math.max(...matches.map(m=>m.round));
  for(let r=2;r<=maxRound;r++){
    const prev=new Set(matches.filter(m=>m.round===r-1).flatMap(m=>[m.team1A.name,m.team1B.name,m.team2C.name,m.team2D.name]));
    const cur=matches.filter(m=>m.round===r).flatMap(m=>[m.team1A.name,m.team1B.name,m.team2C.name,m.team2D.name]);
    const repeated=cur.filter(n=>prev.has(n));
    const unavoidable=Math.max(0,cur.length-(nPlayers-cur.length));
    const rExcess=Math.max(0,repeated.length-unavoidable);
    excessConsec+=rExcess;totalSlots+=cur.length;
    repeated.slice(-rExcess).forEach(n=>excessNames[n]=(excessNames[n]||0)+1);
  }
  const excessRatio=totalSlots?excessConsec/totalSlots:0;

  const partnerCounts={},sameFourCounts={},exactMatchCounts={};
  matches.forEach(m=>{
    [[m.team1A,m.team1B],[m.team2C,m.team2D]].forEach(pair=>{
      if(pair[0].partnerName===pair[1].name||pair[1].partnerName===pair[0].name)return;
      const k=[pair[0].name,pair[1].name].sort().join('|');
      partnerCounts[k]=(partnerCounts[k]||0)+1;
    });
    const t1=[m.team1A.name,m.team1B.name].sort();
    const t2=[m.team2C.name,m.team2D.name].sort();
    const four=[...t1,...t2].sort().join('|');
    const exact=[t1.join('|'),t2.join('|')].sort().join(' VS ');
    sameFourCounts[four]=(sameFourCounts[four]||0)+1;
    exactMatchCounts[exact]=(exactMatchCounts[exact]||0)+1;
  });
  const pcVals=Object.values(partnerCounts);
  const partner2=pcVals.filter(c=>c===2).length;
  const partner3=pcVals.filter(c=>c===3).length;
  const partner4=pcVals.filter(c=>c>=4).length;
  const possiblePairs=nPlayers*(nPlayers-1)/2;
  const partnerEncounters=matches.length*2;
  const partnerExcess=pcVals.reduce((s,c)=>s+Math.max(0,c-1),0);
  const unavoidablePartnerExcess=Math.max(0,partnerEncounters-possiblePairs);
  const avoidablePartnerExcess=Math.max(0,partnerExcess-unavoidablePartnerExcess);
  const sameFourRepeats=Object.values(sameFourCounts).reduce((s,c)=>s+Math.max(0,c-1),0);
  const exactMatchRepeats=Object.values(exactMatchCounts).reduce((s,c)=>s+Math.max(0,c-1),0);
  const possibleFourGroups=nPlayers>=4?nPlayers*(nPlayers-1)*(nPlayers-2)*(nPlayers-3)/24:0;
  const possibleExactMatches=possibleFourGroups*3;
  const unavoidableSameFour=Math.max(0,matches.length-possibleFourGroups);
  const unavoidableExact=Math.max(0,matches.length-possibleExactMatches);
  const avoidableSameFour=Math.max(0,sameFourRepeats-unavoidableSameFour);
  const avoidableExact=Math.max(0,exactMatchRepeats-unavoidableExact);
  const fillers=matches.filter(m=>m.isFiller);
  const fillerRate=fillers.length/matches.length;

  const genderErr=matches.reduce((s,m)=>s+_matchGenderErrorCount(m),0);
  const adjustments=matches.filter(m=>m.type==='보정');

  const sBalance=clamp(30-avgLD/1.5*22-spikes.length*2-Math.max(0,maxLD-2)*2,0,30);
  const sFair=clamp(25-avoidableUnderSlots*6-avoidableOverSlots*2-Math.min(4,variance*20),0,25);
  const sPartner=clamp(15-avoidablePartnerExcess*.5
    -(avoidablePartnerExcess>0?partner3*2+partner4*5:0),0,15);
  // 상대 다양성은 개인 간 만남이 아니라 실제 4인 경기의 재대결 여부로 평가한다.
  const sOpponent=clamp(10-avoidableSameFour*3-avoidableExact*3,0,10);
  const sInterval=clamp(10*(1-excessRatio/.2),0,10);
  const extraRate=avoidableOverSlots/Math.max(1,totalGoalSlots);
  const extraMatchRate=extraMatchCount/Math.max(1,minimumMatches);
  const sEfficiency=clamp(5*(1-Math.max(extraMatchRate/.2,extraRate/.1)),0,5);
  const sValid=genderErr===0?5:Math.max(0,5-genderErr*2);
  let total=Math.round(sBalance+sFair+sPartner+sOpponent+sInterval+sEfficiency+sValid);
  if((partner4>0&&avoidablePartnerExcess>0)||avoidableExact>0)total=Math.min(total,84);
  else if(avoidableSameFour>0)total=Math.min(total,94);
  else if(partner3>0&&avoidablePartnerExcess>0)total=Math.min(total,94);
  if(avoidableUnderSlots>0||genderErr>0)total=Math.min(total,89);
  const grade=total>=95?'S':total>=85?'A':total>=75?'B':total>=65?'C':'D';
  const gradeLabel={S:'완벽',A:'우수',B:'양호',C:'보통',D:'재생성 권장'}[grade];
  return {gpp,avgLD,spikes,maxLD,counts,pGoal,under,over,underSlots,overSlots,
    minimumMatches,minimumOver,parityAdjustment,avoidableUnderSlots,avoidableOverSlots,extraMatchCount,
    excessConsec,excessNames,excessRatio,partner2,partner3,partner4,
    sameFourRepeats,exactMatchRepeats,avoidableSameFour,avoidableExact,
    unavoidableSameFour,unavoidableExact,avoidablePartnerExcess,
    unavoidablePartnerExcess,fillers,fillerRate,adjustments,genderErr,
    sBalance,sFair,sPartner,sOpponent,sInterval,sEfficiency,sValid,total,grade,gradeLabel};
}

/* ═══ 대진 품질 대시보드 ═══ */
function renderQualityDashboard(matches,participants,settings){
  const el=document.getElementById('qualDash');
  if(!el) return;
  if(!matches.length){ el.innerHTML=''; return; }
  const q=_qualityAssessment(matches,participants,settings);
  const {avgLD,spikes,maxLD,counts,pGoal:_pGoal,under,over,underSlots,overSlots,
    minimumMatches,minimumOver,parityAdjustment,avoidableUnderSlots,avoidableOverSlots,extraMatchCount,
    excessConsec,excessNames,excessRatio,partner2,partner3,partner4,
    sameFourRepeats,exactMatchRepeats,avoidableSameFour,avoidableExact,
    unavoidableSameFour,unavoidableExact,avoidablePartnerExcess,
    unavoidablePartnerExcess,fillers,adjustments,genderErr,
    sBalance,sFair,sPartner,sOpponent,sInterval,sEfficiency,sValid,total,grade,gradeLabel}=q;

  // ── 헬퍼 ──
  function barColor(pct){return pct>=0.85?'#3a8c5c':pct>=0.65?'#d48a10':'#c94040';}
  function rowCls(pct){return pct>=0.85?'qd-row-good':pct>=0.65?'qd-row-warn':'qd-row-bad';}
  function icon(pct){return pct>=0.85?'✅':pct>=0.65?'⚠️':'❌';}
  function scoreTag(score,max){
    if(score===null) return `<span class="qd-pts-small" style="color:var(--dim);">참고</span>`;
    return `<span class="qd-pts-small">${Math.round(score)}/${max}</span>`;
  }
  function barHtml(pct){
    return `<div class="qd-bar-wrap"><div class="qd-bar-fill" style="width:${Math.round(pct*100)}%;background:${barColor(pct)};"></div></div>`;
  }
  const escText=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // ── 항목 정의 ──
  const rows=[
    (()=>{
      const pct=sBalance/30;
      let detail=`평균 실력차 ${avgLD.toFixed(2)} · 최대 ${maxLD.toFixed(1)}`;
      if(spikes.length) detail+=` · 실력차 큰 경기(3+) ${spikes.length}개`;
      else detail+=' · 튀는 경기 없음';
      return {label:'경기 실력 균형',detail,score:sBalance,max:30,pct};
    })(),
    (()=>{
      const pct=sFair/25;
      let detail=under.length===0
        ?`전원 목표달성 · ${participants.length}명`
        :avoidableUnderSlots===0&&parityAdjustment>0
          ?`성비상 최소 조정 — ${under.map(p=>`${p.name}(${counts[p.name]}/${_pGoal(p)})`).join(', ')}`
          :`미달 ${under.length}명 — ${under.map(p=>`${p.name}(${counts[p.name]}/${_pGoal(p)})`).join(', ')}`;
      if(over.length){
        detail+=avoidableOverSlots===0
          ?` · 인원수상 최소 초과 ${over.length}명`
          :` · 추가 초과 ${over.length}명(${avoidableOverSlots}게임분)`;
      }
      return {label:'출전 횟수 공정성',detail,score:sFair,max:25,pct};
    })(),
    (()=>{
      const pct=sPartner/15;
      let detail=partner4?`같은 파트너 4회+ ${partner4}쌍`
        :partner3?`같은 파트너 3회 ${partner3}쌍 · 2회 ${partner2}쌍`
        :partner2?`같은 파트너 2회 ${partner2}쌍`:'모든 일반 파트너 1회';
      if(unavoidablePartnerExcess>0&&avoidablePartnerExcess===0)detail+=' · 인원상 반복 불가피';
      return {label:'파트너 다양성',detail,score:sPartner,max:15,pct};
    })(),
    (()=>{
      const pct=sOpponent/10;
      let detail=avoidableExact>0?`팀 구성까지 같은 경기 ${avoidableExact}회 반복`
        :avoidableSameFour>0?`같은 4명이 다시 경기 ${avoidableSameFour}회`
        :'같은 4명의 재경기 없음';
      if((unavoidableSameFour>0||unavoidableExact>0)&&avoidableSameFour===0&&avoidableExact===0)
        detail+=' · 인원상 반복은 감점 제외';
      return {label:'재대결 다양성',detail,score:sOpponent,max:10,pct};
    })(),
    (()=>{
      const pct=sInterval/10;
      const ns=Object.keys(excessNames).slice(0,3);
      const detail=excessConsec===0?'회피 가능한 연속 출전 없음'
        :`회피 가능한 연속 출전 ${excessConsec}건 · ${ns.join(', ')}${Object.keys(excessNames).length>3?' 외':''}`;
      return {label:'휴식·대진 간격',detail,score:sInterval,max:10,pct};
    })(),
    (()=>{
      const pct=sEfficiency/5;
      const detail=extraMatchCount===0&&avoidableOverSlots===0
        ?(minimumOver>0?`최소 ${minimumMatches}게임 · 불가피한 초과 ${minimumOver}명`:'추가 경기·초과 출전 없음')
        :`추가 경기 ${extraMatchCount}개 · 추가 초과 ${avoidableOverSlots}게임분`;
      return {label:'일정 효율성',detail,score:sEfficiency,max:5,pct};
    })(),
    (()=>{
      const pct=sValid/5;
      const detail=genderErr===0
        ?(adjustments.length?`종목 조건 정상 · 성비 보정 ${adjustments.length}경기`:'종목 성별 조건 정상')
        :'종목 성별 오류 '+genderErr+'건';
      return {label:'설정 준수',detail,score:sValid,max:5,pct};
    })(),
  ];

  // ── 헤더 요약 ──
  const issues=rows.filter(r=>r.score!==null&&r.pct<0.65);
  const warns=rows.filter(r=>r.score!==null&&r.pct>=0.65&&r.pct<0.85);
  let subText;
  if(issues.length===0&&warns.length===0) subText='모든 항목 양호 · 좋은 대진입니다';
  else if(issues.length>0) subText=issues.map(r=>r.label).join(', ')+' 개선 필요';
  else subText=warns.map(r=>r.label).join(', ')+' 확인 권장';

  const fixedPairs=[];
  const seenPairs=new Set();
  participants.forEach(p=>{
    if(!p.partnerName)return;
    const k=[p.name,p.partnerName].sort().join('|');
    if(seenPairs.has(k))return;
    seenPairs.add(k);
    fixedPairs.push([p.name,p.partnerName]);
  });
  const fixedStats=fixedPairs.map(([a,b])=>{
    const together=matches.filter(m=>[[m.team1A,m.team1B],[m.team2C,m.team2D]]
      .some(t=>t.some(p=>p.name===a)&&t.some(p=>p.name===b))).length;
    const separate=matches.filter(m=>
      [m.team1A,m.team1B,m.team2C,m.team2D].some(p=>p.name===a||p.name===b) &&
      ![[m.team1A,m.team1B],[m.team2C,m.team2D]].some(t=>t.some(p=>p.name===a)&&t.some(p=>p.name===b))
    ).length;
    return {a,b,together,separate};
  });

  const blocking=[];
  if(genderErr>0)blocking.push('종목 성별 오류');
  if(avoidableUnderSlots>0)blocking.push('목표 미달');
  if(avoidableExact>0)blocking.push('똑같은 경기 반복');
  if(fillers.length>2)blocking.push('보완게임 과다');
  const caution=[];
  if(avoidableSameFour>0)caution.push('같은 4명 재경기');
  if(excessConsec>0)caution.push(`연속 출전 ${excessConsec}건`);
  if(partner3>0||partner4>0)caution.push('파트너 반복 높음');
  if(total<85)caution.push('품질점수 낮음');
  const splitFixed=fixedStats.filter(x=>x.separate>0);
  if(splitFixed.length)caution.push('P 파트너 분리 배정');

  let opClass='ok',opTitle='✅ 바로 진행 가능',opSub='큰 운영 리스크가 없습니다.';
  if(blocking.length){
    opClass='bad';opTitle='❌ 재생성 권장';opSub=blocking.join(', ')+' 확인이 필요합니다.';
  }else if(caution.length||total<90){
    opClass='warn';opTitle='⚠ 확인 후 진행';opSub=(caution.length?caution.join(', '):'일부 항목')+'만 확인하면 됩니다.';
  }
  const chip=(label,cls)=>`<span class="op-chip ${cls}">${label}</span>`;
  const opChips=[
    chip(genderErr===0?'종목 정상':'종목 오류 '+genderErr+'건',genderErr===0?'ok':'bad'),
    adjustments.length?chip(`성비보정 ${adjustments.length}경기`,'warn'):'',
    chip(under.length===0?'목표 달성':'미달 '+under.length+'명',avoidableUnderSlots===0?'ok':'bad'),
    chip(avoidableOverSlots===0?(over.length?`최소 초과 ${over.length}명`:'초과 없음'):`추가 초과 ${avoidableOverSlots}`,avoidableOverSlots===0?'ok':'warn'),
    chip(avoidableExact===0&&avoidableSameFour===0?'재경기 없음':`재경기 ${avoidableSameFour+avoidableExact}건`,avoidableExact===0&&avoidableSameFour===0?'ok':'warn'),
    chip(excessConsec===0?'연속 없음':`연속 ${excessConsec}건`,excessConsec===0?'ok':'warn'),
    fixedPairs.length?chip(`P 파트너 ${fixedPairs.length}쌍`,splitFixed.length?'warn':'ok'):''
  ].filter(Boolean).join('');
  const issueItems=[];
  if(over.length&&avoidableOverSlots===0)issueItems.push(`인원 구조상 ${over.length}명 초과 출전은 감점하지 않았습니다.`);
  if(parityAdjustment>0)issueItems.push('성비상 1게임 차이는 불가피한 최소 조정으로 처리했습니다.');
  if(adjustments.length)issueItems.push(`팀 성비 때문에 보정경기 ${adjustments.length}개를 사용했습니다. 목표 게임 수 공정성을 맞추기 위한 예외 조합입니다.`);
  if(excessConsec>0){
    const ns=Object.keys(excessNames).slice(0,4).map(escText).join(', ');
    issueItems.push(`연속 출전 대상: ${ns}${Object.keys(excessNames).length>4?' 외':''}`);
  }
  if(fixedStats.length){
    fixedStats.forEach(x=>{
      issueItems.push(`P 파트너 ${escText(x.a)}·${escText(x.b)}: 함께 ${x.together}게임${x.separate?`, 분리 ${x.separate}게임`:''}`);
    });
    issueItems.push('P 파트너는 강한 조건이라 전체 품질점수가 조금 낮아질 수 있습니다.');
  }
  if(!issueItems.length)issueItems.push('특이사항 없음: 바로 코트 진행해도 됩니다.');
  const issueHtml=issueItems.map(x=>`<div class="op-issue">${x}</div>`).join('');

  el.innerHTML=`
    <div class="qd-header">
      <div class="qd-badge qd-${grade}">
        <span class="qd-badge-pts">${total}</span>
        <span class="qd-badge-grade">${grade} · ${gradeLabel}</span>
      </div>
      <div class="qd-meta">
        <div class="qd-meta-title">🎯 대진 품질 점검</div>
        <div class="qd-meta-sub">${subText}</div>
      </div>
    </div>
    <div class="op-check">
      <div class="op-status ${opClass}">
        <div class="op-status-main">${opTitle}</div>
        <div class="op-status-sub">${opSub}</div>
      </div>
      <div class="op-chip-row">${opChips}</div>
    </div>
    <div class="op-issues">
      <div class="op-issues-title">실전 특이사항</div>
      <div class="op-issue-list">${issueHtml}</div>
    </div>
    <div class="qd-rows">
      ${rows.map(row=>`
        <div class="qd-row ${rowCls(row.pct)}">
          <span class="qd-row-icon">${icon(row.pct)}</span>
          <div class="qd-row-body">
            <div class="qd-row-label">${row.label}${row.max
              ?` <span style="font-size:.6rem;color:var(--dim);font-weight:400;">(${row.max}점)</span>`
              :' <span style="font-size:.6rem;color:var(--dim);font-weight:400;">(참고)</span>'}</div>
            <div class="qd-row-detail">${row.detail}</div>
          </div>
          <div class="qd-row-score">
            ${scoreTag(row.score,row.max)}
            ${barHtml(row.pct)}
          </div>
        </div>`).join('')}
    </div>
    <div class="qd-footer">
      <div style="display:flex;gap:8px;">
        <button class="btn btn-gen" style="flex:1;padding:10px;font-size:.88rem;" onclick="reshuffleMatches()">🎲 재배정 (최적 대진 자동 선택)</button>
        <button id="undoBtn" class="btn btn-undo" style="padding:10px 14px;font-size:.88rem;flex-shrink:0;" onclick="undoAction()" title="되돌릴 내역 없음" disabled>↩ 되돌리기</button>
      </div>
    </div>
    ${total<=82?`<div class="qd-hint">💡 ${total<=70?'재생성을 권장합니다. 재배정 버튼을 눌러보세요.':'점수가 낮은 항목을 확인하고 필요 시 재배정하세요.'}</div>`:''}`;
}


/* ═══ RENDER RESULTS ═══ */
function renderResults(matches,participants,settings){
  if(typeof rsvpPushEventState==='function')rsvpPushEventState();
  const isTeam=settings.teamMode;
  const wD=matches.filter(m=>m.type==='여복').length;
  const mD=matches.filter(m=>m.type==='남복').length;
  const xD=matches.filter(m=>m.type==='혼복').length;
  const aD=matches.filter(m=>m.type==='보정').length;
  const rounds=matches.length?Math.max(...matches.map(m=>m.round)):0;
  const avgLD=matches.length?matches.reduce((s,m)=>s+m.levelDiff,0)/matches.length:0;
  const unmet=participants.filter(p=>p.gamesPlayed<(p._goal!=null?p._goal:settings.gamesPerPlayer));
  const fillerCnt=matches.filter(m=>m.isFiller).length;

  // 예상 시간 계산 (점수제별 경기당 시간 반영)
  const perGameMin=_POINT_MINUTES[_pointSystem]||15;
  const totalMins=rounds*perGameMin;
  const fmtMin=(mm)=>mm>=60?`${Math.floor(mm/60)}시간 ${mm%60?mm%60+'분':''}`.trim():mm+'분';
  const timeStr=fmtMin(totalMins);
  // 점수제 비교 (다른 점수제면 얼마나 걸리는지) — 툴팁/부가표시용
  const altText=[25,21,15].filter(p=>p!==_pointSystem)
    .map(p=>`${p}점 ${fmtMin(rounds*_POINT_MINUTES[p])}`).join(' · ');

  const sumItems=[
    ['총 경기',matches.length,'sv-bl'],
    ['라운드',rounds,'sv-bl'],
    [`예상 시간<span class="sv-sub">${_pointSystem}점 기준</span>`,timeStr,'sv-time'],
    ['여복',wD,'sv-wo'],['남복',mD,'sv-me'],['혼복',xD,'sv-mx'],
  ];
  if(aD)sumItems.push(['보정',aD,'sv-ac']);
  document.getElementById('sumGrid').innerHTML=sumItems
    .map(([l,v,c])=>`<div class="sum-box"><div class="sum-box-l">${l}</div><div class="sum-box-v ${c}" style="${String(v).length>4?'font-size:.9rem':''}">${v}</div></div>`).join('');

  // 점수제 비교 안내 (코트 부족 시 의사결정 도움)
  const cmpEl=document.getElementById('timeCompare');
  if(cmpEl) cmpEl.innerHTML=`⏱ 다른 점수제로 진행 시: ${altText}`;

  document.getElementById('statRow').innerHTML=[
    `<div class="stat-pill">목표달성 <b>${participants.length-unmet.length}/${participants.length}명</b></div>`,
    `<div class="stat-pill">여복<b>${wD}</b></div>`,
    `<div class="stat-pill">남복<b>${mD}</b></div>`,
    `<div class="stat-pill">혼복<b>${xD}</b></div>`,
    aD?`<div class="stat-pill">보정<b>${aD}</b></div>`:'',
    fillerCnt?`<div class="stat-pill">보완<b>${fillerCnt}</b></div>`:'',
    unmet.length?`<div class="stat-pill" style="color:var(--red)">미달 <b>${unmet.map(p=>p.name).join(', ')}</b></div>`:''
  ].join('');

  renderQualityDashboard(matches,participants,settings);
  // 품질 패널 렌더 후 되돌리기 버튼 상태 동기화 (동적 생성된 버튼이 disabled로 초기화되기 때문)
  _updateUndoBtn();
  // 스코어보드: 팀 모드일 때만 표시
  document.getElementById('scoreboardSec').classList.toggle('hidden',!isTeam);
  // sync team names to scoreboard inputs
  document.getElementById('sbBlueName').value=teamNames.blue;
  document.getElementById('sbWhiteName').value=teamNames.white;

  // 연속 출전 경고 제거 (품질점검 "대진 간격" 항목으로 충분히 확인 가능)
  const _consecWarning={};

  // Build bracket
  const byRound={};
  matches.forEach(m=>{if(!byRound[m.round])byRound[m.round]=[];byRound[m.round].push(m);});

  // 현재 진행 라운드 = 아직 결과가 다 입력되지 않은 첫 라운드
  const _roundNums=Object.keys(byRound).map(Number).sort((a,b)=>a-b);
  let _currentPlayRound=null;
  for(const rn of _roundNums){
    const allDone=byRound[rn].every(m=>_isMatchDone(matches.indexOf(m)));
    if(!allDone){ _currentPlayRound=rn; break; }
  }
  // 전부 완료면 마지막 라운드를 현재로(완료 상태)
  const _allFinished = _currentPlayRound===null;
  window._currentPlayRound = _currentPlayRound; // 플로팅 버튼에서 참조

  const bracketHtml=Object.keys(byRound).sort((a,b)=>a-b).map(r=>{
    const ms=byRound[r];
    const cards=ms.map(m=>{
      const idx=matches.indexOf(m);
      const tc=m.type==='여복'?'women':m.type==='남복'?'men':m.type==='보정'?'adjust':'mixed';
      const tbc=m.type==='여복'?'tb-w':m.type==='남복'?'tb-m':m.type==='보정'?'tb-a':'tb-x';
      const ts=m.type+(m.isFiller?'(보완)':'');
      const t1b=isTeam&&m.team1A.team==='청팀';
      const p1label=isTeam?(t1b?teamNames.blue:teamNames.white):'A';
      const p2label=isTeam?(t1b?teamNames.white:teamNames.blue):'B';
      const p1cls=isTeam?(t1b?'tm-blue':'tm-white'):'tm-a';
      const p2cls=isTeam?(t1b?'tm-white':'tm-blue'):'tm-b';
      const sl1=isTeam?(t1b?teamNames.blue:teamNames.white):'A';
      const sl2=isTeam?(t1b?teamNames.white:teamNames.blue):'B';
      const sd1=isTeam?(t1b?'blue':'red'):'blue';
      const sd2=isTeam?(t1b?'red':'blue'):'red';
      const wl1Text=isTeam?(sd1==='blue'?'청 승':'홍 승'):`${sl1} 승`;
      const wl2Text=isTeam?(sd2==='blue'?'청 승':'홍 승'):`${sl2} 승`;
      const wl1=isTeam?`<span class="win-dot ${sd1}"></span><span class="win-label">${wl1Text}</span>`:wl1Text;
      const wl2=isTeam?`<span class="win-dot ${sd2}"></span><span class="win-label">${wl2Text}</span>`:wl2Text;
      return `<div class="match-card ${tc}${m.isFiller?' filler':''}" id="mc_${idx}">
        <div class="match-top">
          <span class="match-num">#${m.matchNumber}</span>
          <span class="mtb ${tbc}">${ts}</span>
          <span class="court-badge">코트 ${m.court}</span>
        </div>
        <div class="match-body">
          <div class="tm-side ${p1cls}">
            <span class="tm-prefix">${p1label}</span>
            <div class="tm-names">
              <span class="tm-name">${esc(m.team1A.name)}${m.team1A.isGuest?'<span class="guest-badge">G</span>':''}</span>
              <span class="tm-name">${esc(m.team1B.name)}${m.team1B.isGuest?'<span class="guest-badge">G</span>':''}</span>
            </div>
          </div>
          <div class="tm-vs">VS</div>
          <div class="tm-side ${p2cls}">
            <span class="tm-prefix">${p2label}</span>
            <div class="tm-names">
              <span class="tm-name">${esc(m.team2C.name)}${m.team2C.isGuest?'<span class="guest-badge">G</span>':''}</span>
              <span class="tm-name">${esc(m.team2D.name)}${m.team2D.isGuest?'<span class="guest-badge">G</span>':''}</span>
            </div>
          </div>
        </div>
        <div class="win-row">
          <button class="win-btn side1" id="wb1_${idx}" onclick="clickWin(${idx},'t1')">${wl1}</button>
          <button class="win-btn side2" id="wb2_${idx}" onclick="clickWin(${idx},'t2')">${wl2}</button>
          <span class="score-result" id="sr_${idx}"></span>
        </div>
      </div>`;
    }).join('');
    const isLocked=_lockedBeforeRound!=null && r<_lockedBeforeRound;
    const roundLabel='라운드';
    const editBtn=settings.teamMode
      ? ''
      : isLocked
      ? `<button class="round-edit-btn locked" onclick="alertRoundLocked(${r})">🔒 변경 잠금</button>`
      : `<button class="round-edit-btn" onclick="openRoundChange(${r})">✏️ 선수 변경</button>`;
    const isCurrent = (+r===_currentPlayRound);
    const nowBadge = isCurrent ? `<span class="round-now-badge">● 진행중</span>` : '';
    return `<div class="round-block${isCurrent?' round-current':''}" id="roundBlock_${r}"><div class="round-header"><span class="round-badge">${roundLabel} ${r}</span>${nowBadge}${editBtn}<div class="round-line"></div></div><div class="match-grid">${cards}</div></div>`;
  }).join('');
  document.getElementById('tabBracket').innerHTML=bracketHtml;
  renderFastPlayPanel();

  // Players tab — sortable + filterable
  buildPlayersTable(participants, settings);

  // 현재 진행 라운드 하이라이트 + 플로팅 버튼 초기화
  updateCurrentRoundHighlight();

}

/* 참가자 현황 테이블 — 정렬/필터 */
let _ptSort={col:'name',dir:1};
let _ptParticipants=[];
let _ptSettings={};

function buildPlayersTable(participants, settings){
  _ptParticipants=participants;
  _ptSettings=settings;
  _ptSort={col:'name',dir:1};
  // 새 대진표 생성 시 필터 영역 초기화
  document.getElementById('tabPlayers').innerHTML='';
  renderPlayersTable();
}

function ptSortBy(col){
  if(_ptSort.col===col) _ptSort.dir*=-1;
  else {_ptSort.col=col;_ptSort.dir=1;}
  renderPlayersTable();
}

function renderPlayersTable(){
  const s=_ptSort, st=_ptSettings;
  const filterTeam=document.getElementById('ptFilterTeam')?.value||'all';
  const filterGender=document.getElementById('ptGenderVal')?.value||'all';

  let rows=[..._ptParticipants];
  if(filterTeam!=='all') rows=rows.filter(p=>p.team===(filterTeam==='blue'?'청팀':'홍팀'));
  if(filterGender!=='all') rows=rows.filter(p=>p.gender===(filterGender==='M'?'M':'F'));

  rows.sort((a,b)=>{
    let av,bv;
    if(s.col==='name'){av=a.name;bv=b.name;return av.localeCompare(bv,'ko')*s.dir;}
    if(s.col==='team'){av=a.team;bv=b.team;}
    if(s.col==='level'){av=a.level;bv=b.level;}
    if(s.col==='gender'){av=a.gender;bv=b.gender;}
    if(s.col==='games'){av=a.gamesPlayed;bv=b.gamesPlayed;}
    if(s.col==='wins'){av=a._wins||0;bv=b._wins||0;}
    if(s.col==='losses'){av=a._losses||0;bv=b._losses||0;}
    if(s.col==='women'){av=a.womenDoublesPlayed;bv=b.womenDoublesPlayed;}
    if(s.col==='men'){av=a.menDoublesPlayed;bv=b.menDoublesPlayed;}
    if(s.col==='mixed'){av=a.mixedDoublesPlayed;bv=b.mixedDoublesPlayed;}
    if(s.col==='adjust'){av=a.adjustmentPlayed||0;bv=b.adjustmentPlayed||0;}
    return (av>bv?1:av<bv?-1:0)*s.dir;
  });

  const arrow=col=>s.col===col?(s.dir===1?' ▲':' ▼'):'';

  const hasTeam=_ptParticipants.some(p=>p.team==='청팀'||p.team==='홍팀');
  const bn=teamNames.blue, wn=teamNames.white;

  const pRowsHtml=rows.map(p=>{
    // 중간 투입 선수는 개인 목표(_njGames) 기준, 그 외는 전체 목표
    const pGoal=(p._njGames!=null?p._njGames:st.gamesPerPlayer);
    const stEl=p.gamesPlayed<pGoal?`<span class="st-bad">❌${p.gamesPlayed}</span>`:
               p.gamesPlayed===pGoal?`<span class="st-ok">✅${p.gamesPlayed}</span>`:
               `<span class="st-plus">+${p.gamesPlayed-pGoal}(${p.gamesPlayed})</span>`;
    const _ti=p.team==='청팀'?'🔵':p.team==='홍팀'?'🔴':'';
    const tn=p.team==='청팀'?(_ti+' '+bn):p.team==='홍팀'?(_ti+' '+wn):'—';
    const tc=p.team==='청팀'?'class="td-blue"':p.team==='홍팀'?'class="td-brown"':'class="td-dim"';
    const joinerBadge=p.isNewJoiner?`<span class="joiner-badge" title="중간 투입 (목표 ${pGoal}게임)">중간</span>`:'';
    return `<tr>
      <td>${esc(p.name)}${p.isGuest?'<span class="guest-badge">G</span>':''}${joinerBadge}</td>
      <td ${tc}>${tn}</td>
      <td>${p.gender==='M'?'남':'여'}</td>
      <td>${stEl}</td>
      <td class="td-blue td-bold">${p._wins||0}</td>
      <td class="td-brown td-bold">${p._losses||0}</td>
      <td class="td-dim">${p.womenDoublesPlayed}</td>
      <td class="td-dim">${p.menDoublesPlayed}</td>
      <td class="td-dim">${p.mixedDoublesPlayed}</td>
      <td class="td-dim">${p.adjustmentPlayed||0}</td>
    </tr>`;
  }).join('');

  const hasTeamFilter = hasTeam;
  const bn2=teamNames.blue, wn2=teamNames.white;

  // 필터 영역은 처음 한 번만 그림 (이미 존재하면 값 유지)
  const filterArea = document.getElementById('ptFilterArea');
  if(!filterArea){
    // tabPlayers 초기화 및 필터 영역 생성
    const teamOpts = hasTeamFilter
      ? `<option value="all">팀 전체</option><option value="blue">${bn2}</option><option value="white">${wn2}</option>`
      : `<option value="all">팀 전체</option>`;
    document.getElementById('tabPlayers').innerHTML=`
      <div id="ptFilterArea" style="display:flex;gap:6px;margin-bottom:9px;flex-wrap:wrap;align-items:center;">
        <select id="ptFilterTeam" onchange="renderPlayersTable()" style="background:var(--sur2);border:1px solid var(--bdr);color:var(--txt);border-radius:6px;padding:5px 9px;font-size:.74rem;font-family:'Noto Sans KR',sans-serif;outline:none;">${teamOpts}</select>
        <div id="ptGenderBtns" style="display:flex;gap:4px;"></div>
        <span style="font-size:.66rem;color:var(--dim);margin-left:2px;">열 제목 클릭 → 정렬</span>
        <span id="ptCountLabel" style="margin-left:auto;font-size:.7rem;color:var(--dim);"></span>
      </div>
      <div id="ptTableArea"></div>`;
    renderGenderBtns();
  } else {
    // 팀 옵션 텍스트 갱신 (팀명 변경 대응)
    const sel=document.getElementById('ptFilterTeam');
    if(sel&&sel.options.length>1){
      if(sel.options[1]) sel.options[1].text=bn2;
      if(sel.options[2]) sel.options[2].text=wn2;
    }
  }

  document.getElementById('ptCountLabel').textContent=`${rows.length}명 표시`;

  const th=(col,label)=>`<th class="pt-th" onclick="ptSortBy('${col}')">${label}${arrow(col)}</th>`;
  document.getElementById('ptTableArea').innerHTML=`
    <div class="ptable-wrap"><table class="ptable">
      <thead><tr>
        ${th('name','이름')}${th('team','팀')}${th('gender','성별')}
        ${th('games','게임수')}${th('wins','승')}${th('losses','패')}${th('women','여복')}${th('men','남복')}${th('mixed','혼복')}${th('adjust','보정')}
      </tr></thead>
      <tbody>${pRowsHtml}</tbody>
    </table></div>`;
}

function renderGenderBtns(){
  const cur=document.getElementById('ptFilterGender_val')||'all';
  const btns=[['all','전체'],['M','남'],['F','여']];
  const container=document.getElementById('ptGenderBtns');
  if(!container)return;
  // store current value in a hidden element
  const stored=document.getElementById('ptGenderVal')?.value||'all';
  container.innerHTML=btns.map(([v,l])=>{
    const active=stored===v;
    return `<button onclick="setGenderFilter('${v}')" style="
      padding:4px 11px;border-radius:6px;font-size:.74rem;font-weight:700;
      font-family:'Noto Sans KR',sans-serif;cursor:pointer;transition:all .15s;
      border:1.5px solid ${active?'var(--bll)':'var(--bdr)'};
      background:${active?'rgba(96,165,250,.15)':'transparent'};
      color:${active?'var(--bll)':'var(--dim)'};">${l}</button>`;
  }).join('')+'<input type="hidden" id="ptGenderVal" value="'+stored+'">';
}

function setGenderFilter(val){
  const el=document.getElementById('ptGenderVal');
  if(el) el.value=val;
  renderGenderBtns();
  renderPlayersTable();
}

/* ═══ PRINT ═══ */
function togglePrintMenu(){
  if(isMobile()){
    // 모바일: 바텀시트
    document.getElementById('printSheet').classList.add('open');
    document.getElementById('printSheetOverlay').classList.add('open');
  } else {
    // 데스크탑: 기존 드롭다운
    const m=document.getElementById('printMenu');
    m.classList.toggle('open');
    if(m.classList.contains('open')){
      setTimeout(()=>document.addEventListener('click',closePrintMenu,{once:true}),0);
    }
  }
}
function closePrintMenu(){
  // 드롭다운
  const m=document.getElementById('printMenu');
  if(m) m.classList.remove('open');
  // 바텀시트
  const sheet=document.getElementById('printSheet');
  const overlay=document.getElementById('printSheetOverlay');
  if(sheet) sheet.classList.remove('open');
  if(overlay) overlay.classList.remove('open');
}

function doPrint(mode){
  closePrintMenu();
  if(!currentMatches.length){alert('대진표를 먼저 생성해주세요.');return;}

  const isTeam=currentSettings.teamMode;
  const bn=teamNames?teamNames.blue:'청 팀';
  const wn=teamNames?teamNames.white:'홍 팀';

  // 렌더링용 HTML 생성
  const html = buildPrintHtml(mode, isTeam, bn, wn);

  if(isMobile()){
    // 모바일: 이미지 미리보기
    showImgPreview(mode, html, bn, wn);
  } else {
    // 데스크탑: 기존 인쇄
    document.getElementById('printPage').innerHTML = html;
    window.print();
  }
}

function buildPrintHtml(mode, isTeam, bn, wn){
  if(mode==='bracket'){
    const byRound={};
    currentMatches.forEach(m=>{if(!byRound[m.round])byRound[m.round]=[];byRound[m.round].push(m);});
    const rounds=Object.keys(byRound).sort((a,b)=>a-b);
    const roundsHtml=rounds.map(r=>{
      const cards=byRound[r].map(m=>{
        const tc=m.type==='여복'?'p-women':m.type==='남복'?'p-men':m.type==='보정'?'p-adjust':'p-mixed';
        const ptc=m.type==='여복'?'pw':m.type==='남복'?'pm':m.type==='보정'?'pa':'px';
        const ts=m.type+(m.isFiller?'(보완)':'');
        const t1b=isTeam&&m.team1A.team==='청팀';
        const p1label=isTeam?(t1b?bn:wn):'A';
        const p2label=isTeam?(t1b?wn:bn):'B';
        const p1side=isTeam?(t1b?'pb':'pw2'):'pa';
        const p2side=isTeam?(t1b?'pw2':'pb'):'pbb';
        return `<div class="p-card ${tc}${m.isFiller?' p-filler':''}">
          <div class="p-top"><span class="p-type ${ptc}">${ts}</span><span>코트 ${m.court}</span></div>
          <div class="p-body">
            <div class="p-side ${p1side}"><span class="p-prefix">${p1label}</span>
              <div>
                <div class="p-row">${m.team1A.name}${m.team1A.isGuest?'<span class="p-guest-badge">G</span>':''}</div>
                <div class="p-row">${m.team1B.name}${m.team1B.isGuest?'<span class="p-guest-badge">G</span>':''}</div>
              </div>
            </div>
            <div class="p-vs">VS</div>
            <div class="p-side ${p2side}"><span class="p-prefix">${p2label}</span>
              <div>
                <div class="p-row">${m.team2C.name}${m.team2C.isGuest?'<span class="p-guest-badge">G</span>':''}</div>
                <div class="p-row">${m.team2D.name}${m.team2D.isGuest?'<span class="p-guest-badge">G</span>':''}</div>
              </div>
            </div>
          </div>
        </div>`;
      }).join('');
      return `<div class="p-round-block"><div class="p-round-title">라운드 ${r}</div><div class="p-match-grid">${cards}</div></div>`;
    }).join('');
    const titleSuffix=isTeam?` — ${bn} vs ${wn}`:'';
    return `<div class="p-main-head"><h1>🏸 배드민턴 대진표${titleSuffix}</h1></div>${roundsHtml}`;
  } else {
    const all=currentParticipants.slice().sort((a,b)=>a.name.localeCompare(b.name,'ko'));
    const blue=all.filter(p=>p.team==='청팀');
    const white=all.filter(p=>p.team==='홍팀');
    const getRole=(name,side)=>{
      if(captains[side].leader===name) return '단장';
      if(captains[side].sub===name) return '부단장';
      return '';
    };
    const sortWithRoles=(list,side)=>[...list].sort((a,b)=>{
      const ra=a.name===captains[side].leader?0:a.name===captains[side].sub?1:2;
      const rb=b.name===captains[side].leader?0:b.name===captains[side].sub?1:2;
      return ra-rb||a.name.localeCompare(b.name,'ko');
    });
    const rosterBlock=(players,cls,title,side)=>{
      if(!players.length) return '';
      const sorted=side?sortWithRoles(players,side):players;
      const names=sorted.map(p=>{
        const role=side?getRole(p.name,side):'';
        const roleBadge=role?`<span class="p-cap-badge p-cap-${role==='단장'?'leader':'sub'}">${role}</span>`:'';
        const guestBadge=p.isGuest?'<span class="p-guest-badge">G</span>':'';
        return `<div class="p-roster-name">${esc(p.name)}${guestBadge}${roleBadge}</div>`;
      }).join('');
      return `<div class="p-roster-section"><div class="p-roster-title ${cls}">${title} (${players.length}명)</div><div class="p-roster-grid">${names}</div></div>`;
    };
    let content='';
    if(mode==='all'){
      content=rosterBlock(all,'all','전체 선수 명단',null);
      if(blue.length) content+=rosterBlock(blue,'blue',bn+' 명단','blue');
      if(white.length) content+=rosterBlock(white,'white',wn+' 명단','white');
    } else if(mode==='blue'){
      content=rosterBlock(blue,'blue',bn+' 명단','blue');
    } else if(mode==='white'){
      content=rosterBlock(white,'white',wn+' 명단','white');
    }
    return `<div class="p-main-head"><h1>🏸 배드민턴 선수 명단</h1></div>${content}`;
  }
}

// ── 모바일 이미지 빌더 ──
function buildMobileHtml(mode, isTeam, bn, wn){
  if(mode==='bracket'){
    const byRound={};
    currentMatches.forEach(m=>{if(!byRound[m.round])byRound[m.round]=[];byRound[m.round].push(m);});
    const rounds=Object.keys(byRound).sort((a,b)=>a-b);
    const roundsHtml=rounds.map(r=>{
      const cards=byRound[r].map(m=>{
        const tc=m.type==='여복'?'type-w':m.type==='남복'?'type-m':m.type==='보정'?'type-a':'type-x';
        const ts=m.type+(m.isFiller?'(보완)':'');
        return `<div class="render-card ${tc}">
          <div class="render-card-top"><span class="rt-type">${ts}</span><span class="rt-court">코트 ${m.court}</span></div>
          <div class="render-card-body">
            <div class="render-side sb">
              <div class="render-name">${m.team1A.name}</div>
              <div class="render-name">${m.team1B.name}</div>
            </div>
            <div class="render-vs">VS</div>
            <div class="render-side sw">
              <div class="render-name">${m.team2C.name}</div>
              <div class="render-name">${m.team2D.name}</div>
            </div>
          </div>
        </div>`;
      }).join('');
      return `<div class="render-round"><div class="render-round-badge">라운드 ${r}</div><div class="render-match-grid">${cards}</div></div>`;
    }).join('');
    return `<div class="render-wrap"><div class="render-title">🏸 배드민턴 대진표${isTeam?' — '+bn+' vs '+wn:''}</div>${roundsHtml}</div>`;
  } else {
    const all=currentParticipants.slice().sort((a,b)=>a.name.localeCompare(b.name,'ko'));
    const blue=all.filter(p=>p.team==='청팀');
    const white=all.filter(p=>p.team==='홍팀');
    const getRole=(name,side)=>captains[side].leader===name?'단장':captains[side].sub===name?'부단장':'';
    const sortWithRoles=(list,side)=>[...list].sort((a,b)=>{
      const ra=a.name===captains[side].leader?0:a.name===captains[side].sub?1:2;
      const rb=b.name===captains[side].leader?0:b.name===captains[side].sub?1:2;
      return ra-rb||a.name.localeCompare(b.name,'ko');
    });
    const block=(players,cls,title,side)=>{
      if(!players.length)return'';
      const sorted=side?sortWithRoles(players,side):players;
      const names=sorted.map(p=>{
        const role=side?getRole(p.name,side):'';
        const badge=role?`<span class="render-cap ${role==='단장'?'leader':'sub'}">${role}</span>`:'';
        const guestB=p.isGuest?'<span class="render-guest-badge">G</span>':'';
        return `<div class="render-roster-name">${esc(p.name)}${guestB}${badge}</div>`;
      }).join('');
      return `<div class="render-roster-section"><div class="render-roster-title ${cls}">${title} (${players.length}명)</div><div class="render-roster-grid">${names}</div></div>`;
    };
    let content='';
    if(mode==='all'){content=block(all,'all','전체 선수',null);if(blue.length)content+=block(blue,'blue',bn,side='blue');if(white.length)content+=block(white,'white',wn,side='white');}
    else if(mode==='blue') content=block(blue,'blue',bn+' 명단','blue');
    else if(mode==='white') content=block(white,'white',wn+' 명단','white');
    return `<div class="render-wrap"><div class="render-title">🏸 선수 명단</div>${content}</div>`;
  }
}

let _previewImgDataUrl='';
let _previewImgUrls=[]; // 여러 장일 때
let _previewCurrentPage=0;

function showImgPreview(mode, printHtml, bn, wn){
  const isTeam=currentSettings.teamMode;
  const titleMap={'bracket':'대진표','all':'선수 전체 명단','blue':bn+' 명단','white':wn+' 명단'};
  document.getElementById('imgPreviewTitle').textContent='🖨️ '+titleMap[mode];
  document.getElementById('imgPreviewImg').style.display='none';
  document.getElementById('imgLoading').style.display='block';
  document.getElementById('imgLoading').textContent='🔄 이미지 생성 중...';
  document.getElementById('imgPreviewOverlay').classList.remove('hidden');
  document.getElementById('printPage').innerHTML=printHtml;

  _previewImgUrls=[];
  _previewCurrentPage=0;

  // 대진표는 라운드 청크로 분할, 명단은 단일
  const chunks=buildMobileChunks(mode, isTeam, bn, wn);

  // 페이지 인디케이터 표시 설정
  const pageEl=document.getElementById('imgPageIndicator');
  if(pageEl) pageEl.style.display=chunks.length>1?'block':'none';

  captureChunksSequentially(chunks, 0, ()=>{
    showPage(0);
    document.getElementById('imgLoading').style.display='none';
    if(navigator.share||navigator.canShare){
      document.getElementById('imgBtnShare').style.display='flex';
    }
  });
}

// 청크 배열을 순서대로 캡처
function captureChunksSequentially(chunks, idx, onDone){
  if(idx>=chunks.length){ onDone(); return; }

  const renderDiv=document.createElement('div');
  renderDiv.style.cssText='position:fixed;left:-9999px;top:0;width:390px;background:#fff;padding:0;margin:0;';
  renderDiv.innerHTML=chunks[idx];
  document.body.appendChild(renderDiv);

  setTimeout(()=>{
    // 콘텐츠 높이에 따라 scale 동적 결정
    // iOS Safari 캔버스 최대 크기: 4096×4096 (16MB)
    const MAX_CANVAS_PX=4000;
    const w=390;
    const h=renderDiv.scrollHeight;
    let scale=Math.min(3, Math.floor(MAX_CANVAS_PX/Math.max(w,h)*10)/10);
    scale=Math.max(1.5, scale); // 최소 1.5

    html2canvas(renderDiv,{
      scale,
      useCORS:true,
      backgroundColor:'#ffffff',
      logging:false,
      width:w,
      height:h,
      windowWidth:390,
    }).then(canvas=>{
      // JPEG로 압축 (PNG 대비 파일 크기 70% 감소, 화질 유지)
      _previewImgUrls.push(canvas.toDataURL('image/jpeg',0.92));
      document.body.removeChild(renderDiv);
      // 첫 장 완료 시 즉시 표시
      if(idx===0){
        showPage(0);
        document.getElementById('imgLoading').textContent=`🔄 ${idx+2}/${chunks.length} 생성 중...`;
      }
      captureChunksSequentially(chunks, idx+1, onDone);
    }).catch(()=>{
      document.body.removeChild(renderDiv);
      captureChunksSequentially(chunks, idx+1, onDone);
    });
  },150);
}

function showPage(page){
  if(!_previewImgUrls.length) return;
  _previewCurrentPage=Math.max(0,Math.min(page,_previewImgUrls.length-1));
  const img=document.getElementById('imgPreviewImg');
  img.src=_previewImgUrls[_previewCurrentPage];
  img.style.display='block';
  _previewImgDataUrl=_previewImgUrls[_previewCurrentPage];

  // 페이지 인디케이터 업데이트
  const pageEl=document.getElementById('imgPageIndicator');
  if(pageEl && _previewImgUrls.length>1){
    pageEl.textContent=`${_previewCurrentPage+1} / ${_previewImgUrls.length}`;
    pageEl.style.display='block';
  }
  // 이전/다음 버튼
  const prevBtn=document.getElementById('imgBtnPrev');
  const nextBtn=document.getElementById('imgBtnNext');
  if(prevBtn) prevBtn.style.display=_previewImgUrls.length>1?'flex':'none';
  if(nextBtn) nextBtn.style.display=_previewImgUrls.length>1?'flex':'none';
  if(prevBtn) prevBtn.disabled=_previewCurrentPage===0;
  if(nextBtn) nextBtn.disabled=_previewCurrentPage>=_previewImgUrls.length-1;
  // 네비 영역 + 전체저장 버튼
  const navEl=document.getElementById('imgPreviewNav');
  if(navEl) navEl.style.display=_previewImgUrls.length>1?'flex':'none';
  const pdfBtn=document.getElementById('imgBtnPdf');
  if(pdfBtn) pdfBtn.style.display='flex';
}

// buildMobileHtml → 청크 배열 반환 (대진표: 라운드 3개씩 분할)
function buildMobileChunks(mode, isTeam, bn, wn){
  if(mode!=='bracket'){
    return [buildMobileHtml(mode, isTeam, bn, wn)];
  }
  // 대진표: 라운드를 균등 분할 (단톡방에서 한 장씩 잘 보이도록)
  const byRound={};
  currentMatches.forEach(m=>{
    if(!byRound[m.round]) byRound[m.round]=[];
    byRound[m.round].push(m);
  });
  const rounds=Object.keys(byRound).sort((a,b)=>a-b);
  const MAX_PER_CHUNK=3;
  const numChunks=Math.max(1, Math.ceil(rounds.length/MAX_PER_CHUNK));
  const baseTake=Math.floor(rounds.length/numChunks);
  const extraTake=rounds.length%numChunks;
  const chunks=[];
  let _ci=0;
  for(let c=0;c<numChunks;c++){
    const take=baseTake+(c<extraTake?1:0);
    const slice=rounds.slice(_ci, _ci+take);
    _ci+=take;
    const roundsHtml=slice.map(r=>{
      const cards=byRound[r].map(m=>{
        const tc=m.type==='여복'?'type-w':m.type==='남복'?'type-m':m.type==='보정'?'type-a':'type-x';
        const ts=m.type+(m.isFiller?'(보완)':'');
        return `<div class="render-card ${tc}">
          <div class="render-card-top">
            <span class="rt-type">${ts}</span>
            <span class="rt-court">코트 ${m.court}</span>
          </div>
          <div class="render-card-body">
            <div class="render-side sb">
              <div class="render-name">${m.team1A.name}</div>
              <div class="render-name">${m.team1B.name}</div>
            </div>
            <div class="render-vs">VS</div>
            <div class="render-side sw">
              <div class="render-name">${m.team2C.name}</div>
              <div class="render-name">${m.team2D.name}</div>
            </div>
          </div>
        </div>`;
      }).join('');
      return `<div class="render-round"><div class="render-round-badge">라운드 ${r}</div><div class="render-match-grid">${cards}</div></div>`;
    }).join('');
    const totalChunks=numChunks;
    const chunkNum=c+1;
    const subtitle=totalChunks>1?` (${chunkNum}/${totalChunks})`:'' ;
    chunks.push(`<div class="render-wrap"><div class="render-title">🏸 배드민턴 대진표${isTeam?' — '+bn+' vs '+wn:''}${subtitle}</div>${roundsHtml}</div>`);
  }
  return chunks;
}

function closeImgPreview(){
  document.getElementById('imgPreviewOverlay').classList.add('hidden');
  _previewImgDataUrl='';
  _previewImgUrls=[];
  _previewCurrentPage=0;
}

function savePreviewImg(){
  if(!_previewImgDataUrl) return;
  const a=document.createElement('a');
  a.href=_previewImgDataUrl;
  const page=_previewImgUrls.length>1?`_${_previewCurrentPage+1}of${_previewImgUrls.length}`:'';
  a.download=`배드민턴_대진표${page}_${new Date().toLocaleDateString('ko-KR').replace(/\./g,'').replace(/ /g,'')}.jpg`;
  a.click();
}

// 모든 청크를 PDF 페이지로 저장 (길이 제한 없음)
async function saveAsPdf(){
  if(!_previewImgUrls.length) return;
  const btn=document.getElementById('imgBtnPdf');
  if(btn){btn.textContent='⏳ PDF 생성 중...';btn.disabled=true;}

  try{
    const {jsPDF}=window.jspdf;
    const pdfW=210; // A4 너비(mm) 기준

    // 모든 이미지 미리 로드
    const imgs=await Promise.all(_previewImgUrls.map(url=>loadImg(url)));

    // 첫 페이지: 첫 이미지 비율로 생성
    const firstH=Math.round(pdfW*imgs[0].naturalHeight/imgs[0].naturalWidth);
    const pdf=new jsPDF({
      orientation:firstH>pdfW?'p':'l',
      unit:'mm',
      format:[pdfW,firstH]
    });
    pdf.addImage(_previewImgUrls[0],'JPEG',0,0,pdfW,firstH,undefined,'FAST');

    // 나머지 페이지: 각자 이미지 비율로 페이지 크기 지정
    for(let i=1;i<imgs.length;i++){
      const pageH=Math.round(pdfW*imgs[i].naturalHeight/imgs[i].naturalWidth);
      pdf.addPage([pdfW,pageH], pageH>pdfW?'p':'l');
      pdf.addImage(_previewImgUrls[i],'JPEG',0,0,pdfW,pageH,undefined,'FAST');
      if(btn) btn.textContent=`⏳ ${i+1}/${imgs.length} 처리 중...`;
    }

    const fname=`배드민턴_대진표_${new Date().toLocaleDateString('ko-KR').replace(/\./g,'').replace(/ /g,'')}.pdf`;
    pdf.save(fname);
  }catch(e){
    alert('PDF 생성에 실패했습니다: '+e.message);
  }

  if(btn){btn.textContent='📄 PDF 저장';btn.disabled=false;}
}

function loadImg(src){
  return new Promise((res,rej)=>{
    const img=new Image();
    img.onload=()=>res(img);
    img.onerror=rej;
    img.src=src;
  });
}

async function sharePreviewImg(){
  if(!_previewImgUrls.length) return;
  try{
    // 모든 페이지(라운드 묶음)를 한 번에 공유 — 단톡방/밴드에서 여러 장이 바로 보임
    const files=[];
    for(let i=0;i<_previewImgUrls.length;i++){
      const res=await fetch(_previewImgUrls[i]);
      const blob=await res.blob();
      const name=_previewImgUrls.length>1
        ? `배드민턴_대진표_${i+1}.jpg`
        : `배드민턴_대진표.jpg`;
      files.push(new File([blob],name,{type:'image/jpeg'}));
    }
    // 여러 파일 공유 가능 여부 확인 후 분기
    if(navigator.canShare && navigator.canShare({files})){
      await navigator.share({files,title:'배드민턴 대진표'});
    } else if(files.length===1 && navigator.share){
      await navigator.share({files,title:'배드민턴 대진표'});
    } else {
      // 여러 장 공유 미지원 기기: 현재 보는 장만 공유 + 안내
      const cur=_previewCurrentPage||0;
      const res=await fetch(_previewImgUrls[cur]);
      const blob=await res.blob();
      const file=new File([blob],`배드민턴_대진표_${cur+1}.jpg`,{type:'image/jpeg'});
      await navigator.share({files:[file],title:'배드민턴 대진표'});
      alert(`이 기기는 한 번에 한 장만 공유돼요.\n총 ${_previewImgUrls.length}장이니, 각 장을 넘기며 공유하거나 "저장" 후 함께 올려주세요.`);
    }
  }catch(e){
    if(e.name!=='AbortError') alert('공유에 실패했습니다.');
  }
}

/* ═══ LOCAL STORAGE ═══ */
const SAVE_KEY='badminton_bracket_v7';
const LV_VERSION=2; // 레벨 체계 버전: 1=구버전(E여자=0), 2=신버전(E여자=1)

// 선수 객체 레벨 +1 (이름+레벨 구조일 때만)
function migratePlayerLevel(p){
  if(!p||typeof p.level!=='number') return p;
  return {...p, level: p.level+1};
}

// 저장 state 전체를 구버전→신버전으로 마이그레이션
function _migrateTeamLabel(state){
  // '백팀'/'백 팀' 식별자·이름을 '홍팀'/'홍 팀'으로 변환 (구버전 데이터 호환)
  if(!state) return state;
  function fixTeam(v){ return v==='백팀'?'홍팀':v; }
  function fixArr(a){ if(Array.isArray(a)) a.forEach(p=>{ if(p&&p.team) p.team=fixTeam(p.team); }); }
  if(state.directPlayers) fixArr(state.directPlayers);
  if(state.participants) fixArr(state.participants);
  if(state.teamAssignment){ fixArr(state.teamAssignment.blue); fixArr(state.teamAssignment.white); }
  if(Array.isArray(state.matches)) state.matches.forEach(m=>{
    ['team1A','team1B','team2C','team2D'].forEach(k=>{ if(m[k]&&m[k].team) m[k].team=fixTeam(m[k].team); });
  });
  if(state.teamNames){ if(state.teamNames.white==='백 팀'||state.teamNames.white==='백팀') state.teamNames.white='홍 팀'; }
  return state;
}
function migrateStateIfNeeded(state){
  if(!state) return state;
  state=_migrateTeamLabel(state);
  if((state._lvVersion||1)>=LV_VERSION) return state; // 이미 마이그레이션됨
  const s={...state, _lvVersion:LV_VERSION};

  // directPlayers
  if(Array.isArray(s.directPlayers)){
    s.directPlayers=s.directPlayers.map(migratePlayerLevel);
  }
  // participants
  if(Array.isArray(s.participants)){
    s.participants=s.participants.map(migratePlayerLevel);
  }
  // teamAssignment
  if(s.teamAssignment){
    if(Array.isArray(s.teamAssignment.blue))
      s.teamAssignment={...s.teamAssignment, blue:s.teamAssignment.blue.map(migratePlayerLevel)};
    if(Array.isArray(s.teamAssignment.white))
      s.teamAssignment={...s.teamAssignment, white:s.teamAssignment.white.map(migratePlayerLevel)};
  }
  // matches — 각 경기의 4명 선수 레벨
  if(Array.isArray(s.matches)){
    s.matches=s.matches.map(m=>{
      const nm={...m};
      ['team1A','team1B','team2C','team2D'].forEach(k=>{
        if(nm[k]) nm[k]=migratePlayerLevel(nm[k]);
      });
      // team1Level, team2Level 재계산 (실효 레벨 기준)
      if(nm.team1A&&nm.team1B) nm.team1Level=effLevel(nm.team1A)+effLevel(nm.team1B);
      if(nm.team2C&&nm.team2D) nm.team2Level=effLevel(nm.team2C)+effLevel(nm.team2D);
      if(nm.team1Level!==undefined&&nm.team2Level!==undefined)
        nm.levelDiff=Math.round(Math.abs(nm.team1Level-nm.team2Level)*10)/10;
      return nm;
    });
  }
  return s;
}
let saveTimer=null;

function scheduleSave(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(saveState,800);
  setSaveStatus('saving');
}

function setSaveStatus(type,msg){
  // 데스크탑 (nav-bar)
  const el=document.getElementById('saveStatus');
  el.className='save-status '+(type||'');
  if(type==='saved') el.textContent='✓ 자동저장 '+new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
  else if(type==='saving') el.textContent='저장 중...';
  else el.textContent=msg||'';

  // 모바일 바 동기화
  const mel=document.getElementById('mobSaveStatus');
  if(!mel) return;
  mel.className='mob-save-status '+(type||'');
  if(type==='saved') mel.textContent='✓ 자동저장됨';
  else if(type==='saving') mel.textContent='저장 중...';
  else mel.textContent=msg||'대진표 저장 안 됨';
}

function saveState(){
  if(!currentMatches.length)return;
  _forcePersonalOnlyMode();
  const scores=currentMatches.map((m,i)=>{
    const s1=document.getElementById('s1_'+i);
    const s2=document.getElementById('s2_'+i);
    return{s1:s1?parseInt(s1.value)||0:0,s2:s2?parseInt(s2.value)||0:0};
  });
  const state={
    mode:'daily',
    appMode:'dailyLive',
    savedAt:Date.now(),
    directPlayers:_directPlayers.slice(),
    courts:document.getElementById('courts').value,
    gamesPerPlayer:document.getElementById('gamesPerPlayer').value,
    mixedDbl:document.getElementById('mixedDbl').value,
    operationPreset: inferOperationPreset(),
    teamNames:{...teamNames},
    teamModeOverride: false,
    captains: JSON.parse(JSON.stringify(captains)),
    partners: JSON.parse(JSON.stringify(_partners)),
    _lvVersion: LV_VERSION,
    teamAssignment:null,
    matches:currentMatches.map(m=>({
      matchNumber:m.matchNumber,round:m.round,court:m.court,
      type:m.type,isFiller:m.isFiller||false,levelDiff:m.levelDiff,
      team1Level:m.team1Level,team2Level:m.team2Level,
      team1A:slim(m.team1A),team1B:slim(m.team1B),
      team2C:slim(m.team2C),team2D:slim(m.team2D)
    })),
    participants:currentParticipants.map(p=>({
      name:p.name,level:p.level,grade:p.grade||'',gender:p.gender,team:p.team,
      partnerName:p.partnerName||getPartnerOf(p.name)||null,
      partnerId:p.partnerId||(getPartnerInfo(p.name)||{}).id||null,
      isGuest:!!p.isGuest,ageGroup:p.ageGroup||'40대',
      gamesPlayed:p.gamesPlayed,
      womenDoublesPlayed:p.womenDoublesPlayed,
      menDoublesPlayed:p.menDoublesPlayed,
      mixedDoublesPlayed:p.mixedDoublesPlayed,
      adjustmentPlayed:p.adjustmentPlayed||0,
      isNewJoiner:!!p.isNewJoiner,
      _njGames:p._njGames!=null?p._njGames:null
    })),
    settings:{...currentSettings,teamMode:false,operationPreset:'daily'},scores,
    winOverride:JSON.parse(JSON.stringify(winOverride)),
    lockedBeforeRound:_lockedBeforeRound,
    pointSystem:_pointSystem,
    fastPlay:{on:!!_fastPlayOn,active:{..._fastActive},lastFinished:[...(_fastLastFinishedPlayers||[])],note:_fastLastNote||''}
  };
  // 실시간 중계 ID 저장 (앱 종료 후 재시작 시 자동 재연결용)
  if(_liveId) {
    _dailySaveLiveId(_liveId);
  }
  try{localStorage.setItem(SAVE_KEY,JSON.stringify(state));setSaveStatus('saved');}
  catch(e){setSaveStatus('','⚠ 저장 실패');}
}

function slim(p){return{name:p.name,level:p.level,grade:p.grade||'',gender:p.gender,team:p.team||'',isGuest:!!p.isGuest,ageGroup:p.ageGroup||'40대'};}

function _dailyIsTeamBracketState(state){
  if(!state)return false;
  if(state.mode==='team'||state.appMode==='teamLive')return true;
  if(state.teamModeOverride===true)return true;
  if(state.teamAssignment&&((state.teamAssignment.blue||[]).length||(state.teamAssignment.white||[]).length))return true;
  if(state.settings&&state.settings.teamMode===true)return true;
  return false;
}

function _restoreJoinerGoals(participants,settings){
  const defaultGoal=(settings&&settings.gamesPerPlayer)||4;
  participants.forEach(p=>{
    if(!p.isNewJoiner)return;
    // 구버전 저장본에서 중간 투입 목표가 누락됐으면 실제 배정 경기 수로 복원한다.
    const goal=p._njGames!=null?p._njGames
      :(p._goal!=null?p._goal:(p.gamesPlayed!=null?p.gamesPlayed:defaultGoal));
    p._njGames=goal;
    p._goal=goal;
  });
  return participants;
}

function checkSavedState(){
  try{
    const raw=localStorage.getItem(SAVE_KEY);
    if(!raw)return;
    const state=migrateStateIfNeeded(JSON.parse(raw));
    if(_dailyIsTeamBracketState(state))return;
    if(!state.matches||!state.matches.length)return;
    const age=Date.now()-state.savedAt;
    const h=Math.floor(age/3600000),m=Math.floor((age%3600000)/60000);
    const ageStr=h>0?`${h}시간 ${m}분 전`:`${m}분 전`;
    const pCount=state.participants?state.participants.length:'?';
    const hasLive=!!localStorage.getItem(DAILY_LIVE_STORAGE_KEY);
    const restoreBtn=document.getElementById('restoreBtn');
    restoreBtn.textContent=hasLive
      ? `🔴 진행 중 민턴LIVE 복구 (${pCount}명 · ${ageStr})`
      : `📂 이전 대진표 불러오기 (${pCount}명 · ${ageStr} 저장)`;
    restoreBtn.classList.toggle('live-restore',hasLive);
    restoreBtn.classList.remove('hidden');
    // 모바일 버튼도 표시
    const mb=document.getElementById('mobRestoreBtn');
    if(mb){
      mb.textContent=hasLive?`🔴 민턴LIVE 복구 (${pCount}명)`:`📂 불러오기 (${pCount}명 · ${ageStr})`;
      mb.classList.toggle('live-restore',hasLive);
      mb.classList.remove('hidden');
    }
    const ms=document.getElementById('mobSaveStatus');
    if(ms){ms.textContent=`마지막 저장: ${new Date(state.savedAt).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}`;}
    setSaveStatus('',`마지막 저장: ${new Date(state.savedAt).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}`);
  }catch(e){}
}

function restoreState(){
  try{
    const raw=localStorage.getItem(SAVE_KEY);
    if(!raw){alert('저장된 데이터가 없습니다.');return;}
    const state=migrateStateIfNeeded(JSON.parse(raw));
    if(_dailyIsTeamBracketState(state)){
      alert('팀전LIVE 저장본입니다. 팀전LIVE에서 복구하세요.');
      return;
    }
    // 마이그레이션 결과를 즉시 다시 저장 (다음 실행 시 중복 적용 방지)
    try{localStorage.setItem(SAVE_KEY,JSON.stringify(state));}catch(e){}

    document.getElementById('courts').value=state.courts||4;
    document.getElementById('gamesPerPlayer').value=state.gamesPerPlayer||4;
    document.getElementById('mixedDbl').value=state.mixedDbl||0;
    // 직접입력 목록 복원 (구버전 pasteText 호환 포함)
    if(state.directPlayers&&state.directPlayers.length){
      _directPlayers=state.directPlayers.slice();
    } else if(state.pasteText){
      // 구버전 호환: pasteText 파싱 후 directPlayers로 변환
      const parsed=parseParticipants(state.pasteText).filter(p=>p._valid);
      _directPlayers=parsed.map(p=>({
        name:p.name,level:p.level,
        grade:p._grade||levelToGrade(p.level,p.gender),
        gender:p.gender==='M'?'남':'여',team:p.team||''
      }));
    }
    renderDirectPlayerList();
    const parseStatus=document.getElementById('parseStatus');
    if(_directPlayers.length&&parseStatus){
      parseStatus.style.color='var(--green)';
      parseStatus.textContent='✓ 저장된 참가자 '+_directPlayers.length+'명 복원됨';
    }

    // Restore team names
    if(state.teamNames){
      teamNames={...state.teamNames};
      if(teamNames.white==='백 팀'||teamNames.white==='백팀') teamNames.white='홍 팀';
    }
    syncFixedTeamNames();
    _teamModeOverride = state.teamModeOverride ?? null;
    if(state.captains) captains=state.captains;
    else captains={blue:{leader:'',sub:''},white:{leader:'',sub:''}};

    // 파트너 복원
    if(state.partners) _partners=state.partners;
    else _partners=[];
    // 파트너 배지 반영해서 선수 목록 재렌더링
    renderDirectPlayerList();

    teamAssignment=null;
    _teamWanted=false;
    _teamModeOverride=false;
    updateTeamModeBadge();

    currentParticipants=state.participants.map(p=>Object.assign({
      _valid:true,partnerCount:{},opponentCount:{},lastRoundPlayed:0,_levelRaw:'',_genderRaw:'',isGuest:!!p.isGuest,
      adjustmentPlayed:0,
      ageGroup:'40대' // 구버전 저장 데이터 호환: ageGroup 없으면 40대 기본값
    },p));
    _attachPartnerNames(currentParticipants);
    _restoreJoinerGoals(currentParticipants,state.settings);
    currentMatches=state.matches.map(m=>{
      const findP=name=>currentParticipants.find(p=>p.name===name)||{name,level:3,gender:'M',team:'',ageGroup:'40대',grade:''};
      return{
        matchNumber:m.matchNumber,round:m.round,court:m.court,
        type:m.type,isFiller:m.isFiller||false,levelDiff:m.levelDiff,
        team1Level:m.team1Level,team2Level:m.team2Level,
        team1A:findP(m.team1A.name),team1B:findP(m.team1B.name),
        team2C:findP(m.team2C.name),team2D:findP(m.team2D.name)
      };
    });
    currentSettings={...(state.settings||{}),teamMode:false,operationPreset:'daily'};
    setOperationPreset('daily');
    _fastPlayOn=!!(state.fastPlay&&state.fastPlay.on);
    _fastActive={...(state.fastPlay&&state.fastPlay.active||{})};
    _fastLastFinishedPlayers=[...((state.fastPlay&&state.fastPlay.lastFinished)||[])];
    _fastLastNote=(state.fastPlay&&state.fastPlay.note)||'';
    _lockedBeforeRound = state.lockedBeforeRound ?? null;
    Object.keys(winOverride).forEach(k=>delete winOverride[k]);
    Object.assign(winOverride,state.winOverride||{});
    if(state.pointSystem){ _pointSystem=state.pointSystem; document.querySelectorAll('.pseg-btn').forEach(b=>b.classList.toggle('active',+b.dataset.pt===_pointSystem)); }

    renderResults(currentMatches,currentParticipants,currentSettings);
    show('resultArea');

    setTimeout(()=>{
      if(state.scores){
        state.scores.forEach((sc,i)=>{
          const s1=document.getElementById('s1_'+i);
          const s2=document.getElementById('s2_'+i);
          if(s1&&sc.s1)s1.value=sc.s1;
          if(s2&&sc.s2)s2.value=sc.s2;
        });
        updateScores();
      }
      document.getElementById('restoreBtn').classList.add('hidden');
      const mb=document.getElementById('mobRestoreBtn');
      if(mb) mb.classList.add('hidden');
      setSaveStatus('saved');
      (document.getElementById('qualDash')||document.getElementById('resultArea')).scrollIntoView({behavior:'smooth',block:'start'});
      // 중계 자동 재연결: 저장된 liveId가 있으면 Firebase 확인 후 재개
      _tryResumeLive();
    },100);
  }catch(e){alert('복원 중 오류: '+e.message);console.error(e);}
}

/* ════════════════════════════════
   이름 붙여 저장 (슬롯 시스템)
════════════════════════════════ */
const SLOTS_KEY='badminton_slots_v1';
const MAX_SLOTS=10;

function getSlots(){
  try{return JSON.parse(localStorage.getItem(SLOTS_KEY))||[];}
  catch{return [];}
}
function saveSlots(slots){
  localStorage.setItem(SLOTS_KEY,JSON.stringify(slots));
}

function openSaveSlotModal(){
  if(!currentMatches.length){alert('대진표를 먼저 생성해주세요.');return;}
  const input=document.getElementById('slotNameInput');
  // 기본값: 팀명 + 오늘 날짜
  const today=new Date().toLocaleDateString('ko-KR',{month:'long',day:'numeric'}).replace(/ /g,'');
  input.value=`${teamNames.blue||'청팀'} vs ${teamNames.white||'홍팀'} ${today}`;
  document.getElementById('slotSaveMsg').textContent='';
  document.getElementById('saveSlotModal').classList.remove('hidden');
  setTimeout(()=>{input.select();},100);
}
function closeSaveSlotModal(){
  document.getElementById('saveSlotModal').classList.add('hidden');
}

function confirmSaveSlot(){
  const name=document.getElementById('slotNameInput').value.trim();
  if(!name){document.getElementById('slotSaveMsg').textContent='⚠️ 이름을 입력해주세요.';return;}

  const slots=getSlots();
  if(slots.length>=MAX_SLOTS){
    document.getElementById('slotSaveMsg').textContent=`⚠️ 최대 ${MAX_SLOTS}개까지 저장 가능합니다. 목록에서 삭제 후 시도해주세요.`;
    return;
  }

  // 같은 이름 있으면 덮어쓸지 확인
  const existing=slots.findIndex(s=>s.name===name);
  if(existing>=0){
    if(!confirm(`'${name}' 이름의 저장이 이미 있습니다.\n덮어쓸까요?`)) return;
  }

  const raw=localStorage.getItem(SAVE_KEY);
  if(!raw){document.getElementById('slotSaveMsg').textContent='⚠️ 저장할 데이터가 없습니다.';return;}

  const slot={
    id: existing>=0 ? slots[existing].id : 'slot_'+Date.now(),
    name,
    savedAt: Date.now(),
    participants: currentParticipants.length,
    matches: currentMatches.length,
    state: JSON.parse(raw),
  };

  if(existing>=0) slots[existing]=slot;
  else slots.unshift(slot); // 최신 순

  saveSlots(slots);
  document.getElementById('slotSaveMsg').textContent='✅ 저장됐습니다!';
  setTimeout(()=>closeSaveSlotModal(), 800);
}

function openLoadSlotModal(){
  renderSlotList();
  document.getElementById('loadSlotModal').classList.remove('hidden');
}
function closeLoadSlotModal(){
  document.getElementById('loadSlotModal').classList.add('hidden');
}

function renderSlotList(){
  const slots=getSlots();
  const el=document.getElementById('slotList');
  if(!slots.length){
    el.innerHTML='<div class="dir-empty" style="padding:24px;">저장된 대진표가 없습니다.</div>';
    return;
  }
  el.innerHTML=slots.map(s=>{
    const date=new Date(s.savedAt).toLocaleDateString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
    return `<div class="slot-item">
      <div class="slot-info">
        <div class="slot-name">${esc(s.name)}</div>
        <div class="slot-meta">${date} · 선수 ${s.participants}명 · ${s.matches}게임</div>
      </div>
      <div class="slot-actions">
        <button class="slot-btn load" onclick="loadSlot('${s.id}')">불러오기</button>
        <button class="slot-btn del" onclick="deleteSlot('${s.id}')">삭제</button>
      </div>
    </div>`;
  }).join('');
}

function loadSlot(id){
  const slot=getSlots().find(s=>s.id===id);
  if(!slot){alert('저장 데이터를 찾을 수 없습니다.');return;}
  if(!_dailyConfirmDetachLiveBeforeChange('저장 대진표 불러오기'))return;
  if(!confirm(`'${slot.name}' 을 불러올까요?\n현재 작업 내용은 자동저장으로 복원할 수 있습니다.`)) return;
  localStorage.setItem(SAVE_KEY,JSON.stringify(slot.state));
  restoreState();
  closeLoadSlotModal();
  alert(`✅ '${slot.name}' 을 불러왔습니다.`);
}

function deleteSlot(id){
  const slots=getSlots();
  const slot=slots.find(s=>s.id===id);
  if(!slot) return;
  if(!confirm(`'${slot.name}' 저장을 삭제할까요?`)) return;
  saveSlots(slots.filter(s=>s.id!==id));
  renderSlotList();
}

/* ════════════════════════════════
   JSON 내보내기 / 불러오기
════════════════════════════════ */

// 대진표 상태 JSON 내보내기
function exportBracketJson(){
  const raw=localStorage.getItem(SAVE_KEY);
  if(!raw){alert('저장된 대진표가 없습니다.\n대진표를 먼저 생성해주세요.');return;}
  const state=JSON.parse(raw);
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  const date=new Date().toLocaleDateString('ko-KR').replace(/\./g,'').replace(/ /g,'');
  a.download=`배드민턴_대진표_${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// 대진표 상태 JSON 불러오기
function importBracketJson(e){
  const file=e.target.files[0];
  if(!file) return;
  const reader=new FileReader();
  reader.onload=ev=>{
    try{
      const state=JSON.parse(ev.target.result);
      // 유효성 검사
      if(!state.matches||!state.participants){
        alert('올바른 대진표 파일이 아닙니다.');return;
      }
      if(!_dailyConfirmDetachLiveBeforeChange('대진표 파일 불러오기')){e.target.value='';return;}
      if(!confirm(`저장된 대진표를 불러올까요?\n선수 ${state.participants?.length||0}명, 경기 ${state.matches?.length||0}게임\n현재 데이터는 덮어씌워집니다.`)){return;}
      // localStorage에 저장 후 복원
      localStorage.setItem(SAVE_KEY,JSON.stringify(state));
      restoreState();
      alert('✅ 대진표를 불러왔습니다.');
    }catch(err){
      alert('파일 읽기 오류: '+err.message);
    }
    e.target.value='';
  };
  reader.readAsText(file);
}

// 명부 JSON 내보내기 (기존 exportRosters 있으면 통합)
function exportBracketAll(){
  const bracketRaw=localStorage.getItem(SAVE_KEY);
  const rosterRaw=localStorage.getItem(ROSTER_KEY);
  const slotsRaw=localStorage.getItem(SLOTS_KEY);
  const slots=slotsRaw?JSON.parse(slotsRaw):[];
  const combined={
    exportedAt:new Date().toISOString(),
    version:'badminton-all-v2',
    bracket:bracketRaw?JSON.parse(bracketRaw):null,
    roster:rosterRaw?JSON.parse(rosterRaw):null,
    slots:slots.length>0?slots:null,
  };
  const blob=new Blob([JSON.stringify(combined,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  const date=new Date().toLocaleDateString('ko-KR').replace(/\./g,'').replace(/ /g,'');
  const slotSuffix=slots.length>0?`_슬롯${slots.length}개`:'';
  a.download=`배드민턴_전체백업_${date}${slotSuffix}.json`;
  a.click();
  URL.revokeObjectURL(url);
  // 슬롯 포함 여부 알림
  if(slots.length>0){
    setSaveStatus('saved');
    // 잠깐 확인 메시지
    setTimeout(()=>setSaveStatus('',`✓ 저장 슬롯 ${slots.length}개 포함 내보냄`),100);
  }
}

function importBracketAll(e){
  const file=e.target.files[0];
  if(!file) return;
  const reader=new FileReader();
  reader.onload=ev=>{
    try{
      const combined=JSON.parse(ev.target.result);
      if(combined.version==='badminton-all-v1'||combined.version==='badminton-all-v2'){
        const bCount=combined.bracket?.participants?.length||0;
        const rCount=combined.roster?.clubs?.reduce((s,c)=>s+c.members.length,0)||0;
        const sCount=combined.slots?.length||0;
        if(!_dailyConfirmDetachLiveBeforeChange('전체 백업 불러오기')){e.target.value='';return;}
        if(!confirm(
          `전체 백업 불러오기\n`+
          `• 대진표: 선수 ${bCount}명\n`+
          `• 명부: 회원 ${rCount}명\n`+
          (sCount?`• 저장 슬롯: ${sCount}개\n`:'')+
          `\n현재 데이터를 모두 덮어씌울까요?`
        )){e.target.value='';return;}

        if(combined.bracket){
          localStorage.setItem(SAVE_KEY,JSON.stringify(combined.bracket));
        }
        if(combined.roster){
          localStorage.setItem(ROSTER_KEY,JSON.stringify(combined.roster));
          loadRosters();renderClubList();
        }
        // 슬롯 복원 먼저 저장 (restoreState 이전에)
        if(combined.slots&&combined.slots.length){
          const existing=getSlots();
          const existingIds=new Set(existing.map(s=>s.id));
          const newSlots=combined.slots.filter(s=>!existingIds.has(s.id));
          const merged=[...newSlots,...existing].slice(0,MAX_SLOTS);
          saveSlots(merged);
        }
        // restoreState는 마지막에 (자동저장 트리거 방지를 위해 슬롯 저장 후)
        if(combined.bracket){
          restoreState();
        }
        const sMsg=sCount?` + 슬롯 ${sCount}개`:'';
        alert(`✅ 전체 백업을 불러왔습니다.${sMsg}`);
      } else {
        importBracketJson(e);
        return;
      }
    }catch(err){alert('파일 읽기 오류: '+err.message);}
    e.target.value='';
  };
  reader.readAsText(file);
}

function clearSaved(){
  if(!confirm('저장된 대진표를 삭제하시겠습니까?'))return;
  localStorage.removeItem(SAVE_KEY);
  document.getElementById('restoreBtn').classList.add('hidden');
  setSaveStatus('','저장 데이터 삭제됨');
  setTimeout(()=>setSaveStatus(''),3000);
}

/* ═══ 선수 변동 재배정 ═══ */
let _cpExcluded=new Set();
let _cpNewPlayers=[];
let _cpFromRound=null; // 선택한 라운드 (이 라운드부터 재생성). null이면 기존 방식(완료 게임 기준)
let _lockedBeforeRound=null; // 이 라운드 미만은 대진 잠금 (중간 투입 시 설정)

function _isMatchDone(idx){
  const s1=parseInt(document.getElementById('s1_'+idx)?.value)||0;
  const s2=parseInt(document.getElementById('s2_'+idx)?.value)||0;
  const wo=winOverride[idx];
  return(wo==='t1'||wo==='t2')||(s1>0||s2>0);
}
function _readCompletedScoreState(idx){
  const s1=document.getElementById('s1_'+idx);
  const s2=document.getElementById('s2_'+idx);
  return{
    wo:winOverride[idx]||null,
    s1:s1?parseInt(s1.value)||0:0,
    s2:s2?parseInt(s2.value)||0:0
  };
}
function _restoreCompletedScoreState(sc,idx){
  if(!sc)return;
  if(sc.wo)winOverride[idx]=sc.wo;
  const s1=document.getElementById('s1_'+idx);
  const s2=document.getElementById('s2_'+idx);
  if(s1&&sc.s1)s1.value=sc.s1;
  if(s2&&sc.s2)s2.value=sc.s2;
}

/* 라운드 단위 선수 변경: 선택 라운드부터 이후 전부 재생성 */
/* 잠긴 라운드 클릭 시 안내 */
function alertRoundLocked(r){
  alert(`라운드 ${r}은(는) 중간 선수 투입 이후 확정되어 대진을 변경할 수 없습니다.\n\n승/패 입력은 그대로 가능합니다.\n(변경하려면 라운드 ${_lockedBeforeRound} 이상에서 선수 변경을 하세요.)`);
}

function _syncChangeModalTeamPolicy(){
  const isTeam=!!currentSettings?.teamMode;
  const title=document.getElementById('cpNewTitle');
  const addRow=document.getElementById('cpAddRow');
  const notice=document.getElementById('cpTeamJoinNotice');
  const teamSel=document.getElementById('cpNewTeam');
  if(teamSel)teamSel.style.display=isTeam?'':'none';
  if(title)title.style.display=isTeam?'none':'';
  if(addRow)addRow.style.display=isTeam?'none':'flex';
  if(notice)notice.classList.toggle('hidden',!isTeam);
  if(isTeam){
    _cpNewPlayers=[];
    const nameEl=document.getElementById('cpNewName');
    if(nameEl)nameEl.value='';
  }
}

function openRoundChange(r){
  if(!currentMatches.length){alert('먼저 대진표를 생성해주세요.');return;}
  // 잠긴 라운드는 변경 불가
  if(_lockedBeforeRound!=null && r<_lockedBeforeRound){
    alertRoundLocked(r);return;
  }
  _cpFromRound=r;
  _cpExcluded=new Set();
  _cpNewPlayers=[];
  _syncChangeModalTeamPolicy();
  // r 이전 라운드는 유지, r 이후(r 포함) 재생성
  const keepCount=currentMatches.filter(m=>m.round<r).length;
  const regenCount=currentMatches.filter(m=>m.round>=r).length;
  const teamNote=currentSettings.teamMode
    ?'<br><b>팀전 안내:</b> 경기 중 새 선수 추가는 막혀 있습니다. 늦게 온 선수가 있으면 전체 새 대진을 생성하세요.'
    :'';
  document.getElementById('cpInfoBox').innerHTML=
    `<b>라운드 ${r}부터</b> 선수 변경 후 재배정합니다.<br>`+
    `유지: <b>라운드 ${r} 이전 ${keepCount}게임</b> · 재생성: <b>라운드 ${r}~ ${regenCount}게임</b>${teamNote}`;
  _cpRenderPlayerList();
  _cpRenderNewList();
  _cpUpdateSummary();
  document.getElementById('changeModal').classList.remove('hidden');
}

function openChangeModal(){
  if(!currentMatches.length){alert('먼저 대진표를 생성해주세요.');return;}
  _cpFromRound=null;
  _cpExcluded=new Set();
  _cpNewPlayers=[];
  _syncChangeModalTeamPolicy();
  const doneCount=currentMatches.filter((_,i)=>_isMatchDone(i)).length;
  const pendCount=currentMatches.length-doneCount;
  const teamNote=currentSettings.teamMode
    ?'<br><b>팀전 안내:</b> 경기 중 새 선수 추가는 막혀 있습니다. 늦게 온 선수가 있으면 전체 새 대진을 생성하세요.'
    :'';
  document.getElementById('cpInfoBox').innerHTML=
    `완료된 게임: <b>${doneCount}게임</b> — 이 게임은 유지됩니다<br>`+
    `재배정 대상: <b>${pendCount}게임</b> (미완료 게임 이후 재생성)${teamNote}`;
  _cpRenderPlayerList();
  _cpRenderNewList();
  _cpUpdateSummary();
  document.getElementById('changeModal').classList.remove('hidden');
}

function closeChangeModal(){document.getElementById('changeModal').classList.add('hidden');}

let _cpSortByName=false; // false: 입력순, true: 가나다순

function cpToggleSort(){
  _cpSortByName=!_cpSortByName;
  const btn=document.getElementById('cpSortBtn');
  if(btn) btn.textContent=_cpSortByName?'↕ 가나다순':'↕ 입력순';
  _cpRenderPlayerList();
}

function _cpRenderPlayerList(){
  const isTeam=currentSettings.teamMode;
  let list=currentParticipants.slice();
  if(_cpSortByName) list.sort((a,b)=>a.name.localeCompare(b.name,'ko'));
  document.getElementById('cpPlayerList').innerHTML=list.map(p=>{
    const gDone=currentMatches.filter((m,i)=>_isMatchDone(i)&&
      [m.team1A,m.team1B,m.team2C,m.team2D].some(x=>x.name===p.name)).length;
    const teamBadge=isTeam?` · <span style="color:${p.team==='청팀'?'var(--bl)':'var(--dim)'}">${p.team||'미배정'}</span>`:'';
    const excludeBtn=isTeam?'':`<button class="cp-excl-btn${_cpExcluded.has(p.name)?' excluded':''}" data-pname="${esc(p.name)}" onclick="cpToggleExclude(this.dataset.pname)">${_cpExcluded.has(p.name)?'✕ 제외중':'제외'}</button>`;
    return `<div class="cp-player-row">
      <div class="cp-player-name">${esc(p.name)}</div>
      <div class="cp-player-meta"><span>${p.grade||LV_LABEL[p.level]||'?'}</span><span>${p.gender==='M'?'남':'여'}</span><span>${p.ageGroup||'40대'}</span>${teamBadge}</div>
      ${gDone>0?`<span class="cp-done-badge">완료 ${gDone}G</span>`:''}
      ${excludeBtn}
    </div>`;
  }).join('');
}

function cpToggleExclude(name){
  if(_cpExcluded.has(name))_cpExcluded.delete(name);else _cpExcluded.add(name);
  _cpRenderPlayerList();_cpUpdateSummary();
}

function cpAddNewPlayer(){
  if(currentSettings?.teamMode){
    alert('팀전에서는 경기 중 새 선수 추가를 할 수 없습니다.\n\n청/홍팀 균형과 개인별 경기 수가 크게 흔들릴 수 있어, 늦게 온 선수가 있으면 전체 새 대진을 생성해 주세요.');
    return;
  }
  const name=document.getElementById('cpNewName').value.trim();
  if(!name){alert('이름을 입력해주세요.');return;}
  if(currentParticipants.some(p=>p.name===name)||_cpNewPlayers.some(p=>p.name===name)){
    alert(`"${name}"은(는) 이미 있는 이름입니다.`);return;
  }
  const grade=document.getElementById('cpNewGrade').value;
  const gender=document.getElementById('cpNewGender').value;
  const ageGroup=document.getElementById('cpNewAge').value;
  const team=currentSettings.teamMode?document.getElementById('cpNewTeam').value:'';
  const _lvRaw=gradeToLevel(grade,gender);
  const level=(_lvRaw!==null&&_lvRaw!==undefined)?_lvRaw:1;
  _cpNewPlayers.push({name,grade,level,gender,ageGroup,team});
  document.getElementById('cpNewName').value='';
  _cpRenderNewList();_cpUpdateSummary();
}

function cpRemoveNew(idx){_cpNewPlayers.splice(idx,1);_cpRenderNewList();_cpUpdateSummary();}

function _cpRenderNewList(){
  const el=document.getElementById('cpNewList');
  if(!_cpNewPlayers.length){el.innerHTML='<div style="font-size:.72rem;color:var(--dim2);padding:3px 0;">추가된 선수 없음</div>';return;}
  el.innerHTML=_cpNewPlayers.map((p,i)=>
    `<div class="cp-new-row">
      <span style="flex:1;">${esc(p.name)}</span>
      <span style="color:var(--dim);font-size:.71rem;">${p.grade}급 · ${p.gender} · ${p.ageGroup||'40대'}${p.team?' · '+p.team:''}</span>
      <button class="cp-rm-btn" onclick="cpRemoveNew(${i})">✕</button>
    </div>`
  ).join('');
}

function _cpUpdateSummary(){
  const target=currentSettings.gamesPerPlayer||4;
  let remaining=0;
  currentParticipants.forEach(p=>{
    if(_cpExcluded.has(p.name))return;
    const gDone=currentMatches.filter((m,i)=>_isMatchDone(i)&&
      [m.team1A,m.team1B,m.team2C,m.team2D].some(x=>x.name===p.name)).length;
    remaining+=Math.max(0,target-gDone);
  });
  _cpNewPlayers.forEach(()=>remaining+=target);
  const activeCount=currentParticipants.length-_cpExcluded.size+_cpNewPlayers.length;
  const newMatchCount=Math.ceil(remaining/4);
  document.getElementById('cpSummary').textContent=
    `재배정 선수 ${activeCount}명 · 예상 ${newMatchCount}게임`;
}

/* ═══ 다중 시도 → 최고점 선택 헬퍼 (재배정 품질 최적화) ═══ */
// 동일 조건으로 N회 시도 후 품질 점수 최고인 결과 반환
// 시뮬: 5회 시도 시 평균 +0.9점, 10회 +1.4점 (속도/품질 균형상 5회 채택)
function _genBestMatches(activeParticipants, settings, totalNewMatches, tries=5, historyMatches=[]){
  // _bracketQualityScore는 페널티 점수 → 낮을수록 좋은 대진
  const _njNames=new Set(activeParticipants.filter(p=>p.isNewJoiner).map(p=>p.name));
  const _hasNJ=_njNames.size>0;
  const _hasFixedPartner=activeParticipants.some(p=>p.partnerName);
  // 중도 투입·P+ 파트너는 후보별 편차가 크므로 더 깊게 탐색한다.
  const minTries=_hasNJ?Math.max(tries,20):(_hasFixedPartner?Math.max(tries,160):tries);
  // 신규 투입은 최대 200회까지 보되, 공정한 후보를 찾으면 조기 종료한다.
  const maxTries=_hasNJ?Math.max(minTries,200):minTries;
  const _isTeam=!!(settings.teamMode);
  let bestMatches=null, bestParticipants=null, bestKey=null;
  for(let t=0;t<maxTries;t++){
    const pCopy=activeParticipants.map(p=>({...p,
      partnerCount:{...p.partnerCount},opponentCount:{...p.opponentCount}}));
    const m=generateMatches(pCopy,settings,totalNewMatches);
    fillMissingGames(pCopy,settings,m,totalNewMatches);
    _repairParticipation(m,pCopy,settings,historyMatches);
    let score=_bracketQualityScore(m,pCopy,settings);
    // 신규선수 미달 시 강한 페널티 (시뮬: +1.3점 품질 향상)
    if(_hasNJ){
      pCopy.filter(p=>_njNames.has(p.name)).forEach(p=>{
        const miss=Math.max(0,(p._goal!=null?p._goal:settings.gamesPerPlayer)-(p.gamesPlayed||0));
        score+=miss*150;
      });
    }
    // 팀전: 파트너 중복 추가 패널티 (시뮬: 파트너중복 4.8→3.1쌍, +0.7점)
    if(_isTeam){
      const pairCnt={};
      m.forEach(mx=>[[mx.team1A,mx.team1B],[mx.team2C,mx.team2D]].forEach(pair=>{
        const k=[pair[0].name,pair[1].name].sort().join('|');
        pairCnt[k]=(pairCnt[k]||0)+1;
      }));
      score+=Object.values(pairCnt).filter(c=>c>=2).reduce((s,c)=>s+(c-1)*25,0);
    }
    // 완료 경기까지 함께 비교해야 같은 4명·같은 파트너 재등장을 피할 수 있다.
    const qualityMatches=historyMatches.length?[...historyMatches,...m]:m;
    const key=_candidateQualityKey(qualityMatches,pCopy,settings,score);
    if(_isBetterQualityKey(key,bestKey)){bestKey=key;bestMatches=m;bestParticipants=pCopy;}
    const requiredSlots=activeParticipants.reduce((sum,p)=>
      sum+Math.max(0,(p._goal!=null?p._goal:settings.gamesPerPlayer)-(p.gamesPlayed||0)),0);
    const minimumOver=Math.max(0,totalNewMatches*4-requiredSlots);
    if(t+1>=minTries&&bestKey&&bestKey[0]===0&&bestKey[1]===0&&bestKey[2]===0&&bestKey[3]===0)break;
  }
  if(_isTeam&&bestMatches&&bestParticipants){
    _optimizeTeamPairRepeats(bestMatches,bestParticipants,settings);
  }
  return{matches:bestMatches||[],participants:bestParticipants||activeParticipants};
}

/* ═══ 완료 게임에서 대진 기록(상대/파트너) 역산 헬퍼 ═══ */
function _buildHistoryFromMatches(completedMatches){
  const hist={};
  const _inc=(obj,key)=>{obj[key]=(obj[key]||0)+1;};
  completedMatches.forEach(m=>{
    [m.team1A,m.team1B,m.team2C,m.team2D].forEach(p=>{
      if(!hist[p.name])hist[p.name]={partnerCount:{},opponentCount:{}};
    });
    _inc(hist[m.team1A.name].partnerCount,m.team1B.name);
    _inc(hist[m.team1B.name].partnerCount,m.team1A.name);
    _inc(hist[m.team2C.name].partnerCount,m.team2D.name);
    _inc(hist[m.team2D.name].partnerCount,m.team2C.name);
    [m.team1A,m.team1B].forEach(a=>[m.team2C,m.team2D].forEach(b=>{
      _inc(hist[a.name].opponentCount,b.name);
      _inc(hist[b.name].opponentCount,a.name);
    }));
  });
  return hist;
}

/* ═══ 간편 재배정 (선수 변동 없이 현재 구성으로 다시 섞기) ═══ */
/* 특정 라운드부터 재배정 (선수 변경 없이, r 이전 유지) */
function reshuffleFromRound(r){
  if(!currentMatches.length){alert('먼저 대진표를 생성해주세요.');return;}
  if(_lockedBeforeRound!=null && r<_lockedBeforeRound){alertRoundLocked(r);return;}
  // 잠금 라운드 업데이트 → 이후 reshuffleMatches() 반복 시 동일 서명으로 점수 누적 비교
  _lockedBeforeRound = Math.max(_lockedBeforeRound||0, r);

  // r 이전 라운드 유지, r 이후(r 포함) 재생성
  const completedMatches=currentMatches.filter(m=>m.round<r);
  const completedScores=[];
  currentMatches.forEach((m,i)=>{ if(m.round<r) completedScores.push(_readCompletedScoreState(i)); });

  const gDoneMap={};
  completedMatches.forEach(m=>{
    [m.team1A,m.team1B,m.team2C,m.team2D].forEach(p=>{gDoneMap[p.name]=(gDoneMap[p.name]||0)+1;});
  });

  const target=currentSettings.gamesPerPlayer||4;
  const _hist1=_buildHistoryFromMatches(completedMatches);
  const activeParticipants=currentParticipants.map(p=>{
    const wasJoiner=p.isNewJoiner||p._njGames!=null;
    const h=_hist1[p.name]||{partnerCount:{},opponentCount:{}};
    return Object.assign({},p,{
      gamesPlayed:gDoneMap[p.name]||0,
      _goal: wasJoiner ? (p._njGames!=null?p._njGames:target) : target,
      isNewJoiner: wasJoiner,
      _njGames: wasJoiner ? (p._njGames!=null?p._njGames:undefined) : undefined,
      lastRoundPlayed:0,
      womenDoublesPlayed:0,menDoublesPlayed:0,mixedDoublesPlayed:0,adjustmentPlayed:0,
      partnerCount:h.partnerCount,opponentCount:h.opponentCount
    });
  });

  const remaining=activeParticipants.reduce((s,p)=>s+Math.max(0,(p._goal!=null?p._goal:target)-p.gamesPlayed),0);
  const totalNewMatches=Math.ceil(remaining/4);
  if(totalNewMatches===0){alert('재배정할 게임이 없습니다.');return;}

  _captureUndoSnapshot('라운드 재배정 전');
  document.getElementById('loadingOverlay').classList.add('on');
  setTimeout(()=>{
    try{
      _skipNewFirstRound=false;
      const _tries=_autoSearchTries(activeParticipants.length,activeParticipants.some(p=>p.isNewJoiner));
      const {matches:newMatches,participants:bestP1}=_genBestMatches(activeParticipants,currentSettings,totalNewMatches,_tries,completedMatches);
      compactSchedule(newMatches,currentSettings);
      _optimizeFutureRounds(newMatches,currentSettings,_lastCompletedRoundPlayers(completedMatches));
      newMatches.sort((a,b)=>a.round-b.round||a.court-b.court);
      const lastKeepRound=r-1;
      newMatches.forEach(m=>m.round+=lastKeepRound);
      const allMatches=[...completedMatches,...newMatches];
      allMatches.forEach((m,i)=>m.matchNumber=i+1);
      currentMatches=allMatches;
      currentParticipants=bestP1;
      _fastResetState();
      Object.keys(winOverride).forEach(k=>delete winOverride[k]);
      renderResults(currentMatches,currentParticipants,currentSettings);
      setTimeout(()=>{
        completedScores.forEach((sc,i)=>_restoreCompletedScoreState(sc,i));
        _fastStartFresh();
        updateScores();scheduleSave();
      },100);
      const _cw=checkEmptyCourts(newMatches.length?newMatches:allMatches,currentSettings,activeParticipants);
      if(_cw.length){let _msg='⚠ 일부 라운드에 빈 코트가 있습니다\n\n';_cw.forEach(w=>_msg+='• 라운드 '+w.round+': 코트 '+w.emptyCourts.join(', ')+'\n');showWarn(_msg);}else{hideWarn();}
    }catch(err){showErr('재배정 오류: '+err.message);console.error(err);}
    finally{document.getElementById('loadingOverlay').classList.remove('on');_skipNewFirstRound=true;}
  },50);
}

function reshuffleMatches(){
  if(!currentMatches.length){alert('먼저 대진표를 생성해주세요.');return;}
  // 완료된 게임과 변경 잠금 이전 라운드는 유지하고, 나머지만 재생성
  const doneIdxs=[];
  currentMatches.forEach((m,i)=>{
    if(_isMatchDone(i)||(_lockedBeforeRound!=null&&m.round<_lockedBeforeRound))doneIdxs.push(i);
  });
  const completedMatches=doneIdxs.map(i=>currentMatches[i]);
  const completedScores=doneIdxs.map(i=>_readCompletedScoreState(i));

  const gDoneMap={};
  completedMatches.forEach(m=>{
    [m.team1A,m.team1B,m.team2C,m.team2D].forEach(p=>{gDoneMap[p.name]=(gDoneMap[p.name]||0)+1;});
  });

  const target=currentSettings.gamesPerPlayer||4;
  const _hist2=_buildHistoryFromMatches(completedMatches);
  // 현재 참가자 그대로 사용 — 신규선수 목표(_njGames) 보존 (재배정 반복해도 게임수 유지)
  const activeParticipants=currentParticipants.map(p=>{
    const wasJoiner=p.isNewJoiner||p._njGames!=null;
    const h=_hist2[p.name]||{partnerCount:{},opponentCount:{}};
    return Object.assign({},p,{
      gamesPlayed:gDoneMap[p.name]||0,
      _goal: wasJoiner ? (p._njGames!=null?p._njGames:target) : target,
      isNewJoiner: wasJoiner,
      _njGames: wasJoiner ? (p._njGames!=null?p._njGames:undefined) : undefined,
      lastRoundPlayed:0,
      womenDoublesPlayed:0,menDoublesPlayed:0,mixedDoublesPlayed:0,adjustmentPlayed:0,
      partnerCount:h.partnerCount,opponentCount:h.opponentCount
    });
  });

  const remaining=activeParticipants.reduce((s,p)=>s+Math.max(0,(p._goal!=null?p._goal:target)-p.gamesPlayed),0);
  const totalNewMatches=Math.ceil(remaining/4);
  if(totalNewMatches===0){alert('모든 선수가 목표 게임 수를 달성해 재배정할 게임이 없습니다.');return;}

  _captureUndoSnapshot('재배정 전');
  document.getElementById('loadingOverlay').classList.add('on');
  setTimeout(()=>{
    try{
      _skipNewFirstRound=false; // 이미 투입된 선수이므로 1라운드 제외 안 함
      const _tries=_autoSearchTries(activeParticipants.length,activeParticipants.some(p=>p.isNewJoiner));
      const {matches:newMatches,participants:bestP2}=_genBestMatches(activeParticipants,currentSettings,totalNewMatches,_tries,completedMatches);
      compactSchedule(newMatches,currentSettings);
      _optimizeFutureRounds(newMatches,currentSettings,_lastCompletedRoundPlayers(completedMatches));
      newMatches.sort((a,b)=>a.round-b.round||a.court-b.court);
      const lastDoneRound=completedMatches.length?Math.max(...completedMatches.map(m=>m.round)):0;
      // 잠금 라운드를 완료 라운드+1로 동기화 → 서명 일치로 점수 누적 비교 보장
      if(lastDoneRound>0) _lockedBeforeRound=Math.max(_lockedBeforeRound||0, lastDoneRound+1);
      newMatches.forEach(m=>m.round+=lastDoneRound);
      const allMatches=[...completedMatches,...newMatches];
      allMatches.forEach((m,i)=>m.matchNumber=i+1);
      currentMatches=allMatches;
      currentParticipants=bestP2;
      _fastResetState();
      Object.keys(winOverride).forEach(k=>delete winOverride[k]);
      renderResults(currentMatches,currentParticipants,currentSettings);
      setTimeout(()=>{
        completedScores.forEach((sc,i)=>_restoreCompletedScoreState(sc,i));
        _fastStartFresh();
        updateScores();scheduleSave();
        (document.getElementById('qualDash')||document.getElementById('resultArea')).scrollIntoView({behavior:'smooth',block:'start'});},100);
      const _cw=checkEmptyCourts(newMatches.length?newMatches:allMatches,currentSettings,activeParticipants);
      if(_cw.length){let _msg='⚠ 일부 라운드에 빈 코트가 있습니다\n\n';_cw.forEach(w=>_msg+='• 라운드 '+w.round+': 코트 '+w.emptyCourts.join(', ')+'\n');showWarn(_msg);}else{hideWarn();}
    }catch(err){showErr('재배정 오류: '+err.message);console.error(err);}
    finally{document.getElementById('loadingOverlay').classList.remove('on');_skipNewFirstRound=true;}
  },50);
}

function executeChangeModal(){
  if(currentSettings?.teamMode&&_cpNewPlayers.length){
    alert('팀전에서는 경기 중 새 선수 추가를 할 수 없습니다.\n\n추가된 선수를 비우고 재배정하거나, 전체 새 대진을 생성해 주세요.');
    _cpNewPlayers=[];
    _cpRenderNewList();
    _cpUpdateSummary();
    return;
  }
  // 1. 유지할 게임 결정
  let completedMatches, completedScores, doneIdxs;
  if(_cpFromRound!==null){
    // 라운드 기준: 선택 라운드 이전(<r)은 유지, 이후(>=r)는 재생성
    doneIdxs=[];
    currentMatches.forEach((m,i)=>{ if(m.round<_cpFromRound) doneIdxs.push(i); });
    completedMatches=doneIdxs.map(i=>currentMatches[i]);
    completedScores=doneIdxs.map(i=>_readCompletedScoreState(i));
  } else {
    // 기존 방식: 점수 입력된 완료 게임 유지
    doneIdxs=[];
    currentMatches.forEach((_,i)=>{if(_isMatchDone(i))doneIdxs.push(i);});
    completedMatches=doneIdxs.map(i=>currentMatches[i]);
    completedScores=doneIdxs.map(i=>_readCompletedScoreState(i));
  }

  // 2. 완료 게임당 선수별 gamesPlayed 집계
  const gDoneMap={};
  completedMatches.forEach(m=>{
    [m.team1A,m.team1B,m.team2C,m.team2D].forEach(p=>{
      gDoneMap[p.name]=(gDoneMap[p.name]||0)+1;
    });
  });

  // 3. 활성 선수 목록 구성
  const target=currentSettings.gamesPerPlayer||4;

  // 진행 라운드 및 잔여율 계산 (신규 선수 게임수 산정용)
  const totalRounds=currentMatches.length?Math.max(...currentMatches.map(m=>m.round)):0;
  // 라운드 기준이면 (선택 라운드-1)까지 진행된 것으로, 아니면 완료 게임 최대 라운드
  const doneRoundMax=_cpFromRound!==null
    ? (_cpFromRound-1)
    : (completedMatches.length?Math.max(...completedMatches.map(m=>m.round)):0);
  // 잔여율 = 남은 라운드 / 전체 라운드
  const remainRatio=totalRounds>0?Math.max(0,(totalRounds-doneRoundMax)/totalRounds):1;
  // 신규선수 목표게임 = D공식: 잔여율 기반 vs 코트슬롯 기반 중 보수적(작은) 값, 최소 1
  // - 잔여율 기반: ceil(잔여율 × target)
  // - 코트슬롯 기반: round((남은라운드 × 코트수 × 4) / 전체선수수)
  //   → 남은 슬롯을 전체 선수에게 공정 분배 시 신규선수 몫
  // 시뮬 결과: R6+ 투입 시 보완게임 5→2~3개, 초과인원 0으로 감소
  const _remRounds=totalRounds-doneRoundMax;
  const _courts=currentSettings.courts||3;
  const _nPlayers=(currentParticipants.length||20)+_cpNewPlayers.length;
  const _slotFair=_nPlayers>0?Math.round(_remRounds*_courts*4/_nPlayers):target;
  const newJoinerGames=Math.min(target,Math.max(1,Math.min(Math.ceil(remainRatio*target),_slotFair)));

  const _hist3=_buildHistoryFromMatches(completedMatches);
  const activeParticipants=[];
  currentParticipants.forEach(p=>{
    if(_cpExcluded.has(p.name))return;
    // 이미 투입된 신규선수는 원래 목표(_njGames) 유지 — 재배정 반복해도 4게임으로 늘지 않음
    const wasJoiner=p.isNewJoiner||p._njGames!=null;
    const h=_hist3[p.name]||{partnerCount:{},opponentCount:{}};
    activeParticipants.push(Object.assign({},p,{
      gamesPlayed:gDoneMap[p.name]||0,
      _goal: wasJoiner ? (p._njGames!=null?p._njGames:newJoinerGames) : target,
      isNewJoiner: wasJoiner, // 딱지 유지
      _njGames: wasJoiner ? (p._njGames!=null?p._njGames:newJoinerGames) : undefined,
      lastRoundPlayed:0,
      womenDoublesPlayed:0,menDoublesPlayed:0,mixedDoublesPlayed:0,adjustmentPlayed:0,
      partnerCount:h.partnerCount,opponentCount:h.opponentCount
    }));
  });
  _cpNewPlayers.forEach(np=>{
    activeParticipants.push({
      name:np.name,level:np.level,grade:np.grade,
      gender:np.gender==='남'?'M':'F',
      team:np.team||'',
      // 신규 선수: gamesPlayed=0, 개인 목표(_goal)만 잔여율 기반으로 낮춤
      gamesPlayed:0,
      _goal:newJoinerGames,
      lastRoundPlayed:0,
      womenDoublesPlayed:0,menDoublesPlayed:0,mixedDoublesPlayed:0,adjustmentPlayed:0,
      partnerCount:{},opponentCount:{},
      _valid:true,isNewJoiner:true,_njGames:newJoinerGames
    });
  });
  if(activeParticipants.length<4){alert('재배정에 최소 4명이 필요합니다.');return;}
  if(currentSettings.teamMode){
    const b=activeParticipants.filter(p=>p.team==='청팀');
    const w=activeParticipants.filter(p=>p.team==='홍팀');
    if(b.length<2){alert('팀 모드: 청팀 최소 2명이 필요합니다.');return;}
    if(w.length<2){alert('팀 모드: 홍팀 최소 2명이 필요합니다.');return;}
  }

  // 4. 새 경기 수 계산 — 선수별 목표(_goal) 기준 잔여 합
  const remaining=activeParticipants.reduce((s,p)=>s+Math.max(0,(p._goal!=null?p._goal:target)-p.gamesPlayed),0);
  const totalNewMatches=Math.ceil(remaining/4); // 목표를 담는 최소 경기 수
  if(totalNewMatches===0){alert('모든 선수가 이미 목표 게임 수를 달성했습니다.');closeChangeModal();return;}

  document.getElementById('loadingOverlay').classList.add('on');
  _captureUndoSnapshot('선수 변동 재배정 전');
  closeChangeModal();
  setTimeout(()=>{
    try{
      // 라운드 직접 선택이면 신규선수 1라운드 제외 끔 (선택 라운드부터 바로 투입)
      _skipNewFirstRound = (_cpFromRound===null);
      // 5. 새 경기 생성: 한 번에 여러 후보를 비교해 최고 대진 선택
      const _tries=_autoSearchTries(activeParticipants.length,activeParticipants.some(p=>p.isNewJoiner));
      const {matches:newMatches,participants:bestP3}=_genBestMatches(activeParticipants,currentSettings,totalNewMatches,_tries,completedMatches);
      compactSchedule(newMatches,currentSettings);
      _optimizeFutureRounds(newMatches,currentSettings,_lastCompletedRoundPlayers(completedMatches));
      newMatches.sort((a,b)=>a.round-b.round||a.court-b.court);

      // 6. 라운드 번호 이어붙이기
      const lastDoneRound=_cpFromRound!==null
        ? (_cpFromRound-1)
        : (completedMatches.length?Math.max(...completedMatches.map(m=>m.round)):0);
      newMatches.forEach(m=>m.round+=lastDoneRound);

      // 7. 전체 매치 번호 재부여
      const allMatches=[...completedMatches,...newMatches];
      allMatches.forEach((m,i)=>m.matchNumber=i+1);

      currentMatches=allMatches;
      currentParticipants=bestP3;
      _fastResetState();

      // 라운드 기준 + 신규 선수 투입 시: 선택 라운드 이전을 대진 잠금
      if(_cpFromRound!=null && _cpNewPlayers.length>0){
        // 기존 잠금보다 앞쪽이면 갱신하지 않음 (가장 마지막 투입 기준 유지)
        _lockedBeforeRound = Math.max(_lockedBeforeRound||0, _cpFromRound);
      }
      _cpExcluded.forEach(name=>{
        const idx=_directPlayers.findIndex(p=>p.name===name);
        if(idx>=0)_directPlayers.splice(idx,1);
      });
      _cpNewPlayers.forEach(np=>{
        if(!_directPlayers.some(p=>p.name===np.name))
          _directPlayers.push({name:np.name,grade:np.grade,level:np.level,gender:np.gender,team:np.team||''});
      });
      renderDirectPlayerList();

      renderResults(currentMatches,currentParticipants,currentSettings);
      show('resultArea');

      // 9. 완료된 게임 점수 복원 + winOverride 복원
      setTimeout(()=>{
        Object.keys(winOverride).forEach(k=>delete winOverride[k]);
        completedScores.forEach((sc,i)=>_restoreCompletedScoreState(sc,i));
        _fastStartFresh();
        updateScores();
        scheduleSave();
        (document.getElementById('qualDash')||document.getElementById('resultArea')).scrollIntoView({behavior:'smooth',block:'start'});
      },100);

      // 빈 코트 경고
      const _cw=checkEmptyCourts(newMatches.length?newMatches:allMatches,currentSettings,activeParticipants);
      if(_cw.length){
        let _msg='⚠ 일부 라운드에 빈 코트가 있습니다\n\n';
        _cw.forEach(w=>_msg+='• 라운드 '+w.round+': 코트 '+w.emptyCourts.join(', ')+'\n');
        showWarn(_msg);
      }else{hideWarn();}
    }catch(err){showErr('재배정 오류: '+err.message);console.error(err);}
    finally{
      document.getElementById('loadingOverlay').classList.remove('on');
      _skipNewFirstRound=true; // 플래그 복원
      _cpFromRound=null;       // 라운드 선택 초기화
    }
  },50);
}

/* ═══ UI UTILS ═══ */
function showTab(tab){
  document.querySelectorAll('.res-tab').forEach((t,i)=>t.classList.toggle('active',['bracket','players','summary'][i]===tab));
  document.getElementById('tabBracket').classList.toggle('hidden',tab!=='bracket');
  document.getElementById('tabPlayers').classList.toggle('hidden',tab!=='players');
  document.getElementById('tabSummary').classList.toggle('hidden',tab!=='summary');
  if(tab==='summary') renderTodaySummary();
}

/* ═══ 오늘의 요약 (전적·MVP·개인 카드) ═══ */
function renderTodaySummary(){
  const el=document.getElementById('tabSummary');
  if(!currentMatches.length){ el.innerHTML='<div class="ts-empty">대진표를 먼저 생성하세요.</div>'; return; }
  const stat={};
  const goalOf={}; // 선수별 목표 게임 수
  currentParticipants.forEach(p=>{
    stat[p.name]={name:p.name, w:0, l:0, games:0, countedGames:0, extraGames:0, partners:{}};
    goalOf[p.name] = (p._goal!=null?p._goal:(currentSettings.gamesPerPlayer||4));
  });
  // 라운드·경기 순서대로 처리 (앞 경기부터 = 본인 1,2,3...번째 게임)
  const ordered=currentMatches.map((m,i)=>({m,i})).sort((a,b)=> (a.m.round-b.m.round) || (a.m.court-b.m.court));
  let doneCount=0, totalRatedSlots=0;
  const playedCnt={}; // 선수별 누적 출전 (목표 이내 판정용)
  currentParticipants.forEach(p=>playedCnt[p.name]=0);

  ordered.forEach(({m,i})=>{
    const wo=winOverride[i];
    const t1=[m.team1A,m.team1B], t2=[m.team2C,m.team2D];
    const four=[...t1,...t2];
    const addPartner=(a,b)=>{ if(stat[a.name]) stat[a.name].partners[b.name]=(stat[a.name].partners[b.name]||0)+1; };
    addPartner(t1[0],t1[1]); addPartner(t1[1],t1[0]); addPartner(t2[0],t2[1]); addPartner(t2[1],t2[0]);
    // 이 경기가 각 선수에게 목표 이내(전적 포함)인지 판정
    const within={};
    four.forEach(p=>{
      if(!stat[p.name]) return;
      playedCnt[p.name]++;
      stat[p.name].games++;
      const ok = playedCnt[p.name] <= goalOf[p.name]; // 목표 이내 게임만 전적
      within[p.name]=ok;
      if(ok) stat[p.name].countedGames++; else stat[p.name].extraGames++;
    });
    if(!wo) return;
    doneCount++;
    const winners = wo==='t1'?t1:t2, losers = wo==='t1'?t2:t1;
    winners.forEach(p=>{ if(stat[p.name] && within[p.name]) stat[p.name].w++; });
    losers.forEach(p=>{ if(stat[p.name] && within[p.name]) stat[p.name].l++; });
  });
  const arr=Object.values(stat).filter(s=>s.games>0);
  if(!arr.length){ el.innerHTML='<div class="ts-empty">참가자 정보가 없습니다.</div>'; return; }
  // 진행률: 결과 입력된 경기 / 전체 경기
  const totalMatches=currentMatches.length;
  const enteredCnt=currentMatches.filter((_,i)=>winOverride[i]).length;
  const enteredPct = totalMatches? Math.round(enteredCnt/totalMatches*100):0;
  const anyExtra = arr.some(s=>s.extraGames>0);
  const rated=arr.filter(s=>(s.w+s.l)>0);
  const byWin=[...rated].sort((a,b)=> b.w-a.w || (b.w/(b.w+b.l))-(a.w/(a.w+a.l)) );
  const byRate=[...rated].sort((a,b)=> (b.w/(b.w+b.l))-(a.w/(a.w+a.l)) || b.w-a.w );
  const rateStr=(s)=> (s.w+s.l)>0? Math.round(s.w/(s.w+s.l)*100)+'%':'—';
  // 공동 순위 판정: 같은 승수 AND 같은 승률(반올림)
  const sameRank=(a,b)=> a.w===b.w && (a.w+a.l>0) && (b.w+b.l>0) && Math.round(a.w/(a.w+a.l)*100)===Math.round(b.w/(b.w+b.l)*100);
  // MVP = 승률 최고, 공동이면 모두
  let mvpPool=[];
  if(byRate.length){ const top=byRate[0]; mvpPool=byRate.filter(s=>sameRank(s,top)); }
  // 최다승 = 승수 최고, 공동이면 모두
  let mostPool=[];
  if(byWin.length){ const topW=byWin[0].w; mostPool=byWin.filter(s=>s.w===topW); }
  const joinNames=(list)=> list.map(s=>esc(s.name)).join(', ');

  let html=`<div class="ts-progress">결과 입력 <b>${enteredCnt}/${totalMatches}</b> 경기 (${enteredPct}%)${enteredPct<100?' · 입력할수록 정확해집니다':''}${anyExtra?`<br><span style="font-size:.66rem;color:var(--dim2)">※ 목표 게임 수 초과분(보완게임 등)은 전적에서 제외</span>`:''}</div>`;
  if(mvpPool.length){
    const m0=mvpPool[0], w0=mostPool[0];
    html+=`<div class="ts-highlight">
      <div class="ts-hl-card ts-mvp">
        <div class="ts-hl-label">🏆 오늘의 MVP${mvpPool.length>1?` (공동 ${mvpPool.length}명)`:''}</div>
        <div class="ts-hl-name">${joinNames(mvpPool)}</div>
        <div class="ts-hl-sub">${m0.w}승 ${m0.l}패 · 승률 ${rateStr(m0)}</div>
      </div>
      <div class="ts-hl-card ts-most">
        <div class="ts-hl-label">🔥 최다승${mostPool.length>1?` (공동 ${mostPool.length}명)`:''}</div>
        <div class="ts-hl-name">${joinNames(mostPool)}</div>
        <div class="ts-hl-sub">${w0.w}승 ${w0.l}패</div>
      </div>
    </div>`;
  }
  html+=`<div class="ts-rank-title">전적 순위</div><div class="ts-rank">`;
  // 공동 순위(1,1,3 방식)로 메달 부여
  let rankNum=0, prevS=null;
  byWin.forEach((s,i)=>{
    if(prevS===null || !sameRank(s,prevS)) rankNum=i+1;
    prevS=s;
    const medalStr = rankNum===1?'🥇':rankNum===2?'🥈':rankNum===3?'🥉':`${rankNum}`;
    html+=`<div class="ts-rank-row${rankNum<=3?' ts-top':''}">
      <span class="ts-rank-medal">${medalStr}</span>
      <span class="ts-rank-name">${esc(s.name)}</span>
      <span class="ts-rank-record">${s.w}승 ${s.l}패</span>
      <span class="ts-rank-rate">${rateStr(s)}</span>
    </div>`;
  });
  const noResult=arr.filter(s=>(s.w+s.l)===0);
  if(noResult.length){
    html+=`<div class="ts-rank-row ts-noresult"><span class="ts-rank-medal">·</span><span class="ts-rank-name" style="color:var(--dim2)">결과 대기: ${noResult.map(s=>esc(s.name)).join(', ')}</span></div>`;
  }
  html+=`</div>`;
  html+=`<div class="ts-rank-title">개인별 상세</div><div class="ts-personal">`;
  byWin.concat(noResult).forEach(s=>{
    const partners=Object.entries(s.partners).sort((a,b)=>b[1]-a[1]).map(([n,c])=>esc(n)+(c>1?` ×${c}`:'')).join(', ')||'—';
    html+=`<div class="ts-person-card">
      <div class="ts-person-head"><span class="ts-person-name">${esc(s.name)}</span><span class="ts-person-rec">${s.w}승 ${s.l}패${s.extraGames>0?` <span style="color:var(--dim2)">(+초과 ${s.extraGames})</span>`:''}</span></div>
      <div class="ts-person-partners">함께한 파트너: ${partners}</div>
    </div>`;
  });
  html+=`</div>`;
  el.innerHTML=html;
}

function show(id){document.getElementById(id).classList.remove('hidden');}
function set(id,v){const el=document.getElementById(id);if(el)el.textContent=v;}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;');}
function showErr(m){const b=document.getElementById('errBar');b.textContent=m;b.classList.add('on');setTimeout(()=>b.classList.remove('on'),7000);}
function hideErr(){document.getElementById('errBar').classList.remove('on');}
function showWarn(m){const b=document.getElementById('warnBar');if(!b)return;b.textContent=m;b.classList.add('on');}
function hideWarn(){const b=document.getElementById('warnBar');if(b)b.classList.remove('on');}
function resetAll(){
  if(!_dailyConfirmDetachLiveBeforeChange('전체 초기화'))return;
  if(currentMatches.length || _directPlayers.length) _captureUndoSnapshot('전체 초기화 전');
  const _ps=document.getElementById('parseStatus');if(_ps)_ps.textContent='';
  document.getElementById('teamListWrap').classList.remove('show');
  document.getElementById('teamAssignBtn').classList.remove('done');
  document.getElementById('teamAssignBtn').classList.add('hidden');
  document.getElementById('teamAssignBtn').innerHTML='⚖️ 청/홍팀 자동 배정 <span style="font-size:.7rem;opacity:.6">(선택)</span>';
  const rbtn=document.getElementById('teamReassignBtn');
  if(rbtn) rbtn.classList.add('hidden');
  teamAssignment=null;_teamModeOverride=false;_teamWanted=false;captains={blue:{leader:'',sub:''},white:{leader:'',sub:''}};
  setOperationPreset('daily');
  _partners=[];_partnerSelectMode=false;_partnerSelectName=null;
  currentMatches=[];currentParticipants=[];currentSettings={};
  _fastResetState();
  Object.keys(winOverride).forEach(k=>delete winOverride[k]);
  teamNames={blue:'청 팀',white:'홍 팀'};
  document.getElementById('blueNameInput').value='청 팀';
  document.getElementById('whiteNameInput').value='홍 팀';
  document.getElementById('sbBlueName').value='청 팀';
  document.getElementById('sbWhiteName').value='홍 팀';
  updateTeamModeBadge();
  document.getElementById('resultArea').classList.add('hidden');
  hideErr();setSaveStatus('');
  window.scrollTo({top:0,behavior:'smooth'});
  // 직접입력 초기화
  _directPlayers=[];
  renderDirectPlayerList();
  // (직접입력 전용 모드 — 별도 전환 불필요)
}


/* ═══ DIRECT ENTRY ═══ */
let _dirGrade = 'C';
let _dirGender = '남';
let _dirAge = '40대';
let _directPlayers = [];
let _dirSort = 'reg'; // 'reg' | 'name' | 'level'

function setDirSort(mode){
  _dirSort = mode;
  ['reg','name','level'].forEach(m=>{
    const btn=document.getElementById('dsb-'+m);
    if(btn) btn.classList.toggle('active', m===mode);
  });
  renderDirectPlayerList();
}

function gradeToLevel(grade,gender){
  const G={'S':7,'A':6,'B':5,'C':4,'D':3,'E':2};
  const g=(grade||'').toUpperCase();
  const isF=gender==='여'||gender==='F';
  if(g in G) return Math.max(1, isF?G[g]-1:G[g]); // 최솟값 1 보장
  return null;
}
function levelToGrade(level,gender){
  const isF=gender==='F'||gender==='여';
  const el=isF?level+1:level;
  const M={7:'S',6:'A',5:'A',4:'B',3:'C',2:'D',1:'E'};
  return M[Math.max(1,Math.min(7,Math.round(el)))]||'D';
}

function setInputMode(mode){ /* 미사용 — 직접입력 전용 */ }

function selectDirAge(age){
  _dirAge = age;
  document.querySelectorAll('#dirAgeBtns .age-sel-btn').forEach(b=>
    b.classList.toggle('sel', b.dataset.age===age));
}
function selectDirGrade(grade){
  _dirGrade = grade;
  document.querySelectorAll('#dirGradeBtns .lv-sel-btn').forEach(b=>
    b.classList.toggle('sel', b.dataset.grade===grade));
}

function selectDirGender(g){
  _dirGender = g;
  document.querySelectorAll('.gender-sel-btn').forEach(b=>{
    const isThis = b.dataset.gender === g;
    b.classList.remove('sel-m','sel-f');
    if(isThis) b.classList.add(g==='남'?'sel-m':'sel-f');
  });
}

let _isGuest = false;

// 파트너 시스템: [{id:'p1', members:['이름A','이름B'], color:'#...'}]
let _partners = [];
const PARTNER_COLORS = [
  '#ef4444','#3b82f6','#22c55e','#f97316','#a855f7',
  '#ec4899','#14b8a6','#eab308','#6366f1','#64748b'
];

function getPartnerInfo(name){
  const pair = _partners.find(p=>p.members.includes(name));
  return pair || null;
}
function getPartnerOf(name){
  const pair = getPartnerInfo(name);
  if(!pair) return null;
  return pair.members.find(m=>m!==name) || null;
}
function _attachPartnerNames(players){
  if(!Array.isArray(players))return players;
  players.forEach(p=>{
    const pair=getPartnerInfo(p.name);
    if(!pair)return;
    p.partnerName=pair.members.find(m=>m!==p.name)||p.partnerName||null;
    p.partnerId=pair.id||p.partnerId||null;
  });
  return players;
}

function _teamAssignmentHasSplitPartners(){
  if(!teamAssignment)return false;
  const blue=new Set((teamAssignment.blue||[]).map(p=>p.name));
  const white=new Set((teamAssignment.white||[]).map(p=>p.name));
  return _partners.some(pair=>{
    const [a,b]=pair.members;
    return (blue.has(a)&&white.has(b))||(white.has(a)&&blue.has(b));
  });
}

let _partnerSelectMode = false; // 파트너 선택 중인 선수 이름
let _partnerSelectName = null;

function toggleGuestMode(){
  _isGuest = !_isGuest;
  const btn = document.getElementById('guestBtn');
  if(_isGuest){
    btn.classList.add('on');
    btn.title = '게스트 모드 켜짐 — 클릭해서 해제';
    document.getElementById('dirName').placeholder = '게스트 이름 입력';
  } else {
    btn.classList.remove('on');
    btn.title = '게스트로 추가';
    document.getElementById('dirName').placeholder = '이름 입력';
  }
}

function addDirectPlayer(){
  const nameEl = document.getElementById('dirName');
  const name = nameEl.value.trim();
  if(!name){ nameEl.focus(); return; }
  if(_directPlayers.some(p=>p.name===name)){
    nameEl.select();
    const st=document.getElementById('parseStatus');
    st.style.color='var(--red)';st.textContent=`"${name}"은 이미 추가되어 있습니다`;
    setTimeout(()=>{st.textContent='';},2000);
    return;
  }
  const _newLv = gradeToLevel(_dirGrade, _dirGender) ?? 1;
  _directPlayers.push({name, grade:_dirGrade, level:_newLv, gender:_dirGender, isGuest:_isGuest, ageGroup:_dirAge});
  nameEl.value='';
  nameEl.focus();
  renderDirectPlayerList();
  syncDirectToPaste();
}

function importDirectFromDaily(){
  if(currentMatches.length){
    alert('이미 대진이 생성되어 있습니다. 기록 보호를 위해 민턴LIVE 명단은 대진 생성 전에 가져와 주세요.');
    return;
  }
  if(!_dailyPlayers.length){
    alert('민턴LIVE 명단이 비어 있습니다. 민턴LIVE에서 현장 참가자를 먼저 등록하세요.');
    return;
  }
  const candidates=_dailyPlayers.filter(p=>p.status!=='done');
  if(!candidates.length){
    alert('가져올 민턴LIVE 선수가 없습니다. 종료 처리된 선수는 제외됩니다.');
    return;
  }
  const existing=new Set(_directPlayers.map(p=>p.name));
  let added=0, skipped=0;
  candidates.forEach(p=>{
    const name=(p.name||'').trim();
    if(!name||existing.has(name)){skipped++;return;}
    const gender=_dailyGenderLabel(p.gender);
    const grade=p.grade||levelToGrade(p.level||4,gender)||'C';
    const level=p.level||gradeToLevel(grade,gender)||4;
    _directPlayers.push({
      name,
      grade,
      level,
      gender,
      memberId:p.memberId||'',
      club:p.club||'',
      isGuest:!!p.isGuest,
      isClubOfficial:!!p.isClubOfficial,
      ageGroup:p.ageGroup||'40대'
    });
    existing.add(name);
    added++;
  });
  renderDirectPlayerList();
  syncDirectToPaste();
  if(added)setOperationPreset(inferOperationPreset());
  alert(added?`${added}명을 팀전LIVE 참가자로 가져왔습니다.${skipped?` (중복 ${skipped}명 제외)`:''}`:'새로 가져온 선수가 없습니다.');
}

// ── 직접입력 선수 편집 ──
let _editDirIdx = -1;
let _editDirGrade = 'C';
let _editDirGender = '남';
let _editDirAge = '40대';

function openEditDirectPlayer(idx){
  const p = _directPlayers[idx];
  if(!p) return;
  _editDirIdx = idx;
  _editDirGrade = p.grade || 'C';
  _editDirGender = p.gender || '남';
  _editDirAge = p.ageGroup || '40대';
  document.getElementById('editDirectName').value = p.name;
  document.getElementById('editDirErrMsg').textContent = '';
  document.querySelectorAll('#editDirGradeBtns .lv-sel-btn').forEach(b=>b.classList.toggle('sel',b.dataset.grade===_editDirGrade));
  document.querySelectorAll('#editDirGenderBtns .gender-sel-btn').forEach(b=>{
    b.classList.remove('sel-m','sel-f');
    if(b.dataset.gender===_editDirGender) b.classList.add(_editDirGender==='남'?'sel-m':'sel-f');
  });
  document.querySelectorAll('#editDirAgeBtns .age-sel-btn').forEach(b=>b.classList.toggle('sel',b.dataset.age===_editDirAge));
  document.getElementById('editDirectModal').classList.remove('hidden');
  setTimeout(()=>document.getElementById('editDirectName').focus(),120);
}
function closeEditDirectModal(){
  document.getElementById('editDirectModal').classList.add('hidden');
  _editDirIdx = -1;
}
function selectEditDirGrade(grade){
  _editDirGrade=grade;
  document.querySelectorAll('#editDirGradeBtns .lv-sel-btn').forEach(b=>b.classList.toggle('sel',b.dataset.grade===grade));
}
function selectEditDirGender(g){
  _editDirGender=g;
  document.querySelectorAll('#editDirGenderBtns .gender-sel-btn').forEach(b=>{
    b.classList.remove('sel-m','sel-f');
    if(b.dataset.gender===g) b.classList.add(g==='남'?'sel-m':'sel-f');
  });
}
function selectEditDirAge(age){
  _editDirAge=age;
  document.querySelectorAll('#editDirAgeBtns .age-sel-btn').forEach(b=>b.classList.toggle('sel',b.dataset.age===age));
}
function saveEditDirectPlayer(){
  if(_editDirIdx<0) return;
  const name = document.getElementById('editDirectName').value.trim();
  const errEl = document.getElementById('editDirErrMsg');
  if(!name){ errEl.textContent='이름을 입력해주세요.'; return; }
  const newLevel = gradeToLevel(_editDirGrade, _editDirGender) ?? 1;
  _directPlayers[_editDirIdx] = {
    ..._directPlayers[_editDirIdx],
    name, grade:_editDirGrade, level:newLevel,
    gender:_editDirGender, ageGroup:_editDirAge
  };
  closeEditDirectModal();
  renderDirectPlayerList();
  syncDirectToPaste();
  saveState();
}

function removeDirectPlayer(idx){
  _captureUndoSnapshot('선수 삭제: '+(_directPlayers[idx]?.name||''));
  _directPlayers.splice(idx,1);
  renderDirectPlayerList();
  syncDirectToPaste();
}

function renderDirectPlayerList(){
  const list = document.getElementById('directPlayerList');
  const bar  = document.getElementById('dirCountBar');
  const sortBar = document.getElementById('dirSortBar');
  const partnerHint = document.getElementById('partnerHint');
  const syncPartnerHint=()=>{
    if(!partnerHint)return;
    const activeNames=new Set(_directPlayers.map(p=>p.name));
    const activePairs=_partners.filter(pair=>pair.members.every(n=>activeNames.has(n)));
    if(!activePairs.length){
      partnerHint.classList.remove('show');
      partnerHint.innerHTML='';
      return;
    }
    const pairText=activePairs.map(pair=>pair.members.map(esc).join('·')).join(', ');
    partnerHint.innerHTML=`P 파트너 ${activePairs.length}쌍: ${pairText}<br>대진 생성 시 같은 편으로 고정 배정됩니다. 강한 조건이라 점수가 조금 낮아져도 정상일 수 있습니다.`;
    partnerHint.classList.add('show');
  };
  if(!_directPlayers.length){
    list.innerHTML = '<div class="dir-empty">아직 추가된 선수가 없습니다</div>';
    bar.className = 'dir-count-bar';
    if(sortBar) sortBar.style.display='none';
    if(partnerHint){partnerHint.classList.remove('show');partnerHint.innerHTML='';}
    if(typeof rsvpSyncRosterChange==='function')rsvpSyncRosterChange();
    return;
  }
  bar.textContent = `✓ ${_directPlayers.length}명 등록됨`;
  bar.className = 'dir-count-bar show';
  if(sortBar) sortBar.style.display='flex';
  syncPartnerHint();

  // 정렬: 원본 인덱스 보존해서 삭제 시 정확하게 처리
  const indexed = _directPlayers.map((p,i)=>({...p, _origIdx:i}));
  if(_dirSort==='name'){
    indexed.sort((a,b)=>a.name.localeCompare(b.name,'ko'));
  } else if(_dirSort==='level'){
    indexed.sort((a,b)=>b.level-a.level || a.name.localeCompare(b.name,'ko'));
  }
  // 'reg' 는 등록순 그대로

  const LV_COLOR={7:'lv6',6:'lv6',5:'lv5',4:'lv4',3:'lv3',2:'lv2',1:'lv1',0:'lv1'};
  list.innerHTML = indexed.map((p)=>{
    const pair=getPartnerInfo(p.name);
    const pBadge=pair?`<span class="partner-badge" style="background:${pair.color}" title="파트너: ${getPartnerOf(p.name)}" onclick="removePartner('${esc(p.name)}')">P</span>`:'';
    const gBadge=p.isGuest?'<span class="guest-badge">G</span>':'';
    const officialBadge=p.isClubOfficial?'<span class="club-official-badge">임원</span>':'';
    const isSelecting=_partnerSelectName===p.name;
    const isTarget=_partnerSelectMode&&_partnerSelectName!==p.name&&!pair&&!getPartnerInfo(_partnerSelectName)?.members.includes(p.name);
    const itemCls=`dir-player-item${isSelecting?' partner-selecting':isTarget?' partner-target':''}`;
    const pBtn=pair
      ?`<button class="dpi-partner-btn" onclick="removePartner('${esc(p.name)}')" title="파트너 해제">P✕</button>`
      :_partnerSelectName===p.name
        ?`<button class="dpi-partner-btn" style="border-color:#ef4444;color:#ef4444;" onclick="cancelPartnerSelect()">취소</button>`
        :_partnerSelectMode&&!pair
          ?`<button class="dpi-partner-btn" style="border-color:#22c55e;color:#22c55e;" onclick="confirmPartner('${esc(p.name)}')">P선택</button>`
          :!pair?`<button class="dpi-partner-btn" onclick="startPartnerSelect('${esc(p.name)}')">P+</button>`:'';
    const ageBadge=p.ageGroup?`<span class="age-badge">${p.ageGroup}</span>`:`<span class="age-badge">40대</span>`;
    return `<div class="${itemCls}" id="dpi-${p._origIdx}">
      <span class="dpi-name">${esc(p.name)}${gBadge}${officialBadge}${pBadge}${ageBadge}</span>
      <span class="dpi-meta">
        <span class="lv-badge ${LV_COLOR[p.level]||'lv3'}">${p.grade||LV_LABEL[p.level]||'?'}</span>
        ${p.gender}</span>
      ${pBtn}
      <button class="dpi-edit" onclick="openEditDirectPlayer(${p._origIdx})" title="편집" style="background:none;border:none;cursor:pointer;color:var(--dim);font-size:.8rem;padding:4px 6px;">✏️</button>
      <button class="dpi-del" onclick="removeDirectPlayer(${p._origIdx})">✕</button>
    </div>`;
  }).join('');
  if(typeof rsvpSyncRosterChange==='function')rsvpSyncRosterChange();
}

function renderDirectPlayerListStable(anchorName){
  const scroller = document.scrollingElement || document.documentElement;
  const beforeY = scroller ? scroller.scrollTop : window.scrollY;
  renderDirectPlayerList();
  const section = document.getElementById('sec-players');
  if(section && section.tagName==='DETAILS') section.open = true;
  requestAnimationFrame(()=>{
    const currentSection = document.getElementById('sec-players');
    if(currentSection && currentSection.tagName==='DETAILS') currentSection.open = true;
    if(scroller) scroller.scrollTop = beforeY;
    else window.scrollTo(0,beforeY);
    if(anchorName){
      const rows = [...document.querySelectorAll('.dir-player-item')];
      const target = rows.find(el=>el.textContent.includes(anchorName));
      if(target){
        const rect = target.getBoundingClientRect();
        if(rect.top<90 || rect.bottom>window.innerHeight-120){
          target.scrollIntoView({block:'center'});
        }
      }
    }
  });
}

function startPartnerSelect(name){
  _partnerSelectMode = true;
  _partnerSelectName = name;
  renderDirectPlayerListStable(name);
}
function cancelPartnerSelect(){
  const anchor = _partnerSelectName;
  _partnerSelectMode = false;
  _partnerSelectName = null;
  renderDirectPlayerListStable(anchor);
}
function confirmPartner(targetName){
  const srcName = _partnerSelectName;
  if(!srcName || srcName===targetName) return;
  // 이미 파트너 있으면 불가
  if(getPartnerInfo(srcName)||getPartnerInfo(targetName)){
    alert('이미 파트너가 있습니다. 기존 파트너를 먼저 해제해주세요.');
    cancelPartnerSelect(); return;
  }
  const colorIdx = _partners.length % PARTNER_COLORS.length;
  _partners.push({id:'p'+(Date.now()), members:[srcName, targetName], color:PARTNER_COLORS[colorIdx]});
  _partnerSelectMode = false;
  _partnerSelectName = null;
  saveState();
  if(typeof rsvpSyncRosterChange==='function')rsvpSyncRosterChange();
  renderDirectPlayerListStable(targetName);
}
function removePartner(name){
  _partners = _partners.filter(p=>!p.members.includes(name));
  saveState();
  if(typeof rsvpSyncRosterChange==='function')rsvpSyncRosterChange();
  renderDirectPlayerListStable(name);
}

function syncDirectToPaste(){ /* 미사용 */ }


/* ═══ ROSTER MANAGEMENT ═══ */
const ROSTER_KEY='badminton_rosters_v1';
let rosters={clubs:[]};
let _editingClubId=null;
let _editingMemberIdx=null;
let _collapsedClubs=new Set();
let _memberGrade='D';
let _memberGender='남';
let _memberAge='40대';
let _importClubIdx=0;
let _rosterSort='reg'; // 'reg' | 'name' | 'level' | 'gender'
let _rosterQuery='';

function setRosterSort(mode){
  _rosterSort=mode;
  ['reg','name','level','gender'].forEach(m=>{
    const btn=document.getElementById('rsb-'+m);
    if(btn) btn.classList.toggle('active', m===mode);
  });
  renderClubList();
}
function setRosterQuery(q){
  _rosterQuery=String(q||'').trim();
  renderClubList();
}
function _rosterInitials(text){
  const CHO=['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  return String(text||'').split('').map(ch=>{
    const code=ch.charCodeAt(0)-0xAC00;
    return code>=0&&code<=11171?CHO[Math.floor(code/588)]:ch;
  }).join('');
}

function loadRosters(){
  try{
    const raw=localStorage.getItem(ROSTER_KEY);
    if(raw){
      rosters=JSON.parse(raw);
      if(!rosters.clubs) rosters.clubs=[];
      // 명부 레벨 마이그레이션
      if((rosters._lvVersion||1)<LV_VERSION){
        rosters.clubs=rosters.clubs.map(club=>({
          ...club,
          members:(club.members||[]).map(migratePlayerLevel)
        }));
        rosters._lvVersion=LV_VERSION;
        saveRosters(); // 마이그레이션 결과 즉시 저장
      }
    } else {
      rosters={clubs:[]};
    }
  }
  catch(e){rosters={clubs:[]};}
}
function saveRosters(){
  try{localStorage.setItem(ROSTER_KEY,JSON.stringify({...rosters,_lvVersion:LV_VERSION}));}catch(e){}
  _dailySyncPlayerRolesFromRoster();
}

function _dailySyncPlayerRolesFromRoster(){
  if(!_dailyPlayers.length)return false;
  const byMemberId=new Map();
  const byName=new Map();
  (rosters.clubs||[]).forEach(club=>{
    (club.members||[]).forEach(member=>{
      if(!member?.name)return;
      const profile={...member,club:club.name||member.club||''};
      profile.memberId=member.memberId||_rsvpMemberId(profile);
      byMemberId.set(profile.memberId,profile);
      const key=_rsvpNameKey(profile.name);
      byName.set(key,byName.has(key)?null:profile);
    });
  });
  let changed=false;
  _dailyPlayers.forEach(player=>{
    if(!player||player.isGuest)return;
    const profile=(player.memberId&&byMemberId.get(player.memberId))||byName.get(_rsvpNameKey(player.name));
    if(!profile)return;
    const gender=_dailyGender(profile.gender||player.gender);
    const grade=profile.grade||player.grade||'C';
    const next={
      memberId:profile.memberId,
      club:profile.club||player.club||'',
      isClubOfficial:!!profile.isClubOfficial,
      grade,
      gender,
      level:gradeToLevel(grade,_dailyGenderLabel(gender))||player.level||4,
      ageGroup:profile.ageGroup||player.ageGroup||'40대'
    };
    Object.keys(next).forEach(key=>{
      if(String(player[key]||'')!==String(next[key]||'')){player[key]=next[key];changed=true;}
    });
  });
  if(changed){dailySave();dailyRender();}
  return changed;
}

function addClub(){
  if(rosters.clubs.length>=10){alert('클럽은 최대 10개까지 등록할 수 있습니다.');return;}
  const id='club_'+Date.now();
  rosters.clubs.push({id,name:'클럽 '+(rosters.clubs.length+1),members:[]});
  saveRosters();renderClubList();
}
function deleteClub(id){
  const club=rosters.clubs.find(c=>c.id===id);
  if(!confirm((club?club.name:'이 클럽')+' 클럽을 삭제하시겠습니까?'))return;
  rosters.clubs=rosters.clubs.filter(c=>c.id!==id);
  saveRosters();renderClubList();
}
function updateClubName(id,name){
  const c=rosters.clubs.find(c=>c.id===id);
  if(c){c.name=name.trim()||'클럽';saveRosters();}
}

function renderClubList(){
  const el=document.getElementById('clubListEl');
  const empty=document.getElementById('rosterEmpty');
  const countEl=document.getElementById('clubCount');
  const btnAdd=document.getElementById('btnAddClub');
  const sortBar=document.getElementById('rosterSortBar');
  if(!el)return;
  const n=rosters.clubs.length;
  if(countEl)countEl.textContent=n;
  if(btnAdd){btnAdd.disabled=n>=10;btnAdd.style.opacity=n>=10?'.4':'1';}
  if(!n){
    el.innerHTML='';
    if(empty)empty.style.display='';
    if(sortBar)sortBar.style.display='none';
    if(typeof rsvpSyncRosterChange==='function')rsvpSyncRosterChange();
    return;
  }
  if(empty)empty.style.display='none';
  if(sortBar)sortBar.style.display='flex';
  const GC={7:'lv6',6:'lv6',5:'lv5',4:'lv4',3:'lv3',2:'lv2',1:'lv1',0:'lv1'};
  const q=_rosterQuery.toLowerCase();
  const hasQuery=!!q;
  const genderRank=g=>String(g||'').startsWith('남')?0:String(g||'').startsWith('여')?1:2;
  const cards=rosters.clubs.map(club=>{
    const collapsed=_collapsedClubs.has(club.id)&&!hasQuery;

    // 정렬 적용 — 원본 인덱스 보존
    let indexed=club.members.map((m,mi)=>({...m,_origIdx:mi}));
    if(hasQuery){
      indexed=indexed.filter(m=>{
        const hay=[m.name,_rosterInitials(m.name),m.grade,m.gender,m.ageGroup,m.isClubOfficial?'클럽 임원':''].join(' ').toLowerCase();
        return hay.includes(q);
      });
      if(!indexed.length)return '';
    }
    if(_rosterSort==='name'){
      indexed.sort((a,b)=>a.name.localeCompare(b.name,'ko'));
    } else if(_rosterSort==='level'){
      indexed.sort((a,b)=>b.level-a.level || a.name.localeCompare(b.name,'ko'));
    } else if(_rosterSort==='gender'){
      indexed.sort((a,b)=>genderRank(a.gender)-genderRank(b.gender) || a.name.localeCompare(b.name,'ko'));
    }
    const countText=hasQuery?`${indexed.length}/${club.members.length}명`:`${club.members.length}명`;

    const mrows=indexed.map((m)=>`<div class="club-member-row">
        <span class="cmr-name">${esc(m.name)}${m.isClubOfficial?'<span class="club-official-badge">임원</span>':''}</span>
        <span class="cmr-meta"><span class="lv-badge ${GC[m.level]||'lv3'}">${m.grade}</span> ${m.gender} · ${m.ageGroup||'40대'}</span>
        <button class="cmr-edit" onclick="editMember('${club.id}',${m._origIdx})" title="수정">✏</button>
        <button class="cmr-del" onclick="deleteMember('${club.id}',${m._origIdx})" title="삭제">✕</button>
      </div>`).join('');
    return `<div class="club-card">
      <div class="club-card-head" style="cursor:pointer;" onclick="toggleClubCollapse('${club.id}',event)">
        <button class="collapse-btn${collapsed?' collapsed':''}" title="${collapsed?'펼치기':'접기'}">▾</button>
        <input class="club-name-input" value="${esc(club.name)}"
          onchange="updateClubName('${club.id}',this.value)"
          onblur="updateClubName('${club.id}',this.value)"
          onclick="event.stopPropagation()">
        <span style="font-size:.65rem;color:var(--dim);flex-shrink:0;">${countText}</span>
        <button class="btn btn-ghost btn-sm roster-use-btn"
          onclick="event.stopPropagation();openImportFromClub('${club.id}')">대진에 넣기</button>
        <button class="btn btn-ghost btn-sm"
          style="font-size:.65rem;padding:4px 7px;flex-shrink:0;"
          onclick="event.stopPropagation();deleteClub('${club.id}')">🗑</button>
      </div>
      <div class="club-card-body${collapsed?' hidden':''}">
        ${mrows||'<div class="dir-empty" style="padding:10px;font-size:.74rem;">회원이 없습니다</div>'}
        <button class="club-add-btn" onclick="openAddMemberModal('${club.id}')">+ 회원 추가</button>
      </div>
    </div>`;
  }).filter(Boolean);
  el.innerHTML=cards.length?cards.join(''):`<div class="dir-empty" style="padding:18px;font-size:.78rem;">검색 결과가 없습니다.</div>`;
  if(typeof rsvpSyncRosterChange==='function')rsvpSyncRosterChange();
}

function openAddMemberModal(clubId){
  _editingClubId=clubId;
  _editingMemberIdx=null;
  const club=rosters.clubs.find(c=>c.id===clubId);
  const mt=document.getElementById('memberModalTitle');
  if(mt)mt.textContent='👤 '+(club?club.name:'')+'에 회원 추가';
  const sb=document.getElementById('memberSaveBtn');if(sb)sb.textContent='💾 저장';
  document.getElementById('memberName').value='';
  const errEl=document.getElementById('memberErrMsg');if(errEl)errEl.textContent='';
  _memberGrade='D';_memberGender='남';_memberAge='40대';
  const official=document.getElementById('memberOfficial');if(official)official.checked=false;
  document.querySelectorAll('#memberGradeBtns .grade-sel-btn').forEach(b=>b.classList.toggle('sel',b.dataset.grade==='D'));
  document.querySelectorAll('#memberGenderBtns .gender-sel-btn').forEach(b=>{
    b.classList.remove('sel-m','sel-f');
    if(b.dataset.gender==='남')b.classList.add('sel-m');
  });
  document.getElementById('addMemberModal').classList.remove('hidden');
  setTimeout(()=>document.getElementById('memberName').focus(),120);
}
function closeMemberModal(){document.getElementById('addMemberModal').classList.add('hidden');}

function selectMemberAge(age){
  _memberAge=age;
  document.querySelectorAll('#memberAgeBtns .age-sel-btn').forEach(b=>
    b.classList.toggle('sel', b.dataset.age===age));
}
function selectMemberGrade(grade){
  _memberGrade=grade;
  document.querySelectorAll('#memberGradeBtns .grade-sel-btn').forEach(b=>b.classList.toggle('sel',b.dataset.grade===grade));
}
function selectMemberGender(g){
  _memberGender=g;
  document.querySelectorAll('#memberGenderBtns .gender-sel-btn').forEach(b=>{
    b.classList.remove('sel-m','sel-f');
    if(b.dataset.gender===g)b.classList.add(g==='남'?'sel-m':'sel-f');
  });
}

function saveMember(){
  const name=document.getElementById('memberName').value.trim();
  const errEl=document.getElementById('memberErrMsg');
  if(!name){document.getElementById('memberName').focus();return;}
  const club=rosters.clubs.find(c=>c.id===_editingClubId);
  if(!club)return;
  const level=gradeToLevel(_memberGrade,_memberGender)??1;
  const isClubOfficial=!!document.getElementById('memberOfficial')?.checked;
  if(_editingMemberIdx===null){
    // ── 신규 추가 (중복 방지) ──
    if(club.members.some(m=>m.name===name)){
      if(errEl)errEl.textContent='⚠ "'+name+'"은 이미 등록된 회원입니다.';
      document.getElementById('memberName').select();return;
    }
    if(errEl)errEl.textContent='';
    club.members.push({name,grade:_memberGrade,gender:_memberGender,level,ageGroup:_memberAge,isClubOfficial});
    saveRosters();renderClubList();
    document.getElementById('memberName').value='';
    document.getElementById('memberName').focus();
  } else {
    // ── 기존 수정 (본인 제외 중복 방지) ──
    if(club.members.some((m,i)=>m.name===name&&i!==_editingMemberIdx)){
      if(errEl)errEl.textContent='⚠ "'+name+'"은 이미 등록된 회원입니다.';
      document.getElementById('memberName').select();return;
    }
    if(errEl)errEl.textContent='';
    club.members[_editingMemberIdx]={...club.members[_editingMemberIdx],name,grade:_memberGrade,gender:_memberGender,level,ageGroup:_memberAge,isClubOfficial};
    saveRosters();renderClubList();closeMemberModal();
  }
}

function deleteMember(clubId,idx){
  const club=rosters.clubs.find(c=>c.id===clubId);
  if(!club)return;
  const mname=club.members[idx]?.name||'이 회원';
  if(!confirm('"'+mname+'"을 삭제하시겠습니까?'))return;
  club.members.splice(idx,1);
  saveRosters();renderClubList();
}

/* ─── 대진표로 가져오기 ─── */
function openImportModal(){
  loadRosters();
  if(!rosters.clubs.length){
    alert('등록된 클럽이 없습니다.\n명부 탭에서 클럽을 먼저 추가해주세요.');return;
  }
  _importClubIdx=0;
  renderImportTabs();renderImportMembers();
  document.getElementById('importModal').classList.remove('hidden');
}
function openImportFromClub(clubId){
  loadRosters();
  const idx=rosters.clubs.findIndex(c=>c.id===clubId);
  _importClubIdx=idx>=0?idx:0;
  renderImportTabs();renderImportMembers();
  document.getElementById('importModal').classList.remove('hidden');
  switchNav('main');
}
function closeImportModal(){document.getElementById('importModal').classList.add('hidden');}

function renderImportTabs(){
  const el=document.getElementById('importClubTabs');
  if(!el)return;
  el.innerHTML=`<div class="club-tabs-bar">${rosters.clubs.map((c,i)=>
    `<button class="ctab-btn${i===_importClubIdx?' active':''}" onclick="selectImportClub(${i})">${esc(c.name)}</button>`
  ).join('')}</div>`;
}
function selectImportClub(idx){
  _importClubIdx=idx;
  _importSort='reg';
  ['reg','name','gender'].forEach(m=>{
    const btn=document.getElementById('isb-'+m);
    if(btn) btn.classList.toggle('active', m==='reg');
  });
  renderImportTabs();
  renderImportMembers();
}

let _importSort='reg'; // 'reg' | 'name' | 'gender'

function setImportSort(mode){
  _importSort=mode;
  ['reg','name','gender'].forEach(m=>{
    const btn=document.getElementById('isb-'+m);
    if(btn) btn.classList.toggle('active', m===mode);
  });
  renderImportMembers();
}

function renderImportMembers(){
  const club=rosters.clubs[_importClubIdx];
  const el=document.getElementById('importMemberList');
  if(!el)return;
  if(!club||!club.members.length){
    el.innerHTML='<div class="dir-empty">이 클럽에 등록된 회원이 없습니다</div>';
    return;
  }

  // 현재 등록된 선수 이름 집합
  const alreadyIn=new Set(_directPlayers.map(p=>p.name));

  // 체크 상태 저장 (정렬 변경 시 유지) — 미등록 선수만
  const prevChecked=new Set();
  document.querySelectorAll('.import-chk:not(:disabled)').forEach(c=>{
    if(c.checked) prevChecked.add(parseInt(c.value));
  });
  const firstRender=prevChecked.size===0&&!el.querySelector('.import-chk');

  // 원본 인덱스 보존 후 정렬
  const indexed=club.members.map((m,i)=>({...m,_origIdx:i}));
  if(_importSort==='name'){
    indexed.sort((a,b)=>a.name.localeCompare(b.name,'ko'));
  } else if(_importSort==='gender'){
    indexed.sort((a,b)=>{
      if(a.gender!==b.gender) return a.gender==='남'?-1:1;
      return a.name.localeCompare(b.name,'ko');
    });
  }
  // 이미 등록된 선수를 하단으로 이동
  indexed.sort((a,b)=>{
    const aIn=alreadyIn.has(a.name)?1:0;
    const bIn=alreadyIn.has(b.name)?1:0;
    return aIn-bIn;
  });

  const available=indexed.filter(m=>!alreadyIn.has(m.name)).length;
  const total=indexed.length;

  const GC={7:'lv6',6:'lv6',5:'lv5',4:'lv4',3:'lv3',2:'lv2',1:'lv1',0:'lv1'};
  el.innerHTML=`<div style="padding:7px 12px;font-size:.72rem;color:var(--dim);border-bottom:1px solid var(--bdr);background:var(--sur2);">
    추가 가능 <b style="color:var(--bl)">${available}명</b> · 이미 등록됨 <b>${total-available}명</b>
  </div>`+indexed.map(m=>{
    const isDup=alreadyIn.has(m.name);
    const isChecked=isDup?false:(firstRender||prevChecked.has(m._origIdx));
    if(isDup){
      // 이미 등록된 선수 — 회색 처리, 체크 불가
      return `<label class="import-member-row" style="opacity:.45;cursor:default;background:#f8f8f8;">
        <input type="checkbox" class="import-chk" value="${m._origIdx}" disabled>
        <span style="flex:1;font-size:.84rem;font-weight:700;color:#999;">${esc(m.name)}</span>
        <span style="font-size:.65rem;color:#bbb;margin-right:6px;">이미 등록됨</span>
        <span style="font-size:.68rem;color:#ccc;">
          <span class="lv-badge" style="background:#f0f0f0;color:#bbb;border-color:#e0e0e0;">${m.grade}</span> ${m.gender}
        </span>
      </label>`;
    }
    return `<label class="import-member-row">
      <input type="checkbox" class="import-chk" value="${m._origIdx}" ${isChecked?'checked':''}>
      <span style="flex:1;font-size:.84rem;font-weight:700;">${esc(m.name)}</span>
      <span style="font-size:.68rem;color:var(--dim);">
        <span class="lv-badge ${GC[m.level]||'lv3'}">${m.grade}</span> ${m.gender}
      </span>
    </label>`;
  }).join('');
}

function toggleSelectAll(){
  // disabled(이미 등록됨) 제외, 미등록 선수만 대상
  const chks=[...document.querySelectorAll('.import-chk:not(:disabled)')];
  const all=chks.every(c=>c.checked);
  chks.forEach(c=>c.checked=!all);
}

function importSelected(){
  const club=rosters.clubs[_importClubIdx];
  if(!club)return;
  const chks=document.querySelectorAll('.import-chk:not(:disabled)');
  const sel=[...chks].filter(c=>c.checked).map(c=>club.members[parseInt(c.value)]).filter(Boolean);
  if(!sel.length){alert('선수를 1명 이상 선택해주세요.');return;}
  let added=0,skipped=0;
  sel.forEach(m=>{
    if(!_directPlayers.some(p=>p.name===m.name)){
      _directPlayers.push({name:m.name,grade:m.grade,level:m.level,gender:m.gender,ageGroup:m.ageGroup||'40대',isClubOfficial:!!m.isClubOfficial});
      added++;
    }else skipped++;
  });
  closeImportModal();
  switchNav('main');
  renderDirectPlayerList();   // ← UI 목록 갱신 (핵심)
  const st=document.getElementById('parseStatus');
  if(st){st.style.color='var(--green)';
  st.textContent='✓ '+added+'명 등록됨'+(skipped?' (중복 '+skipped+'명 제외)':'');}
}

/* ── 회원 편집 ── */
function editMember(clubId,idx){
  _editingClubId=clubId;
  _editingMemberIdx=idx;
  const club=rosters.clubs.find(c=>c.id===clubId);
  if(!club||idx<0||idx>=club.members.length)return;
  const m=club.members[idx];
  const mt=document.getElementById('memberModalTitle');
  if(mt)mt.textContent='✏️ '+club.name+' 회원 수정';
  const sb=document.getElementById('memberSaveBtn');if(sb)sb.textContent='✏️ 수정 저장';
  document.getElementById('memberName').value=m.name;
  const errEl=document.getElementById('memberErrMsg');if(errEl)errEl.textContent='';
  _memberGrade=m.grade||'D';_memberGender=m.gender||'남';_memberAge=m.ageGroup||'40대';
  const official=document.getElementById('memberOfficial');if(official)official.checked=!!m.isClubOfficial;
  document.querySelectorAll('#memberGradeBtns .grade-sel-btn').forEach(b=>b.classList.toggle('sel',b.dataset.grade===_memberGrade));
  document.querySelectorAll('#memberGenderBtns .gender-sel-btn').forEach(b=>{
    b.classList.remove('sel-m','sel-f');
    if(b.dataset.gender===_memberGender)b.classList.add(_memberGender==='남'?'sel-m':'sel-f');
  });
  document.querySelectorAll('#memberAgeBtns .age-sel-btn').forEach(b=>b.classList.toggle('sel',b.dataset.age===_memberAge));
  document.getElementById('addMemberModal').classList.remove('hidden');
  setTimeout(()=>document.getElementById('memberName').focus(),120);
}

/* ── 클럽 접기/펼치기 ── */
function toggleClubCollapse(id,e){
  // 이름 입력란 클릭은 무시 (다른 버튼은 stopPropagation으로 처리)
  if(e&&e.target&&e.target.tagName==='INPUT')return;
  if(_collapsedClubs.has(id))_collapsedClubs.delete(id);
  else _collapsedClubs.add(id);
  renderClubList();
}

/* ── 명부 내보내기/불러오기 (JSON 파일) ── */
function exportRosters(){
  if(!rosters.clubs.length){alert('내보낼 클럽이 없습니다.');return;}
  const json=JSON.stringify(rosters,null,2);
  const blob=new Blob([json],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  const now=new Date();
  const stamp=now.getFullYear()+''+String(now.getMonth()+1).padStart(2,'0')+String(now.getDate()).padStart(2,'0');
  a.href=url;a.download='배드민턴_명부_'+stamp+'.json';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function importRosters(evt){
  const file=evt.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=function(e){
    try{
      const data=JSON.parse(e.target.result);
      if(!data.clubs||!Array.isArray(data.clubs))throw new Error('명부 형식이 올바르지 않습니다.');
      // 기존 데이터 병합 여부 묻기
      const hasExisting=rosters.clubs.length>0;
      let mode='replace';
      if(hasExisting){
        const ans=confirm('기존 명부에 병합하시겠습니까?\n(확인=병합, 취소=덮어쓰기)');
        mode=ans?'merge':'replace';
      }
      if(mode==='replace'){
        rosters=data;
      } else {
        // 병합: 클럽명이 같으면 회원 추가, 없으면 새 클럽
        data.clubs.forEach(nc=>{
          const exist=rosters.clubs.find(c=>c.name===nc.name);
          if(exist){
            nc.members.forEach(m=>{
              if(!exist.members.some(em=>em.name===m.name))exist.members.push(m);
            });
          } else {
            if(rosters.clubs.length<10)rosters.clubs.push(nc);
          }
        });
      }
      saveRosters();renderClubList();
      alert('명부를 불러왔습니다. ('+rosters.clubs.length+'개 클럽)');
    }catch(err){alert('파일 읽기 오류: '+err.message);}
    evt.target.value=''; // reset file input
  };
  reader.readAsText(file,'utf-8');
}

/* ── 구글 시트 CSV 내보내기 (외부 라이브러리 불필요) ── */
function exportRostersXLSX(){
  if(!rosters.clubs.length){alert('내보낼 클럽이 없습니다.');return;}
  const rows=[['클럽명','이름','급수','성별','클럽임원']];
  rosters.clubs.forEach(club=>{
    if(!club.members.length){
      rows.push([club.name,'','','','']);
    } else {
      club.members.forEach(m=>rows.push([club.name,m.name,m.grade,m.gender,m.isClubOfficial?'Y':'']));
    }
  });
  // RFC 4180 CSV + UTF-8 BOM (구글시트/엑셀 한글 깨짐 방지)
  const csv='\uFEFF'+rows.map(r=>
    r.map(v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"').join(',')
  ).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  const now=new Date();
  const stamp=now.getFullYear()+''+String(now.getMonth()+1).padStart(2,'0')+String(now.getDate()).padStart(2,'0');
  a.href=url;a.download='배드민턴_명부_'+stamp+'.csv';
  document.body.appendChild(a);a.click();
  document.body.removeChild(a);URL.revokeObjectURL(url);
}

/* ── 구글 시트 CSV 불러오기 (외부 라이브러리 불필요) ── */
function importRostersXLSX(evt){
  const file=evt.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=function(e){
    try{
      // BOM 제거
      let text=e.target.result;
      if(text.charCodeAt(0)===0xFEFF)text=text.slice(1);
      // CSV 파싱 (RFC 4180 — 쌍따옴표 필드 지원)
      const rows=_parseCSV(text).filter(r=>r.some(v=>v.trim()!==''));
      if(!rows.length){alert('파일에 데이터가 없습니다.');evt.target.value='';return;}
      // 헤더 행 자동 감지 (첫 5행 중 '클럽명' 또는 '이름' 포함 행)
      let startRow=0;
      for(let i=0;i<Math.min(5,rows.length);i++){
        const r=rows[i].map(v=>v.trim());
        if(r.some(v=>v==='클럽명'||v==='이름'||v==='club'||v==='name')){startRow=i+1;break;}
      }
      // 컬럼 인덱스 (헤더 기반 또는 기본 순서)
      const hdr=(rows[startRow-1]||[]).map(v=>v.trim().toLowerCase());
      const ci={
        club:_findCol(hdr,['클럽명','club','클럽']),
        name:_findCol(hdr,['이름','name','성명']),
        grade:_findCol(hdr,['급수','grade','등급']),
        gender:_findCol(hdr,['성별','gender','sex']),
        official:_findCol(hdr,['클럽임원','임원','official','clubofficial'])
      };
      if(ci.club<0)ci.club=0;if(ci.name<0)ci.name=1;
      if(ci.grade<0)ci.grade=2;if(ci.gender<0)ci.gender=3;

      const imported={};
      for(let i=startRow;i<rows.length;i++){
        const row=rows[i];
        const clubName=(row[ci.club]||'').trim();
        const name=(row[ci.name]||'').trim();
        if(!clubName||!name)continue;
        const grade=((row[ci.grade]||'').trim().toUpperCase())||'D';
        const genderRaw=(row[ci.gender]||'').trim();
        const validGrade=/^[A-E]$/.test(grade)?grade:'D';
        // 성별 정규화: 여/여자/여성/F/f/female/w → '여', 그 외 → '남'
        const gN=genderRaw.toLowerCase();
        const validGender=(gN.startsWith('여')||gN==='f'||gN.startsWith('fe')||gN==='w'||gN==='woman'||gN==='women')?'여':'남';
        const _lvRaw=gradeToLevel(validGrade,validGender==='여'?'여':'남');
        const level=(_lvRaw!==null&&_lvRaw!==undefined)?_lvRaw:1;
        const officialRaw=ci.official>=0?String(row[ci.official]||'').trim().toLowerCase():'';
        const isClubOfficial=['y','yes','1','true','임원','운영임원'].includes(officialRaw);
        if(!imported[clubName])imported[clubName]=[];
        if(!imported[clubName].some(m=>m.name===name))
          imported[clubName].push({name,grade:validGrade,gender:validGender,level,isClubOfficial});
      }
      const clubNames=Object.keys(imported);
      if(!clubNames.length){
        alert('불러올 데이터가 없습니다.\n\n열 순서 확인: 클럽명 / 이름 / 급수 / 성별');
        evt.target.value='';return;
      }
      const hasExisting=rosters.clubs.length>0;
      if(hasExisting){
        const ans=confirm(
          '기존 명부를 불러온 데이터로 교체하시겠습니까?\n\n'+
          '확인 → 기존 명부를 지우고 교체\n취소 → 가져오기 취소 (아무 변경 없음)'
        );
        if(!ans){evt.target.value='';return;}
      }
      // 교체: 기존 명부를 지우고 새 데이터로 채우기
      rosters={clubs:[]};
      clubNames.forEach(cn=>{
        if(rosters.clubs.length>=10)return;
        rosters.clubs.push({id:'club_'+Date.now()+'_'+Math.random().toString(36).slice(2),name:cn,members:imported[cn]});
      });
      saveRosters();renderClubList();
      const total=rosters.clubs.reduce((s,c)=>s+c.members.length,0);
      alert('시트 불러오기 완료!\n클럽 '+rosters.clubs.length+'개 / 회원 '+total+'명');
    }catch(err){
      alert('파일 읽기 오류: '+err.message+'\n\n파일 형식: CSV (.csv)\n열 순서: 클럽명 / 이름 / 급수 / 성별');
    }
    evt.target.value='';
  };
  reader.readAsText(file,'utf-8');
}

/* RFC 4180 CSV 파서 (쌍따옴표 이스케이프 지원) */
function _parseCSV(text){
  const rows=[];let row=[],field='',inQ=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i],nx=text[i+1];
    if(inQ){
      if(ch==='"'&&nx==='"'){field+='"';i++;}
      else if(ch==='"'){inQ=false;}
      else field+=ch;
    } else {
      if(ch==='"'){inQ=true;}
      else if(ch===','){row.push(field);field='';}
      else if(ch==='\r'&&nx==='\n'){row.push(field);rows.push(row);row=[];field='';i++;}
      else if(ch==='\n'||ch==='\r'){row.push(field);rows.push(row);row=[];field='';}

      else field+=ch;
    }
  }
  row.push(field);
  if(row.some(v=>v!==''))rows.push(row);
  return rows;
}

function _findCol(header,keys){
  for(const k of keys){const i=header.indexOf(k);if(i>=0)return i;}
  return -1;
}

/* ── 스케줄 컴팩션: 빈 코트에 이후 라운드 게임 당겨넣기 (반복 수렴) ── */
function compactSchedule(matches,settings){
  const maxIter=200;
  let iter=0,changed=true;
  while(changed&&iter++<maxIter){
    changed=false;
    matches.sort((a,b)=>a.round-b.round||a.court-b.court);
    for(let i=0;i<matches.length;i++){
      const m=matches[i];
      if(m.round===1)continue;
      const mp=new Set([m.team1A.name,m.team1B.name,m.team2C.name,m.team2D.name]);
      // 가장 이른 라운드부터 빈 코트 탐색
      for(let r=1;r<m.round;r++){
        const rm=matches.filter(x=>x.round===r);
        const usedC=new Set(rm.map(x=>x.court));
        // 가장 낮은 번호의 빈 코트 찾기
        let fc=0;
        for(let c=1;c<=settings.courts;c++){if(!usedC.has(c)){fc=c;break;}}
        if(!fc)continue;
        const usedP=new Set(rm.flatMap(x=>[x.team1A.name,x.team1B.name,x.team2C.name,x.team2D.name]));
        if([...mp].some(p=>usedP.has(p)))continue;
        m.round=r;m.court=fc;changed=true;break;
      }
    }
  }
  // 라운드 번호 재정렬 (빈 라운드 제거)
  const usedR=[...new Set(matches.map(m=>m.round))].sort((a,b)=>a-b);
  const rmap={};usedR.forEach((r,i)=>rmap[r]=i+1);
  matches.forEach(m=>m.round=rmap[m.round]);
  // 라운드 내 코트번호도 1부터 재정렬 (갭 제거)
  const byRound={};
  matches.forEach(m=>{(byRound[m.round]=byRound[m.round]||[]).push(m);});
  Object.values(byRound).forEach(rms=>{
    rms.sort((a,b)=>a.court-b.court);
    rms.forEach((m,i)=>m.court=i+1);
  });
}

/* ── 후반부 라운드 최적화: 경기 구성은 유지하고 미래 라운드 위치만 교환 ── */
function _lastCompletedRoundPlayers(completedMatches){
  if(!completedMatches.length)return new Set();
  const lastRound=Math.max(...completedMatches.map(m=>m.round));
  return new Set(completedMatches.filter(m=>m.round===lastRound)
    .flatMap(m=>[m.team1A.name,m.team1B.name,m.team2C.name,m.team2D.name]));
}

function _refreshMatchBalance(m){
  m.team1Level=effLevel(m.team1A)+effLevel(m.team1B);
  m.team2Level=effLevel(m.team2C)+effLevel(m.team2D);
  m.levelDiff=Math.round(Math.abs(m.team1Level-m.team2Level)*10)/10;
}

function _resetMatchRecords(participants,matches){
  participants.forEach(p=>{
    p.gamesPlayed=0;
    p.lastRoundPlayed=0;
    p.womenDoublesPlayed=0;
    p.menDoublesPlayed=0;
    p.mixedDoublesPlayed=0;
    p.adjustmentPlayed=0;
    p.partnerCount={};
    p.opponentCount={};
  });
  matches.forEach(m=>{
    _refreshMatchBalance(m);
    updatePlayerRecords(m);
  });
}

function _teamPairRepeatEnergy(matches){
  const exact={},sameFour={},partner={},opp={};
  let ldSum=0,ldMax=0,genderErr=0;
  matches.forEach(m=>{
    _refreshMatchBalance(m);
    const t1=[m.team1A.name,m.team1B.name].sort();
    const t2=[m.team2C.name,m.team2D.name].sort();
    const exactKey=[t1.join('|'),t2.join('|')].sort().join(' VS ');
    const fourKey=[...t1,...t2].sort().join('|');
    exact[exactKey]=(exact[exactKey]||0)+1;
    sameFour[fourKey]=(sameFour[fourKey]||0)+1;
    [[m.team1A,m.team1B],[m.team2C,m.team2D]].forEach(pair=>{
      if(pair[0].partnerName===pair[1].name||pair[1].partnerName===pair[0].name)return;
      const k=[pair[0].name,pair[1].name].sort().join('|');
      partner[k]=(partner[k]||0)+1;
    });
    [m.team1A,m.team1B].forEach(a=>[m.team2C,m.team2D].forEach(b=>{
      const k=[a.name,b.name].sort().join('|');
      opp[k]=(opp[k]||0)+1;
    }));
    ldSum+=m.levelDiff||0;
    ldMax=Math.max(ldMax,m.levelDiff||0);
    genderErr+=_matchGenderErrorCount(m);
  });
  const repeatCount=obj=>Object.values(obj).reduce((s,c)=>s+Math.max(0,c-1),0);
  const highOpp=Object.values(opp).reduce((s,c)=>s+(c>=4?1000:c===3?120:c===2?12:0),0);
  const highPartner=Object.values(partner).reduce((s,c)=>s+(c>=4?900:c===3?180:c===2?30:0),0);
  return genderErr*100000+repeatCount(exact)*5000+repeatCount(sameFour)*1600+highPartner+highOpp+ldSum*12+ldMax*80;
}

function _matchHasFixedPartner(m){
  return [m.team1A,m.team1B,m.team2C,m.team2D].some(p=>p&&p.partnerName);
}

function _roundHasDuplicatePlayers(matches,round){
  const names=matches.filter(m=>m.round===round).flatMap(m=>[m.team1A.name,m.team1B.name,m.team2C.name,m.team2D.name]);
  return new Set(names).size!==names.length;
}

function _optimizeTeamPairRepeats(matches,participants,settings){
  if(!settings?.teamMode||!matches?.length)return;
  const swappableTypes=new Set(['남복','여복']);
  let best=_teamPairRepeatEnergy(matches);
  let improved=true,passes=0;
  while(improved&&passes<6){
    improved=false;
    passes++;
    const rounds=[...new Set(matches.map(m=>m.round))].sort((a,b)=>a-b);
    for(const r of rounds){
      const rms=matches.filter(m=>m.round===r);
      for(let i=0;i<rms.length-1;i++)for(let j=i+1;j<rms.length;j++){
        const a=rms[i],b=rms[j];
        if(a.type!==b.type||!swappableTypes.has(a.type))continue;
        if(_matchHasFixedPartner(a)||_matchHasFixedPartner(b))continue;
        const sideSlots=[['team1A','team1B'],['team2C','team2D']];
        for(const slots of sideSlots){
          for(const sa of slots)for(const sb of slots){
            if(a[sa].name===b[sb].name)continue;
            const oldA=a[sa],oldB=b[sb];
            a[sa]=oldB;b[sb]=oldA;
            _refreshMatchBalance(a);_refreshMatchBalance(b);
            const valid=!_roundHasDuplicatePlayers(matches,r)
              && _matchGenderErrorCount(a)===0&&_matchGenderErrorCount(b)===0
              && a.type===b.type;
            const next=valid?_teamPairRepeatEnergy(matches):Infinity;
            if(next<best){
              best=next;
              improved=true;
            }else{
              a[sa]=oldA;b[sb]=oldB;
              _refreshMatchBalance(a);_refreshMatchBalance(b);
            }
          }
        }
      }
    }
  }
  _resetMatchRecords(participants,matches);
}

function _optimizeFutureRounds(matches,settings,previousRoundNames=new Set()){
  if(matches.length<2)return;
  const rounds=[...new Set(matches.map(m=>m.round))].sort((a,b)=>a-b);
  if(rounds.length<2)return;
  const players=m=>[m.team1A.name,m.team1B.name,m.team2C.name,m.team2D.name];
  const validRound=(round)=>{
    const names=matches.filter(m=>m.round===round).flatMap(players);
    return new Set(names).size===names.length;
  };
  const measure=()=>{
    let consecutive=0,lateSpike=0;
    let prev=new Set(previousRoundNames);
    rounds.forEach((round,idx)=>{
      const rms=matches.filter(m=>m.round===round);
      const names=rms.flatMap(players);
      names.forEach(name=>{if(prev.has(name))consecutive++;});
      // 큰 실력차 경기는 같은 조건이면 마지막 라운드보다 앞쪽에 분산한다.
      const lateWeight=(idx+1)/rounds.length;
      rms.forEach(m=>lateSpike+=Math.max(0,Math.abs(m.levelDiff||0)-2)*lateWeight);
      prev=new Set(names);
    });
    return {consecutive,lateSpike,energy:consecutive*1000+lateSpike};
  };
  const original=matches.map(m=>({round:m.round,court:m.court}));
  let globalBest=measure();
  let globalSlots=matches.map(m=>({round:m.round,court:m.court}));
  const restarts=5,steps=8000;

  for(let restart=0;restart<restarts;restart++){
    matches.forEach((m,i)=>{m.round=original[i].round;m.court=original[i].court;});
    let current=measure();
    for(let step=0;step<steps;step++){
      const i=Math.floor(Math.random()*matches.length);
      const j=Math.floor(Math.random()*matches.length);
      if(i===j||matches[i].round===matches[j].round)continue;
      const a=matches[i],b=matches[j];
      const ar=a.round,ac=a.court,br=b.round,bc=b.court;
      a.round=br;a.court=bc;b.round=ar;b.court=ac;
      if(!validRound(ar)||!validRound(br)){
        a.round=ar;a.court=ac;b.round=br;b.court=bc;continue;
      }
      const next=measure();
      const progress=step/steps;
      const temperature=Math.max(20,1200*(1-progress));
      const accept=next.energy<=current.energy
        ||Math.random()<Math.exp((current.energy-next.energy)/temperature);
      if(accept){
        current=next;
        if(next.consecutive<globalBest.consecutive
          ||(next.consecutive===globalBest.consecutive&&next.lateSpike<globalBest.lateSpike)){
          globalBest=next;
          globalSlots=matches.map(m=>({round:m.round,court:m.court}));
        }
      }else{
        a.round=ar;a.court=ac;b.round=br;b.court=bc;
      }
    }
  }
  matches.forEach((m,i)=>{m.round=globalSlots[i].round;m.court=globalSlots[i].court;});
}

/* ── 빈 코트 감지 및 경고 데이터 생성 ── */
function checkEmptyCourts(matches,settings,participants){
  const rounds=[...new Set(matches.map(m=>m.round))].sort((a,b)=>a-b);
  const lastR=Math.max(...rounds);
  const warns=[];
  rounds.forEach(r=>{
    if(r===lastR)return; // 마지막 라운드는 제외
    const rm=matches.filter(m=>m.round===r);
    const usedC=new Set(rm.map(m=>m.court));
    const fc=[];for(let c=1;c<=settings.courts;c++){if(!usedC.has(c))fc.push(c);}
    if(fc.length) warns.push({round:r,emptyCourts:fc});
  });
  return warns;
}

/* ════════════════════════════════
   모바일 탭 = 스크롤 이동 (화면 전환 X)
════════════════════════════════ */
let _mobileTab = 'daily';

function isMobile(){ return window.innerWidth <= 768; }

function switchMobileTab(tab){
  _mobileTab = tab;

  // 하단 탭 버튼 활성화
  document.querySelectorAll('.bnav-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('bnav-' + tab);
  if(btn) btn.classList.add('active');

  // 명부 탭은 페이지 전환
  if(tab === 'roster'){
    switchNav('roster');
    window.scrollTo({top:0,behavior:'auto'});
    return;
  }
  if(tab === 'daily'){
    switchNav('daily');
    window.scrollTo({top:0,behavior:'smooth'});
    return;
  }
  // 민턴LIVE 안에서 주요 운영 구역으로 이동
  switchNav('daily');
  if(tab==='players'){
    const details=document.getElementById('dailyPlayersManage');
    if(details)details.open=true;
  }

  // 모바일: 해당 섹션 앵커로 스크롤
  if(isMobile()){
    const targetMap = {
      queue:   'dailyUrgentCard',
      players: 'dailyPlayersManage',
    };
    const targetId = targetMap[tab];
    const el = document.getElementById(targetId);
    if(el){
      const offset = 8; // 약간의 여백
      const top = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({top, behavior:'smooth'});
    }
  }
}

function syncBottomNav(page){
  document.querySelectorAll('.bnav-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('bnav-' + page);
  if(btn) btn.classList.add('active');
}

// 스크롤 위치에 따라 하단 탭 자동 활성화
function updateActiveBnavByScroll(){
  if(!isMobile()) return;
  if(!document.getElementById('pageDaily')?.classList.contains('active'))return;
  const sections = [
    {id:'dailyPlayersManage', tab:'players'},
    {id:'dailyUrgentCard',    tab:'queue'},
    {id:'dailyOpsCard',       tab:'daily'},
  ];
  const scrollY = window.scrollY + 120;
  for(const s of sections){
    const el = document.getElementById(s.id);
    if(el && el.getBoundingClientRect().top + window.scrollY <= scrollY){
      document.querySelectorAll('.bnav-btn').forEach(b => b.classList.remove('active'));
      const btn = document.getElementById('bnav-' + s.tab);
      if(btn) btn.classList.add('active');
      break;
    }
  }
}

let _scrollTimer;
// Ctrl+Z 되돌리기 단축키
window.addEventListener('keydown',(e)=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='z'&&!e.shiftKey){
    const active=document.activeElement;
    // 입력 필드 안에서는 동작 안 함
    if(active&&(active.tagName==='INPUT'||active.tagName==='TEXTAREA')) return;
    e.preventDefault();
    undoAction();
  }
});

window.addEventListener('scroll', ()=>{
  clearTimeout(_scrollTimer);
  _scrollTimer = setTimeout(updateActiveBnavByScroll, 80);
}, {passive:true});

// mob-hide 전부 해제 (이제 모든 섹션 항상 표시)
window.addEventListener('resize', () => {
  document.querySelectorAll('.mob-hide').forEach(el => el.classList.remove('mob-hide'));
});

// 페이지 로드
window.addEventListener('DOMContentLoaded', () => {
  checkSavedState();
  loadRosters();
  renderClubList();
  rsvpLoad();
  rsvpRender();
  dailyLoad();
  _dailySyncPlayerRolesFromRoster();
  dailyApplyReviewSample();
  dailyResumeCheckin();
  dailyRender();
  dailyMaybeAutoRecommend();
  if(!_dailyTimerId)_dailyTimerId=setInterval(dailyRefreshTimers,10000);
  setInterval(dailyRefreshUndoCountdown,1000);
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden&&_dailyCheckinId)_dailyStartOperatorHeartbeat();
  });
  updateTeamModeBadge(); // 팀 컨트롤 초기 상태(개인전) 반영
  setOperationPreset(_operationPreset);
  // 버전 표시 반영
  const vEl=document.getElementById('appVersion');
  if(vEl) vEl.textContent='v'+APP_VERSION;
  // mob-hide 잔여 제거
  document.querySelectorAll('.mob-hide').forEach(el => el.classList.remove('mob-hide'));
  // 하단 탭 초기 활성화
  const btn = document.getElementById('bnav-daily');
  if(btn) btn.classList.add('active');
});

/* ═══ 서비스워커 등록 + 자동 업데이트 ═══
   network-first sw.js와 함께 동작. 새 버전 감지 시 자동으로 적용·새로고침하여
   PWA(홈 화면 설치본)도 항상 최신 코드를 받도록 한다. */
if('serviceWorker' in navigator){
  let _refreshing=false;
  // 새 서비스워커가 활성화되면 페이지 한 번 새로고침 (무한루프 방지 가드)
  navigator.serviceWorker.addEventListener('controllerchange', ()=>{
    if(_refreshing) return;
    _refreshing=true;
    location.reload();
  });
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').then(reg=>{
      // 즉시 업데이트 확인
      reg.update();
      // 새 버전이 설치 대기 중이면 즉시 활성화 요청
      reg.addEventListener('updatefound', ()=>{
        const nw=reg.installing;
        if(!nw) return;
        nw.addEventListener('statechange', ()=>{
          if(nw.state==='installed' && navigator.serviceWorker.controller){
            // 새 버전 설치 완료 → 대기 건너뛰고 활성화 (controllerchange가 reload 트리거)
            nw.postMessage && nw.postMessage('skipWaiting');
          }
        });
      });
    }).catch(()=>{});
    // 앱을 다시 포커스할 때마다 업데이트 확인 (백그라운드 복귀 시 최신화)
    document.addEventListener('visibilitychange', ()=>{
      if(document.visibilityState==='visible'){
        navigator.serviceWorker.getRegistration().then(r=>r&&r.update()).catch(()=>{});
      }
    });
  });
}
