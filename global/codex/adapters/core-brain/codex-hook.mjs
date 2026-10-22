// Host adapter only. Learning, recall, opt-in and deduplication run in the
// UNMODIFIED OpenCode index.ts beside this file.
import plugin from './index.ts';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function createPluginHost(options = {}) {
  const hooks = new Map();
  let tool;
  const dispose = await plugin.setup({
    options,
    tool: {
      async transform(register) {
        register({ add(registered) { tool = registered; } });
        return { dispose() {} };
      },
    },
    session: {
      // Codex's existing MCP adapter also uses this fixed host identity.
      async get() { return { agent: 'codex' }; },
      async hook(name, handler) {
        hooks.set(name, handler);
        return { dispose() { hooks.delete(name); } };
      },
    },
  });
  return { hooks, tool, dispose, options };
}

export async function runNativeHook(input, host) {
  const sessionID = input.session_id;
  if (typeof sessionID !== 'string' || !sessionID) return {};
  const eventName = input.hook_event_name;
  if (eventName !== 'SessionStart' && eventName !== 'UserPromptSubmit') return {};
  if (eventName === 'SessionStart' && input.transcript_path) {
    const delivery = pendingCompactions(input, host);
    let output = {};
    for (const checkpoint of delivery.pending) {
      const event = compactedEvent(input, delivery.rows, checkpoint.index);
      const retainedSystemLength = event.system.length;
      await host.hooks.get('compaction')(event);
      // Only newly injected parts go back to the host. Retained developer
      // context is already in its real history. Keep the latest window's block.
      output = contextOutput(eventName, event.system.slice(retainedSystemLength));
      delivery.complete(checkpoint.key);
    }
    if (delivery.pending.length || input.source === 'compact') return output;
  }
  if (eventName === 'UserPromptSubmit') {
    await host.hooks.get('prompt')({ sessionID, prompt: { text: input.prompt } });
  }
  const event = { sessionID, system: compactContinuationSystem(input) };
  const retainedSystemLength = event.system.length;
  await host.hooks.get('context')(event);
  return contextOutput(eventName, event.system.slice(retainedSystemLength));
}

// This is transport delivery state, not another learning/deduplication policy.
// Codex's pending SessionStart queue is in memory and is lost on process exit.
// Remember which native checkpoints this bridge has delivered so resume can
// finish a pending checkpoint without replaying completed ones. An existing
// thread's first ordinary start establishes a baseline, not retrospective capture.
function pendingCompactions(input, host) {
  const rows = transcriptRows(input);
  const checkpoints = rows.flatMap((row, index) => row.type === 'compacted' ? [{
    index, key: createHash('sha256').update(JSON.stringify(row.payload)).digest('hex'),
  }] : []);
  if (input.source === 'compact' && !checkpoints.length) {
    throw new Error('Compact SessionStart has no persisted checkpoint');
  }
  const home = host.options?.home || process.env.CORE_BRAIN_HOME || resolve(homedir(), '.config/core-brain');
  const directory = resolve(home, 'codex-native-compaction');
  const path = resolve(directory, encodeURIComponent(input.session_id) + '.json');
  const complete = key => {
    mkdirSync(directory, { recursive: true });
    const temporary = path + '.' + process.pid + '.tmp';
    writeFileSync(temporary, JSON.stringify({ lastCheckpoint: key }) + '\n');
    renameSync(temporary, path);
  };
  if (!existsSync(path)) {
    if (input.source !== 'compact') {
      complete(checkpoints.at(-1)?.key ?? null);
      return { rows, pending: [], complete };
    }
    return { rows, pending: checkpoints.slice(-1), complete };
  }
  const state = JSON.parse(readFileSync(path, 'utf8'));
  const previous = state.lastCheckpoint === null ? -1 : checkpoints.findIndex(checkpoint => checkpoint.key === state.lastCheckpoint);
  if (state.lastCheckpoint !== null && previous < 0) {
    throw new Error('Compaction checkpoint delivery lineage changed; host reconstruction required');
  }
  return { rows, pending: checkpoints.slice(previous + 1), complete };
}

function contextOutput(eventName, system) {
  const additionalContext = system.map(part => part.text).join('\n');
  return additionalContext ? {
    hookSpecificOutput: { hookEventName: eventName, additionalContext },
  } : {};
}

// Codex 0.163.0 persists the installed replacement_history before queuing
// SessionStart(source=compact). Replay only the named session to that checkpoint;
// older discarded windows are replaced, not harvested again. No learning rules
// live here: text matching, trim, opt-in, recall and dedupe remain in index.ts.
function transcriptRows(input) {
  if (typeof input.transcript_path !== 'string' || !input.transcript_path) {
    throw new Error('Compact SessionStart requires transcript_path');
  }
  let path = input.transcript_path;
  // A Windows Codex command hook may execute this file in WSL. The host passes
  // Windows paths in JSON; Node in Linux does not translate those paths itself.
  if (process.platform !== 'win32' && process.env.WSL_DISTRO_NAME) {
    // Resume canonicalizes Windows paths to the extended-length namespace.
    path = path.replace(/^\\\\\?\\/, '');
    if (path.startsWith('UNC\\')) path = '\\\\' + path.slice(4);
    path = path.replace(/^([a-z]):[\\/]/i, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll('\\', '/');
    const wslPrefix = `//wsl.localhost/${process.env.WSL_DISTRO_NAME}/`;
    if (path.toLowerCase().startsWith(wslPrefix.toLowerCase())) path = '/' + path.slice(wslPrefix.length);
  }
  const lines = readFileSync(path, 'utf8').split('\n');
  const rows = [];
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim()) continue;
    try { rows.push(JSON.parse(lines[index])); }
    catch (error) {
      // A writer may be appending a later event; incomplete final bytes do not
      // invalidate an already persisted checkpoint. Invalid complete rows do.
      if (index === lines.length - 1) break;
      throw error;
    }
  }
  const meta = rows.find(row => row.type === 'session_meta')?.payload;
  if (meta?.id !== input.session_id) throw new Error('Compaction transcript session mismatch');
  return rows;
}

function systemParts(items) {
  return items.filter(item => item.type === 'message' && ['developer', 'system'].includes(item.role))
    .flatMap(item => {
      if (typeof item.content === 'string') return [{ type: 'text', text: item.content }];
      return (item.content ?? []).filter(part => typeof part?.text === 'string')
        .map(part => ({ type: 'text', text: part.text }));
    });
}

function compactContinuationSystem(input) {
  if (!input.turn_id || !input.transcript_path) return [];
  const rows = transcriptRows(input);
  const checkpointIndex = rows.findLastIndex(row => row.type === 'compacted');
  if (checkpointIndex < 0) return [];
  // SessionStart(compact) and UserPromptSubmit can run in the same native turn.
  // Expose the developer parts that the host has already inserted in this turn
  // to the original marker check; do not invent a second deduplication rule.
  return systemParts(rows.slice(checkpointIndex + 1)
    .filter(row => row.type === 'response_item'
      && row.payload.internal_chat_message_metadata_passthrough?.turn_id === input.turn_id)
    .map(row => row.payload));
}

function compactedEvent(input, rows, checkpointIndex) {
  if (checkpointIndex < 0) throw new Error('Compact SessionStart has no persisted checkpoint');
  const replacement = rows[checkpointIndex].payload?.replacement_history;
  if (!Array.isArray(replacement)) throw new Error('Compaction checkpoint requires replacement_history');
  let history = [];
  for (const row of rows.slice(0, checkpointIndex)) {
    if (row.type === 'response_item') history.push(row.payload);
    else if (row.type === 'compacted') {
      if (!Array.isArray(row.payload?.replacement_history)) {
        throw new Error('Previous compaction checkpoint requires replacement_history');
      }
      history = row.payload.replacement_history;
    } else if (row.type === 'event_msg' && row.payload?.type === 'thread_rolled_back') {
      // Rollback can invalidate an earlier checkpoint. Do not present an
      // approximate forward replay as the actual active context.
      throw new Error('Compaction transcript rollback requires host reconstruction');
    }
  }
  const message = item => {
    if (item?.type !== 'message') return null;
    if (typeof item.content === 'string') return { role: item.role, content: item.content };
    if (!Array.isArray(item.content)) return null;
    return { role: item.role, parts: item.content.filter(part => typeof part?.text === 'string')
      .map(part => ({ text: part.text })) };
  };
  const retained = new Map();
  for (const item of replacement) {
    const translated = message(item);
    if (!translated) continue;
    const key = JSON.stringify(translated);
    retained.set(key, (retained.get(key) ?? 0) + 1);
  }
  const messages = [];
  for (const item of history) {
    const translated = message(item);
    if (!translated) continue;
    const key = JSON.stringify(translated);
    const count = retained.get(key) ?? 0;
    if (count) retained.set(key, count - 1);
    else messages.push(translated);
  }
  // Resume and compact starts can both be pending. Their developer context
  // is live even when it was inserted after the installed checkpoint.
  const nextCheckpoint = rows.findIndex((row, index) => index > checkpointIndex && row.type === 'compacted');
  const system = systemParts([...replacement,
    ...rows.slice(checkpointIndex + 1, nextCheckpoint < 0 ? rows.length : nextCheckpoint)
      .filter(row => row.type === 'response_item').map(row => row.payload)]);
  return { sessionID: input.session_id, messages, system };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let host;
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
    host = await createPluginHost();
    process.stdout.write(JSON.stringify(await runNativeHook(input, host)) + '\n');
  } catch (error) {
    // The original plugin also contains failures instead of blocking the host.
    console.error('[core-brain] Codex hook adapter:', error.message ?? error);
    if (process.env.CORE_BRAIN_DEBUG === '1' && process.env.CORE_BRAIN_HOME) {
      try {
        appendFileSync(resolve(process.env.CORE_BRAIN_HOME, 'codex-hook-errors.jsonl'), JSON.stringify({
          event: input?.hook_event_name, source: input?.source, session: input?.session_id,
          transcript: input?.transcript_path, error: error.message ?? String(error),
        }) + '\n');
      } catch { /* Diagnostics must not change failure handling. */ }
    }
    process.exitCode = 1;
  } finally {
    host?.dispose();
  }
  // The embedding runtime has worker threads. A command hook is a completed
  // one-shot host, unlike the long-lived OpenCode plugin/MCP process.
  await new Promise(done => process.stdout.write('', done));
  await new Promise(done => process.stderr.write('', done));
  process.exit(process.exitCode ?? 0);
}
