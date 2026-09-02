const APP_VERSION='1.10.642';
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
      :'민턴LIVE 실시간 현황을<br>브라우저에서 보고 계세요 🏸';
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
let _viewerDetailsOpen={schedule:false,fullBracket:false,ranking:false};
let _latestLiveData=null;
let _liveTicker=null;
let _viewerName='';
let _viewerMemberId='';
let _viewerNameCleared=false;
let _viewerSearchTerm='';
let _teamOfficialOverviewFilter='';

function _isTeamLiveData(d){
  if(!d)return false;
  const kind=String(d.kind||d.appMode||'');
  if(kind)return kind==='teamLive';
  return d.isTeam===true
    ||d.matchMode==='free'
    ||!!d.rsvpId
    ||d.lateMode==='explicit'
    ||Array.isArray(d.members?.all);
}

function _usesFixedTeams(d){
  if(!d)return false;
  if(d.matchMode==='free')return false;
  if(d.matchMode==='team')return true;
  return !!d.isTeam;
}

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


/* AI 브리핑: 청/홍팀 현황 요약 */
/* 명언 + 팀 한마디 */
// ── 호칭 유틸 ──
let _gMap = {};

// 성 제거: 3글자면 첫 1글자(성) 제거
function _firstName(name){
  return (name&&name.length>=3)?name.slice(1):(name||'');
}
// 받침 유무

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

function buildPartySpotlight(d){
  if(!_isTeamLiveData(d)) return '';
  const all=_allLiveMembers(d);
  const rosterNames=new Set(all.map(p=>String(p&&p.n||'').trim()).filter(Boolean));
  const seen=new Set();
  const partyNames=[];
  const pushName=name=>{
    const clean=String(name||'').trim();
    if(!clean || !rosterNames.has(clean) || seen.has(clean)) return;
    seen.add(clean);
    partyNames.push(clean);
  };
  all.forEach(p=>{ if(_partyOn(p.n)) pushName(p.n); });
  Object.values(d.party||{}).forEach(v=>{
    if(v && typeof v==='object') pushName(v.name);
  });
  const count=partyNames.length;
  /* 이 블록이 뒷풀이를 처음 알게 되는 자리입니다 — 여기에 신청 버튼이 없으면
     명단만 읽고 지나갑니다. 이름을 고른 사람에게만 붙입니다. */
  const me=_viewerInfo(d);
  const meOn=me?_partyOn(me.n):false;
  const joinBtn=me
    ? '<button type="button" class="party-join'+(meOn?' on':'')+'"'
        +' onclick="toggleMemberParty('+JSON.stringify(me.n).replace(/"/g,'&quot;')+',\''+(me.team||'')+'\')">'
        +(meOn?'신청함 · 누르면 취소':'나도 신청하기')+'</button>'
    : '';
  if(!count){
    return '<section class="mvp-card party-spotlight party-empty">'
      +'<div class="mvp-label">🍻 뒷풀이 멤버 모집 중</div>'
      +'<div class="mvp-sub">함께 마무리할 멤버를 기다려요.</div>'
      +joinBtn
      +'</section>';
  }
  const visible=partyNames.slice(0,12);
  const more=count-visible.length;
  return '<section class="mvp-card party-spotlight">'
    +'<div class="mvp-label">🍻 뒷풀이 멤버 · '+count+'명</div>'
    +'<div class="mvp-names">'
      +visible.map(name=>'<span class="mvp-chip party-chip">'+esc(name)+'</span>').join('')
      +(more?'<span class="mvp-chip party-more">외 '+more+'명</span>':'')
    +'</div>'
    +'<div class="mvp-sub">오늘도 끝까지 같이 가는 멤버들이에요.</div>'
    +joinBtn
    +'</section>';
}

function buildRanking(matches, d){
  const arr=collectLivePlayerStats(matches,d);
  if(arr.length<2) return '';
  const rate=s=>(s.w+s.l)>0?s.w/(s.w+s.l):0;
  const rateStr=s=>(s.w+s.l)>0?Math.round(rate(s)*100)+'%':'—';
  const ratePct=s=>Math.round(rate(s)*100);
  const byRate=[...arr].sort((a,b)=>rate(b)-rate(a)||b.w-a.w||a.l-b.l||a.name.localeCompare(b.name,'ko'));
  const sameRank=(a,b)=>a&&b&&ratePct(a)===ratePct(b);
  const topRate=ratePct(byRate[0]);
  const cutoff=byRate[Math.min(4,byRate.length-1)];
  const cutoffRate=cutoff?ratePct(cutoff):topRate;
  const visible=byRate.filter((s,i)=>i<5||ratePct(s)===topRate||ratePct(s)===cutoffRate);
  let html='<div class="rank-box"><div class="rank-title">전적 순위</div>';
  let rankNum=0,prev=null;
  visible.forEach((s,i)=>{
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
  if(_usesFixedTeams(d)){
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
  if(!_usesFixedTeams(d)) return side==='blue'?'A팀':'B팀';
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

/**
 * 남은 시간 — **라운드가 끝날 때마다 다시 잽니다** (운영자 2026-08-12
 * "라운드 진행할 때마다 남은 시간 계산… 언제쯤 끝날 것 같은지").
 *
 * 관리자 화면의 「예상 시간」은 점수제별 경기당 분(25점 15분 / 21점 12분 /
 * 15점 9분)에 라운드 수를 곱한 **출발 전 어림값**입니다. 현장에서는 코트 전환도
 * 사람도 그날그날 달라서 그 값만으로는 빗나갑니다.
 *
 * 그래서 **끝난 라운드가 실제로 얼마나 걸렸는지**를 먼저 봅니다 — 그 라운드
 * 경기들의 시작~종료 폭을 재서 평균을 냅니다. 잴 게 없는 첫 라운드에서만
 * 점수제 어림값을 씁니다. 어느 쪽을 썼는지 화면에 같이 적습니다.
 */
var _LIVE_POINT_MINUTES={25:15, 21:12, 15:9};
function _liveTimeLeft(d){
  const matches=(d&&Array.isArray(d.matches))?d.matches:[];
  if(!matches.length)return null;
  const rounds=[...new Set(matches.map(m=>Number(m&&m.round)||0))].filter(Boolean).sort((a,b)=>a-b);
  if(!rounds.length)return null;
  const inRound=r=>matches.filter(m=>Number(m&&m.round)===r);
  const doneRounds=rounds.filter(r=>inRound(r).every(_settled));
  const left=rounds.length-doneRounds.length;
  if(left<=0)return {left:0, minutes:0, endAt:0, basis:'done', perRound:0};

  // 끝난 라운드의 **실제** 소요 — 말이 안 되는 값(3시간 초과)은 버립니다.
  let sum=0, n=0;
  doneRounds.forEach(r=>{
    const ms=inRound(r);
    const starts=ms.map(m=>Number(m&&m.startAt)||0).filter(Boolean);
    const ends=ms.map(m=>Number(m&&m.winAt)||0).filter(Boolean);
    if(!starts.length||!ends.length)return;
    const span=Math.max(...ends)-Math.min(...starts);
    if(span>0 && span<3*60*60*1000){ sum+=span/60000; n++; }
  });
  const guess=_LIVE_POINT_MINUTES[Number(d&&d.pointSystem)]||15;
  const perRound=n?Math.round(sum/n):guess;
  const minutes=Math.max(1, Math.round(perRound*left));
  return {left, minutes, perRound, basis:n?'실측':'예상', endAt:Date.now()+minutes*60000};
}
function _fmtMinutes(mm){
  const m=Math.max(0, Math.round(Number(mm)||0));
  if(m<60)return m+'분';
  const h=Math.floor(m/60), r=m%60;
  return r?h+'시간 '+r+'분':h+'시간';
}
function _fmtClock(ts){
  const t=Number(ts)||0;
  if(!t)return '';
  const dt=new Date(t);
  if(isNaN(dt.getTime()))return '';
  return ('0'+dt.getHours()).slice(-2)+':'+('0'+dt.getMinutes()).slice(-2);
}

/* 진행 상황 한 줄 — 경기 수가 있으면 경기 단위로, 없으면 라운드 단위로. */
function _liveProgressText(d,totalR,doneR){
  // `totalMatches` 는 게시본에 실리지 않습니다 — 대진에서 직접 셉니다.
  // (예전에는 그 필드를 읽고 늘 0이 나와 라운드 단위로 떨어졌습니다.)
  const matches=(d&&Array.isArray(d.matches))?d.matches:[];
  const total=matches.length;
  const done=matches.filter(_settled).length;
  const round=Number(d&&d.currentRound)||0;
  if(total)return (round?'R'+round+' · ':'')+done+'/'+total+'경기';
  return doneR+'/'+totalR+'라운드';
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
    +'<div class="score-compact-head"><b>팀 점수</b><small>'+esc(formatUpdatedAgo(d.updatedAt))+'</small></div>'
    +'<div class="score-row">'
      +'<div class="score-team blue"><div class="score-name">'+blueName+'</div><div class="score-num">'+bW+'</div></div>'
      +'<div class="score-vs">VS</div>'
      +'<div class="score-team red"><div class="score-name">'+redName+'</div><div class="score-num">'+wW+'</div></div>'
    +'</div>'
    // 진행 상황을 **여기 한 곳에서만** 말합니다. 예전에는 운영 현황 머리말
    // (R1 · 0/2경기) · 이 줄(0/2라운드) · 지금 볼 경기(ROUND 1)가 같은 것을
    // 세 번 말했고, 단위마저 경기/라운드로 달라 더 헷갈렸습니다.
    +'<div class="score-summary'+leadCls+'"><b>'+lead+'</b><span>'+leadDetail+' · '+_liveProgressText(d,totalR,doneR)
      +(d.pointSystem?' · '+esc(d.pointSystem)+'점':'')+'</span></div>'
    +'<div class="score-progress"><span style="width:'+pct+'%"></span></div>'
    +'</section>';
}

function _attKey(name){
  return encodeURIComponent(String(name||'')).replace(/[.#$\[\]\/']/g,'_');
}

/* 출결은 **지각 하나**입니다 (운영자 2026-08-14 재확인).
     "불참이라 해도 완전 대체할 사람은 없으니 지각자와 다를 바 없는 것 같아"
   벤치가 두껍지 않아 불참자의 남은 경기를 미리 다 갈아치울 수가 없습니다.
   결국 그때그때 그 경기만 메우게 되니, 지각과 나눌 실익이 없어 한 상태로 되돌렸습니다.
   (v571 에서 잠깐 불참을 뒀다가 접었습니다 — 옛 데이터의 status 칸은 그냥 무시합니다) */
function _lateOn(name){
  return !!(window._liveLate && window._liveLate[_attKey(name)]);
}

function _partyOn(name){
  return !!(window._liveParty && window._liveParty[_attKey(name)]);
}

function _lateMapFromData(d){
  if(d?.late&&typeof d.late==='object')return d.late;
  if(!d||(!d.attendanceSeeded&&d.attendanceMode!=='rsvp'))return {};
  const arrived=d.attendance||{};
  const out={};
  const members=d.members||{};
  const add=(list,team)=>{
    (list||[]).forEach(p=>{
      const name=String(p?.n||p?.name||'').trim();
      if(!name||arrived[_attKey(name)])return;
      out[_attKey(name)]={name,team,ts:d.updatedAt||Date.now(),source:'legacy-rsvp-late'};
    });
  };
  add(members.blue,'blue');
  add(members.red,'red');
  add(members.all,'all');
  return out;
}

function _normalizeMembers(list){
  return (list||[]).map(x=>typeof x==='string'?{n:x,l:0,g:''}:x).filter(x=>x&&x.n);
}

function _sortMembers(list){
  const arr=_normalizeMembers(list);
  const sort=_teamRosterSort||'name';
  const roleRank=p=>p.isLeader?0:p.isSub?1:p.isClubOfficial?2:p.isTemporaryOperator?3:4;
  const genderRank=p=>p.g==='M'?0:p.g==='F'?1:2;
  return arr.sort((a,b)=>{
    if(sort==='late'||sort==='att'){
      const av=_lateOn(a.n)?0:1, bv=_lateOn(b.n)?0:1;
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

/* 끝난 경기 = 결과가 있거나 **치르지 않기로 한(미실시)** 경기.
   진행(라운드 넘김)에 관한 판정은 전부 이걸 씁니다. 통계(`filter(m=>m.win)`)는
   그대로 둡니다 — 미실시는 승패가 없으니 자연히 빠집니다. */
function _settled(m){ return !!(m && (m.win || m.voided)); }
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
  const officials=d&&d.officials?d.officials:{};
  const rawTemporaryOperators=officials.temporaryOperators;
  const temporaryOperators=Array.isArray(rawTemporaryOperators)
    ?rawTemporaryOperators
    :(rawTemporaryOperators&&typeof rawTemporaryOperators==='object'?Object.values(rawTemporaryOperators):[]);
  const matchesTemporaryOperator=(p,operator)=>{
    if(!operator)return false;
    const playerId=String(p.id||p.memberId||'');
    const operatorId=String(operator.memberId||operator.id||'');
    return !!(playerId&&operatorId&&playerId===operatorId);
  };
  const add=(p,team)=>{
    const isTemporaryOperator=temporaryOperators.some(operator=>matchesTemporaryOperator(p,operator));
    rows.push({...p,team,isTemporaryOperator});
  };
  _normalizeMembers(members.blue||[]).forEach(p=>add(p,'blue'));
  _normalizeMembers(members.red||[]).forEach(p=>add(p,'red'));
  _normalizeMembers(members.all||[]).forEach(p=>add(p,'all'));
  return rows;
}

function _viewerInfo(d){
  if(!_viewerName){
    hydrateLiveViewerName(d);
  }
  if(!_viewerName) return null;
  if(_viewerMemberId){
    const byId=_allLiveMembers(d).find(p=>String(p.id||p.memberId||'')===_viewerMemberId);
    if(byId)return byId;
  }
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
  if(_viewerNameCleared) return;
  if(_viewerParamMember){
    const hit=_allLiveMembers(d).find(p=>String(p.id||p.memberId||'')===_viewerParamMember);
    if(hit){
      _viewerName=hit.n;
      _viewerMemberId=String(hit.id||hit.memberId||'');
      try{
        localStorage.setItem(_viewerStorageKey(),_viewerName);
        localStorage.setItem(_viewerStorageKey()+'_member',_viewerMemberId);
      }catch(e){}
      return;
    }
  }
  try{
    const storedMember=localStorage.getItem(_viewerStorageKey()+'_member')||'';
    const hit=storedMember&&_allLiveMembers(d).find(p=>String(p.id||p.memberId||'')===storedMember);
    if(hit){
      _viewerName=hit.n;
      _viewerMemberId=storedMember;
      return;
    }
  }catch(e){}
  const candidates=[
    _viewerParamName,
    (()=>{try{return localStorage.getItem(_viewerStorageKey())||'';}catch(e){return '';}})(),
    _recentStoredViewerName()
  ];
  for(const name of candidates){
    const hit=_findViewerByName(d,name);
    if(hit){
      _viewerName=hit.n;
      _viewerMemberId=String(hit.id||hit.memberId||'');
      try{
        localStorage.setItem(_viewerStorageKey(),_viewerName);
        if(_viewerMemberId)localStorage.setItem(_viewerStorageKey()+'_member',_viewerMemberId);
      }catch(e){}
      return;
    }
  }
}

function _viewerRoleText(p){
  if(!p) return '';
  if(p.isLeader) return p.isClubOfficial?'단장 · 클럽 임원':'단장';
  if(p.isSub) return p.isClubOfficial?'부단장 · 클럽 임원':'부단장';
  if(p.isClubOfficial) return '클럽 임원';
  if(p.isTemporaryOperator) return '운영 도우미';
  return '선수';
}
function _viewerPartnerText(p){
  return p&&p.partnerName?('P '+p.partnerName):'';
}

function setLiveViewerName(name,memberId){
  _viewerName=String(name||'').trim();
  _viewerMemberId=String(memberId||'');
  if(_viewerName&&!_viewerMemberId&&window._lastLiveData){
    const hit=_findViewerByName(window._lastLiveData,_viewerName);
    _viewerMemberId=String(hit?.id||hit?.memberId||'');
  }
  _viewerNameCleared=!_viewerName;
  if(_viewerName) _viewerSearchTerm='';
  try{
    if(_viewerName){
      localStorage.setItem(_viewerStorageKey(),_viewerName);
      if(_viewerMemberId)localStorage.setItem(_viewerStorageKey()+'_member',_viewerMemberId);
      else localStorage.removeItem(_viewerStorageKey()+'_member');
      localStorage.setItem('kokmatch_live_viewer_last',JSON.stringify({name:_viewerName,memberId:_viewerMemberId,liveId,source:'view',savedAt:Date.now()}));
    }else{
      localStorage.removeItem(_viewerStorageKey());
      localStorage.removeItem(_viewerStorageKey()+'_member');
      localStorage.removeItem('kokmatch_live_viewer_last');
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


function setViewerDetailsOpen(key,open){
  if(!_viewerDetailsOpen)_viewerDetailsOpen={};
  _viewerDetailsOpen[key]=!!open;
}

function _viewerPairHtml(names,cls,label){
  const side=(cls||'').includes('red')?'red':'blue';
  const badge=label?'<b class="viewer-side-badge '+side+'">'+esc(label)+'</b>':'';
  return '<div class="viewer-pair '+(cls||'')+'">'+badge+(names||[]).slice(0,2).map(n=>'<span>'+esc(n||'-')+'</span>').join('')+'</div>';
}

function _viewerMatchBoardHtml(m,side,d){
  const isTeam=_usesFixedTeams(d);
  const leftCls='blue'+(side==='t1'?' mine':'');
  const rightCls='right red'+(side==='t2'?' mine':'');
  return '<div class="viewer-match-versus">'
    +_viewerPairHtml(m.t1||[],leftCls,isTeam?'청':'A')
    +'<div class="viewer-vs">VS</div>'
    +_viewerPairHtml(m.t2||[],rightCls,isTeam?'홍':'B')
  +'</div>';
}

function _viewerMatches(d,name){
  return ((d&&d.matches)||[])
    .map((m,i)=>Object.assign({},m,{_idx:i,_key:_matchKey(m),_side:_matchSideForName(m,name)}))
    .filter(m=>m._side);
}

function _viewerNextMatch(d,name){
  const matches=_viewerMatches(d,name).filter(m=>!_settled(m));
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
  /* 세 칸 중 「출전 1/4」과 「남은 경기 3」은 **같은 것을 두 번 말합니다** —
     4경기 중 1경기를 뛰었으면 남은 건 3경기입니다 (운영자 2026-08-12).
     남은 경기 수가 궁금한 것이므로 출전 칸에 그 말을 붙여 한 칸으로 합칩니다. */
  const remain=matches.length-done.length;
  return '<div class="viewer-record-card">'
    +'<div class="viewer-record-grid">'
      +'<div class="viewer-record-chip"><b>'+done.length+'/'+matches.length+'</b>'
        +'<span>'+(remain>0?'출전 · '+remain+'경기 남음':'출전 완료')+'</span></div>'
      +'<div class="viewer-record-chip"><b>'+wins+'승 '+losses+'패</b><span>기록</span></div>'
    +'</div>'
  +'</div>';
}

function _teamOfficialOverviewData(d){
  const members=_allLiveMembers(d);
  const lateMap=_lateMapFromData(d);
  const partyMap=d&&d.party||{};
  const matches=(d&&Array.isArray(d.matches)?d.matches:[]).map((m,i)=>({...m,_idx:i}));
  const rounds=[...new Set(matches.map(m=>Number(m.round)||0).filter(Boolean))].sort((a,b)=>a-b);
  const firstOpenRound=rounds.find(round=>matches.some(m=>Number(m.round)===round&&!_settled(m)))||0;
  let currentRound=Number(d&&d.currentRound)||firstOpenRound;
  if(!matches.some(m=>Number(m.round)===currentRound&&!_settled(m)))currentRound=firstOpenRound;
  const currentMatches=currentRound
    ?matches.filter(m=>Number(m.round)===currentRound&&!_settled(m))
    :[];
  const currentNames=new Set();
  currentMatches.forEach(m=>[...(m.t1||[]),...(m.t2||[])].forEach(name=>{
    if(name)currentNames.add(String(name));
  }));
  const isLate=player=>!!lateMap[_attKey(player.n)];
  const isParty=player=>!!partyMap[_attKey(player.n)];
  const onSite=members.filter(player=>!isLate(player));
  const playing=onSite.filter(player=>currentNames.has(String(player.n)));
  const waiting=onSite.filter(player=>!currentNames.has(String(player.n)));
  const late=members.filter(isLate);
  const operators=members.filter(player=>player.isClubOfficial||(!_usesFixedTeams(d)&&player.isTemporaryOperator));
  const party=members.filter(isParty);
  const conflictCount=Object.values(d&&d.resultConflicts||{}).reduce((sum,row)=>{
    return sum+Object.keys(row&&typeof row==='object'?row:{}).length;
  },0);
  return {
    members,onSite,playing,waiting,late,operators,party,currentMatches,currentRound,
    completedMatches:matches.filter(_settled).length,
    totalMatches:matches.length,
    conflictCount
  };
}

function _teamOfficialOverviewMembers(data,key){
  const map={
    total:data.members,
    current:data.onSite,
    playing:data.playing,
    waiting:data.waiting,
    late:data.late,
    operators:data.operators,
    party:data.party
  };
  return [...(map[key]||[])].sort((a,b)=>String(a.n||'').localeCompare(String(b.n||''),'ko'));
}

function _teamOfficialOverviewMemberMeta(player,data,d,key){
  if(key==='operators')return _viewerRoleText(player);
  if(key==='playing'){
    const match=data.currentMatches.find(m=>[...(m.t1||[]),...(m.t2||[])].includes(player.n));
    if(match)return `${match.court||'-'}코트 · 경기중`;
  }
  if(key==='late')return '제외';
  if(key==='party')return '뒷풀이 참석';
  const team=player.team==='blue'?liveTeamLabel(d,'blue'):player.team==='red'?liveTeamLabel(d,'red'):'참가자';
  const matches=_viewerMatches(d,player.n);
  return `${team} · ${matches.filter(m=>m.win).length}/${matches.length}경기`;
}

function setTeamOfficialOverviewFilter(key){
  _teamOfficialOverviewFilter=_teamOfficialOverviewFilter===key?'':key;
  if(window._lastLiveData)render(window._lastLiveData);
}

function buildTeamOfficialOverview(d){
  const viewer=_viewerInfo(d);
  // 팀전을 실제로 이끄는 사람은 단장·부단장이다. 이들을 빼면 대체 투입·승패
  // 정정 버튼이 **화면에 아예 뜨지 않아** 서버 권한만 있고 손이 없는 꼴이 된다.
  const canOperate=!!(viewer&&(viewer.isClubOfficial||viewer.isTemporaryOperator
    ||(_usesFixedTeams(d)&&(viewer.isLeader||viewer.isSub))));
  if(!canOperate)return '';
  const data=_teamOfficialOverviewData(d);
  // 일곱 개는 많았습니다. **현장**은 등록−지각이고 **대기**는 현장−경기중이라
  // 둘 다 다른 타일에서 계산되는 값이고, **운영진**은 경기 중에 누를 일이 없습니다.
  // 실제로 손이 가는 다섯 개만 남깁니다(운영자 2026-08-12).
  const cards=[
    {key:'total',label:'등록',value:data.members.length},
    {key:'playing',label:'경기중',value:data.playing.length},
    {key:'waiting',label:'대기',value:data.waiting.length},
    {key:'late',label:'제외',value:data.late.length,cls:data.late.length?'alert':''},
    {key:'party',label:'뒷풀이',value:data.party.length,cls:'party'}
  ];
  const selected=cards.find(card=>card.key===_teamOfficialOverviewFilter);
  const detailMembers=selected?_teamOfficialOverviewMembers(data,selected.key):[];
  const detail=selected?`<div class="team-official-overview-detail">
    <div class="team-official-overview-detail-head"><b>${esc(selected.label)} ${detailMembers.length}명</b><button type="button" onclick="setTeamOfficialOverviewFilter('${selected.key}')" aria-label="${esc(selected.label)} 명단 닫기">×</button></div>
    <div class="team-official-overview-list">${detailMembers.length?detailMembers.map(player=>`<span class="team-official-overview-player"><b>${esc(player.n)}</b><small>${esc(_teamOfficialOverviewMemberMeta(player,data,d,selected.key))}</small></span>`).join(''):'<span class="team-official-overview-player"><b>해당 선수 없음</b></span>'}</div>
  </div>`:'';
  // 진행 상황은 바로 아래 점수판이 말합니다. 여기서 또 말하면 두 줄이 같은
  // 것을 서로 다른 단위(경기/라운드)로 말해 오히려 헷갈렸습니다.
  const progress=data.totalMatches?'임원 운영':'대진 준비';
  return `<section class="team-official-overview" aria-label="팀전 운영 현황">
    <div class="team-official-overview-head"><div><b>운영 현황</b><span>${esc(progress)}</span></div><em>${esc(_viewerRoleText(viewer))}</em></div>
    <div class="team-official-overview-grid">${cards.map(card=>`<button type="button" class="team-official-overview-stat ${card.cls||''} ${_teamOfficialOverviewFilter===card.key?'active':''}" onclick="setTeamOfficialOverviewFilter('${card.key}')" aria-pressed="${_teamOfficialOverviewFilter===card.key?'true':'false'}" aria-label="${card.label} ${card.value}명 명단 보기"><b>${card.value}</b><span>${card.label}</span></button>`).join('')}</div>
    ${_officialPaceHtml(d)}
    ${_resultAlertHtml(d)}
    ${_officialJumpHtml(d)}
    ${detail}
    ${/* 확인해야 할 사람(대체가 필요한 자리)은 **운영 기록 바로 위**에 둡니다
         — 운영자 2026-08-12. 위쪽은 숫자와 바로가기로 훑는 자리고, 아래쪽이
         "무슨 일이 있었나 · 무엇을 손봐야 하나"를 읽는 자리입니다. */''}
    ${_substituteHintHtml(d)}
    ${_officialQualityHtml(d)}
    ${_officialLogHtml(d)}
  </section>`;
}

/**
 * 진행 속도 — **얼마나 왔고, 언제 끝나는가** (운영자 2026-08-12).
 *
 * 임원이 가장 자주 답해야 하는 질문이 "몇 시에 끝나요?"입니다. 관리자 화면에만
 * 있던 예상 시간을 현장 쪽으로 가져오되, 출발 전 어림값이 아니라 **끝난 라운드의
 * 실제 소요**로 다시 잽니다. 진행률 막대는 남은 양을 눈으로 보여 줍니다.
 */
function _officialPaceHtml(d){
  const matches=(d&&Array.isArray(d.matches))?d.matches:[];
  if(!matches.length)return '';
  const done=matches.filter(_settled).length;
  const pct=Math.max(0, Math.min(100, Math.round(done/matches.length*100)));
  const t=_liveTimeLeft(d);
  /* 숫자는 **남은/전체**로 읽습니다 (운영자 2026-08-12 "21/25경기 이런 식으로",
     "관리자. 임원운영진 포함"). 관리자 대시보드와 방향을 맞춥니다 — 두 화면이
     같은 자리에서 반대 방향으로 세면 임원이 관리자에게 다른 숫자를 말하게 됩니다.
     완료된 양은 아래 막대가 보여 줍니다. */
  const leftMatches=matches.length-done;
  const rounds=[...new Set(matches.map(m=>Number(m&&m.round)||0))].filter(Boolean);
  // 근거(「라운드당 18분 실측」)는 **잘리면 안 됩니다** — 그 한마디가 숫자를
  // 믿을지 말지를 정합니다. 오른쪽 칸에 욱여넣지 않고 아래 줄을 통째로 씁니다.
  const sub=(t&&t.left>0)
    ? esc(_fmtClock(t.endAt))+' 끝 예정 · 라운드당 '+t.perRound+'분 '+esc(t.basis)
    : '';
  return '<div class="team-official-pace">'
    +'<div class="team-official-pace-top">'
      +'<span><b>'+leftMatches+'/'+matches.length+'</b><small>남은 경기</small></span>'
      +(t&&t.left>0?'<span><b>'+t.left+'/'+rounds.length+'</b><small>남은 라운드</small></span>':'')
      +'<em>'+(!t?'':t.left<=0?'<b class="done">경기 종료</b>'
              :'<b>'+esc(_fmtMinutes(t.minutes))+' 남음</b>')+'</em>'
    +'</div>'
    +(sub?'<div class="team-official-pace-sub">'+sub+'</div>':'')
    +'<div class="team-official-pace-bar"><span style="width:'+pct+'%"></span></div>'
  +'</div>';
}

/**
 * 대진 품질 — 관리자 화면의 「품질 점검」을 임원에게도 (운영자 2026-08-12
 * "품질 점검의 정보를 모두 추가해줘 보게").
 *
 * 종목 분포와 경기·라운드 수는 대진에서 직접 셉니다. 등급·상태·실전 특이사항은
 * 참가자 이력과 급수차로 계산되는 값이라 회원 화면에서는 다시 만들 수 없어,
 * 관리자가 낸 결과를 게시본(`quality`)에서 그대로 읽습니다.
 * 경기 중에 늘 펼쳐 둘 정보는 아니라 **접어 둡니다**.
 */
var _officialQualityOpen=false;
function _officialQualityHtml(d){
  if(!_canFixResult(d))return '';
  const matches=(d&&Array.isArray(d.matches))?d.matches:[];
  if(!matches.length)return '';
  const q=(d&&d.quality)||null;
  const rounds=[...new Set(matches.map(m=>Number(m&&m.round)||0))].filter(Boolean).length;
  const types={};
  matches.forEach(m=>{ const t=String((m&&m.type)||'경기'); types[t]=(types[t]||0)+1; });
  const t=_liveTimeLeft(d);
  const cells=[
    ['총 경기', matches.length],
    ['라운드', rounds],
    ['예상 시간', t?_fmtMinutes(rounds*(t.perRound||0)):'—']
  ].concat(Object.keys(types).map(k=>[k, types[k]]));
  const grid=cells.map(([l,v])=>'<span><b>'+esc(String(v))+'</b><small>'+esc(l)+'</small></span>').join('');
  const badge=q&&q.grade
    ? '<div class="team-official-quality-badge q-'+esc(q.grade)+'">'
        +'<b>'+esc(String(q.score))+'</b><small>'+esc(q.grade)+' · '+esc(q.gradeLabel||'')+'</small></div>'
    : '';
  const status=q&&q.opTitle
    ? '<div class="team-official-quality-status '+esc(q.opClass||'ok')+'">'
        +'<b>'+esc(q.opTitle)+'</b><small>'+esc(q.opSub||'')+'</small></div>'
    : '';
  const issues=(q&&Array.isArray(q.issues)&&q.issues.length)
    ? '<div class="team-official-quality-issues"><div class="t">실전 특이사항</div>'
        +q.issues.map(x=>'<div>'+esc(x)+'</div>').join('')+'</div>'
    : '';
  const head=q&&q.sub?esc(q.sub):'대진 구성 요약';
  return '<details class="team-official-quality"'+(_officialQualityOpen?' open':'')
    +' ontoggle="_officialQualityOpen=this.open"><summary>대진 품질 점검</summary>'
    +'<div class="team-official-quality-body">'
      +(badge||status?'<div class="team-official-quality-head">'+badge+status+'</div>':'')
      +'<div class="team-official-quality-sub">'+head+'</div>'
      +'<div class="team-official-quality-grid">'+grid+'</div>'
      +issues
    +'</div></details>';
}

/* 지금 메워야 하는 자리 — 대진표에서 이름이 눌리는 자리와 **같은 규칙**입니다.
   지각은 지금 라운드만, 불참은 남은 경기 전부(운영자 2026-08-14).
   숫자는 운영 현황 타일로만 쓰고, 들어가는 문은 대진표의 이름 하나뿐입니다. */
/* 대시보드에서 자주 가는 곳으로 바로 가기 (운영자 2026-08-14 "대시보드에 팀명단 등
   바로가기"). 접혀 있으면 펴고, 그 자리로 스크롤합니다 — 임원이 폰에서 아래로
   한참 내리지 않아도 되게. 새 화면을 만들지 않고 **있는 자리로 보냅니다**. */
function _officialJumpHtml(d){
  if(!_canFixResult(d))return '';
  const roster=_usesFixedTeams(d)?'팀 명단':'명단';
  const cells=[
    '<button type="button" onclick="jumpToLiveSection(\'mvp\')">🏆 MVP</button>',
    '<button type="button" onclick="jumpToLiveSection(\'roster\')">🧑‍🤝‍🧑 '+esc(roster)+'</button>',
    // 「지금 경기」는 뺐습니다 — 운영 현황 바로 아래가 이미 지금 경기라
    // 스스로에게 가는 버튼이었습니다(운영자 2026-08-12).
    '<button type="button" onclick="jumpToLiveSection(\'bracket\')">🗂 전체 대진표</button>'
  ];
  // 「승패·미실시」 칸은 없앴습니다 — 승패는 이제 **경기 카드에서 바로** 누르고,
  // 다시 누르면 지워집니다(운영자 2026-08-12). 시트는 서로 다르게 입력된 경기를
  // 모아 보여 줄 때만 붉은 알림을 통해 열립니다.
  // 이동(위 줄)과 처리(아래 줄)를 갈라 둡니다. 한 격자에 섞으면 처리 버튼이
  // 셋째 칸 옆에 혼자 남아 줄이 어중간하게 비었습니다.
  const acts=[];
  const last=_lastOfficialAction(d);
  if(last){
    acts.push('<button type="button" class="act" onclick="undoTeamOfficialAction()" title="'
      +esc(last.label)+'">↩️ 되돌리기</button>');
  }
  /* 마무리는 **끝이 보일 때** 뜹니다 — 경기가 다 끝났거나, 마지막 라운드에
     들어섰을 때. 예전에는 전부 끝나야만 떴는데, 카드에서 「미실시」를 뗀 뒤로는
     못 치른 경기를 그렇게 표시할 길이 없어 마무리 자체가 영영 안 뜨게 됩니다.
     안 치른 경기가 남았으면 마무리에서 몇 경기인지 알려 주고 한 번 묻습니다. */
  const matches=(d&&d.matches)||[];
  const done=!!(matches.length&&matches.every(_settled));
  const rounds=matches.map(m=>Number(m&&m.round)||0);
  const lastRound=rounds.length?Math.max(...rounds):0;
  const onLastRound=!!(lastRound&&Number((d&&d.currentRound)||0)>=lastRound);
  if(_liveFinished(d)){
    acts.push('<button type="button" class="act" onclick="finishTeamLive()">🔓 마무리 해제</button>');
  }else if(done||onLastRound){
    acts.push('<button type="button" class="act" onclick="finishTeamLive()">🏁 팀전 마무리</button>');
  }
  return '<div class="team-official-jump">'+cells.join('')+'</div>'
    +(acts.length?'<div class="team-official-jump acts">'+acts.join('')+'</div>':'');
}
/**
 * 운영 기록 — **누가 언제 무엇을 바꿨는지**.
 *
 * 서버에는 조작마다 기록이 쌓이는데 화면에서는 마지막 하나(되돌리기 이름표)밖에
 * 볼 수 없었습니다. 임원이 여럿이면 "이 경기 승패 누가 고쳤지?"를 물을 데가
 * 없어 결국 관리자를 부르게 됩니다. 기록이 있을 때만 접힌 채로 붙습니다.
 */
function _officialLogTime(at){
  const t=Number(at)||0;
  if(!t)return '';
  const dt=new Date(t);
  if(isNaN(dt.getTime()))return '';
  return ('0'+dt.getHours()).slice(-2)+':'+('0'+dt.getMinutes()).slice(-2);
}
function _officialLogHtml(d){
  if(!_canFixResult(d))return '';
  const log=(d&&Array.isArray(d.officialLog))?d.officialLog:[];
  const rows=log.filter(e=>e&&e.label);
  if(!rows.length)return '';
  const recent=rows.slice(-20).reverse();
  const items=recent.map(e=>{
    const time=_officialLogTime(e.at);
    const by=String(e.by||'').trim();
    return '<li><span class="team-official-log-when">'+esc(time||'·')+'</span>'
      +'<b>'+esc(String(e.label))+'</b>'
      +(by?'<small>'+esc(by)+'</small>':'')+'</li>';
  }).join('');
  const more=rows.length>recent.length?'<div class="team-official-log-more">최근 '+recent.length+'건만 보여 줍니다 (전체 '+rows.length+'건)</div>':'';
  return '<details class="team-official-log"'+(_officialLogOpen?' open':'')
    +' ontoggle="_officialLogOpen=this.open"><summary>운영 기록 '+rows.length+'건</summary>'
    +'<ol class="team-official-log-list">'+items+'</ol>'+more+'</details>';
}
var _officialLogOpen=false;

function jumpToLiveSection(key){
  const open=el=>{ if(el&&el.tagName==='DETAILS'&&!el.open){ el.open=true;
    if(el.id==='teamRoster')_teamRosterOpen=true;
    if(el.id==='fullBracket')_viewerDetailsOpen.fullBracket=true; } };
  let el=null;
  if(key==='roster')el=document.getElementById('teamRoster');
  else if(key==='bracket')el=document.getElementById('fullBracket');
  else if(key==='mvp')el=document.getElementById('mvpBoard');
  else el=document.querySelector('.current-panel')||document.querySelector('.next-panel');
  if(!el)return;
  open(el);
  _smoothScroll(()=>el.scrollIntoView({behavior:'smooth',block:'start'}),
                ()=>el.scrollIntoView());
}

/* 버튼이 아니라 **안내 한 줄**입니다. 누를 곳은 대진표의 이름이니,
   여기에 또 버튼을 두면 진입점이 둘이 됩니다. 메울 자리가 있을 때만 나옵니다. */
function _substituteHintHtml(d){
  if(!_canSubstitute(d))return '';
  const pending=_pendingSubstitutions(d);
  if(!pending.length)return '';
  const names=[...new Set(pending.map(p=>p.name))];
  const shown=names.slice(0,3).map(esc).join(' · ');
  const more=names.length>3?` 외 ${names.length-3}명`:'';
  return `<div class="team-official-overview-hint">${shown}${more} — 지금·다음 대진에서 이름을 누르면 교체</div>`;
}
function _pendingSubstitutions(d){
  // 이름은 누구나 눌리지만(임원 재량 교체), 안내 줄은 제외자 — 메워야 할 자리 — 만 셉니다.
  const out=[];
  ((d&&d.matches)||[]).forEach(m=>{
    [...(m.t1||[]),...(m.t2||[])].forEach(name=>{
      if(name&&_lateOn(name)&&_replaceableInMatch(d,m,name)){
        out.push({num:Number(m.num),round:Number(m.round),court:Number(m.court),name});
      }
    });
  });
  return out;
}
/* 누른 그 자리 하나만 다룹니다 — 대진표에서 이름을 눌러 들어오기 때문에
   "어느 경기의 누구"가 이미 정해져 있습니다(운영자 2026-08-14). */
/* 후보를 **팀으로 묶어** 보여 줍니다 (운영자 2026-08-14 "우리팀/상대팀 한 눈에").
   급수 부호는 글자색(+빨강/−파랑)이라 청·홍 팀 색과 부딪히기 때문에, 팀 구분은
   **묶음 제목과 카드 테두리**로 못박고 카드 배경에는 급수 색을 쓰지 않습니다. */
function _substituteGroupsHtml(d,match,outName,cands){
  const outTeam=_teamOfName(d,outName);
  const sameLabel=outTeam==='red'?liveTeamLabel(d,'red'):outTeam==='blue'?liveTeamLabel(d,'blue'):'';
  const otherLabel=outTeam==='red'?liveTeamLabel(d,'blue'):outTeam==='blue'?liveTeamLabel(d,'red'):'';
  const sameCls=outTeam==='red'?'red':'blue';
  const otherCls=outTeam==='red'?'blue':'red';
  const chip=c=>{
    const mark=_balanceMark(c);
    const team=c.crossTeam?otherCls:sameCls;
    return `<button type="button" class="team-sub-cand team-${team} ${c.crossTeam?'cross':''} ${mark.cls}"
      onclick="submitTeamSubstitute(${Number(match.num)},'${esc(outName)}','${esc(c.name)}',{crossTeam:${c.crossTeam?'true':'false'},balance:${Number(c.balance)||0}})">
      ${esc(c.name)}<small>${esc(mark.text)} · ${Number(c.games)||0}경기</small></button>`;
  };
  const block=(title,cls,list)=>list.length
    ?`<div class="team-sub-group ${cls}"><div class="team-sub-group-head">${esc(title)}<em>${list.length}명</em></div>
       <div class="team-sub-cands">${list.map(chip).join('')}</div></div>`
    :'';
  const mine=cands.filter(c=>!c.crossTeam);
  const theirs=cands.filter(c=>c.crossTeam);
  if(!outTeam)return `<div class="team-sub-cands">${cands.map(chip).join('')}</div>`;
  return block(`같은 팀${sameLabel?' · '+sameLabel:''}`,'same',mine)
    +block(`상대 팀${otherLabel?' · '+otherLabel:''}`,'other',theirs);
}
function openTeamSubstitutePanel(matchNum,outName){
  const d=window._lastLiveData;
  if(!d)return;
  if(!_canSubstitute(d))return alert('단장·부단장·클럽 임원만 대체 투입을 할 수 있어요.');
  const match=_matchByNum(d,matchNum);
  const name=String(outName||'');
  if(!match||!name)return alert('교체할 선수를 다시 눌러주세요.');
  if(match.win)return alert('이미 결과가 입력된 경기입니다.');
  const box=document.getElementById('teamSubstitutePanel')||(()=>{
    const el=document.createElement('div');
    el.id='teamSubstitutePanel';
    el.className='team-sub-panel';
    document.body.appendChild(el);
    return el;
  })();
  const cands=_substituteCandidates(d,match,name);
  box.innerHTML=`<div class="team-sub-card">
    <div class="team-sub-head"><b>${esc(name)} 대신 넣기</b>
      <button type="button" onclick="closeTeamSubstitutePanel()" aria-label="닫기">✕</button></div>
    <div class="team-sub-body">
      <div class="team-sub-row">
        <div class="team-sub-who"><b>제외 · ${match.round}라운드 ${match.court}코트</b>
          <small>${esc([...(match.t1||[])].join(' · '))} vs ${esc([...(match.t2||[])].join(' · '))}</small></div>
        ${cands.length?_substituteGroupsHtml(d,match,name,cands)
          :'<div class="team-sub-empty">넣을 수 있는 선수가 없습니다. 제외가 아닌 대기 선수가 있어야 합니다.</div>'}
      </div>
    </div>
  </div>`;
  box.classList.add('show');
}
function closeTeamSubstitutePanel(){
  const box=document.getElementById('teamSubstitutePanel');
  if(box)box.classList.remove('show');
}

// ── 승패 정정 (운영자 2026-08-13, 4단계에서 드러난 막다른 길) ────────────────
// 승패는 한 번 들어가면 아무도 못 고쳤다 — 다른 값을 넣으면 「관리자 확인으로
// 보냈어요」로 넘어갈 뿐이고, 그 관리자는 이제 최초 생성만 하고 손을 뗀다.
// 현장에서 잘못 눌린 승패가 영원히 굳는다는 뜻이라, 임원이 자기 폰에서 고친다.
function _canFixResult(d){
  return _canSubstitute(d);
}
function _resultConflictKeys(d){
  const rows=(d&&d.resultConflicts)||{};
  return new Set(Object.keys(rows).filter(k=>Object.keys(rows[k]||{}).length));
}
/* 이 시트에서 손볼 수 있는 경기 = **결과가 들어간 경기**와 **서로 다르게 입력된
   경기**. 아직 안 치른 경기는 카드에서 바로 넣으므로 여기 모을 이유가 없습니다
   (미실시가 없어진 뒤로는 더더욱 — 안 치른 경기에 여기서 할 일이 없습니다). */
function _fixableResults(d){
  const conflicts=_resultConflictKeys(d);
  return ((d&&d.matches)||[])
    .map(m=>({m,conflict:conflicts.has(_matchKey(m))}))
    .filter(x=>x.m&&(x.m.win||x.conflict))
    // 확인이 걸린 경기가 먼저, 그 다음은 최근 라운드부터.
    .sort((a,b)=>(Number(b.conflict)-Number(a.conflict))
      ||(Number(b.m.round||0)-Number(a.m.round||0))
      ||(Number(a.m.court||0)-Number(b.m.court||0)));
}
function _resultAlertHtml(d){
  if(!_canFixResult(d))return '';
  const rows=_fixableResults(d);
  if(!rows.length)return '';
  // 서로 다르게 입력된 것만 **붉은 알림**으로 올립니다. 평상시 「승패·미실시」는
  // 아래 도구 줄에 있습니다 — 늘 떠 있으면 대시보드가 시끄럽습니다
  // (운영자 2026-08-15 "승패 미실시 처리/되돌리기는 별 필요 없지 않아?").
  const conflicts=rows.filter(x=>x.conflict).length;
  if(!conflicts)return '';
  return `<button type="button" class="team-official-overview-conflict"
    onclick="openTeamResultPanel()">승패 확인 ${conflicts}건 · 눌러서 바로 정정</button>`;
}
function openTeamResultPanel(){
  const d=window._lastLiveData;
  if(!d)return;
  if(!_canFixResult(d))return alert('단장·부단장·클럽 임원만 승패를 정정할 수 있어요.');
  const rows=_fixableResults(d);
  if(!rows.length)return alert('아직 정정할 승패가 없습니다.');
  const box=document.getElementById('teamResultPanel')||(()=>{
    const el=document.createElement('div');
    el.id='teamResultPanel';
    el.className='team-sub-panel';
    document.body.appendChild(el);
    return el;
  })();
  const blueLabel=liveTeamLabel(d,'blue'), redLabel=liveTeamLabel(d,'red');
  box.innerHTML=`<div class="team-sub-card">
    <div class="team-sub-head"><b>승패 정정</b>
      <button type="button" onclick="closeTeamResultPanel()" aria-label="닫기">✕</button></div>
    <div class="team-sub-body">${rows.map(({m,conflict})=>{
      const num=Number(m.num);
      const win=String(m.win||'');
      const t1=(m.t1||[]).filter(Boolean).join(' · ');
      const t2=(m.t2||[]).filter(Boolean).join(' · ');
      const cur=win==='t1'?blueLabel:win==='t2'?redLabel:'결과 없음';
      const actions=`<button type="button" class="team-sub-cand ${win==='t1'?'on':''}"
             onclick="submitTeamResult(${num},'t1','${esc(win)}')">${esc(blueLabel)}<small>승</small></button>
           <button type="button" class="team-sub-cand ${win==='t2'?'on':''}"
             onclick="submitTeamResult(${num},'t2','${esc(win)}')">${esc(redLabel)}<small>승</small></button>
           ${win?`<button type="button" class="team-sub-cand clear"
             onclick="submitTeamResult(${num},'','${esc(win)}')">결과 지움<small>다시 입력</small></button>`:''}`;
      return `<div class="team-sub-row${conflict?' warn':''}">
        <div class="team-sub-who"><b>${conflict?'⚠ ':''}${m.round}라운드 ${m.court}코트 · ${num}번</b>
          <small>${esc(t1)} vs ${esc(t2)} · 지금 ${esc(cur)}${conflict?' · 서로 다르게 입력됨':''}</small></div>
        <div class="team-sub-cands">${actions}</div>
      </div>`;
    }).join('')}</div>
  </div>`;
  box.classList.add('show');
}
function closeTeamResultPanel(){
  const box=document.getElementById('teamResultPanel');
  if(box)box.classList.remove('show');
}
/* 임원 명령 한 줄 보내기 — 교체·정정·미실시·이름·코트·되돌리기가 모두 이 길을 씁니다. */
async function _sendTeamOfficialCommand(kind, command, okMessage){
  const d=window._lastLiveData;
  const viewer=_viewerInfo(d);
  if(!viewer)return alert('내 이름을 먼저 선택해주세요.');
  if(!_canFixResult(d))return alert('단장·부단장·클럽 임원·운영 도우미만 처리할 수 있어요.');
  if(!liveId||!window.firebase||!firebase.functions)return alert('연결을 확인해주세요.');
  try{
    const callable=firebase.functions().httpsCallable('submitTeamOfficialRequest');
    const grantToken=await ensureTeamOfficialGrant(d);
    if(!grantToken)return alert(_teamGrantFailMessage());
    const res=await callable({liveId,grantToken,command:{
      operationId:kind+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7),
      actorPlayerName:viewer.n||viewer.name||'',
      expiresAt:Date.now()+10*60*1000,
      ...command
    }});
    const data=res&&res.data;
    if(data&&data.ok){ if(okMessage)alert(okMessage); return true; }
    alert((data&&data.reason)||'처리하지 못했습니다.');
  }catch(err){
    alert('요청을 보내지 못했습니다. 잠시 후 다시 시도해주세요.');
  }
  return false;
}

/* 코트 번호 정정 — 실제로 쓰는 코트와 화면이 다를 때. */
async function changeTeamCourt(matchNum){
  const d=window._lastLiveData;
  const match=_matchByNum(d,matchNum);
  if(!match)return alert('경기를 다시 확인해주세요.');
  if(!_canFixResult(d))return alert('단장·부단장·클럽 임원·운영 도우미만 처리할 수 있어요.');
  const courts=Math.max(1,Number(d&&d.courts)||0);
  const raw=prompt(`${match.round}라운드 ${matchNum}번 경기의 코트 번호를 바꿉니다.`
    +`\n1 ~ ${courts} 중에서 입력해 주세요.`, String(match.court||''));
  const to=Number((raw||'').trim());
  if(!to||to===Number(match.court))return;
  const clash=((d&&d.matches)||[]).find(m=>Number(m.round)===Number(match.round)
    && Number(m.court)===to && Number(m.num)!==Number(matchNum));
  if(clash&&!confirm(`${to}코트는 ${clash.num}번 경기가 씁니다.\n두 경기의 코트를 맞바꿀까요?`))return;
  await _sendTeamOfficialCommand('tct', {type:'team-official-court', matchNum:Number(matchNum),
    court:to, allowSwap:!!clash}, `${matchNum}번 경기를 ${to}코트로 옮겼습니다.`);
}

/**
 * 팀전 마무리 — 임원이 끝을 선언합니다.
 * 관리자의 「팀전 종료」와 다릅니다: 데이터를 지우지 않으므로 최종 점수와
 * 뒷풀이 명단은 회원 링크에 그대로 남습니다.
 */
function _liveFinished(d){ return !!Number(d&&d.finishedAt); }
async function finishTeamLive(){
  const d=window._lastLiveData;
  if(!_canFixResult(d))return alert('단장·부단장·클럽 임원·운영 도우미만 처리할 수 있어요.');
  if(_liveFinished(d)){
    if(!confirm('마무리를 해제하고 다시 운영할까요?'))return;
    return void await _sendTeamOfficialCommand('tfin', {type:'team-official-finish', finished:false},
      '마무리를 해제했습니다.');
  }
  const left=((d&&d.matches)||[]).filter(m=>!_settled(m));
  if(left.length&&!confirm(`아직 결과가 없는 경기가 ${left.length}개 있습니다.\n그대로 마무리할까요?`))return;
  if(!left.length&&!confirm('팀전을 마무리할까요?\n최종 결과가 회원 화면에 그대로 남습니다.'))return;
  await _sendTeamOfficialCommand('tfin', {type:'team-official-finish', finished:true,
    allowUnfinished:true}, '팀전을 마무리했습니다.');
}

/**
 * 명단 고치기 — 갑자기 한 명 더 오거나, 못 오게 됐을 때.
 * 뺄 때는 서버가 「아직 안 끝난 경기에 이름이 있으면」 막습니다(대체 투입이 먼저).
 */
async function addTeamPlayer(){
  const d=window._lastLiveData;
  if(!_canFixResult(d))return alert('단장·부단장·클럽 임원·운영 도우미만 처리할 수 있어요.');
  const name=(prompt('명단에 추가할 선수 이름을 입력해 주세요.')||'').trim();
  if(!name)return;
  const fixed=_usesFixedTeams(d);
  let team='';
  if(fixed){
    const blue=liveTeamLabel(d,'blue')||'청 팀';
    const red=liveTeamLabel(d,'red')||'홍 팀';
    const pick=(prompt(`${name} 선수를 어느 팀에 넣을까요?\n1 = ${blue}\n2 = ${red}`,'1')||'').trim();
    if(pick!=='1'&&pick!=='2')return;
    team=pick==='2'?'red':'blue';
  }
  const level=Number((prompt(`${name} 선수의 급수를 숫자로 입력해 주세요. (예: 4)`,'4')||'').trim());
  if(!level||level<1)return alert('급수를 숫자로 입력해 주세요.');
  const grade=(prompt(`${name} 선수의 등급을 입력해 주세요. (없으면 비워 두세요)`,'')||'').trim();
  await _sendTeamOfficialCommand('trs', {type:'team-official-roster', action:'add',
    playerName:name, team, level, grade}, `${name} 선수를 명단에 넣었습니다.`);
}
/* 되돌리기 — 마지막 조작 하나. 무엇을 되돌리는지 이름으로 확인받습니다. */
function _lastOfficialAction(d){
  const log=(d&&d.officialLog)||[];
  const last=Array.isArray(log)?log[log.length-1]:null;
  return last&&last.label?last:null;
}
async function undoTeamOfficialAction(){
  const d=window._lastLiveData;
  const last=_lastOfficialAction(d);
  if(!last)return alert('되돌릴 조작이 없습니다.');
  if(!confirm(`마지막 조작을 되돌립니다.\n\n「${last.label}」\n\n되돌릴까요?`))return;
  await _sendTeamOfficialCommand('tundo', {type:'team-official-undo', expectedLabel:String(last.label)},
    `되돌렸습니다 — ${last.label}`);
}

/* 같은 팀을 다시 누르면 지웁니다 — 상태는 누르는 순간의 데이터에서 읽습니다
   (버튼 HTML 에 박아 두면 화면이 갱신되기 전 옛 값으로 보낼 수 있습니다). */
async function toggleTeamWin(matchNum,side){
  const d=window._lastLiveData;
  const m=_matchByNum(d,matchNum);
  if(!m)return alert('경기를 다시 확인해주세요.');
  const cur=String(m.win||'');
  return submitTeamResult(Number(matchNum), cur===side?'':side, cur);
}

async function submitTeamResult(matchNum,win,expectedWin){
  const d=window._lastLiveData;
  const match=_matchByNum(d,matchNum);
  const viewer=_viewerInfo(d);
  if(!match||!viewer)return alert('경기를 다시 확인해주세요.');
  if(!_canFixResult(d))return alert('단장·부단장·클럽 임원만 승패를 정정할 수 있어요.');
  const blueLabel=liveTeamLabel(d,'blue'), redLabel=liveTeamLabel(d,'red');
  const to=win==='t1'?blueLabel+' 승':win==='t2'?redLabel+' 승':'결과 없음';
  const where=`${match.round}라운드 ${match.court}코트 ${matchNum}번 경기`;
  const ask=!win
    ? `${where}의\n승패를 지울까요?`
    : String(expectedWin||'')
      ? `${where}를\n「${to}」 로 바꿀까요?`
      : `${where}\n승자를 「${to}」 로 입력할까요?`;
  if(!confirm(ask))return;
  if(!liveId||!window.firebase||!firebase.functions)return alert('연결을 확인해주세요.');
  try{
    const callable=firebase.functions().httpsCallable('submitTeamOfficialRequest');
    const grantToken=await ensureTeamOfficialGrant(d);
    if(!grantToken)return alert(_teamGrantFailMessage());
    const res=await callable({liveId,grantToken,command:{
      type:'team-official-result',
      operationId:'tres_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7),
      actorPlayerName:viewer.n||viewer.name||'',
      matchNum:Number(matchNum), win:String(win||''),
      expectedWin:String(expectedWin||''),
      expiresAt:Date.now()+10*60*1000
    }});
    const data=res&&res.data;
    if(data&&data.ok){
      closeTeamResultPanel();
      alert(String(expectedWin||'')
        ? `${matchNum}번 경기를 「${to}」 로 바꿨습니다.`
        : `${matchNum}번 경기 승자를 「${to}」 로 입력했습니다.`);
    }else alert((data&&data.reason)||'승패를 정정하지 못했습니다.');
  }catch(err){
    alert('승패 정정을 보내지 못했습니다. 잠시 후 다시 시도해주세요.');
  }
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
  const isCurrent=next.round===cur;
  const label=isCurrent?'지금 경기':'다음 경기';
  const where='R'+esc(String(next.round||'-'))+' · '+esc(String(next.court||'-'))+'코트';
  return '<div class="viewer-next-card'+(isCurrent?' is-current':'')+'">'
    +'<div class="viewer-next-top"><span class="viewer-next-label">'+label+'</span><span class="viewer-next-where">'+where+'</span></div>'
    +_viewerMatchBoardHtml(next,next._side,d)
    +'<div class="viewer-next-type">'+esc(next.type||'경기')+(next.isFiller?' · 보완':'')+'</div>'
  +'</div>';
}

function _viewerScheduleHtml(d,current){
  const future=_viewerMatches(d,current.n).filter(m=>!_settled(m)).sort((a,b)=>(a.round-b.round)||(a.court-b.court));
  if(future.length<=1) return '';
  return '<details class="viewer-schedule" '+(_viewerDetailsOpen.schedule?'open':'')+' ontoggle="setViewerDetailsOpen(\'schedule\',this.open)">'
    +'<summary>전체 예정 경기 '+future.length+'개</summary>'
    +'<div class="viewer-schedule-list">'
      +future.map(m=>'<div class="viewer-schedule-item"><span>R'+esc(String(m.round||'-'))+' · '+esc(String(m.court||'-'))+'코트</span>'+_viewerMatchBoardHtml(m,m._side,d)+'</div>').join('')
    +'</div>'
  +'</details>';
}

function _viewerStatusButtons(current){
  const nameArg=JSON.stringify(current.n).replace(/"/g,'&quot;');
  const teamKey=current.team||'';
  const lateOn=_lateOn(current.n);
  const partyOn=_partyOn(current.n);
  /* 내 카드에서는 **지각을 누르지 않습니다** (운영자 2026-08-12 "임원 외 운영자
     지각 버튼 삭제"). 지각은 남을 대상으로 하는 운영 행위라 팀 명단에서 합니다 —
     내 카드에 두면 임원이 자기 지각을 누르는 이상한 버튼이 됩니다.
     내가 지각으로 찍혀 있으면 그 사실만 알려 줍니다. */
  /* 「뒷풀이」 한 단어로는 **누르는 것인 줄 모릅니다** (운영자 2026-08-12
     "신청버튼이 있는지 모르는 사람들이 많네", "그걸 누르는 건지 모름").
     동사를 붙이고, 신청 전에는 꽉 찬 버튼으로 눈에 띄게 둡니다 — 예전에는
     신청 **전**이 옅은 라벨, 신청 **후**가 꽉 찬 버튼이라 정확히 거꾸로였습니다.
     누를 이유가 남은 쪽이 눈에 띄어야 합니다. */
  return '<div class="viewer-status-actions">'
    +(lateOn?'<span class="viewer-state-view on">제외</span>':'')
    +'<button type="button" class="viewer-state-btn party '+(partyOn?'on':'cta')+'"'
      +' onclick="toggleMemberParty('+nameArg+',\''+teamKey+'\')">'
      +(partyOn?'🍻 뒷풀이 신청함 · 누르면 취소':'🍻 뒷풀이 신청하기')+'</button>'
  +'</div>';
}

function buildViewerIdentity(d){
  const all=_allLiveMembers(d);
  if(!all.length) return '';
  const current=_viewerInfo(d);
  if(current){
    const team=current.team==='blue'?liveTeamLabel(d,'blue'):current.team==='red'?liveTeamLabel(d,'red'):'참가자';
    const partnerText=_viewerPartnerText(current);
    return '<section class="viewer-identity">'
      +'<div class="viewer-identity-row">'
        +'<div class="viewer-identity-main">'
          +'<div class="viewer-identity-k">내 경기</div>'
          +'<div class="viewer-identity-name">'+esc(current.n)+'님</div>'
          +'<div class="viewer-identity-role">'+esc(team)+' · '+esc(_viewerRoleText(current))+'</div>'
          +(partnerText?'<div class="viewer-identity-partner">'+esc(partnerText)+'</div>':'')
        +'</div>'
        +'<button type="button" onclick="setLiveViewerName(\'\')">변경</button>'
      +'</div>'
      +_viewerNextHtml(d,current)
      +_viewerStatusButtons(current)
      +_viewerRecordHtml(d,current.n)
      +_viewerScheduleHtml(d,current)
    +'</section>';
  }
  /* 참가자는 이름 하나만 누르면 끝이어야 합니다 (운영자 2026-08-14
     "참가자는 이름만 입력하면 본인 및 대진표 보기를 할 수 있도록 간소화").
     그래서 **전원을 다 보여 줍니다** — 예전에는 앞 12명만 나와서, 가나다 뒤쪽
     사람은 자기 이름이 없는 줄 알고 검색을 해야 했습니다. 대신 칸을 작게 만들고
     목록에 높이 제한을 둬서, 이름 고르기가 대진표를 화면 밖으로 밀지 않게 합니다. */
  const sorted=all.sort((a,b)=>String(a.n).localeCompare(String(b.n),'ko'));
  const q=String(_viewerSearchTerm||'').trim().toLowerCase();
  /* **검색하기 전에는 아무 이름도 보여 주지 않습니다** (운영자 2026-08-12
     "그냥 초성 입력 검색토록 해줘. 카드가 있으니까 다른 이름을 눌러 볼 것 같아").
     스무 명이 넘는 이름칸을 깔아 두면 자기 이름을 찾기보다 눈에 띄는 이름을
     눌러 보게 됩니다 — 그 순간 남의 이름으로 화면이 열립니다. */
  const filtered=q?sorted.filter(p=>_viewerSearchText(p,d).includes(q)):[];
  const cards=filtered.map(p=>{
    const teamCls=p.team==='blue'?'blue':p.team==='red'?'red':'';
    const nameArg=JSON.stringify(p.n).replace(/"/g,'&quot;');
    const memberArg=JSON.stringify(String(p.id||p.memberId||'')).replace(/"/g,'&quot;');
    // 팀은 색으로, 역할은 단장·부단장만. 나머지 설명은 이름 고르기에 필요 없습니다.
    const role=p.isLeader?'단장':p.isSub?'부단장':'';
    return '<button type="button" class="viewer-name-card '+teamCls+'" onclick="setLiveViewerName('+nameArg+','+memberArg+')">'
      +'<b>'+esc(p.n)+'</b>'
      +(role?'<span>'+esc(role)+'</span>':'')
    +'</button>';
  }).join('');
  const body=q
    ? '<div class="viewer-candidates">'
        +(cards||'<div class="viewer-empty-result">「'+esc(_viewerSearchTerm)+'」 로 찾은 이름이 없습니다.</div>')
      +'</div>'
    : '<div class="viewer-search-guide">내 이름을 찾으려면 <b>초성</b>이나 <b>이름</b>을 입력해 주세요'
      +'<small>예) ㄱㅁㅎ · 김민 · 민현 — 오늘 '+all.length+'명</small></div>';
  return '<section class="viewer-identity">'
    +'<div class="viewer-picker">'
      +'<div class="viewer-picker-title">내 이름 찾기</div>'
      +'<input id="liveViewerSearch" class="viewer-search-input" value="'+esc(_viewerSearchTerm||'')+'" oninput="setLiveViewerSearch(this.value)" placeholder="이름·초성 검색 예) 김민현, ㄱㅁㅎ">'
      +body
    +'</div>'
  +'</section>';
}

/* 청홍 팀전에서는 **임원·단장만** 승패를 입력합니다 (운영자 2026-08-14:
   "참가자는 그저 대진표를 보는 정도… 운영관리는 임원과 단장 위주로").
   자유대진은 예전 그대로 — 뛰는 선수가 직접 넣습니다. */
function _canSubmitResult(m,d){
  const viewer=_viewerInfo(d);
  if(!viewer || !m || _settled(m)) return false;
  if(_usesFixedTeams(d))return !!(viewer.isClubOfficial||viewer.isLeader||viewer.isSub||viewer.isTemporaryOperator);
  const names=[...(m.t1||[]),...(m.t2||[])].filter(Boolean);
  if(names.includes(viewer.n)) return true;
  if(_isTeamLiveData(d)&&viewer.isClubOfficial)return true;
  if(_isTeamLiveData(d)&&viewer.isTemporaryOperator)return true;
  return false;
}

// ── 팀전 대체 투입 (운영자 2026-08-13) ────────────────────────────────
// "갑작스런 불참 및 인원 변경… 땜방으로 진행하는 수밖에" — 임원이 현장에서
// 바로 메울 수 있어야 합니다. AI 는 후보를 좁혀 주고, 결정은 임원이 합니다.
function _canSubstitute(d){
  const viewer=_viewerInfo(d);
  if(!viewer||!_isTeamLiveData(d))return false;
  return !!(viewer.isClubOfficial||viewer.isLeader||viewer.isSub||viewer.isTemporaryOperator);
}
function _teamOfName(d,name){
  const key=_attKey(name);
  const mem=(d&&d.members)||{};
  if((mem.blue||[]).some(p=>_attKey(p.n||p.name)===key))return 'blue';
  if((mem.red||[]).some(p=>_attKey(p.n||p.name)===key))return 'red';
  return '';
}
function _matchByNum(d,num){
  return ((d&&d.matches)||[]).find(m=>Number(m&&m.num)===Number(num))||null;
}
/* 같은 라운드에 이미 이름이 올라간 사람은 후보에서 뺍니다(이중 출전 방지).
   **끝난 경기도 셉니다** — 방금 1코트에서 뛰고 나온 사람을 2코트에 넣으면
   그 라운드에 두 경기를 뛰게 됩니다(운영자 2026-08-14 확인). 서버 엔진의
   `conflictingMatch` 와 같은 규칙입니다. */
function _bookedInRound(d,name,round,exceptNum){
  const key=_attKey(name);
  return ((d&&d.matches)||[]).some(m=>{
    if(Number(m.num)===Number(exceptNum))return false;
    if(Number(m.round)!==Number(round))return false;
    if(m.voided)return false;   // 안 치르는 경기는 자리를 차지하지 않습니다
    return [...(m.t1||[]),...(m.t2||[])].some(n=>_attKey(n)===key);
  });
}
// AI 보조: 같은 팀 → 급수 근접 → 덜 뛴 순. 서버 엔진과 같은 기준입니다.
// 게시된 팀원 한 줄은 급수를 `l` 로 줄여 싣습니다(`_buildLiveState` 의 liveMember).
// `level` 만 읽으면 전원이 기본값 4가 되어 "급수 근접" 정렬이 죽습니다.
function _memberLevel(p){
  const raw=p&&(p.level!=null?p.level:p.l);
  const n=Number(raw);
  return Number.isFinite(n)&&n>0?n:4;
}
/* 실효 급수 — 급수 숫자에 **성별·나이**를 얹은 값입니다. 관리자 대진 생성
   (`effLevel`/`match-quality.js`)·서버 엔진(`memberEffLevel`)과 **같은 식**이라야
   세 곳이 같은 답을 냅니다.
   예전에는 급수 숫자만 봐서 30대 C(4)와 40대 C(4)가 같은 값이었습니다 — 실전에서
   40대로 교체해 놓고 "기울기 그대로"로 나왔습니다(운영자 2026-08-12). */
var _LIVE_AGE_BONUS={'20대':0,'30대':-0.2,'40대':-0.5,'50대':-1.2,'60대+':-2.0};
function _round1(v){ return Math.round((Number(v)||0)*10)/10; }
function _memberEffLevel(p){
  const level=_memberLevel(p);
  const g=String((p&&(p.gender||p.g))||'');
  const female=g==='F'||g==='여';
  const age=_LIVE_AGE_BONUS[String((p&&(p.ageGroup||p.a))||'')]||0;
  return _round1(level-(female?0.5:0)+age);
}
/* 넣고 난 뒤 두 팀 급수 합이 얼마나 벌어지는가 (운영자 2026-08-14
   "지각자 대체 시 급수 밸런스가 맞아야 해. 아무나 투입하면 상대에겐 불공정한
   게임이 되잖아"). 서버 엔진 `balanceGapAfter` 와 **같은 계산**입니다. */
function _levelOfName(d,name){
  const all=_allLiveMembers(d)||[];
  return _memberEffLevel(all.find(p=>_attKey(p.n||p.name)===_attKey(name)));
}
function _sideOfPlayer(match,name){
  const key=_attKey(name);
  if((match&&match.t1||[]).some(n=>_attKey(n)===key))return 't1';
  if((match&&match.t2||[]).some(n=>_attKey(n)===key))return 't2';
  return '';
}
/* **부호가 있는** 기울기: 교체하는 쪽 급수 합 − 상대 급수 합.
   양수면 교체한 팀이 세고(상대에게 불합리), 음수면 그 팀이 약합니다.
   서버 엔진 `balanceAfter` 와 같은 계산입니다. */
function _balanceAfter(d,match,outName,inLevel){
  const side=_sideOfPlayer(match,outName);
  if(!side)return 0;
  const other=side==='t1'?'t2':'t1';
  const sum=(list,swapName,swapLevel)=>(list||[]).reduce((s,n)=>
    s+(swapName&&_attKey(n)===_attKey(swapName)?Number(swapLevel)||4:_levelOfName(d,n)),0);
  return sum(match[side],outName,inLevel)-sum(match[other],'',0);
}
function _balanceGapAfter(d,match,outName,inLevel){
  return Math.abs(_balanceAfter(d,match,outName,inLevel));
}
function _substituteCandidates(d,match,outName){
  const inMatch=new Set([...(match.t1||[]),...(match.t2||[])].map(_attKey));
  const outTeam=_teamOfName(d,outName);
  const all=_allLiveMembers(d)||[];
  const outMember=all.find(p=>_attKey(p.n||p.name)===_attKey(outName));
  const outLevel=_memberEffLevel(outMember);
  const games=new Map();
  ((d&&d.matches)||[]).forEach(m=>[...(m.t1||[]),...(m.t2||[])].forEach(n=>{
    const k=_attKey(n); games.set(k,(games.get(k)||0)+1);
  }));
  return all
    .map(p=>({name:p.n||p.name,level:_memberEffLevel(p),
      grade:String(p.grade||p.gr||''),age:String(p.ageGroup||p.a||'')}))
    .filter(p=>p.name&&!inMatch.has(_attKey(p.name)))
    .filter(p=>!_bookedInRound(d,p.name,match.round,match.num))
    .map(p=>{
      const team=_teamOfName(d,p.name);
      return {...p,team,crossTeam:!!outTeam&&!!team&&team!==outTeam,
        levelGap:_round1(Math.abs(p.level-outLevel)),
        balance:_round1(_balanceAfter(d,match,outName,p.level)),
        balanceGap:_round1(_balanceGapAfter(d,match,outName,p.level)),
        // 빠지는 사람보다 세면 그 팀이 교체로 이득을 봅니다(양수 = 강해짐).
        swing:_round1(p.level-outLevel),
        games:games.get(_attKey(p.name))||0,
        late:_lateOn(p.name)};
    })
    .filter(c=>!c.late)
    // 같은 팀 → 0 에 가까운 순 → 같은 크기면 **덜 유리한 쪽**(음수) 먼저 → 덜 뛴 순
    // (서버 엔진과 같은 기준)
    .sort((a,b)=>Number(a.crossTeam)-Number(b.crossTeam)
      ||Math.abs(a.balance)-Math.abs(b.balance)
      ||Number(a.balance>0)-Number(b.balance>0)
      ||a.games-b.games||String(a.name).localeCompare(String(b.name),'ko'));
  // 자르지 않습니다 — 라운드를 동시에 끝내고 투입하면 그 순간 자유로운 사람이
  // 많아지는데(20명·2코트면 12명), 8명에서 잘라 내면 임원이 고를 수가 없습니다
  // (운영자 2026-08-14 "후보군을 보다 다양하게"). 추천 순서는 그대로 앞에 옵니다.
}
/* 기울기를 **부호**로 보여 줍니다 (운영자 2026-08-14 "기울이라고 되어 있는데
   헷갈려. +, - 로 표기하고 컬러는 +는 레드, -는 블루").
     +N (빨강) = 교체한 팀이 N 만큼 **세짐** → 사람이 빠진 팀이 이득을 보는 꼴이라
                 상대에게 불합리하다
     −N (파랑) = 교체한 팀이 N 만큼 **약해짐** → 감수하는 쪽이니 경고까지는 아니다
   막지는 않고, 표시하고 한 번 물어봅니다. */
const TEAM_BALANCE_WARN_GAP=2;   // 이만큼 벌어지면 확인창
/* 실효 급수가 소수라 기울기도 소수입니다(30대 C 3.8 vs 40대 C 3.5).
   0.05 미만은 사실상 균형이라 「균형」으로 읽습니다. */
function _balanceMark(c){
  const b=_round1(Number(c&&c.balance)||0);
  const n=Math.abs(b);
  const txt=Number.isInteger(n)?String(n):n.toFixed(1);
  if(n<0.05)return {text:'균형',cls:''};
  if(b>0)return {text:'+'+txt,cls:'over'};
  return {text:'−'+txt,cls:'under'};
}
// 서명된 운영 권한 — 본인 이름을 고르면 서버가 내주고, 조작마다 함께 보냅니다.
// 이름만 실어 보내던 이전 단계의 위조 여지를 없앱니다(민턴LIVE 와 같은 구조).
let _teamGrantToken='', _teamGrantName='', _teamGrantExpiresAt=0, _teamGrantPending=null;
let _teamGrantError='';   // 서버가 알려 준 거절 사유(현장 진단용)
/* 기기 식별자 — 서버(`cleanClientId`)가 **16자 이상**만 받습니다. 그보다 짧으면
   교체를 눌렀을 때 「임원 기기 연결 정보를 다시 확인해 주세요」로 거절됩니다.
   예전 코드에는 그 길이를 못 맞추는 길이 둘 있었습니다(2026-08-14):
     · 저장이 막힌 브라우저(카톡 인앱·사생활 모드)의 대체값 `'tc_fallback'` = 11자
     · `Math.random().toString(36).slice(2,10)` 이 짧게 나오는 드문 경우
   이제 길이를 **보장해서** 만들고, 저장이 막혀도 이 탭 안에서는 같은 값을 씁니다. */
let _teamClientIdMemo='';
function _teamClientId(){
  if(_teamClientIdMemo)return _teamClientIdMemo;
  const clean=v=>String(v||'').replace(/[^a-zA-Z0-9_-]/g,'');
  const make=()=>{
    let s='';
    while(s.length<24)s+=Math.random().toString(36).slice(2);
    return clean('tc'+s).slice(0,32);
  };
  try{
    let id=clean(localStorage.getItem('kokmatch_team_client'));
    if(id.length<16)id='';            // 옛 짧은 값은 버리고 새로 만듭니다
    if(!id){
      id=make();
      localStorage.setItem('kokmatch_team_client',id);
    }
    _teamClientIdMemo=id;
    return id;
  }catch(e){
    _teamClientIdMemo=make();
    return _teamClientIdMemo;
  }
}
async function ensureTeamOfficialGrant(d){
  const viewer=_viewerInfo(d);
  const name=viewer&&(viewer.n||viewer.name)||'';
  if(!name||!_canSubstitute(d))return '';
  const fresh=_teamGrantToken&&_teamGrantName===name&&Date.now()<_teamGrantExpiresAt-60_000;
  if(fresh)return _teamGrantToken;
  if(_teamGrantPending)return _teamGrantPending;
  if(!liveId||!window.firebase||!firebase.functions){
    // 사유 없이 조용히 실패하면 현장에서 원인을 알 수 없습니다.
    _teamGrantError=!liveId?'팀전 링크를 읽지 못했습니다.':'서버 연결 모듈이 로드되지 않았습니다.';
    return '';
  }
  _teamGrantPending=(async()=>{
    try{
      const callable=firebase.functions().httpsCallable('claimTeamOfficialInvite');
      const res=await callable({liveId,clientId:_teamClientId(),name});
      const data=res&&res.data;
      if(data&&data.ok&&data.grantToken){
        _teamGrantToken=data.grantToken;
        _teamGrantName=data.playerName||name;
        _teamGrantExpiresAt=Number(data.expiresAt)||0;
        _teamGrantError='';
        return _teamGrantToken;
      }
    }catch(e){
      // 서버가 말해 준 이유를 그대로 들고 있습니다. 삼켜 버리면 현장에서
      // "확인하지 못했습니다"만 보고 원인을 알 길이 없습니다(2026-08-14).
      _teamGrantError=String(e&&(e.message||e.code)||'').trim();
    }
    return '';
  })().finally(()=>{ _teamGrantPending=null; });
  return _teamGrantPending;
}
// 연결이 안 될 때 띄울 문장 — 서버가 준 이유를 붙여 줍니다.
function _teamGrantFailMessage(){
  const why=_teamGrantError?('\n\n사유: '+_teamGrantError):'';
  return '임원 운영 연결을 확인하지 못했습니다.'+why
    +'\n\n내 이름을 다시 선택한 뒤 시도해 주세요.';
}
/* 「이미 시작한 경기」 = **지금 코트에서 뛰고 있는** 경기.
   `startAt` 은 그 코트가 이 경기 차례가 된 시각이라 **다음 라운드 경기에도 붙습니다**
   (「대진 임박」 안내가 그 값을 씁니다). 그래서 지금 라운드인지까지 함께 봅니다 —
   안 그러면 다음 대진을 미리 손볼 때마다 "이미 시작한 경기입니다"가 떴습니다
   (운영자 2026-08-14 실기기). `currentRound` 가 없는 옛 게시본은 예전처럼 봅니다. */
function _isMatchUnderway(d,m){
  if(!m||!m.startAt)return false;
  const cur=Number(d&&d.currentRound||0);
  return !cur||Number(m.round)===cur;
}
async function submitTeamSubstitute(matchNum,outName,inName,opts){
  const d=window._lastLiveData;
  const match=_matchByNum(d,matchNum);
  const viewer=_viewerInfo(d);
  if(!match||!viewer)return alert('경기를 다시 확인해주세요.');
  if(!_canSubstitute(d))return alert('단장·부단장·클럽 임원만 대체 투입을 할 수 있어요.');
  const crossTeam=!!(opts&&opts.crossTeam);
  if(crossTeam&&!confirm(inName+' 선수는 상대 팀입니다.\n그래도 이 경기에 넣을까요?\n\n팀 전력이 달라집니다.'))return;
  // 급수가 기울면 한 번 물어봅니다. 막지는 않습니다 — 판단은 임원 몫입니다.
  const balance=Number(opts&&opts.balance)||0;
  const side=_sideOfPlayer(match,outName);
  const swapped=(match[side]||[]).map(n=>_attKey(n)===_attKey(outName)?inName:n);
  const sum=list=>list.reduce((s,n)=>s+_levelOfName(d,n),0);
  const mine=sum(swapped), theirs=sum(match[side==='t1'?'t2':'t1']||[]);
  if(balance>0){
    // 가장 나쁜 경우 — 사람이 빠진 팀이 교체로 오히려 세집니다.
    if(!confirm(inName+' 선수를 넣으면 이 팀이 +'+balance+' 로 더 셉니다.'
      +'\n(우리 '+mine+' vs 상대 '+theirs+')'
      +'\n\n교체는 원래 그 팀이 감수하는 것이라, 이러면 상대가 불합리합니다.'
      +'\n그래도 넣을까요?'))return;
  }else if(Math.abs(balance)>=TEAM_BALANCE_WARN_GAP){
    if(!confirm(inName+' 선수를 넣으면 이 팀이 −'+Math.abs(balance)+' 로 약해집니다.'
      +'\n(우리 '+mine+' vs 상대 '+theirs+')\n\n승부가 기울 수 있어요.\n그래도 넣을까요?'))return;
  }
  if(_isMatchUnderway(d,match)&&!confirm('이미 시작한 경기입니다.\n그래도 선수를 바꿀까요?'))return;
  if(!liveId||!window.firebase||!firebase.functions)return alert('연결을 확인해주세요.');
  try{
    const callable=firebase.functions().httpsCallable('submitTeamOfficialRequest');
    const grantToken=await ensureTeamOfficialGrant(d);
    if(!grantToken)return alert(_teamGrantFailMessage());
    const res=await callable({liveId,grantToken,command:{
      type:'team-official-substitute',
      operationId:'tsub_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7),
      actorPlayerName:viewer.n||viewer.name||'',
      matchNum:Number(matchNum), outName:String(outName), inName:String(inName),
      allowCrossTeam:crossTeam, allowStarted:_isMatchUnderway(d,match),
      expectedT1:[...(match.t1||[])], expectedT2:[...(match.t2||[])],
      expiresAt:Date.now()+10*60*1000
    }});
    const data=res&&res.data;
    if(data&&data.ok){
      closeTeamSubstitutePanel();
      alert(outName+' → '+inName+' 로 바꿨습니다.');
    }
    else alert((data&&data.reason)||'대체 투입을 반영하지 못했습니다.');
  }catch(err){
    alert('대체 투입을 보내지 못했습니다. 잠시 후 다시 시도해주세요.');
  }
}

function _resultRoleForSubmit(d,m){
  const viewer=_viewerInfo(d);
  if(!viewer) return '';
  const names=[...(m&&m.t1||[]),...(m&&m.t2||[])].filter(Boolean);
  if(viewer.isClubOfficial) return 'clubOfficial';
  if(!_usesFixedTeams(d)&&viewer.isTemporaryOperator) return 'temporaryOperator';
  if(names.includes(viewer.n)) return 'player';
  if(viewer.isLeader) return 'leader';
  if(viewer.isSub) return 'sub';
  return 'member';
}

async function submitLiveWin(matchIdx,side){
  if(side!=='t1'&&side!=='t2')return;
  const d=window._lastLiveData;
  const matches=d&&Array.isArray(d.matches)?d.matches:[];
  const m=matches[matchIdx];
  const viewer=_viewerInfo(d);
  if(!m || !viewer){
    alert('내 이름을 먼저 선택해주세요.');
    return;
  }
  /* 청홍 팀전은 **입력도 정정도 서버 명령 한 길**로 갑니다 (운영자 2026-08-14
     "민턴라이브와 동일한 방식"). 브라우저가 데이터베이스에 직접 쓰지 않으므로
     권한·기록·중복 방지가 서버 한 곳에 모입니다. 자유대진은 아래 예전 경로. */
  if(_usesFixedTeams(d))return submitTeamResult(Number(m.num), side, String(m.win||''));
  if(!_canSubmitResult(m,d)){
    alert('이 경기 선수·단장/부단장·클럽 임원·자유대진 운영 도우미만 승패를 입력할 수 있어요.');
    return;
  }
  if(!liveDb || !liveId){
    alert('승패 입력을 저장할 수 없습니다. 잠시 후 다시 시도해주세요.');
    return;
  }
  const key=_matchKey(m);
  const nameKey=_attKey(viewer.n);
  const role=_resultRoleForSubmit(d,m);
  const memberId=viewer.id||viewer.memberId||'';
  try{
    let conflictExisting='';
    let missingMatch=false;
    let notCurrentMatch=false;
    let permissionRevoked=false;
    let confirmedName=viewer.n;
    let confirmedMemberId=memberId;
    let confirmedRole=role;
    const liveRef=liveDb.ref('live/'+liveId);
    const result=await liveRef.transaction(data=>{
      if(!data||!Array.isArray(data.matches)||!data.matches[matchIdx]){
        missingMatch=true;
        return;
      }
      const liveMatch=data.matches[matchIdx];
      const freshViewer=_viewerInfo(data);
      const freshMemberId=String(freshViewer?.id||freshViewer?.memberId||'');
      if(!freshViewer
        ||(memberId&&freshMemberId!==String(memberId))
        ||!_canSubmitResult({...liveMatch,win:null},data)){
        permissionRevoked=true;
        return;
      }
      confirmedName=freshViewer.n;
      confirmedMemberId=freshMemberId||memberId;
      confirmedRole=_resultRoleForSubmit(data,{...liveMatch,win:null});
      const rounds=[...new Set(data.matches.map(x=>x&&x.round).filter(Boolean))].sort((a,b)=>a-b);
      const currentRound=Number(data.currentRound)||rounds.find(r=>data.matches.filter(x=>x&&x.round===r).some(x=>!_settled(x)))||0;
      if(Number(liveMatch.round)!==Number(currentRound)){
        notCurrentMatch=true;
        return;
      }
      const existing=liveMatch.win||null;
      if(existing&&existing!==side){
        conflictExisting=existing;
        return;
      }
      const now=Date.now();
      if(!existing){
        liveMatch.win=side;
        liveMatch.winBy=confirmedName;
        liveMatch.winByMemberId=confirmedMemberId;
        liveMatch.winByRole=confirmedRole;
        liveMatch.winAt=now;
      }
      data.resultInputs=data.resultInputs||{};
      data.resultInputs[key]=data.resultInputs[key]||{};
      data.resultInputs[key][nameKey]={
        matchKey:key,matchIdx,side,
        byName:confirmedName,byMemberId:confirmedMemberId,byRole:confirmedRole,ts:now
      };
      let blueWins=0,whiteWins=0;
      if(_usesFixedTeams(data)){
        data.matches.forEach(x=>{
          if(x&&x.win==='t1')blueWins++;
          else if(x&&x.win==='t2')whiteWins++;
        });
      }
      data.blueWins=blueWins;
      data.whiteWins=whiteWins;
      data.currentRound=rounds.find(r=>data.matches.filter(x=>x&&x.round===r).some(x=>!_settled(x)))||0;
      data.updatedAt=now;
      return data;
    });
    if(!result.committed&&permissionRevoked){
      alert('운영 권한이 변경되었습니다. 최신 화면을 확인해 주세요.');
      return;
    }
    if(!result.committed&&notCurrentMatch){
      alert('현재 진행 중인 경기만 승패를 입력할 수 있어요. 화면을 새로 확인해주세요.');
      return;
    }
    if(!result.committed&&conflictExisting){
      await liveDb.ref('live/'+liveId+'/resultConflicts/'+key+'/'+nameKey).set({
        matchKey:key,matchIdx,requested:side,existing:conflictExisting,
        byName:confirmedName,byMemberId:confirmedMemberId,byRole:confirmedRole,
        ts:firebase.database.ServerValue.TIMESTAMP
      });
      alert('이미 다른 결과가 입력되어 관리자 확인으로 보냈어요.');
      return;
    }
    if(!result.committed||missingMatch){
      alert('경기 정보를 다시 불러온 뒤 시도해주세요.');
    }
  }catch(e){
    alert('승패 입력 실패: '+e.message);
  }
}

function _resultSideLabel(d,side){
  if(_usesFixedTeams(d))return side==='t1'?'청 승':'홍 승';
  return side==='t1'?'A 승':'B 승';
}

/**
 * 승패 입력 — **누른 버튼을 다시 누르면 꺼집니다** (운영자 2026-08-12).
 *
 *   "청팀 이긴 걸로 잘못 눌렀을 시 홍팀을 누르거나 … 다시 청팀을 눌러서
 *    버튼 꺼지게 하는 방식으로 승패 초기화하면 되잖아"
 *
 * 예전에는 결과가 한 번 들어가면 그 자리에 「입력 완료 · 청 승」 이라는 **글자만**
 * 남고, 고치려면 따로 「승패·미실시」 시트를 열어야 했습니다. 잘못 누른 걸
 * 알아차리는 곳과 고치는 곳이 달랐던 셈입니다. 이제 틀린 걸 본 그 자리에서
 * 바로 누릅니다 — 다른 팀을 누르면 바뀌고, 같은 팀을 누르면 지워집니다.
 *
 * 임원에게는 **지난 라운드 경기에서도** 이 버튼이 뜹니다(전체 대진표 포함).
 * 시트가 있던 진짜 이유가 "지난 경기에 손이 닿지 않아서" 였기 때문입니다.
 */
function buildResultInputControls(m,d,opts){
  const fixed=_usesFixedTeams(d);
  const canFix=fixed&&_canFixResult(d);
  const num=Number(m.num);
  /* 미실시는 화면에서 완전히 뺐습니다 (운영자 2026-08-12 "미실시 경기는 구조적으로
     발생하지 않아. 어떤 식으로든 결정을 해야 다음 라운드로 넘어가는 구조니까").
     옛 데이터에 남아 있을 수는 있으니 **읽기는** 그대로 둡니다 — 서버도 표시를
     이해하고, 여기서는 그렇게 찍힌 경기를 사실대로 보여만 줍니다. */
  if(m.voided)return '<div class="result-entry-done">미실시 · 치르지 않음</div>';
  if(canFix){
    const win=String(m.win||'');
    const nowRound=Number(m.round)===Number((d&&d.currentRound)||0);
    // 승패 버튼: 결과가 있으면 어디서든(전체 대진표 포함) 고칩니다. 없으면 **지금
    // 치르는 경기**에서만 넣습니다 — 아직 안 한 경기의 승패를 미리 넣을 일은 없습니다.
    const canEnter=!!(win || nowRound || opts.current);
    /* 「미실시」 딱지는 카드에서 뗐습니다 (운영자 2026-08-12 "미실시 딱지 떼").
       안 치르는 경기는 드문데 버튼은 열린 카드마다 붙어 있었습니다 — 방금 걷어낸
       잡음이 이름만 바꿔 돌아온 셈입니다. 안 치른 경기가 남은 채로 끝내려면
       **마무리에서 한 번 확인**하면 됩니다. 이미 미실시로 찍힌 경기는 위에서
       해제할 수 있고, 모아 보고 고치는 건 승패 정정 시트에 그대로 있습니다. */
    if(!canEnter) return '';
    const btn=side=>'<button type="button" class="'+(side==='t1'?'blue-win':'red-win')+(win===side?' on':'')+'"'
      +' aria-pressed="'+(win===side?'true':'false')+'"'
      +' onclick="toggleTeamWin('+num+',\''+side+'\')">'+_resultSideLabel(d,side)+'</button>';
    /* 「입력 필요」 배지·주황 테두리·깜빡임은 걷어냈습니다 (운영자 2026-08-12
       "예전에 사람들이 입력 안해서 그랬는데 이제 임원들에게도 권한 부여했으니
       이렇게 요란할 필요 없을 것 같아"). 입력할 사람이 정해져 있으면 화면이
       재촉할 이유가 없습니다. 버튼 두 개면 무엇을 하는 자리인지 압니다.
       설명은 **모르면 못 알아채는 것**에만 답니다 — 다시 눌러 지우는 규칙. */
    const label=win?'다시 누르면 지워집니다':'';
    return '<div class="result-entry'+(win?' decided':'')+'">'
      +(label?'<div class="result-entry-label">'+label+'</div>':'')
      +btn('t1')+btn('t2')
    +'</div>';
  }
  if(!opts || !opts.current) return '';
  if(m.win){
    const winner=_resultSideLabel(d,m.win);
    return '<div class="result-entry-done">입력 완료 · '+esc(winner)+'</div>';
  }
  if(!_canSubmitResult(m,d)) return '';
  const idx=Number(m._idx);
  if(!Number.isFinite(idx) || idx<0) return '';
  return '<div class="result-entry">'
    +'<div class="result-entry-label">이긴 팀 선택</div>'
    +'<button type="button" class="blue-win" onclick="submitLiveWin('+idx+',\'t1\')">'+_resultSideLabel(d,'t1')+'</button>'
    +'<button type="button" class="red-win" onclick="submitLiveWin('+idx+',\'t2\')">'+_resultSideLabel(d,'t2')+'</button>'
  +'</div>';
}

window.setLiveViewerName=setLiveViewerName;
window.selectLiveViewer=selectLiveViewer;
window.setLiveViewerSearch=setLiveViewerSearch;
window.submitLiveWin=submitLiveWin;
window.toggleTeamWin=toggleTeamWin;
window.changeTeamCourt=changeTeamCourt;
window.undoTeamOfficialAction=undoTeamOfficialAction;
window.finishTeamLive=finishTeamLive;
window.addTeamPlayer=addTeamPlayer;
window.jumpToLiveSection=jumpToLiveSection;
window.setViewerDetailsOpen=setViewerDetailsOpen;
window.setTeamOfficialOverviewFilter=setTeamOfficialOverviewFilter;

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

/* 지각 표시도 **서버 명령**으로 보냅니다 (운영자 2026-08-14 "민턴라이브와 동일한
   방식"). 예전에는 브라우저가 `live/<id>/late/…` 에 직접 썼는데, 그러면 링크만
   아는 사람이 남의 출결을 바꿀 수 있어 서명 권한이 무의미해집니다. */
async function toggleMemberLate(name, team){
  if(!name) return;
  const d=window._lastLiveData;
  if(!_canOperateAttendance(d||{})){
    alert('제외·복귀 표시는 단장·부단장·클럽 임원·운영 도우미가 처리합니다.');
    return;
  }
  const viewer=_viewerInfo(d);
  const on=_lateOn(name);
  if(!on&&!confirm(name+'님을 제외로 표시할까요?\n\n늦게 오거나, 레슨 등으로 잠시 자리를 비울 때 씁니다.\n대진표에서 이름을 눌러 대체 선수를 넣을 수 있습니다.'))return;
  if(!liveId||!window.firebase||!firebase.functions)return alert('연결을 확인해주세요.');
  try{
    const callable=firebase.functions().httpsCallable('submitTeamOfficialRequest');
    const grantToken=await ensureTeamOfficialGrant(d);
    if(!grantToken)return alert(_teamGrantFailMessage());
    const res=await callable({liveId,grantToken,command:{
      type:'team-official-late',
      operationId:'tlate_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7),
      actorPlayerName:viewer&&(viewer.n||viewer.name)||'',
      playerName:String(name), late:!on,
      expiresAt:Date.now()+10*60*1000
    }});
    const data=res&&res.data;
    if(!(data&&data.ok))alert((data&&data.reason)||'제외 표시를 바꾸지 못했습니다.');
  }catch(e){
    alert('제외 표시를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.');
  }
}

async function toggleMemberParty(name, team){
  // 뒷풀이는 본인 의사 표시라 본인이 하고, 현장에서 운영진이 대신 눌러줄 수 있습니다.
  if(name&&!(_isSelf(window._lastLiveData||{},name)||_canOperateAttendance(window._lastLiveData||{}))){
    alert('뒷풀이 참석은 본인 또는 운영진만 바꿀 수 있습니다.');
    return;
  }
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

// 명단에서 남의 출결을 만지는 것은 운영진만 합니다.
// 회원이 서로의 지각을 켜고 끄면 결국 임원에게 확인 요청이 몰려 일이 늘어납니다
// (운영자 판단 2026-08-04). 본인 것은 본인이 계속 처리합니다.
function _canOperateAttendance(d){
  const v=_viewerInfo(d);
  if(!v)return false;
  return !!(v.isClubOfficial||v.isLeader||v.isSub||v.isTemporaryOperator);
}
function _isSelf(d,name){
  const v=_viewerInfo(d);
  return !!(v&&String(v.n||'')===String(name||''));
}
function buildTeamRosterCard(d){
  if(!d.members) return '';
  const blue=_normalizeMembers(d.members.blue||[]);
  const red=_normalizeMembers(d.members.red||[]);
  const solo=_normalizeMembers(d.members.all||[]);
  const showTeam=!!(_usesFixedTeams(d) && (blue.length||red.length));
  const showSolo=!showTeam && !!solo.length;
  if(!showTeam && !showSolo) return '';
  const late=_lateMapFromData(d);
  const party=d.party||{};
  window._liveLate=late;
  window._liveParty=party;
  const canOperate=_canOperateAttendance(d);
  const mk=(list,teamKey)=>{
    const arr=_sortMembers(list);
    if(!arr.length) return '<div class="faq-note">명단이 없습니다.</div>';
    return arr.map(p=>{
      const officialBadge=p.isClubOfficial?'<span class="team-member-badge official" title="클럽 임원">임</span>':'';
      const operatorBadge=p.isTemporaryOperator?'<span class="team-member-badge temporary-operator" title="운영 도우미">운</span>':'';
      const badge=(p.isLeader?'<span class="team-member-badge" title="단장">단</span>':p.isSub?'<span class="team-member-badge" title="부단장">부</span>':'')
        +officialBadge+operatorBadge;
      const on=_lateOn(p.n);
      const partyOn=_partyOn(p.n);
      const nameArg=JSON.stringify(p.n).replace(/"/g,'&quot;');
      const genderCls=p.g==='F'?'female':p.g==='M'?'male':'';
      const genderText=p.g==='M'?'남':p.g==='F'?'여':'·';
      const partner=p.partnerName?'<span class="team-member-partner" title="파트너">P '+esc(p.partnerName)+'</span>':'';
      const badges=(badge||partner)?'<span class="team-member-badges">'+badge+partner+'</span>':'';
      return '<div class="team-member">'
        +'<span class="team-member-g '+genderCls+'">'+genderText+'</span>'
        +'<span class="team-member-name">'+esc(p.n)+'</span>'
        +badges
        +'<div class="team-member-actions">'
          +(canOperate
            ?'<button type="button" class="team-member-att '+(on?'on':'')+'" onclick="toggleMemberLate('+nameArg+',\''+teamKey+'\')">'+(on?'복귀':'제외')+'</button>'
            :'<span class="team-member-att-view '+(on?'on':'')+'">'+(on?'제외':'')+'</span>')
          /* 이름 수정(✏️)·명단 제외(✖️) 버튼은 뺐습니다 (운영자 2026-08-12
             "어차피 현장에서 대진을 짜니까 이름 수정이나 불참자 발생은 거의 없어.
             지각하다가 불참으로 전환되어도 어쨌든 대체 선수 투입은 불가피하니까
             달라지는 건 없어"). 명단 40여 줄에 네 칸씩 붙어 있던 버튼입니다 —
             한 해에 몇 번 쓸까 말까 한 기능이 매 줄의 폭을 먹고 있었습니다. */
          +((canOperate||_isSelf(d,p.n))
            ?'<button type="button" class="team-member-party '+(partyOn?'on':'')+'" onclick="toggleMemberParty('+nameArg+',\''+teamKey+'\')">'+(partyOn?'뒷풀이✓':'뒷풀이')+'</button>'
            :'<span class="team-member-party-view '+(partyOn?'on':'')+'">'+(partyOn?'뒷풀이':'')+'</span>')
        +'</div>'
      +'</div>';
    }).join('');
  };
  const all=showTeam?[...blue,...red]:solo;
  const lateCount=all.filter(p=>_lateOn(p.n)).length;
  const partyCount=all.filter(p=>_partyOn(p.n)).length;
  const sortBtn=(key,label)=>'<button type="button" class="team-roster-sort '+(_teamRosterSort===key?'active':'')+'" onclick="setTeamRosterSort(\''+key+'\')">'+label+'</button>';
  return '<details class="info-details primary" id="teamRoster" '+(_teamRosterOpen?'open':'')+' ontoggle="setTeamRosterOpen(this.open)">'
    +'<summary>'+(showTeam?'팀 명단':'명단')+' · 제외 · 뒷풀이</summary>'
    +'<div class="info-body">'
      +'<section class="team-roster-card">'
        +'<div class="team-roster-head"><b>'+(showTeam?'팀 명단':'참가자 명단')+'</b><span>제외 '+lateCount+'명 · 뒷풀이 '+partyCount+'명</span></div>'
        +'<div class="team-att-summary"><b>제외</b> · <b>뒷풀이</b> 확인</div>'
        +'<div class="team-roster-tools">'+sortBtn('name','가나다')+sortBtn('gender','성별')+sortBtn('late','제외')+sortBtn('role','역할')+sortBtn('level','급수')
          // 갑자기 한 명 더 왔을 때 — 명단을 보는 그 자리에서 바로. 임원에게만.
          +(canOperate?'<button type="button" class="team-roster-sort add" onclick="addTeamPlayer()">＋ 선수 추가</button>':'')
        +'</div>'
        +'<div class="team-roster-columns '+(showTeam?'':'single')+'">'
          +(showTeam
            ?'<div class="team-roster-side blue"><div class="team-roster-title">'+esc(d.teamBlue||'청팀')+' <small>제외 '+blue.filter(p=>_lateOn(p.n)).length+'명</small></div>'+mk(blue,'blue')+'</div>'
              +'<div class="team-roster-side red"><div class="team-roster-title">'+esc(d.teamWhite||'홍팀')+' <small>제외 '+red.filter(p=>_lateOn(p.n)).length+'명</small></div>'+mk(red,'red')+'</div>'
            :'<div class="team-roster-side"><div class="team-roster-title">전체 참가자 <small>제외 '+lateCount+'명</small></div>'+mk(solo,'all')+'</div>')
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

/* 대진표의 이름이 곧 교체 버튼입니다 (운영자 2026-08-14 "대진표의 지각자를
   눌러서 선수교체하는 방식으로 처리해"). 별도 알림 버튼으로 한 번 더 들어가지
   않습니다 — 진입점은 한 곳 [[dashboard-first-admin-ui]]. */
/* 미리 손댈 수 있는 라운드 = **지금 라운드 + 다음 라운드** (운영자 2026-08-14
   "당장 코트에 투입하는 경우뿐 아니라 다음 대진에서도 미리 처리할 수 있어야 해").
   그 뒤 라운드까지 열지는 않습니다 — 지각자는 오고 있는 사람이라, 먼 경기를 미리
   갈아치울 필요가 없습니다("모든 경기를 대체할 필요 없어"). */
function _swappableRounds(d){
  const rows=(d&&d.matches)||[];
  const open=[...new Set(rows.filter(m=>m&&!_settled(m)).map(m=>Number(m.round)||0))]
    .filter(Boolean).sort((a,b)=>a-b);
  const cur=Number(d&&d.currentRound||0)||open[0]||0;
  const next=open.find(r=>r>cur)||0;
  return [cur,next].filter(Boolean);
}
/**
 * 이 이름을 눌러 바꿀 수 있는가.
 *
 * 예전에는 **제외로 찍힌 사람만** 눌렸습니다. 그런데 현장에서는 제외와 무관하게
 * 임원 판단으로 바꾸는 일이 생깁니다 — 운영자 2026-08-14 실전 피드백:
 * "운영진의 재량에 따라서 때로 대진을 변경해야 하는 상황이 생김. 이름을 눌러
 * 선수를 직관적으로 변경하고자 하는데 그런 기능을 추가할 필요 있음."
 *
 * 그래서 **지금·다음 라운드의 아직 안 끝난 경기라면 누구든** 눌립니다. 넣을 수
 * 있는 사람은 그대로 **같은 팀 우선**으로 제안하고, 팀을 넘을 때만 확인을 받습니다.
 */
function _replaceableInMatch(d,m,name){
  if(!m||_settled(m))return false;
  if(!_canSubstitute(d))return false;
  return _swappableRounds(d).includes(Number(m.round));
}
/**
 * 전체 대진표 한 줄 — **간략판** (운영자 2026-08-12 "경기가 많아서 세로 스크롤을
 * 많이 해야 하니 간략히 볼 수 있게… 중복제거하고 바둑판식으로").
 *
 * 큰 카드에는 경기마다 같은 것이 되풀이됩니다 — 청팀/홍팀 딱지, VS, 종목 칩,
 * 코트 태그. 40경기면 그 되풀이가 화면 여덟 개 분량이 됩니다. 여기서는
 * **왼쪽이 청, 오른쪽이 홍**이라는 자리로 팀을 말하고, 딱지를 지웁니다.
 * 이긴 쪽만 색으로 표시합니다.
 *
 * 이름은 큰 카드와 **같은 규칙으로** 눌립니다 — 지금·다음 라운드의 지각자를
 * 누르면 교체 시트가 열립니다. 임원은 승패도 여기서 바로 고칩니다.
 */
function _bracketSideHtml(names,d,m,side,win){
  const list=(names||[]).filter(Boolean);
  const cls='bracket-side '+(side==='t1'?'blue':'red')+(win===side?' won':'')
    +(win&&win!==side?' lost':'');
  const inner=list.length
    ? list.map(n=>_bracketNameHtml(n,d,m)).join('<i>·</i>')
    : '<span class="bracket-name">-</span>';
  return '<div class="'+cls+'">'+inner+'</div>';
}
function _bracketNameHtml(name,d,m){
  const n=String(name||'');
  const late=!!(d&&_lateOn(n));
  if(_replaceableInMatch(d,m,n)){
    const arg=JSON.stringify(n).replace(/"/g,'&quot;');
    const open='openTeamSubstitutePanel('+Number(m.num||0)+','+arg+')';
    return '<span class="bracket-name swap'+(late?' late':'')+'" role="button" tabindex="0"'
      +' onclick="'+open+'"'
      +' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();'+open+';}"'
      +' aria-label="'+esc(n)+' · 눌러서 대체 선수 넣기">'+esc(n)+'</span>';
  }
  return '<span class="bracket-name'+(late?' late':'')+'">'+esc(n)+'</span>';
}
function buildBracketRow(m,d){
  const num=Number(m.num);
  const win=String(m.win||'');
  const canFix=_usesFixedTeams(d)&&_canFixResult(d);
  const result=m.voided
    ? '<span class="bracket-result void">미실시</span>'
    : canFix
      ? '<span class="bracket-pick">'
          +'<button type="button" class="blue'+(win==='t1'?' on':'')+'" aria-label="'+num+'번 청 승"'
          +' onclick="toggleTeamWin('+num+',\'t1\')">청</button>'
          +'<button type="button" class="red'+(win==='t2'?' on':'')+'" aria-label="'+num+'번 홍 승"'
          +' onclick="toggleTeamWin('+num+',\'t2\')">홍</button>'
        +'</span>'
      : '<span class="bracket-result'+(win?' done':'')+'">'+(win?(win==='t1'?'청':'홍'):'·')+'</span>';
  return '<div class="bracket-row'+(win?' decided':'')+(m.voided?' void':'')+'">'
    +'<span class="bracket-court">'+(Number(m.court)||'-')+'</span>'
    +_bracketSideHtml(m.t1,d,m,'t1',win)
    +_bracketSideHtml(m.t2,d,m,'t2',win)
    +result
  +'</div>';
}

function _playerLine(name,d,m){
  const n=String(name||'');
  if(!n) return '<div class="live-player">-</div>';
  const flag=!!(d&&_lateOn(n));
  const label=flag?'제외':'';
  const cls='live-player'+(flag?' not-ready':'');
  if(_replaceableInMatch(d,m,n)){
    // `<div>` 그대로 두고 버튼 역할만 입힙니다. `<button>` 으로 바꾸면 이름에 걸린
    // `!important` 규칙들과 버튼 기본 글꼴이 싸워서 **이름 크기·굵기가 흐트러집니다**
    // — 코트 이름은 이 화면에서 가장 중요한 정보라 건드리지 않습니다.
    const arg=JSON.stringify(n).replace(/"/g,'&quot;');
    const open='openTeamSubstitutePanel('+Number(m.num||0)+','+arg+')';
    return '<div class="'+cls+' swap" role="button" tabindex="0" '
      +'onclick="'+open+'" '
      +'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();'+open+';}" '
      +'aria-label="'+esc(n)+' '+esc(label)+' · 눌러서 대체 선수 넣기">'
      +esc(n)+'<span class="ready-badge">'+(label?label+' · 교체':'교체')+'</span></div>';
  }
  return '<div class="'+cls+'">'+esc(n)
    +(label?'<span class="ready-badge">'+label+'</span>':'')
  +'</div>';
}

function buildLiveMatchCard(m,d,opts){
  opts=opts||{};
  const tc=m.type==='여복'?'women':m.type==='남복'?'men':m.type==='보정'?'adjust':'mixed';
  const t1=m.t1||[], t2=m.t2||[];
  const t1win=m.win==='t1', t2win=m.win==='t2';
  const courtLabel=(opts.next?'R'+esc(String(m.round||''))+' · ':'')+esc(String(m.court||''))+'코트';
  // 임원은 코트 라벨을 눌러 번호를 고칠 수 있습니다(실제 쓰는 코트와 다를 때).
  const courtTag=(_canFixResult(d)&&!_settled(m)&&Number(m.num))
    ?'<span class="live-court editable" role="button" tabindex="0" title="코트 번호 바꾸기"'
      +' onclick="changeTeamCourt('+Number(m.num)+')"'
      +' onkeydown="if(event.key===\'Enter\'){event.preventDefault();changeTeamCourt('+Number(m.num)+');}">'
      +courtLabel+'</span>'
    :'<span class="live-court">'+courtLabel+'</span>';
  const typeLabel=(opts.next?'대기 · ':'')+esc(m.type||'경기')+(m.isFiller?' · 보완':'');
  const imminent=opts.next && _isImminentMatch(m);
  const resultControls=buildResultInputControls(m,d,opts);
  const teamLabels=_usesFixedTeams(d);
  const t1Label=teamLabels?'청팀':'A팀';
  const t2Label=teamLabels?'홍팀':'B팀';
  return '<article class="live-match '+tc+(opts.current?' is-current':'')+(imminent?' is-imminent':'')+(resultControls?' has-result':'')+'">'
    +(imminent?'<div class="imminent-banner">대진 임박 · 다음 경기 준비해주세요</div>':'')
    +'<div class="live-match-top">'
      +courtTag
      +'<span class="live-type '+tc+'">'+typeLabel+'</span>'
    +'</div>'
    +'<div class="live-versus">'
      +'<div class="live-side blue'+(t1win?' win':'')+'">'
        +'<div class="live-team-label">'+t1Label+'</div>'
        +(t1win?'<span class="win-chip">WIN</span>':'')
        +_playerLine(t1[0],d,m)
        +_playerLine(t1[1],d,m)
      +'</div>'
      +'<div class="live-vs">VS</div>'
      +'<div class="live-side red'+(t2win?' win':'')+'">'
        +'<div class="live-team-label">'+t2Label+'</div>'
        +(t2win?'<span class="win-chip">WIN</span>':'')
        +_playerLine(t2[0],d,m)
        +_playerLine(t2[1],d,m)
      +'</div>'
    +'</div>'
    +resultControls
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

/* 맨 위로 (운영자 2026-08-15 "임원 페이지가 길어지니 우측 하단에 맨 위로").
   임원 화면은 운영 현황·경기·명단·전체 대진표가 이어져 꽤 길어집니다.
   조금이라도 내려갔을 때만 나타나고, 시트(z-index 90)가 열리면 그 아래로 덮입니다. */
/* 부드러운 스크롤을 **조용히 무시하는** 브라우저가 있습니다(카톡 인앱·옛 iOS).
   예외를 던지지 않고 그냥 안 움직여서, try/catch 로는 못 잡습니다. 그래서
   잠깐 뒤에 정말 움직였는지 보고 안 움직였으면 바로 올립니다. */
function _smoothScroll(run, check){
  const before=window.scrollY||document.documentElement.scrollTop||0;
  try{ run(); }catch(e){}
  setTimeout(()=>{
    const now=window.scrollY||document.documentElement.scrollTop||0;
    if(Math.abs(now-before)<4)check();
  },260);
}
function _scrollToTop(){
  _smoothScroll(()=>window.scrollTo({top:0,behavior:'smooth'}),()=>window.scrollTo(0,0));
}
function _ensureScrollTopButton(){
  if(document.getElementById('liveScrollTop'))return;
  const btn=document.createElement('button');
  btn.id='liveScrollTop';
  btn.type='button';
  btn.className='live-scroll-top';
  btn.setAttribute('aria-label','맨 위로 이동');
  btn.innerHTML='↑<span>맨 위</span>';
  btn.addEventListener('click',()=>_scrollToTop());
  document.body.appendChild(btn);
  const sync=()=>{
    const y=window.scrollY||document.documentElement.scrollTop||0;
    btn.classList.toggle('show',y>420);
  };
  window.addEventListener('scroll',sync,{passive:true});
  sync();
}

function render(d){
  document.body.classList.toggle('team-live-view',_isTeamLiveData(d));
  _ensureScrollTopButton();
  // 임원이면 운영 권한을 미리 받아 둡니다 — 첫 조작에서 기다리지 않도록.
  if(typeof ensureTeamOfficialGrant==='function'&&_canSubstitute(d))ensureTeamOfficialGrant(d);
  _randomizeViewerGender();
  window._lastLiveData=d;
  window._liveLate=_lateMapFromData(d);
  window._liveParty=d.party||{};
  /* **본인 이름을 찾기 전에는 아무것도 보여 주지 않습니다** (운영자 2026-08-12
     "본인 이름을 검색하지 않으면 볼 수 없게 해야 할 것 같아").
     링크는 단톡방에 돌아다닙니다. 이름 하나만 고르면 되는 가벼운 문턱이지만,
     그 문턱이 있어야 대진표·명단이 아무에게나 열리지 않습니다.
     문턱은 여기 하나뿐입니다 — 고른 다음에는 곧장 대진표로 들어갑니다. */
  const identityGate=buildViewerIdentity(d);
  if(!_viewerInfo(d) && identityGate){
    if(content)content.innerHTML='<div class="live-board">'+identityGate+'</div>';
    return;
  }
  const matches=(d.matches||[]).map((m,i)=>Object.assign({},m,{_idx:i,_key:_matchKey(m)}));
  const byRound={};
  matches.forEach(m=>{ (byRound[m.round]=byRound[m.round]||[]).push(m); });
  const rounds=Object.keys(byRound).map(Number).sort((a,b)=>a-b);
  const totalR=rounds.length;
  let doneR=0;
  rounds.forEach(r=>{ if((byRound[r]||[]).every(_settled)) doneR++; });
  // 임원이 마무리를 선언했으면 남은 경기가 있어도 결과 화면으로 넘어갑니다.
  const allDone=matches.length>0 && (_liveFinished(d) || (totalR>0 && matches.every(_settled)));
  const firstOpenRound=rounds.find(r=>(byRound[r]||[]).some(m=>!_settled(m)));
  let curRound=d.currentRound||null;
  if(!curRound || !byRound[curRound] || ((byRound[curRound]||[]).every(_settled) && firstOpenRound)){
    curRound=firstOpenRound || curRound || rounds[0] || null;
  }
  const curRoundMatches=curRound?(byRound[curRound]||[]): [];
  const curOpen=curRoundMatches.filter(m=>!_settled(m));
  const curDisplay=curOpen.length?curOpen:curRoundMatches;
  const nextMatches=matches
    .filter(m=>!_settled(m) && m.round!==curRound)
    .sort((a,b)=>(a.round-b.round)||(a.court-b.court));

  if(d.members) window._rosterData=d.members;

  // 화면 순서는 보는 사람이 할 일을 따라갑니다(민턴LIVE 와 같은 원칙).
  //   회원 : 내 카드 → 경기
  //   운영진: 운영 현황 → 경기(승패 입력) → 팀 명단(지각·도착) → 내 카드
  // 운영진의 두 가지 일이 승패 입력과 출결 확인이라, 그 둘을 위로 올립니다.
  const forOperator=_canOperateAttendance(d);
  const identity=buildViewerIdentity(d);
  const overview=buildTeamOfficialOverview(d);
  const scoreboard=_usesFixedTeams(d)
    ? buildLiveScore(d,totalR,doneR)
    : '<div class="round-progress-strip" id="scoreBoard"><b>경기 '+doneR+'/'+totalR+'라운드</b><span>'
      +(d.pointSystem?esc(d.pointSystem)+'점 경기':'진행 현황')+'</span></div>';
  const matchPanels=allDone
    ? buildFinale(matches,d)
    : buildCurrentPanel(curRound,curDisplay,d)+buildNextPanel(nextMatches,d);
  const roster=buildTeamRosterCard(d);
  // 임원에게는 뒷풀이가 세 번 나왔습니다 — 타일, 이 스포트라이트, 명단 요약.
  // 운영 현황이 떠 있는 사람에게는 타일(누르면 명단)로 충분하니 여기서는 뺍니다.
  // 운영 현황이 없는 참가자에게는 그대로 보여 줍니다.
  const extras=buildMvpSpotlight(matches,d)+(overview?'':buildPartySpotlight(d));

  // 성적 이야기(MVP·전적 순위)는 붙여 둡니다. 예전에는 전체 대진표가 둘 사이를
  // 갈라놓아 같은 내용을 두 번 보는 것처럼 느껴졌습니다.
  const rankingHtml=buildRanking(matches,d);
  const ranking=rankingHtml
    ? '<details class="info-details" '+(_viewerDetailsOpen.ranking?'open':'')+' ontoggle="setViewerDetailsOpen(\'ranking\',this.open)"><summary>전적 순위 보기</summary><div class="info-body">'+rankingHtml+'</div></details>'
    : '';

  let html='<div class="live-board">';
  html+=forOperator
    ? overview+scoreboard+matchPanels+roster+identity+extras+ranking
    : identity+overview+scoreboard+matchPanels+extras+ranking+roster;

  html+='<details class="info-details primary" id="fullBracket" '+(_viewerDetailsOpen.fullBracket?'open':'')+' ontoggle="setViewerDetailsOpen(\'fullBracket\',this.open)"><summary>전체 대진표 보기</summary><div class="info-body">';
  rounds.forEach(r=>{
    const isCur=(r===curRound);
    html+='<div class="round'+(isCur?' cur':'')+'" id="round_all_'+r+'">';
    html+='<div class="round-h"><span class="round-badge">ROUND '+r+'</span>'
      +(isCur&&!allDone?'<span class="now">● 현재</span>':'')+'<span class="round-line"></span></div>';
    // 큰 카드 대신 한 줄짜리 간략판 — 40경기면 세로 여덟 화면이 두 화면이 됩니다.
    html+='<div class="bracket-grid">';
    (byRound[r]||[]).sort((a,b)=>a.court-b.court).forEach(m=>{ html+=buildBracketRow(m,d); });
    html+='</div></div>';
  });
  html+='</div></details>';
  html+='</div>';

  content.innerHTML=html;
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
