// Kimi sessions are started and forked with the CLI, never `kimi acp`: a
// session created or forked over ACP stays bound to that ACP process's tool
// runtime (`acp:<id>`), so once the process is gone every tool call in the
// resumed TUI fails with "runtime ... does not exist in workspace".

/** The child's id from `kimi fork <id> --yes`, which prints it and exits. */
function parseKimiForkOutput(text) {
  const match = String(text || '').match(/Forked to (session_[A-Za-z0-9-]+)/);
  return match ? match[1] : null;
}

// The TUI has no argv slot for a first prompt and writes no transcript until
// one is sent, so the prompt is typed once the welcome screen is up — which is
// after any folder-trust question has been answered.
const READY_MARKER = 'Welcome to Kimi Code';
const SUBMIT_DELAY_MS = 300;

/**
 * Watches PTY output and types `prompt` once the TUI is ready. Bracketed paste
 * keeps a multi-line prompt from being submitted line by line. `feed` returns
 * true once the prompt has been sent.
 */
function createKimiPromptDelivery(prompt, write, { schedule = setTimeout } = {}) {
  let tail = '';
  let sent = false;
  return {
    feed(data) {
      if (sent) return true;
      tail = (tail + data).slice(-4096);
      if (!tail.includes(READY_MARKER)) return false;
      sent = true;
      write(`\x1b[200~${prompt}\x1b[201~`);
      schedule(() => write('\r'), SUBMIT_DELAY_MS);
      return true;
    },
  };
}

module.exports = { parseKimiForkOutput, createKimiPromptDelivery };
