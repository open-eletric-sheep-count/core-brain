// test/embedder-profile.selftest.mjs — choosing the embedding model without removing the old one.
//
// USER decision (2026-11-18): download another model, keep the current one installed, and rebuild
// the index. The store reads the choice from `CORE_BRAIN_EMBED_MODEL` (or `embedModel` in
// `config.json`); the default is unchanged (bge-small-en-v1.5), so an installation that says nothing
// keeps the exact behaviour it had.
//
// What is pinned:
//   1. with no env, the embedder is bge-small-en-v1.5, dim 384 (unchanged default);
//   2. `multilingual-minilm` selects Xenova/paraphrase-multilingual-MiniLM-L12-v2, dim 384;
//   3. an unknown profile is REFUSED with a named error (fail closed, never a silent fallback);
//   4. the two profiles have different ids, so an index built with one is stale for the other.

import { createConfiguredEmbedder, BGE_SMALL_MODEL_ID } from "../engine/embedder.ts";

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

delete process.env.CORE_BRAIN_EMBED_MODEL;
const base = createConfiguredEmbedder();
check("no env: default model", base.id === BGE_SMALL_MODEL_ID, base.id);
check("no env: dimension 384", base.dim === 384, String(base.dim));

process.env.CORE_BRAIN_EMBED_MODEL = "multilingual-minilm";
const multi = createConfiguredEmbedder();
check("multilingual-minilm: model id",
  multi.id === "Xenova/paraphrase-multilingual-MiniLM-L12-v2", multi.id);
check("multilingual-minilm: dimension 384", multi.dim === 384, String(multi.dim));
check("distinct profiles do not share an id", multi.id !== base.id, "same ids");

process.env.CORE_BRAIN_EMBED_MODEL = "does-not-exist";
let refused = null;
try {
  createConfiguredEmbedder();
} catch (error) {
  refused = String((error && error.message) || error);
}
check("an unknown profile is refused", refused !== null, "no error was thrown");
check("the error names the profile", String(refused).includes("does-not-exist"), String(refused));

delete process.env.CORE_BRAIN_EMBED_MODEL;
console.log(failures === 0 ? "PROFILE OK" : `PROFILE FAILED (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;
