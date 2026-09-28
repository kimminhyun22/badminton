'use strict';
const fs = require('fs');
const {spawnSync} = require('child_process');

const rows = value => Object.values(value || {}).filter(v => v && typeof v === 'object');
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;

// Read-only snapshot totals, not lifetime analytics. No identities leave this function.
function summarize({live = {}, liveArchive = {}} = {}) {
  const daily = new Map();
  let teamGames = 0, teamSessions = 0;
  function addDaily(id, s, archiveKey) {
    const start = s.event?.operationStartedAt || s.matchStartedAt || s.startedAt;
    const key = JSON.stringify([id, start || s.at || archiveKey || 'current']);
    const log = new Set(rows(s.completedLog).map(m => JSON.stringify([m.seq, m.startAt, m.endAt, m.court])));
    const n = Math.max(count(s.event?.completed), count(s.completed), log.size);
    daily.set(key, Math.max(daily.get(key) || 0, n));
  }
  for (const [id, archives] of Object.entries(liveArchive || {})) {
    if (!id.startsWith('checkin_')) continue;
    for (const [key, s] of Object.entries(archives || {})) if (s) addDaily(id, s, key);
  }
  for (const [id, node] of Object.entries(live || {})) {
    if (!node || typeof node !== 'object') continue;
    if (id.startsWith('checkin_')) {
      if (node.session) addDaily(id, node.session);
      for (const [key, s] of Object.entries(node.pendingArchives || {})) if (s) addDaily(id, s, key);
    } else if (Array.isArray(node.matches)) {
      const n = new Set(node.matches.filter(m => m && !m.voided && ['t1', 't2'].includes(m.win))
        .map((m, index) => m.num ?? m.id ?? index)).size;
      teamGames += n;
      if (n) teamSessions++;
    }
  }
  const dailyCounts = [...daily.values()].filter(n => n > 0);
  return {
    scope: 'retained-records',
    daily: {sessions: dailyCounts.length, completedGames: dailyCounts.reduce((a, b) => a + b, 0)},
    team: {sessions: teamSessions, completedGames: teamGames},
    completedGames: dailyCounts.reduce((a, b) => a + b, 0) + teamGames
  };
}

function fetchRecords(path) {
  const r = spawnSync('firebase', ['database:get', path, '--project', 'kokmatch-23b31', '--non-interactive'],
    {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000});
  if (r.status !== 0) throw Error('Firebase 읽기 실패: CLI 로그인과 프로젝트 접근 권한을 확인하세요.');
  return JSON.parse(r.stdout);
}

if (require.main === module) {
  try {
    const arg = process.argv[2];
    if (!arg) throw Error('사용: node tools/usage-report.js --firebase 또는 <live/liveArchive JSON 파일>');
    const input = arg === '--firebase'
      ? {live: fetchRecords('/live'), liveArchive: fetchRecords('/liveArchive')}
      : JSON.parse(fs.readFileSync(arg, 'utf8'));
    console.log(JSON.stringify(summarize(input), null, 2));
    console.log('현재 보관된 기록 기준입니다. 삭제·만료된 기록은 제외되며 전체 누적 사용량이 아닙니다.');
  } catch (error) {
    console.error(error instanceof SyntaxError ? '응답 형식이 올바르지 않습니다. 원본 데이터는 출력하지 않습니다.' : error.message);
    process.exitCode = 1;
  }
}
module.exports = {summarize};
