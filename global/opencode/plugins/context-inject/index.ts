// context-inject — OpenCode V2 plugin.
//
// Injects configured files into sessions: project rules at the true start of
// a session (its first admitted prompt ever) and a re-injection after
// compaction. Configuration is PER AGENT (config.json:
// injections.agents.<AGENT>."session.created" / "session.compacted") with the
// reserved "ALL" key as the global/any-agent injector.
//
// Module shape (deliberate, same as the other OESC plugins): default export is
// a PLAIN OBJECT { id, setup } with NO runtime import of any plugin package —
// the V2 loader validates only the module shape ("Plugin must export a
// default definition with an id and an effect or setup function"), and a
// runtime import could resolve up to a stale V1 package and fail every load.
// The ctx surface used is declared structurally below.
//
// V2 semantics: ctx.session.hook("prompt") runs once per admitted user prompt,
// with a mutable draft (event.prompt.text). File contents are PREPENDED to
// the prompt text (content first, user text after), instead of being pushed
// as a separate prompt message.
//
// STATELESS SEMANTICS (fix 2026-09-06): every decision is derived from the
// DURABLE session log (ctx.session.context) — never from in-memory
// per-session markers, so behavior survives plugin-instance reloads (service
// restarts, instance re-boots):
//   - "session.created" -> fires ONLY when the session log shows NO user
//     message and NO compaction control (genuine first prompt of a brand-new
//     session). Resumed/continued sessions always show one of the two, so
//     the creation files are never re-injected.
//   - "session.compacted" -> fires ONLY when the log shows a completed
//     compaction (message info { type: "compaction", status: "completed" })
//     with NO user message admitted AFTER it. The prompt hook runs before
//     the in-flight prompt is durably admitted, so the first post-compaction
//     prompt sees exactly that state; once admitted, the condition can never
//     hold again for the same compaction — across restarts too.
// Both checks run on ONE session-log read per prompt; the agent lookup adds
// one session read, and only when an injection decision is actually possible.
//
// Configuration resolution: `options.configPath` (plugin options in
// opencode.json(c)) first, then `<pluginDir>/config.json`. Path entries are
// "/..." as-is, otherwise plugin-dir-relative.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Structural slice of the V2 plugin context actually used (see module-shape
// comment above for why no plugin-package types are imported).
// Sources: https://opencode.ai/v2/docs/build/plugins (Session hooks).
// ---------------------------------------------------------------------------

interface PromptHookEvent {
  readonly sessionID: string;
  readonly messageID?: string;
  prompt: {
    text?: unknown;
    // PromptInput.Prompt carries more fields (files/agents/skills/metadata);
    // this plugin only touches text.
  };
  metadata?: Record<string, unknown>;
}

interface HookRegistration {
  dispose(): void | Promise<void>;
}

interface InjectContextPluginContext {
  location?: {
    directory?: string | null;
    project?: { directory?: string | null } | null;
  };
  /** Plugin options from the object form in opencode.json(c) (ctx.options). */
  options?: Record<string, unknown>;
  session: {
    hook(
      name: "prompt",
      callback: (event: PromptHookEvent) => void | Promise<void>,
    ): Promise<HookRegistration>;
    context(input: { sessionID: string }): Promise<unknown>;
    // "Read a session" (V2 plugin docs: ctx.session.get). Used to resolve the
    // session's agent for per-agent file selection; the result shape is
    // handled defensively (beta envelope).
    get(input: { sessionID: string }): Promise<unknown>;
  };
}

// ---------------------------------------------------------------------------
// Config + logging.
// ---------------------------------------------------------------------------

/** Per-event file lists for one agent key (or for the reserved "ALL" key). */
interface AgentEventFiles {
  "session.created"?: string[];
  "session.compacted"?: string[];
}

interface PluginConfig {
  log_path?: string;
  logging?: { enabled?: boolean };
  injections?: {
    agents?: Record<string, AgentEventFiles>;
  };
}

/** Reserved agent key whose file lists apply to every session. */
const ALL_AGENTS = "ALL";

const LOG_TAG = "[context-inject]";

function resolvePluginDir(ctx: InjectContextPluginContext): string {
  const candidates: string[] = [];
  try {
    candidates.push(path.dirname(fileURLToPath(import.meta.url)));
  } catch {
    // import.meta.url unavailable — skip candidate.
  }
  const locationDir = ctx.location?.directory;
  if (typeof locationDir === "string" && locationDir) {
    // Mirrored layout: <config-dir>/plugins/context-inject.
    candidates.push(path.join(locationDir, "plugins", "context-inject"));
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(path.join(candidate, "config.json"))) {
        return candidate;
      }
    } catch {
      // ignore and try the next candidate
    }
  }
  // Last resort: the first candidate (dir of import.meta.url) even if
  // config.json is missing — loadConfig below logs the failure.
  return candidates[0] ?? process.cwd();
}

const DEFAULT_OUTPUT_PATH = path.join(
  os.homedir(),
  ".local",
  "share",
  "opencode-context-inject",
  "output.txt",
);

/** options.configPath (absolute or ~) wins; else <pluginDir>/config.json. */
function resolveConfigPath(
  pluginDir: string,
  ctx: InjectContextPluginContext,
): string | null {
  const opt = ctx.options?.configPath;
  if (typeof opt === "string" && opt.trim()) {
    const value = opt.trim();
    return value.startsWith("~")
      ? path.join(os.homedir(), value.slice(1))
      : value;
  }
  const local = path.join(pluginDir, "config.json");
  return fs.existsSync(local) ? local : null;
}

function loadConfig(configPath: string | null): PluginConfig {
  if (!configPath) {
    console.error(
      `${LOG_TAG} no config found (options.configPath or <pluginDir>/config.json); nothing will be injected.`,
    );
    return {};
  }
  try {
    const configContent = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(configContent) as PluginConfig;
  } catch (e) {
    console.error(`${LOG_TAG} failed to load config:`, configPath, e);
    return {};
  }
}

/** Absolute path for a config entry: "/..." as-is, otherwise PLUGIN_DIR-relative. */
function resolveEntryPath(pluginDir: string, entry: string): string {
  return path.isAbsolute(entry)
    ? path.normalize(entry)
    : path.join(pluginDir, entry);
}

interface InjectionCandidate {
  /** Entry exactly as configured (used for logging). */
  entry: string;
  /** "global" for ALL files; "agent:<AGENT>" for agent-specific files. */
  origin: string;
}

/**
 * Ordered, deduplicated candidate list for one event: ALL files first, then
 * the session agent's files (exact key match), each part in its own list
 * order. The dedup key is the resolved absolute path; the first occurrence
 * keeps its position. A null/unknown agent contributes no agent files.
 */
function collectEventCandidates(
  agents: Record<string, AgentEventFiles> | undefined,
  event: "session.created" | "session.compacted",
  agent: string | null,
  pluginDir: string,
): InjectionCandidate[] {
  const candidates: InjectionCandidate[] = [];
  const seen = new Set<string>();
  const push = (entries: string[] | undefined, origin: string): void => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (typeof entry !== "string" || !entry) continue;
      const resolved = resolveEntryPath(pluginDir, entry);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      candidates.push({ entry, origin });
    }
  };
  push(agents?.[ALL_AGENTS]?.[event], "global");
  if (agent && agent !== ALL_AGENTS) {
    push(agents?.[agent]?.[event], `agent:${agent}`);
  }
  return candidates;
}

function getTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const milliseconds = String(now.getMilliseconds()).padStart(4, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}.${milliseconds}`;
}

function createLogger(config: PluginConfig) {
  const logEnabled = config.logging?.enabled ?? true;
  const outputPath = config.log_path || DEFAULT_OUTPUT_PATH;
  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  } catch (e) {
    console.error(`${LOG_TAG} failed to create output dir:`, e);
  }
  const print = (message: string) => {
    if (!logEnabled) return;
    try {
      fs.appendFileSync(outputPath, `[${getTimestamp()}] ${message}`);
    } catch {
      // Logging must never break injection.
    }
  };
  const println = (message: string) => print(`${message}\n`);
  return { println };
}

// Cache for loaded files (same Map semantics as the original implementation).
function createFileLoader(pluginDir: string, println: (m: string) => void) {
  const fileCache = new Map<string, string>();
  return (relativePath: string): string | null => {
    const filePath = resolveEntryPath(pluginDir, relativePath);
    if (fileCache.has(filePath)) {
      return fileCache.get(filePath) || null;
    }
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      fileCache.set(filePath, content);
      println(`Loaded file: ${relativePath}`);
      return content;
    } catch (e) {
      println(
        `Warning: Could not load file '${relativePath}': ${JSON.stringify(e)}`,
      );
      fileCache.set(filePath, ""); // Cache empty to avoid repeated reads.
      return null;
    }
  };
}

/**
 * Contents of every candidate file, joined; empty string when none loads.
 * Each successfully injected file logs its entry + origin (per-file evidence
 * for ordering and dedup validation).
 */
function buildInjectionBlock(
  candidates: InjectionCandidate[],
  loadFile: (p: string) => string | null,
  println: (m: string) => void,
  sessionID: string,
): string {
  if (candidates.length === 0) return "";
  const blocks: string[] = [];
  for (const candidate of candidates) {
    const content = loadFile(candidate.entry);
    if (content && content.trim()) {
      blocks.push(content.trimEnd());
      println(
        `Injected ${candidate.entry} (origin: ${candidate.origin}) into session ${sessionID}`,
      );
    }
  }
  return blocks.join("\n\n");
}

/** Prepend `prefix` to the user prompt text; returns the new text. */
function prependToPromptText(
  event: PromptHookEvent,
  prefix: string,
  what: string,
  sessionID: string,
  println: (m: string) => void,
): void {
  if (!prefix) return;
  const base = typeof event.prompt?.text === "string" ? event.prompt.text : "";
  const sep = base.trim() ? "\n\n" : "";
  event.prompt.text = `${prefix}${sep}${base}`;
  println(`${what}: injected into session ${sessionID}`);
}

// ---------------------------------------------------------------------------
// Session-log scan: every injection decision is derived from the DURABLE
// session log returned by ctx.session.context({ sessionID }) — no per-session
// in-memory state, so behavior survives plugin-instance reloads (service
// restarts, instance re-boots) and is identical for any sessionID the hook
// sees. Records are the Session.Message.Info union (schema in
// https://opencode.ai/v2/openapi.json); every variant carries a literal
// "type" discriminator, which is the classification key:
//   - "user"        -> Session.Message.User: a durably admitted user prompt
//     (commands that submit through session.prompt also produce these). This
//     is the ONLY type counted as a "user message".
//   - "compaction"  -> status "running" | "completed" | "failed"; a completed
//     compaction condenses earlier history and its presence proves the
//     session had real conversation before (never true at session creation).
//   - "synthetic" | "system" | "shell" | "skill" | "assistant" and the
//     agent/model/location controls are NOT user activity for these
//     semantics (prompt hooks do not run for synthetic/shell/compaction/move
//     controls; shell/skill records are tool-side, not user prompts).
// Defensive about both possible item shapes (bare info vs { info, parts })
// and a { data: [...] } envelope because the client-facing wrapper is beta.
// Transcript order is chronological (the order the model consumes); "after"
// means a higher array index.
// ---------------------------------------------------------------------------

interface SessionLogScan {
  /** Durable log contains a Session.Message.User record. */
  hasUserMessage: boolean;
  /** Durable log contains any compaction control (any status). */
  hasCompactionControl: boolean;
  /** A completed compaction exists with NO user message after it. */
  pendingCompactionWindow: boolean;
  /** id of the last completed compaction (logging only), if any. */
  lastCompletedCompactionId: string | null;
}

function scanSessionLog(result: unknown): SessionLogScan {
  const items = Array.isArray(result)
    ? result
    : Array.isArray((result as { data?: unknown } | null)?.data)
      ? (result as { data: unknown[] }).data
      : [];
  const infos: Array<{ type?: unknown; status?: unknown; id?: unknown }> = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as { info?: unknown };
    // Accept both the bare message-info record and the { info, parts } wrapper.
    const info = (record.info ?? record) as {
      type?: unknown;
      status?: unknown;
      id?: unknown;
    };
    if (typeof info !== "object" || info === null) continue;
    infos.push(info);
  }
  let hasUserMessage = false;
  let hasCompactionControl = false;
  let lastCompletedCompactionIndex = -1;
  let lastCompletedCompactionId: string | null = null;
  for (let i = 0; i < infos.length; i++) {
    const info = infos[i];
    if (info.type === "user") {
      hasUserMessage = true;
    } else if (info.type === "compaction") {
      hasCompactionControl = true;
      if (info.status === "completed" && typeof info.id === "string") {
        lastCompletedCompactionIndex = i;
        lastCompletedCompactionId = info.id;
      }
    }
  }
  let pendingCompactionWindow = false;
  if (lastCompletedCompactionIndex >= 0) {
    let userMessageAfterCompaction = false;
    for (let j = lastCompletedCompactionIndex + 1; j < infos.length; j++) {
      if (infos[j].type === "user") {
        userMessageAfterCompaction = true;
        break;
      }
    }
    pendingCompactionWindow = !userMessageAfterCompaction;
  }
  return {
    hasUserMessage,
    hasCompactionControl,
    pendingCompactionWindow,
    lastCompletedCompactionId,
  };
}

/**
 * Resolves a session's agent through ctx.session.get ("read a session").
 * Defensive about the beta response envelope; any failure returns null so the
 * caller degrades to the ALL files only and admission is never broken.
 */
async function resolveSessionAgent(
  ctx: InjectContextPluginContext,
  sessionID: string,
  println: (m: string) => void,
): Promise<string | null> {
  const pick = (value: unknown): string | null => {
    if (!value || typeof value !== "object") return null;
    const agent = (value as { agent?: unknown }).agent;
    return typeof agent === "string" && agent ? agent : null;
  };
  try {
    const result = await ctx.session.get({ sessionID });
    return pick(result) ?? pick((result as { data?: unknown } | null)?.data);
  } catch (e) {
    println(
      `session-get failed for session ${sessionID}: ${JSON.stringify(e)}`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Plugin definition.
// ---------------------------------------------------------------------------

export default {
  id: "context-inject",
  async setup(ctx: InjectContextPluginContext) {
    const pluginDir = resolvePluginDir(ctx);
    const config = loadConfig(resolveConfigPath(pluginDir, ctx));
    const { println } = createLogger(config);
    const loadFile = createFileLoader(pluginDir, println);

    const agentsMap = config.injections?.agents;

    const registration = await ctx.session.hook("prompt", async (event) => {
      const sessionID: string | undefined = event?.sessionID;
      if (typeof sessionID !== "string" || !sessionID) return;
      try {
        // Single durable-log read feeds BOTH decisions. Ordering: the prompt
        // hook runs BEFORE durable inbox admission (docs: hooks intercept
        // "before ... durable inbox admission"; the edits "become the
        // canonical persisted user input"), so the in-flight prompt is not in
        // this log yet — exactly what both rules below rely on. No in-memory
        // per-session markers exist anywhere in this plugin.
        let scan: SessionLogScan;
        try {
          const contextResult = await ctx.session.context({ sessionID });
          scan = scanSessionLog(contextResult);
        } catch (e) {
          // Beta contract drift / session gone / read failure: never crash
          // the prompt admission. Without the log no decision is safe, so
          // nothing is injected on this prompt.
          println(
            `session-log scan failed for session ${sessionID}: ${JSON.stringify(e)}`,
          );
          return;
        }

        const injected: string[] = [];

        // --- "session.created" semantic: genuine first prompt of a session.
        // No user message AND no compaction control in the durable log — only
        // a brand-new session satisfies both. A resumed/continued session
        // always shows at least one of the two (normal history, compacted
        // history, or compacted then restarted), so the creation files are
        // never re-injected after restarts.
        const isFirstPrompt =
          !scan.hasUserMessage && !scan.hasCompactionControl;
        // The session's agent is resolved once, only when an injection
        // decision is actually possible (first prompt or open compaction
        // window). Read failures degrade to "unknown" (ALL files only).
        const agent: string | null =
          isFirstPrompt || scan.pendingCompactionWindow
            ? await resolveSessionAgent(ctx, sessionID, println)
            : null;
        if (isFirstPrompt) {
          println(
            `session.created (first prompt): sessionID=${sessionID}, agent=${agent ?? "unknown"}`,
          );
          const block = buildInjectionBlock(
            collectEventCandidates(
              agentsMap,
              "session.created",
              agent,
              pluginDir,
            ),
            loadFile,
            println,
            sessionID,
          );
          if (block) {
            prependToPromptText(
              event,
              block,
              "Injected creation files",
              sessionID,
              println,
            );
            injected.push("session.created");
          }
        }

        // --- "session.compacted" semantic: next admitted prompt after a
        // completed compaction. The window is open while a completed
        // compaction has no user message after it in the transcript; once
        // this prompt is admitted it becomes that user message, so the window
        // closes for good for this compaction — across restarts too, with no
        // serviced-marker memory.
        if (scan.pendingCompactionWindow) {
          const block = buildInjectionBlock(
            collectEventCandidates(
              agentsMap,
              "session.compacted",
              agent,
              pluginDir,
            ),
            loadFile,
            println,
            sessionID,
          );
          if (block) {
            prependToPromptText(
              event,
              block,
              "Re-injected files after compaction",
              sessionID,
              println,
            );
            injected.push("session.compacted");
          } else {
            // Config list [] / missing, or no file content loaded: the window
            // is real but injects nothing. One diagnostic line per open
            // window — at most once per compaction, because the admitted
            // prompt closes the window.
            println(
              `session.compacted: window open, nothing configured/loaded to inject ` +
                `(sessionID=${sessionID}, compaction=${scan.lastCompletedCompactionId}, agent=${agent ?? "unknown"})`,
            );
          }
        }

        if (injected.length === 0 && isFirstPrompt) {
          // First prompt with nothing configured to inject — log once per
          // session.
          println(`prompt hook (no injection): sessionID=${sessionID}`);
        }
      } catch (e) {
        println(
          `error: error=${JSON.stringify(e)}, event=${JSON.stringify(event)}`,
        );
      }
    });

    return () => registration.dispose();
  },
};
