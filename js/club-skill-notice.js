(function(){
  'use strict';
  const KEY='kokmatch_club_skill_links_v1';
  const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch(_){return fallback;}};
  const mode=location.pathname.endsWith('team.html')?'team':'daily';
  let refreshing=false;
  const same=(a,b)=>a&&b&&['name','grade','gender','ageGroup','level','skillStep'].every(k=>String(a[k]??(k==='skillStep'?0:''))===String(b[k]??(k==='skillStep'?0:'')));
  function paint(){
    const all=read(KEY,[]),now=Date.now();
    const entries=all.filter(l=>l.readyCount>0&&now-l.createdAt<37*86400000);
    const clubs=read('badminton_rosters_v1',{}).clubs||[];
    const due=clubs.filter(c=>{
      const records=all.filter(l=>l.clubId===c.id&&!l.pending);
      if(!records.length)return false;
      const latest=Math.max(...records.map(l=>l.reviewedAt||l.createdAt));
      return now-latest>=90*86400000;
    });
    let box=document.getElementById('clubSkillNotice');
    if(!entries.length&&!due.length){box?.remove();return;}
    if(!box){box=document.createElement('div');box.id='clubSkillNotice';box.setAttribute('role','status');box.style.cssText='padding:10px 16px;background:#edf7f1;color:#285d44;font-size:14px;';document.querySelector('header')?.after(box);}
    const items=[];
    for(const entry of entries){
      const link=document.createElement('a');link.href=`skill-review.html?from=${mode}&review=${encodeURIComponent(entry.id)}`;
      link.textContent=`${entry.clubName} · 미세조정 적용 확인`;items.push(link);
    }
    for(const club of due){
      const link=document.createElement('a');link.href=`skill-review.html?from=${mode}&club=${encodeURIComponent(club.id)}&quick=1`;
      link.textContent=`${club.name} · 3개월 실력 점검, 5문제 풀기`;items.push(link);
    }
    items.forEach(link=>{link.style.cssText='color:inherit;display:block;padding:6px 0';});box.replaceChildren(...items);
  }
  async function refresh(){
    if(document.hidden||refreshing)return;
    refreshing=true;
    const entries=read(KEY,[]).filter(l=>!l.pending&&Date.now()-l.createdAt<37*86400000);
    for(const l of entries){
      try{
        const response=await fetch('https://us-central1-kokmatch-23b31.cloudfunctions.net/clubSkillCalibration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:{action:'read',id:l.id,key:l.key}}),signal:AbortSignal.timeout(15000)});
        const data=await response.json();if(!response.ok||!data.result)continue;
        const all=read(KEY,[]),current=all.find(v=>v.id===l.id);if(!current)continue;
        current.reviewedAt=data.result.reviewedAt||current.reviewedAt||0;
        current.readyCount=data.result.proposals.filter(p=>{
          const club=read('badminton_rosters_v1',{}).clubs?.find(c=>c.id===l.clubId);
          const original=l.snapshots?.[Number(p.id.slice(1))];
          return p.ready&&same(club?.members?.find(m=>m.name===p.name),original);
        }).length;
        localStorage.setItem(KEY,JSON.stringify(all));
      }catch(_){}
    }
    paint();refreshing=false;
  }
  function apply(){
    if(!new URLSearchParams(location.search).has('skillReviewApply'))return;
    const proposal=read('kokmatch_skill_apply_v1',null);
    localStorage.removeItem('kokmatch_skill_apply_v1');
    const url=new URL(location.href);url.searchParams.delete('skillReviewApply');history.replaceState(null,'',url);
    if(!proposal||Date.now()-proposal.createdAt>86400000||!Number.isInteger(proposal.step)||Math.abs(proposal.step)>2)return;
    const club=rosters.clubs.find(c=>c.id===proposal.clubId);
    const idx=club?.members.findIndex(m=>m.name===proposal.original?.name)??-1;
    const persisted=read('badminton_rosters_v1',{}).clubs?.find(c=>c.id===proposal.clubId)?.members?.find(m=>m.name===proposal.original?.name);
    if(idx<0||!same(club.members[idx],proposal.original)||!same(persisted,proposal.original)){
      alert('명부 정보가 바뀌었습니다. 새 명부로 미세조정을 다시 확인해 주세요.');return;
    }
    switchNav('roster');editMember(club.id,idx);selectMemberSkill(proposal.step);
    // Existing member edit save is the sole production write path; cancel changes nothing.
  }
  document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{apply();paint();refresh();},0));
  window.addEventListener('storage',event=>{if(event.key===KEY)paint();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  setInterval(refresh,60000);
})();
