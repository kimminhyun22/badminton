(function(){
  'use strict';
  const Q=window.KokMatchQuality,C=window.KokSkillReview,$=id=>document.getElementById(id);
  const KEY='kokmatch_skill_review_v1',ID='kokmatch_skill_respondent_v1';
  const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch(_){return fallback;}};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let respondent=read(ID,null);
  if(typeof respondent!=='string'||!/^r-[a-z0-9-]{8,80}$/i.test(respondent))respondent='r-'+crypto.randomUUID();
  let records=[];
  try{records=C.merge([],read(KEY,[]));}catch(_){$('status').textContent='기존 응답을 읽지 못했습니다. 원본은 유지됩니다.';}
  let scope=read('kokmatch_skill_scope_v1','');
  if(typeof scope!=='string')scope='';
  $('surveyScope').value=scope;
  const mine=records.find(r=>r.respondent===respondent&&r.scope===scope);
  let answers={...mine?.answers},index=0;
  const save=next=>{try{localStorage.setItem(ID,JSON.stringify(respondent));localStorage.setItem(KEY,JSON.stringify(next));records=next;return true;}catch(_){$('status').textContent='응답 저장 공간을 확인해 주세요. 응답 파일로 저장할 수 있습니다.';return false;}};
  const raw=read('badminton_rosters_v1',{});
  const clubs=(Array.isArray(raw.clubs)?raw.clubs:[]).filter(c=>c&&Array.isArray(c.members));
  const from=new URLSearchParams(location.search).get('from')==='team'?'team.html':'index.html';
  $('back').href=from;
  $('back').onclick=event=>{try{if(new URL(document.referrer).origin===location.origin&&history.length>1){event.preventDefault();history.back();}}catch(_){}};
  $('club').innerHTML='<option value="">조건 직접 비교</option>'+clubs.map((c,i)=>`<option value="${i}">${esc(c.name)}</option>`).join('');
  const profiles=[C.profile('C'),C.profile('B','남','50대'),C.profile('A'),C.profile('C')];
  let selections=['','','',''];
  const draft=()=>({ageScale:Number($('ageScale').value)/100,genderScale:Number($('genderScale').value)/100});
  const members=()=>clubs[Number($('club').value)]?.members||[];
  const options=(values,value)=>values.map(v=>`<option value="${esc(v)}"${v===value?' selected':''}>${esc(v)}</option>`).join('');
  const label=p=>`${p.ageGroup||'연령 미입력'} ${p.gender||'성별 미입력'} ${p.grade||'?'}급`;
  function renderProfiles(){
    const count=Number($('mode').value),list=$('club').value===''?[]:members();
    $('profiles').innerHTML=profiles.slice(0,count).map((p,i)=>`<article class="profile"><h3>${count===2?['선수 A','선수 B'][i]:['A팀 · 선수 1','B팀 · 선수 1','A팀 · 선수 2','B팀 · 선수 2'][i]}</h3>
      ${list.length?`<label>명부 선수<select data-player="${i}"><option value="">직접 비교</option>${list.map((m,j)=>`<option value="${j}"${selections[i]===String(j)?' selected':''}>${esc(m.name)}</option>`).join('')}</select></label>`:''}
      <label>급수<select data-field="grade" data-index="${i}"><option value="">미입력</option>${options(['S','A','B','C','D','E'],p.grade)}</select></label>
      <label>성별<select data-field="gender" data-index="${i}"><option value="">미입력</option>${options(['남','여'],p.gender==='F'?'여':p.gender==='M'?'남':p.gender)}</select></label>
      <label>연령<select data-field="ageGroup" data-index="${i}"><option value="">미입력</option>${options(Object.keys(Q.skillPolicy.age),p.ageGroup)}</select></label>
      <label>개인 보정<select data-field="skillStep" data-index="${i}">${[-2,-1,0,1,2].map((v,j)=>`<option value="${v}"${Number(p.skillStep||0)===v?' selected':''}>${['낮게','조금 낮게','기본','조금 높게','높게'][j]}</option>`).join('')}</select></label>
      <div id="score-${i}"></div></article>`).join('');
    renderScores();
  }
  function renderScores(){
    const d=draft(),count=Number($('mode').value);
    profiles.slice(0,count).forEach((p,i)=>{
      const x=C.preview(p,d),original=Q.skillBreakdown(p);
      $('score-'+i).innerHTML=`<div class="score"><span>실력점수</span><strong>${x.total.toFixed(1)}</strong></div><div class="bar"><span style="width:${Math.max(0,Math.min(100,(x.total+2)/10*100))}%"></span></div><p class="breakdown">급수 ${x.base??'?'} · 성별 ${(x.gender*d.genderScale).toFixed(1)}<br>연령 ${(x.age*d.ageScale).toFixed(1)} · 개인 ${x.personal??'?'}<br>현재 기준 ${original.total.toFixed(1)}</p>${x.missing?'<p class="warning">미입력 정보가 있어 비교 확인이 필요합니다.</p>':''}`;
    });
    const a=count===2?[profiles[0]]:[profiles[0],profiles[2]],b=count===2?[profiles[1]]:[profiles[1],profiles[3]];
    const A=C.pair(a,d),B=C.pair(b,d);
    $('comparison').innerHTML=`<div class="comparison"><span>${count===2?'선수':'팀 합산'} 실력 차이<strong>${Math.abs(A.sum-B.sum).toFixed(1)}</strong></span>${count===4?`<span>A팀 파트너 격차<strong>${A.gap.toFixed(1)}</strong></span><span>B팀 파트너 격차<strong>${B.gap.toFixed(1)}</strong></span>`:''}</div>`;
    $('ageOutput').textContent=$('ageScale').value+'%';$('genderOutput').textContent=$('genderScale').value+'%';
    const list=$('club').value===''?profiles.slice(0,count):members();
    const valid=list.filter(p=>!Q.skillBreakdown(p).missing);
    const deltas=valid.map(p=>Math.abs(C.preview(p,d).total-Q.skillBreakdown(p).total));
    $('impact').textContent=`${valid.length}명 비교 · 점수 변경 ${deltas.filter(n=>n>0.001).length}명 · 최대 변화 ${Math.max(0,...deltas).toFixed(1)}${valid.length<list.length?` · 정보 확인 ${list.length-valid.length}명`:''}`;
  }
  $('profiles').addEventListener('change',event=>{
    const t=event.target;
    if(t.dataset.player!=null){const i=Number(t.dataset.player);selections[i]=t.value;profiles[i]=t.value===''?C.profile():{...members()[Number(t.value)]};}
    else if(t.dataset.field){const i=Number(t.dataset.index);profiles[i]={...profiles[i],[t.dataset.field]:t.dataset.field==='skillStep'?Number(t.value):t.value};delete profiles[i].level;selections[i]='';}
    renderProfiles();
  });
  $('club').onchange=()=>{selections=['','','',''];renderProfiles();};$('mode').onchange=renderProfiles;
  ['ageScale','genderScale'].forEach(id=>$(id).oninput=renderScores);
  $('resetDraft').onclick=()=>{$('ageScale').value=100;$('genderScale').value=100;renderScores();};
  $('policy').textContent=`기준 ${Q.skillPolicy.id} · S 7 / A 6 / B 5 / C 4 / D 3 / E 2. 여성 보정 합계 -1.5. 연령: 20대 0 / 30대 -0.2 / 40대 -0.5 / 50대 -1.2 / 60대+ -2. 개인 보정: -0.4 ~ +0.4. 실력점수는 승률이 아닙니다.`;
  // Stable per respondent, independent of answers; the production score is never shown in the quiz.
  const flipped=q=>[...respondent+q.id].reduce((s,c)=>s+c.charCodeAt(0),0)%2===1;
  function renderQuestion(){
    const q=C.questions[index],flip=flipped(q),sides=flip?[q.b,q.a]:[q.a,q.b];
    $('progress').textContent=`${index+1} / ${C.questions.length}`;
    $('question').innerHTML=`<p class="muted">${esc(q.kind)}</p><div class="question-sides">${sides.map((ps,i)=>`<div class="side"><h3>${i===0?'왼쪽':'오른쪽'}</h3>${ps.map(p=>`<p>${esc(label(p))}</p>`).join('')}</div>`).join('')}</div>`;
    const current=Object.hasOwn(answers,q.id)?answers[q.id]:undefined;
    $('choices').innerHTML=[['왼쪽 우세',-2],['왼쪽 약간 우세',-1],['비슷함',0],['오른쪽 약간 우세',1],['오른쪽 우세',2],['판단 어려움',null]].map(([text,value])=>{
      const canonical=value===null?null:flip?-value:value;
      return `<button data-answer="${canonical===null?'unknown':canonical}" aria-pressed="${current===canonical}">${text}</button>`;
    }).join('');
    $('previous').disabled=index===0;$('next').disabled=index===C.questions.length-1;
    $('quizDone').hidden=Object.keys(answers).length<C.questions.length;
  }
  $('choices').onclick=event=>{
    const value=event.target.dataset.answer;if(value==null)return;
    if(!scope){$('status').textContent='먼저 조사명을 입력해 주세요.';$('surveyScope').focus();return;}
    answers[C.questions[index].id]=value==='unknown'?null:Number(value);
    const record={version:C.version,policyId:Q.skillPolicy.id,scope,respondent,answers:{...answers}};
    const next=[...records.filter(r=>r.respondent!==respondent||r.scope!==scope),record];
    if(!save(next))records=next;
    if(index<C.questions.length-1)index++;
    renderQuestion();
  };
  $('previous').onclick=()=>{index--;renderQuestion();};$('next').onclick=()=>{index++;renderQuestion();};
  $('surveyScope').onchange=()=>{
    scope=$('surveyScope').value.trim();
    try{localStorage.setItem('kokmatch_skill_scope_v1',JSON.stringify(scope));}catch(_){}
    answers={...records.find(r=>r.respondent===respondent&&r.scope===scope)?.answers};index=0;renderQuestion();renderResults();
  };
  function renderResults(){
    const selected=records.filter(r=>r.scope===scope);
    $('resultSummary').textContent=`${scope||'조사명 미입력'} · 응답자 ${selected.length}명 · 계수 자동 적용 없음`;
    $('resultRows').innerHTML=C.summarize(selected).map((r,i)=>{
      const q=C.questions[i];
      return `<div class="result-row"><strong>${esc(q.kind)} · ${r.state}</strong><p>A: ${q.a.map(label).map(esc).join(' + ')}<br>B: ${q.b.map(label).map(esc).join(' + ')}</p><div class="distribution">${r.bins.map((n,j)=>`<span>${['A 우세','A 약간','비슷','B 약간','B 우세'][j]} ${n}</span>`).join('')}</div><p>유효 ${r.n}명 · 판단 어려움 ${r.unknown}명</p></div>`;
    }).join('');
  }
  document.querySelector('nav').onclick=event=>{
    const tab=event.target.dataset.tab;if(!tab)return;
    document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tab===tab)));
    ['compare','quiz','results'].forEach(id=>$(id).hidden=id!==tab);
    if(tab==='results')renderResults();
  };
  $('export').onclick=()=>{
    const selected=records.filter(r=>r.scope===scope);
    if(!selected.length){$('status').textContent='먼저 비교 설문에 응답해 주세요.';return;}
    const blob=new Blob([JSON.stringify({format:C.version,records:selected},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download='kokmatch-skill-responses.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  $('import').onchange=async event=>{
    try{
      let next=records;
      for(const file of event.target.files){
        if(file.size>1024*1024)throw Error('응답 파일은 1MB 이하만 가능합니다.');
        const data=JSON.parse(await file.text());
        if(data.format!==C.version||!Array.isArray(data.records)||data.records.length>500)throw Error('호환되는 응답 파일이 아닙니다.');
        if(!scope||data.records.some(r=>r.scope!==scope))throw Error('비교 설문에서 같은 조사명을 먼저 입력해 주세요. 다른 조사는 합치지 않습니다.');
        next=C.merge(next,data.records);
        if(next.length>500)throw Error('최대 500명까지 집계할 수 있습니다.');
      }
      if(save(next)){$('status').textContent='응답을 합쳤습니다. 중복 파일은 한 번만 집계됩니다.';answers={...records.find(r=>r.respondent===respondent&&r.scope===scope)?.answers};renderQuestion();renderResults();}
    }catch(e){$('status').textContent=e.message||'응답 파일을 읽지 못했습니다.';}
    event.target.value='';
  };
  renderProfiles();renderQuestion();renderResults();
})();
