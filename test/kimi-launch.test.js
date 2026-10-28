const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareKimiFork, prepareKimiInitialPrompt, prepareKimiLaunch } = require('../kimi-launch');

test('fork closes the ACP session before returning the real id for PTY attach', async () => {
  const calls = [];
  const client = {
    async fork(parent) { calls.push(['fork', parent]); return 'child'; },
    async closeSession(id) { calls.push(['close', id]); },
  };
  assert.equal(await prepareKimiFork(client, 'parent'), 'child');
  assert.deepEqual(calls, [['fork', 'parent'], ['close', 'child']]);
});

test('initial prompt applies model and mode, then completes and closes before PTY attach', async () => {
  const calls = [];
  const client = {
    async newSession(input) { calls.push(['new', input]); return 'real'; },
    async setConfigOption(id, key, value) { calls.push(['config', id, key, value]); },
    async prompt(id, text) { calls.push(['prompt', id, text]); },
    async closeSession(id) { calls.push(['close', id]); },
  };
  const additionalDirectories = ['/project', '/attached'];
  assert.equal(await prepareKimiInitialPrompt(client, {
    cwd: '/project', prompt: 'Do it', additionalDirectories, model: 'kimi-code/k3', permissionMode: 'yolo',
  }), 'real');
  assert.deepEqual(calls, [
    ['new', { cwd: '/project', additionalDirectories }],
    ['config', 'real', 'model', 'kimi-code/k3'],
    ['config', 'real', 'mode', 'yolo'],
    ['prompt', 'real', 'Do it'],
    ['close', 'real'],
  ]);
});

test('a failed close blocks PTY attach instead of creating concurrent writers', async () => {
  const client = {
    async fork() { return 'child'; },
    async closeSession() { throw new Error('lock remains'); },
  };
  await assert.rejects(prepareKimiFork(client, 'parent'), /could not be closed/);
});

test('an unprompted new session is created and closed before PTY attach', async () => {
  const calls = [];
  const client = {
    async newSession(input) { calls.push(['new', input]); return 'real'; },
    async closeSession(id) { calls.push(['close', id]); },
  };
  assert.equal(await prepareKimiLaunch(client, { cwd: '/project', additionalDirectories: [] }), 'real');
  assert.deepEqual(calls, [
    ['new', { cwd: '/project', additionalDirectories: [] }],
    ['close', 'real'],
  ]);
});
