import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runNativeHook } from '../global/codex/adapters/context-inject/codex-hook.mjs';

async function scenario(run) {
  const root = mkdtempSync(join(tmpdir(), 'oesc file context '));
  const shared = join(root, 'shared rules.md');
  const oracle = join(root, 'ORACLE.md');
  const child = join(root, 'child.md');
  const configPath = join(root, 'config.json');
  writeFileSync(shared, 'Regras compartilhadas.\n');
  writeFileSync(oracle, 'Conteúdo do ORACLE — ação, precisão.\n');
  writeFileSync(child, 'Instruções do explorer.\n');
  writeFileSync(configPath, JSON.stringify({ log_path: join(root, 'log.txt'), injections: { agents: {
    ALL: { 'session.created': [shared], 'session.compacted': [shared] },
    codex: { 'session.created': [shared, oracle], 'session.compacted': [oracle, shared] },
    explorer: { 'session.created': [child] },
  } } }));
  const invoke = event => runNativeHook({ session_id: 'test-session', hook_event_name: 'SessionStart', ...event }, { configPath });
  try { await run({ root, shared, oracle, configPath, invoke }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test('new root session injects ALL before codex, deduplicates paths and preserves user text', () => scenario(async ({ invoke }) => {
  const event = { source: 'startup', prompt: 'Meu pedido permanece exatamente assim.' };
  const output = await invoke(event);
  assert.deepEqual(output, { hookSpecificOutput: { hookEventName: 'SessionStart',
    additionalContext: 'Regras compartilhadas.\n\nConteúdo do ORACLE — ação, precisão.' } });
  assert.equal(event.prompt, 'Meu pedido permanece exatamente assim.');
}));

test('native compaction reinjects complete files after a changed ORACLE, without stale process state', () => scenario(async ({ oracle, invoke }) => {
  await invoke({ source: 'startup' });
  const full = 'ORACLE atualizado\n' + 'Regra completa com acentuação.\n'.repeat(4000) + 'FIM DO ARQUIVO\n';
  writeFileSync(oracle, full);
  const result = await invoke({ source: 'compact', turn_id: 'next-turn' });
  assert.equal(result.hookSpecificOutput.additionalContext, 'Regras compartilhadas.\n\n' + full.trimEnd());
}));

test('resume/fork/ordinary prompts do not replay creation files; clear starts fresh', () => scenario(async ({ invoke }) => {
  for (const source of ['resume', 'fork', undefined, 'unsupported']) assert.deepEqual(await invoke({ source }), {});
  assert.deepEqual(await invoke({ source: 'startup', hook_event_name: 'UserPromptSubmit' }), {});
  assert.ok((await invoke({ source: 'clear' })).hookSpecificOutput.additionalContext.includes('ORACLE'));
}));

test('subagent selection uses its native agent_type and never assumes the parent ORACLE role', () => scenario(async ({ invoke }) => {
  const output = await invoke({ hook_event_name: 'SubagentStart', agent_type: 'explorer' });
  assert.deepEqual(output, { hookSpecificOutput: { hookEventName: 'SubagentStart',
    additionalContext: 'Regras compartilhadas.\n\nInstruções do explorer.' } });
  const unknown = await invoke({ hook_event_name: 'SubagentStart', agent_type: 'unknown' });
  assert.equal(unknown.hookSpecificOutput.additionalContext, 'Regras compartilhadas.');
}));

test('missing and empty files keep original non-blocking behavior and diagnostics', () => scenario(async ({ root, configPath, invoke }) => {
  const missing = join(root, 'absent.md');
  const empty = join(root, 'empty.md');
  writeFileSync(empty, '  \n');
  writeFileSync(configPath, JSON.stringify({ log_path: join(root, 'log.txt'), injections: { agents: {
    codex: { 'session.created': [missing, empty] },
  } } }));
  assert.deepEqual(await invoke({ source: 'startup' }), {});
  assert.match(readFileSync(join(root, 'log.txt'), 'utf8'), /Could not load file/);
}));

test('the original file-injection engine is copied byte for byte', () => {
  assert.deepEqual(readFileSync(new URL('../global/codex/adapters/context-inject/index.ts', import.meta.url)),
    readFileSync(new URL('../global/opencode/plugins/context-inject/index.ts', import.meta.url)));
});
