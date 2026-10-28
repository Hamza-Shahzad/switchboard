const fs = require('fs');
const path = require('path');

function yamlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function originatorTag(launchId) {
  return 'switchboard_' + String(launchId).replace(/[^a-zA-Z0-9]/g, '');
}

function materializeKimiAgentOptions({ dataDir, launchId, allowedTools = '', instructions = '' }) {
  const marker = originatorTag(launchId);
  const tools = String(allowedTools).split(',').map(tool => tool.trim()).filter(Boolean);
  const frontmatter = [
    '---',
    'name: switchboard-session',
    'description: Switchboard-managed interactive session',
  ];
  if (tools.length) {
    frontmatter.push('tools:', ...tools.map(tool => `  - ${yamlString(tool)}`));
  }
  frontmatter.push('---', '', '${base_prompt}', '');
  if (instructions) frontmatter.push(String(instructions), '');
  frontmatter.push(`<!-- ${marker} -->`, '');

  const dir = path.join(dataDir, 'kimi-agents');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const filePath = path.join(dir, `${marker}.md`);
  fs.writeFileSync(filePath, frontmatter.join('\n'), { encoding: 'utf8', mode: 0o600 });
  return {
    filePath,
    marker,
    cleanup() {
      try { fs.unlinkSync(filePath); } catch {}
    },
  };
}

module.exports = { materializeKimiAgentOptions, originatorTag };
