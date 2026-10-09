(function(){
  'use strict';
  const C=window.KokClubSkill,$=id=>document.getElementById(id),KEY='kokmatch_club_skill_links_v1';
  const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch(_){return fallback;}};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const write=(key,data)=>localStorage.setItem(key,JSON.stringify(data));
  let links=read(KEY,[]),active=null,session=null,batch=[],answers={},at=0,busy=false,flipped=false,evaluatingAsOwner=false;
  const from=new URLSearchParams(location.search).get('from')==='team'?'team.html':'index.html';
  const quick=new URLSearchParams(location.search).get('quick')==='1';
  $('back').href=from;
  const clubs=read('badminton_rosters_v1',{}).clubs||[];
  const nonce=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
  const message=s=>$('status').textContent=s;
  const label=step=>step===0?'기본':`${step>0?'+':''}${(step*.2).toFixed(1)}점`;
  const ownerLink=()=>links.find(l=>l.id===active?.id);
  async function api(data){
    const own=links.find(l=>l.id===data.id&&l.key===data.key);
    if(data.action==='read'&&own&&window.KokSkillBatch){
      const club=read('badminton_rosters_v1',{}).clubs?.find(c=>c.id===own.clubId);
      data={...data,clubId:own.clubId,baselines:window.KokSkillBatch.reviewBaselines(own,club)};
    }
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
    try{
      const response=await fetch('https://us-central1-kokmatch-23b31.cloudfunctions.net/clubSkillCalibration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data}),signal:controller.signal});
      const json=await response.json();if(!response.ok||json.error)throw Error(json.error?.message||'연결을 확인해 주세요.');return json.result;
    }finally{clearTimeout(timer);}
  }
  function persist(entry){
    const fresh=read(KEY,[]),i=fresh.findIndex(l=>l.id===entry.id);
    if(i<0)fresh.push(entry);else fresh[i]=entry;
    write(KEY,fresh);links=fresh;
  }
  function panels(id){['setup','owner','identity','quiz','done'].forEach(s=>$(s).hidden=s!==id);}
  // Legacy roster screens and both match engines already use 40대 when absent.
  const reviewProfile=m=>({...m,ageGroup:m.ageGroup||'40대'});
  function eligible(club){
    const members=[],issues=[],names=new Map();
    for(const m of club?.members||[]){const name=String(m?.name||'').trim();names.set(name,(names.get(name)||0)+1);}
    for(const m of club?.members||[]){
      try{const p=C.player(reviewProfile(m));if(names.get(p.name)>1)throw Error('이름 중복');members.push(m);}
      catch(e){issues.push({name:m?.name||'이름 없음',reason:e.message});}
    }
    return {members,issues};
  }
  function checkRoster(){
    const {members,issues}=eligible(clubs[Number($('club').value)]);
    $('rosterCheck').innerHTML=issues.length?`<p>${members.length}명 비교 가능 · ${issues.length}명 정보 확인 필요</p><details><summary>확인할 회원 ${issues.length}명</summary>${issues.map(p=>`<p>${esc(p.name)} · ${esc(p.reason)}</p>`).join('')}</details>`:'';
    const legacy=members.filter(m=>!m.ageGroup).length;
    if(legacy)$('rosterCheck').innerHTML+=`<p class="muted">연령 미입력 ${legacy}명은 기존 명부와 같은 40대 기준입니다.</p>`;
    $('create').textContent=issues.length?'확인된 '+members.length+'명으로 준비':'밸런스게임 준비';
    $('create').disabled=members.length<2;
    return {members,issues};
  }
  function boundarySelection(){return [...document.querySelectorAll('.boundary-pick:checked')].map(e=>e.value);}
  function previewBoundaries(){
    if(!session||!C.measurementPairs)return;
    const selected=boundarySelection(),questions=C.measurementPairs(session.players,selected),old=new Set(session.storedQuestionIds||session.questions.map(q=>q.id));
    const cross=questions.filter(q=>q.kind==='cross-grade'),added=cross.filter(q=>!old.has(q.id));
    const name=id=>session.players.find(p=>p.id===id)?.name||id;
    $('boundaryPreview').innerHTML=`<p>기존 응답 ${session.count}건 보존 · 추가 교차 질문 ${added.length}개</p>`+cross.map(q=>`<p>${esc(name(q.a))} ↔ ${esc(name(q.b))}${old.has(q.id)?' · 기존 질문':''}</p>`).join('');
    const grades=[...new Set(session.players.map(p=>p.grade))],chosenGrades=new Set(session.players.filter(p=>selected.includes(p.id)).map(p=>p.grade));
    const missing=grades.filter(g=>!chosenGrades.has(g));
    if(grades.length>1&&missing.length)$('boundaryPreview').innerHTML+=`<p class="muted">${missing.map(esc).join('·')} 경계 선수를 선택해 주세요. 선수의 평가값은 자동 입력하지 않습니다.</p>`;
    $('configureMeasurement').disabled=session.closed||session.expiresAt<=Date.now()||(grades.length>1&&missing.length>0);
  }
  function assessmentPlan(){
    const own=ownerLink();if(!own)return null;
    if(own.recommendation?.sourceId===session.id)return own.recommendation;
    if(window.MintonRecommendedPlan?.sourceId===session.id)return window.MintonRecommendedPlan;
    return window.KokSkillPlan?.recommend(session)||null;
  }
  function renderRecommendations(){
    if(!$('recommendationSetup'))return;
    const own=ownerLink(),plan=assessmentPlan();$('recommendationSetup').hidden=!plan;if(!plan)return;
    if(window.KokSkillPlan?.nextQuestions){
      const next=window.KokSkillPlan.nextQuestions(session,12);own.recommendation=plan;persist(own);
      $('recommendedSummary').textContent=`기존 ${session.count}응답 재사용 · 다음 비교 최대 12문항 중 ${next.length}문항. 동급·인접 급수에서 근거 부족과 상충을 먼저 확인합니다. 본인이 이미 답한 쌍은 제외하며, 추가 데이터만으로 정확성이 보장되지는 않습니다.`;
      $('recommendedCandidates').innerHTML=next.map(q=>`<p>${esc(session.players.find(p=>p.id===q.a)?.name)} ↔ ${esc(session.players.find(p=>p.id===q.b)?.name)} · ${esc(q.reason)}</p>`).join('')||'<p class="muted">우선 확인할 미응답 비교가 없습니다. 다른 판단자의 독립 확인이 필요할 수 있습니다.</p>';
      $('recommendedQuestions').innerHTML=next.map(q=>`<p>${esc(q.boundary)} · ${q.kind==='same-grade'?'동급':'인접 급수'} · ${esc(q.reason)}</p>`).join('');
      $('startRecommended').textContent=`추가 비교 ${next.length}문항 시작`;$('startRecommended').disabled=!next.length||session.closed||session.expiresAt<=Date.now();$('startSupplement').hidden=true;$('answerSelf').hidden=false;return;
    }
    own.recommendation=plan;persist(own);$('answerSelf').hidden=true;
    const name=id=>session.players.find(p=>p.id===id)?.name||id;
    $('recommendedSummary').textContent=`기존 ${plan.sourceCount}응답 보존 · 예비 ${plan.pilot.length}문항 → 첫 묶음 ${plan.initial.length}문항 · 문항마다 서로 다른 임원 3명 권장, 총 ${plan.initialResponses}응답. 상대 수 부족 보충 ${plan.supplement.length}문항까지 총 ${plan.fullResponses}응답 목표입니다. 정확도를 보장하는 수치는 아닙니다.`;
    $('recommendedCandidates').innerHTML=plan.candidates.map(p=>`<p><strong>${esc(name(p.id))} · ${esc(p.grade)}</strong> — ${esc(p.reason)}${p.exploratory?' · 탐색 후보':''}<br><small>유효 상대 ${p.resolved}명 · 판단자 묶음 ${p.experts}개 · 기존 연결 집단 ${p.componentSize}명</small></p>`).join('');
    $('recommendedQuestions').innerHTML=[['먼저 볼 예비 질문',plan.pilot],['첫 묶음의 나머지 질문',plan.confirm],['상대 수가 부족한 회원의 보충 질문',plan.supplement]].map(([title,list])=>`<h3>${title} ${list.length}개</h3>`+list.map(q=>`<p>${esc(q.boundary)} · ${esc(name(q.a))} ↔ ${esc(name(q.b))}</p>`).join('')).join('');
    const done=list=>list.every(q=>Object.hasOwn(session.ownerAnswers||{},q.id));
    $('startRecommended').textContent=done(plan.pilot)?done(plan.confirm)?'첫 묶음 답안 확인':`나머지 ${plan.confirm.length}문항 시작`:`예비 ${plan.pilot.length}문항 시작`;
    $('startRecommended').disabled=session.closed||session.expiresAt<=Date.now();
    $('startSupplement').textContent=`보충 ${plan.supplement.length}문항 준비`;$('startSupplement').disabled=!done(plan.initial)||session.closed||session.expiresAt<=Date.now();
  }
  async function beginRecommended(supplement=false){
    if(window.KokSkillPlan?.nextQuestions){
      if(busy)return;const own=ownerLink();if(!own)return;busy=true;
      try{
        session=await api({action:'read',...active});const pending=read('kokmatch_skill_draft_'+own.id+'_'+own.key,{});const selected=Object.keys(pending).length&&own.adaptiveQuestions?.length?own.adaptiveQuestions:window.KokSkillPlan.nextQuestions(session,12);if(!selected.length){busy=false;renderOwner();return;}
        const cross=selected.filter(q=>q.kind==='cross-grade'),missing=cross.filter(q=>!session.questions.some(v=>v.id===q.id));
        if(session.assessmentVersion!==2||missing.length){session=await api({action:'measurement',...active,boundaryIds:[...new Set(cross.flatMap(q=>[q.a,q.b]))],...(cross.length?{questionIds:cross.map(q=>q.id)}:{})});}
        own.adaptiveQuestions=selected;own.reviewPhase='adaptive';persist(own);evaluatingAsOwner=true;session={...session,answers:session.ownerAnswers||{},respondentName:'관리자 개인 평가'};busy=false;startBatch();
      }catch(e){busy=false;message(e.message);}return;
    }
    if(busy)return;const own=ownerLink(),plan=assessmentPlan();if(!own||!plan)return;busy=true;
    try{
      const questions=supplement?plan.initial.concat(plan.supplement):plan.initial;
      if(questions.some(q=>!session.questions.some(v=>v.id===q.id))||session.assessmentVersion!==2){
        const boundaryIds=[...new Set(questions.flatMap(q=>[q.a,q.b]))];
        session=await api({action:'measurement',...active,boundaryIds,questionIds:questions.map(q=>q.id)});
      }
      session=await api({action:'read',...active});
      own.recommendation=plan;own.reviewPhase=supplement?'coverage':plan.pilot.every(q=>Object.hasOwn(session.ownerAnswers||{},q.id))?'confirm':'pilot';persist(own);
      evaluatingAsOwner=true;session={...session,answers:session.ownerAnswers||{},respondentName:'관리자 예비 평가'};busy=false;startBatch();
    }catch(e){message(e.message);}finally{busy=false;}
  }
  if($('startRecommended'))$('startRecommended').onclick=()=>beginRecommended(false);
  if($('startSupplement'))$('startSupplement').onclick=()=>beginRecommended(true);
  if($('referenceExisting'))$('referenceExisting').onclick=async()=>{
    if(busy||!session.referenceAvailable)return;busy=true;
    try{session=await api({action:'reference',...active,expectedRevision:session.referenceRevision});renderOwner();message('기존 답안과 최초 기준을 보존하고 연결했습니다. 명부 점수는 아직 저장하지 않았습니다.');}
    catch(e){message(e.message);}finally{busy=false;}
  };
  function renderMeasurementSetup(){
    if(!$('boundaryPlayers'))return;
    const selected=new Set(session.boundaryIds||[]);
    $('boundaryPlayers').innerHTML=session.players.map(p=>`<label class="boundary-row"><input type="checkbox" class="boundary-pick" value="${esc(p.id)}" ${selected.has(p.id)?'checked':''}><span><strong>${esc(p.name)}</strong> · ${esc(p.grade)}<br><small>점수 ${(5+p.base).toFixed(1)} · 실력 점수 ${(5+(p.skillRating??(p.base+p.skillStep*.2))).toFixed(2)}</small></span></label>`).join('');
    $('measurementSetup').open=!window.KokSkillPlan&&session.assessmentVersion!==2;
    $('measurementInfo').textContent=session.assessmentVersion===2?'기존 평가를 보존한 개인 실력 측정입니다. 나이·성별은 기존 점수에 포함되며 다시 보정하지 않습니다.':'기존 동급 평가를 살리고 경계 선수 교차 비교로 연결합니다. 이전 질문·응답은 삭제하지 않습니다.';
    $('answerSelf').textContent=session.assessmentVersion===2?'관리자 개인 평가 시작':'나도 참여하기';
    previewBoundaries();
  }
  $('boundaryPlayers').onchange=previewBoundaries;
  $('configureMeasurement').onclick=async()=>{
    if(busy)return;busy=true;$('configureMeasurement').disabled=true;
    try{session=await api({action:'measurement',...active,boundaryIds:boundarySelection()});
      if(session.assessmentVersion!==2)throw Error('새 측정 서버가 아직 반영되지 않았습니다. 기존 자료는 유지합니다.');
      session=await api({action:'read',...active});message('기존 응답을 보존하고 교차 비교를 준비했습니다.');renderOwner();
    }catch(e){message(e.message);}finally{busy=false;previewBoundaries();}
  };
  function setup(){
    panels('setup');
    $('club').innerHTML=clubs.map((c,i)=>`<option value="${i}">${esc(c.name)}</option>`).join('');
    const requested=new URLSearchParams(location.search).get('club');
    const selected=clubs.findIndex(c=>String(c.id)===requested);
    if(selected>=0)$('club').value=String(selected);
    checkRoster();
    if(!clubs.length)message('명부에 클럽과 회원을 먼저 등록해 주세요.');
    $('historyLabel').hidden=!links.length;
    $('history').innerHTML='<option value="">선택</option>'+links.slice().reverse().map(l=>`<option value="${l.id}">${esc(l.clubName)} · ${new Date(l.createdAt).toLocaleDateString('ko-KR')}</option>`).join('');
  }
  async function open(link){
    if(busy)return;busy=true;active=link;message('불러오는 중');
    try{session=await api({action:'read',...link});message('');if(ownerLink()?.key===link.key)renderOwner();else if(session.needsIdentity)renderIdentity();else startBatch();}
    catch(e){message(e.message);setup();}finally{busy=false;}
  }
  function resultState(p,original,current){
    if(p.assessment&&!p.reviewed)return {key:'pending',title:'평가 부족 · 미반영',reason:p.assessment.reason};
    if(p.model?.startsWith('comparison-v')){
      const same=window.KokSkillBatch.same;
      if(!same(original,current))return {key:'changed',title:'명부 변경됨',reason:'명부가 변경됐습니다. 새로고침해 주세요.'};
      if(!p.opponents)return {key:'unreviewed',title:'초기 추정',reason:'비교 응답이 없어 초기 추정을 유지합니다.'};
      const note=p.assessment?'급수 간 연결과 상대 3명 이상의 유효 비교를 확인했습니다.':p.connected?'누적 비교 전체로 추정했습니다.':'비교 집단 간 연결이 부족합니다. 다른 집단과 비교하면 전체 점수가 더 정확해집니다.';
      return p.ready?{key:'ready',title:'저장 가능',reason:note}:{key:'applied',title:'반영 완료',reason:note};
    }
    const fields=['name','grade','gender','ageGroup'];
    const profileValue=(m,k)=>k==='ageGroup'?(m[k]||'40대'):k==='gender'?(['F','여'].includes(m[k])?'여':['M','남'].includes(m[k])?'남':m[k]):m[k];
    const sameProfile=original&&current&&fields.every(k=>String(profileValue(current,k)??'')===String(profileValue(original,k)??''));
    const step=Number(current?.skillStep||0),before=Number(original?.skillStep||0);
    const sameLevel=String(current?.level??'')===String(original?.level??'');
    const expected=Math.round((Number(original?.level)+(p.step-before)*.2)*10)/10;
    const applied=sameProfile&&p.step!==p.current&&step===p.step&&Number.isFinite(expected)&&Math.abs(Number(current.level)-expected)<.001;
    if(applied)return {key:'applied',title:'반영 완료',reason:'현재 명부가 이 보정안과 일치합니다.'};
    if(!sameProfile||step!==before||!sameLevel)return {key:'changed',title:'명부 변경됨',reason:'현재 명부와 달라 이 제안은 적용할 수 없습니다. 새 점검이 필요합니다.'};
    if(!p.opponents)return {key:'unreviewed',title:'비교 전',reason:'아직 비교 응답이 없습니다.'};
    if(p.ready)return {key:'ready',title:'적용 가능 · 미반영',reason:'비교 근거를 확인한 뒤 명부에 저장해 주세요.'};
    if(p.reviewed&&p.step===p.current)return {key:'same',title:'현재 값 유지',reason:'전체 비교 관계에서 현재 보정값을 유지하는 안입니다.'};
    return {key:'pending',title:'추가 확인 · 미반영',reason:p.opponents<3?`서로 다른 상대 ${3-p.opponents}명 이상과 추가 비교가 필요합니다.`:
      p.conflicts?`${p.conflicts}개 비교에서 판단이 나뉘었습니다. 해당 비교를 추가 확인해 주세요.`:'전체 비교 관계가 충분히 맞지 않아 추가 확인이 필요합니다.'};
  }
  function comparisonCoverage(players,questions,evidence={}){
    const byId=new Map(players.map(p=>[p.id,p])),crossMembers=new Set();
    let same=0,cross=0;
    for(const q of questions){
      const n=evidence[q.id]?.count||0,a=byId.get(q.a),b=byId.get(q.b);
      if(!n||!a?.grade||!b?.grade)continue;
      if(a.grade===b.grade)same+=n;
      else{cross+=n;crossMembers.add(a.id);crossMembers.add(b.id);}
    }
    const multiGrade=new Set(players.map(p=>p.grade).filter(Boolean)).size>1;
    return {same,cross,multiGrade,missing:multiGrade?players.filter(p=>!crossMembers.has(p.id)).length:0};
  }
  function reviewProgress(players,questions,proposals){
    const rows=players.map(player=>{
      const p=proposals.find(p=>p.id===player.id),complete=(p?.opponents||0)>0;
      return {name:player.name,complete,missing:complete?0:1,reason:complete?'비교 반영 가능':'아직 비교 응답 없음'};
    });
    const done=rows.filter(r=>r.complete).length,percent=players.length?Math.floor(done/players.length*100):null;
    return {total:players.length,done,percent,remaining:percent===null?null:100-percent,minimumQuestions:Math.ceil((players.length-done)/2),pending:rows.filter(r=>!r.complete),excluded:[]};
  }

  function proposalRow(proposal,own,club){
    const original=own.snapshots[Number(proposal.id.slice(1))],matches=club?.members?.filter(m=>m.name===original?.name)||[];
    const current=matches.length===1?matches[0]:null;
    const baseline=window.KokSkillBatch?.baseline(club,own.id,proposal.id,current);
    if(proposal.basis){
      const matchesBasis=window.KokSkillBatch?.same(current,proposal.basis);
      const sameIdentity=window.KokSkillBatch?.sameIdentity(original,current);
      if(!matchesBasis||!sameIdentity)return {p:proposal,current,original,state:{key:'changed',title:'명부 확인 필요',reason:'회원 정보가 변경됐습니다. 결과를 새로고침해 주세요. 회원 이름과 현재 값을 확인합니다.'}};
      const p={...proposal,current:Number(current.skillStep||0)};
      let state=resultState(p,current,current);
      if(!p.model?.startsWith('comparison-v')&&baseline&&p.step===p.current)state={key:'applied',title:'반영 완료',reason:'현재 명부가 이 보정안과 일치합니다.'};
      return {p,state,original:current,current};
    }
    const p=baseline?{...proposal,current:baseline.skillStep,ready:!!proposal.reviewed&&proposal.step!==baseline.skillStep}:{...proposal};
    let state=resultState(p,baseline||original,current);
    if(baseline&&proposal.step===baseline.skillStep)state={key:'applied',title:'반영 완료',reason:'현재 명부가 이 보정안과 일치합니다.'};
    return {p,state,original:baseline||original,current};
  }
  function renderOwner(){
    evaluatingAsOwner=false;renderMeasurementSetup();renderRecommendations();
    panels('owner');const own=ownerLink();
    $('ownerResults').hidden=!session.count;
    $('clubTitle').textContent=session.clubName+' · 클럽 내 실력 평가';
    const progress=reviewProgress(session.players,session.questions,session.proposals);
    $('collectionProgress').innerHTML=`<h2>${progress.total}명 중 ${progress.done}명 비교 자료 있음</h2><p class="muted">기존 동급 응답을 보존합니다. 급수 간 연결과 서로 다른 상대 3명 이상의 유효 근거가 부족하면 현재 값을 유지합니다.</p>`;
    const coverage=comparisonCoverage(session.players,session.questions,session.evidence);
    $('collectionProgress').innerHTML+=`<p>같은 급수 비교 ${coverage.same}건 · 다른 급수 비교 ${coverage.cross}건</p>`;
    if(coverage.missing)$('collectionProgress').innerHTML+=`<p class="muted">${coverage.missing}명은 다른 급수와 직접 비교한 자료가 없습니다. 같은 급수 안의 우세만으로 급수 간 실력 차이를 확정할 수 없습니다. 추가 참여에서는 가까운 다른 급수와의 비교를 우선합니다.</p>`;
    if(!coverage.multiGrade)$('collectionProgress').innerHTML+='<p class="muted">이 명부에는 다른 급수 회원이 없어 급수 간 실력 차이를 확인할 수 없습니다.</p>';
    if(progress.pending.length)$('collectionProgress').innerHTML+=`<details><summary>비교 전 ${progress.pending.length}명</summary>${progress.pending.map(r=>`<p>${esc(r.name)}</p>`).join('')}</details>`;
    if($('referenceExisting')){$('referenceExisting').hidden=!session.referenceAvailable;$('referenceExisting').textContent=`기존 ${session.referenceAvailable?.sourceCount||0}답안 연결`;}
    if($('referenceInfo')){$('referenceInfo').hidden=!session.referenceInfo;$('referenceInfo').textContent=session.referenceInfo?`기존 ${session.referenceInfo.sourceCount}개 + 새 ${session.referenceInfo.targetCount}개 · 원래 기준으로 재계산 · 명부 점수는 별도 저장합니다. 판단자 수는 응답 묶음 수이며 독립 인원이 확인된 수는 아닙니다.`:'';}
    const currentClub=read('badminton_rosters_v1',{}).clubs?.find(c=>c.id===own.clubId);
    if(session.clubId&&session.clubId!==own.clubId)throw Error('평가와 명부의 클럽이 다릅니다.');
    const rows=session.proposals.map(p=>proposalRow(p,own,currentClub));
    const count=key=>rows.filter(r=>r.state.key===key).length;
    const ready=rows.filter(r=>r.state.key==='ready');
    own.readyCount=ready.length;own.closed=session.closed;own.reviewedAt=session.reviewedAt||own.reviewedAt||0;persist(own);
    $('applyAll').hidden=!ready.length;$('applyAll').textContent=`보정안 ${ready.length}명 일괄 저장`;
    $('undoBatch').hidden=!currentClub?.skillReview?.latest;
    $('notice').textContent=`${session.count}개 응답 저장됨 · ${rows.filter(r=>r.p.opponents).length}/${rows.length}명 비교`;
    $('notice').className=ready.length?'ready-notice':'muted';
    $('resultSummary').innerHTML=[['applied','반영 완료'],['ready','적용 가능'],['pending','평가 부족'],['same','변경 없음']].map(([key,title])=>`<div><strong>${count(key)}명</strong><span>${title}</span></div>`).join('');
    $('resultHelp').textContent=count('applied')?`${count('applied')}명 보정값 명부 반영 완료. 이 기기의 명부로 새 대진을 생성하면 적용됩니다. 이미 생성한 대진은 그대로 유지됩니다.`:ready.length?'보정안을 명부에 저장하면 새 대진에 적용됩니다.':'현재 명부 값을 유지합니다.';
    if(ready.length)$('resultHelp').textContent+=` 추가 저장 가능 ${ready.length}명.`;
    if(count('pending'))$('resultHelp').textContent+=` 추가 확인 ${count('pending')}명은 현재 값을 유지하며, 추가 비교 후 조정할 수 있습니다.`;
    if(count('unreviewed'))$('resultHelp').textContent+=` 아직 비교하지 않은 회원 ${count('unreviewed')}명.`;
    if(session.legacyCount)$('resultHelp').textContent+=` 기존 개별 링크 응답 ${session.legacyCount}개도 포함됩니다. 이미 참여한 분은 중복 참여하지 말고 기존 링크에서 수정해 주세요.`;
    const order={ready:0,pending:1,applied:2,changed:3,same:4};
    $('proposals').innerHTML=rows.filter(r=>r.p.opponents).sort((a,b)=>order[a.state.key]-order[b.state.key]).map(({p,state})=>{
      const player=session.players.find(v=>v.id===p.id),before=5+(p.currentRating??(player.base+p.current*.2)),after=5+(p.skillRating??(player.base+p.step*.2)),delta=after-before;
      const change=delta>0?'+'+delta.toFixed(3):delta.toFixed(3);
      const evidence=(p.comparisons||[]).map(c=>`<li>${esc(c.name)}${c.grade?` (${esc(c.grade)} · ${c.kind==='cross-grade'?'교차':'동급'})`:''} 대비 ${!c.agree?'의견 나뉨':c.outcome==='tie'?'비슷함':c.outcome==='higher'?'개인 실력 우세':'개인 실력 열세'} · ${c.votes}명 응답</li>`).join('');
      return `<article class="result-row"><div class="result-heading"><strong>${esc(p.name)}</strong><span class="result-status ${state.key}">${state.title}</span></div><p class="score-change">${before.toFixed(3)} <span>→</span> ${after.toFixed(3)} <b>${change}</b></p><p>${Number.isFinite(p.baseRating)?`기본 표시 ${(p.baseRating+5).toFixed(3)} ${p.adjustment>=0?'+':'−'} 개인 보정 ${Math.abs(p.adjustment).toFixed(3)} = 추정 표시 ${(p.skillRating+5).toFixed(3)}`:'해당 클럽 비교로 추정한 최종 실력'} · 성별·연령 추가 보정 없음</p><p class="muted">${state.reason}</p><details><summary>비교 근거 · 상대 ${p.opponents}명</summary><p>판단자 ${p.experts}명 · 유효 비교 ${p.resolved??'확인 중'}개</p>${p.assessment?`<p>동급 상대 ${p.assessment.sameGradeOpponents}명 · 교차 상대 ${p.assessment.crossGradeOpponents}명 · 연결 급수 ${p.assessment.linkedGrades.map(esc).join('·')}</p>`:''}<ul>${evidence||'<li>결과를 새로고침하면 근거를 확인할 수 있습니다.</li>'}</ul><p class="muted">음수 표시를 피하려고 기본·추정 점수에 각각 5점을 한 번 더합니다. 보정값에는 더하지 않습니다. 저장·대진 계산은 내부 점수를 사용하며, 표시점수는 승률·실력 배수·10점 만점이 아닙니다.</p></details>${state.key==='ready'?`<button class="primary" data-apply="${p.id}">명부에서 ${change} 적용 확인</button>`:''}</article>`;
    }).join('')||'<p class="muted">첫 비교를 기다리고 있습니다.</p>';
    $('answerSelf').textContent=session.assessmentVersion===2?'관리자 개인 평가 시작':'나도 참여하기';
    $('expiry').textContent=`${new Date(session.expiresAt).toLocaleDateString('ko-KR')}까지 · ${session.closed?'마감됨':'응답 가능'}`;
    $('close').disabled=session.closed;$('answerSelf').disabled=session.closed||session.expiresAt<=Date.now();
    $('share').disabled=true;$('retryShare').hidden=true;
    if($('answerSelf').disabled)$('ownerState').textContent='응답 마감';
    else prepareOwnerShare(own);
  }
  $('create').onclick=async()=>{
    if(busy)return;
    const club=clubs[Number($('club').value)];if(!club)return;
    try{
      const {members,issues}=checkRoster();
      if(issues.length&&!confirm(`${issues.length}명은 정보를 확인해야 합니다. 명부는 그대로 두고 확인된 ${members.length}명으로 비교할까요?`))return;
      const players=C.players(members.map(reviewProfile));
      if(!C.pairs(players).length)throw Error('비교할 회원이 부족합니다.');
      const reusable=links.slice().reverse().find(l=>l.clubId===club.id&&!l.pending&&!l.closed&&Date.now()-l.createdAt<30*86400000&&l.snapshots?.length===members.length&&l.snapshots.every((m,i)=>window.KokSkillBatch.sameIdentity(m,members[i])));
      if(reusable){await open({id:reusable.id,key:reusable.key});return;}
      let entry=links.find(l=>l.clubId===club.id&&l.pending&&l.snapshots?.length===members.length&&l.snapshots.every((m,i)=>window.KokSkillBatch.sameIdentity(m,members[i])));
      if(!entry){entry={id:nonce(),key:nonce(),invites:[nonce(),nonce(),nonce()],clubId:club.id,clubName:club.name,createdAt:Date.now(),snapshots:JSON.parse(JSON.stringify(members)),players,pending:true};persist(entry);}
      busy=true;$('create').disabled=true;message('퀴즈를 만드는 중');
      session=await api({action:'create',id:entry.id,key:entry.key,invites:entry.invites,assessmentVersion:2,clubId:entry.clubId,clubName:entry.clubName,players:entry.players});
      entry.pending=false;persist(entry);active={id:entry.id,key:entry.key};message('');
      renderOwner();
    }catch(e){message(e.message);}finally{busy=false;$('create').disabled=false;}
  };
  $('club').onchange=checkRoster;
  $('history').onchange=()=>{const l=links.find(l=>l.id===$('history').value);if(l)open({id:l.id,key:l.key});};
  async function sharedLink(own){
    if(!own.sharedKey){own.sharedKey=nonce();persist(own);}
    if(!own.sharedReady){await api({action:'share',id:own.id,key:own.key,sharedKey:own.sharedKey});own.sharedReady=true;persist(own);}
    return {id:own.id,key:own.sharedKey};
  }
  async function prepareOwnerShare(own){
    $('ownerState').textContent='공유 링크 준비 중';$('retryShare').hidden=true;$('share').disabled=true;
    try{
      await sharedLink(own);
      if(active?.key!==own.key||$('owner').hidden||session.closed||session.expiresAt<=Date.now())return;
      $('share').disabled=false;
      $('ownerState').textContent=session.count?'응답 수집 중':`준비 완료 · ${session.players.length}명`;
    }catch(e){
      if(active?.key!==own.key||$('owner').hidden||session.closed||session.expiresAt<=Date.now())return;
      $('ownerState').textContent='공유 준비를 완료하지 못했습니다.';$('retryShare').hidden=false;message(e.message);
    }
  }
  $('retryShare').onclick=()=>{const own=ownerLink();if(own)prepareOwnerShare(own);};
  async function openShared(own){
    if(busy||!own)return;busy=true;
    try{const link=await sharedLink(own);busy=false;await open(link);}catch(e){message(e.message);}finally{busy=false;}
  }
  $('share').onclick=async()=>{
    const own=ownerLink();if(!own||busy)return;busy=true;
    try{
      const link=own.sharedReady?{id:own.id,key:own.sharedKey}:await sharedLink(own),url=new URL('skill-review.html',location.href);
      url.search='';url.searchParams.set('v',document.querySelector('meta[name="app-version"]').content);url.hash=link.id+'.'+link.key;
      try{if(navigator.share)await navigator.share({title:'민턴라이브 · 우리 클럽 밸런스게임',text:'현재 개인 실력을 비교해 주세요.',url:url.href});else{await navigator.clipboard.writeText(url.href);message('단톡방에 보낼 링크를 복사했습니다.');}}
      catch(e){if(e.name!=='AbortError')prompt('단톡방 공유 링크',url.href);}
    }catch(e){message(e.message);}finally{busy=false;}
  };
  $('answerSelf').onclick=()=>{
    if(session.assessmentVersion===2){evaluatingAsOwner=true;session={...session,answers:session.ownerAnswers||{},respondentName:'관리자 직접 평가'};startBatch();}
    else openShared(ownerLink());
  };
  function renderIdentity(){
    panels('identity');
    $('respondent').innerHTML='<option value="">이름 선택</option>'+session.players.slice().sort((a,b)=>a.name.localeCompare(b.name,'ko')).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    const saved=read('kokmatch_skill_identity_'+active.id,null);
    if(saved?.playerId)$('respondent').value=saved.playerId;
    $('join').disabled=session.closed||session.expiresAt<=Date.now();
    if($('join').disabled)message('마감되었거나 만료된 퀴즈입니다.');
  }
  $('join').onclick=async()=>{
    if(busy)return;
    const player=session.players.find(p=>p.id===$('respondent').value);if(!player){message('본인 이름을 선택해 주세요.');return;}
    const storageKey='kokmatch_skill_identity_'+active.id,saved=read(storageKey,null);
    if(saved?.playerId!==player.id&&!confirm(`${player.name} 님으로 참여할까요?`))return;
    busy=true;$('join').disabled=true;
    try{
      const credential=saved?.key||nonce();write(storageKey,{key:credential,playerId:player.id});
      session=await api({action:'join',...active,playerId:player.id,respondentKey:credential});
      active={id:active.id,key:credential};message('');startBatch();
    }catch(e){message(e.message);}finally{busy=false;$('join').disabled=false;}
  };
  function reviewQuestions(questions,previous,limit=20,evidence={},players=[]){
    const counts={},parent={},crossCounts={};
    const grades=new Map(players.map(p=>[p.id,({S:7,A:6,B:5,C:4,D:3,E:2})[p.grade]]));
    const gap=q=>Math.abs(grades.get(q.a)-grades.get(q.b));
    const cross=q=>Number.isFinite(gap(q))&&gap(q)>0;
    const nearest={};
    for(const q of questions)if(cross(q))for(const id of [q.a,q.b])nearest[id]=Math.min(nearest[id]??Infinity,gap(q));
    const recordCross=q=>{if(cross(q)){crossCounts[q.a]=(crossCounts[q.a]||0)+1;crossCounts[q.b]=(crossCounts[q.b]||0)+1;}};
    const find=x=>parent[x]===undefined?(parent[x]=x):parent[x]===x?x:(parent[x]=find(parent[x]));
    const join=q=>{parent[find(q.a)]=find(q.b);};
    for(const q of questions)if(evidence[q.id]?.count||(previous[q.id]&&previous[q.id]!=='skip'))join(q);
    for(const q of questions)if(evidence[q.id]?.count||(previous[q.id]&&previous[q.id]!=='skip')){
      counts[q.a]=(counts[q.a]||0)+1;counts[q.b]=(counts[q.b]||0)+1;
      recordCross(q);
    }
    const remaining=questions.filter(q=>!Object.hasOwn(previous,q.id)),chosen=[];
    while(remaining.length&&chosen.length<limit){
      const need=q=>evidence[q.id]?.count?0:Number(!(counts[q.a]||0))+Number(!(counts[q.b]||0));
      const crossNeed=q=>!evidence[q.id]?.count&&cross(q)?Number(!crossCounts[q.a])+Number(!crossCounts[q.b]):0;
      const near=q=>crossNeed(q)?Number(gap(q)===nearest[q.a])+Number(gap(q)===nearest[q.b]):0;
      remaining.sort((a,b)=>Number(find(b.a)!==find(b.b))-Number(find(a.a)!==find(a.b))||crossNeed(b)-crossNeed(a)||near(b)-near(a)||need(b)-need(a)||Number(!!evidence[b.id]?.needsReview)-Number(!!evidence[a.id]?.needsReview)||
        (evidence[a.id]?.count||0)-(evidence[b.id]?.count||0)||Math.max(counts[a.a]||0,counts[a.b]||0)-Math.max(counts[b.a]||0,counts[b.b]||0)||
        ((counts[a.a]||0)+(counts[a.b]||0))-((counts[b.a]||0)+(counts[b.b]||0))||a.id.localeCompare(b.id));
      const q=remaining.shift();chosen.push(q);join(q);if(!evidence[q.id]?.count){counts[q.a]=(counts[q.a]||0)+1;counts[q.b]=(counts[q.b]||0)+1;recordCross(q);}
    }
    return chosen;
  }
  function reviewPlan(questions,previous,pending,saved,version,evidence,players){
    if(saved.length&&version==='cross-grade-v1')return saved.map(id=>questions.find(q=>q.id===id)).filter(Boolean);
    // Migrate only unanswered old questions; keep every local answer and saved
    // answer in the current batch, including partially submitted retry chunks.
    const answered=q=>Object.hasOwn(pending,q.id)||Object.hasOwn(previous,q.id);
    const fixed=saved.map(id=>questions.find(q=>q.id===id)).filter(q=>q&&answered(q));
    for(const q of questions)if(Object.hasOwn(pending,q.id)&&!fixed.some(p=>p.id===q.id))fixed.push(q);
    return fixed.concat(reviewQuestions(questions,{...previous,...pending},Math.max(0,20-fixed.length),evidence,players));
  }
  function ownerMeasurementQuestions(){
    const own=ownerLink(),plan=own?.recommendation;
    if(evaluatingAsOwner&&own?.reviewPhase==='adaptive'&&own.adaptiveQuestions?.length){const ids=new Set(own.adaptiveQuestions.map(q=>q.id));return session.questions.filter(q=>ids.has(q.id));}
    if(evaluatingAsOwner&&plan?.sourceId===session.id){
      if(own.reviewPhase!=='coverage'&&own.reviewPhase!=='confirm'&&plan.pilot.every(q=>Object.hasOwn(session.answers||{},q.id))){own.reviewPhase='confirm';persist(own);}
      const phase=own.reviewPhase==='coverage'?plan.supplement:own.reviewPhase==='confirm'?plan.confirm:plan.pilot;
      const ids=new Set(phase.map(q=>q.id)),pending=read(draftKey(),{});
      for(const id of Object.keys(pending))ids.add(id);
      const selected=phase.map(q=>session.questions.find(v=>v.id===q.id)).filter(Boolean);
      return selected.concat(session.questions.filter(q=>ids.has(q.id)&&!selected.some(v=>v.id===q.id)));
    }
    if(session.reviewQuestionIds?.length){const ids=new Set(session.reviewQuestionIds);return session.questions.filter(q=>ids.has(q.id));}
    if(!evaluatingAsOwner||session.assessmentVersion!==2)return session.questions;
    return session.questions.filter(q=>!session.evidence[q.id]?.count||session.evidence[q.id]?.needsReview);
  }
  const draftKey=()=> 'kokmatch_skill_draft_'+active.id+'_'+active.key;
  function renderQuizProgress(){
    const count=batch.filter(q=>Object.hasOwn(answers,q.id)||Object.hasOwn(session.answers,q.id)).length;
    $('quizProgress').max=batch.length||1;$('quizProgress').value=count;
  }
  function contributionText(){
    const compared=batch.filter(q=>{const v=Object.hasOwn(answers,q.id)?answers[q.id]:session.answers[q.id];return v&&v!=='skip';});
    const members=new Set(compared.flatMap(q=>[q.a,q.b])).size;
    return `${members}명의 실력을 ${compared.length}번 비교했어요.`;
  }
  function startBatch(){
    $('respondentLabel').textContent=session.respondentName?session.respondentName+' 님의 안목':'';
    if(session.closed||session.expiresAt<=Date.now()){panels('done');$('doneText').textContent='마감되었거나 만료된 퀴즈입니다.';$('more').hidden=true;showOwnerReturn();return;}
    const pending=read(draftKey(),{});
    answers=Object.fromEntries(Object.entries(pending).filter(([id,v])=>session.questions.some(q=>q.id===id)&&['a','b','tie','skip'].includes(v)));
    const saved=read(draftKey()+'_plan',[]);
    batch=reviewPlan(ownerMeasurementQuestions(),session.answers,answers,saved,read(draftKey()+'_planVersion',null),session.evidence,session.players);
    at=batch.findIndex(q=>!Object.hasOwn(answers,q.id)&&!Object.hasOwn(session.answers,q.id));
    if(at<0&&batch.length){at=batch.length;panels('quiz');finishReview();return;}
    if(!batch.length){panels('done');$('doneText').textContent='모든 비교를 마쳤습니다.';$('more').hidden=true;showOwnerReturn();return;}
    write(draftKey()+'_plan',batch.map(q=>q.id));
    write(draftKey()+'_planVersion','cross-grade-v1');
    panels('quiz');$('retry').hidden=true;renderQuestion();
  }
  function renderQuestion(){
    const q=batch[at];if(!q)return;
    $('finishReview').hidden=true;$('retry').hidden=true;$('questionTitle').hidden=false;
    $('questionTitle').textContent='현재 개인 실력은 누가 더 강한가요?';
    $('previousQuestion').disabled=at===0;
    flipped=(parseInt(active.key.slice(-2),16)+at)%2===1;
    const a=session.players.find(p=>p.id===(flipped?q.b:q.a)),b=session.players.find(p=>p.id===(flipped?q.a:q.b));
    $('progress').textContent=`${session.clubName} · ${at+1} / ${batch.length}`;
    renderQuizProgress();
    $('sides').innerHTML=[a,b].map((p,i)=>`${i?'<span class="versus" aria-hidden="true">VS</span>':''}<button class="side" id="${i?'rightChoice':'leftChoice'}" data-vote="${i?'b':'a'}"><strong>${esc(p.name)}</strong><span>${esc(p.grade)} · ${esc(p.gender)}</span><span>${esc(p.ageGroup)}</span></button>`).join('');
    $('choices').hidden=false;
    if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)$('sides').animate?.([{opacity:.65,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'ease-out'});
    const chosen=Object.hasOwn(answers,q.id)?answers[q.id]:session.answers[q.id];
    const visible=flipped&&['a','b'].includes(chosen)?(chosen==='a'?'b':'a'):chosen;
    $('choices').querySelectorAll('[data-vote]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.vote===visible)));
    $('nextQuestion').hidden=!chosen;message('');
  }
  function finishReview(){
    $('choices').hidden=true;$('questionTitle').hidden=true;$('retry').hidden=true;
    $('progress').textContent=`${session.clubName} · ${batch.length} / ${batch.length}`;
    renderQuizProgress();$('contribution').textContent=contributionText();
    $('finishReview').hidden=false;$('previousQuestion').disabled=!batch.length;$('nextQuestion').hidden=true;message('');
  }
  $('previousQuestion').onclick=()=>{if(busy||at<=0)return;at--;renderQuestion();};
  $('nextQuestion').onclick=()=>{if(busy)return;const q=batch[at];if(!q||(!Object.hasOwn(answers,q.id)&&!Object.hasOwn(session.answers,q.id)))return;at++;if(at===batch.length)finishReview();else renderQuestion();};
  $('choices').onclick=async event=>{
    let value=event.target.closest('[data-vote]')?.dataset.vote;if(!value||busy)return;
    if(flipped&&['a','b'].includes(value))value=value==='a'?'b':'a';
    answers[batch[at].id]=value;
    try{write('kokmatch_skill_draft_'+active.id+'_'+active.key,answers);}catch(_){message('기기 저장이 제한됩니다. 창을 닫지 말고 완료해 주세요.');}
    at++;if(at===batch.length)finishReview();else renderQuestion();
  };
  async function submit(){
    if(busy)return;busy=true;$('saveAnswers').disabled=true;$('previousQuestion').disabled=true;$('choices').hidden=true;$('retry').hidden=true;message('의견을 저장하는 중');
    try{
      // The interface is uninterrupted; bounded server writes remain retry-safe.
      for(const chunk of Array.from({length:Math.ceil(Object.keys(answers).length/5)},(_,i)=>Object.entries(answers).slice(i*5,i*5+5))){
        session=await api({action:evaluatingAsOwner?'assess':'answer',...active,answers:Object.fromEntries(chunk)});
        if(evaluatingAsOwner)session={...session,answers:session.ownerAnswers||{},respondentName:'관리자 직접 평가'};
        chunk.forEach(([id])=>delete answers[id]);write(draftKey(),answers);
      }
      const own=ownerLink();if(own&&session.reviewedAt){own.reviewedAt=session.reviewedAt;persist(own);}
      write(draftKey()+'_last',batch.map(q=>q.id));
      localStorage.removeItem('kokmatch_skill_draft_'+active.id+'_'+active.key);
      localStorage.removeItem(draftKey()+'_plan');
      localStorage.removeItem(draftKey()+'_planVersion');
      answers={};panels('done');$('doneText').textContent=contributionText()+' 안목을 나눠주셔서 감사합니다. 명부에는 아직 자동 적용되지 않으며, 운영자가 결과에서 조정 폭과 비교 근거를 확인할 수 있습니다.';
      const plan=ownerLink()?.recommendation,phase=ownerLink()?.reviewPhase==='coverage'?plan?.supplement:plan?.initial;
      $('more').hidden=ownerLink()?.reviewPhase==='adaptive'||(phase?phase.every(q=>Object.hasOwn(session.answers,q.id)):session.questions.every(q=>Object.hasOwn(session.answers,q.id)));message('');showOwnerReturn();
    }catch(e){message(e.message);$('retry').hidden=false;}finally{busy=false;$('saveAnswers').disabled=false;$('previousQuestion').disabled=at<=0;}
  }
  function showOwnerReturn(){
    $('ownerReturn').hidden=!ownerLink();
    $('editAnswers').hidden=session.closed||session.expiresAt<=Date.now()||!read(draftKey()+'_last',[]).length;
  }
  $('editAnswers').onclick=()=>{
    if(busy||session.closed||session.expiresAt<=Date.now())return;
    batch=read(draftKey()+'_last',[]).map(id=>session.questions.find(q=>q.id===id)).filter(Boolean);
    if(!batch.length)return;
    answers={};at=0;write(draftKey()+'_plan',batch.map(q=>q.id));write(draftKey()+'_planVersion','cross-grade-v1');panels('quiz');renderQuestion();
  };
  $('saveAnswers').onclick=submit;
  $('retry').onclick=submit;$('more').onclick=startBatch;
  $('ownerReturn').onclick=()=>{const l=ownerLink();open({id:l.id,key:l.key});};
  $('refresh').onclick=()=>open(active);
  $('close').onclick=async()=>{
    if(busy||!confirm('이 링크의 새 응답을 마감할까요? 보정안은 남습니다.'))return;
    busy=true;try{session=await api({action:'close',...active});renderOwner();}catch(e){message(e.message);}finally{busy=false;}
  };
  $('proposals').onclick=event=>{
    const id=event.target.dataset.apply;if(!id)return;
    const proposal=session.proposals.find(p=>p.id===id),own=ownerLink();if(!proposal||!own)return;
    const club=read('badminton_rosters_v1',{}).clubs?.find(c=>c.id===own.clubId),row=proposalRow(proposal,own,club);
    if(row.state.key!=='ready')return;
    const p=row.p,original=row.original;
    try{write('kokmatch_skill_apply_v1',{batch:true,reviewId:own.id,clubId:own.clubId,batchId:nonce(),items:[{clubId:own.clubId,id:p.id,original,step:p.step,skillRating:p.skillRating}],createdAt:Date.now()});location.href=from+'?skillReviewApply=1';}catch(e){message('보정안을 저장하지 못했습니다. 저장 공간을 확인해 주세요.');}
  };
  $('applyAll').onclick=async()=>{
    if(busy)return;busy=true;
    try{
      session=await api({action:'read',...active});renderOwner();
      const own=ownerLink(),club=read('badminton_rosters_v1',{}).clubs?.find(c=>c.id===own.clubId);
      const rows=session.proposals.map(p=>proposalRow(p,own,club)).filter(r=>r.state.key==='ready');
      if(!rows.length){message('현재 적용 가능한 보정안이 없습니다.');return;}
      if(!confirm(`${rows.length}명의 보정안을 명부에 일괄 저장할까요?\n현재 명부 값을 기준으로 계산했습니다. 이미 생성한 대진은 재배정하지 않습니다.`))return;
      write('kokmatch_skill_apply_v1',{batch:true,reviewId:own.id,clubId:own.clubId,batchId:nonce(),items:rows.map(r=>({clubId:own.clubId,id:r.p.id,original:r.current,step:r.p.step,skillRating:r.p.skillRating})),createdAt:Date.now()});
      location.href=from+'?skillReviewApply=1';
    }catch(e){message(e.message);}finally{busy=false;}
  };
  $('undoBatch').onclick=()=>{
    const own=ownerLink(),batch=read('badminton_rosters_v1',{}).clubs?.find(c=>c.id===own.clubId)?.skillReview?.latest;
    if(!batch||busy||!confirm('최근 일괄 저장을 되돌릴까요? 이후 수동 수정된 회원은 그대로 둡니다.'))return;
    try{write('kokmatch_skill_apply_v1',{batch:true,undo:true,reviewId:own.id,clubId:own.clubId,batchId:batch.id,createdAt:Date.now()});location.href=from+'?skillReviewApply=1';}catch(e){message(e.message);}
  };
  setInterval(()=>{if(!document.hidden&&!$('owner').hidden&&!busy)open(active);},60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!$('owner').hidden&&!busy)open(active);});
  const parts=location.hash.slice(1).split('.');
  if(parts.length===2&&parts.every(s=>/^[a-f0-9]{32}$/.test(s)))open({id:parts[0],key:parts[1]});
  else{
    const wanted=new URLSearchParams(location.search).get('review'),entry=links.find(l=>l.id===wanted);
    if(entry)open({id:entry.id,key:entry.key});else{
      setup();
      const requested=new URLSearchParams(location.search).get('club');
      if(quick&&clubs.some(c=>String(c.id)===requested))$('create').onclick();
    }
  }
})();
