// crontab — schedule prompts into OpenCode sessions.
//
// Why it is a separate plugin (USER, 2026-11-18): the mechanism must be testable on its own, without
// dreams, memory or any other feature attached. A schedule is a prompt plus an interval; the plugin
// creates a session through the OpenCode API and sends that prompt. Nothing else.
//
// v2 (same day) adds three things the USER asked for:
//   - session names are standardised: `session-YYYYMMDD-HHMM` (configurable template);
//   - `{idleHours}` and `{timestamp}` are substituted in the prompt at fire time;
//   - idle is measured from the USER's own sessions — the scheduler's sessions are excluded, so a
//     dream session does not reset the clock it was triggered by.
//
// What it never does: write memory, touch the store, or run anything while disabled. The default is
// OFF — enabling is an explicit edit of `config.json`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Schedule {
  /** Stable id: it is the state key, so renaming it schedules a new run. */
  id: string;
  /** How often it fires, in minutes (positive, finite). */
  everyMinutes: number;
  /** The text handed to the new session; `{idleHours}` and `{timestamp}` are substituted. */
  prompt: string;
  /** Off unless true — a schedule without this flag never runs. */
  enabled?: boolean;
  /** Session title; the default template is `session-{timestamp}`. */
  title?: string;
}

export interface CrontabConfig {
  /** Master switch. Absent/false = the timer runs but fires nothing. */
  enabled?: boolean;
  /** How often the due check runs. Default 30 s. */
  tickSeconds?: number;
  /** Title prefixes that mark a session as the scheduler's own (excluded from idle). */
  schedulerPrefixes?: string[];
  schedules?: Schedule[];
}

const CONFIG_FILE = "config.json";
const STATE_DIR = path.join(os.homedir(), ".local", "state", "opencode", "crontab");
const STATE_FILE = path.join(STATE_DIR, "state.json");
const SERVICE_FILE = process.env.OPENCODE_SERVICE_FILE
  ?? path.join(os.homedir(), ".local", "state", "opencode", "service.json");
const LOG = "[crontab]";
const TIMER_KEY = Symbol.for("opencode.crontab.timer");
/** Titles this scheduler produced — every prefix it has ever written. */
const DEFAULT_PREFIXES = ["session-", "crontab:"];

/** `YYYYMMDD-HHMM` in local time — the standard name the USER asked for. */
export function formatTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** The session title for one firing: the template with `{timestamp}` filled in. */
export function titleFor(schedule: Schedule, date: Date): string {
  const template = schedule.title && schedule.title.trim() !== "" ? schedule.title : "session-{timestamp}";
  return template.replaceAll("{timestamp}", formatTimestamp(date));
}

/** True when the title marks a session the scheduler itself created. */
export function isSchedulerSession(title: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => title.startsWith(prefix));
}

/**
 * Hours since the USER's last activity, ignoring the scheduler's own sessions.
 *
 * `sessions` is the raw OpenCode list: each row needs `title` and `time.updated` (ms). An empty list
 * means "no activity seen" and reports 0 — never a fabricated idle.
 */
export function idleHours(
  sessions: Array<{ title?: string; time?: { updated?: number } }>,
  now: number,
  prefixes: string[],
): number {
  let latest = 0;
  for (const session of sessions) {
    const title = String(session.title ?? "");
    if (isSchedulerSession(title, prefixes)) continue;
    const updated = Number(session.time?.updated ?? 0);
    if (Number.isFinite(updated) && updated > latest) latest = updated;
  }
  if (latest === 0) return 0;
  return Math.max(0, (now - latest) / 3_600_000);
}

/** Substitutes the placeholders the prompt may carry. */
export function fillPrompt(prompt: string, values: { idleHours: number; timestamp: string }): string {
  return prompt
    .replaceAll("{idleHours}", (Math.floor(values.idleHours * 10) / 10).toFixed(1))
    .replaceAll("{timestamp}", values.timestamp);
}

/** A schedule is usable when every field the run depends on is present and sane. */
function validSchedule(value: unknown): value is Schedule {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" && row.id.trim() !== "" &&
    typeof row.prompt === "string" && row.prompt.trim() !== "" &&
    typeof row.everyMinutes === "number" &&
    Number.isFinite(row.everyMinutes) && row.everyMinutes > 0
  );
}

/** Reads the config document; invalid rows are reported and dropped, never guessed. */
export function parseConfig(raw: unknown): CrontabConfig {
  if (!raw || typeof raw !== "object") return { enabled: false, schedules: [] };
  const doc = raw as Record<string, unknown>;
  const schedules: Schedule[] = [];
  if (Array.isArray(doc.schedules)) {
    for (const row of doc.schedules) {
      if (validSchedule(row)) {
        schedules.push({
          id: row.id.trim(),
          everyMinutes: row.everyMinutes,
          prompt: row.prompt,
          enabled: row.enabled === true,
          title: typeof row.title === "string" ? row.title : undefined,
        });
      } else {
        console.warn(`${LOG} ignoring an invalid schedule row`);
      }
    }
  }
  // A very small tick is a busy loop; anything below the floor becomes the floor, not the default.
  const tick = typeof doc.tickSeconds === "number" && Number.isFinite(doc.tickSeconds)
    ? Math.max(5, doc.tickSeconds)
    : 30;
  const prefixes = Array.isArray(doc.schedulerPrefixes)
    ? doc.schedulerPrefixes.filter((value): value is string => typeof value === "string" && value !== "")
    : DEFAULT_PREFIXES;
  return { enabled: doc.enabled === true, tickSeconds: tick, schedulerPrefixes: prefixes, schedules };
}

/**
 * The schedules that are due at `now`. Pure on purpose: this is the rule the whole feature hangs
 * on, so it is tested without a timer, a session or a file.
 */
export function dueSchedules(
  config: CrontabConfig,
  state: Record<string, string>,
  now: number,
): Schedule[] {
  if (!config.enabled) return [];
  return (config.schedules ?? []).filter((schedule) => {
    if (schedule.enabled !== true) return false;
    const last = Date.parse(state[schedule.id] ?? "");
    if (Number.isNaN(last)) return true;
    return now - last >= schedule.everyMinutes * 60_000;
  });
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

function serviceCredentials(): { url: string; auth: string } | null {
  const service = readJson(SERVICE_FILE) as { url?: string; password?: string } | null;
  if (!service?.url || !service.password) return null;
  const token = Buffer.from(`opencode:${service.password}`).toString("base64");
  return { url: service.url, auth: `Basic ${token}` };
}

async function listSessions(url: string, auth: string): Promise<Array<{ title?: string; time?: { updated?: number } }>> {
  const response = await fetch(`${url}/api/session?limit=2000`, { headers: { Authorization: auth } });
  if (!response.ok) return [];
  const payload = (await response.json()) as { data?: unknown } | unknown[];
  const rows = Array.isArray(payload) ? payload : (payload as { data?: unknown }).data;
  return Array.isArray(rows) ? (rows as Array<{ title?: string; time?: { updated?: number } }>) : [];
}

async function createSession(url: string, auth: string, title: string): Promise<string | null> {
  const response = await fetch(`${url}/api/session`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { data?: { id?: string } };
  return payload?.data?.id ?? null;
}

async function sendPrompt(url: string, auth: string, sessionID: string, text: string): Promise<boolean> {
  const response = await fetch(`${url}/api/session/${sessionID}/prompt`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return response.ok;
}

async function fire(schedule: Schedule, config: CrontabConfig, state: Record<string, string>): Promise<void> {
  const credentials = serviceCredentials();
  if (!credentials) {
    console.warn(`${LOG} ${schedule.id}: no service credentials — nothing sent`);
    return;
  }
  const now = Date.now();
  const date = new Date(now);
  const timestamp = formatTimestamp(date);
  const prefixes = config.schedulerPrefixes ?? DEFAULT_PREFIXES;
  const sessions = await listSessions(credentials.url, credentials.auth);
  const idle = idleHours(sessions, now, prefixes);
  const text = fillPrompt(schedule.prompt, { idleHours: idle, timestamp });

  const title = titleFor(schedule, date);
  const sessionID = await createSession(credentials.url, credentials.auth, title);
  if (!sessionID) {
    console.warn(`${LOG} ${schedule.id}: the session could not be created`);
    return;
  }
  const sent = await sendPrompt(credentials.url, credentials.auth, sessionID, text);
  if (!sent) {
    console.warn(`${LOG} ${schedule.id}: the prompt did not go through (session ${sessionID})`);
    return;
  }
  state[schedule.id] = new Date().toISOString();
  writeJson(STATE_FILE, state);
  console.log(`${LOG} ${schedule.id}: fired into ${title} (${sessionID}), idle ${idle.toFixed(1)} h`);
}

/**
 * Fires every due schedule once. Exported so the pass can be executed on demand (a test, a manual
 * run) instead of only by the timer inside `setup`.
 */
export async function dispatch(
  config: CrontabConfig,
  state: Record<string, string>,
  now: number,
): Promise<string[]> {
  const fired: string[] = [];
  for (const schedule of dueSchedules(config, state, now)) {
    await fire(schedule, config, state);
    fired.push(schedule.id);
  }
  return fired;
}

export default {
  id: "crontab",
  async setup(_ctx: unknown): Promise<void> {
    // A reloaded plugin must replace its own timer: keeping the old one alive means the previous
    // configuration (and the previous code) keeps firing — measured 2026-11-18 at 17:40, when the
    // sessions still carried the v1 title after v2 had been installed.
    const previous = (globalThis as Record<symbol, unknown>)[TIMER_KEY];
    if (previous) {
      clearInterval(previous as ReturnType<typeof setInterval>);
      delete (globalThis as Record<symbol, unknown>)[TIMER_KEY];
    }

    const configPath = path.join(path.dirname(new URL(import.meta.url).pathname), CONFIG_FILE);
    const initial = parseConfig(readJson(configPath));
    const inFlight = new Set<string>();

    if (!initial.enabled) {
      console.log(`${LOG} disabled (config.json: "enabled": false)`);
    } else {
      console.log(`${LOG} on — ${(initial.schedules ?? []).length} schedule(s), tick ${initial.tickSeconds}s`);
    }

    // The config is re-read on every tick: enabling a schedule in the file must work without a
    // host reload (USER, 2026-11-18 — the first version only woke up on restart).
    const timer = setInterval(() => {
      const config = parseConfig(readJson(configPath));
      if (!config.enabled) return;
      const state = (readJson(STATE_FILE) as Record<string, string> | null) ?? {};
      for (const schedule of dueSchedules(config, state, Date.now())) {
        if (inFlight.has(schedule.id)) continue;
        inFlight.add(schedule.id);
        void fire(schedule, config, state)
          .catch((error) => console.warn(`${LOG} ${schedule.id}: ${String(error)}`))
          .finally(() => inFlight.delete(schedule.id));
      }
    }, (initial.tickSeconds ?? 30) * 1000);
    (timer as { unref?: () => void }).unref?.();
    (globalThis as Record<symbol, unknown>)[TIMER_KEY] = timer;
  },
};
