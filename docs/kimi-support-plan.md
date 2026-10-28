# Kimi Code support plan

## 1. Goal, scope, and evidence

Add Kimi Code as Switchboard's third CLI harness, alongside Claude and Codex. The target is feature parity for at least 90% of the user-facing Claude capabilities inventoried below, without changing Claude or Codex behavior.

This document records the plan and its implementation status. **Supported** below means that a concrete implementation route exists and is included in this plan; the implementation and verification completed afterward are recorded in section 8. **Deferred** means the first Kimi release will explicitly omit the capability. **Blocked** means no credible route is currently known; no feature is allowed to remain silently blocked.

The parity denominator is the complete 36-row matrix below: 33 Supported rows and 3 Deferred rows give **91.7% planned coverage (33/36)**. Deferred rows stay in the denominator. A row may only remain Supported after its cited interface is confirmed by the pre-implementation probes in section 6.

### Repository evidence

- The common harness contract is in `harnesses/index.js`; Claude and Codex implementations are in `harnesses/claude.js` and `harnesses/codex.js`.
- `main.js` owns PTY launch, input/output, active-session rekeying, filesystem watchers, and terminal status events.
- `session-cache.js`, `workers/scan-projects.js`, and `db.js` own transcript indexing, metadata, and FTS5 search.
- `public/app.js`, `public/dialogs.js`, `public/session-config.js`, `public/session-config-form.js`, `public/schedules.js`, `public/sidebar.js`, and `public/projects-view.js` own launch and session UI.
- `public/terminal-manager.js` and `public/grid-view.js` are runtime-neutral and should be reused rather than duplicated.
- Claude's IDE emulation is a separate WebSocket MCP protocol in `mcp-bridge.js`; it must not be presented as portable to Kimi.

### Verified Kimi interfaces

Official documentation:

- [`kimi` command](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command.html): interactive launch, `--session`, `--continue`, `--model`, `--yolo`, `--auto`, `--plan`, `--agent-file`, and repeatable `--add-dir`; `-p` is non-interactive and is not a substitute for an interactive first prompt.
- [Sessions](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/sessions.html): `state.json`, `agents/main/wire.jsonl`, session titles, and `forkedFrom` metadata.
- [Data locations](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/data-locations.html): `$KIMI_CODE_HOME`, defaulting to `~/.kimi-code`; `session_index.jsonl`; `sessions/<workDirKey>/<sessionId>/`; main and subagent wire files.
- [Configuration](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/config-files.html): model aliases, thinking effort, permission modes, model metadata, and TUI notifications.
- [Environment variables](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/env-vars.html): `KIMI_CODE_HOME` and per-process model/thinking overrides.
- [ACP reference](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp.html): structured session new/load/resume/list/fork/close, prompts, cancellation, model/mode selection, updates, and permission requests.

Local read-only CLI probes, using Kimi Code **2.3.2**, additionally confirmed:

- `kimi fork [sessionId] --yes` exists and forks non-interactively.
- `kimi session list --all --json` exists and emits session summaries.
- `kimi acp` exists.

The online command page does not yet list the local `fork` and `session` commands. The implementation must therefore version-gate these conveniences and retain a documented fallback; it must not assume every installed Kimi version has them.

## 2. Claude-to-Kimi capability matrix

| # | Claude user-facing capability | Initial status | Kimi implementation route |
|---|---|---|---|
| 1 | Discover session history | Supported | Register a `kimi` harness; enumerate `$KIMI_CODE_HOME/sessions/<workDirKey>/<sessionId>/agents/main/wire.jsonl` and join `state.json` plus `session_index.jsonl`. |
| 2 | Group sessions by project folder | Supported | Use `workDir` from the session index/state, not the bucket name; set `groupsByProject = true` and namespace folder keys with `kimi/`. |
| 3 | Full-text session search | Supported | Parse main-agent user/assistant text into the existing `session_cache` and FTS5 pipeline; exclude subagents and protocol bookkeeping. |
| 4 | Session titles and renames | Supported | Read title metadata from `state.json`/session index and preserve Switchboard's existing title precedence; watch files for external `/title` changes. |
| 5 | Message viewer | Supported | Convert main `wire.jsonl` events to the viewer's common user/assistant entries. |
| 6 | Tool calls, results, and readable reasoning in viewer | Supported | Map tool events by call ID and render only plain readable reasoning summaries; never attempt to decrypt hidden reasoning. |
| 7 | Start a new interactive terminal | Supported | Spawn `kimi` through the existing login-shell/`node-pty` path in the selected cwd. |
| 8 | Resume a specific session | Supported | Spawn `kimi --session <sessionId>`; the cached runtime remains authoritative. |
| 9 | Fork a session | Supported | Prefer a structured ACP `session/fork` followed by PTY resume, or the version-gated `kimi fork <id> --yes` plus `kimi --session <newId>`; identify the child from returned metadata, never mtime alone. |
| 10 | Adopt the real ID for new/forked sessions | Supported | Use ACP-returned IDs where available; otherwise match session-index/state records by exact canonical cwd, parent `forkedFrom`, and creation time, then use the existing `session-detected` rekey flow. |
| 11 | Initial prompt for plan items and schedules | Supported | Do not use `kimi -p`, which is non-interactive. Use ACP session creation/prompt when that path is proven compatible, otherwise inject the prompt only after a tested TUI-readiness handshake. |
| 12 | Stop a running session | Supported | Reuse PTY termination; use ACP cancel only for an ACP-owned turn. |
| 13 | Running, idle, and completed indicators | Supported | Derive turn state from main wire events and PTY liveness; use OSC title/notification signals only after a probe establishes their exact Kimi meaning. |
| 14 | Permission/attention notifications | Supported | Map persisted permission/question events to the existing `terminal-notification` channel; ACP `session/request_permission` is the structured fallback for ACP-owned sessions. |
| 15 | Live terminal grid | Supported | Reuse the runtime-neutral xterm/grid implementation and normalized busy/attention state. |
| 16 | Detach, renderer reload, and PTY reattach | Supported | Reuse `activeSessions`, bounded output replay, and `session-detected` rekeying; add Kimi cases to the existing lifecycle tests. |
| 17 | Retained terminal history | Supported | Reuse the runtime-neutral renderer scrollback store and rekey it from temporary to real IDs. |
| 18 | Star, archive, move, and unread state | Supported | Reuse existing metadata operations keyed by session ID/runtime. |
| 19 | Project and track assignment | Supported | Reuse `recordLaunchAssignment`, assignment moves on rekey, and project/track context. |
| 20 | Project and attached directories | Supported | Pass repeatable `--add-dir` values from `projects.launchContext` and the shared `addDirs` option. |
| 21 | Start sessions from plans and todos | Supported | Reuse project plan links and the initial-prompt mechanism in row 11. |
| 22 | Scheduled sessions | Supported | Reuse scheduler configuration and launch flow with Kimi-specific fields and isolated runtime settings. |
| 23 | Permission and plan modes | Supported | Map Always Ask/manual, Ask When Needed/`--yolo`, Never Ask/`--auto`, and Plan/`--plan`; validate mutually exclusive choices and allow documented resume overrides. |
| 24 | Model selection | Supported | Pass `--model <alias>` and read aliases/display metadata from Kimi configuration without reading credentials. |
| 25 | Thinking effort | Supported | Use ACP `session/set_config_option` for ACP-owned sessions or the documented per-process thinking override for PTY launches; validate against model `support_efforts`. |
| 26 | Allowed-tool restrictions | Supported | Generate a temporary Kimi agent definition with the requested tool policy and launch new sessions with `--agent-file`; omit on resume because agent binding is fixed at creation. |
| 27 | Additional system instructions | Supported | Use the same generated `--agent-file` mechanism for new sessions; clearly label that it is agent instructions, not Claude's `--append-system-prompt`, and do not silently apply it on resume. |
| 28 | Pre-launch command | Supported | Reuse the existing explicit raw-shell `preLaunchCmd` behavior and argument quoting. |
| 29 | Worktree-backed project sessions | Supported | Reuse Switchboard's existing project/worktree launch cwd. Do not invent a Kimi equivalent to Claude's one-off `--worktree` flag. |
| 30 | Plans and memory files | Supported | Browse Kimi plan files under `agents/main/plans/` and project `AGENTS.md`/project memory through the existing file UI; keep format-specific behavior separate from Claude plans. |
| 31 | Cross-platform launch and data discovery | Supported | Reuse shell profiles and `KIMI_CODE_HOME`; add macOS, Windows, and Linux fixtures/smoke coverage. WSL remains plain-terminal-only unless explicitly verified. |
| 32 | CLI selection, icons, enable/disable settings | Supported | Add Kimi to the harness registry and replace hardcoded Claude/Codex icon/menu branches with registry-driven label/icon selection. |
| 33 | First-run and authentication failure handling | Supported | Surface shell/CLI errors in the terminal, validate configuration with `kimi doctor` in diagnostics, and offer a documented `kimi login` recovery path without reading or storing OAuth tokens. |
| 34 | Claude IDE diff emulation | Deferred | Keep this Claude-only in the first Kimi release. A later phase may evaluate Kimi ACP file/diff integration; do not reuse Claude's WebSocket MCP protocol. |
| 35 | Chrome automation | Deferred | No Kimi equivalent to Claude's `--chrome` flag is established by the cited evidence; omit the control for Kimi. |
| 36 | Account quota API | Deferred | No stable public Kimi quota endpoint is established by the cited evidence; do not read credentials or invent a quota integration. |

Rows 1–33 are Supported and rows 34–36 are Deferred: **33/36 = 91.7% planned coverage**.

## 3. Architecture decision

### Option A: PTY only

**Advantages**

- Preserves the existing xterm experience, terminal grid, input handling, login-shell environment, and process lifecycle.
- Kimi owns authentication, model calls, tools, and persistence, just as Claude and Codex do.
- Official CLI flags cover launch, resume, model, permissions, plan mode, agent files, and additional directories.

**Limits**

- No documented caller-assigned session ID.
- `kimi -p` is non-interactive, so scheduled/first-prompt behavior needs a separate handshake.
- Exact OSC title/progress semantics are not documented.
- Fork and structured status support vary by CLI version.

### Option B: ACP only

**Advantages**

- Structured session IDs, listing, forking, prompting, cancellation, model/mode selection, streaming updates, and permission requests.
- Avoids terminal scraping for control-plane operations.

**Limits**

- ACP is an IDE JSON-RPC protocol, not the interactive Kimi TUI. Replacing xterm with a new ACP conversation renderer would duplicate substantial existing terminal behavior and would not satisfy the terminal-session goal by itself.
- ACP filesystem/terminal reverse RPC would require a second agent UI and permission implementation.
- Running an ACP writer and a TUI writer against one live session risks lock and event-order conflicts.

### Option C: PTY-led hybrid — recommended

Use each integration for what it already does well:

1. **PTY is the interaction transport.** Keep xterm, shell profiles, terminal input/output, grid, stop, and reattach.
2. **Kimi's persisted data is the indexing and status control plane.** Parse `state.json`, `session_index.jsonl`, and only `agents/main/wire.jsonl`; never index subagent wire files as top-level sessions.
3. **ACP is a short-lived structured control channel only where it removes real ambiguity**, primarily fork and possibly initial-prompt creation. Close the ACP session before attaching the TUI. Do not run ACP and PTY as concurrent writers.
4. **Feature detection beats version guessing.** Use CLI help/ACP initialize and a small capability probe; retain a file-based fallback for session discovery and ID adoption.

This approach preserves Switchboard's architecture while avoiding a second renderer. It also keeps Kimi-specific protocol knowledge inside the harness and a small ACP client module rather than spreading it through the UI.

### Prerequisite probe for the hybrid boundary

Before choosing ACP for any production operation, verify with an isolated `KIMI_CODE_HOME` that:

- ACP `session/fork` returns the new ID and `session/close` releases all session locks.
- A subsequent `kimi --session <newId>` opens the same fork with complete history.
- No ACP-created session is left running or writing after the PTY starts.
- If ACP prompt creation is used, its turn is complete and closed before TUI resume.

If this probe fails, use the version-gated non-interactive fork command plus session-index adoption. Do not weaken the single-writer rule.

## 4. File-level implementation sequence

Implement in the following order. Each stage must land with its tests and leave Claude, Codex, and raw terminals working.

### Stage 0 — Capture synthetic Kimi fixtures and pin the support contract

1. Run the safe probes in sections 3 and 7 using a temporary `KIMI_CODE_HOME` and synthetic conversations only.
2. Save sanitized `state.json`, `session_index.jsonl`, and `agents/main/wire.jsonl` fixtures under `test/fixtures/kimi/`. Include a normal session, a fork, a session with tool calls and readable reasoning, a permission request, a truncated final line, and concurrent same-cwd launches.
3. Record the tested CLI version and ACP `initialize` capabilities. Select the minimum supported version from observed feature availability, not from the newest local install.
4. Recalculate the matrix from confirmed behavior before implementation. If Supported coverage falls below 90%, stop and report the gap rather than silently removing features from the denominator.

### Stage 1 — Add the Kimi harness and read-only history

1. Create `harnesses/kimi.js` with `id = 'kimi'`, `label = 'Kimi'`, `binary = 'kimi'`, `folderPrefix = 'kimi/'`, and project grouping based on canonical `workDir`.
2. Implement the existing harness contract:
   - `kimiHome()` resolves `KIMI_CODE_HOME` or `~/.kimi-code`; `sessionsRoot()` returns its `sessions/` directory.
   - `listFolders()` returns namespaced `<workDirKey>` bucket keys; `folderPath()` resolves only validated bucket names.
   - `listTranscripts()` returns only `<sessionId>/agents/main/wire.jsonl`, never subagent wire files.
   - `sessionIdFromPath()` reads the session directory name; `transcriptPath()` uses the cached authoritative `sessionFile`.
   - `deriveProjectPath()` and `readSessionFile()` join the main wire file to `state.json` and the matching `session_index.jsonl` record. Canonical `workDir` from metadata wins over the opaque bucket name.
3. Parse user/assistant text, timestamps, tool events, and readable reasoning into the existing session row. Use `jsonl-scan.js` and the existing `headHash`/`indexedBytes` fields for bounded incremental appends. Reset safely on truncation, replacement, or an incomplete trailing record.
4. Implement `toViewerEntries()` using the same common viewer shape as Codex. Pair tool results by call ID and omit protocol bookkeeping and subagent activity.
5. Implement title reading from state/index metadata without treating Switchboard's AI title as a user rename.
6. Register the module in `harnesses/index.js`. Add generic tests there for folder-prefix uniqueness and the complete launch/index/activity contract.

### Stage 2 — Generalize discovery, watchers, and search

1. Update `workers/scan-projects.js`: it currently destructures the Claude parser and scans only `PROJECTS_DIR`. Pass a harness-aware work list and scan every enabled harness root through its own contract.
2. Update `session-cache.js` so cold population, incremental refresh, title refresh, deletion, and reconciliation all handle the nested Kimi main-wire layout. Preserve mtime gates and late-append detection.
3. Refactor `startHarnessWatchers()` in `main.js`: the current non-Claude watcher assumes Codex's `YYYY/MM/DD` path. Add a harness-owned event-to-folder mapping, plus watching of Kimi `state.json` and `session_index.jsonl`, instead of adding another hardcoded depth check.
4. Extend `sweepPendingLaunches()` and `resolvePendingLaunches()` to consume Kimi state/index candidates as well as wire files. Keep exact cwd, parent, spawn-time, and already-claimed-ID checks.
5. Reuse `db.js` unchanged initially. `runtime`, `sessionFile`, `headHash`, `indexedBytes`, `firstTimestamp`, and `lastTimestamp` already support Kimi. Add a migration only if the captured fixtures prove that additional durable parser state is necessary; any such migration must be additive and covered by `test/db-schema-reconcile.test.js`.
6. Update `folder-index-state.js` only if its current newest-JSONL gate does not observe nested main-wire changes. Include state/index sidecars in the gate where needed without causing a full re-index on every append.

### Stage 3 — Add structured ACP control and launch orchestration

1. Add a small `kimi-acp-client.js` using Node child-process and stream primitives, or an explicitly approved ACP SDK if dependency review favors it. Implement `initialize`, capability detection, `session/fork`, optional `session/new`/`session/prompt`, and `session/close`, with timeouts and stderr diagnostics. Never log credentials or full prompt contents.
2. Add a pure `kimi-launch.js` state machine for the production sequence: temporary ID → structured operation → confirmed close → real ID → PTY attach → `session-detected` rekey. It must refuse concurrent ACP/TUI writers and define cleanup after every failure.
3. Implement Kimi `buildLaunchArgs()` for interactive launch and resume: no ID on new sessions, `--session <id>` on resume, repeatable `--add-dir`, `--model`, validated permission/plan flags, and `--agent-file` only on new sessions. Use documented environment overrides for per-process thinking effort.
4. Do not force fork through a single argv string. In `main.js`, let the harness select a launch strategy: direct PTY for new/resume, ACP-then-PTY or version-gated CLI-fork-then-PTY for forks. This is a small extension to the harness contract, shared by tests.
5. Implement first-prompt delivery in `main.js`/`kimi-launch.js`. Prefer a completed-and-closed ACP prompt only if the prerequisite probe passes. Otherwise use a TUI-readiness handshake with a bounded timeout and a visible error; never type into an unready or resumed session and never use `kimi -p` as an interactive session.
6. Keep `mcp-bridge.js` and the `isClaudeSession` IDE branch Claude-only. Do not pass `--ide`, `CLAUDE_CODE_SSE_PORT`, Claude worktree flags, or Chrome flags to Kimi.
7. Normalize Kimi wire turn and permission events into the existing `cli-busy-state` and `terminal-notification` messages in `main.js`. Keep PTY liveness separate from agent busy state. OSC parsing may be added only for sequences pinned by fixtures.

### Stage 4 — Add launch settings and model metadata

1. Extend `SETTING_DEFAULTS` in `main.js` with Kimi-owned fields: permission mode, plan mode, model, thinking effort, allowed tools, and additional agent instructions. Keep `preLaunchCmd` and `addDirs` shared.
2. Add matching fields and validation in `public/session-config.js`: `manual`/`yolo`/`auto`, plan as a separate compatible choice, model-specific effort lists, multiline instruction validation, and rejection of other runtimes' fields.
3. Generalize `public/session-config-form.js` and the model-catalog IPC in `main.js`/`preload.js` from `getCodexModels` to a harness-aware model request, retaining the old binding for compatibility. Read Kimi model aliases, display names, `support_efforts`, and defaults without exposing provider credentials.
4. Generate temporary agent Markdown for allowed-tool and additional-instruction options. Keep it under Switchboard's data directory with restrictive permissions, pass its absolute path through `--agent-file`, and clean it up after launch. Resume uses the originally bound agent and must not claim that new overrides apply.
5. Extend `public/schedules.js` and `projects.js` validation through the existing per-runtime `sessionConfig` map. No schedule schema change is needed because configurations are already keyed by CLI.

### Stage 5 — Complete the renderer and documentation

1. Add `ICONS.kimi` in `public/icons.js` and centralize runtime-to-label/icon helpers. Replace hardcoded branches in `public/dialogs.js`, `public/sidebar.js`, `public/projects-view.js`, `public/schedules.js`, and `public/app.js`; the current Codex-else-Claude fallbacks would mislabel Kimi.
2. Replace hardcoded Claude/Codex launch menus in `public/projects-view.js` with the enabled harness list used by the new-session popover. Preserve track defaults and fork-runtime inheritance.
3. Keep terminal behavior in `public/terminal-manager.js`, `public/grid-view.js`, and `public/app.js` runtime-neutral. Only add Kimi-specific handling for real-ID adoption and first-prompt errors where the shared abstraction is insufficient.
4. Add Kimi plan-file discovery behind a harness-specific adapter rather than redirecting Kimi to `~/.claude/plans`. Keep project `AGENTS.md` and memory editing in the existing file UI.
5. Update `README.md` supported-CLI and launch-option tables, document deferred IDE/Chrome/quota features and the minimum supported Kimi version, and add troubleshooting for missing CLI, authentication, and unsupported older versions.
6. Update `package.json` build file lists only if the new ACP client or fixtures are not already covered by `*.js`, `harnesses/**/*`, and test exclusions. Do not add production dependencies without a separate compatibility decision.

## 5. Automated testing plan

### Unit and fixture tests

Create `test/harness-kimi.test.js` with temporary homes modeled on `test/harness-claude.test.js` and `test/harness-codex.test.js`:

- Root relocation through `KIMI_CODE_HOME`; folder listing and path reconstruction.
- Main-wire discovery, session ID extraction, project grouping, title precedence, created/modified timestamps, message counts, summaries, and full search text.
- User/assistant/tool/reasoning viewer conversion and call-ID pairing.
- Exclusion of subagents, injected protocol events, empty sessions, malformed lines, and sessions without a usable cwd.
- Incremental append, unchanged-file skip, truncated tail retry, atomic replacement, and late writes during indexing.
- Exact launch argv for new/resume, permission conflicts, model/effort validation, additional directories, agent-file rules, and absence of Claude-only flags.
- Launch matching by exact cwd and spawn time; forks additionally require the exact parent. Two same-cwd sessions must never steal each other's records.

Add focused suites:

- `test/kimi-acp-client.test.js`: fake stdio server for initialization, capability negotiation, request/response framing, fork ID, timeout, malformed response, close, process exit, and cleanup. Assert that close precedes PTY attach.
- `test/kimi-launch.test.js`: state-machine tests for direct new/resume, ACP fork, CLI-fork fallback, real-ID rekey, first-prompt readiness, slow startup, failure cleanup, and the single-writer invariant.
- `test/kimi-status.test.js`: synthetic turn-start, turn-end, permission/question, malformed-event, and PTY-exit sequences; busy and attention must not become stuck.
- `test/harness-watchers.test.js`: Codex date paths and Kimi nested session paths, state/index-only changes, disabled harnesses, dropped-event sweep, and no cross-runtime refresh.
- `test/db-schema-reconcile.test.js`: existing rows remain valid with `runtime = 'kimi'`; test any additive migration if one is introduced.
- `test/session-config.test.js`: Kimi defaults, overrides, cross-CLI rejection, schedule inheritance, model-specific efforts, and multiline agent instructions.
- Renderer VM tests patterned after the existing suite: Kimi icons/labels, harness-driven menus, track defaults, fork runtime, and no Codex-else-Claude fallback.

### Integration tests with isolated data and a fake CLI

Use fresh temporary directories for both `KIMI_CODE_HOME` and `SWITCHBOARD_DATA_DIR` in every scenario. Never read or copy the developer's real OAuth files, sessions, or Switchboard database.

Place a fake `kimi` executable at the front of a controlled launch PATH, or invoke it by an explicit test-only binary path. The fake records argv/environment, emits deterministic PTY output, writes the synthetic Kimi session layout, and can simulate delay, failure, permission prompts, and exit. No model API is contacted.

Cover these flows end to end through the real main-process/harness/cache boundaries:

1. Cold start with no Kimi home, empty history, and no database.
2. New session → real-ID detection → search/index → viewer → resume.
3. Fork → parent linkage → real-ID rekey → project/track/schedule-link preservation.
4. Two concurrent new sessions and two forks in the same cwd; IDs and terminal output remain correctly associated.
5. Initial prompt from a schedule, plan item, and todo; delayed readiness and timeout produce one visible error and no duplicate prompt.
6. Busy → permission/attention → idle transitions and terminal-grid state.
7. Rename in Kimi, archive/star/move in Switchboard, and full-text search after external appends.
8. Renderer reload reattaches the same PTY and replay buffer; application restart resumes from disk without duplicating rows.
9. Stop, unexpected process exit, ACP failure, partial transcript, and cleanup of temporary agent files/locks.
10. Missing binary, authentication required, invalid config, unsupported CLI version, and unavailable model; each has a useful error and recovery path.
11. Project attachments become repeated `--add-dir` arguments; worktree cwd and project assignment survive resume/fork.
12. Claude, Codex, raw-terminal, project-task, and scheduler regression scenarios remain unchanged.

Run integration suites on macOS, Linux, and Windows CI. Use platform-appropriate shell profiles and path fixtures. Keep WSL excluded from agent launches unless a dedicated test proves transcript and cwd semantics.

### Regression gate after every stage

- Run the focused new/changed suites after each edit.
- Run `npm test` before merging each stage; all pre-existing and new tests must pass with no skipped Kimi parity cases.
- Run `npm run bundle` before renderer smoke tests.
- Inspect the diff to confirm planning placeholders are gone, deferred features are visibly labeled, and no existing assertions were weakened.

## 6. Clean-profile, real-CLI, and release plan

### Prerequisite capability probes

Run these against the oldest and newest supported Kimi versions, with temporary homes and harmless synthetic workspaces:

- [ ] Capture the exact state/index/wire schemas for all events used by the parser.
- [ ] Verify `kimi session list --all --json` and `kimi fork --yes`; verify feature detection on a version that lacks either command.
- [ ] Verify ACP initialize/fork/close, lock release, and subsequent PTY resume with complete history.
- [ ] Verify first-prompt delivery under normal and artificially delayed TUI startup; no duplicate or premature input is acceptable.
- [ ] Capture turn, permission, and completion events. Add OSC handling only if the observed sequences are stable and meaningful.
- [ ] Re-run the parity count. If fewer than 90% of rows have a working route, stop and report the gap.

### Authenticated clean-profile smoke checklist

For each supported desktop platform, create new temporary `KIMI_CODE_HOME` and `SWITCHBOARD_DATA_DIR` directories. Complete `kimi login` in the temporary Kimi home through the normal device flow; do not copy credentials from another profile. Start Switchboard with its development data-isolation setting and verify:

- [ ] First launch explains missing authentication and offers the `kimi login` recovery path; after login, no restart loop or stale error remains.
- [ ] A new interactive session starts in the requested cwd, accepts input, produces output, receives the correct real ID, and appears once in history.
- [ ] The session survives sidebar navigation, grid/single-terminal switching, renderer reload, and application restart/resume.
- [ ] A fork contains the parent history, gets a distinct ID, opens in the PTY, and preserves project/track filing.
- [ ] Two simultaneous same-cwd launches and forks remain distinct throughout launch, indexing, and rekey.
- [ ] Search finds user and assistant text; the viewer shows messages, tools, results, and readable reasoning without subagent leakage.
- [ ] `/title` or the supported rename flow updates the sidebar without replacing a Switchboard user rename.
- [ ] Busy, idle, and permission/attention states clear correctly; no spinner or badge remains stuck after exit.
- [ ] Model, thinking effort, permission/plan mode, allowed tools, additional instructions, pre-launch command, and additional directories reach the real CLI as configured.
- [ ] A project session sees its brief and attachments; plan/todo and scheduled prompts run exactly once in the intended folder.
- [ ] Missing CLI, logged-out profile, invalid model/config, old CLI, offline service, and interrupted launch all fail visibly and recover without deleting cached history.
- [ ] Claude and Codex new/resume/fork smoke checks and a raw-terminal check still pass.
- [ ] Deferred IDE diff, Chrome, and quota controls are absent or explicitly marked unsupported for Kimi; they never silently no-op.

### Release-blocking gate

A release candidate is acceptable only when all of the following are true on the deliverable itself:

1. `npm test` exits 0 with no failed, skipped, or todo Kimi parity tests.
2. `npm run bundle` and the applicable production build (`npm run build:mac`, `npm run build:win`, or `npm run build:linux`) succeed for every platform being released.
3. Every prerequisite probe and every applicable clean-profile smoke item passes against the packaged app, not only `npm start`.
4. Claude/Codex regression smoke tests pass, and no existing test or fixture was weakened to obtain parity.
5. The final capability matrix still documents at least 90% Supported coverage; every unverified row is marked Deferred or Blocked with its evidence and smallest resolving probe.
6. There are zero known release-blocking failures, orphaned ACP/PTY processes, session-lock leaks, duplicate prompts, wrong-session adoptions, or credential/log disclosures.

This is the evidence-based replacement for a claim that the first run is “absolutely perfect”: release only with all specified checks green and all remaining limitations explicit.

## 7. Open questions and smallest resolving probes

| Question | Smallest safe probe | Decision affected |
|---|---|---|
| Which wire events represent user text, assistant text, tool calls/results, turn start/end, and permission requests? | In a temporary `KIMI_CODE_HOME`, run one harmless scripted session and inspect only that synthetic session's `state.json`, index record, and main wire file. | Parser, search, viewer, busy/attention state. |
| What are the exact session-index fields and timestamp semantics? | Run `kimi session list --all --json` in the same synthetic home and compare with the state/index files. | Discovery and real-ID adoption. |
| Does ACP close fully release a fork/new session for TUI resume? | Execute the prerequisite sequence in section 3 and inspect lock files plus resumed history. | Hybrid control plane. |
| Can a PTY first prompt be injected deterministically without using non-interactive `-p`? | Launch a synthetic TUI and gate input on a documented readiness signal; test slow startup and resumed sessions. | Schedules, plans, todos. |
| Which OSC sequences does the installed TUI emit? | Capture a synthetic PTY stream during turn start, permission request, completion, and idle. | Whether OSC may supplement wire-based status. |
| What is the minimum supported Kimi version? | Compare feature detection and fixtures against the oldest version selected for support. | Version gate and fallback behavior. |

## 8. Implementation and validation status

Implemented the 33 Supported capabilities in the matrix. The three Deferred capabilities remain intentionally unsupported: Claude IDE diff emulation, Chrome automation, and Kimi account quota display.

The implementation includes the Kimi harness and nested transcript indexing, cold and live discovery, message/viewer normalization, ACP-backed new/fork/session preparation, exact real-ID adoption, interactive PTY resume, initial prompts, wire-driven activity, model and permission settings, generated agent options, registry-driven renderer controls, and Claude/Kimi plan and memory files.

Validation completed:

- `npm test`: **477 tests passed**, including new Kimi harness, watcher, ACP, launch, status, settings, agent-option, and plan-file suites.
- `npm run bundle`: passed.
- `npm run build:mac`: produced arm64 and x64 DMG and ZIP artifacts. Code signing/notarization was skipped because no signing identity was available.
- Real Kimi 2.3.2 ACP probes: fork/close released all locks; initial prompt completed against a local mock model.
- Real custom-agent CLI probe: the generated `--agent-file` was accepted, the launch marker persisted, and the mock reply completed successfully.
- Clean-profile Electron smoke test with isolated `KIMI_CODE_HOME` and `SWITCHBOARD_DATA_DIR`: created a Kimi session, submitted a prompt through real renderer IPC, received the mock reply, indexed and returned search results, read the normalized message viewer, and forked with the correct `forkedFrom` parent and complete history. A follow-up launch confirmed that the renderer and main process both focus the same real session ID.

Not verified here: Windows or Linux runtime smoke tests, a production Kimi account/login flow, or signed/notarized packages. Those remain platform/release responsibilities rather than silently passed checks.
