const APP_VERSION='1.10.333';
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

// ── 인앱 브라우저 처리 (카카오·밴드·네이버 등) ──
// 플랫폼·OS별 최적 탈출 전략:
//   카카오iOS: kakaotalk://openExternal 자동 → 완료화면(이 창 닫아도 됨)
//   Android전체: intent://Chrome 자동 → 완료화면
//   밴드/네이버iOS: WKWebView라 자동탈출 불가 → 버튼 1개만 있는 완료화면
(function(){
  const ua=navigator.userAgent||'';
  const isInApp=/KAKAO|kakaotalk|Line\/|NAVER|NBandApp|Instagram|FBAN|FBAV|Snapchat/i.test(ua);
  if(!isInApp) return;

  if(sessionStorage.getItem('_esc_done')) return;
  sessionStorage.setItem('_esc_done','1');

  const url=location.href;
  const isIOS    =/iPhone|iPad|iPod/i.test(ua);
  const isAndroid=/Android/i.test(ua);
  const isKakao  =/KAKAO/i.test(ua);

  function makeDonePage(showBtn){
    var btnHtml=showBtn
      ?'<a href="'+url+'" target="_blank" '
        +'style="display:inline-flex;align-items:center;gap:8px;'
        +'background:#5b8def;color:#fff;border-radius:14px;'
        +'padding:14px 28px;font-size:1rem;font-weight:800;'
        +'text-decoration:none;box-shadow:0 4px 14px rgba(91,141,239,.4);">'
        +'브라우저에서 열기 &#8594;</a>'
      :'<div style="font-size:.84rem;font-weight:800;color:#5b8def;cursor:pointer;" onclick="window.close()">✕ 이 창은 닫아주세요!</div>';
    var ico=showBtn?'🏸':'✅';
    var ttl=showBtn?'브라우저에서 열어주세요':'브라우저에서 열렸어요!';
    var msg=showBtn
      ?'아래 버튼을 눌러<br>Safari 또는 Chrome에서 열어주세요'
      :'콕매치 실시간 현황을<br>브라우저에서 보고 계세요 🏸';
    document.open();
    document.write(
      '<!DOCTYPE html><html lang="ko"><head>'
      +'<meta charset="UTF-8">'
      +'<meta name="viewport" content="width=device-width,initial-scale=1">'
      +'<style>'
      +'*{margin:0;padding:0;box-sizing:border-box;}'
      +'body{font-family:-apple-system,sans-serif;background:#f4f6fb;'
        +'display:flex;flex-direction:column;align-items:center;justify-content:center;'
        +'min-height:100vh;padding:32px;text-align:center;gap:18px;}'
      +'.ico{font-size:3rem;line-height:1;}'
      +'.ttl{font-size:1.2rem;font-weight:900;color:#1e2430;letter-spacing:-.3px;}'
      +'.msg{font-size:.92rem;color:#6b7585;line-height:1.75;}'
      +'</style></head><body>'
      +'<div class="ico">'+ico+'</div>'
      +'<div class="ttl">'+ttl+'</div>'
      +'<div class="msg">'+msg+'</div>'
      +btnHtml
      +'</body></html>'
    );
    document.close();
  }

  if(isIOS && isKakao){
    // 카카오 iOS: 공식 외부브라우저 스킴 자동실행 → 완료화면
    location.href='kakaotalk://web/openExternal?url='+encodeURIComponent(url);
    setTimeout(function(){ makeDonePage(false); }, 300);
  } else if(isAndroid){
    // Android 전체(카카오·밴드·네이버): Chrome intent 자동실행 → 완료화면
    location.href='intent://'+url.replace(/^https?:\/\//,'')
      +'#Intent;scheme=https;package=com.android.chrome;action=android.intent.action.VIEW;end';
    setTimeout(function(){ makeDonePage(false); }, 400);
  } else {
    // 밴드·네이버 등 iOS WKWebView: 자동탈출 불가 → 버튼 제공
    makeDonePage(true);
  }
})();




const params=new URLSearchParams(location.search);
const liveId=(params.get('id')||'').toUpperCase();
const _viewerParamName=(params.get('viewer')||params.get('name')||'').trim();
const _viewerParamMember=(params.get('member')||params.get('memberId')||'').trim();
let liveDb=null;
let _teamRosterSort=localStorage.getItem('kokmatch_live_roster_sort')||'name';
let _teamRosterOpen=false;
let _latestLiveData=null;
let _liveTicker=null;
let _viewerName='';
let _viewerSearchTerm='';

const content=document.getElementById('content');

if(!liveId){
  content.innerHTML='<div class="status">잘못된 링크입니다.<br>대회 ID가 없습니다.</div>';
} else {
  let app, db;
  try{
    app=firebase.initializeApp(FB_CONFIG);
    db=firebase.database();
    liveDb=db;
  }catch(e){
    content.innerHTML='<div class="status">서버 연결에 실패했습니다.<br>잠시 후 다시 시도해주세요.</div>';
  }
  if(db){
    db.ref('live/'+liveId).on('value', snap=>{
      const data=snap.val();
      if(!data){
        content.innerHTML='<div class="status">진행 중인 현황이 없습니다.<br>대회가 아직 시작되지 않았거나 종료되었습니다.</div>';
        _latestLiveData=null;
        return;
      }
      _latestLiveData=data;
      render(_latestLiveData);
      if(!_liveTicker){
        _liveTicker=setInterval(()=>{ if(_latestLiveData) render(_latestLiveData); },30000);
      }
    }, err=>{
      content.innerHTML='<div class="status">데이터를 불러올 수 없습니다.<br>'+esc(err.message)+'</div>';
    });
  }
}

function buildGauge(bW, wW, blueName, whiteName){
  var tot=bW+wW;
  var bShare = tot>0 ? bW/tot : 0.5;
  var cx=150, cy=162, r=100, sw=58;
  var A0=150, A1=390;
  var span=A1-A0;
  function pt(deg, rad){ var a=deg*Math.PI/180; return [cx+rad*Math.cos(a), cy+rad*Math.sin(a)]; }
  function arcPath(d0, d1, rad){ var p0=pt(d0,rad), p1=pt(d1,rad); var large=(d1-d0)>180?1:0; return "M "+p0[0].toFixed(1)+" "+p0[1].toFixed(1)+" A "+rad+" "+rad+" 0 "+large+" 1 "+p1[0].toFixed(1)+" "+p1[1].toFixed(1); }
  var boundary=A0+span*bShare;
  var ticks='';
  var nT=16;
  for(var t=0;t<=nT;t++){ var td=A0+span*(t/nT); var o=pt(td,r+sw/2-2), i2=pt(td,r-sw/2+2); ticks+='<line x1="'+o[0].toFixed(1)+'" y1="'+o[1].toFixed(1)+'" x2="'+i2[0].toFixed(1)+'" y2="'+i2[1].toFixed(1)+'" stroke="var(--bg)" stroke-width="3.5"/>'; }
  var bluePart = tot>0 && bW>0 ? arcPath(A0, boundary, r) : "";
  var redPart = tot>0 && wW>0 ? arcPath(boundary, A1, r) : "";
  var fullPart = arcPath(A0, A1, r);
  var needleLen = r+sw/2+4;
  var settleDeg = boundary - 270;
  var svg='<svg class="gauge-svg" viewBox="0 0 300 285" xmlns="http://www.w3.org/2000/svg">'
    +'<defs>'
    +'<linearGradient id="gBlue" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#aac6f7"/><stop offset="45%" stop-color="#5b8def"/><stop offset="100%" stop-color="#1f47a0"/></linearGradient>'
    +'<linearGradient id="gRed" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#f9b3af"/><stop offset="45%" stop-color="#ea5b55"/><stop offset="100%" stop-color="#a81f1a"/></linearGradient>'
    +'<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
    +'</defs>'
    +'<path d="'+fullPart+'" fill="none" stroke="var(--sur2)" stroke-width="'+sw+'" stroke-linecap="butt"/>'
    +(bluePart? '<path d="'+bluePart+'" fill="none" stroke="url(#gBlue)" stroke-width="'+sw+'" stroke-linecap="butt" opacity="0.22" filter="url(#glow)"/>':'')
    +(redPart? '<path d="'+redPart+'" fill="none" stroke="url(#gRed)" stroke-width="'+sw+'" stroke-linecap="butt" opacity="0.22" filter="url(#glow)"/>':'')
    +(bluePart? '<path class="gauge-arc" d="'+bluePart+'" fill="none" stroke="url(#gBlue)" stroke-width="'+sw+'" stroke-linecap="butt"/>':'')
    +(redPart? '<path class="gauge-arc" d="'+redPart+'" fill="none" stroke="url(#gRed)" stroke-width="'+sw+'" stroke-linecap="butt"/>':'')
    +ticks
    +'<text x="150" y="154" text-anchor="middle" font-size="58" font-weight="900" letter-spacing="-2">'
      +'<tspan fill="#2f5fc0">'+bW+'</tspan>'
      +'<tspan fill="var(--dim2)" font-size="34" dx="4" dy="-3"> : </tspan>'
      +'<tspan fill="#d3332e" dy="3">'+wW+'</tspan>'
    +'</text>'
    +'<text x="150" y="183" text-anchor="middle" font-size="12" font-weight="700" fill="var(--dim2)" letter-spacing="3">VS</text>'
    +'<g class="needle-grp" id="needleGrp" style="transform-origin:150px 162px;">'
    +'<line x1="150" y1="162" x2="150" y2="'+(162-needleLen).toFixed(1)+'" stroke="#9aa1ad" stroke-width="4.5" stroke-linecap="round"/>'
    +'<line x1="150" y1="162" x2="150" y2="178" stroke="#c2c8d2" stroke-width="4.5" stroke-linecap="round"/>'
    +'</g>'
    +'<circle cx="150" cy="162" r="11" fill="#9aa1ad"/><circle cx="150" cy="162" r="5" fill="var(--sur)"/>'
    +'</svg>';
  setTimeout(function(){ var g=document.getElementById("needleGrp"); if(!g) return;
    var seq=[ -60, 50, -40, 30, -18, 10, 0 ]; var idx=0;
    function step(){ if(idx>=seq.length){ g.style.transition="transform .55s cubic-bezier(.34,1.45,.6,1)"; g.style.transform="rotate("+settleDeg+"deg)"; return; }
      g.style.transition="transform .15s ease-in-out"; g.style.transform="rotate("+seq[idx]+"deg)"; idx++; setTimeout(step,150); }
    step();
  }, 150);
  return '<div class="gauge-wrap" id="scoreBoard">'+svg+'</div>';
}

function buildStreaks(matches){
  const ordered=[...matches].filter(m=>m.win).sort((a,b)=>(a.round-b.round)||(a.court-b.court));
  const streak={};
  ordered.forEach(m=>{
    const winners=m.win==='t1'?[m.t1[0],m.t1[1]]:[m.t2[0],m.t2[1]];
    const losers=m.win==='t1'?[m.t2[0],m.t2[1]]:[m.t1[0],m.t1[1]];
    winners.forEach(n=>{ if(n)streak[n]=(streak[n]||0)+1; });
    losers.forEach(n=>{ if(n)streak[n]=0; });
  });
  const hot=Object.entries(streak).filter(([n,c])=>c>=2).sort((a,b)=>b[1]-a[1]);
  if(!hot.length) return '';
  let html='<div class="streak-box">';
  hot.forEach(([n,c])=>{
    const isHot=c>=3;
    html+='<span class="streak-chip'+(isHot?' streak-hot':'')+'"><span class="streak-fire">🔥</span>'+esc(n)+' <span class="streak-n">'+c+'연승</span></span>';
  });
  html+='</div>';
  return html;
}

/* AI 브리핑: 청/홍팀 현황 요약 */
/* 명언 + 팀 한마디 */
// ── 호칭 유틸 ──
let _gMap = {};

// 성 제거: 3글자면 첫 1글자(성) 제거
function _firstName(name){
  return (name&&name.length>=3)?name.slice(1):(name||'');
}
// 받침 유무
function _hasBatchim(str){
  if(!str) return false;
  const c=str.charCodeAt(str.length-1);
  return c>=0xAC00&&c<=0xD7A3&&(c-0xAC00)%28!==0;
}
// 호칭 문자열: "재관 오빠", "은하 언니", "미라 언니"
// 관전자 성별 전역 변수 (렌더 시마다 랜덤)
// 'F': 여성 → 오빠/언니  |  'M': 남성 → 형/누나
let _viewerGender='F';
function _randomizeViewerGender(){ _viewerGender=Math.random()<0.5?'M':'F'; }

function _hn(name){
  if(!name) return '';
  const g=_gMap[name];
  if(g!=='M'&&g!=='F') return name;
  const fn=_firstName(name);
  const title=_viewerGender==='M'
    ?(g==='M'?'형':'누나')
    :(g==='M'?'오빠':'언니');
  return `${fn} ${title}`;
}
// 호칭+조사: josa='이/가','은/는','을/를','이/'
function _hnJ(name, josa){
  const h=_hn(name);
  if(!h) return '';
  const last=h.slice(-1);
  const code=last.charCodeAt(0);
  const batchim=(code>=0xAC00&&code<=0xD7A3)?(code-0xAC00)%28:0;
  const map={'이/가':batchim?'이':'가','은/는':batchim?'은':'는','을/를':batchim?'을':'를','이/':batchim?'이':''};
  return h+(map[josa]||josa);
}

// ── 명언 / 오만방자 (이름 플레이스홀더 포함) ──
// {HA}=호칭포함 에이스, {HB}=호칭포함 상대, {HW}=호칭포함 최근승자
// {A}/{B}/{W}=이름만, {HA}/{HB}/{HW}=이름+호칭
const _QUOTES=[
  /* 승부욕 자극 — 이름 없는 */
  {t:'지금 이기고 있는 자, 방심은 패배의 시작이다.'},
  {t:'강한 자가 이기는 게 아니라, 이기는 자가 강한 거다.'},
  {t:'이미 이겼다고 생각하는 팀이 결국 진다.'},
  {t:'버티는 자가 결국 이긴다. 먼저 포기하면 지는 거다.'},
  {t:'코트 위의 1초는 다른 어떤 1초와도 다르다.'},
  /* 승부욕 자극 — 호칭 포함 */
  {t:'{HA}! 지금 이 순간이 바로 승부처야.',n:1},
  {t:'{HA} 대 {HB} — 오늘 이 매치 눈 떼지 마.',n:2},
  {t:'{HW}의 연승, 이대로 막을 자 있나?',n:'w'},
  {t:'{HA}, 지금 실력 다 꺼내놔. 오늘이 바로 그날이야.',n:1},
  {t:'{HB}가 버티는 한, {HA}의 진짜 실력이 나온다.',n:2},
  {t:'{HW} 앞에서 무너지면 오늘 집에 가서 잠이 오겠어?',n:'w'},
  {t:'{HA}, 지금 너만 믿는다. 팀 전체가.',n:1},
  /* 오만방자 — 이름 없는 */
  {t:'죄송합니다, 오늘 실력 낭비 좀 하겠습니다.'},
  {t:'적당히 봐드리고 싶은데, 그게 제 성격이 아니라서요.'},
  {t:'열심히 하셔서 좋아요. 근데 결과는 제가 가져갑니다.'},
  {t:'혹시 이기면 연락주세요. 제가 배운 게 없는 거니까.'},
  {t:'이기는 게 당연한 사람한테 집중력은 덤이에요.'},
  /* 오만방자 — 호칭 포함 */
  {t:'{HA}, 오늘 저 좀 고생시켜줄 수 있어? 너무 편해서.',n:1},
  {t:'{HB}, 열심히 하는 거 맞지? 제 눈엔 잘 안 보여서.',n:2},
  {t:'{HW}한테 지는 날엔 그냥 오늘 운이 없었다고 해.',n:'w'},
  {t:'{HA}, 저 오늘 컨디션이 너무 좋은 게 문제야.',n:1},
  {t:'{HB}는 잘 할수록 내가 더 집중하게 돼서 고마워.',n:2},
  {t:'{HW} 오늘 진짜 잘 치네. 그래서 이기고 있는 거잖아.',n:'w'},
  {t:'{HA}, 오늘 나한테 이기는 게 목표야? 목표는 좋아.',n:1},
  {t:'{HB}한테 지는 날엔 나도 할 말 없지. 근데 그럴 일은 없을 것 같고.',n:2},
  {t:'{HW} 연승 중이라는데... 오늘 멈춰드릴게요.',n:'w'},
  {t:'{HA} 실력이면 오늘 우리 팀이 지는 게 더 이상하지.',n:1},
  {t:'{HB}, 혹시 나 봐주는 거야? 아니면 원래 이 정도야?',n:2},
];

function _fillQuote(q, players){
  if(!q.n) return q.t;
  let t=q.t;
  const p=players||{};
  // 조사 포함 변형 먼저 처리
  if(p.ha) t=t.replace(/\{HA\}/g, p.ha);
  if(p.hb) t=t.replace(/\{HB\}/g, p.hb);
  if(p.hw) t=t.replace(/\{HW\}/g, p.hw);
  if(p.a)  t=t.replace(/\{A\}/g,  p.a);
  if(p.b)  t=t.replace(/\{B\}/g,  p.b);
  if(p.w)  t=t.replace(/\{W\}/g,  p.w);
  if(/\{H?[ABWN]+\}/.test(t)) return q.t.replace(/\{H?[ABWNn]+\}/g,'그 선수');
  return t;
}
// 출처: 관전자 성별(M/F) 기반으로 분기
const _SRCS_NF=['익명의 미녀','코트의 철학자','셔틀콕 도사','배드민턴 클럽 현자','연습벌레의 고백'];
const _SRCS_NM=['익명의 형','코트의 철학자','셔틀콕 도사','배드민턴 클럽 아저씨','열혈 배드민턴 팬'];
const _SRCS_AF=['익명의 미녀','어느 여왕의 속삭임','승자의 여유','여기서 제일 잘하는 사람',
  '이미 이긴 사람','오늘의 MVP (자칭)','코트의 지배자','우아하게 이기는 법을 아는 자'];
const _SRCS_AM=['익명의 형','코트 위의 왕자','승자의 여유','여기서 제일 잘하는 사람',
  '이미 이긴 사람','오늘의 MVP (자칭)','코트의 지배자','이미 해본 사람'];
function _getQuote(matches, players){
  const done=matches.filter(m=>m.win).length;
  const q=_QUOTES[(done+Math.floor(Date.now()/300000))%_QUOTES.length];
  const filled=_fillQuote(q, players||{});
  // 오만방자 계열은 미녀/여왕 출처, 승부욕 계열은 다른 출처
  const isArrogant=q.t.includes('편해서')||q.t.includes('안 보여서')||
    q.t.includes('컨디션')||q.t.includes('봐주는')||q.t.includes('집중하게')||
    q.t.includes('결과는 제가')||q.t.includes('성격이 아니라서')||q.t.includes('멈춰드릴게요');
  const isM2=_viewerGender==='M';
  const srcs=isArrogant?(isM2?_SRCS_AM:_SRCS_AF):(isM2?_SRCS_NM:_SRCS_NF);
  const src=srcs[(done+Math.floor(Date.now()/180000))%srcs.length];
  return {t:filled, src};
}

// ── 팀 한마디: 청팀/홍팀 응원단 ──
function _getTeamLine(team,diff,rec,top,curPlayers){
  const HT=top?_hn(top):null;
  const PP=curPlayers&&curPlayers.length
    ?curPlayers[Math.floor(Date.now()/400000)%curPlayers.length]:null;
  const HP=PP?_hn(PP):null;
  const isM=_viewerGender==='M';
  const _bucket=diff>0?'ahead':diff<0?'behind':'even';
  const _idx=Math.floor(Date.now()/600000);

  if(team==='blue'){
    // 여성 관전자용 청팀 응원단
    const linesF={
      ahead:[
        HT?`${_hn(top)} 오늘 진짜 대박이에요!! 이 기세 절대 놓치면 안 돼요! 💙`
          :`청팀 지금 너무 잘하고 있어요!! 이대로만 해줘요! 💙`,
        HP?`${_hn(PP)} 뛰는 거 봤어요?! 오늘 완전 빛나고 있어요!! 화이팅!! 🎉`
          :`청팀 파이팅!! 지금 이 흐름 절대 놓치면 안 돼요! 🙏`,
        HT?`${HT}!! 청팀 전원 믿어요! 오늘 이길 수 있어요!! ✨`
          :`청팀 최고예요!! 지금 이대로 쭉 가줘요!! 💪`,
        `저 지금 너무 두근두근해요!! 청팀 이거 다 이길 수 있어요!! 🫶`,
        HP?`${_hn(PP)} 오늘 완전 주인공이에요!! 청팀 화이팅!! 🌟`
          :`청팀 지금 진짜 무섭다고요!! 이 기세 절대 끊지 마요!! 🔥`,
        `셔틀콕이 청팀 편이에요!! 믿어요 진짜!! 💙`,
        HT?`${HT}!! 저 지금 소름 돋았어요!! 청팀 최고!! 🫶`
          :`어머 청팀 너무 잘한다!! 이대로 끝내줘요!! ✨`,
      ],
      behind:[
        HT?`${HT}!! 아직 안 끝났어요!! 역전하면 제가 치킨 사드릴게요!! 🍗`
          :`청팀 힘내요!! 아직 할 수 있어요!! 포기만 하지 않으면 돼요!! 💙`,
        HP?`${_hn(PP)} 이 경기 꼭 잡아줘요!! 청팀 다 같이 믿고 있어요!! 🙏`
          :`청팀 파이팅!! 한 게임씩 따라잡아요!! 할 수 있어요!! 💪`,
        `지금 점수는 의미 없어요!! 청팀은 항상 후반에 강해요!! (믿어요) 💙`,
        HT?`${_hn(top)} 믿어요!! 역전 드라마 제발 써줘요!! 손이 떨려요!! ✨`
          :`청팀 절대 무너지면 안 돼요!! 우리 응원하잖아요!! 💙`,
        `뒤처져도 괜찮아요!! 청팀이 뒤집으면 더 짜릿하잖아요!! 🎉`,
        HP?`${_hn(PP)} 지금 제일 믿음직스러워 보여요!! 청팀 갑시다!! 🔥`
          :`아직 3게임이나 남았잖아요!! 청팀 지금부터가 진짜예요!! 💪`,
      ],
      even:[
        HT?`${HT}!! 지금 이 동점 반드시 뒤집어줘요!! 할 수 있어요!! 🎯`
          :`동점이에요!! 지금 청팀이 더 강하다는 거 보여줄 시간이에요!! 💙`,
        HP?`${_hn(PP)} 이번 경기 꼭 가져와줘요!! 청팀 파이팅!! 🔥`
          :`지금 딱 한 방이에요!! 청팀 같이 해요!! 화이팅!! 💪`,
        `팽팽해요!! 이럴 때 청팀이 더 강하잖아요!! 믿어요!! 🎉`,
        `동점이면 청팀 유리예요!! 왜냐면 제가 응원하고 있으니까요!! 💙😤`,
        HT?`${HT}!! 지금 눈빛이 달라요!! 청팀 이 게임 무조건 가져가요!! 🌟`
          :`동점 상황에서 청팀 더 강해지는 거 알죠?! 지금 증명해줘요!! 🏸`,
      ]
    };
    // 남성 관전자용 청팀 응원단
    const linesM={
      ahead:[
        HT?`${_hn(top)} 오늘 완전 장난 없네!! 이 기세 죽이지 마!! 💪`
          :`청팀 지금 제대로 가고 있어!! 이대로 밀어붙여!! 💙`,
        HP?`와 ${HP}!! 오늘 진짜 잘한다!! 청팀 화이팅!! 🔥`
          :`청팀 지금 최고야!! 이 흐름 절대 놓치지 마!! 💪`,
        HT?`${HT}!! 청팀 전원 믿는다!! 오늘 우리 이긴다!! 💙`
          :`청팀 최고!! 지금 이대로 끝까지 가자!! 🔥`,
        `야 청팀 지금 너무 잘하는 거 아니야?! 이거 실화냐!! 😤`,
        HP?`${_hn(PP)} 오늘 완전 날아다니네!! 청팀 이거 잡자!! 🏸`
          :`청팀 지금 코트 완전 장악했다!! 이대로 끝내!! 💪`,
        `저도 저렇게 칠 수 있는데... (못 침) 청팀 파이팅!! 😂`,
        HT?`${HT}!! 오늘 MVP 각이다!! 청팀 힘내라!! 🌟`
          :`청팀 지금 상대가 벌벌 떨고 있을걸?! 계속 밀어붙여!! 😈`,
      ],
      behind:[
        HT?`${HT}!! 아직 안 끝났다!! 역전하면 내가 뭐라도 쏜다!! 🍺`
          :`청팀 힘내!! 아직 할 수 있어!! 포기만 하지 마!! 💙`,
        HP?`${_hn(PP)} 이 경기 꼭 가져와!! 청팀 다 같이 믿는다!! 💪`
          :`청팀 파이팅!! 한 게임씩 따라잡자!! 할 수 있어!! 🔥`,
        `점수 따위는 신경 쓰지 마!! 청팀은 원래 뒤에서 더 강해!! (ㄹ?) 💙`,
        HT?`${_hn(top)} 믿는다!! 역전 드라마 써줘!! 나 지금 손바닥 다 땀났어!! 💙`
          :`청팀 절대 무너지면 안 돼!! 끝까지 간다!! 💪`,
        `와 이거 역전하면 전설이다 전설!! 청팀 가자!! 🔥`,
        HP?`${_hn(PP)} 지금 제일 믿음직해!! 청팀 이 게임 잡자!! 😤`
          :`아직 경기 남았다!! 청팀 지금부터가 진짜다!! 💪`,
      ],
      even:[
        HT?`${HT}!! 동점 이대로 뒤집어버려!! 청팀 할 수 있다!! 🎯`
          :`동점이야!! 지금 청팀이 더 강하다는 거 보여줘!! 💙`,
        HP?`${_hn(PP)} 이번 경기 반드시 가져와!! 청팀 파이팅!! 🔥`
          :`지금 딱 한 방이야!! 청팀 같이 가자!! 화이팅!! 💪`,
        `팽팽해!! 청팀이 한 발 더 나가줘!! 다 같이 응원한다!! 🎉`,
        `동점이면 실력차 없다는 거 알지?! 그럼 청팀이 멘탈로 이기는 거야!! 😤`,
        HT?`${HT}!! 지금 눈빛이 달라!! 이 게임 무조건 청팀이다!! 🌟`
          :`동점 상황에서 청팀 더 강한 거 몰라?! 지금 증명해줘!! 🏸`,
      ]
    };
    const _tl=isM?linesM:linesF;
    return _tl[_bucket][_idx%_tl[_bucket].length];
  }

  // 홍팀 응원단 — 강렬 + 유머
  const lines={
    ahead:[
      HT?`${_hn(top)} 흔들리지 않는 한 홍팀은 이 경기 잡는다. 안 흔들린다.`
        :`리드는 리드일 뿐. 끝까지 집중해서 반드시 마무리 짓는다.`,
      HP?`${HP}, 오늘 네 이름이 기억될 거야. 계속 이대로 가자.`
        :`홍팀의 기세, 오늘 꺾이지 않는다. 끝까지 간다.`,
      HT?`${_hn(top)} 앞서는 홍팀 — 오늘 승리는 우리 것이다.`
        :`오늘 승리는 이미 정해졌다. 집중만 잃지 않으면 된다.`,
      `홍팀 지금 리드 중. 청팀이 쫓아오긴 하는데... 역부족이야. 😏`  ,
      HP?`${HP} 오늘 코트 완전 장악이다. 이 기세 절대 죽이지 마.`
        :`홍팀 지금 이 경기 완전히 장악했다. 끝내자.`,
      HT?`${_hn(top)} 오늘 MVP 각이다. 홍팀 이대로 쭉 가자. 🔴`
        :`앞서 있을 때 더 집중하는 게 진짜 강팀이다. 홍팀 바로 그거야.`,
      `청팀 따라오려고 열심히 하는 거 보이는데... 홍팀이 더 빠르다. 😎`,
    ],
    behind:[
      HT?`${HT}! 지금 네가 나서야 할 때야. 홍팀은 아직 안 끝났다.`
        :`뒤집어야 한다. 지금 당장. 홍팀 전원 집중.`,
      HP?`${_hn(PP)} 코트에 있는 한, 홍팀은 끝나지 않았다. 믿는다.`
        :`이 상황이 오히려 편하다. 잃을 게 없다. 맘껏 뒤집자.`,
      HT?`${_hn(top)} 중심으로 홍팀 역전 드라마 지금 시작한다.`
        :`홍팀의 역전 드라마, 지금 시작한다. 모두 집결.`,
      `뒤처진다고? 홍팀이 원래 이러다 뒤집는다. 지켜봐. 😤`,
      HP?`${HP} 지금 이 경기 네가 바꿔야 한다. 믿는다.`
        :`지금 이 상황, 솔직히 역전하면 더 짜릿하잖아? 홍팀 가자. 🔥`,
      HT?`${_hn(top)} 아직 살아있다. 홍팀 전원 총력전. 지금이다.`
        :`청팀이 웃고 있겠지. 근데 홍팀 역전 이미 시작됐다.`,
      `뒤집으면 전설이다. 홍팀, 오늘 전설 쓰자. 🔴`,
    ],
    even:[
      HT?`${_hn(top)} 실력, 동점 상황에서 빛난다. 지금이 진짜 승부처다.`
        :`동점 상황, 홍팀이 더 강하다는 거 보여줄 시간이다.`,
      HP?`${HP}, 지금 한 방이 전부를 바꾼다. 믿고 간다.`
        :`타이. 지금부터 진짜 시작이다.`,
      `빡빡하게 가자. 한 점 한 점이 전부다.`,
      `동점이면 결국 멘탈 싸움이다. 홍팀 멘탈은 강철이다. 😤`,
      `청팀이랑 똑같다고? 홍팀이 한 끗 더 있다. 지금 보여주자. 🔴`,
      HT?`${_hn(top)} 동점 상황에서 진짜 에이스는 달라진다. 지금 증명해.`
        :`동점 이후 홍팀이 더 강했다는 거 오늘 또 증명한다.`,
      HP?`${HP} 지금 표정 봐. 이미 이길 각 나와있다. 믿고 간다. 🔴`
        :`빡세게 가자. 이 게임 반드시 홍팀 것이다.`,
    ]
  };
  return lines[_bucket][_idx%lines[_bucket].length];
}


// ── 경기 타이틀 자동 생성 ──
function _matchTitle(type, t1, t2){
  const gof=(names)=>names.map(n=>_gMap[n]).filter(Boolean);
  const g1=gof(t1), g2=gof(t2);
  const allM=[...g1,...g2].every(g=>g==='M');
  const allF=[...g1,...g2].every(g=>g==='F');
  if(type==='남복'||allM){
    const titles=['오빠들의 남복 한판 승부 ⚡','남자들의 자존심 대결 💪','형들의 스매시 배틀 🔥'];
    return titles[Math.floor(Date.now()/700000)%titles.length];
  }
  if(type==='여복'||allF){
    const titles=['언니들의 여복 자존심 대결 👑','언니들이 진짜다 🌟','여왕의 코트에 오신 걸 환영해요 💅'];
    return titles[Math.floor(Date.now()/700000)%titles.length];
  }
  // 혼복
  const titles=['오빠+언니 혼복 최강자 결정전 🏸','혼복 케미 대결 — 누가 더 잘 맞나? ✨','팀 케미스트리 총력전 💥'];
  return titles[Math.floor(Date.now()/700000)%titles.length];
}

// ── 최근 완료 경기 리액션 ──
function _lastMatchReaction(matches, bNames, rNames){
  const done=[...matches].filter(m=>m.win).sort((a,b)=>(b.round-a.round)||(b.court-a.court));
  if(!done.length) return '';
  const m=done[0];
  const winners=m.win==='t1'?[m.t1[0],m.t1[1]]:[m.t2[0],m.t2[1]];
  const losers =m.win==='t1'?[m.t2[0],m.t2[1]]:[m.t1[0],m.t1[1]];
  const wHn=winners.filter(Boolean).map(_hn).join(', ');
  const lHn=losers.filter(Boolean).map(_hn).join(', ');
  const pool=[
    `방금 ${wHn} 팀 승리 확정! 역시 이분들이에요. 👏`,
    `${wHn} 조합, 오늘 완전 못 잡겠는데요. 🔥`,
    `방금 경기 보셨죠? ${wHn} 팀 이게 진짜 실력이에요.`,
    `${wHn} 승리!! ${lHn} 다음 경기에서 꼭 설욕해요!`,
    `${lHn}... 이번엔 아쉬웠지만 다음이 있어요. 힘내요! 💙`,
    `${wHn} 팀 오늘 진짜 잘하네요. ${lHn} 다음에 갚아줘요!`,
  ];
  return pool[Math.floor(Date.now()/450000)%pool.length];
}

// ── 연승 중인 선수 특별 언급 ──
function _streakComment(matches, bNames, rNames){
  const winCount={};
  [...matches].filter(m=>m.win).sort((a,b)=>(a.round-b.round)).forEach(m=>{
    const W=m.win==='t1'?[m.t1[0],m.t1[1]]:[m.t2[0],m.t2[1]];
    const L=m.win==='t1'?[m.t2[0],m.t2[1]]:[m.t1[0],m.t1[1]];
    W.forEach(n=>{ if(n) winCount[n]=(winCount[n]||0)+1; });
    L.forEach(n=>{ if(n) winCount[n]=0; });
  });
  const streakers=Object.entries(winCount).filter(([,c])=>c>=3).sort((a,b)=>b[1]-a[1]);
  if(!streakers.length) return '';
  const [name,cnt]=streakers[0];
  const hn=_hn(name);
  const hnJ=_hn(name);
  const msgs=[
    `🔥 ${hnJ} ${cnt}연승 중! 지금 건드리면 다쳐요.`,
    `${hn} ${cnt}연승 행진... 오늘 이분 막을 수 있는 사람 있나요? 😮`,
    `${cnt}연승 중인 ${hn}, 지금 완전 물오른 상태예요. 상대팀 긴장해요! 🔥`,
    `${hnJ} ${cnt}번 연속 승리 중입니다. 이거 실화예요?! 🏆`,
    `오늘 ${hn} 진짜 못 잡겠는데요. ${cnt}연승이에요!`,
  ];
  return msgs[Math.floor(Date.now()/550000)%msgs.length];
}

function buildBriefing(matches, d){
  if(!d.isTeam) return '';
  const bW=d.blueWins||0, wW=d.whiteWins||0;
  const total=bW+wW;
  const bn=esc(d.teamBlue||'청팀'), wn=esc(d.teamWhite||'홍팀');
  if(total===0) return '';

  // members 파싱 + genderMap 빌드
  const members=d.members||{};
  const bMemberObjs=(members.blue||[]).map(x=>typeof x==='string'?{n:x}:x);
  const rMemberObjs=(members.red||[]).map(x=>typeof x==='string'?{n:x}:x);
  _gMap={};
  [...bMemberObjs,...rMemberObjs].forEach(x=>{ if(x.n&&x.g) _gMap[x.n]=x.g; });
  const bNames=new Set(bMemberObjs.map(x=>x.n));
  const rNames=new Set(rMemberObjs.map(x=>x.n));

  // 진행 중 라운드 출전 선수
  const curRound=d.currentRound||0;
  const curMatches=matches.filter(m=>m.round===curRound&&!m.win);
  const curBlue=[], curRed=[];
  curMatches.forEach(m=>{
    [m.t1[0],m.t1[1]].forEach(n=>{ if(n&&bNames.has(n)&&!curBlue.includes(n))curBlue.push(n); });
    [m.t2[0],m.t2[1]].forEach(n=>{ if(n&&rNames.has(n)&&!curRed.includes(n))curRed.push(n); });
    [m.t1[0],m.t1[1]].forEach(n=>{ if(n&&rNames.has(n)&&!curRed.includes(n))curRed.push(n); });
    [m.t2[0],m.t2[1]].forEach(n=>{ if(n&&bNames.has(n)&&!curBlue.includes(n))curBlue.push(n); });
  });

  // 최근 승자
  const recentWin=[...matches].filter(m=>m.win).sort((a,b)=>(b.round-a.round)||(b.court-a.court));
  const lastWinMatch=recentWin[0];
  const lastWinner=lastWinMatch
    ?(lastWinMatch.win==='t1'?[lastWinMatch.t1[0],lastWinMatch.t1[1]]:[lastWinMatch.t2[0],lastWinMatch.t2[1]])
    :[];

  // 팀별 승/패 집계
  const bPlayers={}, rPlayers={};
  matches.filter(m=>m.win).forEach(m=>{
    const winners=m.win==='t1'?[m.t1[0],m.t1[1]]:[m.t2[0],m.t2[1]];
    const losers =m.win==='t1'?[m.t2[0],m.t2[1]]:[m.t1[0],m.t1[1]];
    [...winners,...losers].forEach((n,i)=>{
      const isWin=i<2;
      const tgt=bNames.has(n)?bPlayers:rPlayers;
      if(!tgt[n])tgt[n]={w:0,l:0};
      isWin?tgt[n].w++:tgt[n].l++;
    });
  });
  const topPlayer=stat=>{
    const arr=Object.entries(stat).filter(([,s])=>s.w>0).sort((a,b)=>b[1].w-a[1].w||a[1].l-b[1].l);
    return arr.length?{name:arr[0][0],...arr[0][1]}:null;
  };
  const bTop=topPlayer(bPlayers), rTop=topPlayer(rPlayers);

  // 최근 흐름
  const recent=[...matches].filter(m=>m.win).sort((a,b)=>(b.round-a.round)||(b.court-a.court)).slice(0,5);
  let bRec=0,rRec=0;
  recent.forEach(m=>{
    const isT1blue=bNames.has(m.t1[0])||bNames.has(m.t1[1]);
    const winner=m.win==='t1'?isT1blue:!isT1blue;
    winner?bRec++:rRec++;
  });

  const gap=Math.abs(bW-wW);
  let situation='';
  if(bW>wW) situation=`<b class="brief-b">${bn}</b> ${gap}승 앞서는 중`;
  else if(wW>bW) situation=`<b class="brief-r">${wn}</b> ${gap}승 앞서는 중`;
  else situation='동점 팽팽';

  const momentum=bRec>rRec?`<b class="brief-b">${bn}</b> 최근 흐름 우세`
    :rRec>bRec?`<b class="brief-r">${wn}</b> 최근 흐름 우세`:'양팀 팽팽히 맞서는 중';

  let bLine=`${bn} ${bW}승 ${wW>bW?'(추격 중)':bW>wW?'(선두)':'(동점)'}`;
  let rLine=`${wn} ${wW}승 ${bW>wW?'(추격 중)':wW>bW?'(선두)':'(동점)'}`;
   if(bTop) bLine+=` 🏅 ${bTop.name} ${bTop.w}승`;
   if(rTop) rLine+=` 🏅 ${rTop.name} ${rTop.w}승`;

  const bDiff=bW-wW, rDiff=wW-bW;
  const _qpB=bTop?bTop.name:(curBlue.length?curBlue[0]:null);
  const _qpR=rTop?rTop.name:(curRed.length?curRed[0]:null);
  const _qpW=lastWinner.length?lastWinner[0]:null;
  const qPlayers={
    a:_qpB, b:_qpR, w:_qpW,
    ha:_qpB?_hn(_qpB):null,
    hb:_qpR?_hn(_qpR):null,
    hw:_qpW?_hn(_qpW):null,

  };
  // 진행 중 선수 중 에이스 우선, 없으면 curPlayers 중 승수 가장 많은 선수
  const _curTop=(curList, topName)=>{
    if(topName && curList.includes(topName)) return topName; // 에이스가 현재 뛰는 중
    // 진행 중 선수 중 에이스가 없으면 curList 자체를 top으로 사용 (PP에서 선택)
    return null;
  };
  const bSay=_getTeamLine('blue',bDiff,bRec,_curTop(curBlue,bTop?bTop.name:null),curBlue);
  const rSay=_getTeamLine('red',rDiff,rRec,_curTop(curRed,rTop?rTop.name:null),curRed);

  // 연승 코멘트
  const streak=_streakComment(matches, bNames, rNames);

  // 최근 경기 리액션
  const reaction=_lastMatchReaction(matches, bNames, rNames);

  // 브리핑 조합
  const extras=[streak, reaction].filter(Boolean);
  const extraHtml=extras.length
    ?'<div class="brief-extras">'+extras.map(e=>'<div class="brief-extra">'+e+'</div>').join('')+'</div>'
    :'';

  // 응원단 메시지 전역 저장 (라운드 렌더링 시 DOM 의존 없이 직접 참조)
  window._cheerBSay  = bSay  || '';
  window._cheerRSay  = rSay  || '';
  window._cheerTeamB = d.teamBlue  || '청팀';
  window._cheerTeamW = d.teamWhite || '홍팀';
  return '<div class="briefing">'
    +'<div class="brief-title">📢 지금 현황</div>'
    +'<div class="brief-situation">'+situation+'</div>'
    +'<div class="brief-row brief-row-b"><span class="brief-dot-b">●</span>'+bLine+'</div>'
    +'<div class="brief-row brief-row-r"><span class="brief-dot-r">●</span>'+rLine+'</div>'
    +'<div class="brief-momentum">'+momentum+'</div>'
    +extraHtml
    +'</div>'
}

function collectLivePlayerStats(matches, d){
  const goal=(typeof d.gamesPerPlayer==='number'&&d.gamesPerPlayer>0)?d.gamesPerPlayer:4;
  const stat={}; const played={};
  const ordered=[...matches].sort((a,b)=>(a.round-b.round)||(a.court-b.court));
  ordered.forEach(m=>{
    const four=[m.t1[0],m.t1[1],m.t2[0],m.t2[1]];
    four.forEach(n=>{ if(!n)return; if(!stat[n])stat[n]={name:n,w:0,l:0}; if(played[n]==null)played[n]=0; });
    const within={};
    four.forEach(n=>{ if(!n)return; played[n]++; within[n]=played[n]<=goal; });
    if(!m.win) return;
    const winners=m.win==='t1'?[m.t1[0],m.t1[1]]:[m.t2[0],m.t2[1]];
    const losers=m.win==='t1'?[m.t2[0],m.t2[1]]:[m.t1[0],m.t1[1]];
    winners.forEach(n=>{ if(n&&within[n])stat[n].w++; });
    losers.forEach(n=>{ if(n&&within[n])stat[n].l++; });
  });
  return Object.values(stat).filter(s=>(s.w+s.l)>0);
}

function buildMvpSpotlight(matches, d){
  const arr=collectLivePlayerStats(matches,d);
  if(!arr.length){
    return '<section class="mvp-card mvp-empty" id="mvpBoard">'
      +'<div class="mvp-label">🏆 실시간 MVP</div>'
      +'<div class="mvp-sub">승패가 입력되면 승률 기준으로 자동 표시됩니다.</div>'
      +'</section>';
  }
  const rate=s=>(s.w+s.l)>0?s.w/(s.w+s.l):0;
  const rateStr=s=>(s.w+s.l)>0?Math.round(rate(s)*100)+'%':'—';
  const sameRank=(a,b)=>a&&b&&a.w===b.w&&Math.round(rate(a)*100)===Math.round(rate(b)*100);
  const byRate=[...arr].sort((a,b)=>rate(b)-rate(a)||b.w-a.w||a.l-b.l||a.name.localeCompare(b.name,'ko'));
  const top=byRate[0];
  const mvps=byRate.filter(s=>sameRank(s,top));
  const _solo=mvps.length===1?' solo':'';
  return '<section class="mvp-card live-mvp" id="mvpBoard">'
    +'<div class="mvp-label">🏆 실시간 MVP'+(mvps.length>1?' · 공동 '+mvps.length+'명':'')+'</div>'
    +'<div class="mvp-names">'+mvps.map(s=>'<span class="mvp-chip'+_solo+'">'+esc(s.name)+'</span>').join('')+'</div>'
    +'<div class="mvp-sub">'+top.w+'승 '+top.l+'패 · 승률 '+rateStr(top)+' · 현재 입력된 승패 기준</div>'
    +'</section>';
}

function buildRanking(matches, d){
  const arr=collectLivePlayerStats(matches,d);
  if(arr.length<2) return '';
  const rate=s=>(s.w+s.l)>0?s.w/(s.w+s.l):0;
  const rateStr=s=>(s.w+s.l)>0?Math.round(rate(s)*100)+'%':'—';
  const byWin=[...arr].sort((a,b)=>b.w-a.w||rate(b)-rate(a));
  const sameRank=(a,b)=>a&&b&&a.w===b.w&&Math.round(rate(a)*100)===Math.round(rate(b)*100);
  let html='<div class="rank-box"><div class="rank-title">전적 순위 TOP 5</div>';
  let rankNum=0,prev=null;
  byWin.slice(0,5).forEach((s,i)=>{
    if(prev===null||!sameRank(s,prev))rankNum=i+1; prev=s;
    const medal=rankNum===1?'🥇':rankNum===2?'🥈':rankNum===3?'🥉':rankNum;
    html+='<div class="rank-row'+(rankNum<=3?' top':'')+'">'
      +'<span class="rank-medal">'+medal+'</span>'
      +'<span class="rank-name">'+esc(s.name)+'</span>'
      +'<span class="rank-rec">'+s.w+'승 '+s.l+'패</span>'
      +'<span class="rank-rate">'+rateStr(s)+'</span></div>';
  });
  html+='</div>';
  return html;
}

function buildFinale(matches, d){
  let label='🎉 경기 종료', title='', sub='수고하셨습니다!';
  if(d.isTeam){
    const bW=d.blueWins||0, wW=d.whiteWins||0;
    if(bW>wW){ title='🔵 '+esc(d.teamBlue||'청 팀')+' 우승!'; sub=bW+' : '+wW+' 승리'; }
    else if(wW>bW){ title='🔴 '+esc(d.teamWhite||'홍 팀')+' 우승!'; sub=wW+' : '+bW+' 승리'; }
    else { title='⚖️ 무승부!'; sub=bW+' : '+wW+' 동점'; }
  } else {
    const goal=(typeof d.gamesPerPlayer==='number'&&d.gamesPerPlayer>0)?d.gamesPerPlayer:4;
    const stat={}, played={};
    [...matches].sort((a,b)=>(a.round-b.round)||(a.court-b.court)).forEach(m=>{
      const four=[m.t1[0],m.t1[1],m.t2[0],m.t2[1]];
      four.forEach(n=>{ if(!n)return; if(!stat[n])stat[n]={name:n,w:0,l:0}; if(played[n]==null)played[n]=0; });
      const within={};
      four.forEach(n=>{ if(!n)return; played[n]++; within[n]=played[n]<=goal; });
      if(!m.win)return;
      const W=m.win==='t1'?[m.t1[0],m.t1[1]]:[m.t2[0],m.t2[1]];
      const L=m.win==='t1'?[m.t2[0],m.t2[1]]:[m.t1[0],m.t1[1]];
      W.forEach(n=>{ if(n&&within[n])stat[n].w++; });
      L.forEach(n=>{ if(n&&within[n])stat[n].l++; });
    });
    const arr=Object.values(stat).filter(s=>(s.w+s.l)>0);
    if(arr.length){
      const rate=s=>s.w/(s.w+s.l);
      const byRate=[...arr].sort((a,b)=>rate(b)-rate(a)||b.w-a.w);
      const top=byRate[0];
      const champs=byRate.filter(s=>s.w===top.w&&Math.round(rate(s)*100)===Math.round(rate(top)*100));
      title='🏆 '+champs.map(s=>esc(s.name)).join(' · ')+(champs.length>1?' 공동 우승!':' 우승!');
      sub=top.w+'승 '+top.l+'패 · 승률 '+Math.round(rate(top)*100)+'%';
    } else { title='🏸 모든 경기 완료!'; }
  }
  if(!window._finaleFired){ window._finaleFired=true; setTimeout(fireConfetti, 350); }
  return '<div class="finale"><div class="finale-crown">👑</div>'
    +'<div class="finale-label">'+label+'</div>'
    +'<div class="finale-title">'+title+'</div>'
    +'<div class="finale-sub">'+sub+'</div></div>';
}

function fireConfetti(isRepeat){
  let cv=document.getElementById('confetti');
  if(!cv){ cv=document.createElement('canvas'); cv.id='confetti'; document.body.appendChild(cv); }
  const ctx=cv.getContext('2d');
  const dpr=window.devicePixelRatio||1;
  cv.width=innerWidth*dpr; cv.height=innerHeight*dpr;
  const colors=['#fbbf24','#f59e0b','#ef4444','#ec4899','#8b5cf6','#6366f1','#22c55e','#3b82f6'];
  const N=200, parts=[];
  for(let i=0;i<N;i++){
    parts.push({ x:innerWidth*(.2+Math.random()*.6)*dpr, y:-20*dpr,
      vx:(Math.random()-.5)*5*dpr, vy:(2+Math.random()*4)*dpr, g:.12*dpr,
      w:(6+Math.random()*6)*dpr, h:(8+Math.random()*8)*dpr,
      rot:Math.random()*Math.PI, vr:(Math.random()-.5)*.3,
      c:colors[(Math.random()*colors.length)|0], life:0, max:120+Math.random()*60 });
  }
  let frame=0;
  function tick(){
    ctx.clearRect(0,0,cv.width,cv.height); let alive=false;
    parts.forEach(p=>{ if(p.life>p.max)return; alive=true;
      p.life++; p.vy+=p.g; p.x+=p.vx; p.y+=p.vy; p.rot+=p.vr;
      const a=Math.max(0,1-(p.life/p.max));
      ctx.save(); ctx.globalAlpha=a; ctx.translate(p.x,p.y); ctx.rotate(p.rot);
      ctx.fillStyle=p.c; ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h); ctx.restore(); });
    frame++;
    if(alive&&frame<520) requestAnimationFrame(tick); // 2배 길게
    else {
      ctx.clearRect(0,0,cv.width,cv.height);
      // 4초 후 한 번 더 발사
      if(!isRepeat) setTimeout(()=>fireConfetti(true), 4000);
    }
  }
  requestAnimationFrame(tick);
}

function liveTeamLabel(d, side){
  if(!d.isTeam) return side==='blue'?'1팀':'2팀';
  return side==='blue'?(d.teamBlue||'청팀'):(d.teamWhite||'홍팀');
}

function formatUpdatedAgo(ts){
  if(!ts) return '실시간 대기';
  const diff=Math.max(0,Date.now()-Number(ts));
  const sec=Math.floor(diff/1000);
  if(sec<20) return '방금 업데이트';
  if(sec<60) return sec+'초 전 업데이트';
  const min=Math.floor(sec/60);
  if(min<60) return min+'분 전 업데이트';
  const hr=Math.floor(min/60);
  if(hr<24) return hr+'시간 전 업데이트';
  return '오래 전 업데이트';
}

function buildLiveScore(d,totalR,doneR){
  const bW=d.blueWins||0, wW=d.whiteWins||0;
  const blueName=esc(liveTeamLabel(d,'blue'));
  const redName=esc(liveTeamLabel(d,'red'));
  let lead='동점', leadDetail='팽팽한 접전', leadCls=' tie';
  if(bW>wW){ lead=blueName+' 리드'; leadDetail=(bW-wW)+'승 차'; leadCls=' blue'; }
  else if(wW>bW){ lead=redName+' 리드'; leadDetail=(wW-bW)+'승 차'; leadCls=' red'; }
  const pct=Math.max(0,Math.min(100,Math.round((doneR/Math.max(1,totalR))*100)));
  return '<section class="score-hero" id="scoreBoard">'
    +'<div class="section-kicker"><b>현재 점수</b><span>'+esc(formatUpdatedAgo(d.updatedAt))+'</span></div>'
    +'<div class="score-row">'
      +'<div class="score-team blue"><div class="score-name">'+blueName+'</div><div class="score-num">'+bW+'</div></div>'
      +'<div class="score-vs">VS</div>'
      +'<div class="score-team red"><div class="score-name">'+redName+'</div><div class="score-num">'+wW+'</div></div>'
    +'</div>'
    +'<div class="score-lead'+leadCls+'"><span>'+lead+'</span><b>'+leadDetail+'</b></div>'
    +'<div class="score-progress"><span style="width:'+pct+'%"></span></div>'
    +'<div class="progress">📊 '+totalR+'라운드 중 '+doneR+'라운드 완료 · '+pct+'% 진행'
      +(d.pointSystem?' · '+esc(d.pointSystem)+'점 경기':'')+'</div>'
    +'</section>';
}

function _attKey(name){
  return encodeURIComponent(String(name||'')).replace(/[.#$\[\]\/']/g,'_');
}

function _attOn(name){
  return !!(window._liveAttendance && window._liveAttendance[_attKey(name)]);
}

function _partyOn(name){
  return !!(window._liveParty && window._liveParty[_attKey(name)]);
}

function _hasAttendanceData(){
  return !!(window._liveAttendanceSeeded || (window._liveAttendance && Object.keys(window._liveAttendance).length));
}

function _expectedOn(name){
  return !!(_hasAttendanceData() && !_attOn(name));
}

function _normalizeMembers(list){
  return (list||[]).map(x=>typeof x==='string'?{n:x,l:0,g:''}:x).filter(x=>x&&x.n);
}

function _sortMembers(list){
  const arr=_normalizeMembers(list);
  const sort=_teamRosterSort||'name';
  const roleRank=p=>p.isLeader?0:p.isSub?1:2;
  const genderRank=p=>p.g==='M'?0:p.g==='F'?1:2;
  return arr.sort((a,b)=>{
    if(sort==='att'){
      const av=_expectedOn(a.n)?0:1, bv=_expectedOn(b.n)?0:1;
      if(av!==bv) return av-bv;
    }
    if(sort==='role'){
      const ar=roleRank(a), br=roleRank(b);
      if(ar!==br) return ar-br;
    }
    if(sort==='level'){
      const ld=(b.l||0)-(a.l||0);
      if(ld!==0) return ld;
      const gd=genderRank(a)-genderRank(b);
      if(gd!==0) return gd;
    }
    if(sort==='gender'){
      const gd=genderRank(a)-genderRank(b);
      if(gd!==0) return gd;
      const ld=(b.l||0)-(a.l||0);
      if(ld!==0) return ld;
    }
    return String(a.n).localeCompare(String(b.n),'ko');
  });
}

function _matchKey(m){
  return (m&&m.round||0)+'_'+(m&&m.court||0);
}

function _viewerStorageKey(){
  return 'kokmatch_live_viewer_'+(liveId||'default');
}

function _koInitials(text){
  const initials=['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  return String(text||'').split('').map(ch=>{
    const code=ch.charCodeAt(0)-0xac00;
    if(code>=0 && code<=11171) return initials[Math.floor(code/588)]||ch;
    return ch;
  }).join('');
}

function _viewerSearchText(p,d){
  const team=p.team==='blue'?liveTeamLabel(d,'blue'):p.team==='red'?liveTeamLabel(d,'red'):'참가자';
  return [p.n,_koInitials(p.n),team,_viewerRoleText(p)].join(' ').toLowerCase();
}

function _allLiveMembers(d){
  const members=d&&d.members?d.members:{};
  const rows=[];
  _normalizeMembers(members.blue||[]).forEach(p=>rows.push({...p,team:'blue'}));
  _normalizeMembers(members.red||[]).forEach(p=>rows.push({...p,team:'red'}));
  _normalizeMembers(members.all||[]).forEach(p=>rows.push({...p,team:'all'}));
  return rows;
}

function _viewerInfo(d){
  if(!_viewerName){
    hydrateLiveViewerName(d);
  }
  if(!_viewerName) return null;
  return _allLiveMembers(d).find(p=>p.n===_viewerName)||null;
}

function _sameName(a,b){
  return String(a||'').trim()===String(b||'').trim();
}

function _findViewerByName(d,name){
  const target=String(name||'').trim();
  if(!target)return null;
  return _allLiveMembers(d).find(p=>_sameName(p.n,target))||null;
}

function _recentStoredViewerName(){
  try{
    const v=JSON.parse(localStorage.getItem('kokmatch_live_viewer_last')||'null');
    if(v&&Date.now()-(v.savedAt||0)<1000*60*60*24*60)return String(v.name||'').trim();
  }catch(e){}
  return '';
}

function hydrateLiveViewerName(d){
  const candidates=[
    _viewerParamName,
    (()=>{try{return localStorage.getItem(_viewerStorageKey())||'';}catch(e){return '';}})(),
    _recentStoredViewerName()
  ];
  for(const name of candidates){
    const hit=_findViewerByName(d,name);
    if(hit){
      _viewerName=hit.n;
      try{localStorage.setItem(_viewerStorageKey(),_viewerName);}catch(e){}
      return;
    }
  }
  if(_viewerParamMember){
    // Current live payloads are name-first, but keep member id fallback for future payloads.
    const hit=_allLiveMembers(d).find(p=>String(p.id||p.memberId||'')===_viewerParamMember);
    if(hit){
      _viewerName=hit.n;
      try{localStorage.setItem(_viewerStorageKey(),_viewerName);}catch(e){}
    }
  }
}

function _viewerRoleText(p){
  if(!p) return '';
  if(p.isLeader) return '단장';
  if(p.isSub) return '부단장';
  return '선수';
}

function setLiveViewerName(name){
  _viewerName=String(name||'').trim();
  if(_viewerName) _viewerSearchTerm='';
  try{
    if(_viewerName){
      localStorage.setItem(_viewerStorageKey(),_viewerName);
      localStorage.setItem('kokmatch_live_viewer_last',JSON.stringify({name:_viewerName,liveId,source:'view',savedAt:Date.now()}));
    }else{
      localStorage.removeItem(_viewerStorageKey());
    }
  }catch(e){}
  if(window._lastLiveData) render(window._lastLiveData);
}

function selectLiveViewer(){
  const el=document.getElementById('liveViewerSelect');
  setLiveViewerName(el?el.value:'');
}

function setLiveViewerSearch(value){
  _viewerSearchTerm=String(value||'');
  if(window._lastLiveData) render(window._lastLiveData);
  requestAnimationFrame(()=>{
    const el=document.getElementById('liveViewerSearch');
    if(el){
      el.focus();
      const len=el.value.length;
      try{el.setSelectionRange(len,len);}catch(e){}
    }
  });
}

function _matchSideForName(m,name){
  if(!m||!name) return '';
  if((m.t1||[]).includes(name)) return 't1';
  if((m.t2||[]).includes(name)) return 't2';
  return '';
}

function _matchPlayersLine(m,side){
  const mine=side==='t2'?(m.t2||[]):(m.t1||[]);
  const opp=side==='t2'?(m.t1||[]):(m.t2||[]);
  return esc(mine.filter(Boolean).join(' / ')||'-')+' <b>vs</b> '+esc(opp.filter(Boolean).join(' / ')||'-');
}

function _viewerPairHtml(names,cls){
  return '<div class="viewer-pair '+(cls||'')+'">'+(names||[]).slice(0,2).map(n=>'<span>'+esc(n||'-')+'</span>').join('')+'</div>';
}

function _viewerMatchBoardHtml(m,side){
  const mine=side==='t2'?(m.t2||[]):(m.t1||[]);
  const opp=side==='t2'?(m.t1||[]):(m.t2||[]);
  return '<div class="viewer-match-versus">'
    +_viewerPairHtml(mine,'mine')
    +'<div class="viewer-vs">VS</div>'
    +_viewerPairHtml(opp,'right')
  +'</div>';
}

function _viewerMatches(d,name){
  return ((d&&d.matches)||[])
    .map((m,i)=>Object.assign({},m,{_idx:i,_key:_matchKey(m),_side:_matchSideForName(m,name)}))
    .filter(m=>m._side);
}

function _viewerNextMatch(d,name){
  const matches=_viewerMatches(d,name).filter(m=>!m.win);
  const cur=Number(d&&d.currentRound||0);
  return matches.sort((a,b)=>{
    const ac=a.round===cur?0:1, bc=b.round===cur?0:1;
    if(ac!==bc) return ac-bc;
    return (a.round-b.round)||(a.court-b.court);
  })[0]||null;
}

function _viewerRecordHtml(d,name){
  const matches=_viewerMatches(d,name);
  const done=matches.filter(m=>m.win);
  const wins=done.filter(m=>m.win===m._side).length;
  const losses=done.length-wins;
  const remain=matches.length-done.length;
  return '<div class="viewer-record-card">'
    +'<div class="viewer-record-grid">'
      +'<div class="viewer-record-chip"><b>'+done.length+'/'+matches.length+'</b><span>출전</span></div>'
      +'<div class="viewer-record-chip"><b>'+wins+'승 '+losses+'패</b><span>기록</span></div>'
      +'<div class="viewer-record-chip"><b>'+remain+'</b><span>남은 경기</span></div>'
    +'</div>'
  +'</div>';
}

function _viewerNextHtml(d,current){
  const next=_viewerNextMatch(d,current.n);
  if(!next){
    return '<div class="viewer-next-card">'
      +'<div class="viewer-next-top"><span class="viewer-next-label">다음 경기</span><span class="viewer-next-where">완료</span></div>'
      +'<div class="viewer-next-line">오늘 예정된 내 경기는 모두 확인됐어요.</div>'
    +'</div>';
  }
  const cur=Number(d&&d.currentRound||0);
  const label=next.round===cur?'지금 경기':'다음 경기';
  const where='R'+esc(String(next.round||'-'))+' · '+esc(String(next.court||'-'))+'코트';
  return '<div class="viewer-next-card">'
    +'<div class="viewer-next-top"><span class="viewer-next-label">'+label+'</span><span class="viewer-next-where">'+where+'</span></div>'
    +_viewerMatchBoardHtml(next,next._side)
    +'<div class="viewer-next-type">'+esc(next.type||'경기')+(next.isFiller?' · 보완':'')+'</div>'
  +'</div>';
}

function _viewerScheduleHtml(d,current){
  const future=_viewerMatches(d,current.n).filter(m=>!m.win).sort((a,b)=>(a.round-b.round)||(a.court-b.court));
  if(future.length<=1) return '';
  return '<details class="viewer-schedule">'
    +'<summary>전체 예정 경기 '+future.length+'개</summary>'
    +'<div class="viewer-schedule-list">'
      +future.map(m=>'<div class="viewer-schedule-item"><span>R'+esc(String(m.round||'-'))+' · '+esc(String(m.court||'-'))+'코트</span>'+_viewerMatchBoardHtml(m,m._side)+'</div>').join('')
    +'</div>'
  +'</details>';
}

function _viewerStatusButtons(current){
  const nameArg=JSON.stringify(current.n).replace(/"/g,'&quot;');
  const teamKey=current.team||'';
  const expectedOn=_expectedOn(current.n);
  const partyOn=_partyOn(current.n);
  return '<div class="viewer-status-actions">'
    +'<button type="button" class="viewer-state-btn attend on static" aria-disabled="true">출석</button>'
    +'<button type="button" class="viewer-state-btn ready '+(expectedOn?'on':'')+'" onclick="toggleMemberAttendance('+nameArg+',\''+teamKey+'\')">'+(expectedOn?'늦음✓':'늦음')+'</button>'
    +'<button type="button" class="viewer-state-btn party '+(partyOn?'on':'')+'" onclick="toggleMemberParty('+nameArg+',\''+teamKey+'\')">'+(partyOn?'뒷풀이✓':'뒷풀이')+'</button>'
  +'</div>';
}

function buildViewerIdentity(d){
  const all=_allLiveMembers(d);
  if(!all.length) return '';
  const current=_viewerInfo(d);
  if(current){
    const team=current.team==='blue'?liveTeamLabel(d,'blue'):current.team==='red'?liveTeamLabel(d,'red'):'참가자';
    return '<section class="viewer-identity">'
      +'<div class="viewer-identity-row">'
        +'<div class="viewer-identity-main">'
          +'<div class="viewer-identity-k">MY PAGE</div>'
          +'<div class="viewer-identity-name">'+esc(current.n)+'님</div>'
          +'<div class="viewer-identity-role">'+esc(team)+' · '+esc(_viewerRoleText(current))+'</div>'
        +'</div>'
        +'<button type="button" onclick="setLiveViewerName(\'\')">변경</button>'
      +'</div>'
      +_viewerStatusButtons(current)
      +_viewerNextHtml(d,current)
      +_viewerRecordHtml(d,current.n)
      +_viewerScheduleHtml(d,current)
    +'</section>';
  }
  const sorted=all.sort((a,b)=>String(a.n).localeCompare(String(b.n),'ko'));
  const q=String(_viewerSearchTerm||'').trim().toLowerCase();
  const filtered=(q?sorted.filter(p=>_viewerSearchText(p,d).includes(q)):sorted).slice(0,12);
  const cards=filtered.map(p=>{
    const team=p.team==='blue'?liveTeamLabel(d,'blue'):p.team==='red'?liveTeamLabel(d,'red'):'참가자';
    const nameArg=JSON.stringify(p.n).replace(/"/g,'&quot;');
    return '<button type="button" class="viewer-name-card" onclick="setLiveViewerName('+nameArg+')">'
      +'<b>'+esc(p.n)+'</b>'
      +'<span>'+esc(team)+' · '+esc(_viewerRoleText(p))+'</span>'
    +'</button>';
  }).join('');
  return '<section class="viewer-identity">'
    +'<div class="viewer-picker">'
      +'<div class="viewer-picker-title">내 이름 찾기</div>'
      +'<input id="liveViewerSearch" class="viewer-search-input" value="'+esc(_viewerSearchTerm||'')+'" oninput="setLiveViewerSearch(this.value)" placeholder="초성 또는 이름 검색">'
      +'<div class="viewer-candidates">'
        +(cards||'<div class="viewer-empty-result">검색 결과가 없습니다.</div>')
      +'</div>'
    +'</div>'
  +'</section>';
}

function _canSubmitResult(m,d){
  const viewer=_viewerInfo(d);
  if(!viewer || !m || m.win) return false;
  const names=[...(m.t1||[]),...(m.t2||[])].filter(Boolean);
  if(names.includes(viewer.n)) return true;
  return !!(d&&d.isTeam&&(viewer.isLeader||viewer.isSub));
}

function _resultRoleForSubmit(d,m){
  const viewer=_viewerInfo(d);
  if(!viewer) return '';
  const names=[...(m&&m.t1||[]),...(m&&m.t2||[])].filter(Boolean);
  if(names.includes(viewer.n)) return 'player';
  if(viewer.isLeader) return 'leader';
  if(viewer.isSub) return 'sub';
  return 'member';
}

async function submitLiveWin(matchIdx,side){
  const d=window._lastLiveData;
  const matches=d&&Array.isArray(d.matches)?d.matches:[];
  const m=matches[matchIdx];
  const viewer=_viewerInfo(d);
  if(!m || !viewer){
    alert('내 이름을 먼저 선택해주세요.');
    return;
  }
  if(!_canSubmitResult(m,d)){
    alert('이 경기의 선수 또는 단장/부단장만 승패를 입력할 수 있어요.');
    return;
  }
  if(!liveDb || !liveId){
    alert('승패 입력을 저장할 수 없습니다. 잠시 후 다시 시도해주세요.');
    return;
  }
  const key=_matchKey(m);
  const nameKey=_attKey(viewer.n);
  const existing=m.win||null;
  const role=_resultRoleForSubmit(d,m);
  try{
    if(existing && existing!==side){
      await liveDb.ref('live/'+liveId+'/resultConflicts/'+key+'/'+nameKey).set({
        matchKey:key, matchIdx:matchIdx, requested:side, existing:existing,
        byName:viewer.n, byRole:role, ts:firebase.database.ServerValue.TIMESTAMP
      });
      alert('이미 다른 결과가 입력되어 관리자 확인으로 보냈어요.');
      return;
    }
    const nextMatches=matches.map(x=>({...x}));
    nextMatches[matchIdx].win=side;
    nextMatches[matchIdx].winBy=viewer.n;
    nextMatches[matchIdx].winByRole=role;
    nextMatches[matchIdx].winAt=Date.now();
    let blueWins=0, whiteWins=0;
    nextMatches.forEach(x=>{
      if(x.win==='t1') blueWins++;
      else if(x.win==='t2') whiteWins++;
    });
    const rounds=[...new Set(nextMatches.map(x=>x.round).filter(Boolean))].sort((a,b)=>a-b);
    const nextRound=rounds.find(r=>nextMatches.filter(x=>x.round===r).some(x=>!x.win))||0;
    const updates={};
    updates['matches/'+matchIdx+'/win']=side;
    updates['matches/'+matchIdx+'/winBy']=viewer.n;
    updates['matches/'+matchIdx+'/winByRole']=role;
    updates['matches/'+matchIdx+'/winAt']=firebase.database.ServerValue.TIMESTAMP;
    updates['resultInputs/'+key+'/'+nameKey]={
      matchKey:key, matchIdx:matchIdx, side:side,
      byName:viewer.n, byRole:role, ts:firebase.database.ServerValue.TIMESTAMP
    };
    updates.blueWins=blueWins;
    updates.whiteWins=whiteWins;
    updates.currentRound=nextRound;
    updates.updatedAt=firebase.database.ServerValue.TIMESTAMP;
    await liveDb.ref('live/'+liveId).update(updates);
  }catch(e){
    alert('승패 입력 실패: '+e.message);
  }
}

function buildResultInputControls(m,d,opts){
  if(!opts || !opts.current) return '';
  if(m.win){
    const winner=m.win==='t1'?'청 승':'홍 승';
    return '<div class="result-entry-done">승패 입력됨 · '+esc(winner)+'</div>';
  }
  if(!_canSubmitResult(m,d)) return '';
  const idx=Number(m._idx);
  if(!Number.isFinite(idx) || idx<0) return '';
  return '<div class="result-entry">'
    +'<button type="button" class="blue-win" onclick="submitLiveWin('+idx+',\'t1\')">청 승</button>'
    +'<button type="button" class="red-win" onclick="submitLiveWin('+idx+',\'t2\')">홍 승</button>'
  +'</div>';
}

window.setLiveViewerName=setLiveViewerName;
window.selectLiveViewer=selectLiveViewer;
window.setLiveViewerSearch=setLiveViewerSearch;
window.submitLiveWin=submitLiveWin;

function setTeamRosterSort(sort){
  _teamRosterSort=sort||'name';
  try{localStorage.setItem('kokmatch_live_roster_sort',_teamRosterSort);}catch(e){}
  if(window._lastLiveData) render(window._lastLiveData);
}

function setTeamRosterOpen(open){
  _teamRosterOpen=!!open;
}

function closeTeamRoster(){
  _teamRosterOpen=false;
  const el=document.getElementById('teamRoster');
  if(el) {
    el.open=false;
    el.scrollIntoView({behavior:'smooth',block:'start'});
  }
}

async function toggleMemberAttendance(name, team){
  if(!name) return;
  if(!liveDb || !liveId){
    alert('늦음 표시를 저장할 수 없습니다. 잠시 후 다시 시도해주세요.');
    return;
  }
  const key=_attKey(name);
  const ref=liveDb.ref('live/'+liveId+'/attendance/'+key);
  try{
    if(_expectedOn(name)){
      await ref.set({
        name:name,
        team:team||'',
        source:'arrived',
        ts:firebase.database.ServerValue.TIMESTAMP
      });
    } else {
      if(!confirm(name+'님을 늦음으로 표시할까요?')) return;
      await ref.remove();
    }
  }catch(e){
    alert('늦음 표시 저장 실패: '+e.message);
  }
}

async function toggleMemberParty(name, team){
  if(!name) return;
  if(!liveDb || !liveId){
    alert('뒷풀이 참석을 저장할 수 없습니다. 잠시 후 다시 시도해주세요.');
    return;
  }
  const key=_attKey(name);
  const ref=liveDb.ref('live/'+liveId+'/party/'+key);
  try{
    if(_partyOn(name)){
      if(!confirm(name+'님의 뒷풀이 참석을 취소할까요?')) return;
      await ref.remove();
    } else {
      await ref.set({
        name:name,
        team:team||'',
        ts:firebase.database.ServerValue.TIMESTAMP
      });
    }
  }catch(e){
    alert('뒷풀이 참석 저장 실패: '+e.message);
  }
}

function buildTeamRosterCard(d){
  if(!d.members) return '';
  const blue=_normalizeMembers(d.members.blue||[]);
  const red=_normalizeMembers(d.members.red||[]);
  const solo=_normalizeMembers(d.members.all||[]);
  const showTeam=!!(d.isTeam && (blue.length||red.length));
  const showSolo=!showTeam && !!solo.length;
  if(!showTeam && !showSolo) return '';
  const attendance=d.attendance||{};
  const party=d.party||{};
  window._liveAttendance=attendance;
  window._liveParty=party;
  window._liveAttendanceSeeded=!!(d && (d.attendanceSeeded || d.attendanceMode==='rsvp'));
  const mk=(list,teamKey)=>{
    const arr=_sortMembers(list);
    if(!arr.length) return '<div class="faq-note">명단이 없습니다.</div>';
    return arr.map(p=>{
      const badge=p.isLeader?'<span class="team-member-badge" title="단장">단</span>':p.isSub?'<span class="team-member-badge" title="부단장">부</span>':'';
      const on=_expectedOn(p.n);
      const partyOn=_partyOn(p.n);
      const nameArg=JSON.stringify(p.n).replace(/"/g,'&quot;');
      const genderCls=p.g==='F'?'female':p.g==='M'?'male':'';
      const genderText=p.g==='M'?'남':p.g==='F'?'여':'·';
      return '<div class="team-member">'
        +'<span class="team-member-g '+genderCls+'">'+genderText+'</span>'
        +'<span class="team-member-name">'+esc(p.n)+'</span>'
        +badge
        +'<div class="team-member-actions">'
          +'<button type="button" class="team-member-att '+(on?'on':'')+'" onclick="toggleMemberAttendance('+nameArg+',\''+teamKey+'\')">'+(on?'늦음✓':'늦음')+'</button>'
          +'<button type="button" class="team-member-party '+(partyOn?'on':'')+'" onclick="toggleMemberParty('+nameArg+',\''+teamKey+'\')">'+(partyOn?'뒷풀이✓':'뒷풀이')+'</button>'
        +'</div>'
      +'</div>';
    }).join('');
  };
  const all=showTeam?[...blue,...red]:solo;
  const attCount=all.filter(p=>_expectedOn(p.n)).length;
  const partyCount=all.filter(p=>_partyOn(p.n)).length;
  const sortBtn=(key,label)=>'<button type="button" class="team-roster-sort '+(_teamRosterSort===key?'active':'')+'" onclick="setTeamRosterSort(\''+key+'\')">'+label+'</button>';
  return '<details class="info-details primary" id="teamRoster" '+(_teamRosterOpen?'open':'')+' ontoggle="setTeamRosterOpen(this.open)">'
    +'<summary>'+(showTeam?'팀 명단':'명단')+' · 늦음 · 뒷풀이</summary>'
    +'<div class="info-body">'
      +'<section class="team-roster-card">'
        +'<div class="team-roster-head"><b>'+(showTeam?'팀 명단':'참가자 명단')+'</b><span>늦음 '+attCount+'/'+all.length+' · 뒷풀이 '+partyCount+'명</span></div>'
        +'<div class="team-att-summary"><b>늦음</b> · <b>뒷풀이</b> 확인</div>'
        +'<div class="team-roster-tools">'+sortBtn('name','가나다')+sortBtn('gender','성별')+sortBtn('att','늦음')+sortBtn('role','단장')+sortBtn('level','급수')+'</div>'
        +'<div class="team-roster-columns '+(showTeam?'':'single')+'">'
          +(showTeam
            ?'<div class="team-roster-side blue"><div class="team-roster-title">'+esc(d.teamBlue||'청팀')+' <small>'+blue.filter(p=>_expectedOn(p.n)).length+'/'+blue.length+'명</small></div>'+mk(blue,'blue')+'</div>'
              +'<div class="team-roster-side red"><div class="team-roster-title">'+esc(d.teamWhite||'홍팀')+' <small>'+red.filter(p=>_expectedOn(p.n)).length+'/'+red.length+'명</small></div>'+mk(red,'red')+'</div>'
            :'<div class="team-roster-side"><div class="team-roster-title">전체 참가자 <small>'+attCount+'/'+solo.length+'명</small></div>'+mk(solo,'all')+'</div>')
        +'</div>'
        +'<button type="button" class="team-roster-close" onclick="closeTeamRoster()">▲ 명단 접기</button>'
      +'</section>'
    +'</div>'
  +'</details>';
}

function _isImminentMatch(m){
  const start=Number(m&&m.startAt||0);
  if(!start || (m&&m.win)) return false;
  const elapsed=Date.now()-start;
  return elapsed>=12*60*1000 && elapsed<=30*60*1000;
}

function _playerLine(name,d){
  const n=String(name||'');
  if(!n) return '<div class="live-player">-</div>';
  const flag=!!(d&&_expectedOn(n));
  return '<div class="live-player '+(flag?'not-ready':'')+'">'+esc(n)
    +(flag?'<span class="ready-badge">늦음</span>':'')
  +'</div>';
}

function buildLiveMatchCard(m,d,opts){
  opts=opts||{};
  const tc=m.type==='여복'?'women':m.type==='남복'?'men':m.type==='보정'?'adjust':'mixed';
  const t1=m.t1||[], t2=m.t2||[];
  const t1win=m.win==='t1', t2win=m.win==='t2';
  const courtLabel=(opts.next?'R'+esc(String(m.round||''))+' · ':'')+esc(String(m.court||''))+'코트';
  const typeLabel=(opts.next?'대기 · ':'')+esc(m.type||'경기')+(m.isFiller?' · 보완':'');
  const imminent=opts.next && _isImminentMatch(m);
  return '<article class="live-match '+tc+(opts.current?' is-current':'')+(imminent?' is-imminent':'')+'">'
    +(imminent?'<div class="imminent-banner">대진 임박 · 다음 경기 준비해주세요</div>':'')
    +'<div class="live-match-top">'
      +'<span class="live-court">'+courtLabel+'</span>'
      +'<span class="live-type '+tc+'">'+typeLabel+'</span>'
    +'</div>'
    +'<div class="live-versus">'
      +'<div class="live-side blue'+(t1win?' win':'')+'">'
        +(t1win?'<span class="win-chip">WIN</span>':'')
        +_playerLine(t1[0],d)
        +_playerLine(t1[1],d)
      +'</div>'
      +'<div class="live-vs">VS</div>'
      +'<div class="live-side red'+(t2win?' win':'')+'">'
        +(t2win?'<span class="win-chip">WIN</span>':'')
        +_playerLine(t2[0],d)
        +_playerLine(t2[1],d)
      +'</div>'
    +'</div>'
    +buildResultInputControls(m,d,opts)
  +'</article>';
}

function buildCurrentPanel(curRound, curMatches, d){
  if(!curRound) return '';
  const openCnt=(curMatches||[]).filter(m=>!m.win).length;
  const badge=openCnt>0?'진행 중':'라운드 완료';
  let html='<section class="current-panel" id="round_'+curRound+'">'
    +'<div class="current-head">'
      +'<div><div class="section-kicker">지금 볼 경기</div><div class="current-round">ROUND '+curRound+'</div></div>'
      +'<span class="current-badge">'+badge+'</span>'
    +'</div>';
  if((curMatches||[]).length){
    html+='<div class="current-grid">';
    curMatches.sort((a,b)=>a.court-b.court).forEach(m=>{ html+=buildLiveMatchCard(m,d,{current:true}); });
    html+='</div>';
  } else {
    html+='<div class="live-match is-current"><div class="live-match-top"><span class="live-type">대기 중</span></div>'
      +'<div class="progress">아직 표시할 경기가 없습니다.</div></div>';
  }
  html+='</section>';
  return html;
}

function buildNextPanel(nextMatches,d){
  if(!nextMatches || !nextMatches.length) return '';
  const limit=Math.max(1,parseInt(d.courts||3,10)||3);
  const visible=nextMatches.slice(0,limit);
  const imminent=visible.some(_isImminentMatch);
  let html='<section class="next-panel '+(imminent?'next-imminent':'')+'"><div class="next-title">'+(imminent?'다음 대진 준비':'다음 대진')+'</div>'
    +'<div class="next-list">';
  visible.forEach(m=>{
    html+=buildLiveMatchCard(m,d,{next:true});
  });
  if(nextMatches.length>limit){
    html+='<div class="next-item"><div class="next-court">대기</div><div class="next-names">외 '+(nextMatches.length-limit)+'경기 더 대기 중</div></div>';
  }
  html+='</div></section>';
  return html;
}

function render(d){
  _randomizeViewerGender();
  window._lastLiveData=d;
  window._liveAttendance=d.attendance||{};
  window._liveParty=d.party||{};
  window._liveAttendanceSeeded=!!(d && (d.attendanceSeeded || d.attendanceMode==='rsvp'));
  const matches=(d.matches||[]).map((m,i)=>Object.assign({},m,{_idx:i,_key:_matchKey(m)}));
  const byRound={};
  matches.forEach(m=>{ (byRound[m.round]=byRound[m.round]||[]).push(m); });
  const rounds=Object.keys(byRound).map(Number).sort((a,b)=>a-b);
  const totalR=rounds.length;
  let doneR=0;
  rounds.forEach(r=>{ if((byRound[r]||[]).every(m=>m.win)) doneR++; });
  const allDone=totalR>0 && matches.length>0 && matches.every(m=>m.win);
  const firstOpenRound=rounds.find(r=>(byRound[r]||[]).some(m=>!m.win));
  let curRound=d.currentRound||null;
  if(!curRound || !byRound[curRound] || ((byRound[curRound]||[]).every(m=>m.win) && firstOpenRound)){
    curRound=firstOpenRound || curRound || rounds[0] || null;
  }
  const curRoundMatches=curRound?(byRound[curRound]||[]): [];
  const curOpen=curRoundMatches.filter(m=>!m.win);
  const curDisplay=curOpen.length?curOpen:curRoundMatches;
  const nextMatches=matches
    .filter(m=>!m.win && m.round!==curRound)
    .sort((a,b)=>(a.round-b.round)||(a.court-b.court));

  if(d.members) window._rosterData=d.members;

  let html='<div class="live-board">';
  html+='<div class="live-top"><span class="live-pill"><span class="live-dot-mini"></span>LIVE</span><span>선수용 라이브 보드</span></div>';
  html+='<div class="title">'+esc(d.title||'대진표')+'</div>';
  if(d.isTeam){
    html+=buildLiveScore(d,totalR,doneR);
  } else {
    html+='<div class="progress" id="scoreBoard">📊 '+totalR+'라운드 중 '+doneR+'라운드 완료'
      +(d.pointSystem?' · '+esc(d.pointSystem)+'점 경기':'')+'</div>';
  }
  html+=buildViewerIdentity(d);

  if(allDone){
    html+=buildFinale(matches,d);
  } else {
    html+=buildCurrentPanel(curRound,curDisplay,d);
    html+=buildNextPanel(nextMatches,d);
  }
  html+=buildMvpSpotlight(matches,d);
  html+=buildTeamRosterCard(d);

  html+='<details class="info-details primary" id="fullBracket"><summary>전체 대진표 보기</summary><div class="info-body">';
  rounds.forEach(r=>{
    const isCur=(r===curRound);
    html+='<div class="round'+(isCur?' cur':'')+'" id="round_all_'+r+'">';
    html+='<div class="round-h"><span class="round-badge">ROUND '+r+'</span>'
      +(isCur&&!allDone?'<span class="now">● 현재</span>':'')+'<span class="round-line"></span></div>';
    (byRound[r]||[]).sort((a,b)=>a.court-b.court).forEach(m=>{ html+=buildLiveMatchCard(m,d,{current:isCur&&!m.win&&!allDone}); });
    html+='</div>';
  });
  html+='</div></details>';
  const rankingHtml=buildRanking(matches,d);
  if(rankingHtml){
    html+='<details class="info-details"><summary>전적 순위 보기</summary><div class="info-body">'+rankingHtml+'</div></details>';
  }
  html+='</div>';

  content.innerHTML=html;
}

function toggleRoster(team){
  const el=document.getElementById('roster-'+team);
  if(!el) return;
  const isOpen=el.style.display!=='none';
  // 모두 닫기
  ['blue','red'].forEach(t=>{
    const p=document.getElementById('roster-'+t);
    if(p) p.style.display='none';
  });
  // 클릭한 게 닫혀있었으면 열기 (이미 열려있었으면 그냥 닫힌 채로)
  if(!isOpen) el.style.display='block';
}

function rosterSort(team,sortBy,btn){
  if(!window._rosterData) return;
  const list=window._rosterData[team==='blue'?'blue':'red']||[];
  const arr=(list||[]).map(x=>typeof x==='string'?{n:x,l:0,g:''}:x);
  const males=[...arr].filter(p=>p.g==='M').sort((a,b)=>sortBy==='level'?(b.l-a.l||a.n.localeCompare(b.n,'ko')):a.n.localeCompare(b.n,'ko'));
  const females=[...arr].filter(p=>p.g!=='M').sort((a,b)=>sortBy==='level'?(b.l-a.l||a.n.localeCompare(b.n,'ko')):a.n.localeCompare(b.n,'ko'));
  const row=p=>'<div class="roster-row"><span class="roster-gender '+(p.g==='M'?'roster-m':'roster-f')+'">'+(p.g==='M'?'남':'여')+'</span><span class="roster-name">'+p.n+'</span></div>';
  const html=males.map(row).join('')+(males.length&&females.length?'<div class="roster-divider"></div>':'')+females.map(row).join('');
  const el=document.getElementById('roster-names-'+team);
  if(el) el.innerHTML=html;
  // 버튼 active 상태
  const wrap=btn.closest('.roster-sort-btns');
  if(wrap) wrap.querySelectorAll('.rsort-btn').forEach(b=>b.classList.toggle('active',b===btn));
}


(function(){
  if(!('serviceWorker' in navigator))return;
  let refreshing=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(refreshing)return;
    refreshing=true;
    location.reload();
  });
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('sw.js').then(reg=>{
      reg.update().catch(()=>{});
      if(reg.waiting)reg.waiting.postMessage('skipWaiting');
      reg.addEventListener('updatefound',()=>{
        const nw=reg.installing;
        if(!nw)return;
        nw.addEventListener('statechange',()=>{
          if(nw.state==='installed'&&navigator.serviceWorker.controller){
            nw.postMessage&&nw.postMessage('skipWaiting');
          }
        });
      });
    }).catch(()=>{});
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='visible'){
        navigator.serviceWorker.getRegistration().then(r=>r&&r.update()).catch(()=>{});
      }
    });
  });
})();
