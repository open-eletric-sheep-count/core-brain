// core-brain MCP server — stdio transport, zero runtime dependencies
import { serveStdio } from "./jsonrpc.js";
import { createEngine } from "../store.ts";

const engine = createEngine();
const ADMIN = "core-brain-admin"; // fixed identity; unlisted => default policy
const DEBUG = process.env.CORE_BRAIN_DEBUG === "1";

/**
 * Build an Error carrying a numeric .code so the jsonrpc catch can use it.
 * @param {number} code
 * @param {string} message
 * @returns {Error & { code: number }}
 */
function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// ---------------------------------------------------------------------------
// TOOL DEFINITIONS
// ---------------------------------------------------------------------------

const ACTIONS = new Set(["purge", "reindex", "export", "import", "compact"]);

const TOOLS = [
  {
    name: "core_recall",
    description:
      "Recall memories from the global namespace. " +
      "global namespace only — this is not an agent view; per-agent recall goes through the `core_memory` tool.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer" },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "core_status",
    description:
      "Per-namespace counts (records/retired/retrievals), storage root, config path, embedder and dim — counts and metadata only, never memory text.",
    inputSchema: {
      type: "object",
      properties: {
        ns: { type: "string" },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "core_doctor",
    description:
      "Runs the store's health checks and reports each with an id, ok flag and detail.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "core_receipt",
    description:
      "Counted report of what memory stored and retrieved — counters only.",
    inputSchema: {
      type: "object",
      properties: {
        ns: { type: "string" },
        days: { type: "integer" },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "core_admin",
    description:
      "Maintenance dispatcher; purge is destructive and refuses a private agent namespace unless force: true is passed.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["purge", "reindex", "export", "import", "compact"],
        },
        args: { type: "object" },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// TOOL DISPATCH
// ---------------------------------------------------------------------------

/**
 * Validate args, build the engine request, invoke the engine, and wrap the
 * result (or an engine error) in an MCP content envelope.
 *
 * Type-validation failures throw fail(-32602, ...) which propagate up to the
 * JSON-RPC layer.  Engine invoke() errors are caught here and returned as
 * an isError response so the caller still gets a structured answer.
 *
 * @param {string} name
 * @param {object} [args]
 * @returns {{ content: Array<{ type: string; text: string }>, isError?: boolean }}
 */
function callTool(name, args = {}) {
  const t0 = Date.now();

  // -- validate and build the request (throws on bad input) -----------------
  let request;
  switch (name) {
    case "core_recall": {
      if (args.from !== undefined) {
        throw fail(
          -32602,
          "core_recall does not accept a 'from' argument: it reads the global namespace only."
        );
      }
      if (args.query !== undefined && typeof args.query !== "string") {
        throw fail(-32602, "core_recall: 'query' must be a string");
      }
      if (
        args.limit !== undefined &&
        (typeof args.limit !== "number" || !Number.isInteger(args.limit) || args.limit <= 0)
      ) {
        throw fail(-32602, "core_recall: 'limit' must be an integer > 0");
      }
      request = { op: "recall", from: "global" };
      if (args.query !== undefined) request.query = args.query;
      if (args.limit !== undefined) request.limit = args.limit;
      break;
    }

    case "core_status": {
      if (args.ns !== undefined && typeof args.ns !== "string") {
        throw fail(-32602, "core_status: 'ns' must be a string");
      }
      request = { op: "status" };
      if (args.ns !== undefined) request.ns = args.ns;
      break;
    }

    case "core_doctor": {
      request = { op: "doctor" };
      break;
    }

    case "core_receipt": {
      if (args.ns !== undefined && typeof args.ns !== "string") {
        throw fail(-32602, "core_receipt: 'ns' must be a string");
      }
      if (
        args.days !== undefined &&
        (typeof args.days !== "number" || !Number.isInteger(args.days) || args.days <= 0)
      ) {
        throw fail(-32602, "core_receipt: 'days' must be an integer > 0");
      }
      request = { op: "receipt" };
      if (args.ns !== undefined) request.ns = args.ns;
      if (args.days !== undefined) request.days = args.days;
      break;
    }

    case "core_admin": {
      if (typeof args.action !== "string" || !ACTIONS.has(args.action)) {
        throw fail(
          -32602,
          `core_admin: 'action' must be one of: ${[...ACTIONS].join("|")}`
        );
      }
      request = {
        op: "admin",
        action: args.action,
        args: args.args ?? {},
      };
      break;
    }

    default:
      throw fail(-32602, `Unknown tool: ${name}`);
  }

  // -- invoke the engine ----------------------------------------------------
  let result;
  try {
    result = engine.invoke(ADMIN, request);
  } catch (err) {
    const ms = Date.now() - t0;
    if (DEBUG) console.error(`[core-brain mcp] ${name} error ${ms}ms`);
    return {
      content: [{ type: "text", text: `ERROR: ${err.message ?? err}` }],
      isError: true,
    };
  }

  const ms = Date.now() - t0;
  if (DEBUG) console.error(`[core-brain mcp] ${name} ok ${ms}ms`);
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

// ---------------------------------------------------------------------------
// JSON-RPC HANDLER
// ---------------------------------------------------------------------------

/**
 * @param {string} method
 * @param {object} [params]
 * @returns {object}
 */
function handle(method, params = {}) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: params?.protocolVersion,
        serverInfo: { name: "core-brain", version: "0.1.0" },
        capabilities: { tools: {} },
      };

    case "tools/list":
      return { tools: TOOLS };

    case "tools/call":
      return callTool(params?.name, params?.arguments);

    case "ping":
      return {};

    default:
      throw fail(-32601, `Method not found: ${method}`);
  }
}

// ---------------------------------------------------------------------------

serveStdio(handle);
