(function(){
  'use strict';
  const KEY='badminton_rosters_v1', PREFIX='minton_roster_cloud_v1_', BACKUP='minton_roster_before_cloud_v1';
  const clone=v=>JSON.parse(JSON.stringify(v));
  function canonical(v){
    if(Array.isArray(v))return v.map(canonical);
    if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));
    return v;
  }
  const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
  function plan(local,binding){
    if(!local)return 'missing';
    if(!local.members?.length)return 'empty';
    if(binding.conflict)return 'conflict';
    if(binding.pending)return 'retry';
    return same(local,binding.base)?'clean':'save';
  }
  if(typeof module==='object'&&module.exports){module.exports={plan,same};return;}
  let auth,authApi,call,user,busy=false,ready=false,dialog,remote=[],message='서버 연결 준비 중',lastAttempt=0;
  const read=()=>JSON.parse(localStorage.getItem(KEY)||'{"clubs":[]}');
  const state=()=>JSON.parse(localStorage.getItem(PREFIX+user.uid)||'{}');
  const persist=s=>localStorage.setItem(PREFIX+user.uid,JSON.stringify(s));
  const id=()=>crypto.randomUUID().replace(/-/g,'');
  function status(text){
    message=text;
    document.querySelectorAll('[data-roster-cloud-status]').forEach(e=>{e.textContent=text;});
    document.querySelectorAll('[data-roster-cloud-open]').forEach(e=>{e.disabled=!ready;e.textContent=user?text:'서버 저장 연결';});
  }
  function button(label,action,parent){
    const b=document.createElement('button');b.type='button';b.textContent=label;
    b.onclick=async()=>{b.disabled=true;try{await action();}catch(e){status(errorText(e));alert(errorText(e));}finally{b.disabled=false;}};
    parent.append(b);return b;
  }
  const errorText=e=>e.code==='auth/popup-blocked'?'로그인 창이 차단됐습니다. Safari에서 열고 다시 눌러 주세요.':e.code==='auth/popup-closed-by-user'?'로그인을 취소했습니다.':e.message||'연결하지 못했습니다. 명부는 이 기기에 유지됩니다.';
  function locked(fn){return navigator.locks?navigator.locks.request('minton-roster-cloud',fn):fn();}
  function refreshLocal(){
    if(typeof window.loadRosters==='function')window.loadRosters();
    if(typeof window.renderClubList==='function')window.renderClubList();
    window.dispatchEvent(new CustomEvent('roster-cloud-restored'));
  }
  function importDoc(doc,expected){
    const data=read();
    if(expected!==undefined&&!same(data,expected))throw Error('기기 명부가 변경됐습니다. 다시 불러와 주세요.');
    const s=state(), club=clone(doc.club), existing=data.clubs.find(c=>c.id===club.id);
    // Keep a full local rollback copy before importing or normalizing any roster.
    localStorage.setItem(BACKUP,JSON.stringify(data));
    if(existing)data.clubs[data.clubs.indexOf(existing)]=club;else data.clubs.push(club);
    data._lvVersion=2;
    localStorage.setItem(KEY,JSON.stringify(data));
    if(!same(read(),data))throw Error('기기 명부 저장을 확인하지 못했습니다.');
    s[club.id]={id:doc.id,revision:doc.revision,base:club,updatedAt:doc.updatedAt};persist(s);
    refreshLocal();status('서버 저장됨');
  }
  async function sync(){
    if(!user||busy||Date.now()-lastAttempt<4000)return;
    if(!navigator.onLine){status('기기 저장됨 · 서버 연결 대기');return;}
    busy=true;lastAttempt=Date.now();
    try{await locked(async()=>{
      const uid=user.uid,s=state(),data=read();let problem=false;
      for(const [localId,b] of Object.entries(s)){
        const club=data.clubs.find(c=>c.id===localId),p=plan(club,b);
        if(['missing','empty','conflict'].includes(p)){problem=true;continue;}
        if(p==='clean')continue;
        status('서버 저장 중');
        if(!b.pending){b.pending={action:'save',id:b.id,revision:b.revision,club:clone(club),operationId:id()};persist(s);}
        try{
          const sent=clone(b.pending),result=await call(sent);
          if(user?.uid!==uid)return;
          b.base=sent.club;b.revision=result.revision;b.updatedAt=result.updatedAt;delete b.pending;persist(s);
        }catch(e){
          if(e.code==='functions/aborted'){b.conflict=true;persist(s);status('명부 변경 확인 필요');}
          else status('서버 저장 대기 · 다시 연결');
          return;
        }
      }
      const unlinked=data.clubs.some(c=>c.members.length&&!s[c.id]);
      status(problem?'명부 변경 확인 필요':unlinked?'서버 연결 안 된 명부 있음':Object.keys(s).length?'서버 저장됨':'서버 저장 연결');
    });}catch(e){status(errorText(e));}finally{busy=false;}
  }
  async function render(){
    if(!dialog?.open)return;
    dialog.replaceChildren();
    const head=document.createElement('h2');head.textContent='명부 서버 저장';dialog.append(head);
    const info=document.createElement('p');info.textContent=user?user.email:'Google 계정으로 명부를 보관합니다. 재설치 후 같은 계정으로 불러올 수 있습니다.';dialog.append(info);
    const msg=document.createElement('p');msg.dataset.rosterCloudStatus='';msg.setAttribute('role','status');msg.textContent=message;dialog.append(msg);
    if(!user){button('Google로 연결',()=>authApi.signInWithPopup(auth,new authApi.GoogleAuthProvider()),dialog);button('닫기',()=>dialog.close(),dialog);return;}
    remote=(await call({action:'list'})).clubs;
    const local=read(),s=state();
    if(local.clubs.some(c=>!s[c.id]&&c.members.length))button('이 기기 명부 모두 서버에 저장',async()=>{
      await locked(async()=>{
        const latest=state();let conflicts=0;
        for(const club of read().clubs){
          if(latest[club.id]||!club.members.length)continue;
          const doc=await call({action:'create',club});
          if(!same(doc.club,club)){conflicts++;continue;}
          latest[club.id]={id:doc.id,revision:doc.revision,base:clone(club),updatedAt:doc.updatedAt};persist(latest);
        }
        status(conflicts?'기존 서버 명부 확인 필요':'서버 저장됨');
      });await render();
    },dialog);
    for(const club of local.clubs){
      const row=document.createElement('section');const title=document.createElement('h3');title.textContent=club.name+' · '+club.members.length+'명';row.append(title);dialog.append(row);
      const b=s[club.id];
      if(!b){button('서버에 저장',async()=>{
        const doc=await call({action:'create',club});
        if(!same(doc.club,club)){alert('이 클럽의 서버 명부가 이미 있습니다. 아래 서버 명부에서 불러와 주세요.');await render();return;}
        const latest=state();latest[club.id]={id:doc.id,revision:doc.revision,base:clone(club),updatedAt:doc.updatedAt};persist(latest);status('서버 저장됨');await render();
      },row);continue;}
      const note=document.createElement('p');note.textContent=b.conflict?'다른 기기에서 변경됨':plan(club,b)==='clean'?'서버 저장됨 · '+new Date(b.updatedAt).toLocaleString('ko-KR'):'기기 변경사항 저장 대기';row.append(note);
      if(!b.conflict)button('서버에서 불러오기',()=>pull(b.id),row);
      if(b.conflict){button('서버 명부 불러오기',()=>pull(b.id),row);button('내 명부로 저장',async()=>{
        if(!confirm('서버 명부를 현재 기기 명부로 바꿀까요? 이전 서버 명부는 이력에 보관됩니다.'))return;
        await locked(async()=>{const latest=await call({action:'read',id:b.id});const result=await call({action:'save',id:b.id,revision:latest.revision,club:read().clubs.find(c=>c.id===club.id),operationId:id()});importDoc(result);});await render();
      },row);}
      button('저장 이력',async()=>{
        const result=await call({action:'history',id:b.id});
        const box=document.createElement('div');row.append(box);
        if(!result.versions.length)box.textContent='이전 저장 이력이 없습니다.';
        for(const v of result.versions.slice().reverse())button(new Date(v.updatedAt).toLocaleString('ko-KR')+' · '+v.count+'명 복원',async()=>{
          if(!confirm('이 시점의 명부로 복원할까요? 현재 명부도 이력에 남습니다.'))return;
          await locked(async()=>{const before=read(),current=await call({action:'read',id:b.id});const restored=await call({action:'restore',id:b.id,revision:current.revision,target:v.revision,operationId:id()});importDoc(restored,before);});await render();
        },box);
      },row);
    }
    for(const doc of remote){
      if(Object.values(s).some(b=>b.id===doc.id)&&local.clubs.some(c=>s[c.id]?.id===doc.id))continue;
      const row=document.createElement('section');dialog.append(row);
      const label=document.createElement('p');label.textContent='서버 · '+doc.club.name+' · '+doc.club.members.length+'명';row.append(label);
      button('불러오기',()=>pull(doc.id),row);
    }
    button('다시 저장',async()=>{lastAttempt=0;await sync();await render();},dialog);
    button('로그아웃',async()=>{await authApi.signOut(auth);await render();},dialog);
    button('닫기',()=>dialog.close(),dialog);
  }
  async function pull(cloudId){
    if(!confirm('서버 명부를 이 기기로 불러올까요? 같은 클럽의 기기 명부는 백업 후 교체합니다.'))return;
    await locked(async()=>{const before=read(),doc=await call({action:'read',id:cloudId});importDoc(doc,before);});await render();
  }
  window.openRosterCloud=async()=>{
    if(!ready){alert('서버 연결을 준비하고 있습니다. 잠시 후 다시 눌러 주세요.');return;}
    if(!dialog){dialog=document.createElement('dialog');dialog.className='roster-cloud-dialog';document.body.append(dialog);}
    if(!dialog.open)dialog.showModal();
    try{await render();}catch(e){status(errorText(e));}
  };
  const style=document.createElement('style');style.textContent='.roster-cloud-dialog{box-sizing:border-box;width:min(94vw,560px);max-height:85dvh;margin:auto;padding:20px;border:1px solid #ccdcd5;border-radius:8px;color:#20352c;background:#fff;overflow:auto}.roster-cloud-dialog::backdrop{background:#14231b66}.roster-cloud-dialog h2{font-size:20px}.roster-cloud-dialog h3{font-size:17px}.roster-cloud-dialog p{font-size:14px;overflow-wrap:anywhere}.roster-cloud-dialog section{padding:12px 0;border-top:1px solid #e1e9e5}.roster-cloud-dialog button{min-height:44px;margin:4px;padding:10px 12px;border:1px solid #bfd6ca;border-radius:6px;background:#f1f8f4;color:#23543c;font-size:14px}.roster-cloud-dialog button:disabled{opacity:.5}';document.head.append(style);
  (async()=>{
    try{
      const root='https://www.gstatic.com/firebasejs/10.12.0/';
      const appApi=await import(root+'firebase-app.js');authApi=await import(root+'firebase-auth.js');const f=await import(root+'firebase-functions.js');
      const config=window.KokMatchFirebaseConfig;
      if(!config)throw Error('명부 설정을 읽지 못했습니다.');
      const app=appApi.getApps().find(a=>a.name==='roster-cloud')||appApi.initializeApp(config,'roster-cloud');
      auth=authApi.getAuth(app);const callable=f.httpsCallable(f.getFunctions(app,'us-central1'),'clubRosterCloud');call=async data=>(await callable(data)).data;
      authApi.onAuthStateChanged(auth,u=>{user=u;ready=true;status(u?'서버 명부 연결됨':'서버 저장 연결');if(dialog?.open)render().catch(e=>status(errorText(e)));sync();});
      setInterval(()=>{if(!document.hidden)sync();},5000);
      window.addEventListener('pagehide',()=>{lastAttempt=0;sync();});
      window.addEventListener('online',()=>{lastAttempt=0;sync();});
      window.addEventListener('storage',()=>sync());
      document.addEventListener('visibilitychange',()=>{if(!document.hidden){lastAttempt=0;sync();}});
    }catch(e){status('서버 연결 실패 · 새로고침');}
  })();
})();
