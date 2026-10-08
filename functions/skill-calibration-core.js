(function(root){
  'use strict';
  const grade={S:7,A:6,B:5,C:4,D:3,E:2};
  const age={'20대':0,'30대':-.2,'40대':-.5,'50대':-1.2,'60대+':-2};
  const round=n=>Math.round(n*10)/10;
  function player(m,i=0){
      if(!m||typeof m.name!=='string'||!m.name.trim()||m.name.length>40)throw Error('이름 확인 필요');
      const gender=['여','F'].includes(m.gender)?'여':['남','M'].includes(m.gender)?'남':null;
      const missing=[!Object.hasOwn(grade,m.grade)&&'급수',!gender&&'성별',!Object.hasOwn(age,m.ageGroup)&&'연령'].filter(Boolean);
      if(missing.length)throw Error(missing.join('·')+' 확인 필요');
      const step=Number(m.skillStep||0);
      if(!Number.isInteger(step)||Math.abs(step)>4)throw Error('개인 보정값을 확인해 주세요.');
      const level=round(grade[m.grade]-(gender==='여'?1:0)+step*.2);
      if(m.skillRating==null&&m.level!=null&&(!Number.isFinite(Number(m.level))||Math.abs(Number(m.level)-level)>.01))throw Error('명부의 급수와 보정값을 먼저 확인해 주세요.');
      if(m.skillRating!=null&&(typeof m.skillRating!=='number'||!Number.isFinite(m.skillRating)))throw Error('실력 점수를 확인해 주세요.');
      return {...(m.skillRating!=null?{skillRating:m.skillRating}:{}),id:'p'+i,name:m.name.trim(),grade:m.grade,gender,ageGroup:m.ageGroup,skillStep:step,level:m.skillRating!=null?m.skillRating+(gender==='여'?.5:0)-age[m.ageGroup]:level,base:round(grade[m.grade]-(gender==='여'?1.5:0)+age[m.ageGroup])};
  }
  function players(raw){
    if(!Array.isArray(raw)||raw.length<2||raw.length>150)throw Error('회원은 2~150명이어야 합니다.');
    const names=new Set();
    return raw.map((m,i)=>{
      const p=player(m,i);
      if(names.has(p.name))throw Error('회원 이름을 확인해 주세요.');
      names.add(p.name);return p;
    });
  }
  function pairs(list){
    const out=[];
    for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++)out.push({id:`${list[i].id}_${list[j].id}`,a:list[i].id,b:list[j].id});
    return out;
  }
  function rating(p){return Number.isFinite(p.skillRating)?p.skillRating:p.base+(p.skillStep||0)*.2;}
  function proposals(list,questions,votes={},anchors=list){
    const index=new Map(list.map((p,i)=>[p.id,i]));
    const edges=questions.flatMap(q=>{
      if(!index.has(q.a)||!index.has(q.b))return [];
      const values=Object.entries(votes||{}).flatMap(([who,a])=>['a','b','tie'].includes(a[q.id])?[{who,value:a[q.id]}]:[]);
      if(!values.length)return [];
      const counts={a:0,b:0,tie:0};values.forEach(v=>counts[v.value]++);
      const winner=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
      return [{...q,i:index.get(q.a),j:index.get(q.b),values,counts,winner,consistent:counts[winner]>values.length/2,
        wins:counts.a+counts.tie/2,n:values.length}];
    });
    const neighbors=list.map(()=>[]);
    edges.forEach(e=>{neighbors[e.i].push(e.j);neighbors[e.j].push(e.i);});
    const groups=[],component=list.map(()=>-1);
    list.forEach((p,i)=>{
      if(component[i]>=0)return;
      const group=[],queue=[i],id=groups.length;component[i]=id;
      for(let at=0;at<queue.length;at++){const j=queue[at];group.push(j);for(const k of neighbors[j])if(component[k]<0){component[k]=id;queue.push(k);}}
      groups.push(group);
    });
    // Bradley–Terry logistic fit uses every vote, with ties as half observations.
    // A weak symmetric quadratic prior makes unanimous/sparse data finite. It is
    // independent of demographic profiles and imposes no score/difference cap.
    const x=list.map(()=>0),lambda=.25;
    for(let iter=0;iter<2000;iter++){
      const g=x.map(v=>lambda*v),curvature=x.map(()=>lambda);
      for(const e of edges){const probability=1/(1+Math.exp(x[e.j]-x[e.i]));
        const residual=e.n*probability-e.wins;
        g[e.i]+=residual;g[e.j]-=residual;
        // Uniform Hessian bound gives a stable simultaneous descent step.
        curvature[e.i]+=e.n*.5;curvature[e.j]+=e.n*.5;
      }
      let max=0;
      for(let i=0;i<x.length;i++){const step=g[i]/curvature[i];x[i]-=step;max=Math.max(max,Math.abs(step));}
      if(max<1e-8)break;
    }
    // Votes identify relative skill, not an absolute origin. Freeze the initial
    // component mean; never re-anchor on an already applied proposal on reread.
    const origin=groups.map(group=>group.reduce((n,i)=>n+rating(anchors.find(a=>a.id===list[i].id)||list[i]),0)/group.length);
    const scores=list.map((p,i)=>neighbors[i].length?Math.round((origin[component[i]]+x[i])*1000)/1000:rating(p));
    return list.map((p,i)=>{
      const all=edges.filter(e=>e.i===i||e.j===i),good=all.filter(e=>e.consistent);
      const currentRating=rating(p),skillRating=scores[i],reviewed=all.length>0;
      const ready=reviewed&&(!Number.isFinite(p.skillRating)||Math.abs(skillRating-currentRating)>.0005);
      const comparisons=all.map(e=>({name:list[e.i===i?e.j:e.i].name,agree:e.consistent,
        outcome:e.winner==='tie'?'tie':((e.winner==='a')===(e.i===i)?'higher':'lower'),votes:e.n}));
      return {id:p.id,name:p.name,current:p.skillStep,step:p.skillStep,currentRating,skillRating,model:'comparison-v2',ready,reviewed,
        componentSize:groups[component[i]].length,connected:groups[component[i]].length===list.length,
        resolved:good.length,opponents:all.length,experts:new Set(all.flatMap(e=>e.values.map(v=>v.who))).size,
        conflicts:all.length-good.length,support:good.length,comparisons,
        state:ready?'실력 점수 저장':reviewed?'현재 값 유지':'초기 추정 · 비교 전'};
    });
  }
  const api={player,players,pairs,proposals,version:'comparison-v2'};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.KokClubSkill=api;
})(typeof globalThis!=='undefined'?globalThis:this);
