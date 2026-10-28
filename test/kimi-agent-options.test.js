const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { materializeKimiAgentOptions, originatorTag } = require('../kimi-agent-options');

test('agent options preserve the default prompt, tools, instructions, and launch marker', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-kimi-agent-'));
  const launchId = '123e4567-e89b-12d3-a456-426614174000';
  try {
    const agent = materializeKimiAgentOptions({
      dataDir, launchId,
      allowedTools: 'Read, Bash, mcp__github__*',
      instructions: 'First line.\nSecond line.',
    });
    const body = fs.readFileSync(agent.filePath, 'utf8');
    assert.equal(agent.marker, 'switchboard_123e4567e89b12d3a456426614174000');
    assert.equal(originatorTag(launchId), agent.marker);
    assert.ok(body.includes("  - 'Read'"));
    assert.ok(body.includes("  - 'Bash'"));
    assert.ok(body.includes("  - 'mcp__github__*'"));
    assert.ok(body.includes('${base_prompt}'));
    assert.ok(body.includes('First line.\nSecond line.'));
    assert.ok(body.includes(`<!-- ${agent.marker} -->`));
    assert.equal(fs.statSync(agent.filePath).mode & 0o777, 0o600);
    agent.cleanup();
    assert.equal(fs.existsSync(agent.filePath), false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('blank agent options retain the full tool set', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-kimi-agent-blank-'));
  try {
    const agent = materializeKimiAgentOptions({ dataDir, launchId: 'temp', instructions: 'Extra' });
    const body = fs.readFileSync(agent.filePath, 'utf8');
    assert.ok(!body.includes('tools:'));
    agent.cleanup();
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
