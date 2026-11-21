(function(root){
  'use strict';

  // Private to the team administrator's saved bracket. Never add this to a LIVE/RSVP payload.
  const version=1;
  const slots=['team1A','team1B','team2C','team2D'];
  const validWinner=value=>value==='t1'||value==='t2';
  let baseline=null;
  let officiallyFinished=false;

  function lineup(match){
    const names=slots.map(slot=>String(match?.[slot]?.name||'').trim());
    if(names.includes('')||new Set(names).size!==4)return null;
    return JSON.stringify([names.slice(0,2).sort(),names.slice(2).sort()]);
  }

  function capture(matches,participants,source,liveId=''){
    const quality=root.KokMatchQuality,policy=root.KokTeamCompetition;
    if(!matches.length||!quality||!policy)return null;
    const names=new Set(),ambiguous=new Set();
    participants.forEach(player=>{
      const name=String(player.name||'').trim();
      if(names.has(name))ambiguous.add(name);
      names.add(name);
    });
    const rows=[];
    for(const [i,match] of matches.entries()){
      const key=lineup(match);
      if(!key||slots.some(slot=>ambiguous.has(match[slot].name.trim())))continue;
      const levels=slots.map(slot=>quality.effectiveLevel(match[slot]));
      if(!levels.every(Number.isFinite))continue;
      const [a,b,c,d]=levels;
      const margin=(a+b)-(c+d)-quality.constants.partnerGapWeight*(Math.abs(a-b)-Math.abs(c-d));
      // marginSide's labels denote the positive and negative side; match results use t1/t2.
      const side=policy.marginSide(margin);
      rows.push({num:match.matchNumber||i+1,round:match.round,lineup:key,
        expected:side==='close'?'close':side==='blue'?'t1':'t2'});
    }
    return {version,source,liveId,capturedAt:Date.now(),
      policy:{partnerGapWeight:quality.constants.partnerGapWeight,closeBand:0.2},rows};
  }

  function unavailable(){return {version,unavailable:true};}
  function reset(){baseline=null;officiallyFinished=false;}
  function restore(saved,alreadyStarted=false,finishedByOfficial=false){
    baseline=saved?.version===version&&Array.isArray(saved.rows)?saved
      :alreadyStarted||saved?.unavailable?unavailable():null;
    officiallyFinished=!!finishedByOfficial;
  }
  function recordDraw(matches,players){
    baseline=capture(matches,players,'draw');
  }
  function preparePublication(matches,players,liveId,fresh,hasHistory){
    if(baseline?.unavailable)return baseline;
    if(baseline?.source==='publication')return baseline.liveId===liveId?baseline:unavailable();
    if(!fresh)return unavailable(); // Existing remote event or failed freshness read.
    if(hasHistory)return baseline||unavailable(); // Only an original draft may precede those results.
    return capture(matches,players,'publication',liveId)||unavailable();
  }

  function summarize(saved,matches,winners){
    if(saved?.version!==version||!Array.isArray(saved.rows))return null;
    const rows=new Map(),seen=new Set();
    for(const row of saved.rows){
      if(!row)continue;
      const num=Number(row.num);
      rows.set(num,rows.has(num)?null:row);
    }
    const duplicate=new Set();
    matches.forEach((m,i)=>{
      const num=Number(m.matchNumber||i+1);
      if(seen.has(num))duplicate.add(num);
      seen.add(num);
    });
    const result={expected:0,upset:0,close:0,changed:0,unplayed:0};
    matches.forEach((m,i)=>{
      const win=winners[i];
      if(m.voided||m.forfeit||!validWinner(win)){result.unplayed++;return;}
      const num=Number(m.matchNumber||i+1),row=rows.get(num);
      if(!row||duplicate.has(num)||Number(row.round)!==Number(m.round)||row.lineup!==lineup(m)
        ||(!validWinner(row.expected)&&row.expected!=='close')){
        result.changed++;
      }else if(row.expected==='close'){
        result.close++;
      }else if(row.expected===win){
        result.expected++;
      }else{
        result.upset++;
      }
    });
    return result;
  }

  function text(saved,matches,winners){
    const result=summarize(saved,matches,winners);
    if(!result)return '이 대진에는 경기 전 예측 기록이 없습니다.';
    const favored=result.expected+result.upset;
    const lines=[favored?'우세 예상 '+favored+'경기 중 예상대로 '+result.expected+' · 반전 '+result.upset:'비교할 우세 예상 경기 없음'];
    lines.push('접전 예상 '+result.close+'경기');
    if(result.changed)lines.push('대진 변경·비교 불가 '+result.changed+'경기');
    if(result.unplayed)lines.push('미실시·결과 없음 '+result.unplayed+'경기');
    return lines.join(' · ');
  }

  function render(container,matches,winners,teamMode,finished){
    if(!container)return;
    const show=teamMode&&matches.length&&(finished||officiallyFinished||matches.every((m,i)=>m.voided||validWinner(winners[i])));
    container.classList.toggle('hidden',!show);
    if(show)container.querySelector('[data-prediction-summary]').textContent=text(baseline,matches,winners);
  }

  const api={reset,restore,recordDraw,preparePublication,capture,summarize,text,render,
    snapshot:()=>baseline,officialFinish:()=>officiallyFinished,
    setOfficialFinish(value){const changed=officiallyFinished!==!!value;officiallyFinished=!!value;return changed;}};
  root.KokTeamPredictionRecap=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
