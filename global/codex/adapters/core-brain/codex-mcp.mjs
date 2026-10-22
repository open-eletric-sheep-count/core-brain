// Native MCP wrapper around the original core-brain engine.
// Identity is fixed by the host; tool arguments cannot select another agent.
import { serveStdio } from './mcp/jsonrpc.js';
import { createEngine } from './store.ts';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const identity = 'codex';
const properties = {
  op: { type: 'string', enum: ['who', 'store', 'recall', 'forget', 'feedback', 'episode', 'timeline', 'promote'] },
  text: { type: 'string' }, query: { type: 'string' }, id: { type: 'string' },
  useful: { type: 'boolean' }, target: { type: 'string', enum: ['self', 'global'] },
  from: { type: 'string', enum: ['self', 'global'] }, meta: { type: 'object' },
  limit: { type: 'integer', minimum: 1, maximum: 100 }, summary: { type: 'string' },
  sessionId: { type: 'string' }, episodeId: { type: 'string' },
  tags: { type: 'array', items: { type: 'string' } },
  since: { type: 'string' }, until: { type: 'string' },
};
const tool = {
  name: 'core_memory',
  description: 'Core-brain durable memory. All Codex roles use fixed identity codex. '
    + 'No per-role isolation or access to other agents is provided. '
    + 'Automatic prompt learning and recall require separately installed and trusted Codex hooks. '
    + 'Global is this local core-brain store, not an organization sharing policy.',
  inputSchema: { type: 'object', properties, required: ['op'], additionalProperties: false },
};

function validate(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('arguments must be an object');
  for (const [name, value] of Object.entries(args)) {
    const spec = properties[name];
    if (!spec) throw Error(`Unknown argument: ${name}`);
    if (spec.type === 'integer' ? !Number.isInteger(value)
      : spec.type === 'array' ? !Array.isArray(value)
      : spec.type === 'object' ? !value || typeof value !== 'object' || Array.isArray(value)
      : typeof value !== spec.type) throw Error(`Invalid ${name}`);
    if (spec.enum && !spec.enum.includes(value)) throw Error(`Invalid ${name}`);
    if (name === 'limit' && (value < 1 || value > 100)) throw Error('limit must be 1..100');
    if (name === 'tags' && value.some(tag => typeof tag !== 'string')) throw Error('tags must contain strings');
  }
  if (!properties.op.enum.includes(args.op)) throw Error('Unsupported op');
}

export function createHandler(factory = createEngine) {
let engine;
return async (method, params = {}) => {
  if (method === 'initialize') return {
    protocolVersion: params.protocolVersion || '2024-11-05', capabilities: { tools: {} },
    serverInfo: { name: 'core-brain-codex', version: '1.0.0' },
    instructions: 'Use core_memory only for task-relevant durable knowledge. '
      + 'Identity is fixed to codex; only the parent writes through this tool. '
      + 'Automatic hooks, when installed and trusted, run the original OpenCode plugin.',
  };
  if (method === 'ping') return {};
  if (method === 'tools/list') return { tools: [tool] };
  if (method === 'tools/call') {
    if (params.name !== tool.name) throw Object.assign(Error('Unknown tool'), { code: -32602 });
    try {
      const args = params.arguments ?? {};
      validate(args);
      engine ??= factory();
      const result = await engine.invoke(identity, args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: String(error.message ?? error) }] };
    }
  }
  throw Object.assign(Error(`Unknown method: ${method}`), { code: -32601 });
};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  serveStdio(createHandler());
}
