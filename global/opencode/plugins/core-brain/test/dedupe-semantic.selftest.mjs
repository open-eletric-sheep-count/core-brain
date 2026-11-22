// test/dedupe-semantic.selftest.mjs — memories that say the SAME THING in different words.
//
// USER design (2026-11-20, item 6.1): the merge happens in the DREAM — while it writes a memory it
// looks among the memories that already exist, and when one says the same thing it JOINS the two
// into ONE, summing the score. The admin sweep keeps the same rule for the repair pass.
// The exact-text pass (dedupe.selftest.mjs) cannot see a paraphrase; this suite pins the vector one.
//
// What is pinned:
//   0. `richestMemoryText` — the text one memory keeps: the richest, never past 600 characters;
//   1. the DREAM joins a paraphrase into the existing memory and sums the score (item 6.1);
//   2. a merely related memory is NOT joined — both stay;
//   3. admin dry-run reports ONE semantic group and writes nothing;
//   4. admin apply retires the copy, sums the counters and keeps the richest text;
//   5. a second run is a no-op (idempotent);
//   6. `mode: "text"` keeps the old exact-text behaviour (backwards compatible);
//   7. `minCosine` moves the line: the pair groups BELOW it and not above it, and the default is
//      strict (above the pair's own cosine).
//
// Fixture embedder: deterministic, no model download. Disposable home only (guarded).

import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createFixtureEmbedder,
  deterministicVector,
  cosine as fixtureCosine,
  FIXTURE_DIR,
} from "./fixtures/embedder.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "corebrain-dedupe-semantic-"));
process.env.CORE_BRAIN_HOME = ROOT;
writeFileSync(
  join(ROOT, "config.json"),
  JSON.stringify({
    dreams: true,
    dreamPerDay: 5,
    agents: [{ name: "CB_ALPHA", hasGlobalAccess: true, private: false }],
  }),
);

const { createEngine, richestMemoryText } = await import("../store.ts");
const engine = createEngine({ embedder: createFixtureEmbedder({ dir: FIXTURE_DIR }) });

const policy = await engine.invoke("CB_ALPHA", { op: "who" });
if (policy.dataDir !== ROOT) {
  console.error(`COREBRAIN_DEDUPE_SEMANTIC: refusing to run against ${policy.dataDir} (expected ${ROOT})`);
  process.exit(2);
}

const memoriesOf = (agent) => () => {
  const parsed = JSON.parse(readFileSync(join(ROOT, "agents", agent, "memories.json"), "utf8"));
  return Array.isArray(parsed) ? parsed : parsed.records ?? [];
};
const recordsOfAlpha = memoriesOf("CB_ALPHA");
const active = () => recordsOfAlpha().filter((record) => typeof record.retiredAt !== "string");

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

// ---------------------------------------------------------------------------
// 0. The text one memory keeps — pure, no engine, no I/O
// ---------------------------------------------------------------------------
{
  const short = "The deploy script rebuilds the client bundle.";
  const rich = "The deploy script rebuilds the client bundle and bumps the cache key on every release.";
  check("the richest text wins", richestMemoryText([short, rich]) === rich, richestMemoryText([short, rich]));
  check("ties keep the survivor's own text", richestMemoryText([rich, short]) === rich, "tie broke");
  check("an empty group has no text", richestMemoryText([]) === "", "not empty");

  const longA = `Rule alpha covers ${"alpha ".repeat(60)}`.trim();
  const longB = `Rule beta covers ${"beta ".repeat(60)}`.trim();
  check(
    "an imported text is cut to the 600 ceiling",
    [...richestMemoryText([longA, longB])].length <= 600,
    `chars=${[...richestMemoryText([longA, longB])].length}`,
  );
}

// ---------------------------------------------------------------------------
// 1. The DREAM joins the same meaning into the memory that already exists
// ---------------------------------------------------------------------------
const OLD = "The Jarvis voice service needs a display, so the unit waits for the graphical session.";
// ≥0.97 on the fixture: the MECHANICAL union regime (normalised texts differ only by the full stop).
const TWIN = "The Jarvis voice service needs a display, so the unit waits for the graphical session";
// ≈0.94: the SYNTHESIS band — similar, not identical, and the mechanical union must NOT take it.
const NEAR = "The Jarvis voice service needs a display, so its unit waits for the graphical session.";
const FRESH = "The Grafana dashboard refresh interval is thirty seconds.";

const old = await engine.invoke("CB_BETA", { op: "store", text: OLD });
await engine.invoke("CB_BETA", { op: "feedback", id: old.id, useful: true });
await engine.invoke("CB_BETA", { op: "feedback", id: old.id, useful: true });

const episodeOne = await engine.invoke("CB_BETA", { op: "episode", summary: "Reviewed the voice service." });
const episodeTwo = await engine.invoke("CB_BETA", { op: "episode", summary: "Measured the dashboard refresh." });

const dreamed = await engine.invoke("CB_BETA", {
  op: "dream",
  episodeIds: [episodeOne.id, episodeTwo.id],
  memories: [{ text: TWIN }, { text: FRESH }],
});

const betaRecords = memoriesOf("CB_BETA")();
const betaActive = betaRecords.filter((record) => typeof record.retiredAt !== "string");
const joined = betaRecords.find((record) => String(record.id) === String(old.id));

check("the dream returns a dreamId", typeof dreamed.dreamId === "string", JSON.stringify(dreamed));
check("2 memories stay ACTIVE (the twin was joined, the new one was added)", betaActive.length === 2,
  `active=${betaActive.length} ${JSON.stringify(betaActive.map((record) => record.text))}`);
check("the existing memory keeps its identity and its own text (the tie keeps the survivor)",
  joined?.id === old.id && joined?.text === OLD, JSON.stringify({ id: joined?.id, text: joined?.text }));
check("the score is the sum of both", joined?.score === 20, `score=${joined?.score}`);
check("the feedback is the sum of both", joined?.feedback?.useful === 2, JSON.stringify(joined?.feedback));

const absorbedTwin = betaRecords.find((record) => record.text === TWIN);
check("the twin retired pointing at the survivor",
  typeof absorbedTwin?.retiredAt === "string" && absorbedTwin?.meta?.absorbedInto === old.id,
  JSON.stringify(absorbedTwin?.meta));
check("the dream reports the reinforced memory", dreamed.reinforced?.includes(old.id) === true,
  JSON.stringify(dreamed.reinforced));
check("the dream reports only the genuinely new memory", dreamed.memories?.length === 1,
  JSON.stringify(dreamed.memories));
check("the unrelated memory was NOT joined", betaActive.some((record) => record.text === FRESH), "missing");

// The band between the two regimes: similar, not identical — the mechanical union must leave it alone
// (it belongs to the synthesis step, USER 2026-11-20).
await engine.invoke("CB_BETA", { op: "store", text: NEAR });
const band = await engine.invoke("CB_ALPHA", { op: "admin", action: "dedupe", args: { ns: "agent:CB_BETA" } });
check("a 0.94 pair is NOT taken by the mechanical union", (band.groups ?? []).length === 0,
  JSON.stringify(band.groups));

// ---------------------------------------------------------------------------
// 1b. The pair went to the queue the USER inspects after the dream
// ---------------------------------------------------------------------------
const queue = await engine.invoke("CB_ALPHA", { op: "admin", action: "dream-memories", args: {} });
check("the joined pair is waiting in dream_memories", queue.dreamMemories?.length === 1,
  JSON.stringify(queue.dreamMemories?.length));
check("the row carries BOTH original texts",
  queue.dreamMemories?.[0]?.survivorText === OLD && queue.dreamMemories?.[0]?.absorbedText === TWIN,
  JSON.stringify(queue.dreamMemories?.[0]));
check("the row carries the evidence (cosine and the ids)",
  typeof queue.dreamMemories?.[0]?.cosine === "number" &&
    queue.dreamMemories?.[0]?.survivorId === old.id &&
    queue.dreamMemories?.[0]?.absorbedId === absorbedTwin?.id,
  JSON.stringify(queue.dreamMemories?.[0]));
check("the row belongs to the agent space", queue.dreamMemories?.[0]?.namespace === "agent:CB_BETA",
  String(queue.dreamMemories?.[0]?.namespace));

const verdict = await engine.invoke("CB_ALPHA", {
  op: "admin",
  action: "dream-memory",
  args: { id: queue.dreamMemories?.[0]?.id, mergedText: "The voice service needs a display; the unit waits for the graphical session." },
});
check("the verdict settles the row", verdict.ok === true, JSON.stringify(verdict));

const afterVerdict = await engine.invoke("CB_ALPHA", {
  op: "admin", action: "dream-memories", args: { status: "all" },
});
check("the row is no longer pending", afterVerdict.dreamMemories?.[0]?.status === "processed",
  JSON.stringify(afterVerdict.dreamMemories?.[0]?.status));
check("the verdict keeps the merged text",
  typeof afterVerdict.dreamMemories?.[0]?.mergedText === "string", "no merged text");

const missingRow = await engine.invoke("CB_ALPHA", {
  op: "admin", action: "dream-memory", args: { id: "no-such-row", skipped: true },
}).then(() => null, (error) => String(error?.message ?? error));
check("an unknown row is refused", missingRow !== null && missingRow.includes("unknown row"), String(missingRow));

// ---------------------------------------------------------------------------
// 2. admin sweep — CB_ALPHA: dry-run, apply, idempotence
// ---------------------------------------------------------------------------
const RICH = "The Jarvis voice service needs a display, so the unit waits for the graphical session.";
// ≥0.97: only the trailing full stop differs, so the MECHANICAL union takes it (2026-11-20).
const POOR = "The Jarvis voice service needs a display, so the unit waits for the graphical session";
const DISTINCT = "The Ravenloft glossary lists seventeen terms from the campaign.";

const rich = await engine.invoke("CB_ALPHA", { op: "store", text: RICH });
const poor = await engine.invoke("CB_ALPHA", { op: "store", text: POOR });
await engine.invoke("CB_ALPHA", { op: "store", text: DISTINCT });
await engine.invoke("CB_ALPHA", { op: "feedback", id: rich.id, useful: true });
await engine.invoke("CB_ALPHA", { op: "feedback", id: poor.id, useful: false });

check("3 active records before the sweep", active().length === 3, `active=${active().length}`);

const dry = await engine.invoke("CB_ALPHA", { op: "admin", action: "dedupe", args: { ns: "agent:CB_ALPHA" } });
check("default dry-run finds 1 group", dry.groups?.length === 1, JSON.stringify(dry.groups));
check("the group is semantic (not equal text)", dry.groups?.[0]?.kind === "semantic", JSON.stringify(dry.groups?.[0]));
check("the group carries its cosine as evidence",
  typeof dry.groups?.[0]?.cosine === "number" && dry.groups[0].cosine >= 0.92,
  JSON.stringify(dry.groups?.[0]));
check("dry-run writes nothing", active().length === 3, `active=${active().length}`);

const applied = await engine.invoke("CB_ALPHA", {
  op: "admin", action: "dedupe", args: { apply: true, ns: "agent:CB_ALPHA" },
});
check("apply returns ok", applied.ok === true, JSON.stringify(applied));
check("2 active records remain", active().length === 2, `active=${active().length}`);

const survivor = active().find((record) => record.text.includes("Jarvis voice service"));
check("the survivor keeps the richest text", survivor?.text === RICH, JSON.stringify(survivor?.text));
check("the survivor has the summed feedback",
  survivor?.feedback?.useful === 1 && survivor?.feedback?.useless === 1,
  JSON.stringify(survivor?.feedback));

const retired = recordsOfAlpha().filter((record) => typeof record.retiredAt === "string");
check("1 retired record", retired.length === 1, `retired=${retired.length}`);
check("the retired one points at the survivor", retired[0]?.meta?.absorbedInto === survivor?.id,
  JSON.stringify(retired[0]?.meta));

const snapshot = JSON.stringify(recordsOfAlpha());
const again = await engine.invoke("CB_ALPHA", {
  op: "admin", action: "dedupe", args: { apply: true, ns: "agent:CB_ALPHA" },
});
check("the second pass finds no groups", again.groups?.length === 0, JSON.stringify(again.groups));
check("the second pass does not change the file", JSON.stringify(recordsOfAlpha()) === snapshot, "file changed");

// ---------------------------------------------------------------------------
// 3. mode "text": the old exact-text pass still collapses exact duplicates
// ---------------------------------------------------------------------------
await engine.invoke("CB_GAMMA", { op: "store", text: "Duplicate in Gamma." });
await engine.invoke("CB_GAMMA", { op: "store", text: "Duplicate in Gamma." });
const textOnly = await engine.invoke("CB_ALPHA", {
  op: "admin", action: "dedupe", args: { apply: true, mode: "text", ns: "agent:CB_GAMMA" },
});
check("mode text reports its group", textOnly.groups?.[0]?.kind === "text", JSON.stringify(textOnly.groups));
const gamma = memoriesOf("CB_GAMMA")();
check("mode text collapses the duplicates",
  gamma.filter((record) => typeof record.retiredAt !== "string").length === 1,
  `active=${gamma.filter((record) => typeof record.retiredAt !== "string").length}`);

// ---------------------------------------------------------------------------
// 4. minCosine moves the line; the default is strict
// ---------------------------------------------------------------------------
const RELATED_A = "The backup script copies the vault to the external drive every night.";
const RELATED_B = "The backup script copies the notes to the external disk each evening.";
const pairCosine = fixtureCosine(deterministicVector(RELATED_A), deterministicVector(RELATED_B));

await engine.invoke("CB_DELTA", { op: "store", text: RELATED_A });
await engine.invoke("CB_DELTA", { op: "store", text: RELATED_B });

check("fixture precondition: the pair sits between 0.4 and 0.92",
  pairCosine > 0.4 && pairCosine < 0.92, `cosine=${pairCosine}`);

const strict = await engine.invoke("CB_ALPHA", {
  op: "admin", action: "dedupe", args: { mode: "semantic", ns: "agent:CB_DELTA" },
});
check("the default threshold leaves a merely related pair alone", strict.groups?.length === 0,
  `cosine=${pairCosine} ${JSON.stringify(strict.groups)}`);

const above = await engine.invoke("CB_ALPHA", {
  op: "admin", action: "dedupe",
  args: { mode: "semantic", ns: "agent:CB_DELTA", minCosine: Math.min(0.999, pairCosine + 0.02) },
});
check("above the pair nothing groups", above.groups?.length === 0, JSON.stringify(above.groups));

const below = await engine.invoke("CB_ALPHA", {
  op: "admin", action: "dedupe",
  args: { mode: "semantic", ns: "agent:CB_DELTA", minCosine: Math.max(0, pairCosine - 0.02) },
});
check("below the pair it groups", below.groups?.length === 1, JSON.stringify(below.groups));
check("the group reports the weakest cosine it accepted",
  typeof below.groups?.[0]?.cosine === "number" && below.groups[0].cosine >= pairCosine - 0.02,
  JSON.stringify(below.groups?.[0]));

console.log(failures === 0 ? "DEDUPE SEMANTIC OK" : `DEDUPE SEMANTIC FAILED (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;
