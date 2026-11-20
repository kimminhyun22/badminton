'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../functions/skill-calibration-core');
const E = require('../functions/skill-event-core');

const member = (grade, i) => ({
  memberKey: 'E2E-member-' + i, name: 'E2E선수' + i, grade,
  gender: i % 2 ? '여' : '남', ageGroup: '40대', skillRating: 3 + i * 0.1
});
const old = Array.from({length: 12}, (_, i) => member(i < 6 ? 'C' : 'B', i));
const late = ['A','B','C','A'].map((g, i) => member(g, 12 + i));
const evaluators = [old[0], ...Array.from({length: 6}, (_, i) => ({memberKey: 'E2E-judge-' + i, name: 'E2E임원' + i}))];
function create(players) {
  return {...E.creation({event: {id: 'E2E-event', title: 'E2E'}, clubName: 'E2E', players, evaluators}), votes: {}};
}
function change(s, players) { return E.sync(s, {expectedRevision: s.event.revision, players}, 1); }
const scores = ps => ps.map(p => p.skillRating);
const all = s => E.measurementProposals(s);
function answers(qs) { return Object.fromEntries(qs.map(q => [q.id, 'a'])); }
const original = create(old);
original.votes.u_r1 = answers(original.questions);
const before = all(original);
assert.equal(Object.keys(original.votes.u_r1).length, 66);
assert(before.every(p => p.ready && p.reviewed));

const one = change(original, [...old, late[0]]);
const prior = scores(before);
assert.deepEqual(scores(all(one).slice(0, 12)), prior);
assert.equal(all(one).filter(p => p.reviewed).length, 12);
assert.deepEqual(E.latePlayerIds(one), ['p12']);
assert(!all(one)[12].reviewed && all(one)[12].assessment.waitingForAnchor);
assert.equal(all(one)[12].skillRating, late[0].skillRating);
assert(C.measurementProposals(one.players, one.questions, one.votes).every(p => !p.reviewed), 'pre-fix counterexample: loss of all 12');

const originalVotes = structuredClone(original.votes);
for (let count = 1; count <= 3; count++) {
  const s = structuredClone(one);
  for (let i = 0; i < count; i++) s.votes.u_r1['p' + i + '_p12'] = 'b';
  const p = all(s)[12];
  assert.equal(p.resolved, count);
  assert.equal(p.reviewed, count === 3);
  assert.equal(!!p.assessment.waitingForAnchor, false, 'a genuine majority edge connects the two cohorts');
}

const islands = structuredClone(change(one, [...old, ...late]));
Object.assign(islands.votes.u_r1, answers(islands.questions.filter(q => [q.a,q.b].every(id => Number(id.slice(1)) >= 12))));
islands.votes.u_r1.p0_p12 = 'a';
islands.votes.u_r2 = {p0_p12: 'b'}; // An unresolved bridge must not move old scores.
const held = all(islands);
assert.deepEqual(scores(held.slice(0, 12)), prior);
assert(held.slice(0, 12).every(p => p.reviewed));
assert(held.slice(12).every(p => p.resolved === 3 && p.assessment.waitingForAnchor && !p.reviewed && !p.ready));
assert.deepEqual(scores(held.slice(12)), late.map(p => p.skillRating));
assert(held.slice(12).every(p => p.assessment.requiredGrades.every(g => p.assessment.linkedGrades.includes(g))), 'the unanchored island even spans every required grade');
assert.equal(held[0].conflicts, 1, 'the split remains visible even while excluded from the fit');
assert.deepEqual(original.votes, originalVotes); assert.deepEqual(one.players.slice(0, 12), original.players);

const joined = structuredClone(islands);
joined.votes.u_r3 = {p0_p12: 'b'};
const connected = all(joined);
assert(connected.every(p => p.reviewed));
assert.deepEqual(scores(connected), scores(C.measurementProposals(joined.players, joined.questions, joined.votes)), 'after a real connection the full v4 fit is identical');
const removed = change(joined, [...old, ...late.slice(1)]);
assert.equal(E.project(removed, 'owner').archivedCount, 6);
assert.deepEqual(scores(all(removed).slice(0, 12)), prior);
assert(all(removed).slice(12).every(p => !p.reviewed));
const rejoined = change(removed, [...late.slice().reverse(), ...old]);
assert.deepEqual(all(rejoined), connected);
assert.deepEqual(rejoined.votes, joined.votes);
assert.equal(E.project(rejoined, 'owner').archivedCount, 0);
assert.throws(() => E.sync(rejoined, {expectedRevision: 1, players: old}, 2));

const sparse = old.slice(0, 4);
for (const legacy of [false, true]) {
  const fresh = create(sparse);
  if (legacy) delete fresh.eventInitialCount;
  const expanded = change(fresh, [...sparse, late[0]]);
  expanded.votes.u_r1 = answers(fresh.questions); // All evidence arrived AFTER the expansion.
  if (legacy) delete expanded.eventInitialCount;
  assert.deepEqual(E.latePlayerIds(expanded), ['p4']);
  assert(all(expanded).every(p => !p.reviewed), 'absence of an established scale at arrival must not be guessed later');
  const next = change(expanded, [...sparse, late[0], late[1]]);
  assert(all(next).every(p => !p.reviewed));
}

const declined = change(joined, late);
assert(all(declined).every(p => p.reviewed), 'an entirely replaced roster uses the full active grades and opponents rule');
const newGeneration = change(declined, [...late, member('S', 20)]);
assert(all(newGeneration).slice(0,4).every(p => p.reviewed), 'after all reference members leave a fully assessed new roster can establish its own scale');
const reduced = change(joined, [...old.slice(0, 2), ...late, member('S', 20)]);
assert(all(reduced).every(p => !p.reviewed), 'two surviving reference players cannot waive a new active grade');

const smallOld = change(joined, [...old.slice(0, 2), ...late]);
assert(all(smallOld).some(p => p.reviewed));
const afterTurnover = change(smallOld, [...old.slice(0, 2), ...late, member('S', 20)]);
assert.deepEqual(scores(all(afterTurnover).slice(0, 6)), scores(all(smallOld)));
assert.equal(all(afterTurnover).filter(p => p.reviewed).length, all(smallOld).filter(p => p.reviewed).length);

const evidenceSession = create(old.slice(0, 6));
const pair = 'p0_p1';
evidenceSession.votes = {
  u_r0: {[pair]:'a'}, // Historical self evidence, still part of the frozen scoring model.
  u_r1: {[pair]:'a'}, u_r2: {[pair]:'b'},
  'owner-review': {[pair]:'a'}, e0: {[pair]:'a'}, 'origin:E2E:e0': {[pair]:'a'}
};
const strength = () => all(evidenceSession)[0].evidenceStrength;
assert.deepEqual(strength(), {respondentSlots: 6, confirmedPairs: 0});
evidenceSession.votes.u_r3 = {[pair]:'b'};
assert.deepEqual(strength(), {respondentSlots: 7, confirmedPairs: 1}, '2/3 eligible named judges agree even when historical slots disagree');
evidenceSession.votes.u_r4 = {[pair]:'tie'};
assert.deepEqual(strength(), {respondentSlots: 8, confirmedPairs: 0});
evidenceSession.votes.u_r4[pair] = 'skip';
assert.deepEqual(strength(), {respondentSlots: 7, confirmedPairs: 1});
evidenceSession.votes.u_r1[pair] = evidenceSession.votes.u_r2[pair] = evidenceSession.votes.u_r3[pair] = 'tie';
assert.equal(strength().confirmedPairs, 0, 'a majority of ties confirms no winner');
const read = E.project(evidenceSession, 'u_r0');
assert(read.questions.every(q => q.a !== 'p0' && q.b !== 'p0'));
assert(!read.storedQuestionIds.includes(pair) && !Object.hasOwn(read.answers, pair));
assert.equal(read.count, 7);
assert(Object.values(read.evidence).every(e => Object.keys(e).length === 1 && 'count' in e));
assert.deepEqual(read.proposals, []);
assert(!JSON.stringify(read).includes('memberKey'));
const club = C.proposals(evidenceSession.players, evidenceSession.questions, {
  u_p2: {[pair]:'a'}, 'member:p2': {[pair]:'a'}, u_p0: {[pair]:'a'}, 'verified-owner-review': {[pair]:'a'}
});
assert.equal(club[0].evidenceStrength.confirmedPairs, 0, 'one named judge revisiting an old session cannot cross-confirm their own answer');

const source = fs.readFileSync('functions/skill-calibration-core.js', 'utf8');
function mutated(replace, replacement) {
  assert(source.includes(replace));
  const ctx = {module: {exports: {}}};
  vm.runInNewContext(source.replace(replace, replacement), ctx);
  return ctx.module.exports.measurementProposals(islands.players, islands.questions, islands.votes, islands.players, islands.eventScale);
}
assert(mutated('anchorIds.size>0&&!ids.some(id=>anchorIds.has(id))', 'false').slice(12).some(p => p.reviewed));
assert.notDeepEqual(Array.from(mutated('canFit?edges.filter(canFit):edges', 'edges').slice(0, 12), p => p.skillRating), prior);
console.log('late event grade: 12/12 preserved from 66 votes; disconnected full-grade island, disputed/real bridges, legacy and pre-evidence arrivals, active archive/rejoin, no stale scale, named non-self confirmation, participant privacy and two mutations passed');
