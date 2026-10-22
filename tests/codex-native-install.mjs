// Actual Windows Codex app-server + WSL installed MCP, using a disposable home.
// No model calls, personal memory writes, credential copies or hook trust bypass.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

assert.equal(process.platform, 'win32', 'This native integration test requires Windows and WSL');
const required = name => { assert.ok(process.env[name], `Set ${name}`); return process.env[name]; };
const distro = required('OESC_WSL_DISTRO');
const user = required('OESC_WSL_USER');
const runtime = required('OESC_TEST_RUNTIME');
const models = required('OESC_TEST_MODELS');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const linuxPath = value => value.replace(/^([a-z]):[\\/]/i, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll('\\', '/');
const root = mkdtempSync(join(tmpdir(), 'oesc codex native '));
assert.equal(dirname(root), resolve(tmpdir()), 'Cleanup must stay inside the temporary directory');
const home = join(root, 'codex');
const workspace = join(root, 'workspace');
mkdirSync(workspace);
const binary = process.env.OESC_CODEX_EXE || join(process.env.APPDATA,
  'npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
let child;
let sequence = 0;
const pending = new Map();
const errors = [];
const watchdog = setTimeout(() => { child?.kill(); }, 90000);

function request(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 45000);
    pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); },
                      reject: error => { clearTimeout(timer); reject(error); } });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}

try {
  const install = spawnSync('wsl.exe', ['-d', distro, '-u', user, '--exec', 'env',
    'PATH=/usr/local/bin:/usr/bin:/bin',
    'bash', linuxPath(join(repository, 'install.sh')), '--host', 'codex',
    '--target', linuxPath(home), '--skills-dir', linuxPath(join(workspace, '.agents/skills')),
    '--memory-home', linuxPath(join(root, 'memory')), '--runtime-dir', runtime, '--models-dir', models,
    '--node', required('OESC_WSL_NODE'), '--wsl-distro', distro, '--wsl-user', user],
    { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(install.status, 0, install.stdout + install.stderr);
  child = spawn(binary, ['app-server', '--stdio'], { cwd: workspace,
    env: { ...process.env, CODEX_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  child.stderr.on('data', data => errors.push(data.toString()));
  child.on('error', error => { for (const call of pending.values()) call.reject(error); pending.clear(); });
  child.on('exit', code => { for (const call of pending.values()) call.reject(new Error(`Codex exited: ${code}`)); pending.clear(); });
  createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line);
    if (message.id !== undefined && pending.has(message.id)) {
      const call = pending.get(message.id); pending.delete(message.id);
      if (message.error) call.reject(new Error(JSON.stringify(message.error)));
      else call.resolve(message.result);
    }
  });
  await request('initialize', { clientInfo: { name: 'oesc-install-proof', version: '1' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const thread = await request('thread/start', { cwd: workspace });
  const threadId = thread.thread.id;
  const catalog = await request('mcpServerStatus/list', { threadId, serverName: 'core-brain' });
  assert.ok(JSON.stringify(catalog).includes('core_memory'), JSON.stringify(catalog));
  const call = arguments_ => request('mcpServer/tool/call', { threadId, server: 'core-brain', tool: 'core_memory', arguments: arguments_ });
  const who = await call({ op: 'who' });
  assert.ok(!who.isError && JSON.stringify(who).includes('codex'), JSON.stringify(who));
  const hooks = await request('hooks/list', { cwds: [workspace] });
  const hookText = JSON.stringify(hooks);
  assert.ok(hookText.includes('sessionStart') && hookText.includes('userPromptSubmit'), hookText);
  assert.ok(hookText.includes('launch.mjs'), hookText);
  const skills = await request('skills/list', { cwds: [workspace], forceReload: true });
  const installedSkills = skills.data.flatMap(entry => entry.skills)
    .filter(skill => skill.path.replaceAll('\\', '/').includes('/workspace/.agents/skills/'));
  for (const name of ['core-brain-memory', 'core-brain-create-memories', 'core-brain-session-end']) {
    assert.ok(installedSkills.some(skill => skill.name === name), `Missing installed project skill: ${name}`);
  }
  const marker = 'native installed store ' + Date.now();
  const stored = await call({ op: 'store', text: marker });
  assert.ok(!stored.isError, JSON.stringify(stored));
  const recalled = await call({ op: 'recall', query: marker });
  assert.ok(!recalled.isError && JSON.stringify(recalled).includes(marker), JSON.stringify(recalled));
  const prompt = 'always preserve the complete native hook test statement ' + Date.now();
  const handler = hooks.data.flatMap(entry => entry.hooks).find(entry => entry.eventName === 'userPromptSubmit');
  const hookRun = spawnSync(handler.command, {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'native-hook-command-test', prompt }),
    shell: true, encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(hookRun.status, 0, hookRun.stdout + hookRun.stderr);
  assert.ok(hookRun.stdout.includes('core-brain:auto:v1'), hookRun.stdout);
  const learned = await call({ op: 'recall', query: prompt });
  assert.ok(!learned.isError && JSON.stringify(learned).includes(prompt), JSON.stringify(learned));
  console.log(JSON.stringify({ passed: true, actual_codex_process: true, isolated_home: true,
    installed_mcp: 'core_memory', store_recall: true, skill_names: 3,
    hook_definitions_discovered: 2, native_hook_trust_bypassed: false,
    native_hook_execution: 'not requested; new definitions require native review',
    installed_windows_hook_command_tested_directly: true,
    model_calls: 0, personal_configuration_changed: false }, null, 2));
} catch (error) {
  console.error('Native installation verification failed:', error.message);
  console.error(errors.join('').slice(-4000));
  throw error;
} finally {
  clearTimeout(watchdog);
  if (child && child.exitCode === null) {
    const exited = new Promise(done => child.once('exit', done));
    child.stdin.end();
    const stop = setTimeout(() => child.kill(), 5000);
    await exited; clearTimeout(stop);
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
}
