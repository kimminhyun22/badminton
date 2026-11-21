/* The primary Firebase subscription stays attached if data arrives after a slow first read. */
window.KokMemberLink = (() => {
  let timer;
  function validId(id) {
    return Boolean(id && id.trim() && !/[.#$\[\]\/\x00-\x1f\x7f]/.test(id));
  }
  function readFailure(error) {
    const code = String(error?.code || '').toLowerCase().replace(/_/g, '-');
    return code.split('/').pop() === 'permission-denied' ? 'access' : 'connection';
  }
  function show(state, subject) {
    clearTimeout(timer);
    const messages = {
      loading: [subject + ' 정보를 불러오는 중입니다', ''],
      invalid: [subject + ' 링크를 확인해 주세요', '단톡방에서 운영자가 공유한 링크 전체를 다시 열어 주세요.'],
      missing: [subject + ' 정보를 찾을 수 없습니다', '운영자에게 현재 사용 중인 공유 링크를 확인해 주세요.'],
      access: ['이 링크로 ' + subject + ' 정보를 열 수 없습니다', '운영자에게 현재 사용 가능한 공유 링크를 확인해 주세요.'],
      expired: ['운동 링크가 만료됐습니다', '운영자에게 새 운동 링크를 받아 열어 주세요.'],
      connection: [subject + ' 정보를 불러오지 못했습니다', '인터넷 연결을 확인한 뒤 다시 연결해 주세요.']
    };
    let notice = document.getElementById('memberLinkNotice');
    if (!notice) {
      notice = document.createElement('section');
      notice.id = 'memberLinkNotice';
      notice.className = 'member-link-notice';
      notice.setAttribute('role', 'status');
      notice.innerHTML = '<h1></h1><p></p><button type="button">다시 연결</button>';
      notice.querySelector('button').addEventListener('click', () => location.reload());
      document.querySelector('.km-member-appbar').after(notice);
    }
    const [title, detail] = messages[state];
    notice.querySelector('h1').textContent = title;
    notice.querySelector('p').textContent = detail;
    notice.querySelector('p').hidden = !detail;
    notice.querySelector('button').hidden = state !== 'connection';
    document.body.classList.add('member-link-unavailable');
  }
  function waitForData(subject) {
    show('loading', subject);
    timer = setTimeout(() => show('connection', subject), 12000);
  }
  function ready() {
    clearTimeout(timer);
    document.getElementById('memberLinkNotice')?.remove();
    document.body.classList.remove('member-link-unavailable');
  }
  return { validId, readFailure, waitForData, show, ready };
})();
