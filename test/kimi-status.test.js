const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { activityForEntry, createKimiStatus, readKimiStatus } = require('../kimi-status');

test('turn, approval, resolution, and completion produce normalized activity', () => {
  const status = createKimiStatus();
  assert.deepEqual(status.feed({ type: 'agent.turn.started' }), { kind: 'busy' });
  assert.equal(status.feed({ type: 'agent.turn.started' }), null);
  assert.deepEqual(status.feed({ type: 'interaction.request', request: { toolName: 'Bash' } }),
    { kind: 'attention', message: 'Bash' });
  assert.deepEqual(status.feed({ type: 'interaction.resolved' }), { kind: 'busy' });
  assert.deepEqual(status.feed({ type: 'agent.turn.ended' }), { kind: 'idle' });
  assert.deepEqual(status.state(), { busy: false, attention: false });
  assert.equal(status.feed({ type: 'turn.ended' }), null);
});

test('malformed and unrelated records do not change status', () => {
  assert.equal(activityForEntry(null), null);
  assert.equal(activityForEntry({ type: 'usage.record' }), null);
  assert.equal(activityForEntry({ type: 'metadata' }), null);
});

test('status reader resumes at the previous complete-line offset', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-kimi-status-'));
  const file = path.join(dir, 'wire.jsonl');
  try {
    fs.writeFileSync(file, JSON.stringify({ type: 'agent.turn.started' }) + '\n');
    const first = readKimiStatus(file);
    assert.deepEqual(first.activities, [{ kind: 'busy' }]);
    const partial = JSON.stringify({ type: 'interaction.request', request: { toolName: 'Read' } });
    fs.appendFileSync(file, partial.slice(0, -3));
    const waiting = readKimiStatus(file, first.offset);
    assert.equal(waiting.activities.length, 0);
    assert.equal(waiting.offset, first.offset);
    fs.appendFileSync(file, partial.slice(-3) + '\n' + JSON.stringify({ type: 'agent.turn.ended' }) + '\n');
    const done = readKimiStatus(file, waiting.offset);
    assert.deepEqual(done.activities, [{ kind: 'attention', message: 'Read' }, { kind: 'idle' }]);
    assert.equal(done.offset, fs.statSync(file).size);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
