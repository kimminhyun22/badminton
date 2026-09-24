(function(root){
  'use strict';
  const grade={S:7,A:6,B:5,C:4,D:3,E:2};
  const age={'20대':0,'30대':-.2,'40대':-.5,'50대':-1.2,'60대+':-2};
  const round=n=>Math.round(n*10)/10;
  function players(raw){
    if(!Array.isArray(raw)||raw.length<2||raw.length>150)throw Error('회원은 2~150명이어야 합니다.');
    const names=new Set();
    return raw.map((m,i)=>{
      if(!m||typeof m.name!=='string'||!m.name.trim()||m.name.length>40||names.has(m.name.trim()))throw Error('회원 이름을 확인해 주세요.');
      names.add(m.name.trim());
      const gender=['여','F'].includes(m.gender)?'여':['남','M'].includes(m.gender)?'남':null;
      if(!gender||!Object.hasOwn(grade,m.grade)||!Object.hasOwn(age,m.ageGroup))throw Error('급수·성별·연령이 모두 입력된 명부가 필요합니다.');
      const step=Number(m.skillStep||0);
      if(!Number.isInteger(step)||Math.abs(step)>2)throw Error('개인 보정값을 확인해 주세요.');
      const level=round(grade[m.grade]-(gender==='여'?1:0)+step*.2);
      if(m.level!=null&&(!Number.isFinite(Number(m.level))||Math.abs(Number(m.level)-level)>.01))throw Error('명부의 급수와 보정값을 먼저 확인해 주세요.');
      return {id:'p'+i,name:m.name.trim(),grade:m.grade,gender,ageGroup:m.ageGroup,skillStep:step,level,base:round(grade[m.grade]-(gender==='여'?1.5:0)+age[m.ageGroup])};
    });
  }
  function pairs(list){
    const out=[];
    for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++)if(list[i].grade===list[j].grade&&Math.abs(list[i].base-list[j].base)<=.70001)out.push({id:`${list[i].id}_${list[j].id}`,a:list[i].id,b:list[j].id});
    return out;
  }
  function proposals(list,questions,votes={}){
    const byId=Object.fromEntries(list.map(p=>[p.id,p]));
    const edges=questions.map(q=>{
      const values=Object.entries(votes).flatMap(([who,answers])=>['a','b','tie'].includes(answers[q.id])?[{who,value:answers[q.id]}]:[]);
      const counts={a:0,b:0,tie:0};values.forEach(v=>counts[v.value]++);
      const winner=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
      return {...q,values,winner,consistent:values.length>0&&counts[winner]/values.length>=.8};
    });
    const delta=Object.fromEntries(list.map(p=>[p.id,p.skillStep*.2]));
    // Bounded least-change fit of ordinal constraints; never changes demographic coefficients.
    for(let iter=0;iter<120;iter++){
      const gradients=Object.fromEntries(list.map(p=>[p.id,.15*(delta[p.id]-p.skillStep*.2)]));
      const weights=Object.fromEntries(list.map(p=>[p.id,1]));
      for(const e of edges.filter(e=>e.consistent)){
        const diff=byId[e.a].base+delta[e.a]-byId[e.b].base-delta[e.b];
        const residual=e.winner==='tie'?diff:e.winner==='a'?Math.min(0,diff-.3):Math.max(0,diff+.3);
        gradients[e.a]+=residual;gradients[e.b]-=residual;weights[e.a]++;weights[e.b]++;
      }
      for(const p of list)delta[p.id]=Math.max(-.4,Math.min(.4,delta[p.id]-.5*gradients[p.id]/weights[p.id]));
    }
    return list.map(p=>{
      const all=edges.filter(e=>e.values.length&&(e.a===p.id||e.b===p.id));
      const good=all.filter(e=>e.consistent);
      const step=Math.max(-2,Math.min(2,Math.round(delta[p.id]/.2)));
      const direction=Math.sign(step-p.skillStep);
      const support=good.filter(e=>{
        const other=byId[e.a===p.id?e.b:e.a];
        const d=p.base+p.skillStep*.2-other.base-other.skillStep*.2;
        const outcome=e.winner==='tie'?0:(e.winner==='a')===(e.a===p.id)?1:-1;
        const shift=outcome===0?-d:outcome>0?Math.max(0,.3-d):Math.min(0,-.3-d);
        return Math.sign(shift)===direction&&Math.abs(shift)>.05;
      });
      const experts=new Set(good.flatMap(e=>e.values.map(v=>v.who))).size;
      const ready=step!==p.skillStep&&all.length===good.length&&support.length>=3&&support.length/good.length>=.8;
      return {id:p.id,name:p.name,current:p.skillStep,step,ready,opponents:all.length,experts,conflicts:all.length-good.length,
        state:all.some(e=>!e.consistent)?'의견 나뉨':ready?'적용 검토':step!==p.skillStep?'임시 보정':'기준 유지'};
    });
  }
  const api={players,pairs,proposals,version:'club-skill-v1'};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.KokClubSkill=api;
})(typeof globalThis!=='undefined'?globalThis:this);
