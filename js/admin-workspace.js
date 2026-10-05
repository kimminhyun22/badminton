/* Optional Google account, private snapshots, and cooperative editing handoff.
   This file runs before application scripts. Guest data is never moved/deleted. */
(async function(){
  'use strict';
  async function loadApplicationScripts(){
    window.MintonAdminReady=fn=>fn();
    for(const old of document.querySelectorAll('script[data-admin-src]')){const s=document.createElement('script');s.src=old.dataset.adminSrc;await new Promise((resolve,reject)=>{s.onload=resolve;s.onerror=()=>reject(Error('앱 파일을 읽지 못했습니다. 새로고침해 주세요.'));document.body.append(s);});}
  }
  // Shared survey links remain anonymous even when this browser has an admin account.
  if(location.pathname.endsWith('/skill-review.html')&&location.hash){
    if(document.readyState==='loading')await new Promise(r=>document.addEventListener('DOMContentLoaded',r,{once:true}));
    await loadApplicationScripts();return;
  }
  const C=window.MintonWorkspaceCore,raw=window.localStorage,session=window.sessionStorage;
  let uid=raw.getItem(C.MODE)||'',store=null,auth,api,call,rosterCall,user,device=session.getItem('minton_workspace_device_v1')||crypto.randomUUID().replace(/-/g,''),deadline=0;
  document.documentElement.classList.add('account-starting');
  // Duplicated tabs inherit sessionStorage: reserve the tab ID across the origin.
  // A reload keeps its ID; an overlapping/duplicated tab must get a different one.
  if(navigator.locks){
    let reserved=false;
    while(!reserved){
      reserved=await new Promise(resolve=>navigator.locks.request('minton-workspace-tab-'+device,{ifAvailable:true},lease=>{resolve(!!lease);return lease?new Promise(()=>{}):undefined;}));
      if(!reserved)device=crypto.randomUUID().replace(/-/g,'');
    }
  }else device=crypto.randomUUID().replace(/-/g,'');
  session.setItem('minton_workspace_device_v1',device);
  let started=false,bootComplete=false,stopped=false,busy=false,dialog,bar,blockedReason='',inflight=new Set(),saveTimer,transferTimer;
  const dom=new Promise(r=>document.readyState==='loading'?document.addEventListener('DOMContentLoaded',r,{once:true}):r());
  const active=()=>!stopped&&(!uid||(Date.now()<deadline&&auth?.currentUser?.uid===uid&&raw.getItem(C.MODE)===uid));
  const status=text=>{if(bar)bar.querySelector('span').textContent=text;};
  function backupDownload(values,name){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({format:'minton-workspace-v1',values},null,2)],{type:'application/json'}));a.download=name+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
  function disconnect(){try{if(uid&&window.firebase?.database)firebase.database().goOffline();}catch(e){}}
  function lock(reason,cutNetwork=true){stopped=true;if(cutNetwork)disconnect();blockedReason=reason;status(reason);document.querySelectorAll('body>:not(#accountBar):not(.account-panel)').forEach(e=>{e.inert=true;});}
  function show(title,message,actions){
    if(!dialog){dialog=document.createElement('dialog');dialog.className='account-panel';dialog.addEventListener('cancel',e=>{if(stopped||!started)e.preventDefault();});document.body.append(dialog);}
    dialog.replaceChildren();const h=document.createElement('h2');h.textContent=title;dialog.append(h);const p=document.createElement('p');p.textContent=message;p.setAttribute('role','status');dialog.append(p);
    for(const [label,fn] of actions){const b=document.createElement('button');b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){p.textContent=errorText(e);}finally{b.disabled=false;}};dialog.append(b);}
    if(!dialog.open)dialog.showModal();
  }
  const errorText=e=>({'auth/popup-blocked':'팝업을 허용하고 다시 눌러 주세요.','auth/popup-closed-by-user':'로그인을 취소했습니다. 기기 자료는 그대로입니다.','auth/network-request-failed':'연결을 확인해 주세요. 기기 자료는 보관되어 있습니다.'}[e.code])||e.message||'연결을 확인해 주세요.';
  async function setupAuth(){
    if(call)return;
    const root='https://www.gstatic.com/firebasejs/10.12.0/';const appApi=await import(root+'firebase-app.js');api=await import(root+'firebase-auth.js');const f=await import(root+'firebase-functions.js');
    const app=appApi.getApps().find(a=>a.name==='roster-cloud')||appApi.initializeApp(window.KokMatchFirebaseConfig,'roster-cloud');auth=api.getAuth(app);
    await auth.authStateReady();user=auth.currentUser;
    const endpoint=f.httpsCallable(f.getFunctions(app,'us-central1'),'adminWorkspace');
    const legacy=f.httpsCallable(f.getFunctions(app,'us-central1'),'clubRosterCloud');rosterCall=async()=>{const expected=auth.currentUser?.uid;const result=(await legacy({action:'list'})).data;if(auth.currentUser?.uid!==expected)throw Error('계정이 변경되었습니다.');return result.clubs||[];};
    call=async data=>{const expected=auth.currentUser?.uid;if(!expected)throw Error('로그인해 주세요.');const requestedAt=Date.now();const result=(await endpoint({...data,device})).data;result.requestedAt=requestedAt;if(auth.currentUser?.uid!==expected)throw Error('계정이 변경되었습니다.');return result;};
    api.onAuthStateChanged(auth,u=>{user=u;if(uid&&u?.uid!==uid){store?.lock();document.documentElement.classList.add('account-starting');lock('계정이 변경되어 운영을 멈췄습니다.');showRecovery();}});
  }
  function guardFirebase(){
    // Fence delayed timers and outgoing writes before a device releases its lease.
    if(!window.firebase)return;
    if(typeof _fbInit==='function')_fbInit();
    C.guardNetwork(firebase,active,inflight);
  }
  async function boot(){
    if(started)return;started=true;
    if(uid){store=C.createStore(raw,uid,()=>{if(bootComplete&&!busy&&!stopped){clearTimeout(saveTimer);saveTimer=setTimeout(tick,800);}});Object.defineProperty(window,'localStorage',{value:store.storage});const scopedSession=C.createStore(session,uid);Object.defineProperty(window,'sessionStorage',{value:scopedSession.storage});guardFirebase();}
    await loadApplicationScripts();
    bootComplete=true;document.documentElement.classList.remove('account-starting');status(uid?'Google 연결됨 · 이 기기에서 운영 중':'이 기기에 저장 · 로그인 없이 사용 중');
    if(uid){setInterval(tick,10000);setInterval(()=>{if(!active()&&!stopped){lock('연결을 확인할 때까지 운영을 잠시 멈춥니다.');showRecovery();}},1000);}
  }
  function setLease(doc){deadline=(doc.requestedAt||Date.now())+Math.max(0,(doc.lease?.until||0)-doc.serverNow-5000);}
  async function flush(){
    if(!store)return;
    if(auth?.currentUser?.uid!==uid||raw.getItem(C.MODE)!==uid)throw Error('계정이 변경되어 저장을 중단했습니다.');
    if(started&&!stopped)window.MintonCaptureWorkspace?.();
    const d=store.read(),values=store.snapshot();
    if(!d.pending&&C.same(values,d.base||{}))return;
    if(!d.pending)store.meta({pending:{action:'save',revision:d.revision||0,values,operationId:crypto.randomUUID().replace(/-/g,'')}});
    const sent=store.read().pending,result=await call(sent);
    store.meta({base:sent.values,revision:result.revision,pending:null});
  }
  async function drain(){
    let timer;try{await Promise.race([Promise.allSettled([...inflight]),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('진행 중인 저장 응답을 확인하지 못했습니다. 기기 자료를 보관하고 재연결해 주세요.')),5000);})]);}finally{clearTimeout(timer);disconnect();}
  }
  async function surrender(){
    window.MintonCaptureWorkspace?.();
    lock('다른 기기로 운영을 넘기는 중입니다.',false);
    await drain();await flush();await flush();
    const d=store.read();if(d.pending||!C.same(d.values,d.base))throw Error('저장 중인 자료가 있습니다. 잠시 후 다시 시도해 주세요.');
    await call({action:'release'});store.lock();location.reload();
  }
  async function tick(){
    if(busy||stopped||!uid||document.hidden)return;busy=true;
    try{const doc=await call({action:'renew'});setLease(doc);if(doc.revision!==store.read().revision&&!store.read().pending){store.backup('서버 변경 충돌');throw Error('다른 기기의 최신 자료를 확인해야 합니다.');}await flush();status('Google 연결됨 · 저장 완료');if(doc.transfer&&doc.transfer.device!==device)await surrender();}
    catch(e){lock(errorText(e));showRecovery();}finally{busy=false;}
  }
  function showRecovery(){show('계정 연결 확인',blockedReason||'기기 자료는 보관되어 있습니다.',[['다시 연결',()=>location.reload()],...(auth?.currentUser?.uid===uid?[['기기 자료 백업 받기',()=>backupDownload(store?.snapshot()||{},'minton-device-backup')]]:[]),['비회원으로 돌아가기',()=>logout()]]);}
  async function logout(){
    if(uid&&store){store.backup('로그아웃 전');if(active()){window.MintonCaptureWorkspace?.();lock('마지막 변경을 저장하고 있습니다.',false);await drain();await flush();await call({action:'release'});}store.lock();}
    lock('비회원 화면으로 돌아갑니다.');raw.removeItem(C.MODE);if(auth)await api.signOut(auth);location.reload();
  }
  async function connect(){
    window.MintonCaptureWorkspace?.();
    await setupAuth();if(!auth.currentUser){show('Google로 기기 연결','비회원 자료는 그대로 유지됩니다. Google 계정으로 로그인한 뒤 연결할 자료를 확인합니다.',[['Google로 로그인',async()=>{await api.signInWithPopup(auth,new api.GoogleAuthProvider());await connect();}],['취소',()=>dialog.close()]]);return;}user=auth.currentUser;
    const doc=await call({action:'read'}),guest=C.collect(raw);
    if(doc.revision){show('계정 자료 이어하기',user.email+' 계정에 저장된 명부·설정·대진을 엽니다. 이 기기의 비회원 자료는 따로 그대로 보관합니다.',[['계정 자료로 이어하기',()=>{raw.setItem(C.MODE,user.uid);location.reload();}],['취소',()=>dialog.close()]]);return;}
    show('이 기기 자료를 계정에 연결',user.email+' 계정에 현재 명부·설정·대진을 저장할까요? 본인이 운영하는 자료인지 확인해 주세요. 기존 비회원 원본은 유지됩니다.',[['확인하고 연결',async()=>{const lease=await call({action:'acquire'});if(lease.revision)throw Error('다른 기기에서 계정 자료를 만들었습니다. 다시 연결해 주세요.');const latest=C.collect(raw);if(!C.same(guest,latest))throw Error('자료가 변경되었습니다. 다시 연결해 주세요.');raw.setItem(C.PREFIX+'guest-backup',JSON.stringify({at:Date.now(),values:guest}));const saved=await call({action:'save',revision:0,values:guest,operationId:crypto.randomUUID().replace(/-/g,'')});C.createStore(raw,user.uid).replace(saved.values,saved.revision);await call({action:'release'});raw.setItem(C.MODE,user.uid);location.reload();}],['취소',()=>dialog.close()]]);
  }
  async function importLegacyRosters(){
    if(!active())throw Error('이 기기로 운영을 이어받은 후 가져와 주세요.');
    const docs=await rosterCall();
    show('이전 서버 명부 가져오기',docs.length+'개 명부를 찾았습니다. 이 기기에 없는 클럽만 추가합니다. 기존 명부와 서버 원본은 바꾸지 않습니다.',[['없는 명부 추가',async()=>{
      if(!active())throw Error('계정을 다시 확인해 주세요.');
      const rosters=JSON.parse(localStorage.getItem('badminton_rosters_v1')||'{"clubs":[]}');store.backup('이전 서버 명부 가져오기 전');
      for(const d of docs)if(d.club&&!rosters.clubs.some(c=>c.id===d.club.id))rosters.clubs.push(d.club);
      localStorage.setItem('badminton_rosters_v1',JSON.stringify(rosters));await flush();location.reload();
    }],['닫기',()=>dialog.close()]]);
  }
  async function accountStart(){
    await setupAuth();if(auth.currentUser?.uid!==uid)throw Error('저장된 계정과 로그인 계정이 다릅니다. 다시 로그인해 주세요.');
    let doc=await call({action:'read'});store=C.createStore(raw,uid);
    const pending=store.read().pending;
    if(pending&&doc.lastOperationId===pending.operationId&&C.same(doc.values,pending.values))store.meta({base:doc.values,revision:doc.revision,pending:null});
    const local=store.read();
    if(local.pending||!C.same(local.values,local.base||{})){
      // Never overwrite unsent changes on reload, account switch, or offline return.
      if((local.revision||0)!==doc.revision){store.backup('충돌 자료 보존');show('저장하지 못한 기기 자료가 있습니다','기기 자료를 백업한 뒤 최신 계정 자료를 불러올 수 있습니다. 자동으로 덮어쓰지 않습니다.',[['기기 자료 백업 받기',()=>backupDownload(local.values,'minton-unsent-backup')],['기기 사본 보관 후 계정 자료 불러오기',()=>{store.backup('사용자 확인 후 서버 불러오기');store.replace(doc.values,doc.revision);location.reload();}],['비회원으로 돌아가기',()=>logout()]]);return;}
    }
    if((doc.lease&&doc.lease.until>doc.serverNow&&doc.lease.device!==device)||(doc.transfer&&doc.transfer.device!==device&&doc.transfer.at+90000>doc.serverNow)){
      show('다른 기기에서 운영 중', '같은 계정의 자료가 연결되어 있습니다. 이 기기로 이어받으면 기존 기기에서 저장을 마친 뒤 운영이 넘어옵니다.',[['이 기기로 이어하기',async()=>{await call({action:'request-transfer'});status('기존 기기 저장을 기다리는 중');clearInterval(transferTimer);const wait=transferTimer=setInterval(async()=>{try{const d=await call({action:'read'});if(!d.lease||d.lease.until<=d.serverNow){clearInterval(wait);location.reload();}}catch(e){clearInterval(wait);status(errorText(e));}},3000);dialog.querySelector('button').disabled=true;}],['비회원으로 사용',()=>logout()]]);return;
    }
    doc=await call({action:'acquire'});setLease(doc);
    if(local.pending||!C.same(local.values,local.base||{})){await flush();doc=await call({action:'read'});}else{store.backup('서버 자료 불러오기 전');store.replace(doc.values,doc.revision);}
    await boot();
  }
  window.MintonAdminWorkspace={get connected(){return !!uid;},get active(){return active();},open:async()=>uid&&!active()?showRecovery():uid?show('Google 계정 연결',user?.email||uid,[['지금 저장',()=>tick()],['이전 서버 명부 가져오기',()=>importLegacyRosters()],['자료 백업 받기',()=>backupDownload(store.snapshot(),'minton-account-backup')],['로그아웃 · 비회원으로 사용',()=>logout()],['닫기',()=>dialog.close()]]):connect(),flush};
  window.addEventListener('storage',event=>{if(event.key===C.MODE&&raw.getItem(C.MODE)!==uid){store?.lock();document.documentElement.classList.add('account-starting');lock('다른 탭에서 계정이 변경되었습니다.');location.reload();}});
  window.addEventListener('pageshow',event=>{if(uid&&event.persisted){store?.lock();document.documentElement.classList.add('account-starting');lock('계정을 다시 확인합니다.');location.reload();}});
  document.addEventListener('visibilitychange',()=>{if(uid&&!document.hidden){if(active())tick();else{lock('다시 연결 중입니다.');showRecovery();}}});
  document.documentElement.classList.add('account-starting');await dom;
  bar=document.createElement('div');bar.id='accountBar';const label=document.createElement('span');label.textContent=uid?'계정 자료를 확인하고 있습니다.':'로그인 없이 사용할 수 있습니다.';const button=document.createElement('button');button.textContent=uid?'계정 · 동기화':'Google로 기기 연결';button.onclick=()=>window.MintonAdminWorkspace.open().catch(e=>show('연결 안내',errorText(e),[['닫기',()=>dialog.close()]]));bar.append(label,button);document.body.prepend(bar);
  try{if(uid)await accountStart();else await boot();}catch(e){lock(errorText(e));showRecovery();}
})();
