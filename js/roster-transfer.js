(function(root){
  'use strict';
  const KEY='badminton_rosters_v1';
  function clean(data){
    if(!Array.isArray(data?.clubs)||!data.clubs.length||data.clubs.length>10)throw Error('명부 파일을 확인해 주세요.');
    if(data.kind&&data.kind!=='minton-roster-transfer')throw Error('명부 전달 파일이 아닙니다.');
    if(data.kind&&data.version!==1)throw Error('앱을 업데이트한 뒤 다시 불러와 주세요.');
    return data.clubs.map(c=>{
      if(typeof c?.name!=='string'||!c.name.trim()||c.name.length>80||!Array.isArray(c.members)||c.members.length>500)throw Error('클럽 정보를 확인해 주세요.');
      return {name:c.name.trim(),members:c.members.map(m=>{
        if(typeof m?.name!=='string'||!m.name.trim()||m.name.length>80||!['S','A','B','C','D','E'].includes(m.grade)||!['남','여','M','F'].includes(m.gender)||!Number.isFinite(m.level)||(!Number.isFinite(m.skillRating)&&(m.level<0||m.level>10)))throw Error('회원 이름·성별·급수를 확인해 주세요.');
        const step=m.skillStep===undefined?0:m.skillStep;
        if(!Number.isInteger(step)||Math.abs(step)>4)throw Error('개인 실력 보정값을 확인해 주세요.');
        const age=m.ageGroup==='60대'?'60대+':m.ageGroup;
        if(!['20대','30대','40대','50대','60대+'].includes(age))throw Error(m.name+' 님의 연령을 명부에서 확인한 뒤 다시 전달해 주세요.');
        if(m.skillRating!=null&&!Number.isFinite(m.skillRating))throw Error('실력 점수를 확인해 주세요.');
        return {...(Number.isFinite(m.skillRating)?{skillRating:m.skillRating}:{}),name:m.name.trim(),grade:m.grade,gender:['여','F'].includes(m.gender)?'여':'남',ageGroup:age,level:m.level,skillStep:step,isClubOfficial:m.isClubOfficial===true};
      })};
    });
  }
  function packet(club){return {kind:'minton-roster-transfer',version:1,_lvVersion:2,clubs:clean({clubs:[club]})};}
  function append(current,incoming,officials,uuid){
    const clubs=[...(current?.clubs||[])];
    if(clubs.length+incoming.length>10)throw Error('명부는 최대 10개까지 보관할 수 있습니다. 기존 명부를 정리한 뒤 다시 받아 주세요.');
    incoming.forEach((club,ci)=>{
      const base=club.name;let name=base,n=1;
      while(clubs.some(c=>c.name===name)){
        const suffix=' (받은 명부'+(n===1?'':' '+n)+')';
        name=base.slice(0,80-suffix.length)+suffix;n++;
      }
      clubs.push({id:'club_'+uuid(),name,members:club.members.map((m,mi)=>({...m,memberId:'member_'+uuid(),isClubOfficial:officials.has(ci+':'+mi)}))});
    });
    return {...current,_lvVersion:2,clubs};
  }
  function store(storage,expected,next){
    if(storage.getItem(KEY)!==expected)throw Error('다른 화면에서 명부가 변경됐습니다. 파일을 다시 선택해 주세요.');
    if(expected)storage.setItem(KEY+'_before_transfer',expected);
    const serialized=JSON.stringify(next);storage.setItem(KEY,serialized);
    if(storage.getItem(KEY)!==serialized)throw Error('명부를 기기에 저장하지 못했습니다.');
  }
  if(typeof module==='object'&&module.exports){module.exports={clean,packet,append,store};return;}
  const node=(tag,text,parent)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(parent)parent.append(el);return el;};
  const button=(text,fn,parent)=>{const el=node('button',text,parent);el.type='button';el.onclick=fn;return el;};
  function dialog(title){
    const d=node('dialog','',document.body);d.className='roster-transfer-dialog';
    node('h2',title,d);d.onclose=()=>d.remove();d.showModal();return d;
  }
  function read(){return JSON.parse(localStorage.getItem(KEY)||'{"clubs":[]}');}
  function download(file){
    const url=URL.createObjectURL(file),a=node('a','',document.body);a.href=url;a.download=file.name;a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  root.openRosterTransfer=function(){
    const clubs=read().clubs||[];
    if(!clubs.length)return alert('먼저 명부를 만들어 주세요.');
    const d=dialog('명부 전달');
    const label=node('label','전달할 명부',d),select=node('select','',label);select.setAttribute('aria-label','전달할 명부');
    clubs.forEach((c,i)=>{const o=node('option',c.name+' · '+c.members.length+'명',select);o.value=i;});
    const status=node('p','',d);status.setAttribute('role','status');
    const actions=node('div','',d);actions.className='roster-transfer-actions';
    const file=()=>{
      const c=(read().clubs||[]).find(c=>c.id===clubs[Number(select.value)].id);
      if(!c)throw Error('명부가 변경됐습니다. 다시 열어 주세요.');
      return new File([JSON.stringify(packet(c),null,2)],'민턴LIVE_명부_'+c.name.replace(/[^가-힣a-zA-Z0-9_-]/g,'_')+'.json',{type:'application/json'});
    };
    button('닫기',()=>d.close(),actions);
    button('파일 저장',()=>{try{download(file());status.textContent='파일 저장을 요청했습니다.';}catch(e){status.textContent=e.message;}},actions);
    const share=button('공유하기',async()=>{
      share.disabled=true;
      try{
        const f=file();
        if(navigator.canShare?.({files:[f]})&&navigator.share)await navigator.share({files:[f],title:'민턴LIVE 명부'});
        else{download(f);status.textContent='파일을 저장한 뒤 전달해 주세요.';}
      }catch(e){if(e.name!=='AbortError')status.textContent='공유하지 못했습니다. 파일 저장으로 전달해 주세요.';}
      finally{share.disabled=false;}
    },actions);share.className='primary';
  };
  root.importRosterTransfer=async function(evt){
    const input=evt.target,file=input.files?.[0];input.value='';if(!file)return;
    let incoming,expected;
    try{
      if(file.size>2*1024*1024)throw Error('2MB 이하의 명부 파일을 선택해 주세요.');
      incoming=clean(JSON.parse(await file.text()));expected=localStorage.getItem(KEY);
    }catch(e){alert(e.message||'명부 파일을 읽지 못했습니다.');return;}
    const d=dialog('명부 받기'),choices=new Set();
    node('p','이번 운영 임원을 선택해 주세요. 기존 명부와 경기는 유지됩니다.',d);
    const list=node('div','',d);list.className='roster-transfer-list';
    incoming.forEach((c,ci)=>{
      node('h3',c.name+' · '+c.members.length+'명',list);
      c.members.forEach((m,mi)=>{
        const label=node('label','',list),box=node('input','',label);box.type='checkbox';box.setAttribute('aria-label',m.name+' 임원');
        box.onchange=()=>{if(box.checked)choices.add(ci+':'+mi);else choices.delete(ci+':'+mi);};
        const profile=node('span','',label);node('b',m.name,profile);
        node('small',m.gender+' · '+m.ageGroup+' · '+m.grade+'급 · 보정 '+(m.skillStep*0.2).toFixed(1)+(m.isClubOfficial?' · 이전 임원':''),profile);
      });
    });
    const status=node('p','',d);status.setAttribute('role','status');
    const actions=node('div','',d);actions.className='roster-transfer-actions';
    button('취소',()=>d.close(),actions);
    const save=button('명부 저장',()=>{
      try{
        const names=incoming.flatMap((c,ci)=>c.members.filter((m,mi)=>choices.has(ci+':'+mi)).map(m=>m.name));
        if(!confirm('독립 명부로 저장할까요?\n임원: '+(names.join(', ')||'미지정')+'\n같은 이름의 명부도 합치지 않습니다.'))return;
        const current=expected?JSON.parse(expected):{clubs:[]};
        store(localStorage,expected,append(current,incoming,choices,()=>crypto.randomUUID()));
        if(typeof loadRosters==='function')loadRosters();
        if(typeof renderClubList==='function')renderClubList();
        save.disabled=true;status.textContent='명부 저장 완료 · 임원 '+names.length+'명';
        list.querySelectorAll('input').forEach(el=>el.disabled=true);
      }catch(e){status.textContent=e.message;}
    },actions);save.className='primary';
  };
})(typeof window==='object'?window:globalThis);
