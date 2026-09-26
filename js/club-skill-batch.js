(function(root){
  'use strict';
  const fields=['name','grade','gender','ageGroup','level','skillStep'];
  const value=(m,k)=>k==='skillStep'?Number(m[k]||0):k==='ageGroup'?(m[k]||'40대'):k==='gender'?(['F','여'].includes(m[k])?'여':['M','남'].includes(m[k])?'남':m[k]):m[k];
  const same=(a,b)=>!!a&&!!b&&fields.every(k=>String(value(a,k))===String(value(b,k)));
  const profile=m=>Object.fromEntries(fields.map(k=>[k,value(m,k)]));
  function baseline(club,reviewId,id,current){
    const record=club?.skillReview?.baselines?.[reviewId]?.[id];
    return record&&same(current,record.after)?record.after:null;
  }
  function prepare(state,clubId,items,reviewId,batchId,now=Date.now()){
    if(!Array.isArray(items)||!items.length||items.length>150)throw Error('적용할 회원을 확인해 주세요.');
    const next=JSON.parse(JSON.stringify(state)),club=next.clubs?.find(c=>c.id===clubId);
    if(!club)throw Error('클럽 명부를 찾을 수 없습니다.');
    const seen=new Set(),entries=[];
    for(const item of items){
      const matches=club.members.filter(m=>m.name===item.original?.name);
      if(seen.has(item.id)||matches.length!==1||!same(matches[0],item.original))throw Error('명부가 변경됐습니다. 결과를 다시 확인해 주세요.');
      seen.add(item.id);
      if(!Number.isInteger(item.step)||Math.abs(item.step)>2)throw Error('보정값을 확인해 주세요.');
      const member=matches[0],before=profile(member);
      if(item.step===before.skillStep)continue;
      const grade={S:7,A:6,B:5,C:4,D:3,E:2}[member.grade];
      if(!grade||!['남','여'].includes(value(member,'gender')))throw Error('회원 정보를 확인해 주세요.');
      const level=Math.round((grade-(value(member,'gender')==='여'?1:0)+item.step*.2)*10)/10;
      entries.push({id:item.id,before,after:{...before,skillStep:item.step,level},previous:club.skillReview?.baselines?.[reviewId]?.[item.id]||null});
      member.skillStep=item.step;member.level=level;
    }
    if(!entries.length)throw Error('이미 적용된 보정안입니다.');
    club.skillReview=club.skillReview||{};
    const baselines=club.skillReview.baselines=club.skillReview.baselines||{};
    baselines[reviewId]={...baselines[reviewId]};
    entries.forEach(e=>{baselines[reviewId][e.id]={before:e.before,after:e.after};});
    club.skillReview.latest={id:batchId,reviewId,entries,at:now};
    return {state:next,count:entries.length};
  }
  function undo(state,clubId,batchId){
    const next=JSON.parse(JSON.stringify(state)),club=next.clubs?.find(c=>c.id===clubId),batch=club?.skillReview?.latest;
    if(!batch||batch.id!==batchId)throw Error('되돌릴 저장 기록이 변경됐습니다.');
    let count=0,skipped=0;
    for(const e of batch.entries){
      const matches=club.members.filter(m=>m.name===e.after.name);
      if(matches.length!==1||!same(matches[0],e.after)){skipped++;continue;}
      matches[0].skillStep=e.before.skillStep;matches[0].level=e.before.level;count++;
      const map=club.skillReview.baselines[batch.reviewId];
      if(e.previous)map[e.id]=e.previous;else delete map[e.id];
    }
    if(!count)throw Error('수동 수정된 값은 되돌리지 않습니다. 되돌릴 회원이 없습니다.');
    delete club.skillReview.latest;
    return {state:next,count,skipped};
  }
  const api={same,profile,baseline,prepare,undo};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.KokSkillBatch=api;
})(typeof globalThis!=='undefined'?globalThis:this);
