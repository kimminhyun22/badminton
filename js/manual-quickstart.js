(function(){
  'use strict';
  const appUrl='https://kimminhyun22.github.io/badminton/';
  const message=`민턴LIVE 무료 사용 안내
${appUrl}

설치(선택)
아이폰·아이패드: Safari → 공유 → 홈 화면에 추가
안드로이드: Chrome → 메뉴 → 홈 화면에 추가/앱 설치
카톡에서 설치 메뉴가 안 보이면 주소를 복사해 Safari/Chrome에서 여세요.

처음 사용
1. 명부 만들기 또는 명부 받기
2. 참가자 등록 → 민턴LIVE/팀전 선택
3. 코트·점수 설정 → 대진 게시 → 공유하기
회원에게는 게시 후 만든 운동 링크를 보내세요. 회원은 설치 없이 이름을 선택하고 경기를 보면 됩니다.

명부는 설치 후 홈 화면 앱에서 등록하세요. 앱 삭제·기기 변경 전에는 명부 파일을 보관하세요.
상세 안내: ${appUrl}?manual=1`;
  function init(){
    const wrap=document.querySelector('#pageManual .manual-wrap');
    if(!wrap)return;
    const section=document.createElement('section');
    section.className='manual-section manual-quickstart';
    section.innerHTML=`<h2>처음 시작</h2>
      <ol><li><strong>참가자 등록</strong>에서 명부 회원이나 게스트를 고릅니다. 명부가 있으면 파일로 받을 수 있습니다.</li>
      <li><strong>민턴LIVE 또는 팀전</strong>을 고르고 코트 수와 점수제를 정합니다. 팀전은 팀을 배정한 뒤 대진을 생성합니다.</li>
      <li><strong>대진 게시 → 공유하기</strong>로 운동 링크를 보냅니다. 회원은 링크에서 자기 이름을 선택합니다.</li></ol>
      <details><summary>휴대폰·태블릿에 설치</summary>
        <p>아이폰·아이패드는 Safari → 공유 → 홈 화면에 추가를 선택하세요. ‘웹 앱으로 열기’가 보이면 켜세요. 안드로이드는 Chrome 메뉴에서 ‘홈 화면에 추가’ 또는 ‘앱 설치’를 선택하세요.</p>
        <p>카톡에서 설치 메뉴가 보이지 않으면 앱 주소를 Safari나 Chrome으로 여세요. 홈 화면 앱을 사용할 운영자는 그곳에서 명부를 등록하세요.</p>
        <p><a href="${appUrl}">민턴LIVE 앱 열기</a></p>
      </details>
      <details><summary>명부 보관·다음 운영진에게 전달</summary>
        <p>명부 → 명부 전달에서 파일을 보관하세요. 받는 사람은 명부 받기로 불러온 뒤 임원을 지정합니다. 두 명부는 독립된 사본입니다.</p>
        <p>선택한 Google 계정으로 서버에 저장할 수도 있습니다. 앱이나 브라우저 데이터를 지우거나 기기를 바꾸기 전에 명부를 백업하세요.</p>
      </details>
      <div class="manual-share-actions"><button type="button" data-guide-share>${navigator.share?'설치·사용 안내 공유':'설치·사용 안내 복사'}</button></div>
      <p class="manual-share-status" role="status" aria-live="polite"></p>
      <textarea class="manual-share-fallback" aria-label="설치·사용 안내 문구" readonly hidden></textarea>`;
    wrap.querySelector('.manual-back-btn').after(section);
    const status=section.querySelector('[role="status"]');
    const fallback=section.querySelector('textarea');
    async function copy(){
      try{
        if(!navigator.clipboard?.writeText)throw Error('clipboard unavailable');
        await navigator.clipboard.writeText(message);
        fallback.hidden=true;status.textContent='안내를 복사했습니다. 카톡 대화방에 붙여 넣으세요.';
      }catch{
        fallback.value=message;fallback.hidden=false;fallback.focus();fallback.select();
        status.textContent='아래 안내를 길게 눌러 복사해 주세요.';
      }
    }
    section.querySelector('[data-guide-share]').onclick=async()=>{
      if(!navigator.share)return copy();
      try{await navigator.share({title:'민턴LIVE 설치·사용 안내',text:message});status.textContent='공유 창을 닫았습니다.';}
      catch(error){if(error.name!=='AbortError')await copy();}
    };
    const back=wrap.querySelector('.manual-back-btn');
    const daily=!!document.getElementById('pageDaily'),home=daily?'daily':'main',homeTab=daily?'daily':'dashboard';
    let origin;
    window.openManual=function(trigger){
      const page=document.querySelector('.page.active');
      if(page?.id!=='pageManual'){
        const roster=page?.id==='pageRoster';
        const tab=document.querySelector('.bnav-btn.active');
        origin={page:roster?'roster':home,tab:roster?'roster':tab?.id.slice(5)||homeTab,
          top:trigger?window.scrollY:0,trigger};
        back.textContent=roster?'← 명부로 돌아가기':'← 이전 화면으로';
      }
      window.switchNav('manual');
      window.syncBottomNav('manual');
      window.scrollTo({top:0,behavior:'instant'});
      back.focus({preventScroll:true});
    };
    window.closeManual=function(){
      const previous=origin||{page:home,tab:homeTab,top:0};
      window.switchNav(previous.page);
      window.syncBottomNav(previous.tab);
      const headerHelp=document.querySelector('.header-help-btn');
      const fallback=headerHelp?.offsetWidth?headerHelp:document.querySelector('.nav-tab.active');
      (previous.trigger?.offsetWidth?previous.trigger:fallback)?.focus({preventScroll:true});
      window.scrollTo({top:previous.top,behavior:'instant'});
      origin=null;
    };
    if(new URLSearchParams(location.search).get('manual')==='1')window.openManual();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();
