// Contract regression tests; no embedding process or personal memory store.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runNativeHook } from '../global/codex/adapters/core-brain/codex-hook.mjs';

const root = mkdtempSync(join(tmpdir(), 'codex-compaction-contract-'));
const previousMemoryHome = process.env.CORE_BRAIN_HOME;
process.env.CORE_BRAIN_HOME = root;
const transcript = join(root, 'rollout.jsonl');
const session = 'compaction-contract';
const message = (id, role, ...texts) => ({ type: 'message', id, role,
  content: texts.map(text => ({ type: role === 'assistant' ? 'output_text' : 'input_text', text })) });
const row = (type, payload) => ({ type, payload });
const meta = row('session_meta', { id: session });
const raw = item => row('response_item', item);
const checkpoint = items => row('compacted', { message: '', window_id: randomUUID(), replacement_history: items });
const save = rows => writeFileSync(transcript, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
const calls = [];
const host = { hooks: new Map([
  ['context', async event => { calls.push(['context', event]); }],
  ['prompt', async event => { calls.push(['prompt', event]); }],
  ['compaction', async event => {
    calls.push(['compaction', structuredClone(event)]);
    if (!event.system.some(part => part.text.includes('core-brain:auto:v1'))) {
      event.system.push({ type: 'text', text: '[core-brain:auto:v1] original pre-learning recall' });
    }
  }],
]) };
const event = { hook_event_name: 'SessionStart', source: 'compact',
  session_id: session, transcript_path: transcript };
const checks = [];
async function check(name, action) {
  calls.length = 0;
  // Each fixture replaces its synthetic transcript; delivery state belongs to
  // that fixture. Restart/repeat scenarios keep state within their own check.
  rmSync(join(root, 'codex-native-compaction', session + '.json'), { force: true });
  await action(); checks.push(name); console.log('PASS ' + name);
}
try {
  const retained = message('user1', 'user', 'keep the current request');
  const assistant = message('assistant1', 'assistant', 'ALWAYS keep the whole assistant message\n' + 'body '.repeat(400), 'remember this separate part');
  const old = message('old', 'assistant', 'never harvest an already compacted original again');
  const previous = message('summary', 'user', 'previous native summary');
  const summary = message('summary2', 'user', 'host owns this summary');
  save([meta, raw(old), checkpoint([previous]), raw(retained), raw(assistant), checkpoint([retained, summary])]);
  const bytesBefore = JSON.stringify(event);
  await check('native compact continuation calls original compaction with only discarded active messages', async () => {
    const result = await runNativeHook(event, host);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'compaction');
    assert.deepEqual(calls[0][1].messages, [
      { role: 'user', parts: [{ text: previous.content[0].text }] },
      { role: 'assistant', parts: assistant.content.map(part => ({ text: part.text })) },
    ]);
    assert.equal(result.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(result.hookSpecificOutput.additionalContext, /original pre-learning recall/);
    assert.equal(JSON.stringify(event), bytesBefore);
  });
  await check('retained context marker suppresses another block without suppressing learning', async () => {
    const existing = message('dev', 'developer', '[core-brain:auto:v1] existing real context');
    save([meta, raw(existing), raw(assistant), checkpoint([existing, summary])]);
    const result = await runNativeHook(event, host);
    assert.equal(calls[0][0], 'compaction');
    assert.equal(calls[0][1].messages.length, 1);
    assert.deepEqual(result, {});
  });
  await check('successive checkpoints use the immediately preceding active context', async () => {
    const second = message('assistant2', 'assistant', 'never lose the second window');
    save([meta, raw(old), checkpoint([retained, summary]), raw(second), checkpoint([retained, summary])]);
    await runNativeHook(event, host);
    assert.deepEqual(calls[0][1].messages, [{ role: 'assistant', parts: [{ text: second.content[0].text }] }]);
  });
  await check('resume never learns from an old checkpoint', async () => {
    await runNativeHook({ ...event, source: 'resume' }, host);
    assert.equal(calls[0][0], 'context');
  });
  await check('prompt in the compact continuation exposes the already injected current-turn context to original dedupe', async () => {
    const currentContext = message('hook-context', 'developer', '[core-brain:auto:v1] already carried by original compaction');
    currentContext.internal_chat_message_metadata_passthrough = { turn_id: 'current-turn', content_item_kinds: ['hooks.additional_context'] };
    save([meta, raw(assistant), checkpoint([summary]), raw(currentContext)]);
    const output = await runNativeHook({ ...event, hook_event_name: 'UserPromptSubmit', turn_id: 'current-turn', prompt: 'Olá' }, host);
    assert.equal(calls[0][0], 'prompt');
    assert.equal(calls[1][0], 'context');
    assert.deepEqual(calls[1][1].system, [{ type: 'text', text: currentContext.content[0].text }]);
    assert.deepEqual(output, {});
  });
  await check('resume context inserted after the checkpoint is visible to the original compaction marker check', async () => {
    const resumed = message('resume-context', 'developer', '[core-brain:auto:v1] already inserted by SessionStart resume');
    save([meta, raw(assistant), checkpoint([summary]), raw(resumed)]);
    const output = await runNativeHook(event, host);
    assert.equal(calls[0][0], 'compaction');
    assert.deepEqual(calls[0][1].messages[0].parts, assistant.content.map(part => ({ text: part.text })));
    assert.deepEqual(output, {});
  });
  await check('identical retained messages are compared by content, not rewritten item ids', async () => {
    save([meta, raw(assistant), checkpoint([{ ...assistant, id: 'new-id' }, summary])]);
    await runNativeHook(event, host);
    assert.deepEqual(calls[0][1].messages, []);
  });
  await check('partially retained text does not replace the discarded original with an excerpt', async () => {
    save([meta, raw(assistant), checkpoint([message('assistant1', 'assistant', 'excerpt'), summary])]);
    await runNativeHook(event, host);
    assert.deepEqual(calls[0][1].messages[0].parts, assistant.content.map(part => ({ text: part.text })));
  });
  await check('another session cannot be used as discarded messages', async () => {
    save([row('session_meta', { id: 'other-session' }), raw(assistant), checkpoint([summary])]);
    await assert.rejects(runNativeHook(event, host), /session/i);
    assert.equal(calls.length, 0);
  });
  await check('missing replacement history does not silently harvest the entire transcript', async () => {
    save([meta, raw(assistant), row('compacted', { message: 'legacy summary' })]);
    await assert.rejects(runNativeHook(event, host), /replacement_history/i);
    assert.equal(calls.length, 0);
  });
  await check('a truncated final JSONL line cannot hide an already complete checkpoint', async () => {
    save([meta, raw(assistant), checkpoint([summary])]);
    const { appendFileSync } = await import('node:fs');
    appendFileSync(transcript, '{"timestamp":');
    await runNativeHook(event, host);
    assert.equal(calls[0][0], 'compaction');
  });
  if (process.env.WSL_DISTRO_NAME && dirname(fileURLToPath(import.meta.url)).startsWith('/mnt/')) {
    await check('resumed Windows Codex extended paths are translated for the WSL command hook', async () => {
      const mountedRoot = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), '.compaction-path-proof-'));
      try {
        const mountedTranscript = join(mountedRoot, 'rollout.jsonl');
        writeFileSync(mountedTranscript, [meta, raw(assistant), checkpoint([summary])].map(row => JSON.stringify(row)).join('\n') + '\n');
        const windowsPath = mountedTranscript.replace(/^\/mnt\/([a-z])\//, (_, drive) => drive.toUpperCase() + ':\\').replaceAll('/', '\\');
        await runNativeHook({ ...event, transcript_path: '\\\\?\\' + windowsPath }, host);
        assert.equal(calls[0][0], 'compaction');
        assert.deepEqual(calls[0][1].messages[0].parts, assistant.content.map(part => ({ text: part.text })));
      } finally { rmSync(mountedRoot, { recursive: true, force: true }); }
    });
  }
  await check('restart after compact but before continuation does not lose the pending native checkpoint', async () => {
    const restartSession = 'restart-after-compact';
    const restartedEvent = { ...event, session_id: restartSession };
    const restartMeta = row('session_meta', { id: restartSession });
    save([restartMeta, raw(assistant)]);
    await runNativeHook({ ...restartedEvent, source: 'startup' }, host);
    calls.length = 0;
    const secondPending = message('pending2', 'assistant', 'never lose a second checkpoint pending before restart');
    save([restartMeta, raw(assistant), checkpoint([summary]), raw(secondPending), checkpoint([summary])]);
    await runNativeHook({ ...restartedEvent, source: 'resume' }, host);
    assert.equal(calls[0][0], 'compaction');
    assert.deepEqual(calls[0][1].messages[0].parts, assistant.content.map(part => ({ text: part.text })));
    assert.equal(calls.filter(call => call[0] === 'compaction').length, 2);
    assert.deepEqual(calls[1][1].messages[0].parts, [{ text: secondPending.content[0].text }]);
    calls.length = 0;
    await runNativeHook({ ...restartedEvent, source: 'resume' }, host);
    assert.deepEqual(calls.map(call => call[0]), ['context'], 'a completed checkpoint is not harvested again on resume');
  });
  console.log(JSON.stringify({ passed: checks.length, global_memory_modified: false }));
} finally {
  if (previousMemoryHome === undefined) delete process.env.CORE_BRAIN_HOME;
  else process.env.CORE_BRAIN_HOME = previousMemoryHome;
  rmSync(root, { recursive: true, force: true });
}
