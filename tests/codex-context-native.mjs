// Real Windows Codex discovery and installed commands; no model calls.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

assert.equal(process.platform, 'win32');
const required = name => { assert.ok(process.env[name], `Set ${name}`); return process.env[name]; };
const distro = required('OESC_WSL_DISTRO');
const user = required('OESC_WSL_USER');
const linuxNode = required('OESC_WSL_NODE');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const linuxPath = value => value.replace(/^([a-z]):[\\/]/i, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll('\\', '/');
const root = mkdtempSync(join(tmpdir(), 'oesc native file context '));
assert.equal(dirname(root), resolve(tmpdir()));
const home = join(root, 'codex');
const workspace = join(root, 'workspace');
mkdirSync(workspace);
mkdirSync(join(home, 'roles'), { recursive: true });
const oracle = 'ORACLE integration fixture\n' + 'Complete native file context.\n'.repeat(3000) + 'LAST RULE';
writeFileSync(join(home, 'roles/ORACLE.md'), oracle);
const binary = process.env.OESC_CODEX_EXE || join(process.env.APPDATA,
  'npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
let child;
let sequence = 0;
const pending = new Map();
const watchdog = setTimeout(() => child?.kill(), 60000);
function request(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); },
      reject: error => { clearTimeout(timer); reject(error); } });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
try {
  const install = spawnSync('wsl.exe', ['-d', distro, '-u', user, '--exec', 'python3',
    linuxPath(join(repository, 'scripts/install_global.py')), '--host', 'codex', '--context-inject-only',
    '--target', linuxPath(home), '--node', linuxNode, '--wsl-distro', distro, '--wsl-user', user],
    { encoding: 'utf8', timeout: 20000, windowsHide: true });
  assert.equal(install.status, 0, install.stdout + install.stderr);
  child = spawn(binary, ['app-server', '--stdio'], { cwd: workspace,
    env: { ...process.env, CODEX_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  child.stderr.resume();
  child.on('error', error => { for (const call of pending.values()) call.reject(error); pending.clear(); });
  child.on('exit', code => { for (const call of pending.values()) call.reject(new Error(`Codex exited: ${code}`)); pending.clear(); });
  createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line);
    if (pending.has(message.id)) {
      const call = pending.get(message.id); pending.delete(message.id);
      if (message.error) call.reject(new Error(JSON.stringify(message.error)));
      else call.resolve(message.result);
    }
  });
  await request('initialize', { clientInfo: { name: 'oesc-context-proof', version: '1' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const hooks = await request('hooks/list', { cwds: [workspace] });
  const entries = hooks.data.flatMap(entry => entry.hooks).filter(entry => entry.command?.includes('context-inject'));
  assert.equal(entries.length, 2, JSON.stringify(hooks));
  const handler = entries.find(entry => entry.eventName === 'sessionStart');
  assert.ok(handler, JSON.stringify(entries));
  for (const source of ['startup', 'compact']) {
    const run = spawnSync(handler.command, { input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'native-context', source }),
      shell: true, encoding: 'utf8', timeout: 15000, windowsHide: true });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.equal(JSON.parse(run.stdout).hookSpecificOutput.additionalContext, oracle);
  }
  const suiteInstall = spawnSync('wsl.exe', ['-d', distro, '-u', user, '--exec', 'python3',
    linuxPath(join(repository, 'scripts/install_global.py')), '--host', 'codex',
    '--target', linuxPath(home), '--skills-dir', linuxPath(join(workspace, '.agents/skills')),
    '--memory-home', linuxPath(join(root, 'memory')), '--node', linuxNode,
    '--wsl-distro', distro, '--wsl-user', user],
    { encoding: 'utf8', timeout: 20000, windowsHide: true });
  assert.equal(suiteInstall.status, 0, suiteInstall.stdout + suiteInstall.stderr);
  const skills = await request('skills/list', { cwds: [workspace], forceReload: true });
  const brainstorm = skills.data.flatMap(entry => entry.skills).find(skill => skill.name === 'a-new-brain-storm');
  assert.ok(brainstorm, JSON.stringify(skills));
  assert.ok(brainstorm.path.replaceAll('\\', '/').includes('/workspace/.agents/skills/a-new-brain-storm/'));
  console.log(JSON.stringify({ passed: true, real_windows_codex_discovery: true,
    installed_hooks: entries.map(entry => ({ event: entry.eventName, enabled: entry.enabled, trusted: entry.trusted })),
    full_file_characters: oracle.length, installed_startup_and_compact_commands_executed: true,
    brainstorm_skill_discovered_from_full_install: true,
    automatic_hook_execution: 'not requested; native trust review preserved', model_calls: 0,
    personal_configuration_changed: false }, null, 2));
} finally {
  clearTimeout(watchdog);
  if (child && child.exitCode === null) {
    const exited = new Promise(done => child.once('exit', done));
    child.stdin.end();
    const stop = setTimeout(() => child.kill(), 3000);
    await exited; clearTimeout(stop);
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
}
