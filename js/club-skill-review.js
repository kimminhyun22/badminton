(function(){
  'use strict';
  const C=window.KokClubSkill,$=id=>document.getElementById(id),KEY='kokmatch_club_skill_links_v1';
  const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch(_){return fallback;}};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const write=(key,data)=>localStorage.setItem(key,JSON.stringify(data));
  let links=read(KEY,[]),active=null,session=null,batch=[],answers={},at=0,busy=false,flipped=false;
  const from=new URLSearchParams(location.search).get('from')==='team'?'team.html':'index.html';
  const quick=new URLSearchParams(location.search).get('quick')==='1';
  $('back').href=from;
  const clubs=read('badminton_rosters_v1',{}).clubs||[];
  const nonce=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
  const message=s=>$('status').textContent=s;
  const label=step=>['낮게','조금 낮게','기본','조금 높게','높게'][step+2];
  const ownerLink=()=>links.find(l=>l.id===active?.id);
  async function api(data){
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
    if(p.conflicts)return {key:'pending',title:'판단 엇갈림',reason:`${p.conflicts}개 비교에서 의견이 나뉘었습니다. 다른 운영진의 확인이 필요합니다.`};
    if(p.ready)return {key:'ready',title:'적용 가능 · 미반영',reason:'비교 근거를 확인한 뒤 명부에 저장해 주세요.'};
    if(p.step===p.current)return {key:'same',title:'변경 제안 없음',reason:'현재 응답에서는 점수를 바꿀 근거가 없습니다. 실력이 확정됐다는 뜻은 아닙니다.'};
    const left=Math.max(0,3-(p.support||0));
    return {key:'pending',title:'추가 확인 · 미반영',reason:p.opponents<3?`서로 다른 상대 ${3-p.opponents}명 이상과 추가 비교가 필요합니다.`:
      left?`같은 조정 방향을 뒷받침하는 비교가 ${left}개 이상 더 필요합니다.`:'조정 방향의 일관성이 부족합니다. 추가 비교 후 다시 계산합니다.'};
  }
  function reviewProgress(players,questions,proposals){
    const required=3;
    const rows=players.map(player=>{
      const candidates=new Set(questions.filter(q=>q.a===player.id||q.b===player.id).map(q=>q.a===player.id?q.b:q.a)).size;
      const p=proposals.find(p=>p.id===player.id),opponents=p?.opponents||0;
      if(candidates<required)return {name:player.name,excluded:true,reason:`비교 가능한 상대 ${candidates}명 · 자동보정 대상 부족`};
      const complete=!!p&&!p.conflicts&&opponents>=required&&(p.ready||p.step===p.current);
      const reason=complete?'검토 준비됨':p?.conflicts?`의견이 나뉜 비교 ${p.conflicts}건 확인`:opponents<required?`서로 다른 상대 ${required-opponents}명 추가 비교`:p.step!==p.current&&(p.support||0)<required?`같은 조정 방향을 뒷받침할 비교 ${required-(p.support||0)}건 이상 필요`:'조정 방향 추가 확인';
      return {name:player.name,complete,reason,missing:Math.max(0,required-opponents)};
    });
    const eligible=rows.filter(r=>!r.excluded),done=eligible.filter(r=>r.complete).length;
    const percent=eligible.length?Math.floor(done/eligible.length*100):null;
    return {total:eligible.length,done,percent,remaining:percent===null?null:100-percent,minimumQuestions:Math.ceil(eligible.reduce((n,r)=>n+r.missing,0)/2),pending:eligible.filter(r=>!r.complete),excluded:rows.filter(r=>r.excluded)};
  }
  function renderOwner(){
    panels('owner');const own=ownerLink();
    $('ownerResults').hidden=!session.count;
    $('clubTitle').textContent=session.clubName;
    const progress=reviewProgress(session.players,session.questions,session.proposals);
    $('collectionProgress').innerHTML=progress.total?`<h2>보정 검토 준비 ${progress.percent}% <span class="muted">· 남은 ${progress.remaining}%</span></h2><progress class="collection-bar" value="${progress.done}" max="${progress.total}" aria-label="보정 검토 준비"></progress><p class="muted">${progress.total}명 중 ${progress.done}명 준비 · ${progress.pending.length}명 추가 확인</p><p class="muted">서로 다른 상대 3명 이상 비교 기준 · 명부 적용률은 아닙니다.</p>`:'<h2>비교 대상이 부족합니다.</h2><p class="muted">회원별 비교 가능한 상대가 3명 이상 필요합니다.</p>';
    if(progress.pending.length||progress.excluded.length)$('collectionProgress').innerHTML+=`<details><summary>남은 확인 ${progress.pending.length}명${progress.excluded.length?` · 대상 부족 ${progress.excluded.length}명`:''}</summary>${[...progress.pending,...progress.excluded].map(r=>`<p class="muted"><strong>${esc(r.name)}</strong> · ${esc(r.reason)}</p>`).join('')}</details>`;
    if(progress.minimumQuestions)$('collectionProgress').innerHTML+=`<p class="muted">새로운 상대 비교 최소 ${progress.minimumQuestions}문항 필요 · 의견에 따라 추가될 수 있어요.</p>`;
    const currentClub=read('badminton_rosters_v1',{}).clubs?.find(c=>c.id===own.clubId);
    const rows=session.proposals.map(p=>{
      const original=own.snapshots[Number(p.id.slice(1))],matches=currentClub?.members?.filter(m=>m.name===original?.name)||[];
      return {p,state:resultState(p,original,matches.length===1?matches[0]:null)};
    });
    const count=key=>rows.filter(r=>r.state.key===key).length;
    const ready=rows.filter(r=>r.state.key==='ready');
    session.proposals.forEach(p=>{if(!ready.some(r=>r.p.id===p.id))p.ready=false;});
    own.readyCount=ready.length;own.closed=session.closed;own.reviewedAt=session.reviewedAt||own.reviewedAt||0;persist(own);
    $('notice').textContent=`${session.count}개 응답 저장됨 · ${rows.filter(r=>r.p.opponents).length}/${rows.length}명 비교`;
    $('notice').className=ready.length?'ready-notice':'muted';
    $('resultSummary').innerHTML=[['applied','반영 완료'],['ready','적용 가능'],['pending','추가 확인'],['same','변경 없음']].map(([key,title])=>`<div><strong>${count(key)}명</strong><span>${title}</span></div>`).join('');
    $('resultHelp').textContent=ready.length?'적용 가능 회원의 비교 근거를 확인하고, 명부에 저장하면 반영됩니다.':count('pending')?'응답은 저장됐지만 아직 적용할 보정안이 없습니다. 추가 비교가 필요합니다.':count('applied')?'현재 명부에 보정값이 반영돼 있습니다. 이미 생성한 대진은 자동 재배정하지 않습니다.':'비교 결과와 명부 반영 여부를 아래에서 확인하세요.';
    if(count('unreviewed'))$('resultHelp').textContent+=` 아직 비교하지 않은 회원 ${count('unreviewed')}명.`;
    if(session.legacyCount)$('resultHelp').textContent+=` 기존 개별 링크 응답 ${session.legacyCount}개도 포함됩니다. 이미 참여한 분은 중복 참여하지 말고 기존 링크에서 수정해 주세요.`;
    const order={ready:0,pending:1,applied:2,changed:3,same:4};
    $('proposals').innerHTML=rows.filter(r=>r.p.opponents).sort((a,b)=>order[a.state.key]-order[b.state.key]).map(({p,state})=>{
      const player=session.players.find(v=>v.id===p.id),before=player.base+p.current*.2,after=player.base+p.step*.2,delta=Math.round((p.step-p.current)*2)/10;
      const change=delta>0?'+'+delta.toFixed(1):delta.toFixed(1);
      const evidence=(p.comparisons||[]).map(c=>`<li>${esc(c.name)} 대비 ${!c.agree?'의견 나뉨':c.outcome==='tie'?'비슷함':c.outcome==='higher'?'더 유리':'덜 유리'} · ${c.votes}명 응답</li>`).join('');
      return `<article class="result-row"><div class="result-heading"><strong>${esc(p.name)}</strong><span class="result-status ${state.key}">${state.title}</span></div><p class="score-change">${before.toFixed(1)} <span>→</span> ${after.toFixed(1)} <b>${change}</b></p><p>${label(p.current)} → ${label(p.step)}</p><p class="muted">${state.reason}</p><details><summary>비교 근거 · 상대 ${p.opponents}명</summary><p>판단자 ${p.experts}명 · 같은 조정 방향 ${p.support??'확인 중'}개</p><ul>${evidence||'<li>결과를 새로고침하면 근거를 확인할 수 있습니다.</li>'}</ul><p class="muted">급수·성별·연령 기준은 그대로입니다. 표시 점수는 개인 보정을 포함한 대진 실력점수이며 승률이 아닙니다.</p></details>${state.key==='ready'?`<button class="primary" data-apply="${p.id}">명부에서 ${change} 적용 확인</button>`:''}</article>`;
    }).join('')||'<p class="muted">첫 비교를 기다리고 있습니다.</p>';
    $('answerSelf').textContent='나도 참여하기';
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
      if(!C.pairs(players).length)throw Error('같은 급수에서 비교할 회원이 부족합니다.');
      const reusable=links.slice().reverse().find(l=>l.clubId===club.id&&!l.pending&&!l.closed&&Date.now()-l.createdAt<30*86400000&&JSON.stringify(l.snapshots)===JSON.stringify(members));
      if(reusable){await open({id:reusable.id,key:reusable.key});return;}
      let entry=links.find(l=>l.clubId===club.id&&l.pending&&JSON.stringify(l.snapshots)===JSON.stringify(members));
      if(!entry){entry={id:nonce(),key:nonce(),invites:[nonce(),nonce(),nonce()],clubId:club.id,clubName:club.name,createdAt:Date.now(),snapshots:JSON.parse(JSON.stringify(members)),players,pending:true};persist(entry);}
      busy=true;$('create').disabled=true;message('퀴즈를 만드는 중');
      session=await api({action:'create',id:entry.id,key:entry.key,invites:entry.invites,clubName:entry.clubName,players:entry.players});
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
      try{if(navigator.share)await navigator.share({title:'민턴라이브 · 우리 클럽 밸런스게임',text:'반드시 이겨야 하는 게임, 누구와 파트너를 하시겠어요?',url:url.href});else{await navigator.clipboard.writeText(url.href);message('단톡방에 보낼 링크를 복사했습니다.');}}
      catch(e){if(e.name!=='AbortError')prompt('단톡방 공유 링크',url.href);}
    }catch(e){message(e.message);}finally{busy=false;}
  };
  $('answerSelf').onclick=()=>openShared(ownerLink());
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
  function reviewQuestions(questions,previous,limit=20){
    const counts={};
    for(const q of questions)if(previous[q.id]&&previous[q.id]!=='skip'){
      counts[q.a]=(counts[q.a]||0)+1;counts[q.b]=(counts[q.b]||0)+1;
    }
    const remaining=questions.filter(q=>!Object.hasOwn(previous,q.id)),chosen=[];
    while(remaining.length&&chosen.length<limit){
      remaining.sort((a,b)=>Math.max(counts[a.a]||0,counts[a.b]||0)-Math.max(counts[b.a]||0,counts[b.b]||0)||
        ((counts[a.a]||0)+(counts[a.b]||0))-((counts[b.a]||0)+(counts[b.b]||0))||a.id.localeCompare(b.id));
      const q=remaining.shift();chosen.push(q);counts[q.a]=(counts[q.a]||0)+1;counts[q.b]=(counts[q.b]||0)+1;
    }
    return chosen;
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
    batch=saved.length?saved.map(id=>session.questions.find(q=>q.id===id)).filter(Boolean):reviewQuestions(session.questions,session.answers);
    if(!saved.length&&Object.keys(answers).length)batch=session.questions.filter(q=>Object.hasOwn(answers,q.id));
    at=batch.findIndex(q=>!Object.hasOwn(answers,q.id)&&!Object.hasOwn(session.answers,q.id));
    if(at<0&&batch.length){at=batch.length;panels('quiz');finishReview();return;}
    if(!batch.length){panels('done');$('doneText').textContent='모든 비교를 마쳤습니다.';$('more').hidden=true;showOwnerReturn();return;}
    write(draftKey()+'_plan',batch.map(q=>q.id));
    panels('quiz');$('retry').hidden=true;renderQuestion();
  }
  function renderQuestion(){
    const q=batch[at];if(!q)return;
    $('finishReview').hidden=true;$('retry').hidden=true;$('questionTitle').hidden=false;
    $('previousQuestion').disabled=at===0;
    flipped=(parseInt(active.key.slice(-2),16)+at)%2===1;
    const a=session.players.find(p=>p.id===(flipped?q.b:q.a)),b=session.players.find(p=>p.id===(flipped?q.a:q.b));
    $('progress').textContent=`${session.clubName} · ${at+1} / ${batch.length}`;
    renderQuizProgress();
    $('sides').innerHTML=[a,b].map((p,i)=>`${i?'<span class="versus" aria-hidden="true">VS</span>':''}<button class="side" id="${i?'rightChoice':'leftChoice'}" data-vote="${i?'b':'a'}"><strong>${esc(p.name)}</strong><span>${esc(p.grade)}급 · ${esc(p.gender)}</span><span>${esc(p.ageGroup)}</span></button>`).join('');
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
        session=await api({action:'answer',...active,answers:Object.fromEntries(chunk)});
        chunk.forEach(([id])=>delete answers[id]);write(draftKey(),answers);
      }
      const own=ownerLink();if(own&&session.reviewedAt){own.reviewedAt=session.reviewedAt;persist(own);}
      write(draftKey()+'_last',batch.map(q=>q.id));
      localStorage.removeItem('kokmatch_skill_draft_'+active.id+'_'+active.key);
      localStorage.removeItem(draftKey()+'_plan');
      answers={};panels('done');$('doneText').textContent=contributionText()+' 안목을 나눠주셔서 감사합니다. 명부에는 아직 자동 적용되지 않으며, 운영자가 결과에서 조정 폭과 비교 근거를 확인할 수 있습니다.';
      $('more').hidden=session.questions.every(q=>Object.hasOwn(session.answers,q.id));message('');showOwnerReturn();
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
    answers={};at=0;write(draftKey()+'_plan',batch.map(q=>q.id));panels('quiz');renderQuestion();
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
    const p=session.proposals.find(p=>p.id===id&&p.ready),own=ownerLink();if(!p||!own)return;
    const original=own.snapshots[Number(id.slice(1))];
    try{write('kokmatch_skill_apply_v1',{clubId:own.clubId,original,step:p.step,createdAt:Date.now()});location.href=from+'?skillReviewApply=1';}catch(e){message('보정안을 저장하지 못했습니다. 저장 공간을 확인해 주세요.');}
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
