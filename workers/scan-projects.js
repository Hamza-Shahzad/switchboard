const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { getFolderIndexMtimeMs } = require('../folder-index-state');
const { harnessForFolder } = require('../harnesses');

const PROJECTS_DIR = workerData.projectsDir;

function readFolderFromFilesystem(folder) {
  const harness = harnessForFolder(folder);
  const folderPath = harness.folderPrefix
    ? harness.folderPath(folder.slice(harness.folderPrefix.length))
    : path.join(PROJECTS_DIR, folder);
  const projectPath = harness.deriveProjectPath(folderPath, folder);
  if (harness.groupsByProject && !projectPath) return null;

  const sessions = [];
  for (const file of harness.listTranscripts(folderPath)) {
    try {
      const session = harness.readSessionFile(file, folder, projectPath);
      if (session) sessions.push(session);
    } catch {}
  }
  return {
    folder, projectPath, sessions,
    indexMtimeMs: getFolderIndexMtimeMs(folderPath),
  };
}

try {
  const folders = workerData.folders || fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== '.git')
    .map(d => d.name);
  const results = [];
  for (let i = 0; i < folders.length; i++) {
    if (i % 5 === 0 || i === folders.length - 1) {
      parentPort.postMessage({ type: 'progress', text: `Scanning projects (${i + 1}/${folders.length})…` });
    }
    try {
      const result = readFolderFromFilesystem(folders[i]);
      if (result) results.push(result);
    } catch {}
  }
  parentPort.postMessage({ ok: true, results });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err.message });
}
