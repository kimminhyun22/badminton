(function(root){
  'use strict';
  const Q=root.KokMatchQuality;
  const round=n=>Math.round(n*100)/100;
  const profile=(grade='C',gender='남',ageGroup='40대')=>({grade,gender,ageGroup});
  const questions=[];
  for(const grade of ['B','C','D']){
    for(const age of ['30대','50대','60대+'])questions.push({id:`age-${grade}-${age}`,kind:'연령',a:[profile(grade)],b:[profile(grade,'남',age)]});
    questions.push({id:`gender-${grade}`,kind:'성별',a:[profile(grade)],b:[profile(grade,'여')]});
  }
  questions.push({id:'pair-AC-BB',kind:'파트너 격차',a:[profile('A'),profile('C')],b:[profile('B'),profile('B')]});
  questions.push({id:'pair-BD-CC',kind:'파트너 격차',a:[profile('B'),profile('D')],b:[profile('C'),profile('C')]});
  const version='skill-questions-v1';
  function preview(p,draft={}){
    const d=Q.skillBreakdown(p);
    const ageScale=Number.isFinite(draft.ageScale)?Math.max(0,Math.min(2,draft.ageScale)):1;
    const genderScale=Number.isFinite(draft.genderScale)?Math.max(0,Math.min(2,draft.genderScale)):1;
    return {...d,total:round(d.total+d.age*(ageScale-1)+d.gender*(genderScale-1))};
  }
  function pair(players,draft){
    const levels=players.map(p=>preview(p,draft).total);
    return {sum:round(levels.reduce((a,b)=>a+b,0)),gap:levels.length===2?round(Math.abs(levels[0]-levels[1])):0};
  }
  function validate(record){
    if(!record||record.version!==version||record.policyId!==Q.skillPolicy.id||typeof record.respondent!=='string'||!/^r-[a-z0-9-]{8,80}$/i.test(record.respondent)||!record.answers||typeof record.answers!=='object'||Array.isArray(record.answers))throw Error('호환되는 응답 파일이 아닙니다.');
    if(typeof record.scope!=='string'||!record.scope.trim()||record.scope.length>80)throw Error('조사명이 필요합니다.');
    const answers={};
    for(const [id,value] of Object.entries(record.answers)){
      if(!questions.some(q=>q.id===id)||!(value===null||Number.isInteger(value)&&Math.abs(value)<=2))throw Error('응답 값이 올바르지 않습니다.');
      answers[id]=value;
    }
    if(!Object.keys(answers).length)throw Error('응답이 비어 있습니다.');
    return {version,policyId:Q.skillPolicy.id,scope:record.scope.trim(),respondent:record.respondent,answers};
  }
  function merge(records,incoming){
    const key=r=>JSON.stringify([r.scope,r.respondent]);
    const map=new Map(records.map(r=>{const v=validate(r);return [key(v),v];}));
    for(const record of incoming){
      const next=validate(record),old=map.get(key(next));
      // Same respondent/file is idempotent; conflicting revisions require explicit replacement.
      if(old&&Object.entries(next.answers).some(([id,v])=>Object.hasOwn(old.answers,id)&&old.answers[id]!==v))throw Error('같은 응답자의 다른 답변이 있습니다. 기존 응답을 유지했습니다.');
      map.set(key(next),{...next,answers:{...old?.answers,...next.answers}});
    }
    return [...map.values()];
  }
  function summarize(records){
    const unique=merge([],records);
    return questions.map(q=>{
      const values=unique.map(r=>r.answers[q.id]).filter(v=>Number.isInteger(v));
      const bins=[-2,-1,0,1,2].map(v=>values.filter(x=>x===v).length);
      const max=Math.max(0,...bins),n=values.length;
      const majority=n?max/n:0;
      return {id:q.id,n,bins,mean:n?round(values.reduce((a,b)=>a+b,0)/n):null,
        unknown:unique.filter(r=>r.answers[q.id]===null).length,
        state:n<5?'응답 부족':majority<0.7?'의견 나뉨':'의견 모임'};
    });
  }
  root.KokSkillReview=Object.freeze({version,questions,profile,preview,pair,validate,merge,summarize});
})(typeof globalThis!=='undefined'?globalThis:this);
