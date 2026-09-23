(function(){
'use strict';

const SDK_VERSION='12.17.0';
const MAX_IMAGES=8;
const MAX_EDGE=1800;
const TIMEOUT_MS=65000;
const ROLE_WORDS='회장|부회장|총무|재무|경기이사|이사|임원|고문|감사';
let analyzerPromise=null;
let state={files:[],clubName:'',roster:[],result:null};

function byId(id){return document.getElementById(id);}
function esc(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function normalizeName(value){
  return String(value||'')
    .replace(new RegExp(`\\((?:${ROLE_WORDS})\\)`,'g'),'')
    .replace(/^(?:게스트|guest)\s*\d*[.：:]?\s*/i,'')
    .split(/[\/|]/)[0]
    .replace(/[\s·.,:：;()[\]{}]/g,'')
    .trim();
}
function uniqueRows(rows){
  const seen=new Set();
  return (Array.isArray(rows)?rows:[]).filter(row=>{
    const key=normalizeName(row?.name);
    if(!key||seen.has(key))return false;
    seen.add(key);
    return true;
  });
}
function textValue(value){return String(value||'').trim();}
function rosterIndex(roster){
  const map=new Map();
  (Array.isArray(roster)?roster:[]).forEach(member=>{
    const key=normalizeName(member?.name);
    if(!key)return;
    if(!map.has(key))map.set(key,[]);
    map.get(key).push(member);
  });
  return map;
}
function lateMap(raw){
  const map=new Map();
  const put=row=>{
    const key=normalizeName(row?.name);
    if(!key)return;
    const note=textValue(row?.arrivalText||row?.note||'늦게 참석');
    if(!map.has(key)||note.length>map.get(key).length)map.set(key,note);
  };
  (raw?.lateMentions||[]).forEach(put);
  (raw?.commentAttendees||[]).filter(row=>textValue(row?.arrivalText)).forEach(put);
  (raw?.guests||[]).filter(row=>textValue(row?.arrivalText)).forEach(put);
  return map;
}
function resolve(raw,roster){
  const index=rosterIndex(roster);
  const late=lateMap(raw||{});
  const votes=uniqueRows(raw?.voteAttendees);
  const voteKeys=new Set(votes.map(row=>normalizeName(row.name)));
  const comments=uniqueRows(raw?.commentAttendees).filter(row=>!voteKeys.has(normalizeName(row.name)));
  const members=[...votes.map(row=>({...row,source:'vote'})),...comments.map(row=>({...row,source:'comment'}))]
    .map((row,id)=>{
      const key=normalizeName(row.name);
      const matches=index.get(key)||[];
      return {id,rawName:textValue(row.name),key,source:row.source,arrivalText:late.get(key)||'',match:matches.length===1?matches[0]:null,ambiguous:matches.length>1};
    });
  const guests=uniqueRows(raw?.guests).map((row,id)=>{
    const key=normalizeName(row.name);
    const match=(index.get(key)||[]).length===1?(index.get(key)||[])[0]:null;
    return {
      id,rawName:textValue(row.name),name:textValue(row.name),key,
      gender:textValue(row.gender)||textValue(match?.gender),
      grade:textValue(row.grade).toUpperCase()||textValue(match?.grade).toUpperCase(),
      ageGroup:textValue(row.ageGroup)||textValue(match?.ageGroup)||'40대',
      arrivalText:late.get(key)||textValue(row.arrivalText),matchedRoster:!!match
    };
  });
  const declaredVoteCount=Math.max(0,Number(raw?.declaredVoteCount)||0);
  const warnings=[...(Array.isArray(raw?.warnings)?raw.warnings:[])].map(textValue).filter(Boolean);
  if(declaredVoteCount&&declaredVoteCount!==votes.length){
    warnings.unshift(`투표 화면은 ${declaredVoteCount}명인데 ${votes.length}명만 읽었습니다. 캡처가 모두 선택됐는지 확인하세요.`);
  }
  return {members,guests,warnings,declaredVoteCount,voteCount:votes.length,commentCount:comments.length,total:members.length+guests.length};
}

function config(){
  const value=window.KokMatchFirebaseConfig;
  if(!value?.apiKey||!value?.projectId)throw new Error('Firebase 설정을 찾을 수 없습니다.');
  return value;
}
function appCheckKey(){
  const value=document.querySelector('meta[name="firebase-app-check-site-key"]')?.content?.trim();
  if(!value)throw new Error('AI 보안 설정을 찾을 수 없습니다.');
  return value;
}
async function analyzer(){
  if(analyzerPromise)return analyzerPromise;
  analyzerPromise=(async()=>{
    const root=`https://www.gstatic.com/firebasejs/${SDK_VERSION}`;
    const [{initializeApp,getApps},{initializeAppCheck,ReCaptchaEnterpriseProvider},functionsModule]=await Promise.all([
      import(`${root}/firebase-app.js`),import(`${root}/firebase-app-check.js`),import(`${root}/firebase-functions.js`)
    ]);
    const appName='kokmatch-daily-image-import';
    const app=getApps().find(item=>item.name===appName)||initializeApp(config(),appName);
    initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(appCheckKey()),isTokenAutoRefreshEnabled:true});
    const functions=functionsModule.getFunctions(app,'us-central1');
    return functionsModule.httpsCallable(functions,'analyzeDailyParticipantScreenshots',{timeout:60000});
  })().catch(error=>{analyzerPromise=null;throw error;});
  return analyzerPromise;
}
function canvasData(file){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    const url=URL.createObjectURL(file);
    img.onload=()=>{
      try{
        const scale=Math.min(1,MAX_EDGE/Math.max(img.naturalWidth||1,img.naturalHeight||1));
        const canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
        canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
        const ctx=canvas.getContext('2d');
        ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
        const dataUrl=canvas.toDataURL('image/jpeg',0.86);
        resolve({inlineData:{mimeType:'image/jpeg',data:dataUrl.split(',')[1]}});
      }catch(error){reject(error);}finally{URL.revokeObjectURL(url);}
    };
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error(`${file.name||'이미지'}를 열 수 없습니다.`));};
    img.src=url;
  });
}
function timeout(promise){
  return Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('분석 시간이 초과되었습니다. 다시 시도해 주세요.')),TIMEOUT_MS))]);
}
async function analyze(files,roster){
  const selected=[...(files||[])].filter(file=>String(file.type||'').startsWith('image/')).slice(0,MAX_IMAGES);
  if(!selected.length)throw new Error('캡처 이미지를 선택해 주세요.');
  const parts=await Promise.all(selected.map(canvasData));
  const analyzeScreenshots=await analyzer();
  const response=await timeout(analyzeScreenshots({images:parts.map(part=>part.inlineData)}));
  const raw=response?.data;
  if(!raw||typeof raw!=='object')throw new Error('분석 결과를 읽지 못했습니다. 다시 시도해 주세요.');
  return resolve(raw,roster);
}

function renderFileNames(){
  const el=byId('dailyCaptureFiles');
  if(!el)return;
  el.textContent=state.files.length?`${state.files.length}장 선택 · ${state.files.map(file=>file.name).join(', ')}`:'투표와 댓글 캡처를 함께 선택하세요.';
}
function option(value,label,current){return `<option value="${esc(value)}" ${String(value)===String(current)?'selected':''}>${esc(label)}</option>`;}
function memberSelect(row){
  const used=new Set(state.result.members.filter(item=>item!==row&&item.match).map(item=>normalizeName(item.match.name)));
  const choices=state.roster.filter(member=>!used.has(normalizeName(member.name))||row.match===member);
  return `<select class="daily-capture-select" onchange="KokMatchDailyImageImport.setMember(${row.id},this.value)">
    <option value="">명부에서 선택</option>${choices.map(member=>option(normalizeName(member.name),`${member.name} · ${member.grade||'-'} · ${member.gender||'-'}`,row.match&&normalizeName(row.match.name))).join('')}
  </select>`;
}
function render(){
  const result=state.result;
  const summary=byId('dailyCaptureSummary');
  const body=byId('dailyCaptureResult');
  const apply=byId('dailyCaptureApply');
  if(!result){summary.textContent='';body.innerHTML='';apply.disabled=true;return;}
  const unmatched=result.members.filter(row=>!row.match).length;
  const lateCount=[...result.members,...result.guests].filter(row=>row.arrivalText).length;
  summary.innerHTML=`<b>총 ${result.total}명</b><span>투표 ${result.voteCount} · 댓글 추가 ${result.commentCount} · 게스트 ${result.guests.length} · 지각 ${lateCount}</span>`;
  const warnings=[...result.warnings];
  if(unmatched)warnings.unshift(`명부에서 못 찾은 회원 ${unmatched}명의 이름을 선택해 주세요.`);
  const warningHtml=warnings.length?`<div class="daily-capture-warning">${warnings.map(item=>`<p>${esc(item)}</p>`).join('')}</div>`:'';
  const memberHtml=result.members.map(row=>`<div class="daily-capture-row ${row.match?'ok':'needs-check'}">
    <div><b>${esc(row.rawName)}</b><small>${row.source==='vote'?'투표':'댓글 추가'}${row.arrivalText?` · 도착 전 (${esc(row.arrivalText)})`:''}</small></div>
    ${row.match?`<span>${esc(row.match.grade||'-')} · ${esc(row.match.gender||'-')} · ${esc(row.match.ageGroup||'-')}</span>`:memberSelect(row)}
  </div>`).join('');
  const guestHtml=result.guests.map(row=>`<div class="daily-capture-guest">
    <div class="daily-capture-guest-name"><b>게스트 · ${esc(row.name)}</b>${row.arrivalText?`<small>도착 전 · ${esc(row.arrivalText)}</small>`:''}</div>
    <select onchange="KokMatchDailyImageImport.setGuest(${row.id},'grade',this.value)">${['','E','D','C','B','A','S'].map(value=>option(value,value||'급수',row.grade)).join('')}</select>
    <select onchange="KokMatchDailyImageImport.setGuest(${row.id},'gender',this.value)">${['','남','여'].map(value=>option(value,value||'성별',row.gender)).join('')}</select>
    <select onchange="KokMatchDailyImageImport.setGuest(${row.id},'ageGroup',this.value)">${['20대','30대','40대','50대','60대+'].map(value=>option(value,value,row.ageGroup)).join('')}</select>
  </div>`).join('');
  body.innerHTML=warningHtml+`<div class="daily-capture-section"><h4>회원 ${result.members.length}명</h4>${memberHtml||'<p class="dir-empty">읽은 회원이 없습니다.</p>'}</div>`+
    `<div class="daily-capture-section"><h4>게스트 ${result.guests.length}명</h4>${guestHtml||'<p class="dir-empty">게스트 신청이 없습니다.</p>'}</div>`;
  apply.textContent=`${result.total}명 등록`;
  apply.disabled=unmatched>0||result.guests.some(row=>!row.name||!row.grade||!['남','여'].includes(row.gender));
}
function setBusy(busy,message){
  const analyzeBtn=byId('dailyCaptureAnalyze');
  const status=byId('dailyCaptureStatus');
  analyzeBtn.disabled=busy;
  if(status)status.textContent=message||'';
}
function friendlyError(error){
  const code=String(error?.code||'');
  if(code.includes('app-check')||code.includes('permission-denied'))return 'AI 보안 연결을 확인하지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.';
  const message=String(error?.message||'');
  if(code.includes('quota')||code.includes('resource-exhausted')||message.includes('[429')||message.includes('credits are depleted'))return '오늘 AI 분석 한도를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  return error?.message||'캡처를 분석하지 못했습니다.';
}

window.KokMatchDailyImageImport={
  normalizeName,resolve,
  open({clubName,roster}={}){
    state={files:[],clubName:textValue(clubName),roster:Array.isArray(roster)?roster:[],result:null};
    const input=byId('dailyCaptureInput');if(input)input.value='';
    const note=byId('dailyCaptureNote');
    if(note)note.textContent=`${state.clubName||'선택한 클럽'} 명부와 비교합니다. 투표와 댓글 캡처를 모두 선택하세요. 원본 이미지는 저장하지 않습니다.`;
    renderFileNames();render();setBusy(false,'');
    byId('dailyImportModal')?.classList.add('hidden');
    byId('dailyCaptureModal')?.classList.remove('hidden');
  },
  close(){byId('dailyCaptureModal')?.classList.add('hidden');byId('dailyImportModal')?.classList.remove('hidden');},
  choose(){byId('dailyCaptureInput')?.click();},
  filesChanged(input){state.files=[...(input?.files||[])].slice(0,MAX_IMAGES);state.result=null;renderFileNames();render();setBusy(false,'');},
  async analyze(){
    if(!state.files.length){setBusy(false,'캡처 이미지를 선택해 주세요.');return;}
    setBusy(true,'명단과 댓글을 읽는 중입니다...');
    try{state.result=await analyze(state.files,state.roster);render();setBusy(false,'분석 완료 · 등록 전 명단을 확인하세요.');}
    catch(error){console.warn('캡처 참가자 분석 실패',error);setBusy(false,friendlyError(error));}
  },
  setMember(id,key){
    const row=state.result?.members?.find(item=>item.id===Number(id));
    if(!row)return;
    const matches=state.roster.filter(member=>normalizeName(member.name)===key);
    row.match=matches.length===1?matches[0]:null;render();
  },
  setGuest(id,field,value){const row=state.result?.guests?.find(item=>item.id===Number(id));if(row){row[field]=value;render();}},
  apply(){
    if(!state.result||byId('dailyCaptureApply')?.disabled)return;
    const members=state.result.members.map(row=>({...row.match,status:row.arrivalText?'planned':'wait',arrivalText:row.arrivalText,source:row.source}));
    const guests=state.result.guests.map(row=>({name:row.name,grade:row.grade,gender:row.gender,ageGroup:row.ageGroup,isGuest:true,status:row.arrivalText?'planned':'wait',arrivalText:row.arrivalText}));
    if(typeof window.dailyApplyImageImportResult==='function')window.dailyApplyImageImportResult({members,guests,counts:{vote:state.result.voteCount,comment:state.result.commentCount,guest:guests.length,total:state.result.total}});
  }
};

})();
