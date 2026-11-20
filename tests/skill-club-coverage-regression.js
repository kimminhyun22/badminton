'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { handle } = require('../functions/skill-calibration');
const core = require('../functions/skill-calibration-core');
const now = 1900000000000;
const token = n => n.toString(16).padStart(32, '0');
const owner = token(1), shared = token(2), named = token(3), invites = [4, 5, 6].map(token);
function fixture() {
  const id = token(100), path = 'skillCalibration/' + id, data = {};
  let beforeCommit;
  const db = { ref: key => ({
    once: async () => ({ val: () => structuredClone(data[key] ?? null) }),
    transaction: async fn => {
      assert.notEqual(fn(null), undefined);
      if (beforeCommit && key === path) { const hook = beforeCommit; beforeCommit = null; hook(data[key]); }
      const next = fn(structuredClone(data[key] ?? null));
      if (next !== undefined) data[key] = next;
      return { committed: next !== undefined, snapshot: { val: () => structuredClone(data[key] ?? null) } };
    }
  }) };
  const call = (action, fields = {}) => handle(db, { id, key: owner, action, ...fields }, 'local', now);
  const create = (grades, options) => call('create', { clubName: 'E2E클럽', assessmentVersion: 2, invites,
    players: Array.from(grades, (grade, i) => ({ name: 'E2E선수' + i, gender: '남', ageGroup: '40대', grade })), ...options });
  return { call, create, stored: () => data[path], race: hook => { beforeCommit = hook; },
    join: async () => { await call('share', { sharedKey: shared }); return call('join', { key: shared, playerId: 'p0', respondentKey: named }); } };
}
test('new default club measurement registers bounded links across every neighboring occupied grade', async () => {
  for (const [grades, expectedAdjacent] of [['EEEE', 0], ['ES', 1], ['DCA', 2], ['DDDCC', 6], ['EEECCCCAAAA', 12], ['EDCBAS', 5]]) {
    const f = fixture(), result = await f.create(grades);
    const same = core.measurementPairs(result.players), cross = result.questions.filter(q => q.kind === 'cross-grade');
    assert.equal(cross.filter(q => q.phase !== 'sparse-coverage').length, expectedAdjacent, grades);
    assert.equal(result.namedOwnerReview, true);
    assert.deepEqual(result.questions.slice(0, same.length), same);
    const byId = new Map(result.players.map(p => [p.id, p.grade]));
    const ordered = Array.from('EDCBAS').filter(grade => grades.includes(grade));
    for (let i = 1; i < ordered.length; i++) {
      assert(cross.some(q => [byId.get(q.a), byId.get(q.b)].sort().join() === [ordered[i - 1], ordered[i]].sort().join()));
    }
    for (const q of cross) {
      const distance = Math.abs(ordered.indexOf(byId.get(q.a)) - ordered.indexOf(byId.get(q.b)));
      if (q.phase === 'sparse-coverage') {
        assert(distance > 1);
        assert([q.a, q.b].some(id => result.players.filter(p => p.id !== id &&
          Math.abs(ordered.indexOf(p.grade) - ordered.indexOf(byId.get(id))) <= 1).length < 3));
      } else assert.equal(distance, 1);
    }
    assert.equal(new Set(result.questions.map(q => q.id)).size, result.questions.length);
    assert.deepEqual(result.questions, f.stored().questions);
    assert.deepEqual(result.proposals.map(p => p.ready), Array(result.players.length).fill(false));
    assert.equal(result.count, 0);
  }
});
test('explicit selection, empty selection, v1 and create retries preserve the original pool', async () => {
  for (const options of [{boundaryIds: []}, {boundaryIds: ['p0', 'p2']}, {assessmentVersion: 1}]) {
    const f = fixture(), result = await f.create('DDCC', options);
    const expected = options.assessmentVersion === 1 ? core.pairs(result.players) : core.measurementPairs(result.players, options.boundaryIds);
    assert.deepEqual(f.stored().questions, expected);
    const before = structuredClone(f.stored());
    await f.create('DDCC');
    assert.deepEqual(f.stored(), before);
  }
  const f = fixture();
  await f.create('DC', {boundaryIds: []});
  delete f.stored().questions; // Realtime Database omits a stored empty list.
  assert.deepEqual((await f.call('read')).questions, []);
  await f.call('measurement', {boundaryIds: ['p0', 'p1']});
  assert.equal(f.stored().questions.length, 1);
});
test('named club read, join, replay and submit omit self, preserving recorded votes and legitimate drafts', async () => {
  const f = fixture(), ownerView = await f.create('CCCCCC');
  const self = ownerView.questions.find(q => q.a === 'p0'), other = ownerView.questions.find(q => q.a !== 'p0' && q.b !== 'p0');
  const oldAnswers = {[self.id]: 'a', [other.id]: 'tie'};
  f.stored().votes = {u_p0: {...oldAnswers}};
  f.stored().reviewQuestionIds = [self.id, other.id];
  const joined = await f.join(), replayId = token(300);
  const legacyBatch = {id: token(301), requestId: replayId, issuedAt: now, expiresAt: now + 10000,
    questions: [self, {...other, phase: 'confirmation', reason: '상충', mixed: true}, {id: 'deleted', a: 'p8', b: 'p9'}]};
  f.stored().adaptiveBatches = {u_p0: {current: legacyBatch, history: {[replayId]: legacyBatch}}};
  const views = [joined, await f.call('read', {key: named}), await f.call('batch', {key: named, requestId: replayId})];
  for (const view of views) {
    assert.equal(view.questions.length, 10);
    assert(view.questions.every(q => q.a !== 'p0' && q.b !== 'p0'));
    assert(!view.storedQuestionIds.includes(self.id));
    assert(!Object.hasOwn(view.evidence, self.id));
    assert.deepEqual(Object.keys(view.evidence[other.id]), ['count']);
    assert(!Object.hasOwn(view, 'namedOwnerReview'));
    assert.deepEqual(view.reviewQuestionIds, [other.id]);
    assert.deepEqual(view.answers, {[other.id]: 'tie'});
    assert.deepEqual(view.proposals, []);
  }
  assert.deepEqual(views[2].adaptiveBatch.questions, [other]);
  assert.deepEqual(f.stored().votes.u_p0, oldAnswers);
  await assert.rejects(f.call('answer', {key: named, answers: {[self.id]: 'b', [other.id]: 'skip'}}));
  assert.deepEqual(f.stored().votes.u_p0, oldAnswers);
  const saved = await f.call('answer', {key: named, answers: {[other.id]: 'b'}});
  assert.deepEqual(saved.answers, {[other.id]: 'b'});
  assert.equal((await f.call('read')).count, 2);
  assert.equal((await f.call('read')).evidence[self.id].count, 1);
  assert.equal((await f.call('read', {key: shared})).needsIdentity, true);
  await f.call('answer', {key: invites[0], answers: {[self.id]: 'tie'}});
  await f.call('assess', {answers: {[self.id]: 'a'}});
  assert.equal((await f.call('read')).count, 4);
});
test('four distinct grades can reach three opponents from new named batches; two members have no valid self-free questions', async () => {
  const f = fixture(), initial = await f.create('EDCB');
  assert.equal(initial.questions.length, 6);
  assert.equal(initial.questions.filter(q => q.phase === 'sparse-coverage').length, 3);
  await f.call('share', {sharedKey: shared});
  for (let i = 0; i < 4; i++) {
    const key = token(40+i), playerId = 'p'+i;
    await f.call('join', {key: shared, playerId, respondentKey: key});
    const {adaptiveBatch} = await f.call('batch', {key, requestId: token(80+i)});
    assert.equal(adaptiveBatch.questions.length, 3);
    for (const q of adaptiveBatch.questions) {
      assert(![q.a,q.b].includes(playerId));
      assert.deepEqual(Object.keys(q).sort(), ['a','b','id','kind']);
    }
    await f.call('answer', {key, answers: Object.fromEntries(adaptiveBatch.questions.map(q => [q.id,'a']))});
  }
  assert((await f.call('read')).proposals.every(p => p.reviewed && p.resolved === 3));
  const two = fixture();
  await two.create('ED');
  assert.deepEqual((await two.join()).questions, []);
  assert.deepEqual((await two.call('batch', {key: named, requestId: token(90)})).adaptiveBatch.questions, []);
  assert((await two.call('read')).proposals.every(p => !p.reviewed));
});
test('commit checks current question eligibility and preserves unmodified votes on rejection', async () => {
  const f = fixture();
  await f.create('CCCC');
  const view = await f.join(), q = view.questions.find(v => v.a === 'p1');
  f.race(old => { old.questions = old.questions.filter(v => v.id !== q.id); });
  await assert.rejects(f.call('answer', {key: named, answers: {[q.id]: 'a'}}));
  assert.deepEqual(f.stored().votes, {});
});
