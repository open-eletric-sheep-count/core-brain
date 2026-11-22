// scripts/dream-synthesize.mjs — the synthesis half of a dream (USER, 2026-11-20).
//
// Above 0.97 the store unites two memories by itself. Between 0.95 and 0.97 they say the same thing
// in other words, and only a writer can put them together: this script asks a NEW OpenCode session to
// write the dream (PROMPT A), waits for the answer, stores it as a dreamed memory (`real = false`,
// `meta.dreamedFrom`) and retires the originals.
//
// THE RULE THAT MATTERS: if the session does not answer or errors, the pair is IGNORED — nothing is
// removed, nothing is written, and the script moves to the next dream.
//
//   node scripts/dream-synthesize.mjs                 # do the night's pairs
//   node scripts/dream-synthesize.mjs --dry-run       # list the pairs, write nothing
//   node scripts/dream-synthesize.mjs --limit 3       # fewer than the night's maximum
//
// The scoring accounting (−1 per night, retire at zero, archive) belongs to `dream`, not here: one
// place does the numbers.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createConfiguredEmbedder } from "../../../plugins/core-brain/engine/embedder.ts";

const DATA_ROOT = process.env.CORE_BRAIN_HOME || join(homedir(), ".config", "core-brain");
const SERVICE_FILE = process.env.OPENCODE_SERVICE_FILE || join(homedir(), ".local", "state", "opencode", "service.json");
/**
 * How long the night's single answer may take (USER, 2026-11-22): **one session writes every union
 * of the night**, so this is one deadline for the whole night — 30 minutes, enough for ten unions on
 * a local engine. `DREAM_ANSWER_TIMEOUT_MS` overrides it without a code change.
 */
const ANSWER_TIMEOUT_MS = Number(process.env.DREAM_ANSWER_TIMEOUT_MS || 1_800_000);
const POLL_MS = 2_000;
/** The ceiling for one union (USER, 2026-11-22): `memoryMaxChars` in the config — the same key the
 *  store enforces — so the worker never writes a text the store would refuse. 650 when absent. */
function readMemoryMaxChars(): number {
  for (const file of [join(DATA_ROOT, "config.json"), PLUGIN_CONFIG]) {
    try {
      if (!existsSync(file)) continue;
      const value = JSON.parse(readFileSync(file, "utf8"))?.memoryMaxChars;
      if (typeof value === "number" && Number.isFinite(value) && value >= 50) return Math.floor(value);
    } catch {
      /* a broken file falls through to the next candidate */
    }
  }
  return 650;
}
const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/** The plugin config of this tree — the same `config.json` the taulukko layer overrides. */
const PLUGIN_CONFIG = join(SKILL_DIR, "..", "..", "plugins", "core-brain", "config.json");

/** The model the dream's sessions use (USER, 2026-11-21): `dream.model` in the plugin config, so
 *  the community default (the local engine) can be replaced per install — taulukko points it at
 *  deepseek-flash low. **A blank entry means the OpenCode default** (USER, 2026-11-22): the session
 *  is created without a model and inherits the default agent's, which is the community default. */
function readDreamModel(): Record<string, unknown> | null {
  try {
    const config = JSON.parse(readFileSync(PLUGIN_CONFIG, "utf8"));
    const model = config?.dream?.model;
    if (!model || typeof model !== "object") return null;
    const providerID = String((model as Record<string, unknown>).providerID ?? "").trim();
    const id = String((model as Record<string, unknown>).id ?? "").trim();
    // `{}` (or any half-filled entry) is the blank the community default ships: no model is passed.
    return providerID === "" || id === "" ? null : (model as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** How many sessions hear about a dream (USER, 2026-11-21): the 10 most recently used. */
const DREAM_NOTIFY_LAST_SESSIONS = 10;

/** Sessions the dream machinery creates; they never count as "used" (USER, 2026-11-21). */
const DREAM_SESSION_TITLE_PREFIX = "dream-";

const dryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) : undefined;

const PROMPT_A_DEFAULT = `You receive {{count}} groups of memories. Inside each group, the memories say the same thing in different words.

Write ONE memory per group, and nothing else.

Unite the memories of each group into one, written to last: the essence without the occasion.

TRIM
- Remove the references to the occasion: dates, names of people, names of projects and companies, names of sessions and of jobs, folder paths.
- Remove what only served that conversation: "measured in", "in this session", "the USER asked", "I decided", "I learned".
- Remove repetition: each fact appears ONCE, not once per memory.

KEEP
- The rule, the cause, the consequence, and the condition in which it holds.
- The technical names that ARE the fact: commands, flags, variables, error codes, API names, file names when they are the key to the procedure.

RULES
1. Each union is at most {{max}} characters — the memory ceiling of this install (memoryMaxChars) — and never longer than the SMALLEST memory of its group.
2. Prose only, in the present tense: it is a truth, not a report.
3. Invent nothing — no explanation, reason or example that is not in the input.
4. If the memories of a group contradict each other, keep what remains true and do not mention the rest.
5. No markdown, no quotes, no preamble, and never mention a dream.
6. Write in the language of the memories: Portuguese memories get a Portuguese union, English memories an English one.

INPUT

{{groups}}

OUTPUT — exactly this format, one block per group, in the same numbering, nothing outside the blocks:

## 1
<text of the union of group 1>

## 2
<text of the union of group 2>`;

/** The prompt file the USER may edit: the data root wins, then the copy shipped with the skill. */
function readPromptFile(name: string): string | null {
  for (const file of [join(DATA_ROOT, "prompts", name), join(SKILL_DIR, "prompts", name)]) {
    if (!existsSync(file)) continue;
    try {
      const text = readFileSync(file, "utf8");
      if (text.trim() !== "") return text;
    } catch {
      /* a broken file is skipped, never fatal */
    }
  }
  return null;
}

function readPrompt(): string {
  const edited = readPromptFile("dream-a.txt");
  // An edited prompt is honoured only when it carries the marker the night fills; one written for
  // the old one-pair flow would leave the model without the groups, so the default takes over.
  if (edited !== null && edited.includes("{{groups}}")) return edited;
  return PROMPT_A_DEFAULT;
}

/** One memory the night will unite: what the prompt shows and what `dream-store` retires. */
type Member = { id: string; text: string; score: number };

/** A group of memories as `synthesis-pairs` returns it (the old two-key shape is still accepted). */
type Group = { ns: string; cosine: number; members?: Member[]; a?: Member; b?: Member };

/** A dream's memories: `members` when the store grouped the pairs, the old two otherwise. */
const membersOf = (group: Group): Member[] =>
  Array.isArray(group.members) && group.members.length >= 2
    ? group.members
    : ([group.a, group.b].filter(Boolean) as Member[]);

/** The group named as the log shows it: the first ids joined by '+'. */
const labelOf = (members: Member[]): string => members.map((member) => shortId(member.id)).join("+");

/** A UUID is shortened to 8 characters; a human id (`ENG-2026-09-09-001`) is shown whole — its
 *  first 8 characters are the same for every global memory, which made the log ambiguous. */
function shortId(id: string): string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id.slice(0, 8) : id;
}

/** The night's groups as the prompt shows them: `UNIÃO n` then each memory of that group. */
function groupsBlock(groups: Group[]): string {
  return groups
    .map((group, index) => {
      const body = membersOf(group)
        .map((member) => `Memória:\n${member.text}`)
        .join("\n\n");
      return `UNIÃO ${index + 1}\n${body}`;
    })
    .join("\n\n");
}

/** The prompt with the whole night filled in (USER, 2026-11-22: ONE session for the night). */
export function fill(prompt: string, groups: Group[], maxChars = 650): string {
  return prompt
    .replaceAll("{{groups}}", groupsBlock(groups))
    .replaceAll("{{count}}", String(groups.length))
    .replaceAll("{{max}}", String(maxChars));
}

/** The answer split into one text per group (USER, 2026-11-22): the model writes `## n` before each
 *  union. A group with no block gets `null` and is ignored — the rule for anything the night cannot
 *  use. */
export function parseUnions(answer: string, count: number): Array<string | null> {
  const out: Array<string | null> = new Array(count).fill(null);
  const marker = /^[ \t]*(?:#{1,4}[ \t]*)?(?:\*{1,2})?(\d{1,2})(?:\*{1,2})?[).:]?[ \t]*$/gm;
  const marks = [...answer.matchAll(marker)];
  for (let index = 0; index < marks.length; index += 1) {
    const number = Number(marks[index][1]);
    if (!Number.isInteger(number) || number < 1 || number > count) continue;
    const start = (marks[index].index ?? 0) + marks[index][0].length;
    const end = index + 1 < marks.length ? (marks[index + 1].index ?? answer.length) : answer.length;
    const text = answer.slice(start, end).trim();
    if (text !== "") out[number - 1] = text;
  }
  return out;
}

const PROMPT_B_DEFAULT = "You slept and dreamed this: {{dream}}";

function readPromptB(): string {
  return (readPromptFile("dream-b.txt") ?? PROMPT_B_DEFAULT).trim();
}

/** One row of the session listing: only what the selection needs. */
type SessionListItem = { id?: unknown; title?: unknown; parentID?: unknown; time?: { updated?: unknown } };

/** Last activity of a session, in epoch milliseconds; a listing without it sorts last. */
function lastUsedAt(session: SessionListItem): number {
  const updated = Number(session.time?.updated);
  return Number.isFinite(updated) ? updated : 0;
}

/**
 * Who hears about a dream (USER, 2026-11-21): the 10 most recently used TOP-LEVEL sessions. Subagent
 * sessions (a `parentID`) are left out — their agent does not need the news, and they would eat the
 * slots. The sessions the dream machinery creates do not count as used either — without that, a
 * night's own dream sessions would fill every slot.
 */
export function selectTellTargets(
  sessions: SessionListItem[],
  limit = DREAM_NOTIFY_LAST_SESSIONS,
): string[] {
  return sessions
    .filter((session) => typeof session.id === "string" && session.id !== "")
    .filter((session) => !session.parentID)
    .filter((session) => !String(session.title ?? "").startsWith(DREAM_SESSION_TITLE_PREFIX))
    .sort((a, b) => lastUsedAt(b) - lastUsedAt(a) || String(a.id).localeCompare(String(b.id)))
    .slice(0, limit)
    .map((session) => String(session.id));
}

/** Tells the 10 sessions used most recently what was dreamed tonight (USER, 2026-11-20/21): one
 *  message, the night's dreams together. A session that refuses the prompt is skipped — telling is a
 *  courtesy, never a failure of the night. */
async function tellTheSessions(dreams: string[]): Promise<void> {
  if (dreams.length === 0) return;
  const { url, auth } = serviceAuth();
  const template = readPromptB();
  const text = template.replace("{{dream}}", dreams.join("\n\n"));
  const pages = await call(url, auth, "/api/session");
  const sessions = (Array.isArray(pages?.data) ? pages.data : Array.isArray(pages) ? pages : []) as SessionListItem[];
  const targets = selectTellTargets(sessions);
  let told = 0;
  for (const id of targets) {
    try {
      await call(url, auth, `/api/session/${id}/prompt`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      told += 1;
    } catch {
      /* a session with no room for a message is skipped */
    }
  }
  console.log(`sonho contado a ${told} sessão(ões) (de ${targets.length} escolhida(s))`);
}

function serviceAuth(): { url: string; auth: string } {
  if (!existsSync(SERVICE_FILE)) throw new Error(`service file not found: ${SERVICE_FILE}`);
  const service = JSON.parse(readFileSync(SERVICE_FILE, "utf8"));
  if (!service?.url || !service?.password) throw new Error("service file without url/password");
  const auth = Buffer.from(`opencode:${service.password}`).toString("base64");
  return { url: String(service.url), auth };
}

async function call(url: string, auth: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${url}${path}`, {
    ...init,
    // A hung request must not freeze the clock (measured 2026-11-21): every call has its own limit,
    // so the pair's deadline is always evaluated and the worker never stalls on one fetch.
    signal: init.signal ?? AbortSignal.timeout(15_000),
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} -> HTTP ${response.status}`);
  return response.json().catch(() => ({}));
}

/** The assistant answer inside one message (USER, 2026-11-21): the V2 API carries it as `text` parts
 *  inside `content`; older shapes put it at `text` or inside `parts`. All three are accepted. */
export function answerText(message: any): string {
  const direct = typeof message?.text === "string" ? message.text : "";
  const collect = (parts: any): string =>
    Array.isArray(parts)
      ? parts
          .filter((part: any) => part?.type === "text" && typeof part?.text === "string")
          .map((part: any) => part.text)
          .join("")
      : "";
  return (direct || collect(message?.parts) || collect(message?.content)).trim();
}

/** Opens a fresh session, sends the prompt and waits for the assistant's text. */
async function dreamInANewSession(prompt: string): Promise<string> {
  const { url, auth } = serviceAuth();
  const model = readDreamModel();
  const created = await call(url, auth, "/api/session", {
    method: "POST",
    body: JSON.stringify({ title: `dream-${Date.now()}`, ...(model ? { model } : {}) }),
  });
  const sessionId = created?.data?.id ?? created?.id;
  if (!sessionId) throw new Error("the session could not be created");

  try {
    await call(url, auth, `/api/session/${sessionId}/prompt`, {
      method: "POST",
      body: JSON.stringify({ text: prompt }),
    });

    const deadline = Date.now() + ANSWER_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const page = await call(url, auth, `/api/session/${sessionId}/message`);
      const messages = Array.isArray(page?.data) ? page.data : Array.isArray(page) ? page : [];
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        const role = message?.type ?? message?.info?.role ?? message?.role;
        if (role !== "assistant") continue;
        const text = answerText(message);
        if (text !== "") return text;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    throw new Error(`no answer within ${Math.round(ANSWER_TIMEOUT_MS / 1000)} s`);
  } catch (error) {
    // The pair is abandoned: STOP its session before moving on. A session left alive keeps holding
    // the engine and queues every later pair behind it (measured 2026-11-21: 4 orphans, 24–84 min).
    await call(url, auth, `/api/session/${sessionId}/interrupt`, { method: "POST" }).catch(() => {});
    throw error;
  }
}

async function main(): Promise<void> {
  const { createEngine } = await import("../../../plugins/core-brain/store.ts");
  const engine = createEngine({ embedder: createConfiguredEmbedder() });

  const listing = await engine.invoke("SYSTEM", {
    op: "admin",
    action: "synthesis-pairs",
    args: limit ? { limit } : {},
  });
  const pairs = listing.synthesisPairs ?? [];
  const dreamModel = readDreamModel();
  console.log(`grupos para sonhar: ${pairs.length}${dryRun ? " (dry-run)" : ""} — uma sessão para a noite`);
  console.log(
    `modelo do sonho: ${dreamModel ? `${String(dreamModel.providerID)}/${String(dreamModel.id)}${dreamModel.variant ? `#${String(dreamModel.variant)}` : ""}` : "padrão do OpenCode"}`,
  );
  if (dryRun) {
    for (const pair of pairs) {
      const members = membersOf(pair);
      console.log(
        ` ${pair.cosine} [${pair.ns}] ${members.map((member) => `${shortId(member.id)}=${member.score}`).join(" · ")}`,
      );
    }
    return;
  }
  if (pairs.length === 0) {
    console.log("nada para sonhar esta noite");
    return;
  }

  // ONE session for the whole night (USER, 2026-11-22): every group goes in one prompt and one
  // answer brings back one union per group.
  const maxChars = readMemoryMaxChars();
  const prompt = fill(readPrompt(), pairs, maxChars);
  let answer: string;
  try {
    answer = await dreamInANewSession(prompt);
  } catch (error) {
    // Nothing can be used, so nothing is removed: the whole night is ignored in one line.
    console.log(`noite ignorada: ${String(error?.message ?? error)} (${pairs.length} grupo(s) intacto(s))`);
    return;
  }

  const unions = parseUnions(answer, pairs.length);
  const dreamedTexts: string[] = [];
  let dreamed = 0;
  let skipped = 0;
  for (const [index, pair] of pairs.entries()) {
    const members = membersOf(pair);
    const text = unions[index];
    if (!text) {
      skipped += 1;
      console.log(`ignorado ${labelOf(members)}: sem bloco ${index + 1} na resposta`);
      continue;
    }
    if ([...text].length > maxChars) {
      skipped += 1;
      console.log(`ignorado ${labelOf(members)}: ${[...text].length} caracteres (limite ${maxChars})`);
      continue;
    }
    try {
      const landed = await engine.invoke("SYSTEM", {
        op: "admin",
        action: "dream-store",
        args: { ns: pair.ns, text, sourceIds: members.map((member) => member.id) },
      });
      console.log(`sonho ${labelOf(members)} -> ${landed.detail}`);
      dreamedTexts.push(text);
      dreamed += 1;
    } catch (error) {
      // The USER's rule: a group whose dream cannot be written is IGNORED — nothing is removed.
      skipped += 1;
      console.log(`ignorado ${labelOf(members)}: ${String(error?.message ?? error)}`);
    }
  }
  console.log(`sonhados=${dreamed} ignorados=${skipped}`);
  if (!process.argv.includes("--no-notify")) {
    try {
      await tellTheSessions(dreamedTexts);
    } catch (error) {
      console.log(`sessões não avisadas: ${String(error?.message ?? error)}`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`dream-synthesize: ${String(error?.message ?? error)}`);
    process.exitCode = 1;
  });
}
