(function(){
  'use strict';

  // 하단 탭바를 "실제로 보이는 화면" 바닥에 붙여 둡니다.
  //
  // iOS Safari·PWA는 키보드가 올라와도 레이아웃 뷰포트 높이를 줄이지 않습니다.
  // 그래서 position:fixed; bottom:0 인 막대가 키보드 뒤로 들어가고, 그 상태에서
  // 스크롤하면 화면 중간에 떠서 내용을 가린 채 남습니다(운영자 보고 증상).
  // visualViewport 로 가려진 높이를 재서 그만큼 끌어올리고, 글자 입력 중에는
  // 아예 내려 둡니다.

  var LIFT_VAR = '--bnav-lift';
  var TYPING_CLASS = 'bnav-typing';
  var MIN_LIFT = 8;      // 이보다 작은 오차는 무시(주소창 미세 변화)
  var KEYBOARD_LIFT = 120; // 이 이상 가려지면 키보드가 올라온 것으로 봅니다

  function navEl(){
    return document.getElementById('bottomNav') || document.querySelector('.bottom-nav');
  }

  function isTextEntry(el){
    if(!el)return false;
    var tag = String(el.tagName || '').toLowerCase();
    if(tag === 'textarea')return true;
    if(el.isContentEditable)return true;
    if(tag !== 'input')return false;
    var type = String(el.type || 'text').toLowerCase();
    return ['text','search','number','tel','email','url','password',''].indexOf(type) >= 0;
  }

  function apply(){
    var nav = navEl();
    if(!nav)return;
    var vv = window.visualViewport;
    var hidden = 0;
    if(vv){
      // 레이아웃 뷰포트 바닥과 실제 보이는 영역 바닥의 차이
      hidden = Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)));
    }
    var typing = isTextEntry(document.activeElement) && hidden >= KEYBOARD_LIFT;
    nav.classList.toggle(TYPING_CLASS, typing);
    nav.style.setProperty(LIFT_VAR, (typing || hidden < MIN_LIFT ? 0 : hidden) + 'px');
    syncSpacer(nav);
  }

  // 아래 여백은 CSS 상수(56px)로 잡혀 있어 실제 막대보다 몇 px 모자랍니다.
  // 마지막 줄이 막대에 가리지 않도록 실측값으로 맞춥니다.
  function syncSpacer(nav){
    var spacer = document.querySelector('.bnav-spacer');
    if(!spacer)return;
    if(getComputedStyle(nav).display === 'none'){
      spacer.style.removeProperty('height');
      return;
    }
    // CSS 쪽 높이 규칙이 !important 라서 같은 우선순위로 덮어씁니다.
    var height = Math.ceil(nav.getBoundingClientRect().height);
    if(height > 0)spacer.style.setProperty('height', height + 'px', 'important');
  }

  var pending = false;
  function schedule(){
    if(pending)return;
    pending = true;
    requestAnimationFrame(function(){
      pending = false;
      apply();
    });
  }

  function start(){
    if(!navEl())return;
    var vv = window.visualViewport;
    if(vv){
      vv.addEventListener('resize', schedule);
      vv.addEventListener('scroll', schedule);
    }
    window.addEventListener('orientationchange', schedule);
    window.addEventListener('resize', schedule);
    // 키보드가 닫힐 때 iOS가 resize를 늦게 주는 경우가 있어 포커스도 함께 봅니다.
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', function(){ setTimeout(schedule, 60); });
    apply();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', start);
  }else{
    start();
  }
})();
