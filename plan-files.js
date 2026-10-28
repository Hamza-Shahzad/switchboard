const fs = require('fs');
const path = require('path');

function createPlanFiles({ claudePlansDir, kimiHarness, includeKimi = () => true }) {
  function claudePlans() {
    let files = [];
    try { files = fs.readdirSync(claudePlansDir).filter(file => file.endsWith('.md')); } catch {}
    return files.map(file => {
      const filePath = path.join(claudePlansDir, file);
      return planRecord(file, filePath, 'claude');
    }).filter(Boolean);
  }

  function kimiPlans() {
    if (!includeKimi()) return [];
    const plans = [];
    for (const folder of kimiHarness.listFolders()) {
      const dir = kimiHarness.folderPath(folder.slice(kimiHarness.folderPrefix.length));
      for (const wire of kimiHarness.listTranscripts(dir)) {
        const sessionId = kimiHarness.sessionIdFromPath(wire);
        const plansDir = path.join(path.dirname(wire), 'plans');
        let files = [];
        try { files = fs.readdirSync(plansDir).filter(file => file.endsWith('.md')); } catch {}
        for (const file of files) {
          const record = planRecord(`kimi/${sessionId}/${file}`, path.join(plansDir, file), 'kimi');
          if (record) plans.push(record);
        }
      }
    }
    return plans;
  }

  function planRecord(filename, filePath, runtime) {
    try {
      const stat = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, 'utf8');
      const firstLine = content.split('\n').find(line => line.trim());
      const basename = path.basename(filename);
      return {
        filename, filePath, runtime,
        title: firstLine?.startsWith('# ') ? firstLine.slice(2).trim() : basename.replace(/\.md$/, ''),
        modified: stat.mtime.toISOString(),
      };
    } catch {
      return null;
    }
  }

  function listPlans() {
    return [...claudePlans(), ...kimiPlans()]
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
  }

  function resolvePlanPath(filename) {
    const value = String(filename || '');
    if (!value.startsWith('kimi/')) return path.join(claudePlansDir, path.basename(value));
    const parts = value.split('/');
    if (parts.length !== 3 || parts[2] !== path.basename(parts[2])) return null;
    const wire = kimiHarness.transcriptPath({ sessionId: parts[1] });
    if (!wire) return null;
    return path.join(path.dirname(wire), 'plans', path.basename(parts[2]));
  }

  function isPlanPath(filePath) {
    const resolved = path.resolve(filePath);
    const claudeRoot = path.resolve(claudePlansDir) + path.sep;
    if (resolved.startsWith(claudeRoot)) return true;
    for (const folder of kimiHarness.listFolders()) {
      const dir = kimiHarness.folderPath(folder.slice(kimiHarness.folderPrefix.length));
      for (const wire of kimiHarness.listTranscripts(dir)) {
        const plansRoot = path.join(path.dirname(wire), 'plans') + path.sep;
        if (resolved.startsWith(plansRoot)) return true;
      }
    }
    return false;
  }

  return { listPlans, resolvePlanPath, isPlanPath };
}

module.exports = { createPlanFiles };
