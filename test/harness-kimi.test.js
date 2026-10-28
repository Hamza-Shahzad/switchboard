const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const kimi = require('../harnesses/kimi');

const FIXTURES = path.join(__dirname, 'fixtures', 'kimi');
const SESSION_ID = 'session_synthetic';
const FOLDER = 'kimi/wd_synthetic';
const PROJECT = '/tmp/switchboard-kimi-project';

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

function withHome(fn, { state = 'state.json', wire = 'wire.jsonl' } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-kimi-'));
  const previous = process.env.KIMI_CODE_HOME;
  process.env.KIMI_CODE_HOME = home;
  try {
    const dir = path.join(home, 'sessions', 'wd_synthetic');
    const session = path.join(dir, SESSION_ID);
    fs.mkdirSync(path.join(session, 'agents', 'main'), { recursive: true });
    fs.writeFileSync(path.join(session, 'state.json'), readFixture(state));
    fs.writeFileSync(path.join(session, 'agents', 'main', 'wire.jsonl'), readFixture(wire));
    fs.writeFileSync(path.join(home, 'session_index.jsonl'), readFixture('session_index.jsonl'));
    return fn({ home, dir, session, file: path.join(session, 'agents', 'main', 'wire.jsonl') });
  } finally {
    if (previous === undefined) delete process.env.KIMI_CODE_HOME;
    else process.env.KIMI_CODE_HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function appended(role, content, time, extra = {}) {
  return JSON.stringify({ type: 'agent.message.appended', time,
    message: { message: { role, content: [{ type: 'text', text: content }], ...extra }, meta: {} } }) + '\n';
}

test('KIMI_CODE_HOME relocates discovery and only main-agent wire files are listed', () => {
  withHome(({ dir, session, file }) => {
    fs.mkdirSync(path.join(dir, 'session_other', 'agents', 'agent-0'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'session_other', 'agents', 'agent-0', 'wire.jsonl'), '{}\n');
    fs.writeFileSync(path.join(session, 'agents', 'main', 'notes.jsonl'), '{}\n');
    assert.equal(kimi.sessionsRoot(), path.join(process.env.KIMI_CODE_HOME, 'sessions'));
    assert.deepEqual(kimi.listFolders(), [FOLDER]);
    assert.deepEqual(kimi.listTranscripts(dir), [file]);
    assert.equal(kimi.sessionIdFromPath(file), SESSION_ID);
    assert.equal(kimi.sessionIdFromPath(path.join(session, 'agents', 'agent-0', 'wire.jsonl')), null);
    assert.equal(kimi.deriveProjectPath(dir), PROJECT);
    assert.equal(kimi.transcriptPath({ sessionId: SESSION_ID, folder: FOLDER }), file);
  });
});

test('parses a real Kimi session shape into the common cache row', () => {
  withHome(({ file }) => {
    const row = kimi.readSessionFile(file, FOLDER);
    assert.equal(row.sessionId, SESSION_ID);
    assert.equal(row.runtime, 'kimi');
    assert.equal(row.projectPath, PROJECT);
    assert.equal(row.summary, 'Synthetic user prompt');
    assert.equal(row.firstPrompt, row.summary);
    assert.equal(row.messageCount, 2);
    assert.equal(row.textContent, 'Synthetic user prompt\nSynthetic assistant reply');
    assert.equal(row.aiTitle, 'Synthetic Kimi session');
    assert.equal(row.customTitle, null);
    assert.equal(row.created, new Date(1760000000000).toISOString());
    assert.equal(row.modified, new Date(1760000005000).toISOString());
    assert.equal(row.sessionFile, file);
    assert.ok(row.indexedBytes > 0);
  });
});

test('viewer renders messages, readable reasoning, and paired tool records once', () => {
  const entries = readFixture('wire.jsonl').trim().split('\n').map(line => JSON.parse(line));
  entries.push({ type: 'agent.message.appended', time: 1760000004001, message: { message: {
    role: 'tool', content: [{ type: 'text', text: 'Synthetic tool output' }], toolCallId: 'tool-synthetic',
  }, meta: {} } });
  const viewer = kimi.toViewerEntries(entries);
  const user = viewer.find(e => e.message.role === 'user' && e.message.content[0].type === 'text');
  const thinking = viewer.find(e => e.message.content[0].type === 'thinking');
  const call = viewer.find(e => e.message.content[0].type === 'tool_use');
  const result = viewer.find(e => e.message.content[0].type === 'tool_result');
  assert.equal(user.message.content[0].text, 'Synthetic user prompt');
  assert.equal(thinking.message.content[0].thinking, 'Synthetic readable reasoning');
  assert.equal(call.message.content[0].id, 'tool-synthetic');
  assert.equal(result.message.content[0].tool_use_id, call.message.content[0].id);
  assert.equal(viewer.filter(e => e.message.content[0].type === 'tool_result').length, 1);
});

test('context user events do not duplicate canonical agent messages in search', () => {
  withHome(({ file }) => {
    const row = kimi.readSessionFile(file, FOLDER);
    assert.equal(row.messageCount, 2);
    assert.equal(row.textContent.match(/Synthetic user prompt/g).length, 1);
  });
});

test('a session without a user message or cwd is not indexed', () => {
  withHome(({ session, file }) => {
    fs.writeFileSync(file, appended('assistant', 'answer only', 1760000000000));
    assert.equal(kimi.readSessionFile(file, FOLDER), null);
    fs.unlinkSync(path.join(session, 'state.json'));
    fs.unlinkSync(path.join(process.env.KIMI_CODE_HOME, 'session_index.jsonl'));
    fs.writeFileSync(file, appended('user', 'question', 1760000000000));
    assert.equal(kimi.readSessionFile(file, FOLDER), null);
  });
});

test('incremental indexing reads appends and matches a full re-read', () => {
  withHome(({ file }) => {
    for (let i = 0; i < 20; i++) fs.appendFileSync(file, appended('assistant', `Padding ${i} ${'x'.repeat(1000)}`, 1760000005000));
    const first = kimi.readSessionFile(file, FOLDER);
    const sizeBefore = fs.statSync(file).size;
    fs.appendFileSync(file, appended('user', 'Follow-up question', 1760000006000));
    fs.appendFileSync(file, appended('assistant', 'Follow-up answer', 1760000007000));
    const incremental = kimi.readSessionFile(file, FOLDER, null, first);
    const full = kimi.readSessionFile(file, FOLDER);
    for (const field of ['summary', 'messageCount', 'textContent', 'firstTimestamp', 'lastTimestamp', 'modified']) {
      assert.deepEqual(incremental[field], full[field], field);
    }
    assert.ok(incremental.bytesRead < sizeBefore / 2);
  });
});

test('a partial final record is retried without double-counting', () => {
  withHome(({ file }) => {
    const first = kimi.readSessionFile(file, FOLDER);
    const record = appended('assistant', 'Completed later', 1760000006000);
    fs.appendFileSync(file, record.slice(0, -3));
    const partial = kimi.readSessionFile(file, FOLDER, null, first);
    assert.equal(partial.messageCount, first.messageCount);
    assert.equal(partial.indexedBytes, 0);
    fs.appendFileSync(file, record.slice(-3));
    const completed = kimi.readSessionFile(file, FOLDER, null, partial);
    assert.equal(completed.messageCount, first.messageCount + 1);
    assert.equal(completed.textContent.match(/Completed later/g).length, 1);
  });
});

test('truncated fixture keeps valid history and ignores the partial tail', () => {
  withHome(({ file }) => {
    const row = kimi.readSessionFile(file, FOLDER);
    assert.equal(row.summary, 'Truncated session prompt');
    assert.equal(row.messageCount, 1);
    assert.equal(row.indexedBytes, 0);
  }, { wire: 'truncated-wire.jsonl' });
});

test('fork launch signals use the exact parent and creation time', () => {
  withHome(({ file }) => {
    const signals = kimi.readLaunchSignals(file);
    assert.equal(signals.sessionId, 'session_fork');
    assert.equal(signals.forkedFrom, SESSION_ID);
    assert.equal(signals.cwd, PROJECT);
    const spawnedAt = Date.parse(signals.startedAt);
    assert.equal(kimi.matchesLaunch(signals, { forkFrom: SESSION_ID, projectPath: PROJECT, spawnedAt }), true);
    assert.equal(kimi.matchesLaunch(signals, { forkFrom: 'other', projectPath: PROJECT, spawnedAt }), false);
    assert.equal(kimi.matchesLaunch(signals, { forkFrom: SESSION_ID, projectPath: '/other', spawnedAt }), false);
  }, { state: 'fork-state.json' });
});

test('new-session launch args and per-launch environment match the Kimi CLI', () => {
  assert.deepEqual(kimi.buildLaunchArgs({ sessionId: 'temp', isNew: true, options: {
    kimiPermissionMode: 'yolo', kimiPlan: true, kimiModel: 'kimi-code/k3', kimiAgentFile: '/tmp/agent.md',
    addDirs: ' /one, ,/two ', kimiEffort: 'high',
  } }), ['--yolo', '--plan', '--model', 'kimi-code/k3', '--agent-file', '/tmp/agent.md', '--add-dir', '/one', '--add-dir', '/two']);
  assert.deepEqual(kimi.launchEnv('temp', { kimiEffort: 'high' }), { KIMI_MODEL_THINKING_EFFORT: 'high' });
  assert.deepEqual(kimi.launchEnv('temp', { kimiEffort: 'invalid' }), {});
});

test('resume and fork use their own commands and never pre-assign an id', () => {
  assert.deepEqual(kimi.buildLaunchArgs({ sessionId: 'real', isNew: false, options: {
    kimiPermissionMode: 'auto', kimiAgentFile: '/ignored',
  } }), ['--session', 'real', '--auto']);
  assert.deepEqual(kimi.buildLaunchArgs({ sessionId: 'temp', isNew: true, options: { forkFrom: 'parent' } }),
    ['fork', 'parent', '--yes']);
  assert.equal(kimi.needsIdDetection({ isNew: true }), true);
  assert.equal(kimi.needsIdDetection({ isNew: false }), false);
});

test('Claude-only options are ignored and initial prompts are not put in non-interactive mode', () => {
  const args = kimi.buildLaunchArgs({ sessionId: 'temp', isNew: true, options: {
    permissionMode: 'plan', worktree: true, chrome: true, appendSystemPrompt: 'no', initialPrompt: 'hello',
  } });
  assert.deepEqual(args, []);
  assert.ok(!args.includes('-p'));
});

test('model catalog reads only model metadata and applies overrides', () => {
  withHome(({ home }) => {
    fs.writeFileSync(path.join(home, 'config.toml'), `
[providers.managed]
type = "kimi"
api_key = "must-not-leak"
[models."kimi-code/k3"]
provider = "managed"
model = "k3"
display_name = "K3"
support_efforts = ["low", "high"]
default_effort = "high"
[models."kimi-code/k3".overrides]
display_name = "K3 Override"
default_effort = "max"
`);
    assert.deepEqual(kimi.readModelCatalog(), [{
      slug: 'kimi-code/k3', label: 'K3 Override', efforts: ['low', 'high'], defaultEffort: 'max', visible: true,
    }]);
    assert.ok(!JSON.stringify(kimi.readModelCatalog()).includes('must-not-leak'));
  });
});

test('launch markers are exact and another Switchboard session cannot be adopted', () => {
  withHome(({ file }) => {
    const tag = kimi.originatorTag('temp-id');
    fs.appendFileSync(file, JSON.stringify({ type: 'profile.bind', systemPrompt: `prompt ${tag}` }) + '\n');
    const signals = kimi.readLaunchSignals(file);
    assert.equal(signals.originator, tag);
    assert.equal(kimi.matchesLaunch(signals, { tag, projectPath: '/wrong', spawnedAt: 0 }), true);
    assert.equal(kimi.matchesLaunch(signals, { tag: 'switchboard_other', projectPath: PROJECT, spawnedAt: 0 }), false);
  });
});
