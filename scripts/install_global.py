#!/usr/bin/env python3
"""Install the OpenCode suite or Codex memory and context-injection adapters."""
import argparse
import copy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import tomllib
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
STATUS = 'core-brain: original OpenCode automatic layer'
EVENTS = ('SessionStart', 'UserPromptSubmit')
CONTEXT_STATUS = 'context-inject: OESC file context'


def encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()


def read_object(path):
    value = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    if not isinstance(value, dict):
        raise ValueError(f'Expected a JSON object: {path}')
    return value


def absolute(value):
    # Check links before resolve(), including links in existing parents.
    path = Path(value).expanduser().absolute()
    for parent in (path, *path.parents):
        if parent.is_symlink():
            raise ValueError(f'Symlink destination requires manual installation: {parent}')
    return path.resolve()


def merge_server(text, server):
    """Replace only core-brain tables; verify all other parsed values survive."""
    original = tomllib.loads(text)
    lines = text.splitlines(keepends=True)
    headers = []
    for index, line in enumerate(lines):
        if re.match(r'^\s*\[', line):
            try:
                table = tomllib.loads(line)
            except tomllib.TOMLDecodeError:
                continue
            headers.append((index, table))
    removed = set()
    for position, (index, table) in enumerate(headers):
        if 'core-brain' in table.get('mcp_servers', {}):
            end = headers[position + 1][0] if position + 1 < len(headers) else len(lines)
            removed.update(range(index, end))
    result = ''.join(line for index, line in enumerate(lines) if index not in removed).rstrip()
    result += '\n\n[mcp_servers.core-brain]\n'
    result += f'command = {json.dumps(server["command"])}\nargs = {json.dumps(server["args"])}\n'
    result += 'enabled = true\nstartup_timeout_sec = 30\n'
    parsed = tomllib.loads(result)
    for config in (original, parsed):
        servers = config.get('mcp_servers', {})
        servers.pop('core-brain', None)
        if not servers:
            config.pop('mcp_servers', None)
    if parsed != original:
        raise ValueError('Cannot edit this TOML layout without changing other settings; merge core-brain manually.')
    return result.encode()


def merge_hooks(hooks, command):
    groups = hooks.setdefault('hooks', {})
    if not isinstance(groups, dict):
        raise ValueError('hooks.json: hooks must be an object')
    for event in EVENTS:
        entries = groups.setdefault(event, [])
        if not isinstance(entries, list):
            raise ValueError(f'hooks.json: {event} must be an array')
        preserved = []
        for entry in entries:
            handlers = entry.get('hooks')
            if not isinstance(handlers, list):
                raise ValueError(f'hooks.json: {event} entry needs a hooks array')
            remaining = [handler for handler in handlers if handler.get('statusMessage') != STATUS]
            if remaining:
                preserved.append({**entry, 'hooks': remaining})
        preserved.append({'hooks': [{'type': 'command', 'command': command,
                                    'statusMessage': STATUS, 'additionalContextLimit': 0}]})
        groups[event] = preserved
    return hooks


def merged_policy(path, host, source, agents):
    policy = read_object(path)
    rows = policy.setdefault('agents', [])
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError('Memory policy agents must be an array of objects')
    names = [row.get('name') for row in rows]
    if len(names) != len(set(names)):
        raise ValueError('Memory policy contains duplicate agent identities')
    defaults = source / 'plugins/core-brain/config.json'
    if host == 'opencode' and defaults.is_file():
        for row in read_object(defaults).get('agents', []):
            if row['name'] not in names:
                rows.append(copy.deepcopy(row))
                names.append(row['name'])
    for name in (['codex'] if host == 'codex' else agents or ['ORACLE']):
        existing = next((row for row in rows if row.get('name') == name), None)
        if existing is None:
            rows.append({'name': name, 'private': False, 'hasGlobalAccess': True, 'inject': True})
        else:
            existing['inject'] = True
    return policy


def copy_tree(source, destination, changes):
    if not source.is_dir():
        raise ValueError(f'Source directory not found: {source}')
    for path in sorted(source.rglob('*')):
        relative = path.relative_to(source)
        if any(part in {'.git', 'node_modules', '__pycache__'} for part in relative.parts):
            continue
        if path.is_symlink():
            raise ValueError(f'Source contains a symbolic link: {path}')
        if path.is_file():
            changes[destination / relative] = path.read_bytes()


def node_executable(value):
    node = shutil.which(value)
    if not node:
        raise ValueError(f'Node.js not found: {value}')
    version = subprocess.check_output([node, '--version'], text=True, timeout=10).strip()
    if int(version.lstrip('v').split('.')[0]) < 24:
        raise ValueError(f'Node.js 24 or newer required; found {version}')
    return str(Path(node).resolve())


def plan_context_inject(args, source, target, changes):
    """Install native file hooks independently of MCP and memory configuration."""
    config_path = target / 'config.toml'
    config = tomllib.loads(config_path.read_text(encoding='utf-8')) if config_path.exists() else {}
    features = config.get('features', {})
    if features.get('hooks', features.get('codex_hooks', True)) is False:
        raise ValueError('Codex hooks are disabled; enable them deliberately before installation')
    adapter = target / 'adapters/context-inject'
    existing_config = adapter / 'config.json'
    copy_tree(source / 'adapters/context-inject', adapter, changes)
    # User file lists survive upgrades and can deliberately disable injection.
    if existing_config.exists():
        read_object(existing_config)
        changes[existing_config] = existing_config.read_bytes()
    node = node_executable(args.node)
    command_parts = [node, str(adapter / 'codex-hook.mjs')]
    if args.wsl_distro:
        if os.name == 'nt':
            raise ValueError('Run --wsl-distro installation inside the selected WSL distribution')
        prefix = ['C:/Windows/System32/wsl.exe', '-d', args.wsl_distro]
        if args.wsl_user:
            prefix += ['-u', args.wsl_user]
        command_parts = [*prefix, '--exec', *command_parts]
    command = subprocess.list2cmdline(command_parts) if os.name == 'nt' or args.wsl_distro else shlex.join(command_parts)
    hook_path = target / 'hooks.json'
    hooks = json.loads(changes[hook_path]) if hook_path in changes else read_object(hook_path)
    groups = hooks.setdefault('hooks', {})
    if not isinstance(groups, dict):
        raise ValueError('hooks.json: hooks must be an object')
    for event, matcher in [('SessionStart', '^(startup|clear|compact)$'), ('SubagentStart', None)]:
        entries = groups.setdefault(event, [])
        if not isinstance(entries, list):
            raise ValueError(f'hooks.json: {event} must be an array')
        preserved = []
        for entry in entries:
            handlers = entry.get('hooks')
            if not isinstance(handlers, list):
                raise ValueError(f'hooks.json: {event} entry needs a hooks array')
            remaining = [handler for handler in handlers if handler.get('statusMessage') != CONTEXT_STATUS]
            if remaining:
                preserved.append({**entry, 'hooks': remaining})
        group = {'hooks': [{'type': 'command', 'command': command, 'timeout': 10,
                            'statusMessage': CONTEXT_STATUS, 'additionalContextLimit': 0}]}
        if matcher:
            group['matcher'] = matcher
        groups[event] = [*preserved, group]
    changes[hook_path] = encode(hooks)


def plan(args):
    host = args.host
    target = absolute(args.target or (os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))
                                     if host == 'codex' else Path.home() / '.config/opencode'))
    source = absolute(args.source or ROOT / 'global' / host)
    memory = absolute(args.memory_home)
    skills = absolute(args.skills_dir)
    for destination in (target, memory, skills):
        if destination == Path.home() or destination == Path(destination.anchor) or destination.is_relative_to(ROOT):
            raise ValueError(f'Choose a dedicated destination outside this repository: {destination}')
    changes = {}
    if args.context_inject_only:
        if host != 'codex':
            raise ValueError('--context-inject-only requires --host codex')
    elif host == 'opencode':
        copy_tree(source, target, changes)
        # Current V2 documents agents/; retain the legacy agent/ tree as well.
        if (source / 'agent').is_dir():
            copy_tree(source / 'agent', target / 'agents', changes)
        if args.wsl_distro:
            raise ValueError('--wsl-distro is for a Windows Codex client installed from WSL')
    else:
        node = node_executable(args.node)
        copy_tree(source / 'adapters/core-brain', target / 'adapters/core-brain', changes)
        copy_tree(source / 'skills', skills, changes)
        # Repository rules/*.md are role prompts, not native Codex .rules policy.
        # Keep the established runtime path used by the file injector and ORACLE.
        copy_tree(source / 'rules', target / 'roles', changes)
        copy_tree(source / 'helpers', target / 'helpers', changes)
        environment = {'CORE_BRAIN_HOME': str(memory), 'CORE_BRAIN_RUNTIME_DIR': str(absolute(args.runtime_dir or memory / 'runtime')),
                       'CORE_BRAIN_MODELS_DIR': str(absolute(args.models_dir or memory / 'models'))}
        adapter = target / 'adapters/core-brain'
        changes[adapter / 'runtime-config.json'] = encode({'env': environment})
        launcher = str(adapter / 'launch.mjs')
        base = [node, launcher]
        if args.wsl_distro:
            if os.name == 'nt':
                raise ValueError('Run --wsl-distro installation inside the selected WSL distribution')
            prefix = ['-d', args.wsl_distro]
            if args.wsl_user:
                prefix += ['-u', args.wsl_user]
            prefix += ['--exec', 'env', f'PATH={Path(node).parent}:/usr/local/bin:/usr/bin:/bin',
                       *(f'{key}={value}' for key, value in environment.items())]
            server = {'command': 'C:/Windows/System32/wsl.exe', 'args': [*prefix, *base, 'mcp']}
            command = subprocess.list2cmdline([server['command'], *prefix, *base, 'hook'])
        else:
            server = {'command': node, 'args': [launcher, 'mcp']}
            command_parts = [node, launcher, 'hook']
            command = subprocess.list2cmdline(command_parts) if os.name == 'nt' else shlex.join(command_parts)
        config_path = target / 'config.toml'
        text = config_path.read_text(encoding='utf-8') if config_path.exists() else ''
        config = tomllib.loads(text)
        features = config.get('features', {})
        if features.get('hooks', features.get('codex_hooks', True)) is False:
            raise ValueError('Codex hooks are disabled; enable them deliberately before installation')
        changes[config_path] = merge_server(text, server)
        changes[target / 'hooks.json'] = encode(merge_hooks(read_object(target / 'hooks.json'), command))
    if host == 'codex':
        plan_context_inject(args, source, target, changes)
    if not args.context_inject_only:
        changes[memory / 'config.json'] = encode(merged_policy(memory / 'config.json', host, source, args.agent))
    for path in changes:
        absolute(path)
        if path.exists() and not path.is_file():
            raise ValueError(f'Destination is not a regular file: {path}')
    changed = {path: data for path, data in changes.items() if not path.exists() or path.read_bytes() != data}
    return changed, {'host': host, 'target': str(target),
                     'component': 'context-inject' if args.context_inject_only else 'suite',
                     'memory_home': None if args.context_inject_only else str(memory),
                     'skills_dir': None if args.context_inject_only else str(skills) if host == 'codex' else str(target / 'skills'),
                     'changed_files': len(changed), 'dry_run': args.dry_run,
                     'requires_codex_hook_review': host == 'codex'}


def atomic_write(path, data, mode):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.oesc-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(data)
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def apply(changes):
    before = {path: (path.read_bytes(), path.stat().st_mode & 0o777) if path.exists() else None for path in changes}
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid4().hex[:8]
    written = []
    try:
        for path, data in changes.items():
            old = before[path]
            if old is not None:
                atomic_write(path.with_name(path.name + '.oesc-backup-' + stamp), *old)
            mode = old[1] if old is not None else (0o600 if path.suffix in {'.json', '.toml'} else 0o644)
            atomic_write(path, data, mode)
            written.append(path)
    except Exception:
        for path in reversed(written):
            old = before[path]
            if old is None:
                path.unlink(missing_ok=True)
            else:
                atomic_write(path, *old)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', choices=['opencode', 'codex'], default='opencode')
    parser.add_argument('-s', '--source', help='Override the selected host source tree')
    parser.add_argument('-d', '--target', help='Override the host configuration directory')
    parser.add_argument('--memory-home', default=os.environ.get('CORE_BRAIN_HOME', str(Path.home() / '.config/core-brain')))
    parser.add_argument('--skills-dir', default=str(Path.home() / '.agents/skills'))
    parser.add_argument('--agent', action='append', help='OpenCode automatic-memory identity; repeatable; default ORACLE')
    parser.add_argument('--node', default='node')
    parser.add_argument('--runtime-dir', default=os.environ.get('CORE_BRAIN_RUNTIME_DIR'))
    parser.add_argument('--models-dir', default=os.environ.get('CORE_BRAIN_MODELS_DIR') or os.environ.get('CORE_BRAIN_MODELS'))
    parser.add_argument('--wsl-distro', help='Register a Windows Codex client to execute this WSL installation')
    parser.add_argument('--wsl-user')
    parser.add_argument('--context-inject-only', action='store_true',
                        help='Install only the Codex file injector; preserve MCP, memory and skills')
    parser.add_argument('--install-runtime', action='store_true', help='Also provision the pinned embedding runtime with npm')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    if args.agent and args.host != 'opencode':
        parser.error('Codex has the fixed codex identity; --agent is OpenCode-only')
    if args.wsl_user and not args.wsl_distro:
        parser.error('--wsl-user requires --wsl-distro')
    if args.context_inject_only and args.install_runtime:
        parser.error('--context-inject-only does not use the embedding runtime')
    changes, report = plan(args)
    if args.install_runtime:
        runtime = absolute(args.runtime_dir or Path(report['memory_home']) / 'runtime')
        env = {**os.environ, 'CORE_BRAIN_RUNTIME_DIR': str(runtime)}
        command = ['bash', str(ROOT / 'global/opencode/plugins/core-brain/install-runtime.sh')]
        subprocess.run([*command, '--dry-run'], check=True, env=env)
        if not args.dry_run:
            subprocess.run(command, check=True, env=env)
    if not args.dry_run:
        apply(changes)
    print(json.dumps(report, indent=2))
    if args.host == 'codex':
        print('Restart Codex; review the installed native handlers in /hooks.')
    else:
        print('Restart OpenCode V2; verify plugins with opencode plugin list.')
    if not args.install_runtime and not args.context_inject_only:
        print('Embedding runtime not provisioned by this command. Use --install-runtime or an existing real runtime.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, TypeError, KeyError, AttributeError, subprocess.SubprocessError) as error:
        print(f'Installation failed: {error}', file=sys.stderr)
        raise SystemExit(1)
