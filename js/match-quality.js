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
  const TYPE_BALANCE_CAP=600;
  const TYPE_BALANCE_MATCH_CAP=1200;

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

  // 종목 균형. 예전에는 혼복 쿼터 한 방향만 봤기 때문에, 동성복식을 한 번도
  // 못 잡는 선수(여성 상위권의 "혼복만 계속")를 아예 감지하지 못했습니다.
  // 이제 혼복·동성복식 양쪽 굶주림을 같이 봅니다.
  // 상한(600/합계 1200)은 그대로 둡니다 — 올려 보면 종목을 맞추느라
  // 출전 차례가 밀려 공정성 회귀가 났습니다(daily-server-replenish 실측).
  function mixedTargetRange(games){
    const total=Math.max(0,Number(games)||0);
    return {min:Math.floor(total/4),max:Math.floor(total/4)*2+Math.min(2,total%4)};
  }
  function typeBalancePenalty(player,isMixed){
    const nextGames=Math.max(1,Number(player?.typeTrackedGames||0)+1);
    const nextMixed=Math.max(0,Number(player?.mixedGames||0)+(isMixed?1:0));
    const nextSame=Math.max(0,nextGames-nextMixed);
    const range=mixedTargetRange(nextGames);
    const ideal=nextGames*0.375;
    // (1) 목표 범위 감점. 범위를 벗어나면 3,600점씩 붙어 금세 상한에 닿습니다.
    let quota=Math.abs(nextMixed-ideal)*35;
    if(nextMixed<range.min)quota+=(range.min-nextMixed)*3600;
    if(nextMixed>range.max)quota+=(nextMixed-range.max)*3600;
    // (2) 굶주림 감점. 상한을 (1)과 나눠 걸어 보면 종목을 맞추느라 출전
    //     차례가 밀려 공정성 회귀가 납니다(daily-server-replenish 실측).
    //     그래서 합쳐서 상한을 겁니다.
    let starve=0;
    if(nextGames>=3&&nextMixed===0)starve+=900;
    if(nextGames>=3&&nextSame===0)starve+=900;
    return Math.min(TYPE_BALANCE_CAP,quota+starve);
  }

  root.KokMatchQuality=Object.freeze({
    constants,
    TYPE_BALANCE_CAP,
    TYPE_BALANCE_MATCH_CAP,
    mixedTargetRange,
    typeBalancePenalty,
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
