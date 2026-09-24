(function(){
  'use strict';
  const C=window.KokClubSkill,$=id=>document.getElementById(id),KEY='kokmatch_club_skill_links_v1';
  const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch(_){return fallback;}};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const write=(key,data)=>localStorage.setItem(key,JSON.stringify(data));
  let links=read(KEY,[]),active=null,session=null,batch=[],answers={},at=0,busy=false,flipped=false;
  const from=new URLSearchParams(location.search).get('from')==='team'?'team.html':'index.html';
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
  function panels(id){['setup','owner','quiz','done'].forEach(s=>$(s).hidden=s!==id);}
  function setup(){
    panels('setup');
    $('club').innerHTML=clubs.map((c,i)=>`<option value="${i}">${esc(c.name)}</option>`).join('');
    $('create').disabled=!clubs.length;
    if(!clubs.length)message('명부에 클럽과 회원을 먼저 등록해 주세요.');
    $('historyLabel').hidden=!links.length;
    $('history').innerHTML='<option value="">선택</option>'+links.slice().reverse().map(l=>`<option value="${l.id}">${esc(l.clubName)} · ${new Date(l.createdAt).toLocaleDateString('ko-KR')}</option>`).join('');
  }
  async function open(link){
    if(busy)return;busy=true;active=link;message('불러오는 중');
    try{session=await api({action:'read',...link});message('');if(ownerLink()?.key===link.key)renderOwner();else startBatch();}
    catch(e){message(e.message);setup();}finally{busy=false;}
  }
  function renderOwner(){
    panels('owner');const own=ownerLink();
    $('clubTitle').textContent=session.clubName;
    const currentClub=read('badminton_rosters_v1',{}).clubs?.find(c=>c.id===own.clubId);
    const unchanged=p=>{
      const original=own.snapshots[Number(p.id.slice(1))],current=currentClub?.members?.find(m=>m.name===original.name);
      return current&&['grade','gender','ageGroup','level','skillStep'].every(k=>String(current[k]??(k==='skillStep'?0:''))===String(original[k]??(k==='skillStep'?0:'')));
    };
    session.proposals.forEach(p=>{if(!unchanged(p)){p.ready=false;p.state='명부 변경됨';}});
    const ready=session.proposals.filter(p=>p.ready);
    own.readyCount=ready.length;own.closed=session.closed;persist(own);
    $('notice').textContent=ready.length?`개인 보정 ${ready.length}명, 적용을 검토해 주세요.`:`${session.count}개 의견 · 임시 보정 검토 중`;
    $('notice').className=ready.length?'ready-notice':'muted';
    $('proposals').innerHTML=session.proposals.filter(p=>p.opponents).map(p=>`<article class="result-row"><strong>${esc(p.name)}</strong><p>${label(p.current)} → ${label(p.step)} · ${p.state}</p><p class="muted">상대 ${p.opponents}명 비교 · 판단자 ${p.experts}명${p.conflicts?' · 의견 충돌 '+p.conflicts+'건':''}</p>${p.ready?`<button data-apply="${p.id}">명부에서 적용 확인</button>`:''}</article>`).join('')||'<p class="muted">첫 의견을 기다리고 있습니다.</p>';
    $('expiry').textContent=`${new Date(session.expiresAt).toLocaleDateString('ko-KR')}까지 · ${session.closed?'마감됨':'응답 가능'}`;
    $('close').disabled=session.closed;$('answerSelf').disabled=session.closed||session.expiresAt<=Date.now();
  }
  $('create').onclick=async()=>{
    if(busy)return;
    const club=clubs[Number($('club').value)];if(!club)return;
    try{
      const players=C.players(club.members);
      if(!C.pairs(players).length)throw Error('같은 급수에서 비교할 회원이 부족합니다.');
      const reusable=links.slice().reverse().find(l=>l.clubId===club.id&&!l.pending&&!l.closed&&Date.now()-l.createdAt<30*86400000&&JSON.stringify(l.snapshots)===JSON.stringify(club.members));
      if(reusable){await open({id:reusable.id,key:reusable.key});return;}
      let entry=links.find(l=>l.clubId===club.id&&l.pending);
      if(!entry){entry={id:nonce(),key:nonce(),invites:[nonce(),nonce(),nonce()],clubId:club.id,clubName:club.name,createdAt:Date.now(),snapshots:JSON.parse(JSON.stringify(club.members)),players,pending:true};persist(entry);}
      busy=true;$('create').disabled=true;message('퀴즈를 만드는 중');
      session=await api({action:'create',id:entry.id,key:entry.key,invites:entry.invites,clubName:entry.clubName,players:entry.players});
      entry.pending=false;persist(entry);active={id:entry.id,key:entry.key};message('');renderOwner();
    }catch(e){message(e.message);}finally{busy=false;$('create').disabled=false;}
  };
  $('history').onchange=()=>{const l=links.find(l=>l.id===$('history').value);if(l)open({id:l.id,key:l.key});};
  $('share').onclick=async()=>{
    const own=ownerLink();if(!own)return;
    const url=new URL('skill-review.html',location.href);url.hash=own.id+'.'+own.invites[Number($('expert').value)];
    try{if(navigator.share)await navigator.share({title:'우리 클럽 미세조정',text:'회원 비교 5문제만 부탁드려요.',url:url.href});else{await navigator.clipboard.writeText(url.href);message('링크를 복사했습니다.');}}
    catch(e){if(e.name!=='AbortError'){message('링크를 복사해 보내 주세요.');prompt('공유 링크',url.href);}}
  };
  $('answerSelf').onclick=()=>{const own=ownerLink();open({id:own.id,key:own.invites[0]});};
  function startBatch(){
    if(session.closed||session.expiresAt<=Date.now()){panels('done');$('doneText').textContent='마감되었거나 만료된 퀴즈입니다.';$('more').hidden=true;showOwnerReturn();return;}
    const pending=read('kokmatch_skill_draft_'+active.id+'_'+active.key,{});
    answers=Object.fromEntries(Object.entries(pending).filter(([id,v])=>session.questions.some(q=>q.id===id)&&['a','b','tie','skip'].includes(v)));
    if(Object.keys(answers).length){batch=session.questions.filter(q=>Object.hasOwn(answers,q.id));at=batch.length;panels('quiz');$('choices').hidden=true;$('retry').hidden=false;message('보내지 못한 응답이 있습니다. 다시 보내 주세요.');return;}
    const remaining=session.questions.filter(q=>!Object.hasOwn(session.answers,q.id));
    const offset=remaining.length?parseInt(active.key.slice(0,4),16)%remaining.length:0;
    batch=[...remaining.slice(offset),...remaining.slice(0,offset)].slice(0,5);at=0;answers={};
    if(!batch.length){panels('done');$('doneText').textContent='모든 비교를 마쳤습니다.';$('more').hidden=true;showOwnerReturn();return;}
    panels('quiz');$('retry').hidden=true;renderQuestion();
  }
  function renderQuestion(){
    const q=batch[at];if(!q)return;
    flipped=(parseInt(active.key.slice(-2),16)+at)%2===1;
    const a=session.players.find(p=>p.id===(flipped?q.b:q.a)),b=session.players.find(p=>p.id===(flipped?q.a:q.b));
    $('progress').textContent=`${session.clubName} · ${at+1} / ${batch.length}`;
    $('sides').innerHTML=[a,b].map(p=>`<article class="side"><h3>${esc(p.name)}</h3><p>${esc(p.grade)}급 · ${esc(p.gender)} · ${esc(p.ageGroup)}</p></article>`).join('');
    $('leftChoice').textContent=a.name+' 님';$('rightChoice').textContent=b.name+' 님';$('choices').hidden=false;
  }
  $('choices').onclick=async event=>{
    let value=event.target.dataset.vote;if(!value||busy)return;
    if(flipped&&['a','b'].includes(value))value=value==='a'?'b':'a';
    answers[batch[at].id]=value;
    try{write('kokmatch_skill_draft_'+active.id+'_'+active.key,answers);}catch(_){message('기기 저장이 제한됩니다. 창을 닫지 말고 완료해 주세요.');}
    at++;if(at===batch.length)await submit();else renderQuestion();
  };
  async function submit(){
    if(busy)return;busy=true;$('choices').hidden=true;$('retry').hidden=true;message('의견을 저장하는 중');
    try{
      session=await api({action:'answer',...active,answers});
      localStorage.removeItem('kokmatch_skill_draft_'+active.id+'_'+active.key);
      answers={};panels('done');$('doneText').textContent='실제 명부는 바뀌지 않습니다. 클럽 운영자가 보정안을 확인합니다.';
      $('more').hidden=session.questions.every(q=>Object.hasOwn(session.answers,q.id));message('');showOwnerReturn();
    }catch(e){message(e.message);$('retry').hidden=false;}finally{busy=false;}
  }
  function showOwnerReturn(){$('ownerReturn').hidden=!ownerLink();}
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
    if(entry)open({id:entry.id,key:entry.key});else setup();
  }
})();
