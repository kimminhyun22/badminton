(function(root){
  'use strict';
  const fields=['name','grade','gender','ageGroup','level','skillStep','skillRating'];
  const value=(m,k)=>k==='skillRating'?(Number.isFinite(m[k])?m[k]:null):k==='skillStep'?Number(m[k]||0):k==='ageGroup'?(m[k]||'40대'):k==='gender'?(['F','여'].includes(m[k])?'여':['M','남'].includes(m[k])?'남':m[k]):m[k];
  const same=(a,b)=>!!a&&!!b&&fields.every(k=>String(value(a,k))===String(value(b,k)));
  const profile=m=>Object.fromEntries(fields.map(k=>[k,value(m,k)]));
  const sameIdentity=(a,b)=>!!a&&!!b&&String(a.name)===String(b.name);
  // RTDB map keys reject these characters even though member names may contain
  // them. Escape '%' too, so a literal '%2E' cannot alias an encoded period.
  const keyPart=v=>String(v).replace(/[.#$\[\]/%\u0000-\u001f\u007f]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase().padStart(2,'0'));
  const sourceKey=m=>m?.memberId||m?.id?'id:'+keyPart(m.memberId||m.id):'name:'+keyPart(m?.name||'');
  const currentSource=(club,member)=>club?.skillReview?.sources?.[sourceKey(member)]||null;
  // Once an event has updated the official score, refreshing an older survey
  // must not turn that new score into permission to restore its older proposal.
  // This is local assessment ordering, not an authentication boundary.
  function sourceConflict(club,member,reviewId,options={}){
    const source=currentSource(club,member);
    if(!source?.protected||source.reviewId===reviewId)return null;
    return Number.isFinite(options.createdAt)&&options.createdAt>source.appliedAt?null:source;
  }
  function reviewBaselines(own,club){
    if(!club||own?.clubId!==club.id)return [];
    return (own?.snapshots||[]).flatMap((original,i)=>{
      const matches=club?.members?.filter(m=>m.name===original.name)||[],m=matches.length===1?matches[0]:null;
      if(!sameIdentity(original,m))return [];
      if(sourceConflict(club,m,own.id,{createdAt:own.createdAt}))return [];
      const p=profile(m),grade={S:7,A:6,B:5,C:4,D:3,E:2}[p.grade];
      const expected=Math.round((grade-(p.gender==='여'?1:0)+p.skillStep*.2)*10)/10;
      if(p.skillRating!=null){return [{id:'p'+i,...p}];}
      if(!grade||!['남','여'].includes(p.gender)||!Number.isInteger(p.skillStep)||Math.abs(p.skillStep)>4||!Number.isFinite(Number(p.level))||Math.abs(Number(p.level)-expected)>.001)return [];
      return [{id:'p'+i,...p}];
    });
  }
  function baseline(club,reviewId,id,current){
    const record=club?.skillReview?.baselines?.[reviewId]?.[id];
    return record&&same(current,record.after)?record.after:null;
  }
  function prepare(state,clubId,items,reviewId,batchId,now=Date.now(),options={}){
    if(!Array.isArray(items)||!items.length||items.length>150)throw Error('적용할 회원을 확인해 주세요.');
    if(options.kind!==undefined&&!['club','team-event'].includes(options.kind))throw Error('평가 출처를 확인해 주세요.');
    if(options.kind==='team-event'&&(!Number.isFinite(options.createdAt)||options.createdAt<=0))throw Error('팀전 평가의 최초 생성 시각을 확인해 주세요.');
    const next=JSON.parse(JSON.stringify(state)),club=next.clubs?.find(c=>c.id===clubId);
    if(!club)throw Error('클럽 명부를 찾을 수 없습니다.');
    const seen=new Set(),entries=[];
    for(const item of items){
      if(item.clubId&&item.clubId!==clubId)throw Error('다른 클럽의 보정안은 적용할 수 없습니다.');
      const matches=club.members.filter(m=>m.name===item.original?.name);
      if(seen.has(item.id)||matches.length!==1||!same(matches[0],item.original))throw Error('명부가 변경됐습니다. 결과를 다시 확인해 주세요.');
      if(sourceConflict(club,matches[0],reviewId,options))throw Error('다른 평가로 갱신된 점수입니다. 이전 평가로 덮어쓸 수 없습니다. 갱신 이후 시작한 평가를 사용해 주세요.');
      seen.add(item.id);
      if(item.skillRating!=null?!Number.isFinite(item.skillRating):(!Number.isInteger(item.step)||Math.abs(item.step)>4))throw Error('보정값을 확인해 주세요.');
      const member=matches[0],before=profile(member);
      if(item.skillRating!=null?item.skillRating===before.skillRating:item.step===before.skillStep)continue;
      const grade={S:7,A:6,B:5,C:4,D:3,E:2}[member.grade];
      if(!grade||!['남','여'].includes(value(member,'gender')))throw Error('회원 정보를 확인해 주세요.');
      const level=item.skillRating!=null?item.skillRating+(value(member,'gender')==='여'?.5:0)-({'20대':0,'30대':-.2,'40대':-.5,'50대':-1.2,'60대+':-2}[member.ageGroup||'40대']||0):Math.round((grade-(value(member,'gender')==='여'?1:0)+item.step*.2)*10)/10;
      const previousSource=currentSource(club,member),key=sourceKey(member);
      const afterSource={reviewId,batchId,kind:options.kind||'club',createdAt:Number.isFinite(options.createdAt)?options.createdAt:0,
        appliedAt:now,revision:(previousSource?.revision||0)+1,protected:options.kind==='team-event'||!!previousSource?.protected};
      entries.push({id:item.id,before,after:{...before,skillStep:item.step,level,skillRating:item.skillRating??null},previous:club.skillReview?.baselines?.[reviewId]?.[item.id]||null,sourceKey:key,previousSource,afterSource});
      member.skillStep=item.step;member.level=level;if(item.skillRating!=null)member.skillRating=item.skillRating;else delete member.skillRating;
    }
    if(!entries.length)throw Error('이미 적용된 보정안입니다.');
    club.skillReview=club.skillReview||{};
    const baselines=club.skillReview.baselines=club.skillReview.baselines||{};
    const sources=club.skillReview.sources=club.skillReview.sources||{};
    baselines[reviewId]={...baselines[reviewId]};
    entries.forEach(e=>{baselines[reviewId][e.id]={before:e.before,after:e.after};sources[e.sourceKey]={...e.afterSource};});
    club.skillReview.latest={id:batchId,reviewId,entries,at:now};
    return {state:next,count:entries.length};
  }
  function undo(state,clubId,batchId,now=Date.now()){
    const next=JSON.parse(JSON.stringify(state)),club=next.clubs?.find(c=>c.id===clubId),batch=club?.skillReview?.latest;
    if(!batch||batch.id!==batchId)throw Error('되돌릴 저장 기록이 변경됐습니다.');
    let count=0,skipped=0;
    for(const e of batch.entries){
      const matches=club.members.filter(m=>m.name===e.after.name);
      if(matches.length!==1||!same(matches[0],e.after)){skipped++;continue;}
      const source=currentSource(club,matches[0]);
      if(e.afterSource&&(!source||sourceKey(matches[0])!==e.sourceKey||source.reviewId!==e.afterSource.reviewId||source.batchId!==e.afterSource.batchId||source.revision!==e.afterSource.revision)){skipped++;continue;}
      if(e.before.skillRating!=null)matches[0].skillRating=e.before.skillRating;else delete matches[0].skillRating;
      matches[0].skillStep=e.before.skillStep;matches[0].level=e.before.level;count++;
      const map=club.skillReview.baselines[batch.reviewId];
      if(e.previous)map[e.id]=e.previous;else delete map[e.id];
      // Undo is another write by this assessment. Keep the protection barrier
      // and ownership instead of making the restored value look unreviewed.
      if(source)club.skillReview.sources[e.sourceKey]={...source,revision:source.revision+1,appliedAt:now,undone:true};
    }
    if(!count)throw Error('수동 수정된 값은 되돌리지 않습니다. 되돌릴 회원이 없습니다.');
    delete club.skillReview.latest;
    return {state:next,count,skipped};
  }
  const api={same,profile,sameIdentity,reviewBaselines,baseline,currentSource,sourceConflict,prepare,undo};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.KokSkillBatch=api;
})(typeof globalThis!=='undefined'?globalThis:this);
