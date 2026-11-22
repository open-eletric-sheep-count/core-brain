// test/dreams-switch.selftest.mjs — the master switch (`dreams`), USER 2026-11-22.
//
// What is pinned here:
//   1. OFF is the default: a config without `dreams` (or with anything but `true`) dreams nothing;
//   2. with the switch off the listing still shows the episodes but says `dreamsEnabled: false`;
//   3. with the switch off the write is REFUSED and changes nothing — no memory, no dream record,
//      no `dreamedAt`, the episodes keep waiting;
//   4. `dream.sh now` and `dream.sh synthesize` refuse with exit 3 and the reason;
//   5. with `"dreams": true` everything works again (the same database, nothing rebuilt).

import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { createFixtureEmbedder, FIXTURE_DIR } from "./fixtures/embedder.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "corebrain-switch-"));
process.env.CORE_BRAIN_HOME = ROOT;
const CONFIG = join(ROOT, "config.json");
const DREAM_SH = new URL("../skills/dream/scripts/dream.sh", import.meta.url).pathname
  .replace("/plugins/core-brain/skills/", "/skills/");

const writeConfig = (dreams) => {
  const base = { dreamPerDay: 5, agents: [{ name: "CB_ALPHA", hasGlobalAccess: true, private: false }] };
  writeFileSync(CONFIG, JSON.stringify(dreams === undefined ? base : { ...base, dreams }));
};

// The first config has NO `dreams` key at all — the shipped default must be off.
writeConfig(undefined);

const { createEngine } = await import("../store.ts");
const engine = createEngine({ embedder: createFixtureEmbedder({ dir: FIXTURE_DIR }) });

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const readJson = (file, fallback = []) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback);
const EPISODES = join(ROOT, "agents", "CB_ALPHA", "episodes.json");
const DREAMS = join(ROOT, "agents", "CB_ALPHA", "dreams.json");
const waiting = () => readJson(EPISODES).filter((episode) => typeof episode.dreamedAt !== "string");

const one = await engine.invoke("CB_ALPHA", { op: "episode", summary: "Delivered the calculator." });
const two = await engine.invoke("CB_ALPHA", { op: "episode", summary: "Fixed the ffmpeg defect." });
const episodeIds = [one.id ?? one.data?.id, two.id ?? two.data?.id];

// --- 1 + 2: off, listing still honest -------------------------------------------------------
const listing = await engine.invoke("CB_ALPHA", { op: "dream" });
check("sem a chave, o sonho está OFF", listing.dreamsEnabled === false, String(listing.dreamsEnabled));
check("a listagem mostra os episódios à espera", (listing.episodes ?? []).length === 2, String((listing.episodes ?? []).length));

// --- 3: off, the write is refused and changes nothing ---------------------------------------
let refused = null;
try {
  await engine.invoke("CB_ALPHA", {
    op: "dream",
    episodeIds,
    memories: [{ text: "A refusal writes nothing at all." }],
    force: true,
  });
} catch (error) {
  refused = String(error?.message ?? error);
}
check("com dreams OFF o sonho é recusado", refused !== null && /dreaming is disabled/.test(refused), String(refused));
check("nada foi marcado: os dois episódios continuam à espera", waiting().length === 2, String(waiting().length));
check("nenhum registo de sonho foi criado", readJson(DREAMS).length === 0, String(readJson(DREAMS).length));

// --- 4: the script refuses too ---------------------------------------------------------------
for (const command of ["now", "synthesize"]) {
  const run = spawnSync("bash", [DREAM_SH, command], { env: { ...process.env, CORE_BRAIN_HOME: ROOT }, encoding: "utf8" });
  const said = `${run.stdout}${run.stderr}`;
  check(`dream.sh ${command} recusa com exit 3`, run.status === 3 && /dreaming is disabled/.test(said), `status ${run.status}: ${said.trim().slice(0, 120)}`);
}

// --- 5: on, everything works -----------------------------------------------------------------
writeConfig(true);
const listingOn = await engine.invoke("CB_ALPHA", { op: "dream" });
check("com dreams ON a listagem diz que está ligado", listingOn.dreamsEnabled === true, String(listingOn.dreamsEnabled));

const dreamed = await engine.invoke("CB_ALPHA", {
  op: "dream",
  episodeIds,
  memories: [{ text: "The dream switch is a config key named dreams." }],
  force: true,
});
check("com dreams ON o sonho escreve", Boolean(dreamed.dreamId), JSON.stringify(dreamed).slice(0, 160));
check("os episódios ficaram marcados", waiting().length === 0, String(waiting().length));

console.log(failures === 0 ? "TODOS OS CHECKS PASSARAM" : `${failures} CHECK(S) FALHARAM`);
process.exit(failures === 0 ? 0 : 1);
