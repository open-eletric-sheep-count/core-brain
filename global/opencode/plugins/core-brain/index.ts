// index.ts — core-brain, OpenCode V2 plugin server entry (spec §7, §8).
//
// Registers exactly two things:
//   - ONE tool, `core_memory`, which is the only path by which an agent reads
//     or writes memory (who / store / recall — spec §7.2);
//   - ONE inert `prompt` hook that only OBSERVES (it records the active agent
//     for debug logging). It never mutates `event.prompt.text` and never
//     pushes into `event.system`: context injection is OPT-IN and OFF by
//     default (spec §8). There is NO `compaction` hook in v1.
//
// Identity (spec §7.1): the agent name is NEVER a tool input field. It is read
// from the trusted session (`ctx.session.get({ sessionID })`, using the same
// defensive envelope handling as context-inject's `resolveSessionAgent`) and
// handed to the engine as trusted identity. The tool's JSON schema has no
// identity field and sets `additionalProperties: false`, so a caller cannot
// even send one.
//
// Module shape (deliberate, same rationale as todo-list/context-inject): the
// default export is a PLAIN OBJECT `{ id, setup }` and NO runtime package is
// imported — the V2 loader validates only the module shape, and a runtime
// import could resolve up to a stale V1 package and fail every load. The ctx
// surface actually used is declared structurally below, and every failure is
// contained so a broken setup can never break an existing agent's session.
//
// Sources: https://opencode.ai/v2/docs/build/plugins — tool transform
// (`ctx.tool.transform`) and the session hooks (`ctx.session.hook`,
// `ctx.session.get`); mirrored from this repo's `todo-list/index.ts`
// (tool registration, session-id resolution) and `context-inject/index.ts`
// (prompt hook, agent resolution through the beta envelope).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { InvalidConfigurationError, createEngine } from "./store.ts";
import type { CoreMemoryRequest, Engine, NamespaceTarget } from "./types.ts";

// ---------------------------------------------------------------------------
// Structural slice of the V2 plugin context actually used.
// ---------------------------------------------------------------------------

interface Registration {
  dispose(): void | Promise<void>;
}

interface ToolInfoLike {
  name: string;
  description: string;
  input: Record<string, unknown>;
  execute(input: unknown, tool?: unknown): Promise<{ content: string }>;
}

interface ToolEditorLike {
  add(tool: ToolInfoLike): void;
}

interface PromptHookEvent {
  readonly sessionID?: unknown;
  // Present on the event, deliberately never touched by this plugin (§8).
  readonly prompt?: unknown;
  readonly system?: unknown;
}

interface CoreBrainPluginContext {
  location?: {
    directory?: string | null;
    project?: { directory?: string | null } | null;
  };
  /** Plugin options from the object form in opencode.json(c) (ctx.options). */
  options?: Record<string, unknown>;
  tool?: {
    transform(
      callback: (editor: ToolEditorLike) => void,
    ): Promise<Registration>;
  };
  session?: {
    hook(
      name: "prompt",
      callback: (event: PromptHookEvent) => void | Promise<void>,
    ): Promise<Registration>;
    // "Read a session" (V2 plugin docs). The result shape is handled
    // defensively: the beta envelope may nest the payload under `data`.
    get?(input: { sessionID: string }): Promise<unknown>;
  };
}

// ---------------------------------------------------------------------------
// Shared vocabulary.
// ---------------------------------------------------------------------------

const LOG_TAG = "[core-brain]";

type CoreMemoryOp = "who" | "store" | "recall";
const OPS: readonly CoreMemoryOp[] = ["who", "store", "recall"];

const DEBUG_ENV = "CORE_BRAIN_DEBUG";
const HOME_ENV = "CORE_BRAIN_HOME";
const DEFAULT_DATA_DIR_NAME = ".core-brain";

// ---------------------------------------------------------------------------
// Session id resolution (mirrors todo-list): the tool's second argument shape
// is not documented, so resolve it defensively — direct field, then common
// nested carriers, then the last session seen by the prompt hook (which fires
// before tool execution within the same round).
// ---------------------------------------------------------------------------

let activeSessionID: string | null = null;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function resolveSessionID(toolArg: unknown): string | null {
  const top = asRecord(toolArg);
  if (top) {
    for (const key of ["sessionID", "sessionId"]) {
      const direct = top[key];
      if (typeof direct === "string" && direct) return direct;
    }
    for (const carrier of [
      "context",
      "ctx",
      "data",
      "call",
      "toolCall",
      "info",
      "session",
    ]) {
      const nested = asRecord(top[carrier]);
      if (!nested) continue;
      for (const key of ["sessionID", "sessionId"]) {
        const value = nested[key];
        if (typeof value === "string" && value) return value;
      }
    }
  }
  return activeSessionID;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Resolves a session's agent through `ctx.session.get` ("read a session").
 * Defensive about the beta response envelope; any failure returns null so the
 * caller degrades to a clear ERROR and never breaks the session (spec §7.1).
 */
async function resolveSessionAgent(
  ctx: CoreBrainPluginContext,
  sessionID: string,
): Promise<string | null> {
  const get = ctx.session?.get;
  if (typeof get !== "function") return null;
  const pick = (value: unknown): string | null => {
    if (!value || typeof value !== "object") return null;
    const agent = (value as { agent?: unknown }).agent;
    return typeof agent === "string" && agent ? agent : null;
  };
  try {
    const result = await get.call(ctx.session, { sessionID });
    return pick(result) ?? pick((result as { data?: unknown } | null)?.data);
  } catch (error) {
    console.error(
      `${LOG_TAG} session-get failed for session ${sessionID}: ${describeError(error)}`,
    );
    return null;
  }
}

/** Data root: `options.home` > `CORE_BRAIN_HOME` > `~/.core-brain` (spec Q4). */
function resolveDataRoot(ctx: CoreBrainPluginContext): string {
  const option = ctx.options?.home;
  if (typeof option === "string" && option.trim()) {
    const value = option.trim();
    return value.startsWith("~") ? path.join(os.homedir(), value.slice(1)) : value;
  }
  const envHome = process.env[HOME_ENV];
  if (typeof envHome === "string" && envHome) return envHome;
  return path.join(os.homedir(), DEFAULT_DATA_DIR_NAME);
}

/** `options.configPath` (absolute or `~`) wins; the engine has its own chain. */
function resolveOptionConfigPath(
  ctx: CoreBrainPluginContext,
): string | undefined {
  const option = ctx.options?.configPath;
  if (typeof option !== "string" || !option.trim()) return undefined;
  const value = option.trim();
  return value.startsWith("~") ? path.join(os.homedir(), value.slice(1)) : value;
}

// ---------------------------------------------------------------------------
// The single tool: `core_memory` (spec §7.2).
// ---------------------------------------------------------------------------

const TOOL_DESCRIPTION =
  "Read and write this agent's memory (per-agent isolated namespaces plus an " +
  "optional shared global space). Ops: who — report the calling agent's " +
  "configured policy (private, hasGlobalAccess, dataDir); store — persist " +
  "`text` into `target` ('self' by default, 'global' only when this agent has " +
  "global access; writing into another agent's space is always refused); " +
  "recall — search the spaces this agent may read (its own space always, the " +
  "global space when it has global access, another agent's space only while " +
  "that agent is public) ranked by cosine similarity, and report which spaces " +
  "were scanned. The calling agent's identity is taken from the running " +
  "session — it is NOT an input field and cannot be supplied or impersonated.";

const TOOL_SCHEMA: Record<string, unknown> = {
  type: "object",
  // Deliberately NO identity field (spec §7.1): the calling agent is resolved
  // from the session, never supplied by the caller. `additionalProperties:
  // false` makes that a schema-level guarantee, not just a convention.
  properties: {
    op: {
      type: "string",
      enum: [...OPS],
      description:
        "who — report this agent's policy; store — persist `text`; " +
        "recall — search the spaces this agent may read.",
    },
    text: {
      type: "string",
      description: "store: the memory text to persist (non-empty).",
    },
    target: {
      type: "string",
      description:
        "store: where to write — 'self' (default), 'global' (requires " +
        "global access), or 'agent:<name>' (always refused for another agent).",
    },
    meta: {
      type: "object",
      description: "store: optional metadata stored verbatim with the record.",
    },
    query: {
      type: "string",
      description:
        "recall: optional text to rank stored records against (cosine " +
        "similarity). Omit to list the most recently updated records.",
    },
    limit: {
      type: "integer",
      description: "recall: maximum number of results (default 5).",
    },
    from: {
      type: "string",
      description:
        "recall: which space to read — 'self', 'global' or 'agent:<name>'. " +
        "Omitted = every space this agent is allowed to read.",
    },
  },
  required: ["op"],
  additionalProperties: false,
};

type RequestParse =
  | { ok: true; request: CoreMemoryRequest }
  | { ok: false; error: string };

/**
 * Validates the tool input and maps it to an engine request. Only the §7.2
 * fields survive; anything else (notably any identity-looking field) is
 * dropped, never forwarded.
 */
function buildRequest(input: unknown): RequestParse {
  const record = asRecord(input);
  if (!record) {
    return { ok: false, error: "core_memory expects an object with an 'op' field." };
  }
  const op = record.op;
  if (typeof op !== "string" || !OPS.includes(op as CoreMemoryOp)) {
    return {
      ok: false,
      error: `unknown op ${JSON.stringify(record.op)}; expected one of: ${OPS.join(", ")}.`,
    };
  }
  if (op === "who") return { ok: true, request: { op: "who" } };

  if (op === "store") {
    const text = record.text;
    if (typeof text !== "string" || text.trim() === "") {
      return { ok: false, error: "store requires a non-empty string 'text'." };
    }
    const target =
      typeof record.target === "string" && record.target.trim()
        ? (record.target.trim() as NamespaceTarget)
        : undefined;
    const meta = asRecord(record.meta) ?? undefined;
    return {
      ok: true,
      request: {
        op: "store",
        text,
        ...(target ? { target } : {}),
        ...(meta ? { meta } : {}),
      },
    };
  }

  const query =
    typeof record.query === "string" && record.query.trim() !== ""
      ? record.query
      : undefined;
  const limit =
    typeof record.limit === "number" &&
    Number.isInteger(record.limit) &&
    record.limit > 0
      ? record.limit
      : undefined;
  const from =
    typeof record.from === "string" && record.from.trim()
      ? (record.from.trim() as NamespaceTarget)
      : undefined;
  return {
    ok: true,
    request: {
      op: "recall",
      ...(query !== undefined ? { query } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(from ? { from } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin definition.
// ---------------------------------------------------------------------------

export default {
  id: "core-brain",
  async setup(ctx: CoreBrainPluginContext) {
    const debugRaw = process.env[DEBUG_ENV];
    const debugEnabled =
      typeof debugRaw === "string" &&
      debugRaw !== "" &&
      debugRaw !== "0" &&
      debugRaw.toLowerCase() !== "false";
    const dataRoot = resolveDataRoot(ctx);

    const debugLog = (message: string): void => {
      if (!debugEnabled) return;
      try {
        fs.mkdirSync(dataRoot, { recursive: true });
        fs.appendFileSync(
          path.join(dataRoot, "debug.log"),
          `[${new Date().toISOString()}] ${LOG_TAG} ${message}\n`,
        );
      } catch {
        // Logging is advisory — it must never break a tool call or a prompt.
      }
    };

    // Config is loaded + validated HERE, at init, before any read/write (§6.4).
    // The failure is CAPTURED instead of thrown: a plugin setup failure must
    // never break the host session of an existing agent — every core_memory
    // call then answers with the same clear ERROR naming the rule (§6.4/§8).
    let engine: Engine | null = null;
    let engineError: string | null = null;
    try {
      engine = createEngine({
        home: dataRoot,
        configPath: resolveOptionConfigPath(ctx),
      });
    } catch (error) {
      engineError =
        error instanceof InvalidConfigurationError
          ? `${error.name} (${error.code}): ${error.message}`
          : describeError(error);
      console.error(`${LOG_TAG} engine init failed: ${engineError}`);
    }

    async function execute(
      input: unknown,
      toolArg?: unknown,
    ): Promise<{ content: string }> {
      const sessionID = resolveSessionID(toolArg);
      if (!sessionID) {
        return {
          content:
            "ERROR: core_memory could not determine this session's id; " +
            "nothing was read or written.",
        };
      }
      const parsed = buildRequest(input);
      if (!parsed.ok) return { content: `ERROR: ${parsed.error}` };
      if (!engine) {
        return {
          content:
            `ERROR: core-brain is not configured: ` +
            `${engineError ?? "engine unavailable"}`,
        };
      }
      const agentName = await resolveSessionAgent(ctx, sessionID);
      debugLog(
        `core_memory op=${parsed.request.op} sessionID=${sessionID} ` +
          `agent=${agentName ?? "<unresolved>"}`,
      );
      if (!agentName) {
        return {
          content:
            "ERROR: core-brain could not resolve the running agent for this " +
            "session; nothing was read or written.",
        };
      }
      try {
        return { content: JSON.stringify(engine.invoke(agentName, parsed.request)) };
      } catch (error) {
        const message =
          error instanceof InvalidConfigurationError
            ? `${error.name} (${error.code}): ${error.message}`
            : describeError(error);
        return { content: `ERROR: ${message}` };
      }
    }

    let toolRegistration: Registration | undefined;
    try {
      const transform = ctx.tool?.transform;
      if (typeof transform === "function") {
        toolRegistration = await transform.call(ctx.tool, (editor) => {
          editor.add({
            name: "core_memory",
            description: TOOL_DESCRIPTION,
            input: TOOL_SCHEMA,
            execute,
          });
        });
      } else {
        console.error(
          `${LOG_TAG} ctx.tool.transform is unavailable; core_memory was not registered.`,
        );
      }
    } catch (error) {
      console.error(`${LOG_TAG} tool registration failed:`, error);
    }

    // INERT prompt hook (spec §8): it records the active session/agent for
    // debug logging only. `event.prompt.text` is NEVER edited and
    // `event.system` is NEVER touched — v1 has no injection path at all.
    let hookRegistration: Registration | undefined;
    try {
      const hook = ctx.session?.hook;
      if (typeof hook === "function") {
        hookRegistration = await hook.call(
          ctx.session,
          "prompt",
          async (event) => {
            const sessionID = event?.sessionID;
            if (typeof sessionID !== "string" || !sessionID) return;
            // Fallback for tool calls whose second argument carries no id.
            activeSessionID = sessionID;
            if (!debugEnabled) return;
            try {
              const agentName = await resolveSessionAgent(ctx, sessionID);
              debugLog(
                `prompt hook: sessionID=${sessionID} ` +
                  `agent=${agentName ?? "<unresolved>"}`,
              );
            } catch (error) {
              // The hook must never break prompt admission.
              console.error(`${LOG_TAG} prompt hook failed:`, error);
            }
          },
        );
      } else {
        console.error(
          `${LOG_TAG} ctx.session.hook is unavailable; the prompt hook was not registered.`,
        );
      }
    } catch (error) {
      console.error(`${LOG_TAG} prompt hook registration failed:`, error);
    }

    return () => {
      void Promise.resolve(toolRegistration?.dispose?.()).catch(() => {});
      void Promise.resolve(hookRegistration?.dispose?.()).catch(() => {});
    };
  },
};
