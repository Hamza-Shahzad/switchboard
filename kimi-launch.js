async function prepareKimiFork(client, parentId, { cwd } = {}) {
  const sessionId = await client.fork(parentId, { cwd });
  try {
    await client.closeSession(sessionId);
  } catch (error) {
    throw new Error(`Kimi fork was created but could not be closed before terminal attach: ${error.message}`);
  }
  return sessionId;
}

async function prepareKimiInitialPrompt(client, {
  cwd, prompt, additionalDirectories = [], model = '', permissionMode = '', plan = false,
}) {
  const sessionId = await client.newSession({ cwd, additionalDirectories });
  try {
    if (model) await client.setConfigOption(sessionId, 'model', model);
    const mode = plan ? 'plan' : permissionMode === 'yolo' ? 'yolo'
      : permissionMode === 'auto' ? 'auto' : permissionMode === 'manual' ? 'default' : null;
    if (mode) await client.setConfigOption(sessionId, 'mode', mode);
    if (prompt) await client.prompt(sessionId, prompt);
    await client.closeSession(sessionId);
  } catch (error) {
    throw new Error(`Kimi session could not be prepared for terminal attach: ${error.message}`);
  }
  return sessionId;
}

async function prepareKimiLaunch(client, {
  cwd, forkFrom, initialPrompt, additionalDirectories = [], model = '', permissionMode = '', plan = false,
}) {
  if (forkFrom) return prepareKimiFork(client, forkFrom, { cwd });
  return prepareKimiInitialPrompt(client, {
    cwd, prompt: initialPrompt, additionalDirectories, model, permissionMode, plan,
  });
}

module.exports = { prepareKimiFork, prepareKimiInitialPrompt, prepareKimiLaunch };
