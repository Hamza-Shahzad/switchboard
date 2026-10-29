const { spawn } = require('child_process');

function createKimiAcpClient(options = {}) {
  const command = options.command || 'kimi';
  const args = options.args || ['acp'];
  const timeoutMs = options.timeoutMs || 15000;
  const spawnFn = options.spawn || spawn;
  const child = spawnFn(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let nextId = 1;
  let stdout = '';
  let stderr = '';
  let settled = false;

  function fail(error) {
    if (settled) return;
    settled = true;
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  }

  function onData(data) {
    stdout += data.toString('utf8');
    let newline;
    while ((newline = stdout.indexOf('\n')) !== -1) {
      const line = stdout.slice(0, newline).trim();
      stdout = stdout.slice(newline + 1);
      // A login shell's rc files may print to stdout before kimi starts.
      if (!line || line[0] !== '{') continue;
      let message;
      try { message = JSON.parse(line); } catch {
        fail(new Error('Kimi ACP returned malformed JSON'));
        return;
      }
      if (message.id === null || message.id === undefined) continue;
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) {
        rejectAcpError(message.error, request.reject);
      } else {
        request.resolve(message.result);
      }
    }
  }

  function onError(error) {
    fail(new Error(`Kimi ACP process failed: ${error.message}`));
  }

  function onExit(code, signal) {
    fail(new Error(`Kimi ACP exited before answering (${signal || `code ${code}`})${diagnostics()}`));
  }

  function diagnostics() {
    return stderr.trim() ? `: ${stderr.trim().slice(-2000)}` : '';
  }

  child.stdout.on('data', onData);
  child.stderr.on('data', data => { stderr = (stderr + data.toString('utf8')).slice(-16384); });
  child.on('error', onError);
  child.on('exit', onExit);

  function request(method, params) {
    if (settled) return Promise.reject(new Error('Kimi ACP client is closed'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Kimi ACP ${method} timed out${diagnostics()}`));
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }

  async function initialize() {
    return request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'Switchboard', version: '1.0.0' },
    });
  }

  async function fork(sessionId, { cwd } = {}) {
    const result = await request('session/fork', { sessionId, cwd, mcpServers: [] });
    if (!result?.sessionId) throw new Error('Kimi ACP fork returned no session id');
    return result.sessionId;
  }

  async function newSession({ cwd, additionalDirectories = [] }) {
    const result = await request('session/new', { cwd, mcpServers: [], additionalDirectories });
    if (!result?.sessionId) throw new Error('Kimi ACP new session returned no session id');
    return result.sessionId;
  }

  async function prompt(sessionId, text) {
    return request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] });
  }

  async function setConfigOption(sessionId, configId, value) {
    return request('session/set_config_option', { sessionId, configId, value });
  }

  async function closeSession(sessionId) {
    return request('session/close', { sessionId });
  }

  function dispose() {
    child.stdout.off('data', onData);
    child.off('error', onError);
    child.off('exit', onExit);
    fail(new Error('Kimi ACP client closed'));
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }

  return { initialize, fork, newSession, prompt, setConfigOption, closeSession, request, dispose };
}

function rejectAcpError(error, reject) {
  const err = new Error(error.message || 'Kimi ACP request failed');
  err.code = error.code;
  err.data = error.data;
  reject(err);
}

module.exports = { createKimiAcpClient };
