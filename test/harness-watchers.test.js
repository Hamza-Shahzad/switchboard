const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');

const codex = require('../harnesses/codex');
const kimi = require('../harnesses/kimi');
const { getFolderIndexMtimeMs } = require('../folder-index-state');

test('Codex watcher paths retain the date-folder mapping on either separator', () => {
  assert.equal(codex.folderForFileEvent('2026/10/28/rollout-x.jsonl'), 'codex/2026/10/28');
  assert.equal(codex.folderForFileEvent('2026\\10\\28\\rollout-x.jsonl'), 'codex/2026/10/28');
  assert.equal(codex.folderForFileEvent('2026/10/session_index.jsonl'), null);
  assert.equal(codex.folderForFileEvent('notes.txt'), null);
});

test('Kimi watcher paths accept main wire and state, never subagents', () => {
  assert.equal(kimi.folderForFileEvent('wd_project/session_id/state.json'), 'kimi/wd_project');
  assert.equal(kimi.folderForFileEvent('wd_project/session_id/agents/main/wire.jsonl'), 'kimi/wd_project');
  assert.equal(kimi.folderForFileEvent('wd_project\\session_id\\agents\\main\\wire.jsonl'), 'kimi/wd_project');
  assert.equal(kimi.folderForFileEvent('wd_project/session_id/agents/agent-0/wire.jsonl'), null);
  assert.equal(kimi.folderForFileEvent('wd_project/session_id/agents/main/notes.jsonl'), null);
});

test('folder index mtime observes nested main wire and state files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-kimi-mtime-'));
  try {
    const wire = path.join(root, 'session_id', 'agents', 'main', 'wire.jsonl');
    const state = path.join(root, 'session_id', 'state.json');
    fs.mkdirSync(path.dirname(wire), { recursive: true });
    fs.writeFileSync(wire, '{}\n');
    fs.writeFileSync(state, '{}\n');
    const before = getFolderIndexMtimeMs(root);
    const future = new Date(before + 5000);
    fs.utimesSync(wire, future, future);
    assert.ok(getFolderIndexMtimeMs(root) >= future.getTime());
    const later = new Date(before + 8000);
    fs.utimesSync(state, later, later);
    assert.ok(getFolderIndexMtimeMs(root) >= later.getTime());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cold worker scans a nested Kimi session through the harness contract', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-kimi-worker-'));
  const previous = process.env.KIMI_CODE_HOME;
  process.env.KIMI_CODE_HOME = home;
  let worker;
  try {
    const session = path.join(home, 'sessions', 'wd_synthetic', 'session_synthetic');
    fs.mkdirSync(path.join(session, 'agents', 'main'), { recursive: true });
    for (const name of ['state.json', 'session_index.jsonl']) {
      const target = name === 'state.json' ? path.join(session, name) : path.join(home, name);
      fs.copyFileSync(path.join(__dirname, 'fixtures', 'kimi', name), target);
    }
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'kimi', 'wire.jsonl'), path.join(session, 'agents', 'main', 'wire.jsonl'));
    worker = new Worker(path.join(__dirname, '../workers/scan-projects.js'), {
      workerData: { projectsDir: path.join(home, 'claude-projects'), folders: ['kimi/wd_synthetic'] },
    });
    const message = await new Promise((resolve, reject) => {
      worker.on('message', msg => { if (msg.type !== 'progress') resolve(msg); });
      worker.on('error', reject);
    });
    assert.equal(message.ok, true);
    assert.equal(message.results.length, 1);
    assert.equal(message.results[0].projectPath, '/tmp/switchboard-kimi-project');
    assert.equal(message.results[0].sessions.length, 1);
    assert.equal(message.results[0].sessions[0].runtime, 'kimi');
    assert.equal(message.results[0].sessions[0].summary, 'Synthetic user prompt');
  } finally {
    if (worker) await worker.terminate();
    if (previous === undefined) delete process.env.KIMI_CODE_HOME;
    else process.env.KIMI_CODE_HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
