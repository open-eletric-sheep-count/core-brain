// Installation transport only: give MCP and hooks the same explicit environment.
// Preserve argv so each unchanged original entry point runs its own main block.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const entries = { mcp: 'codex-mcp.mjs', hook: 'codex-hook.mjs' };
const entry = entries[process.argv[2]];
if (!entry) throw new Error('Usage: node launch.mjs mcp|hook');
const config = JSON.parse(readFileSync(new URL('./runtime-config.json', import.meta.url), 'utf8'));
Object.assign(process.env, config.env);
process.argv = [process.execPath, fileURLToPath(new URL(entry, import.meta.url)), ...process.argv.slice(3)];
await import(pathToFileURL(process.argv[1]).href);
