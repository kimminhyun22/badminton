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
      <ol><li><strong>명부 준비</strong><p>밴드 멤버 목록은 캡처로 명부 만들기에서 여러 장을 읽어 등록합니다. 성별·연령·급수를 확인하거나 기존 명부를 받습니다.</p></li>
      <li><strong>참가자 등록</strong><p>명부에서 선택하거나 캡처를 읽어 등록합니다. 캡처 결과와 게스트 정보는 확인 후 확정합니다.</p></li>
      <li><strong>방식 선택·대진 게시</strong><p>민턴LIVE 또는 팀전을 선택하고 코트 수·점수제를 설정합니다. 팀전은 팀 배정 확인 → 대진표 생성 → 대진 게시 순서입니다.</p></li>
      <li><strong>운동 링크 공유</strong><p>게시 후 공유하기로 회원에게 보냅니다. 회원은 이름을 선택하고 현재·다음 경기를 확인합니다. 임원·운영진이 현장을 진행합니다.</p></li></ol>
      <details><summary>휴대폰·태블릿에 설치</summary>
        <p>설치 없이도 사용할 수 있습니다. 운영자는 홈 화면에 추가하면 편합니다.</p>
        <p><strong>아이폰·아이패드</strong><br>Safari에서 앱 주소 열기 → 공유 → 홈 화면에 추가. ‘웹 앱으로 열기’가 보이면 켭니다.</p>
        <p><strong>안드로이드</strong><br>Chrome에서 앱 주소 열기 → 메뉴 → 홈 화면에 추가 또는 앱 설치.</p>
        <p>카톡에서 설치 메뉴가 안 보이면 앱 주소를 복사해 Safari/Chrome 주소창에 붙여 넣으세요. 설치 후 홈 화면 아이콘을 열어 명부를 등록합니다.</p>
        <p><a href="${appUrl}">민턴LIVE 앱 열기</a></p>
      </details>
      <details><summary>명부 보관·다음 운영진에게 전달</summary>
        <p>명부 → 명부 전달에서 파일을 보관합니다. 받는 사람은 명부 받기로 불러오고 임원을 다시 지정합니다. 두 명부는 독립된 사본입니다.</p>
        <p>선택한 Google 계정으로 서버 저장도 연결할 수 있습니다. 앱 삭제·브라우저 데이터 삭제·기기 변경 전에는 반드시 백업하세요. Safari와 홈 화면 앱의 명부가 다를 수 있습니다.</p>
      </details>
      <div class="manual-share-actions"><button type="button" data-guide-share>설치·사용 안내 공유</button><button type="button" data-guide-copy>안내 복사</button></div>
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
    section.querySelector('[data-guide-copy]').onclick=copy;
    section.querySelector('[data-guide-share]').onclick=async()=>{
      if(!navigator.share)return copy();
      try{await navigator.share({title:'민턴LIVE 설치·사용 안내',text:message});status.textContent='공유 창을 닫았습니다.';}
      catch(error){if(error.name!=='AbortError')await copy();}
    };
    if(new URLSearchParams(location.search).get('manual')==='1')window.openManual();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();
