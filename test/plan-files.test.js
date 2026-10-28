const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPlanFiles } = require('../plan-files');
const kimi = require('../harnesses/kimi');

test('plan adapter lists, resolves, and protects Claude and Kimi plan files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-plan-files-'));
  const previous = process.env.KIMI_CODE_HOME;
  process.env.KIMI_CODE_HOME = path.join(root, 'kimi-home');
  try {
    const claude = path.join(root, 'claude-plans');
    fs.mkdirSync(claude, { recursive: true });
    fs.writeFileSync(path.join(claude, 'claude-plan.md'), '# Claude plan\n');
    const session = path.join(process.env.KIMI_CODE_HOME, 'sessions', 'wd_synthetic', 'session_synthetic');
    fs.mkdirSync(path.join(session, 'agents', 'main', 'plans'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'kimi', 'state.json'), path.join(session, 'state.json'));
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'kimi', 'wire.jsonl'), path.join(session, 'agents', 'main', 'wire.jsonl'));
    fs.writeFileSync(path.join(session, 'agents', 'main', 'plans', 'kimi-plan.md'), '# Kimi plan\n');
    fs.writeFileSync(path.join(process.env.KIMI_CODE_HOME, 'session_index.jsonl'), JSON.stringify({ sessionId: 'session_synthetic', sessionDir: session, workDir: '/tmp/switchboard-kimi-project' }) + '\n');
    const adapter = createPlanFiles({ claudePlansDir: claude, kimiHarness: kimi });
    const plans = adapter.listPlans();
    assert.deepEqual(plans.map(p => p.title).sort(), ['Claude plan', 'Kimi plan']);
    const kimiPlan = plans.find(p => p.runtime === 'kimi');
    assert.equal(kimiPlan.filename, 'kimi/session_synthetic/kimi-plan.md');
    assert.equal(adapter.resolvePlanPath(kimiPlan.filename), kimiPlan.filePath);
    assert.equal(adapter.resolvePlanPath('claude-plan.md'), path.join(claude, 'claude-plan.md'));
    assert.equal(adapter.isPlanPath(kimiPlan.filePath), true);
    assert.equal(adapter.isPlanPath(path.join(root, 'outside.md')), false);
  } finally {
    if (previous === undefined) delete process.env.KIMI_CODE_HOME;
    else process.env.KIMI_CODE_HOME = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
