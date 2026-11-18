// test/embedder-profile.selftest.mjs — choosing the embedding model without removing the old one.
//
// USER decision (2026-11-18): download another model, keep the current one installed, and rebuild
// the index. The store reads the choice from `CORE_BRAIN_EMBED_MODEL`; the default is unchanged
// (bge-small-en-v1.5), so an installation that says nothing keeps the exact behaviour it had.
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
check("sem env: modelo por omissão", base.id === BGE_SMALL_MODEL_ID, base.id);
check("sem env: dimensão 384", base.dim === 384, String(base.dim));

process.env.CORE_BRAIN_EMBED_MODEL = "multilingual-minilm";
const multi = createConfiguredEmbedder();
check("multilingual-minilm: id do modelo",
  multi.id === "Xenova/paraphrase-multilingual-MiniLM-L12-v2", multi.id);
check("multilingual-minilm: dimensão 384", multi.dim === 384, String(multi.dim));
check("perfis distintos não partilham id", multi.id !== base.id, "ids iguais");

process.env.CORE_BRAIN_EMBED_MODEL = "nao-existe";
let refused = null;
try {
  createConfiguredEmbedder();
} catch (error) {
  refused = String((error && error.message) || error);
}
check("perfil desconhecido é recusado", refused !== null, "não lançou erro");
check("o erro nomeia o perfil", String(refused).includes("nao-existe"), String(refused));

delete process.env.CORE_BRAIN_EMBED_MODEL;
console.log(failures === 0 ? "PROFILE OK" : `PROFILE FAILED (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;
