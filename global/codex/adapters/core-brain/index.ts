// index.ts — core-brain, OpenCode V2 plugin server entry (spec §7, §8).
//
// Registers exactly these things:
//   - ONE tool, `core_memory`, which is the only path by which an agent reads
//     or writes memory (who / store / recall — spec §7.2);
//   - THREE session hooks implementing the AUTOMATIC layer (Fatia 2,
//     test/CONTRACT.md §9):
//       * `context`    (A1) — injects the memory block into the model's system
//         context. OPT-IN and OFF by default (`inject: true` in the agent row);
//       * `prompt`     (A2) — learns from the USER prompt text. READ-ONLY: it
//         never mutates `event.prompt`;
//       * `compaction` (A3) — carries the block into the checkpoint transcript
//         and learns from the discarded messages. It NEVER writes `event.result`.
//     A4 (the closing ritual / session end) is UNKNOWN — the closed session-hook
//     list has no session-end member, so no hook is registered for it (plan D5).
//
// Injection NEVER travels through `prompt.text`: it only pushes into the context
// event's `system[]`, guarded by `Array.isArray(event?.system)`. The opt-in gate
// runs BEFORE any recall (plan §2.1 D2), so a non-opted-in agent pays no read
// cost; the `inject` flag is resolved by the engine (`Engine.resolvePolicy`),
// never supplied by the caller.
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
// (tool registration, session-id resolution, the `system.push` guard) and
// `context-inject/index.ts` (prompt hook, agent resolution through the beta
// envelope).

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

type SessionHookName = "prompt" | "context" | "compaction";

interface SessionHookEvent {
  readonly sessionID?: unknown;
  /** Admission prompt (A2) — read to learn, deliberately never mutated. */
  readonly prompt?: unknown;
  /** Injection target (A1/A3) — the ONLY channel; pushed only when an array. */
  readonly system?: unknown;
  /** Discarded transcript (A3) — `{ role, content, parts? }[]`. */
  readonly messages?: unknown;
  /** Host compaction summary (A3) — deliberately never written by us. */
  readonly result?: unknown;
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
      name: SessionHookName,
      callback: (event: SessionHookEvent) => void | Promise<void>,
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

type CoreMemoryOp =
  | "who"
  | "store"
  | "recall"
  | "forget"
  | "feedback"
  | "episode"
  | "timeline"
  | "promote";
const OPS: readonly CoreMemoryOp[] = [
  "who",
  "store",
  "recall",
  "forget",
  "feedback",
  "episode",
  "timeline",
  "promote",
];

const DEBUG_ENV = "CORE_BRAIN_DEBUG";
const HOME_ENV = "CORE_BRAIN_HOME";
const DEFAULT_DATA_DIR_NAME = ".config/core-brain";

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

/** Keeps only the string members of an array field; `undefined` when absent. */
function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings;
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

/** Data root: `options.home` > `CORE_BRAIN_HOME` > `~/.config/core-brain` (spec Q4). */
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
  "that agent is public) with a hybrid BM25 + vector search fused by RRF, and " +
  "report which spaces were scanned and the ranking mode used; the optional " +
  "cross-encoder reranker is OFF by default and is switched on with " +
  "CORE_BRAIN_RERANKER=ms-marco (or by injecting a reranker); forget — retire " +
  "a record without deleting it (by 'id' or " +
  "by 'query'); feedback — record whether a readable record was useful, " +
  "which feeds the ranking tie-break; episode — append one dated episodic " +
  "record (`summary`) to this agent's own space, or to the shared global space " +
  "when it has global access, with the owner taken from the session; timeline — " +
  "read the episodic diary over the same spaces recall may read, " +
  "most-recent-first when no `query` is given and ranked by meaning by the same " +
  "hybrid search when one is; promote — write a new memory derived from a " +
  "readable episode (carrying `derivedFrom`) and list it in the episode's " +
  "`engramIds`. The calling agent's identity is " +
  "taken from the running session — it is NOT an input field and cannot " +
  "be supplied or impersonated.";

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
        "recall — search the spaces this agent may read; forget — retire " +
        "a record without deleting it; feedback — record whether a " +
        "readable record was useful; episode — append one dated episodic " +
        "record (`summary`); timeline — read the episodic diary; promote — " +
        "write a memory derived from a readable episode.",
    },
    id: {
      type: "string",
      description:
        "feedback: the record id (required). forget: optional exact " +
        "record id to retire.",
    },
    useful: {
      type: "boolean",
      description: "feedback: true = useful, false = not useful (required).",
    },
    text: {
      type: "string",
      description:
        "store: the memory text to persist (non-empty). promote: the text of " +
        "the memory derived from the episode (non-empty).",
    },
    target: {
      type: "string",
      description:
        "store: where to write — 'self' (default), 'global' (requires " +
        "global access), or 'agent:<name>' (always refused for another " +
        "agent); forget: which space to retire from — 'self' (default) or " +
        "'global' (requires global access); episode: where to write the " +
        "episode — 'self' (default) or 'global' (requires global access; " +
        "'agent:<name>' is not accepted).",
    },
    meta: {
      type: "object",
      description: "store: optional metadata stored verbatim with the record.",
    },
    query: {
      type: "string",
      description:
        "recall: optional text to rank stored records against (hybrid BM25 " +
        "+ vector search fused by RRF). Omit to list the most recently " +
        "updated records; " +
        "forget: retire every record whose cosine to this text is at/above " +
        "the match threshold (omit when using 'id'); timeline: optional text " +
        "to rank episodes by meaning (same hybrid search; omit for " +
        "most-recent-first).",
    },
    limit: {
      type: "integer",
      description:
        "recall: maximum number of results (default 5). timeline: maximum " +
        "number of episodes.",
    },
    from: {
      type: "string",
      description:
        "recall/timeline: which space to read — 'self', 'global' or " +
        "'agent:<name>'. Omitted = every space this agent is allowed to read.",
    },
    summary: {
      type: "string",
      description: "episode: the narrative — what happened (non-empty).",
    },
    sessionId: {
      type: "string",
      description: "episode: optional session id to record with the episode.",
    },
    episodeId: {
      type: "string",
      description:
        "promote: the id of a readable episode to derive a memory from (required).",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description:
        "episode: optional tags stored with the episode; promote: optional tags " +
        "stored in the memory's metadata; timeline: filter episodes by any of them.",
    },
    since: {
      type: "string",
      description: "timeline: optional ISO timestamp — keep episodes at/after it.",
    },
    until: {
      type: "string",
      description: "timeline: optional ISO timestamp — keep episodes at/before it.",
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

  if (op === "forget") {
    const id =
      typeof record.id === "string" && record.id.trim()
        ? record.id.trim()
        : undefined;
    const q =
      typeof record.query === "string" && record.query.trim()
        ? record.query.trim()
        : undefined;
    if (!id && !q) {
      return { ok: false, error: "forget requires 'id' or 'query'." };
    }
    const t =
      typeof record.target === "string" && record.target.trim()
        ? record.target.trim()
        : undefined;
    if (t !== undefined && t !== "self" && t !== "global") {
      return { ok: false, error: "forget 'target' must be 'self' or 'global'." };
    }
    return {
      ok: true,
      request: {
        op: "forget",
        ...(id ? { id } : {}),
        ...(q ? { query: q } : {}),
        ...(t ? { target: t as "self" | "global" } : {}),
      },
    };
  }

  if (op === "feedback") {
    const id =
      typeof record.id === "string" && record.id.trim()
        ? record.id.trim()
        : undefined;
    if (!id) {
      return {
        ok: false,
        error: "feedback requires a non-empty string 'id'.",
      };
    }
    if (typeof record.useful !== "boolean") {
      return { ok: false, error: "feedback requires a boolean 'useful'." };
    }
    return { ok: true, request: { op: "feedback", id, useful: record.useful } };
  }

  if (op === "episode") {
    const summary = record.summary;
    if (typeof summary !== "string" || summary.trim() === "") {
      return { ok: false, error: "episode requires a non-empty string 'summary'." };
    }
    const tags = asStringArray(record.tags);
    const sessionId =
      typeof record.sessionId === "string" && record.sessionId.trim()
        ? record.sessionId.trim()
        : undefined;
    const t =
      typeof record.target === "string" && record.target.trim()
        ? record.target.trim()
        : undefined;
    if (t !== undefined && t !== "self" && t !== "global") {
      return { ok: false, error: "episode 'target' must be 'self' or 'global'." };
    }
    return {
      ok: true,
      request: {
        op: "episode",
        summary,
        ...(tags !== undefined ? { tags } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(t ? { target: t as "self" | "global" } : {}),
      },
    };
  }

  if (op === "timeline") {
    const tlQuery =
      typeof record.query === "string" && record.query.trim() !== ""
        ? record.query
        : undefined;
    const tlLimit =
      typeof record.limit === "number" &&
      Number.isInteger(record.limit) &&
      record.limit > 0
        ? record.limit
        : undefined;
    const tlFrom =
      typeof record.from === "string" && record.from.trim()
        ? (record.from.trim() as NamespaceTarget)
        : undefined;
    const since =
      typeof record.since === "string" && record.since.trim()
        ? record.since.trim()
        : undefined;
    const until =
      typeof record.until === "string" && record.until.trim()
        ? record.until.trim()
        : undefined;
    const tags = asStringArray(record.tags);
    return {
      ok: true,
      request: {
        op: "timeline",
        ...(tlQuery !== undefined ? { query: tlQuery } : {}),
        ...(since ? { since } : {}),
        ...(until ? { until } : {}),
        ...(tags !== undefined && tags.length > 0 ? { tags } : {}),
        ...(tlLimit !== undefined ? { limit: tlLimit } : {}),
        ...(tlFrom ? { from: tlFrom } : {}),
      },
    };
  }

  if (op === "promote") {
    const episodeId =
      typeof record.episodeId === "string" && record.episodeId.trim()
        ? record.episodeId.trim()
        : undefined;
    if (!episodeId) {
      return { ok: false, error: "promote requires a non-empty string 'episodeId'." };
    }
    const text = record.text;
    if (typeof text !== "string" || text.trim() === "") {
      return { ok: false, error: "promote requires a non-empty string 'text'." };
    }
    const tags = asStringArray(record.tags);
    return {
      ok: true,
      request: {
        op: "promote",
        episodeId,
        text,
        ...(tags !== undefined ? { tags } : {}),
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
// Automatic layer (Fatia 2, test/CONTRACT.md §9): pure, I/O-free helpers.
// Kept in this module (the ORACLE's brief names `index.ts` as the only allowed
// file); they take/return plain values so the logic stays testable.
// ---------------------------------------------------------------------------

/**
 * Stable marker carried by every injected block (plan §2.1 D4): it makes the
 * injected text auditable and dedupes a carry when the live system context
 * already holds the block.
 */
const INJECT_MARKER = "core-brain:auto:v1";

/** Cues that mark a statement as durable (plan §3.2 / D3: no junk memory). */
const DURABLE_CUE =
  /\b(always|never|prefer|remember|convention|standard|rule|decided)\b/i;

/**
 * Extracts the durable statements from a USER prompt / a discarded message.
 * Read-only (it never mutates its input) and empty on ordinary chatter
 * (plan §7.1). The statement is kept whole so one prompt stores one record;
 * the dedupe key is `text + origin` (plan D7).
 */
function extractLearnings(userText: string): string[] {
  const text = userText.trim();
  if (text.length === 0) return [];
  if (!DURABLE_CUE.test(text)) return [];
  return [text];
}

/** The recalled record texts, read defensively from a recall result. */
function recalledTexts(result: unknown): string[] {
  const results = (result as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const texts: string[] = [];
  for (const hit of results) {
    const text = (hit as { text?: unknown } | null)?.text;
    if (typeof text === "string" && text.trim()) texts.push(text);
  }
  return texts;
}

/** Reads a message's text from `content` (string) and/or `parts[].text`. */
function messageTexts(messages: unknown): string[] {
  if (!Array.isArray(messages)) return [];
  const texts: string[] = [];
  for (const message of messages) {
    const record = asRecord(message);
    if (!record) continue;
    const content = record.content;
    if (typeof content === "string" && content.trim()) texts.push(content);
    const parts = record.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        const text = (part as { text?: unknown } | null)?.text;
        if (typeof text === "string" && text.trim()) texts.push(text);
      }
    }
  }
  return texts;
}

/** Composes the injected block: the stable marker plus the recalled records. */
function composeContextBlock(texts: string[], agentName: string): string {
  const header = `[${INJECT_MARKER}] automatic memory context for ${agentName}:`;
  if (texts.length === 0) return header;
  return `${header}\n${texts.map((text) => `- ${text}`).join("\n")}`;
}

/** true when a system part list already carries the injected block marker. */
function systemHasMarker(system: unknown): boolean {
  if (!Array.isArray(system)) return false;
  return system.some((part) => {
    const text = (part as { text?: unknown } | null)?.text;
    return typeof text === "string" && text.includes(INJECT_MARKER);
  });
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
        return { content: JSON.stringify(await engine.invoke(agentName, parsed.request)) };
      } catch (error) {
        const message =
          error instanceof InvalidConfigurationError
            ? `${error.name} (${error.code}): ${error.message}`
            : describeError(error);
        return { content: `ERROR: ${message}` };
      }
    }

    const registrations: Registration[] = [];

    try {
      const transform = ctx.tool?.transform;
      if (typeof transform === "function") {
        registrations.push(
          await transform.call(ctx.tool, (editor) => {
            editor.add({
              name: "core_memory",
              description: TOOL_DESCRIPTION,
              input: TOOL_SCHEMA,
              execute,
            });
          }),
        );
      } else {
        console.error(
          `${LOG_TAG} ctx.tool.transform is unavailable; core_memory was not registered.`,
        );
      }
    } catch (error) {
      console.error(`${LOG_TAG} tool registration failed:`, error);
    }

    // -------------------------------------------------------------------
    // Automatic layer (Fatia 2, test/CONTRACT.md §9): A1/A2/A3.
    // `inject` is resolved by the engine (never by the caller) and the gate
    // runs BEFORE any recall; every hook degrades instead of throwing.
    // -------------------------------------------------------------------

    const isOptedIn = (agentName: string): boolean => {
      if (!engine) return false;
      try {
        return engine.resolvePolicy(agentName).inject === true;
      } catch {
        return false;
      }
    };

    /** Recalls texts, or `null` when the read itself failed. */
    const recallTexts = async (
      agentName: string,
      limit: number,
      from?: "self",
    ): Promise<string[] | null> => {
      if (!engine) return null;
      try {
        const result =
          from === "self"
            ? await engine.invoke(agentName, { op: "recall", limit, from })
            : await engine.invoke(agentName, { op: "recall", limit });
        return recalledTexts(result);
      } catch (error) {
        debugLog(`recall failed for agent=${agentName}: ${describeError(error)}`);
        return null;
      }
    };

    /**
     * Pushes the block into the context event's `system[]` — the ONLY injection
     * channel. No-op when `system` is absent, not an array, or already carries
     * the block (marker dedupe). `prompt.text` is never involved.
     */
    const injectBlock = (event: SessionHookEvent, block: string): boolean => {
      const system = event?.system;
      if (!Array.isArray(system) || systemHasMarker(system)) return false;
      system.push({ type: "text", text: block });
      return true;
    };

    /**
     * Persists one durable learning, deduped on `text + origin` (plan D7): the
     * same statement twice yields exactly one record. Rollback is
     * `core_memory forget id=<id>` (the op already exists).
     */
    const storeLearning = async (
      agentName: string,
      text: string,
      origin: "prompt" | "compaction",
    ): Promise<void> => {
      if (!engine) return;
      const existing = await recallTexts(agentName, 100, "self");
      if (existing !== null && existing.includes(text)) return;
      const stored = await engine.invoke(agentName, {
        op: "store",
        text,
        meta: { origin, dedupeKey: `${text}\n${origin}` },
      });
      const id = (stored as { id?: unknown } | null)?.id;
      debugLog(
        `learn: stored id=${typeof id === "string" ? id : "?"} origin=${origin} ` +
          `agent=${agentName} chars=${text.length}`,
      );
    };

    /** A1 — `context`: automatic injection (read side), opt-in gated. */
    const onContext = async (event: SessionHookEvent): Promise<void> => {
      try {
        const sessionID = event?.sessionID;
        if (typeof sessionID !== "string" || !sessionID) return;
        const agentName = await resolveSessionAgent(ctx, sessionID);
        if (!agentName) return;
        if (!isOptedIn(agentName)) return; // gate BEFORE the recall
        const texts = await recallTexts(agentName, 5);
        if (texts === null) return;
        const block = composeContextBlock(texts, agentName);
        if (injectBlock(event, block)) {
          debugLog(
            `inject: session=${sessionID} agent=${agentName} chars=${block.length}`,
          );
        }
      } catch (error) {
        console.error(`${LOG_TAG} context hook failed:`, error);
      }
    };

    /** A2 — `prompt`: automatic learning (write side), READ-ONLY over the event. */
    const onPrompt = async (event: SessionHookEvent): Promise<void> => {
      try {
        const sessionID = event?.sessionID;
        if (typeof sessionID !== "string" || !sessionID) return;
        // Fallback for tool calls whose second argument carries no id.
        activeSessionID = sessionID;
        const prompt = asRecord(event?.prompt);
        const text = typeof prompt?.text === "string" ? prompt.text : null;
        if (!engine) return;
        const agentName = await resolveSessionAgent(ctx, sessionID);
        if (!agentName || !isOptedIn(agentName)) return;
        if (text === null) return;
        for (const learning of extractLearnings(text)) {
          await storeLearning(agentName, learning, "prompt");
        }
      } catch (error) {
        // The hook must never break prompt admission.
        console.error(`${LOG_TAG} prompt hook failed:`, error);
      }
    };

    /** A3 — `compaction`: carry the block + learn from the discarded messages. */
    const onCompaction = async (event: SessionHookEvent): Promise<void> => {
      try {
        const sessionID = event?.sessionID;
        if (typeof sessionID !== "string" || !sessionID) return;
        const agentName = await resolveSessionAgent(ctx, sessionID);
        if (!agentName) return;
        if (!isOptedIn(agentName)) return;
        const texts = await recallTexts(agentName, 5);
        if (texts !== null) {
          const block = composeContextBlock(texts, agentName);
          if (injectBlock(event, block)) {
            debugLog(
              `compaction hook: carried agent=${agentName} chars=${block.length}`,
            );
          }
        }
        const discarded = new Set(messageTexts(event?.messages));
        for (const messageText of discarded) {
          for (const learning of extractLearnings(messageText)) {
            await storeLearning(agentName, learning, "compaction");
          }
        }
        // `event.result` is NEVER written: the host keeps its summary.
      } catch (error) {
        console.error(`${LOG_TAG} compaction hook failed:`, error);
      }
    };

    // The three hooks share one defensive envelope: `typeof hook === "function"`
    // inside `try/catch`, each `Registration` disposed by the returned disposer.
    const hookHandlers: Array<{
      name: SessionHookName;
      handler: (event: SessionHookEvent) => Promise<void>;
    }> = [
      { name: "context", handler: onContext },
      { name: "prompt", handler: onPrompt },
      { name: "compaction", handler: onCompaction },
    ];
    const hook = ctx.session?.hook;
    if (typeof hook === "function") {
      for (const entry of hookHandlers) {
        try {
          registrations.push(
            await hook.call(ctx.session, entry.name, entry.handler),
          );
        } catch (error) {
          console.error(
            `${LOG_TAG} ${entry.name} hook registration failed:`,
            error,
          );
        }
      }
    } else {
      console.error(
        `${LOG_TAG} ctx.session.hook is unavailable; the automatic-layer hooks were not registered.`,
      );
    }

    return () => {
      for (const registration of registrations) {
        void Promise.resolve(registration.dispose?.()).catch(() => {});
      }
    };
  },
};
