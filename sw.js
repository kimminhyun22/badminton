// network-first 서비스워커: PWA(홈 화면 설치본)도 항상 최신 코드를 받도록 함
const CACHE = 'badminton-v1.10.393';
const FILES = [
  '/badminton/',
  '/badminton/index.html',
  '/badminton/team.html',
  '/badminton/rsvp.html',
  '/badminton/view.html',
  '/badminton/checkin.html',
  '/badminton/css/app.css',
  '/badminton/css/team.css',
  '/badminton/css/live.css',
  '/badminton/js/storage.js',
  '/badminton/js/daily.js',
  '/badminton/js/team.js',
  '/badminton/js/live-view.js'
];

self.addEventListener('install', e => {
  self.skipWaiting(); // 새 SW 즉시 대기상태 진입
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(FILES)).catch(()=>{})
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 페이지에서 skipWaiting 요청 시 즉시 활성화
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

// network-first: 네트워크 최신 우선, 오프라인이면 캐시 폴백
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isHtml = e.request.mode === 'navigate'
    || url.pathname === '/badminton/'
    || url.pathname.endsWith('.html');
  if (isHtml) {
    e.respondWith(
      fetch(new Request(e.request, { cache: 'no-store' }))
        .then(res => res)
        .catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(()=>{});
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
