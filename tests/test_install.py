"""Installer scenarios. All destinations and memory stores are disposable."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / 'scripts/install_global.py'


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='oesc install ')
        self.root = Path(self.temp.name)
        self.target = self.root / 'host files'
        self.memory = self.root / 'memory'
        self.skills = self.root / 'skills'

    def tearDown(self):
        self.temp.cleanup()

    def run_install(self, host='codex', *extra, success=True):
        args = [sys.executable, str(INSTALLER), '--host', host, '--target', str(self.target),
                '--memory-home', str(self.memory), '--skills-dir', str(self.skills), *extra]
        env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}
        result = subprocess.run(args, text=True, capture_output=True, env=env, timeout=30)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def test_dry_run_both_hosts_writes_nothing(self):
        for host in ('opencode', 'codex'):
            self.run_install(host, '--dry-run', '--install-runtime')
            self.assertEqual(list(self.root.iterdir()), [])

    def test_opencode_suite_and_policy_merge_preserve_existing_memory(self):
        self.memory.mkdir()
        policy = {'agents': [{'name': 'existing', 'private': True, 'hasGlobalAccess': False}], 'custom': 42}
        (self.memory / 'config.json').write_text(json.dumps(policy))
        (self.memory / 'memories.json').write_bytes(b'existing memory bytes')
        self.run_install('opencode')
        self.assertTrue((self.target / 'plugins/context-inject/index.ts').is_file())
        self.assertTrue((self.target / 'agent/ORACLE.md').is_file())
        actual = json.loads((self.memory / 'config.json').read_text())
        self.assertEqual(actual['agents'][0], policy['agents'][0])
        self.assertEqual(actual['custom'], 42)
        self.assertTrue(next(row for row in actual['agents'] if row['name'] == 'ORACLE')['inject'])
        self.assertEqual((self.memory / 'memories.json').read_bytes(), b'existing memory bytes')

    def test_codex_merges_config_hooks_and_existing_identity(self):
        self.target.mkdir()
        original = '# keep this comment\nmodel = "example-model"\n[mcp_servers.other]\ncommand = "other-command"\n'
        original += '[mcp_servers."core-brain"]\ncommand = "old"\n[mcp_servers."core-brain".env]\nOLD = "old"\n'
        (self.target / 'config.toml').write_text(original)
        unrelated = {'type': 'command', 'command': 'echo unrelated'}
        old = {'type': 'command', 'command': 'old', 'statusMessage': 'core-brain: original OpenCode automatic layer'}
        (self.target / 'hooks.json').write_text(json.dumps({'custom': 4, 'hooks': {
            'SessionStart': [{'hooks': [unrelated, old]}],
            'Stop': [{'hooks': [unrelated]}]}}))
        self.memory.mkdir()
        (self.memory / 'config.json').write_text(json.dumps({'agents': [
            {'name': 'codex', 'private': True, 'hasGlobalAccess': False}, {'name': 'other'}]}))
        self.run_install()
        config = tomllib.loads((self.target / 'config.toml').read_text())
        self.assertEqual(config['model'], 'example-model')
        self.assertEqual(config['mcp_servers']['other']['command'], 'other-command')
        self.assertIn('# keep this comment', (self.target / 'config.toml').read_text())
        hooks = json.loads((self.target / 'hooks.json').read_text())
        self.assertEqual(hooks['custom'], 4)
        self.assertEqual(hooks['hooks']['Stop'], [{'hooks': [unrelated]}])
        session = [h for group in hooks['hooks']['SessionStart'] for h in group['hooks']]
        self.assertIn(unrelated, session)
        self.assertEqual(sum(h.get('statusMessage', '').startswith('core-brain:') for h in session), 1)
        identity = json.loads((self.memory / 'config.json').read_text())['agents'][0]
        self.assertEqual(identity, {'name': 'codex', 'private': True, 'hasGlobalAccess': False, 'inject': True})
        self.assertEqual(len(list(self.skills.glob('*/SKILL.md'))), 3)
        self.assertTrue(list(self.target.rglob('*.oesc-backup-*')))

    def test_reinstall_is_idempotent(self):
        self.run_install()
        before = {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.run_install()
        after = {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(after, before)

    def test_invalid_existing_configuration_never_partially_installs(self):
        self.target.mkdir()
        for name, content in [('hooks.json', '{invalid'), ('config.toml', '[invalid')]:
            with self.subTest(name=name):
                path = self.target / name
                path.write_text(content)
                self.run_install(success=False)
                self.assertEqual(list(self.target.iterdir()), [path])
                self.assertFalse(self.memory.exists())
                path.unlink()

    def test_disabled_hooks_are_reported_before_writing(self):
        self.target.mkdir()
        (self.target / 'config.toml').write_text('[features]\nhooks = false\n')
        self.run_install(success=False)
        self.assertFalse((self.target / 'adapters').exists())

    def test_installed_mcp_runs_from_paths_with_spaces(self):
        self.run_install()
        server = tomllib.loads((self.target / 'config.toml').read_text())['mcp_servers']['core-brain']
        messages = [
            {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2024-11-05'}},
            {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'},
            {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': 'core_memory', 'arguments': {'op': 'who'}}},
        ]
        run = subprocess.run([server['command'], *server['args']],
                             input=''.join(json.dumps(m) + '\n' for m in messages),
                             text=True, capture_output=True, timeout=20)
        self.assertEqual(run.returncode, 0, run.stderr)
        replies = {r['id']: r for r in map(json.loads, run.stdout.splitlines())}
        self.assertEqual(replies[2]['result']['tools'][0]['name'], 'core_memory')
        self.assertFalse(replies[3]['result'].get('isError'), replies[3])
        self.assertIn('codex', replies[3]['result']['content'][0]['text'])

    @unittest.skipUnless(os.environ.get('OESC_TEST_RUNTIME') and os.environ.get('OESC_TEST_MODELS'),
                         'Set OESC_TEST_RUNTIME and OESC_TEST_MODELS for the real cached model integration')
    def test_hook_and_mcp_share_explicit_memory_environment(self):
        self.run_install('codex', '--runtime-dir', os.environ['OESC_TEST_RUNTIME'],
                         '--models-dir', os.environ['OESC_TEST_MODELS'])
        hooks = json.loads((self.target / 'hooks.json').read_text())
        command = hooks['hooks']['UserPromptSubmit'][0]['hooks'][0]['command']
        event = {'hook_event_name': 'UserPromptSubmit', 'session_id': 'isolated-test',
                 'prompt': 'Always preserve this complete installation test message.'}
        run = subprocess.run(shlex.split(command), input=json.dumps(event), text=True,
                             capture_output=True, timeout=20,
                             env={**os.environ, 'CORE_BRAIN_OFFLINE': '1', 'CORE_BRAIN_EMBEDDER': 'real'})
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn('core-brain:auto:v1', run.stdout)
        records = json.loads((self.memory / 'agents/codex/memories.json').read_text())
        self.assertEqual(records[0]['text'], event['prompt'])

    def test_original_engine_files_are_copied_unchanged(self):
        self.run_install()
        original = ROOT / 'global/opencode/plugins/core-brain'
        adapter = self.target / 'adapters/core-brain'
        for name in ['index.ts', 'store.ts', 'types.ts', *['engine/' + p.name for p in (original / 'engine').glob('*.ts')]]:
            self.assertEqual((original / name).read_bytes(), (adapter / name).read_bytes(), name)

    def test_windows_wsl_registration_uses_linux_paths_and_explicit_env(self):
        self.run_install('codex', '--wsl-distro', 'Ubuntu', '--wsl-user', 'test-user')
        server = tomllib.loads((self.target / 'config.toml').read_text())['mcp_servers']['core-brain']
        self.assertEqual(server['command'], 'C:/Windows/System32/wsl.exe')
        self.assertEqual(server['args'][:6], ['-d', 'Ubuntu', '-u', 'test-user', '--exec', 'env'])
        self.assertIn('CORE_BRAIN_HOME=' + str(self.memory), server['args'])
        self.assertTrue(any(str(self.target) in arg for arg in server['args']))

    def test_legacy_installer_defaults_to_opencode_and_accepts_source_destination(self):
        source = self.root / 'source'
        (source / 'plugins').mkdir(parents=True)
        (source / 'custom.txt').write_text('custom overlay')
        result = subprocess.run(['bash', str(ROOT / 'global/opencode/install-global.sh'),
                                 '-s', str(source), '-d', str(self.target),
                                 '--memory-home', str(self.memory)], text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((self.target / 'custom.txt').read_text(), 'custom overlay')


if __name__ == '__main__':
    unittest.main(verbosity=2)
