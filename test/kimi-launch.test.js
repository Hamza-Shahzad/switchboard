const test = require('node:test');
const assert = require('node:assert/strict');
const { parseKimiForkOutput, createKimiPromptDelivery } = require('../kimi-launch');

test('fork output yields the child id, ignoring shell noise around it', () => {
  assert.equal(
    parseKimiForkOutput('rc says hi\nForked to session_e8152533-cdb7-4f1d-a1f6-2c2f4f0227b9 ("Fork: Reset") in 232ms\n'),
    'session_e8152533-cdb7-4f1d-a1f6-2c2f4f0227b9',
  );
  assert.equal(parseKimiForkOutput('error: session not found'), null);
  assert.equal(parseKimiForkOutput(undefined), null);
});

test('the first prompt waits for the welcome screen, then pastes and submits once', () => {
  const writes = [];
  const scheduled = [];
  const delivery = createKimiPromptDelivery('line one\nline two', w => writes.push(w), {
    schedule: fn => scheduled.push(fn),
  });

  // The folder-trust question comes first; nothing is typed into it.
  assert.equal(delivery.feed('\x1b[1m Trust this folder?\x1b[22m'), false);
  assert.deepEqual(writes, []);

  // The marker can arrive split across chunks.
  assert.equal(delivery.feed('Welcome to Ki'), false);
  assert.equal(delivery.feed('mi Code\r\n'), true);
  assert.deepEqual(writes, ['\x1b[200~line one\nline two\x1b[201~']);
  scheduled.forEach(fn => fn());
  assert.deepEqual(writes, ['\x1b[200~line one\nline two\x1b[201~', '\r']);

  // A later redraw of the banner does not send it again.
  assert.equal(delivery.feed('Welcome to Kimi Code'), true);
  assert.equal(writes.length, 2);
});
