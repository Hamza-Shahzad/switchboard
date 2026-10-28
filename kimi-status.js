const fs = require('fs');
const { scanLines } = require('./jsonl-scan');

function activityForEntry(entry) {
  if (!entry || typeof entry.type !== 'string') return null;
  if (entry.type === 'agent.turn.started') return { kind: 'busy' };
  if (entry.type === 'agent.turn.ended' || entry.type === 'turn.ended'
      || entry.type === 'prompt.completed' || entry.type === 'prompt.aborted') return { kind: 'idle' };
  if (entry.type === 'interaction.request') {
    const request = entry.request || {};
    const message = request.display?.command || request.action || request.toolName || 'Kimi needs your attention';
    return { kind: 'attention', message: String(message) };
  }
  if (entry.type === 'interaction.resolved') return { kind: 'busy' };
  return null;
}

function createKimiStatus() {
  let busy = false;
  let attention = false;
  return {
    feed(entry) {
      const activity = activityForEntry(entry);
      if (!activity) return null;
      if (activity.kind === 'busy') {
        const changed = !busy || attention;
        attention = false;
        busy = true;
        return changed ? activity : null;
      }
      if (activity.kind === 'attention') {
        if (attention) return null;
        attention = true;
        return activity;
      }
      const changed = busy || attention;
      busy = false;
      attention = false;
      return changed ? activity : null;
    },
    state() {
      return { busy, attention };
    },
  };
}

function readKimiStatus(filePath, offset = 0, status = null) {
  const activities = [];
  const stat = fs.statSync(filePath);
  const start = Math.min(Math.max(0, offset), stat.size);
  const { consumed } = scanLines(filePath, start, line => {
    let entry;
    try { entry = JSON.parse(line); } catch { return; }
    const activity = status ? status.feed(entry) : activityForEntry(entry);
    if (activity) activities.push(activity);
  }, stat.size);
  return { offset: consumed, activities };
}

module.exports = { activityForEntry, createKimiStatus, readKimiStatus };
