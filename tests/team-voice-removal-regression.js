const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const teamSrc = fs.readFileSync(path.join(root, 'js', 'team.js'), 'utf8');
const teamHtml = fs.readFileSync(path.join(root, 'team.html'), 'utf8');
const teamCss = fs.readFileSync(path.join(root, 'css', 'team.css'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

assert(!fs.existsSync(path.join(root, 'js', 'team-ai.js')), '사용하지 않는 팀전 AI 런타임이 다시 포함되면 안 됩니다.');
assert(!teamHtml.includes('teamVoiceModal'), '팀전 음성 운영 모달이 다시 노출되면 안 됩니다.');
assert(!teamHtml.includes('firebase-app-check-site-key'), '음성 AI 전용 App Check 설정이 남으면 안 됩니다.');
assert(!teamHtml.includes('team-ai.js'), '삭제된 AI 모듈을 페이지가 불러오면 안 됩니다.');
assert(!teamSrc.includes('_teamVoice'), '음성 명령 처리 로직이 운영 번들에 남으면 안 됩니다.');
assert(!teamSrc.includes('SpeechRecognition'), '브라우저 음성 인식 런타임이 남으면 안 됩니다.');
assert(!teamSrc.includes('teamLiveVoiceBtn'), 'LIVE 운영판에 음성 버튼이 다시 생기면 안 됩니다.');
assert(!teamSrc.includes('voicePreview'), '삭제된 음성 미리보기 진입점이 남으면 안 됩니다.');
assert(!teamCss.includes('.team-voice'), '음성 모달 전용 스타일이 남으면 안 됩니다.');
assert(!teamCss.includes('.team-live-voice'), 'LIVE 음성 버튼 스타일이 남으면 안 됩니다.');
assert(teamCss.includes('grid-template-columns:repeat(2,minmax(0,1fr));'), '모바일 LIVE 운영 버튼은 두 칸으로 안정적으로 배치해야 합니다.');
assert(!serviceWorker.includes('team-ai.js'), '서비스워커가 삭제된 AI 파일을 캐시하면 안 됩니다.');
assert(!readme.includes('팀전LIVE 음성 운영'), '설명서가 삭제된 기능을 안내하면 안 됩니다.');

console.log('team voice removal regression ok');
