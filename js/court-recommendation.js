(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.KokMatchCourtRecommendation=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const WARMUP_MS=45*60*1000;

  function names(row,side){
    const raw=side===1?(row?.team1||row?.t1||[]):(row?.team2||row?.t2||[]);
    return raw.map(value=>String(value||'').trim()).filter(Boolean);
  }
  function matchPlayers(row){return [...names(row,1),...names(row,2)];}
  function pairKey(a,b){return [a,b].sort((x,y)=>x.localeCompare(y,'ko')).join('|');}
  function addCount(map,key){if(key)map.set(key,(map.get(key)||0)+1);}
  function duplicateCount(map){return [...map.values()].reduce((sum,count)=>sum+Math.max(0,count-1),0);}

  function evaluate(input){
    const courts=Math.max(1,Math.min(12,parseInt(input?.courts,10)||1));
    const pool=Math.max(0,parseInt(input?.pool,10)||0);
    const completed=(Array.isArray(input?.completed)?input.completed:[]).filter(Boolean);
    const active=(Array.isArray(input?.active)?input.active:[]).filter(Boolean);
    const startedAt=Math.max(0,Number(input?.startedAt||0));
    const now=Math.max(0,Number(input?.now||Date.now()));
    if(courts<=1||pool<4||!active.length)return null;

    // 초반의 빠른 회전은 현장 선호다. 최소 3회전 또는 45분 뒤부터만 피로를 제안한다.
    const matured=completed.length>=courts*3||(startedAt>0&&now-startedAt>=WARMUP_MS);
    if(!matured)return null;

    const recent=completed.slice(-Math.max(6,courts*3));
    const lastWave=completed.slice(-courts);
    const lastPlayers=new Set(lastWave.flatMap(matchPlayers));
    const activePlayers=new Set(active.flatMap(matchPlayers));
    const consecutive=[...activePlayers].filter(name=>lastPlayers.has(name)).length;

    const partnerCounts=new Map();
    const opponentCounts=new Map();
    [...recent,...active].forEach(row=>{
      const first=names(row,1),second=names(row,2);
      if(first.length===2)addCount(partnerCounts,pairKey(first[0],first[1]));
      if(second.length===2)addCount(partnerCounts,pairKey(second[0],second[1]));
      first.forEach(a=>second.forEach(b=>addCount(opponentCounts,pairKey(a,b))));
    });
    const partnerRepeats=duplicateCount(partnerCounts);
    const opponentRepeats=duplicateCount(opponentCounts);
    const rotationSpare=pool-courts*4;
    const rotationPressure=rotationSpare<4;
    const repeated=partnerRepeats>=2||opponentRepeats>=4;

    // 교대 인원이 부족하고 실제 연속·반복이 나타날 때만 권장한다. 한 코트 줄여
    // 교대 4명 이상이 확보되면 과거 반복 기록이 남아 있어도 추가 축소하지 않는다.
    if(!rotationPressure||!(consecutive>0||repeated||rotationSpare<=1))return null;

    const reasons=[];
    if(rotationPressure)reasons.push(`교대 ${Math.max(0,rotationSpare)}명`);
    if(consecutive)reasons.push(`연속 출전 ${consecutive}명`);
    if(partnerRepeats)reasons.push(`파트너 반복 ${partnerRepeats}건`);
    if(opponentRepeats)reasons.push(`상대 반복 ${opponentRepeats}건`);
    return {
      current:courts,
      target:courts-1,
      pool,
      consecutive,
      partnerRepeats,
      opponentRepeats,
      rotationSpare,
      title:`${courts-1}코트 운영 권장`,
      desc:`${pool}명 · ${reasons.slice(0,3).join(' · ')}. 휴식과 대진 다양성을 위해 한 코트 줄여 보세요.`
    };
  }

  return {evaluate,WARMUP_MS};
});
