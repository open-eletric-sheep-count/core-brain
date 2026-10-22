// Native lifecycle transport for the unchanged OESC context-inject engine.
import plugin from './index.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function runNativeHook(input, options = {}) {
  if (typeof input.session_id !== 'string' || !input.session_id) return {};
  const nativeEvent = input.hook_event_name;
  let compacted = false;
  let agent;
  if (nativeEvent === 'SessionStart') {
    // Native resume/fork already carry history. Never replay creation files.
    if (!['startup', 'clear', 'compact'].includes(input.source)) return {};
    compacted = input.source === 'compact';
    agent = 'codex';
  } else if (nativeEvent === 'SubagentStart') {
    agent = typeof input.agent_type === 'string' && input.agent_type ? input.agent_type : null;
  } else {
    return {};
  }

  // Codex owns the lifecycle decision. Normalize its event into the original
  // plugin's session-info contract; file selection/loading/dedup stay there.
  const context = compacted
    ? [{ type: 'compaction', status: 'completed', id: input.turn_id || input.session_id }]
    : [];
  const blocks = [];
  let handler;
  const dispose = await plugin.setup({
    options,
    session: {
      async get() { return { agent }; },
      async context() { return context; },
      async synthetic({ text }) { blocks.push(text); },
      async hook(name, callback) {
        if (name !== 'prompt') throw new Error(`Unsupported original hook: ${name}`);
        handler = callback;
        return { dispose() { handler = undefined; } };
      },
    },
  });
  try {
    // No user text is passed to or rewritten by the original fallback.
    await handler({ sessionID: input.session_id, prompt: { text: '' } });
    const additionalContext = blocks.join('\n\n');
    return additionalContext ? {
      hookSpecificOutput: { hookEventName: nativeEvent, additionalContext },
    } : {};
  } finally {
    await dispose();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const options = process.argv[2] ? { configPath: resolve(process.argv[2]) } : {};
    process.stdout.write(JSON.stringify(await runNativeHook(input, options)) + '\n');
  } catch (error) {
    console.error(`[context-inject] ${error.message}`);
    process.exitCode = 1;
  }
}
