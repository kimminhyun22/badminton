(function(root){
  'use strict';

  // The same score boundaries as pairBalance() and the v10 team quality rubric.
  const closeMargin = 0.2;
  const eps = 1e-9;
  const key = name => String(name || '').replace(/\s+/g, '').toLowerCase();

  function format(sides){
    if(sides.some(side => side.length !== 2))return '';
    const women = [];
    for(const side of sides){
      let count = 0;
      for(const player of side){
        const gender = player?.gender || player?.g;
        if(gender === 'F' || gender === '여')count++;
        else if(gender !== 'M' && gender !== '남')return '';
      }
      women.push(count);
    }
    if(women[0] === 2 && women[1] === 2)return '여복';
    if(women[0] === 0 && women[1] === 0)return '남복';
    if(women[0] === 1 && women[1] === 1)return '혼복';
    return '보정';
  }

  function matchType(match, memberByName){
    return format([match.t1 || [], match.t2 || []].map(side => side.map(memberByName)));
  }

  function hasRating(player){
    if(Number.isFinite(player?.skillRating))return true;
    const level = player?.level ?? player?.l;
    return level != null && level !== '' && Number.isFinite(Number(level)) && Number(level) > 0;
  }

  function assess(match, outName, candidate, memberByName, effectiveLevel){
    const names = [match.t1 || [], match.t2 || []];
    const sides = names.map(side => side.map(memberByName));
    const before = format(sides) || match.type || '';
    const out = key(outName);
    const sideIndex = names.findIndex(side => side.some(name => key(name) === out));
    if(sideIndex >= 0){
      const slot = names[sideIndex].findIndex(name => key(name) === out);
      sides[sideIndex][slot] = candidate;
    }
    const validPairs = sideIndex >= 0 && sides.every(side => side.length === 2);
    const predictedType = validPairs ? format(sides) : '';
    const ratingsKnown = validPairs && sides.every(side => side.every(hasRating));
    const result = {
      predictedType, ratingsKnown,
      preservesWomen: before === '여복' && predictedType === '여복',
      womenLost: before === '여복' && !!predictedType && predictedType !== '여복',
      formatChanged: !!before && !!predictedType && before !== predictedType,
      allowed:false, close:false, adjustedBalance:null, adjustedGap:null, rawBalance:null, rawGap:null
    };
    if(!ratingsKnown)return result;

    // Retain the signed margin from the replacing side's point of view, including when on t2.
    const [a,b] = sides[sideIndex].map(effectiveLevel);
    const [c,d] = sides[1 - sideIndex].map(effectiveLevel);
    const raw = a + b - (c + d);
    const asymmetry = Math.abs(a - b) - Math.abs(c - d);
    const adjusted = raw - 0.35 * asymmetry;
    const compound = Math.abs(asymmetry) > 1.5 + eps && raw * asymmetry < -eps;
    return {...result,
      rawBalance:raw, rawGap:Math.abs(raw), adjustedBalance:adjusted, adjustedGap:Math.abs(adjusted),
      allowed:Math.abs(raw) <= 2 + eps && Math.abs(adjusted) <= (compound ? 1.5 : 2) + eps,
      close:Math.abs(adjusted) <= closeMargin + eps
    };
  }

  // Compare like-sized gaps before preferring a format. The first band is the
  // published close range. Bands make this ordering transitive, including tied candidates.
  function gapBand(gap){
    return Math.max(1, Math.ceil((gap - eps) / closeMargin));
  }
  function compare(a, b){
    const team = Number(a.crossTeam) - Number(b.crossTeam);
    if(team)return team;
    if(a.ratingsKnown !== b.ratingsKnown)return Number(b.ratingsKnown) - Number(a.ratingsKnown);
    if(a.ratingsKnown){
      const safety = Number(b.allowed) - Number(a.allowed)
        || Number(a.adjustedGap > 1.5 + eps) - Number(b.adjustedGap > 1.5 + eps);
      if(safety)return safety;
      const adjustedBand = gapBand(a.adjustedGap) - gapBand(b.adjustedGap);
      if(adjustedBand)return adjustedBand;
    }
    const formatPriority = Number(b.preservesWomen) - Number(a.preservesWomen)
      || Number(!a.predictedType) - Number(!b.predictedType)
      || Number(a.formatChanged) - Number(b.formatChanged);
    if(formatPriority)return formatPriority;
    if(a.ratingsKnown){
      const gap = a.adjustedGap - b.adjustedGap;
      if(Math.abs(gap) > eps)return gap;
      const raw = a.rawGap - b.rawGap;
      if(Math.abs(raw) > eps)return raw;
      const advantage = Number(a.adjustedBalance > eps) - Number(b.adjustedBalance > eps);
      if(advantage)return advantage;
    }
    return a.games - b.games || a.name.localeCompare(b.name, 'ko');
  }

  const api = Object.freeze({assess, matchType, compare});
  if(typeof module === 'object' && module.exports)module.exports = api;
  else root.TeamFieldSubstitution = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
