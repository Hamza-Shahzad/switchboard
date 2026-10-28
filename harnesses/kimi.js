const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { scanLines, readHead } = require('../jsonl-scan');
const { originatorTag } = require('../kimi-agent-options');

const id = 'kimi';
const label = 'Kimi';
const binary = 'kimi';
const folderPrefix = 'kimi/';
const groupsByProject = true;
const SPAWN_SKEW_MS = 5000;
const HEAD_BYTES = 4096;
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const PERMISSION_MODES = new Set(['manual', 'yolo', 'auto']);

function kimiHome() {
  return process.env.KIMI_CODE_HOME
    ? path.resolve(process.env.KIMI_CODE_HOME)
    : path.join(os.homedir(), '.kimi-code');
}

function sessionsRoot() {
  return path.join(kimiHome(), 'sessions');
}

function titleIndexPath() {
  return path.join(kimiHome(), 'session_index.jsonl');
}

function available() {
  return fs.existsSync(sessionsRoot());
}

function listFolders() {
  try {
    return fs.readdirSync(sessionsRoot(), { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('wd_'))
      .map(d => folderPrefix + d.name);
  } catch {
    return [];
  }
}

function folderPath(folder) {
  return path.join(sessionsRoot(), String(folder));
}

function folderForProject() {
  return null;
}

function sessionDirFromTranscript(filePath) {
  const mainDir = path.dirname(filePath);
  if (path.basename(filePath) !== 'wire.jsonl' || path.basename(mainDir) !== 'main') return null;
  if (path.basename(path.dirname(mainDir)) !== 'agents') return null;
  return path.resolve(mainDir, '../..');
}

function sessionIdFromPath(filePath) {
  const dir = sessionDirFromTranscript(filePath);
  return dir ? path.basename(dir) : null;
}

function listTranscripts(dir) {
  const out = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(dir, entry.name, 'agents', 'main', 'wire.jsonl');
      if (fs.existsSync(file)) out.push(file);
    }
  } catch {}
  return out;
}

function folderForFileEvent(filename) {
  const parts = String(filename).split(/[\\/]/);
  if (parts.length === 3 && parts[2] === 'state.json') return folderPrefix + parts[0];
  if (parts.length === 5 && parts[2] === 'agents' && parts[3] === 'main' && parts[4] === 'wire.jsonl') {
    return folderPrefix + parts[0];
  }
  return null;
}

function transcriptPath({ sessionId, folder, sessionFile }) {
  if (sessionFile) return sessionFile;
  if (!sessionId) return null;
  if (!folder) {
    const record = readSessionIndex()?.get(sessionId);
    return record?.sessionDir ? path.join(record.sessionDir, 'agents', 'main', 'wire.jsonl') : null;
  }
  const key = String(folder).startsWith(folderPrefix)
    ? String(folder).slice(folderPrefix.length)
    : String(folder);
  return path.join(folderPath(key), sessionId, 'agents', 'main', 'wire.jsonl');
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readState(filePath) {
  const dir = sessionDirFromTranscript(filePath);
  return dir ? readJson(path.join(dir, 'state.json')) : null;
}

let cachedIndex = null;

function readSessionIndex() {
  const filePath = titleIndexPath();
  let stat;
  try { stat = fs.statSync(filePath); } catch (err) {
    if (err?.code === 'ENOENT') return new Map();
    return null;
  }
  if (cachedIndex && cachedIndex.filePath === filePath && cachedIndex.mtimeMs === stat.mtimeMs
      && cachedIndex.ctimeMs === stat.ctimeMs && cachedIndex.ino === stat.ino && cachedIndex.size === stat.size) {
    return cachedIndex.records;
  }
  let body;
  try { body = fs.readFileSync(filePath, 'utf8'); } catch { return null; }
  const records = new Map();
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (typeof entry.sessionId === 'string') records.set(entry.sessionId, entry);
    } catch {}
  }
  cachedIndex = { filePath, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino, size: stat.size, records };
  return records;
}

function indexRecordFor(filePath) {
  const sessionId = sessionIdFromPath(filePath);
  return sessionId ? readSessionIndex()?.get(sessionId) || null : null;
}

function deriveProjectPath(folder) {
  for (const file of listTranscripts(folder)) {
    const state = readState(file);
    if (state?.cwd) return state.cwd;
    const record = indexRecordFor(file);
    if (record?.workDir) return record.workDir;
  }
  return null;
}

function toIso(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && Number.isNaN(Date.parse(value)) && !Number.isNaN(Number(value))) {
    value = Number(value);
  }
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(part => part && ['text', 'input_text', 'output_text'].includes(part.type) && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n');
}

function thinkingText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter(part => part && (part.type === 'think' || part.type === 'thinking')
      && typeof (part.think ?? part.thinking ?? part.text) === 'string')
    .map(part => part.think ?? part.thinking ?? part.text)
    .join('\n');
}

function hashHead(fd, stat) {
  const n = Math.min(HEAD_BYTES, stat.size);
  if (!n) return '';
  const buf = Buffer.allocUnsafe(n);
  if (fs.readSync(fd, buf, 0, n, 0) !== n) throw new Error('JSONL head changed during read');
  return 'kimi-v1:' + crypto.createHash('sha1')
    .update(`${stat.dev}:${stat.ino}:`).update(buf).digest('hex');
}

function emptyState() {
  return { summary: '', messageCount: 0, textParts: [], firstTimestamp: null, lastTimestamp: null };
}

function stateFrom(prev) {
  return {
    summary: prev.summary || '',
    messageCount: prev.messageCount || 0,
    textParts: prev.textContent ? [prev.textContent] : [],
    firstTimestamp: prev.firstTimestamp || null,
    lastTimestamp: prev.lastTimestamp || null,
  };
}

function applyLine(line, state) {
  let entry;
  try { entry = JSON.parse(line); } catch { return; }
  if (entry.type !== 'agent.message.appended') return;
  const message = entry.message?.message;
  const role = message?.role;
  if (role !== 'user' && role !== 'assistant') return;
  const text = contentText(message.content);
  const timestamp = toIso(entry.time ?? entry.message?.meta?.createdAt);
  if (timestamp) {
    if (!state.firstTimestamp || timestamp < state.firstTimestamp) state.firstTimestamp = timestamp;
    if (!state.lastTimestamp || timestamp > state.lastTimestamp) state.lastTimestamp = timestamp;
  }
  state.messageCount++;
  if (!state.summary && role === 'user' && text) state.summary = text.slice(0, 120);
  if (text) state.textParts.push(text);
}

function readSessionFile(filePath, folder, projectPath, prev = null) {
  const sessionId = sessionIdFromPath(filePath);
  if (!sessionId) return null;
  let fd = null;
  try {
    const state = readState(filePath);
    const record = indexRecordFor(filePath);
    const cwd = state?.cwd || record?.workDir || projectPath || null;
    if (!cwd) return null;

    fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    const fileMtime = stat.mtime.toISOString();
    const headHash = hashHead(fd, stat);
    const canResume = !!prev && !!headHash && prev.runtime === id && prev.sessionId === sessionId
      && prev.sessionFile === filePath && prev.headHash === headHash
      && Number.isSafeInteger(prev.indexedBytes) && prev.indexedBytes > 0
      && prev.indexedBytes <= stat.size
      && (prev.indexedBytes < stat.size || prev.fileMtime === fileMtime);
    const accumulated = canResume ? stateFrom(prev) : emptyState();
    const start = canResume ? prev.indexedBytes : 0;
    const { consumed, read, tail } = scanLines(fd, start, line => applyLine(line, accumulated), stat.size);
    if (tail) applyLine(tail, accumulated);
    const after = fs.fstatSync(fd);
    if (after.size < stat.size || (after.size === stat.size && after.mtimeMs !== stat.mtimeMs)) return null;
    if (!accumulated.summary || accumulated.messageCount < 1) return null;

    const created = toIso(state?.createdAt) || accumulated.firstTimestamp || stat.birthtime.toISOString();
    const modified = accumulated.lastTimestamp || toIso(state?.updatedAt) || fileMtime;
    const customTitle = state?.isCustomTitle && typeof state.title === 'string' ? state.title : null;
    const aiTitle = !state?.isCustomTitle && typeof state?.title === 'string' ? state.title : null;
    return {
      sessionId, folder, projectPath: cwd, runtime: id, sessionFile: filePath,
      summary: accumulated.summary, firstPrompt: accumulated.summary,
      created, modified, fileMtime,
      messageCount: accumulated.messageCount, textContent: accumulated.textParts.join('\n'),
      slug: null, customTitle, aiTitle,
      firstTimestamp: accumulated.firstTimestamp, lastTimestamp: accumulated.lastTimestamp,
      headHash, indexedBytes: tail ? 0 : consumed,
      bytesRead: read + Math.min(HEAD_BYTES, stat.size),
    };
  } catch {
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch {} }
  }
}

function viewerMessage(role, timestamp, content) {
  return { type: role, timestamp, message: { role, content } };
}

function toViewerEntries(entries) {
  const out = [];
  const seenCalls = new Set();
  const seenResults = new Set();
  const seenThinking = new Set();
  const seenUsers = new Set();
  for (const entry of entries || []) {
    const timestamp = toIso(entry?.time);
    if (entry?.type === 'agent.message.appended') {
      const message = entry.message?.message;
      const role = message?.role;
      if (role === 'user' || role === 'assistant') {
        const userId = role === 'user' ? entry.message?.meta?.userMessageId || message.id : null;
        if (userId && seenUsers.has(userId)) continue;
        if (userId) seenUsers.add(userId);
        const content = [];
        const thinking = thinkingText(message.content);
        if (thinking) {
          content.push({ type: 'thinking', thinking });
          seenThinking.add(thinking);
        }
        const text = contentText(message.content);
        if (text) content.push({ type: 'text', text });
        for (const call of message.toolCalls || []) {
          const callId = call.id || call.toolCallId || null;
          if (callId && seenCalls.has(callId)) continue;
          if (callId) seenCalls.add(callId);
          content.push({ type: 'tool_use', id: callId, name: call.name || 'tool', input: call.arguments ?? call.args ?? '' });
        }
        if (content.length) out.push(viewerMessage(role, timestamp, content));
      } else if (role === 'tool') {
        const callId = message.toolCallId || null;
        if (callId && seenResults.has(callId)) continue;
        if (callId) seenResults.add(callId);
        out.push(viewerMessage('user', timestamp, [{
          type: 'tool_result', tool_use_id: callId, content: contentText(message.content),
        }]));
      }
      continue;
    }
    if (entry?.type === 'context.append_message' && entry.message?.role === 'user') {
      const userId = entry.message.id;
      if (userId && seenUsers.has(userId)) continue;
      if (userId) seenUsers.add(userId);
      const text = contentText(entry.message.content);
      if (text) out.push(viewerMessage('user', timestamp, [{ type: 'text', text }]));
      continue;
    }
    if (entry?.type !== 'context.append_loop_event') continue;
    const event = entry.event || {};
    if (event.type === 'content.part') {
      const thinking = event.part?.think || event.part?.thinking || '';
      if (thinking && !seenThinking.has(thinking)) {
        seenThinking.add(thinking);
        out.push(viewerMessage('assistant', timestamp, [{ type: 'thinking', thinking }]));
      }
    } else if (event.type === 'tool.call') {
      const callId = event.toolCallId || null;
      if (callId && seenCalls.has(callId)) continue;
      if (callId) seenCalls.add(callId);
      out.push(viewerMessage('assistant', timestamp, [{
        type: 'tool_use', id: callId, name: event.name || 'tool', input: event.args ?? '',
      }]));
    } else if (event.type === 'tool.result') {
      const callId = event.toolCallId || null;
      if (callId && seenResults.has(callId)) continue;
      if (callId) seenResults.add(callId);
      out.push(viewerMessage('user', timestamp, [{
        type: 'tool_result', tool_use_id: callId,
        content: event.result?.output ?? event.result ?? '',
      }]));
    }
  }
  return out;
}

function needsIdDetection({ isNew }) {
  return !!isNew;
}

function readLaunchSignals(filePath) {
  const state = readState(filePath);
  if (!state) return null;
  const marker = readHead(filePath, 262144).match(/switchboard_[a-zA-Z0-9]+/);
  return {
    sessionId: state.id || sessionIdFromPath(filePath),
    originator: marker?.[0] || null,
    forkedFrom: typeof state.forkedFrom === 'string' ? state.forkedFrom : null,
    cwd: state.cwd || indexRecordFor(filePath)?.workDir || null,
    startedAt: toIso(state.createdAt),
    isSubagent: false,
  };
}

function matchesLaunch(signals, { tag, forkFrom, projectPath, spawnedAt }) {
  if (!signals?.sessionId || signals.isSubagent || !signals.startedAt) return false;
  if (tag && signals.originator === tag) return true;
  if (signals.originator?.startsWith('switchboard_')) return false;
  if (projectPath && signals.cwd !== projectPath) return false;
  if (forkFrom && signals.forkedFrom !== forkFrom) return false;
  if (!forkFrom && signals.forkedFrom) return false;
  const started = Date.parse(signals.startedAt);
  return Number.isFinite(started) && started >= spawnedAt - SPAWN_SKEW_MS;
}

function tomlString(value) {
  const text = String(value || '').trim();
  if (text.startsWith('"')) {
    try { return JSON.parse(text); } catch { return null; }
  }
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/''/g, "'");
  return null;
}

function tomlStringArray(value) {
  const text = String(value || '').trim();
  if (!text.startsWith('[') || !text.endsWith(']')) return [];
  return text.slice(1, -1).split(',').map(tomlString).filter(v => typeof v === 'string');
}

function readModelCatalog() {
  let body;
  try { body = fs.readFileSync(path.join(kimiHome(), 'config.toml'), 'utf8'); } catch { return []; }
  const models = new Map();
  let current = null;
  let overrides = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    const table = line.match(/^\[models\.(?:"([^"]+)"|'([^']+)'|([^\]]+))(\.overrides)?\]$/);
    if (table) {
      const alias = table[1] || table[2] || table[3];
      overrides = !!table[4];
      current = models.get(alias) || { base: {}, overrides: {} };
      models.set(alias, current);
      continue;
    }
    if (line.startsWith('[')) { current = null; overrides = false; continue; }
    if (!current) continue;
    const match = line.match(/^(display_name|support_efforts|default_effort)\s*=\s*(.+)$/);
    if (!match) continue;
    const value = match[1] === 'support_efforts' ? tomlStringArray(match[2]) : tomlString(match[2]);
    if (value !== null) current[overrides ? 'overrides' : 'base'][match[1]] = value;
  }
  return [...models.entries()].map(([slug, entry]) => {
    const fields = { ...entry.base, ...entry.overrides };
    return {
      slug,
      label: fields.display_name || slug,
      efforts: Array.isArray(fields.support_efforts) ? fields.support_efforts : [],
      defaultEffort: fields.default_effort || null,
      visible: true,
    };
  });
}

function buildLaunchArgs({ sessionId, isNew, options }) {
  const args = [];
  if (options?.forkFrom) {
    args.push('fork', String(options.forkFrom), '--yes');
  } else if (!isNew) {
    args.push('--session', String(sessionId));
  }
  if (options?.kimiPermissionMode === 'yolo') args.push('--yolo');
  if (options?.kimiPermissionMode === 'auto') args.push('--auto');
  if (options?.kimiPlan) args.push('--plan');
  if (options?.kimiModel) args.push('--model', String(options.kimiModel));
  if (isNew && options?.kimiAgentFile) args.push('--agent-file', String(options.kimiAgentFile));
  if (options?.addDirs) {
    const dirs = String(options.addDirs).split(',').map(d => d.trim()).filter(Boolean);
    for (const dir of dirs) args.push('--add-dir', dir);
  }
  return args;
}

function launchEnv(_tempId, options = {}) {
  return EFFORTS.has(options.kimiEffort)
    ? { KIMI_MODEL_THINKING_EFFORT: options.kimiEffort }
    : {};
}

function parseTitleState() {
  return null;
}

function classifyNotification() {
  return null;
}

module.exports = {
  id, label, binary, folderPrefix, groupsByProject,
  available, kimiHome, sessionsRoot, titleIndexPath,
  listFolders, folderPath, folderForProject, listTranscripts, folderForFileEvent,
  sessionIdFromPath, transcriptPath, deriveProjectPath, readSessionFile,
  toViewerEntries, needsIdDetection, readLaunchSignals, matchesLaunch, originatorTag,
  buildLaunchArgs, launchEnv, readModelCatalog, parseTitleState, classifyNotification,
};
