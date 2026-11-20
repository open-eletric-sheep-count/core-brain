// test/embedder-profile.selftest.mjs — choosing the embedding model without removing the old one.
//
// USER decision (2026-11-18): download another model, keep the current one installed, and rebuild
// the index. The store reads the choice from `CORE_BRAIN_EMBED_MODEL` (or `embedModel` in
// `config.json`).
// USER decision (2026-11-20): the DEFAULT is now the multilingual model — the corpus is Portuguese,
// and an English-trained default reads it as foreign text. `bge-small-en` stays installed and
// selectable, so nothing is removed: only what silence means changed.
//
// What is pinned:
//   1. with no env, the embedder is the multilingual model, dim 384 (the new default);
//   2. `bge-small-en` still selects the old model, dim 384;
//   3. an unknown profile is REFUSED with a named error (fail closed, never a silent fallback);
//   4. the two profiles have different ids, so an index built with one is stale for the other.

import {
  activeProfileName,
  createConfiguredEmbedder,
  BGE_SMALL_MODEL_ID,
  DEFAULT_EMBED_PROFILE,
} from "../engine/embedder.ts";

const MULTILINGUAL_MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

delete process.env.CORE_BRAIN_EMBED_MODEL;
const base = createConfiguredEmbedder();
check("no env: the default profile is multilingual", DEFAULT_EMBED_PROFILE === "multilingual-minilm",
  DEFAULT_EMBED_PROFILE);
check("no env: default model", base.id === MULTILINGUAL_MODEL_ID, base.id);
check("no env: dimension 384", base.dim === 384, String(base.dim));
check("no env: the resolver reports the same name", activeProfileName() === DEFAULT_EMBED_PROFILE,
  activeProfileName());

process.env.CORE_BRAIN_EMBED_MODEL = "bge-small-en";
const legacy = createConfiguredEmbedder();
check("bge-small-en: the old model is still selectable", legacy.id === BGE_SMALL_MODEL_ID, legacy.id);
check("bge-small-en: dimension 384", legacy.dim === 384, String(legacy.dim));

process.env.CORE_BRAIN_EMBED_MODEL = "multilingual-minilm";
const multi = createConfiguredEmbedder();
check("multilingual-minilm: model id", multi.id === MULTILINGUAL_MODEL_ID, multi.id);
check("multilingual-minilm: dimension 384", multi.dim === 384, String(multi.dim));
check("distinct profiles do not share an id", multi.id !== legacy.id, "same ids");

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
