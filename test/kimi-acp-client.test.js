const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { createKimiAcpClient } = require('../kimi-acp-client');

function fakeChild(onWrite) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.stdin = {
    write(text) {
      const message = JSON.parse(text);
      onWrite(message, child);
    },
  };
  child.kill = () => { child.exitCode = 0; };
  return child;
}

function respond(child, request, result) {
  child.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
}

test('initialize, fork, and close use newline-delimited JSON-RPC', async () => {
  const methods = [];
  const child = fakeChild((request, current) => {
    methods.push(request.method);
    if (request.method === 'initialize') respond(current, request, { protocolVersion: 1 });
    if (request.method === 'session/fork') respond(current, request, { sessionId: 'child' });
    if (request.method === 'session/close') respond(current, request, {});
  });
  const client = createKimiAcpClient({ spawn: () => child, timeoutMs: 100 });
  await client.initialize();
  assert.equal(await client.fork('parent'), 'child');
  await client.closeSession('child');
  assert.deepEqual(methods, ['initialize', 'session/fork', 'session/close']);
  client.dispose();
});

test('new session and prompt preserve cwd, directories, and text', async () => {
  const requests = [];
  const child = fakeChild((request, current) => {
    requests.push(request);
    if (request.method === 'session/new') respond(current, request, { sessionId: 'real' });
    if (request.method === 'session/prompt') respond(current, request, { stopReason: 'end_turn' });
  });
  const client = createKimiAcpClient({ spawn: () => child, timeoutMs: 100 });
  assert.equal(await client.newSession({ cwd: '/project', additionalDirectories: ['/shared'] }), 'real');
  await client.prompt('real', 'Synthetic prompt');
  assert.deepEqual(requests[0].params, { cwd: '/project', mcpServers: [], additionalDirectories: ['/shared'] });
  assert.deepEqual(requests[1].params.prompt, [{ type: 'text', text: 'Synthetic prompt' }]);
  client.dispose();
});

test('malformed responses and process exit reject pending requests with diagnostics', async () => {
  const malformed = fakeChild((request, current) => current.stdout.emit('data', '{not json}\n'));
  const client = createKimiAcpClient({ spawn: () => malformed, timeoutMs: 100 });
  await assert.rejects(client.initialize(), /malformed JSON/);

  const exited = fakeChild((request, current) => {
    current.stderr.emit('data', 'synthetic ACP failure');
    current.emit('exit', 1, null);
  });
  const other = createKimiAcpClient({ spawn: () => exited, timeoutMs: 100 });
  await assert.rejects(other.fork('parent'), /synthetic ACP failure/);
});

test('a stalled request times out', async () => {
  const child = fakeChild(() => {});
  const client = createKimiAcpClient({ spawn: () => child, timeoutMs: 10 });
  await assert.rejects(client.fork('parent'), /timed out/);
  client.dispose();
});
