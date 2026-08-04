'use strict';
/**
 * 화면이 부르는 js·css 는 전부 ?v=<버전> 을 달아야 합니다.
 *
 * index.html 이 js/daily.js 를 버전 없이 부르고 있었습니다. 그러면 배포해도
 * 회원 브라우저가 옛 코드를 계속 씁니다. 서비스워커가 network-first 라 대개는
 * 덮이지만, 서비스워커가 죽었거나 없는 브라우저에서는 그대로 남습니다.
 * 실제로 2026-08-04 점검 중 캐시된 daily.js 를 붙들고 한참 헤맸습니다.
 *
 * 버전을 한 번에 올리는 방식(문자열 치환)이라 ?v= 도 같이 갱신됩니다.
 * 새 파일을 추가할 때 ?v= 를 빼먹으면 여기서 잡힙니다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const PAGES = ['index.html', 'team.html', 'checkin.html', 'view.html', 'rsvp.html'];

// 기준 버전은 index.html 의 meta 에서 읽습니다.
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const version = (indexHtml.match(/<meta name="app-version" content="([^"]+)"/) || [])[1];
assert(version, 'index.html 에 app-version 메타가 있어야 합니다.');

let checked = 0;
PAGES.forEach(page=>{
  const html = fs.readFileSync(path.join(root, page), 'utf8');

  // 1) 로컬 js·css 참조에 버전이 빠진 것이 없어야 합니다.
  const missing = [...html.matchAll(/(?:src|href)="((?:js|css)\/[^"?]+)"/g)].map(m=>m[1]);
  assert.deepStrictEqual(missing, [],
    `${page} 의 다음 참조에 ?v= 가 없습니다(배포해도 옛 파일이 남습니다): ${missing.join(', ')}`);

  // 2) 붙어 있는 버전은 현재 버전과 같아야 합니다.
  [...html.matchAll(/(?:src|href)="((?:js|css)\/[^"?]+)\?v=([^"]+)"/g)].forEach(m=>{
    checked++;
    assert.strictEqual(m[2], version,
      `${page} 의 ${m[1]} 버전이 ${m[2]} 입니다. 현재 버전 ${version} 과 달라 갱신이 안 됩니다.`);
  });
});

assert(checked >= 12, `버전이 붙은 참조가 너무 적습니다(${checked}개). 검사가 헛돌고 있을 수 있습니다.`);
console.log(`  ${PAGES.length}개 화면의 js·css 참조 ${checked}개가 v${version} 로 통일됨`);

// 3) 서비스워커 캐시 목록의 파일은 실제로 존재해야 합니다.
//    없는 경로를 캐시하려 하면 addAll 이 통째로 실패해 오프라인 폴백이 비어 버립니다.
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const files = [...sw.matchAll(/'\/badminton\/([^']*)'/g)].map(m=>m[1]).filter(Boolean);
const gone = files.filter(f=>!fs.existsSync(path.join(root, f)));
assert.deepStrictEqual(gone, [],
  `sw.js 가 캐시하려는 파일이 없습니다(addAll 이 실패해 오프라인 폴백이 빕니다): ${gone.join(', ')}`);
console.log(`  서비스워커 캐시 목록 ${files.length}개 파일 존재 확인`);

console.log('\nasset cache busting regression ok');
