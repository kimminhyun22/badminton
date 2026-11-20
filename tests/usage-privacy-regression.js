'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {summarize} = require('../tools/usage-report');
const {project} = require('../functions/skill-calibration');
const core = require('../functions/skill-calibration-core');
const {evidenceFor} = require('../functions/skill-adaptive-batch');

const archived = {startedAt: 100, completed: 12, completedLog: [{seq: 1, startAt: 100, endAt: 200}]};
const input = {live: {
  checkin_TEST: {session: {matchStartedAt: 300, event: {completed: 2}, players: [{name: 'E2E-private'}]}, pendingArchives: {op: archived}},
  checkin_PREP: {session: {event: {completed: 0}}},
  TEAM: {matches: [{num: 1, win: 't1'}, {num: 2, win: 't2'}, {num: 3, voided: true}, {num: 4}], finishedAt: 0},
  rsvp_TEST: {players: [{name: 'E2E-private'}]}
}, liveArchive: {checkin_TEST: {200: archived}}};
const before = JSON.stringify(input);
assert.deepStrictEqual(summarize(input), {scope: 'retained-records', daily: {sessions: 2, completedGames: 14}, team: {sessions: 1, completedGames: 2}, completedGames: 16});
assert.equal(JSON.stringify(input), before, 'read only');
assert(!JSON.stringify(summarize(input)).includes('E2E-private'));
input.live.TEAM.matches[0].win = 't2';
assert.equal(summarize(input).team.completedGames, 2, 'correction is not another game');
delete input.live.TEAM.matches[0].win;
assert.equal(summarize(input).team.completedGames, 1, 'undo excludes result');
assert.equal(summarize({live: null, liveArchive: null}).completedGames, 0);
const context = {module: {exports: {}}, require, process};
vm.runInNewContext(fs.readFileSync('tools/usage-report.js', 'utf8').replace("['t1', 't2'].includes(m.win)", 'true'), context);
assert.notEqual(context.module.exports.summarize(input).team.completedGames, 1, 'mutation detected');

const players = core.players(Array.from({length: 4}, (_, i) => ({name: 'E2E회원' + i, grade: 'C', gender: '남', ageGroup: '40대', level: 4, skillStep: 0})));
const questions = core.pairs(players);
const otherPair = 'p2_p3', historicalSelfPair = 'p0_p1';
const session = {id: 'test', players, questions, votes: {u_p0: {[otherPair]: 'a', [historicalSelfPair]: 'tie'}, u_p1: {[otherPair]: 'b', [historicalSelfPair]: 'b'}}, owner: 'secret', participants: {p0: {key: 'secret'}}, invites: ['secret']};
for (const role of ['shared', 'e0', 'u_p0', 'u_p1']) {
  const out = project(session, role);
  assert.deepStrictEqual(out.proposals, [], 'no individual calibration results');
  assert(out.players.every(p => !('level' in p) && !('skillStep' in p)));
  for (const field of ['votes', 'participants', 'owner', 'invites']) assert(!(field in out));
  assert.deepStrictEqual(out.answers, role.startsWith('u_') ? {[otherPair]: session.votes[role][otherPair]} : {});
  assert(!Object.hasOwn(out.evidence[otherPair], 'needsReview'), 'respondents receive no indication of other judgments');
  if(role.startsWith('u_')) assert(!out.questions.some(q => q.id === historicalSelfPair));
}
const owner = project(session, 'owner');
assert.equal(owner.count, 4, 'historical self votes remain in owner totals');
const anonymous = evidenceFor(session, questions, {e0: {[otherPair]: 'a'}, e1: {[otherPair]: 'a'}});
assert.equal(anonymous[otherPair].count, 2);
assert.equal(anonymous[otherPair].namedJudgments, 0);
assert.equal(anonymous[otherPair].directionalSupport, 0);
assert(owner.proposals.length > 0);
assert(!('votes' in owner) && !('participants' in owner), 'operator sees aggregated evidence, not raters');
assert(!JSON.stringify(owner.proposals).includes('u_p0'));
console.log('usage and calibration visibility regression passed');
