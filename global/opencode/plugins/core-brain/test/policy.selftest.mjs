// test/policy.selftest.mjs — the rules the Code Mode contract described, pinned as behaviour
// (USER, 2026-11-22: the code has to serve the purpose; when it does not, the TEST is what proves
// the expected behaviour — never a document that can be forgotten).
//
// 1. the memory ceiling is a REFUSAL at the boundary: exactly `memoryMaxChars` is accepted, one more
//    is refused, and the message names the limit AND how much has to go;
// 2. the same ceiling guards a dream (`dream-store`), not only `store`;
// 3. a dream (`real = 0`) is never a partner in the pair election, even with an identical text.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFixtureEmbedder, FIXTURE_DIR } from "./fixtures/embedder.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "corebrain-policy-"));
process.env.CORE_BRAIN_HOME = ROOT;
const CAP = 650;
writeFileSync(
  join(ROOT, "config.json"),
  JSON.stringify({
    dreams: true,
    memoryMaxChars: CAP,
    synthesisMinCosine: 0.9,
    synthesisWindowHours: 0,
    agents: [{ name: "CB_ALPHA", hasGlobalAccess: true, private: false }],
  }),
);

const { createEngine, InvalidConfigurationError } = await import("../store.ts");
const engine = createEngine({ embedder: createFixtureEmbedder({ dir: FIXTURE_DIR }) });

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

// 1. the boundary ------------------------------------------------------------
const atCap = "a".repeat(CAP);
const stored = await engine.invoke("CB_ALPHA", { op: "store", text: atCap });
check(`exactly ${CAP} characters is accepted`, Boolean(stored.id), JSON.stringify(stored).slice(0, 80));

let refused = "";
try {
  await engine.invoke("CB_ALPHA", { op: "store", text: "b".repeat(CAP + 1) });
} catch (error) {
  refused = String(error?.message ?? error);
}
check("one character more is refused", refused !== "", "aceitou");
check("the message names the limit", refused.includes(`the limit is ${CAP}`), refused.slice(0, 90));
check("the message says how much to cut", refused.includes("cut at least 1"), refused.slice(0, 120));

// 2. the same ceiling on a dream ---------------------------------------------
let dreamRefused = "";
try {
  await engine.invoke("SYSTEM", {
    op: "admin",
    action: "dream-store",
    args: { ns: "agent:CB_ALPHA", text: "c".repeat(CAP + 1), sourceIds: [] },
  });
} catch (error) {
  dreamRefused = String(error?.message ?? error);
}
check("a dream obeys the same ceiling", dreamRefused.includes(`the limit is ${CAP}`), dreamRefused.slice(0, 90));

// 3. a dream is never a partner ----------------------------------------------
const twin = "The parser walks the tokens in the order they appear in the file.";
const alive = await engine.invoke("CB_ALPHA", { op: "store", text: twin });
const dream = await engine.invoke("SYSTEM", {
  op: "admin",
  action: "dream-store",
  args: { ns: "agent:CB_ALPHA", text: twin, sourceIds: [] },
});
const dreamId = String(dream.detail ?? "").match(/dream ([0-9a-f-]{36})/)?.[1] ?? "";
const election = await engine.invoke("SYSTEM", {
  op: "admin",
  action: "synthesis-pairs",
  args: { sinceHours: 0, minCosine: 0.9, limit: 50 },
});
const members = (election.synthesisPairs ?? []).flatMap((group) => (group.members ?? []).map((m) => m.id));
check("the dream was written", dreamId !== "", String(dream.detail));
check(
  "a dream (real = 0) never enters a group — even with an identical text",
  !members.includes(dreamId),
  `eleito: ${dreamId}`,
);
check("the living memory stays eligible", members.includes(alive.id ?? alive.data?.id) || members.length === 0, JSON.stringify(members));

// the seam the old contract named: an invalid row still aborts the engine, by class
writeFileSync(join(ROOT, "bad.json"), JSON.stringify({ agents: [{ name: "CB_BAD", private: false, hasGlobalAccess: false }] }));
let seam = "";
try {
  createEngine({ configPath: join(ROOT, "bad.json"), embedder: createFixtureEmbedder({ dir: FIXTURE_DIR }) });
} catch (error) {
  seam = error instanceof InvalidConfigurationError ? `class:${error.code}` : String(error?.message ?? error);
}
check("an invalid config aborts, through the published class", seam.startsWith("class:"), seam.slice(0, 90));

console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
