(function(root){
  'use strict';

  const constants=Object.freeze({
    partnerGapOk:1.25,
    partnerGapCaution:2.25,
    partnerGapHard:3,
    teamDiffTarget:1.5,
    teamDiffLimit:2,
    teamDiffSevere:3
  });
  const ageBonus=Object.freeze({'20대':0,'30대':-0.2,'40대':-0.5,'50대':-1.2,'60대+':-2});

  function effectiveLevel(player){
    const p=player||{};
    const level=Number.isFinite(+p.level)?+p.level:0;
    const female=p.gender==='F'||p.gender==='여';
    const age=ageBonus[p.ageGroup]||0;
    return Math.round((level-(female?0.5:0)+age)*10)/10;
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
  function partnerGapPenalty(team){
    const gap=partnerGap(team);
    if(gap<=constants.partnerGapOk)return 0;
    let penalty=(gap-constants.partnerGapOk)*900;
    if(gap>constants.partnerGapCaution)penalty+=1200+(gap-constants.partnerGapCaution)*2200;
    if(gap>=constants.partnerGapHard)penalty+=4200+(gap-constants.partnerGapHard)*3200;
    return penalty;
  }
  function partnerRepeatPenalty(count,profile){
    const n=Math.max(0,Math.floor(Number(count)||0));
    if(profile==='pool')return n===0?0:n===1?120:n===2?900:1e9;
    return n===0?0:n===1?140:n===2?1200:1e9;
  }
  function opponentRepeatPenalty(count,profile){
    const n=Math.max(0,Math.floor(Number(count)||0));
    if(profile==='pool')return n===0?0:n===1?4:n===2?30:n===3?120:1e9;
    return n===0?0:n===1?2:n===2?15:n===3?80:1e9;
  }

  root.KokMatchQuality=Object.freeze({
    constants,
    effectiveLevel,
    teamLevel,
    teamDiff,
    teamDiffPenalty,
    partnerGap,
    partnerGapPenalty,
    partnerRepeatPenalty,
    opponentRepeatPenalty
  });
})(typeof globalThis!=='undefined'?globalThis:this);
