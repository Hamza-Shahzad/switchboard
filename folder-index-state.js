const fs = require('fs');
const path = require('path');

function getFolderIndexMtimeMs(folderPath) {
  let indexMtimeMs = 0;
  try { indexMtimeMs = fs.statSync(folderPath).mtimeMs; } catch { return 0; }

  function visit(dir, depth) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      if (entry.isFile() && (entry.name.endsWith('.jsonl') || entry.name === 'state.json')) {
        try {
          const mtime = fs.statSync(target).mtimeMs;
          if (mtime > indexMtimeMs) indexMtimeMs = mtime;
        } catch {}
      } else if (entry.isDirectory() && depth < 4 && entry.name !== '.git' && entry.name !== 'subagents') {
        visit(target, depth + 1);
      }
    }
  }

  visit(folderPath, 0);
  return indexMtimeMs;
}

module.exports = { getFolderIndexMtimeMs };
