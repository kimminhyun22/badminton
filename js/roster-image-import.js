(function(root){
  'use strict';
  const KEY='badminton_rosters_v1',grades=['S','A','B','C','D','E'],ages=['20대','30대','40대','50대','60대+'];
  const text=v=>String(v??'').trim();
  const nameKey=v=>text(v).replace(/\s+/g,'').normalize('NFC');
  function explicitGender(source){
    const tokens=text(source).split(/[\s/|,·.()_-]+/).filter(Boolean);
    const male=tokens.some(v=>['남','남성','남자','M'].includes(v));
    const female=tokens.some(v=>['여','여성','여자','F'].includes(v));
    return male===female?'':male?'남':'여';
  }
  function ageFromYear(value,year=new Date().getFullYear()){
    const s=text(value);if(!/^\d{2}$|^\d{4}$/.test(s))return '';
    let birth=Number(s);if(s.length===2)birth+=(birth<=year%100?2000:1900);
    const age=year-birth;if(age<20||age>110)return '';
    return age>=60?'60대+':Math.floor(age/10)*10+'대';
  }
  function merge(previous,raw,year=new Date().getFullYear()){
    if(!Array.isArray(raw?.members)||raw.members.length>500)throw Error('명부 분석 결과를 확인해 주세요.');
    const list=previous.map(r=>({...r,sources:[...r.sources],conflicts:[...r.conflicts]}));
    for(const item of raw.members){
      const name=text(item.name).replace(/\((?:회장|부회장|총무|재무|경기이사|임원|고문|감사)\)/g,'').trim().slice(0,80);
      if(!name)continue;
      const row={name,birthYear:text(item.birthYear),gender:['남','여'].includes(item.gender)?item.gender:'',grade:grades.includes(text(item.grade).toUpperCase())?text(item.grade).toUpperCase():'',selected:true,conflicts:[]};
      row.ageGroup=ageFromYear(row.birthYear,year);
      row.sources=[text(item.sourceText).replace(/01\d[-~ .]?\d{3,4}[-~ .]?\d{4}/g,'').slice(0,160)];
      if(explicitGender(row.sources[0])!==row.gender)row.gender='';
      const old=list.find(r=>nameKey(r.name)===nameKey(row.name));
      if(!old){list.push(row);continue;}
      old.sources=[...new Set([...old.sources,...row.sources])];
      for(const field of ['birthYear','gender','grade','ageGroup']){
        if(old.conflicts.includes(field))continue;
        if(old[field]&&row[field]&&old[field]!==row[field]){old[field]='';old.conflicts.push(field);}
        else if(!old[field])old[field]=row[field];
      }
    }
    if(list.length>500)throw Error('한 명부는 500명 이내로 나누어 등록해 주세요.');
    return list;
  }
  function build(current,clubId,clubName,rows,level,uuid){
    const clubs=(current.clubs||[]).map(c=>({...c,members:[...(c.members||[])]}));
    let club=clubs.find(c=>c.id===clubId);
    if(clubId&&!club)throw Error('선택한 명부가 없어졌습니다. 다시 확인해 주세요.');
    if(!club){
      if(!text(clubName)||text(clubName).length>80)throw Error('클럽 이름을 입력해 주세요.');
      if(clubs.length>=10)throw Error('명부는 최대 10개까지 보관할 수 있습니다.');
      if(clubs.some(c=>nameKey(c.name)===nameKey(clubName)))throw Error('같은 이름의 명부가 있습니다. 기존 명부를 선택하거나 이름을 바꿔 주세요.');
      club={id:'club_'+uuid(),name:text(clubName),members:[]};clubs.push(club);
    }
    let added=0,skipped=0;const seen=new Set(club.members.map(m=>nameKey(m.name)));
    for(const row of rows.filter(r=>r.selected)){
      if(!text(row.name))throw Error('회원 이름을 입력해 주세요.');
      if(seen.has(nameKey(row.name))){skipped++;continue;}
      if(row.conflicts.length||!grades.includes(row.grade)||!['남','여'].includes(row.gender)||!ages.includes(row.ageGroup))throw Error(row.name+' 님의 성별·연령·급수와 확인 필요 항목을 수정해 주세요.');
      const value=level({grade:row.grade,gender:row.gender,skillStep:0});
      if(!Number.isFinite(value))throw Error('실력 기준을 불러오지 못했습니다.');
      club.members.push({memberId:'member_'+uuid(),name:text(row.name),grade:row.grade,gender:row.gender,ageGroup:row.ageGroup,level:value,skillStep:0,isClubOfficial:false});
      seen.add(nameKey(row.name));added++;
    }
    if(!added)throw Error('새로 등록할 회원이 없습니다. 기존 회원은 변경하지 않습니다.');
    if(club.members.length>500)throw Error('한 명부는 500명 이내로 나누어 등록해 주세요.');
    return {data:{...current,_lvVersion:2,clubs},added,skipped};
  }
  if(typeof module==='object'&&module.exports){module.exports={ageFromYear,merge,build};return;}
  const el=(tag,value,parent)=>{const n=document.createElement(tag);if(value)n.textContent=value;if(parent)parent.append(n);return n;};
  const button=(value,fn,parent)=>{const n=el('button',value,parent);n.type='button';n.onclick=fn;return n;};
  root.openRosterImageImport=function(){
    const expected=localStorage.getItem(KEY);let current;
    try{current=JSON.parse(expected||'{"clubs":[]}');}catch{return alert('명부를 읽지 못했습니다. 먼저 백업을 확인해 주세요.');}
    const d=el('dialog','',document.body);d.className='roster-image-dialog';
    let files=[],rows=[],busy=false,declared=0,warnings=[];
    el('h2','캡처로 명부 만들기',d);
    const targetLabel=el('label','저장할 명부',d),target=el('select','',targetLabel);target.setAttribute('aria-label','저장할 명부');
    const o=el('option','새 명부',target);o.value='';
    (current.clubs||[]).forEach(c=>{const o=el('option',c.name,target);o.value=c.id;});
    const clubLabel=el('label','클럽 이름',d),clubName=el('input','',clubLabel);clubName.setAttribute('aria-label','클럽 이름');clubName.maxLength=80;
    target.onchange=()=>{clubLabel.hidden=!!target.value;render();};
    const uploadLabel=el('label','캡처 추가',d);uploadLabel.className='roster-image-upload';
    const upload=el('input','',uploadLabel);upload.type='file';upload.multiple=true;upload.accept='image/*';upload.setAttribute('aria-label','캡처 이미지 여러 장');
    el('p','최대 8장씩 AI 분석에 전송합니다. 사진으로 성별을 추측하지 않으며, 빈 정보는 저장 전에 확인합니다.',d);
    const fileList=el('div','',d),notice=el('p','',d);notice.setAttribute('role','status');
    const analyzeBtn=button('명부 읽기',async()=>{
      if(busy||!files.length)return;
      busy=true;controls();notice.textContent='명부를 읽고 있습니다…';
      try{
        const raw=await root.analyzeRosterScreenshots(files);
        rows=merge(rows,raw);declared=Math.max(declared,Number(raw.declaredMemberCount)||0);
        warnings=(Array.isArray(raw.warnings)?raw.warnings:[]).map(v=>text(v).slice(0,200));
        if(!target.value&&!clubName.value)clubName.value=text(raw.clubName).slice(0,80);
        files=[];renderFiles();render();notice.textContent='성별·연령·급수를 확인한 뒤 저장하세요.';
      }catch(e){notice.textContent='읽지 못했습니다. 선택한 캡처는 유지됩니다. '+(e.message||'다시 시도해 주세요.');}
      finally{busy=false;controls();}
    },d);
    const summary=el('p','',d),list=el('div','',d);list.className='roster-image-list';
    const actions=el('div','',d);actions.className='roster-image-actions';
    const close=button('닫기',()=>{if(!busy&&(!rows.length||confirm('저장하지 않은 명부 초안을 닫을까요?')))d.close();},actions);
    const save=button('명부 저장',()=>{
      try{
        if(localStorage.getItem(KEY)!==expected)throw Error('다른 화면에서 명부가 변경됐습니다. 기존 명부를 보호하기 위해 저장하지 않았습니다.');
        const next=build(current,target.value,clubName.value,rows,rosterSkillLevel,()=>crypto.randomUUID());
        if(!confirm(next.added+'명을 명부에 추가할까요? 기존 회원과 진행 중 경기는 변경하지 않습니다.'))return;
        if(expected)localStorage.setItem(KEY+'_before_capture',expected);
        localStorage.setItem(KEY,JSON.stringify(next.data));
        if(localStorage.getItem(KEY)!==JSON.stringify(next.data))throw Error('명부 저장을 확인하지 못했습니다.');
        loadRosters();renderClubList();rows=[];d.close();
      }catch(e){notice.textContent=e.message;}
    },actions);save.className='primary';
    function controls(){analyzeBtn.disabled=busy||!files.length;save.disabled=busy||!rows.length;upload.disabled=busy;close.disabled=busy;target.disabled=busy;clubName.disabled=busy;list.inert=busy;}
    function renderFiles(){
      fileList.replaceChildren();files.forEach((f,i)=>{const r=el('div','',fileList);el('span',f.name,r);button('제외',()=>{if(busy)return;files.splice(i,1);renderFiles();controls();},r);});
    }
    upload.onchange=()=>{
      const incoming=[...upload.files];upload.value='';
      if(incoming.some(f=>!f.type.startsWith('image/'))){notice.textContent='이미지 파일만 선택해 주세요.';return;}
      const next=[...files];incoming.forEach(f=>{if(!next.some(x=>x.name===f.name&&x.size===f.size&&x.lastModified===f.lastModified))next.push(f);});
      if(next.length>8||next.some(f=>f.size>20*1024*1024)){notice.textContent='한 번에 8장, 한 장당 20MB 이하로 선택해 주세요. 기존 선택은 유지됩니다.';return;}
      files=next;renderFiles();controls();
    };
    function render(){
      list.replaceChildren();const existing=new Set(((current.clubs||[]).find(c=>c.id===target.value)?.members||[]).map(m=>nameKey(m.name)));
      const duplicates=rows.filter(r=>existing.has(nameKey(r.name))).length;
      summary.textContent='읽은 회원 '+rows.length+'명'+(declared?' / 화면 총원 '+declared+'명':'')+' · 기존 회원 '+duplicates+'명 제외'+(declared>rows.length?' · 나머지 캡처를 추가할 수 있습니다.':'');
      warnings.forEach(w=>el('p',w,list));
      rows.forEach((row,i)=>{
        const box=el('fieldset','',list);box.setAttribute('aria-label',(i+1)+'번 회원');
        const head=el('div','',box);head.className='roster-image-member-head';
        const name=el('input','',head);name.value=row.name;name.maxLength=80;name.setAttribute('aria-label',(i+1)+'번 이름');name.oninput=()=>{row.name=name.value.trim();};
        name.readOnly=existing.has(nameKey(row.name));
        const remove=button('삭제',()=>{
          if(busy||!confirm((row.name||'이 회원')+' 님을 등록 목록에서 삭제할까요? 저장된 명부는 변경되지 않습니다.'))return;
          rows.splice(i,1);notice.textContent='등록 목록에서 삭제했습니다.';render();
        },head);remove.className='roster-image-remove';remove.setAttribute('aria-label',(i+1)+'번 회원 삭제');
        if(existing.has(nameKey(row.name))){el('p','이미 등록됨 · 기존 정보 유지',box);return;}
        if(row.conflicts.length)el('p','겹친 캡처의 정보가 다릅니다. 같은 이름의 다른 회원이면 이름을 구분해 다시 추가하세요.',box);
        const fields=el('div','',box);fields.className='roster-image-fields';
        for(const [key,label,choices] of [['gender','성별',['남','여']],['grade','급수',grades],['ageGroup','연령',ages]]){
          const s=el('select','',fields);s.setAttribute('aria-label',(i+1)+'번 '+label);
          for(const v of ['',...choices]){const opt=el('option',v?(key==='grade'?v+'급':v):label+' 선택',s);opt.value=v;}s.value=row[key];
          s.onchange=()=>{row[key]=s.value;row.conflicts=row.conflicts.filter(f=>f!==key&&(key!=='ageGroup'||f!=='birthYear'));notice.textContent='';};
        }
        const source=el('details','',box);el('summary','원본 확인',source);el('small',row.sources.join(' / '),source);
        if(row.birthYear)el('small','출생년도 '+row.birthYear+' · 올해 연나이 기준 연령대',source);
      });controls();
    }
    d.oncancel=e=>{e.preventDefault();close.click();};d.onclose=()=>d.remove();d.showModal();controls();
  };
})(typeof window==='object'?window:globalThis);
