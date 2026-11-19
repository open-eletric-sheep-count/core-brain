// test/schedule.selftest.mjs — the rules behind the scheduler, with no timer and no session.
//
// What is pinned:
//   1. a disabled config fires nothing, whatever the schedules say;
//   2. a schedule with `enabled:false` never fires;
//   3. a schedule that never ran is due immediately;
//   4. the interval is counted from the LAST RUN, not from boot;
//   5. invalid rows are dropped, never guessed;
//   6. `tickSeconds` has a floor of 5;
//   7. session titles are standardised (`sessão-YYYYMMDD-HHMM`);
//   8. idle ignores the scheduler's own sessions (a dream session must not reset the clock);
//   9. `{idleHours}` and `{timestamp}` are substituted in the prompt.

import {
  parseConfig,
  dueSchedules,
  formatTimestamp,
  titleFor,
  isSchedulerSession,
  idleHours,
  fillPrompt,
} from "../index.ts";

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const schedule = (overrides = {}) => ({
  id: "s1",
  everyMinutes: 1,
  prompt: "Answer with the single word OK.",
  enabled: true,
  ...overrides,
});

const config = (overrides = {}) => parseConfig({ enabled: true, tickSeconds: 30, schedules: [schedule()], ...overrides });

// 1. master switch
const off = parseConfig({ enabled: false, schedules: [schedule()] });
check("master switch off fires nothing", dueSchedules(off, {}, Date.now()).length === 0, "fired while off");

// 2. entry switch
const disabledEntry = parseConfig({ enabled: true, schedules: [schedule({ enabled: false })] });
check("entry switch off fires nothing", dueSchedules(disabledEntry, {}, Date.now()).length === 0, "fired while disabled");

// 3. never ran
const fresh = config();
check("never ran = due now", dueSchedules(fresh, {}, Date.now()).length === 1, "not due");

// 4. interval counted from the last run
const now = Date.parse("2026-11-18T15:00:00.000Z");
const thirtySecondsAgo = new Date(now - 30_000).toISOString();
const twoMinutesAgo = new Date(now - 120_000).toISOString();
check("30 s after a 1-minute run is not due", dueSchedules(fresh, { s1: thirtySecondsAgo }, now).length === 0, "fired early");
check("2 minutes after is due", dueSchedules(fresh, { s1: twoMinutesAgo }, now).length === 1, "did not fire");

// 5. invalid rows dropped
const dirty = parseConfig({
  enabled: true,
  schedules: [
    schedule(),
    { id: "", everyMinutes: 5, prompt: "x", enabled: true },
    { id: "no-interval", everyMinutes: 0, prompt: "x", enabled: true },
    { id: "no-prompt", everyMinutes: 5, prompt: "   ", enabled: true },
  ],
});
check("invalid rows are dropped", (dirty.schedules ?? []).length === 1, JSON.stringify(dirty.schedules));

// 6. tick floor
const tiny = parseConfig({ enabled: true, tickSeconds: 1, schedules: [] });
check("tickSeconds floor is 5", tiny.tickSeconds === 5, String(tiny.tickSeconds));

// 7. standardised titles
const stamp = formatTimestamp(new Date(2026, 10, 18, 16, 32)); // local time, month is 0-based
check("timestamp format YYYYMMDD-HHMM", stamp === "20261118-1632", stamp);
check("default title uses the template",
  titleFor(schedule(), new Date(2026, 10, 18, 16, 32)) === "sessão-20261118-1632",
  titleFor(schedule(), new Date(2026, 10, 18, 16, 32)));
check("a custom title still gets the timestamp",
  titleFor(schedule({ title: "crontab: {timestamp}" }), new Date(2026, 10, 18, 16, 32)) === "crontab: 20261118-1632",
  "template not filled");

// 8. idle ignores the scheduler's own sessions
const prefixes = ["sessão-", "session-", "crontab:"];
const base = Date.parse("2026-11-18T16:00:00.000Z");
const sessions = [
  { title: "sessão-20261118-1600", time: { updated: base } },        // scheduler's own
  { title: "crontab: test-ok", time: { updated: base } },            // scheduler's own
  { title: "Minha sessão", time: { updated: base - 5 * 3_600_000 } }, // USER activity, 5 h old
];
const idle = idleHours(sessions, base, prefixes);
check("idle counts the USER's last activity, not the scheduler's", Math.abs(idle - 5) < 0.01, String(idle));
check("an empty list reports zero", idleHours([], base, prefixes) === 0, "not zero");
check("isSchedulerSession matches the prefixes",
  isSchedulerSession("sessão-20261118-1600", prefixes) && isSchedulerSession("crontab: x", prefixes) &&
  !isSchedulerSession("Minha sessão", prefixes), "prefix match wrong");

// 9. placeholders
const filled = fillPrompt("idle {idleHours} h at {timestamp}", { idleHours: 4.37, timestamp: "20261118-1632" });
check("placeholders substituted", filled === "idle 4.3 h at 20261118-1632", filled);

console.log(failures === 0 ? "CRONTAB OK" : `CRONTAB FAILED (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;
