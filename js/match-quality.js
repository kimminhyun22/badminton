(function(root){
  'use strict';

  const constants=Object.freeze({
    partnerGapOk:1.25,
    partnerGapCaution:2.25,
    partnerGapHard:3,
    partnerGapCorrectionLimit:4.5,
    partnerGapSymmetryLimit:1.5,
    teamDiffTarget:1.5,
    teamDiffLimit:2,
    teamDiffSevere:3
  });
  const ageBonus=Object.freeze({'20대':0,'30대':-0.2,'40대':-0.5,'50대':-1.2,'60대+':-2});
  // This version describes the existing production formula, not a new rating.
  const skillPolicy=Object.freeze({id:'skill-v1',grade:Object.freeze({S:7,A:6,B:5,C:4,D:3,E:2}),age:ageBonus,femaleRoster:-1,femaleEffective:-0.5,step:0.2});
  function gradeLevel(grade,gender){
    const base=skillPolicy.grade[String(grade||'').toUpperCase()];
    return base==null?null:base+((gender==='여'||gender==='F')?skillPolicy.femaleRoster:0);
  }
  function skillBreakdown(player){
    const p=player||{},base=skillPolicy.grade[String(p.grade||'').toUpperCase()];
    const female=p.gender==='F'||p.gender==='여';
    const stored=Number.isFinite(+p.level)?+p.level:null;
    const step=Number.isInteger(+p.skillStep)&&Math.abs(+p.skillStep)<=2?+p.skillStep:0;
    const level=stored??(base==null?0:base+(female?skillPolicy.femaleRoster:0)+step*skillPolicy.step);
    const age=ageBonus[p.ageGroup]||0;
    return {policyId:skillPolicy.id,base:base??null,gender:female?skillPolicy.femaleRoster+skillPolicy.femaleEffective:0,age,
      personal:base==null?null:Math.round((level-base-(female?skillPolicy.femaleRoster:0))*10)/10,
      level,total:effectiveLevel({...p,level}),missing:base==null||!['남','여','M','F'].includes(p.gender)||!Object.hasOwn(ageBonus,p.ageGroup)};
  }

  function effectiveLevel(player){
    const p=player||{};
    const level=Number.isFinite(+p.level)?+p.level:0;
    const female=p.gender==='F'||p.gender==='여';
    const age=ageBonus[p.ageGroup]||0;
    return Math.round((level+(female?skillPolicy.femaleEffective:0)+age)*10)/10;
  }
  function teamLevel(team){
    return Array.isArray(team)?team.reduce((sum,p)=>sum+effectiveLevel(p),0):0;
  }
  function teamDiff(team1,team2){
    return Math.round(Math.abs(teamLevel(team1)-teamLevel(team2))*10)/10;
  }
  function teamDiffPenalty(diff){
    const d=Math.max(0,Number.isFinite(+diff)?+diff:0);
    let penalty=d*360;
    if(d>constants.teamDiffTarget)penalty+=(d-constants.teamDiffTarget)*1600;
    if(d>constants.teamDiffLimit)penalty+=50000+(d-constants.teamDiffLimit)*12000;
    return penalty;
  }
  function partnerGap(team){
    if(!Array.isArray(team)||team.length<2)return 0;
    return Math.abs(effectiveLevel(team[0])-effectiveLevel(team[1]));
  }
  function partnerGapSymmetry(team1,team2){
    return Math.abs(partnerGap(team1)-partnerGap(team2));
  }
  function partnerGapPenalty(team){
    const gap=partnerGap(team);
    if(gap<=constants.partnerGapOk)return 0;
    let penalty=(gap-constants.partnerGapOk)*900;
    if(gap>constants.partnerGapCaution)penalty+=1200+(gap-constants.partnerGapCaution)*2200;
    if(gap>=constants.partnerGapHard)penalty+=4200+(gap-constants.partnerGapHard)*3200;
    return penalty;
  }
  // 반복 회피는 경기 수 균등 다음 순위입니다. 다만 예전 값(파트너 140,
  // 상대 2/15/80)은 "경기 수 1경기 차이"(170점)보다도 싸서, 같은 사람끼리
  // 계속 붙는 편이 점수상 이득이었습니다. 실제 운동에서 같은 얼굴이 네 번씩
  // 나온 원인이라 한 단계씩 올립니다.
  function partnerRepeatPenalty(count,profile){
    const n=Math.max(0,Math.floor(Number(count)||0));
    if(profile==='pool')return n===0?0:n===1?120:n===2?900:1e9;
    return n===0?0:n===1?240:n===2?1400:1e9;
  }
  function opponentRepeatPenalty(count,profile){
    const n=Math.max(0,Math.floor(Number(count)||0));
    if(profile==='pool')return n===0?0:n===1?4:n===2?30:n===3?120:1e9;
    return n===0?0:n===1?8:n===2?50:n===3?190:1e9;
  }

  root.KokMatchQuality=Object.freeze({
    skillPolicy,
    gradeLevel,
    skillBreakdown,
    constants,
    effectiveLevel,
    teamLevel,
    teamDiff,
    teamDiffPenalty,
    partnerGap,
    partnerGapSymmetry,
    partnerGapPenalty,
    partnerRepeatPenalty,
    opponentRepeatPenalty
  });
})(typeof globalThis!=='undefined'?globalThis:this);
