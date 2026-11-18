// test/promote-dedup.selftest.mjs — a duplicate `promote` must not create a second memory.
//
// USER decision (2026-11-18): "the original stays, the new one may not be created" (translated).
// Promoting an episode whose conclusion is already an ACTIVE memory of the caller is REFUSED with
// an error — not silently duplicated, not silently merged.
//
// Rule under test: in the caller's own namespace, if an ACTIVE record has the same NORMALISED text
// (trimmed, whitespace collapsed, case folded), `promote` throws and writes nothing: no record, no
// vector, no `engramIds` entry. A retired record is not a duplicate — retiring means "not in use",
// so the conclusion may be promoted again.
//
// Fixture embedder: deterministic, no model download.

import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFixtureEmbedder, FIXTURE_DIR } from "./fixtures/embedder.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "corebrain-dedup-"));
process.env.CORE_BRAIN_HOME = ROOT;
writeFileSync(
  join(ROOT, "config.json"),
  JSON.stringify({ agents: [{ name: "CB_ALPHA", hasGlobalAccess: true, private: false }] }),
);

const { createEngine } = await import("../store.ts");
const engine = createEngine({ embedder: createFixtureEmbedder({ dir: FIXTURE_DIR }) });

// Guard: never touch the real store. If the disposable home is not the one in use, stop here.
const policy = await engine.invoke("CB_ALPHA", { op: "who" });
if (policy.dataDir !== ROOT) {
  console.error(`COREBRAIN_DEDUP: refusing to run against ${policy.dataDir} (expected ${ROOT})`);
  process.exit(2);
}

const MEMORIES = join(ROOT, "agents", "CB_ALPHA", "memories.json");
const EPISODES = join(ROOT, "agents", "CB_ALPHA", "episodes.json");
const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : []);
const memories = () => {
  const data = readJson(MEMORIES);
  return Array.isArray(data) ? data : data.records;
};
const activeMemories = () => memories().filter((record) => typeof record.retiredAt !== "string");

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

// ---------------------------------------------------------------------------
// Arrange: two episodes, one conclusion
// ---------------------------------------------------------------------------
const CONCLUSIONS = "The Jarvis key lives in ~/.config/jarvis-client/config.json.";

const firstEpisode = await engine.invoke("CB_ALPHA", {
  op: "episode",
  summary: "Found where the Jarvis key lives.",
});
const secondEpisode = await engine.invoke("CB_ALPHA", {
  op: "episode",
  summary: "The same discovery was repeated in a later session.",
});

// ---------------------------------------------------------------------------
// 1. The first promote works and creates exactly one memory
// ---------------------------------------------------------------------------
const first = await engine.invoke("CB_ALPHA", {
  op: "promote",
  episodeId: firstEpisode.id,
  text: CONCLUSIONS,
});
check("first promote returns a memoryId", typeof first.memoryId === "string", JSON.stringify(first));
check("one active record after the first promote", activeMemories().length === 1, `active=${activeMemories().length}`);

// ---------------------------------------------------------------------------
// 2. The SAME episode, same text ⇒ refused, nothing written
// ---------------------------------------------------------------------------
let secondError = null;
try {
  await engine.invoke("CB_ALPHA", { op: "promote", episodeId: firstEpisode.id, text: CONCLUSIONS });
} catch (error) {
  secondError = String((error && error.message) || error);
}
check("second promote of the SAME episode is refused", secondError !== null, "no error was thrown");
check("nothing was written (1 active record)", activeMemories().length === 1, `active=${activeMemories().length}`);

const firstEpisodeAfter = readJson(EPISODES).find((episode) => episode.id === firstEpisode.id);
check(
  "engramIds did not grow",
  Array.isArray(firstEpisodeAfter?.engramIds) && firstEpisodeAfter.engramIds.length === 1,
  JSON.stringify(firstEpisodeAfter?.engramIds),
);

// ---------------------------------------------------------------------------
// 3. Same text from ANOTHER episode ⇒ also refused (the conclusion already exists)
// ---------------------------------------------------------------------------
let otherError = null;
try {
  await engine.invoke("CB_ALPHA", { op: "promote", episodeId: secondEpisode.id, text: `  ${CONCLUSIONS}  ` });
} catch (error) {
  otherError = String((error && error.message) || error);
}
check("same text from another episode is refused", otherError !== null, "no error was thrown");
check("still exactly 1 active record", activeMemories().length === 1, `active=${activeMemories().length}`);

// ---------------------------------------------------------------------------
// 4. A DIFFERENT conclusion is not blocked
// ---------------------------------------------------------------------------
const different = await engine.invoke("CB_ALPHA", {
  op: "promote",
  episodeId: secondEpisode.id,
  text: "The Ravenloft glossary has 17 terms.",
});
check("a different text goes through", typeof different.memoryId === "string", JSON.stringify(different));
check("now there are 2 active records", activeMemories().length === 2, `active=${activeMemories().length}`);

// ---------------------------------------------------------------------------
// 5. Retiring the first memory frees the text again
// ---------------------------------------------------------------------------
await engine.invoke("CB_ALPHA", { op: "forget", id: first.memoryId });
let afterForgetError = null;
try {
  await engine.invoke("CB_ALPHA", { op: "promote", episodeId: firstEpisode.id, text: CONCLUSIONS });
} catch (error) {
  afterForgetError = String((error && error.message) || error);
}
check("a retired text can be promoted again", afterForgetError === null, afterForgetError);
check("back to 2 active records", activeMemories().length === 2, `active=${activeMemories().length}`);

console.log(failures === 0 ? "DEDUP OK" : `DEDUP FAILED (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;
