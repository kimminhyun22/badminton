(function(root){
  'use strict';
  function player(p){
    const a=p?.assessment;
    if(!a)return null;
    const resolved=Math.max(0,Number(p.resolved)||0),required=[...new Set(a.requiredGrades||[])];
    const linked=new Set(a.linkedGrades||[]),missingGrades=required.filter(g=>!linked.has(g));
    const missingOpponents=Math.max(0,3-resolved);
    const complete=!!p.reviewed&&!!a.scaleConnected&&resolved>=3;
    const opponentRatio=Math.min(resolved/3,1),gradeRatio=required.length?(required.length-missingGrades.length)/required.length:0;
    const percent=complete?100:Math.min(99,Math.floor(Math.min(opponentRatio,gradeRatio)*100));
    const remaining=[];
    if(missingOpponents)remaining.push(`서로 다른 상대 ${missingOpponents}명과 유효 비교가 더 필요합니다.`);
    if(!a.scaleConnected)remaining.push(missingGrades.length?`${missingGrades.join('·')}급수를 잇는 유효 비교가 필요합니다.`:'급수 간 연결을 추가 확인해 주세요.');
    if(!complete&&!remaining.length)remaining.push('판단이 나뉜 비교를 추가 확인해 주세요.');
    return {percent,complete,resolved,missingOpponents,linkedGrades:required.length-missingGrades.length,requiredGrades:required.length,
      reason:complete?'초기 점수 조건 충족 · 명부에 반영한 뒤에도 추가 평가로 보정할 수 있습니다.':remaining.join(' ')};
  }
  function overall(players,proposals){
    const byId=new Map((proposals||[]).map(p=>[p.id,p]));
    const ready=(players||[]).filter(p=>player(byId.get(p.id))?.complete).length,total=(players||[]).length;
    return {ready,total,percent:total?Math.floor(ready/total*100):0,remaining:total-ready};
  }
  const api={player,overall};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.KokSkillReadiness=api;
})(typeof globalThis!=='undefined'?globalThis:this);
