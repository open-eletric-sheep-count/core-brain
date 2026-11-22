// test/dream.selftest.mjs — the dream pass: episodes in, memories out, both sides linked.
//
// USER design (2026-11-19):
//   - a NEW dream record per pass: id, date, the episodes it read, the memories it created;
//   - a memory may come from more than one dream, so the memory carries a LIST of dreams with dates;
//   - an episode gains `dreamedAt` (logical removal) and is no longer offered to the next dream;
//   - the date kept on the memory is the DREAM date, not the episode date.
//
// What is pinned here:
//   1. `dream` with no payload lists ONLY episodes without `dreamedAt`;
//   2. `dream` with episodes + texts creates the memories (the same path the removed `promote` used);
//   3. the dream record links both ways (episodes[] and memories[]);
//   4. the memories carry meta.dreams with {id, at} — the dream date;
//   5. the episodes are marked `dreamedAt` and disappear from the next listing;
//   6. re-dreaming an already-dreamed episode is REFUSED;
//   7. a memory refused as duplicate does not enter the dream record.

import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFixtureEmbedder, FIXTURE_DIR } from "./fixtures/embedder.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "corebrain-dream-"));
process.env.CORE_BRAIN_HOME = ROOT;
writeFileSync(
  join(ROOT, "config.json"),
  JSON.stringify({ dreams: true, dreamPerDay: 5, agents: [{ name: "CB_ALPHA", hasGlobalAccess: true, private: false }] }),
);

const { createEngine } = await import("../store.ts");
const engine = createEngine({ embedder: createFixtureEmbedder({ dir: FIXTURE_DIR }) });

const policy = await engine.invoke("CB_ALPHA", { op: "who" });
if (policy.dataDir !== ROOT) {
  console.error(`COREBRAIN_DREAM: refusing to run against ${policy.dataDir} (expected ${ROOT})`);
  process.exit(2);
}

const readJson = (file, fallback = []) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback);
const MEMORIES = join(ROOT, "agents", "CB_ALPHA", "memories.json");
const EPISODES = join(ROOT, "agents", "CB_ALPHA", "episodes.json");
const DREAMS = join(ROOT, "agents", "CB_ALPHA", "dreams.json");
const DREAM_LOG = join(ROOT, "logs", "dream.log");
const memories = () => {
  const data = readJson(MEMORIES);
  return Array.isArray(data) ? data : data.records ?? [];
};
const active = () => memories().filter((r) => typeof r.retiredAt !== "string");

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

// Arrange: three episodes
const one = await engine.invoke("CB_ALPHA", { op: "episode", summary: "Delivered the Prisma calculator." });
const two = await engine.invoke("CB_ALPHA", { op: "episode", summary: "Fixed the ffmpeg zero-byte defect." });
const three = await engine.invoke("CB_ALPHA", { op: "episode", summary: "Diagnosed the Foundry WebGL failure." });

// 1. the dry listing
const listing = await engine.invoke("CB_ALPHA", { op: "dream" });
check("listing returns every episode by default", (listing.episodes ?? []).length === 3, JSON.stringify(listing.episodes?.length));
check("listing carries the idle threshold (default 4)", listing.idleHoursRequired === 4, String(listing.idleHoursRequired));
check("listing carries the summary", typeof listing.episodes?.[0]?.summary === "string", "no summary");

// 1b. the threshold is configurable: config.json is read on every listing
writeFileSync(
  join(ROOT, "config.json"),
  JSON.stringify({ dreams: true, dreamPerDay: 5, dreamIdleHours: 7, agents: [{ name: "CB_ALPHA", hasGlobalAccess: true, private: false }] }),
);
const listing2 = await engine.invoke("CB_ALPHA", { op: "dream" });
check("listing carries the configured threshold", listing2.idleHoursRequired === 7, String(listing2.idleHoursRequired));

// 2. one dream over two episodes, producing two memories
const dreamed = await engine.invoke("CB_ALPHA", {
  op: "dream",
  episodeIds: [one.id, two.id],
  memories: [
    { text: "The Prisma calculator is one HTML file, vanilla, with no eval().", meta: { type: "decision" } },
    { text: "ffmpeg areverse/concat yields a zero-byte file; use -sseof with the concat demuxer.", meta: { type: "gotcha" } },
  ],
});
check("dream returns the dreamId", typeof dreamed.dreamId === "string", JSON.stringify(dreamed));
check("dream created two memories", active().length === 2, `active=${active().length}`);

// 3. the record links both ways
const dreams = readJson(DREAMS);
const record = dreams.find((d) => d.id === dreamed.dreamId);
check("one dream record written", dreams.length === 1, `dreams=${dreams.length}`);
check("record lists the two episodes", (record?.episodes ?? []).length === 2, JSON.stringify(record?.episodes));
check("record lists the two memories", (record?.memories ?? []).length === 2, JSON.stringify(record?.memories));
check("record has a date", typeof record?.at === "string", String(record?.at));

// 4. the memory carries the dream, with its date
const withDreams = active().filter((r) => Array.isArray(r.meta?.dreams) && r.meta.dreams.length > 0);
check("both memories carry meta.dreams", withDreams.length === 2, `carrying=${withDreams.length}`);
check("the dream entry has id and at",
  withDreams.every((r) => typeof r.meta.dreams[0].id === "string" && typeof r.meta.dreams[0].at === "string"),
  JSON.stringify(withDreams[0]?.meta?.dreams));

// 5. the episodes are marked and disappear from the next listing
const after = await engine.invoke("CB_ALPHA", { op: "dream" });
check("only the undreamed episode is offered", (after.episodes ?? []).length === 1, JSON.stringify(after.episodes?.length));
check("the remaining one is episode three", after.episodes?.[0]?.id === three.id, String(after.episodes?.[0]?.id));

const episodesOnDisk = readJson(EPISODES);
const marked = episodesOnDisk.filter((e) => typeof e.dreamedAt === "string");
check("two episodes marked dreamedAt", marked.length === 2, `marked=${marked.length}`);

// 6. re-dreaming a dreamed episode is refused
let reDream = null;
try {
  await engine.invoke("CB_ALPHA", { op: "dream", episodeIds: [one.id], memories: [{ text: "A new fact from the same episode." }] });
} catch (error) {
  reDream = String((error && error.message) || error);
}
check("re-dreaming a dreamed episode is refused", reDream !== null, "no error was thrown");

// 7. a duplicate REINFORCES the memory that already exists (USER, 2026-11-19)
const dreamsBefore = readJson(DREAMS).length;
const original = active().find((r) => String(r.text).startsWith("The Prisma calculator"));
const scoreBefore = original.score;
const reinforcedRun = await engine.invoke("CB_ALPHA", {
  op: "dream",
  episodeIds: [three.id],
  memories: [{ text: "The Prisma calculator is one HTML file, vanilla, with no eval()." }],
});
check("a duplicate no longer refuses the pass", typeof reinforcedRun.dreamId === "string", JSON.stringify(reinforcedRun));
const originalAfter = active().find((r) => r.id === original.id);
check("the existing memory gained this dream", (originalAfter?.meta?.dreams ?? []).length === 2, JSON.stringify(originalAfter?.meta?.dreams));
check("its score went up by one", originalAfter?.score === scoreBefore + 1, `${originalAfter?.score} vs ${scoreBefore}`);
check("its feedback gained a useful mark", (originalAfter?.feedback?.useful ?? 0) >= 1, JSON.stringify(originalAfter?.feedback));
const lastRecord = readJson(DREAMS).at(-1);
check("the dream record lists it under reinforced", Array.isArray(lastRecord?.reinforced) && lastRecord.reinforced.includes(original.id), JSON.stringify(lastRecord?.reinforced));
check("no second copy was created", active().filter((r) => String(r.text).startsWith("The Prisma calculator")).length === 1, "a copy exists");
check("the episode was still marked as dreamed", readJson(EPISODES).some((e) => e.id === three.id && typeof e.dreamedAt === "string"), "episode not marked");
check("a new dream record was written", readJson(DREAMS).length === dreamsBefore + 1, `dreams=${readJson(DREAMS).length}`);

// 8. the dream log: START, END and ERROR lines, under <root>/logs (USER, 2026-11-19)
const log = existsSync(DREAM_LOG) ? readFileSync(DREAM_LOG, "utf8") : "";
check("log has a START line", /START DR-/.test(log), log.slice(0, 120));
check("log has an END line", /END DR-/.test(log), log.slice(0, 120));


// 9. the daily limit: one dream per day unless forced (USER, 2026-11-19)
writeFileSync(
  join(ROOT, "config.json"),
  JSON.stringify({ dreamPerDay: 1, agents: [{ name: "CB_ALPHA", hasGlobalAccess: true, private: false }] }),
);
const four = await engine.invoke("CB_ALPHA", { op: "episode", summary: "Wrote the dreaming tests." });
let limited = null;
try {
  await engine.invoke("CB_ALPHA", { op: "dream", episodeIds: [four.id], memories: [{ text: "The dream pass writes one dream record per pass." }] });
} catch (error) {
  limited = String((error && error.message) || error);
}
check("a second dream in the same day is refused", limited !== null && /daily limit/.test(limited), String(limited));
check("the episode is still waiting", (await engine.invoke("CB_ALPHA", { op: "dream" })).episodes?.some((e) => e.id === four.id) === true, "episode consumed");

const forced = await engine.invoke("CB_ALPHA", {
  op: "dream",
  force: true,
  episodeIds: [four.id],
  memories: [{ text: "The dream pass writes one dream record per pass." }],
});
check("force:true bypasses the limit", typeof forced.dreamId === "string", JSON.stringify(forced));

const logAfter = existsSync(DREAM_LOG) ? readFileSync(DREAM_LOG, "utf8") : "";
check("log records the refusal as ERROR", /ERROR .*daily limit/.test(logAfter), logAfter.slice(-160));

console.log(failures === 0 ? "DREAM OK" : `DREAM FAILED (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;
