#!/usr/bin/env node
// test/fixtures/generate.mjs — writes the B4 committed fixture:
//   test/fixtures/vectors.bin   — N * dim * 4 bytes, little-endian float32
//   test/fixtures/manifest.json — { embedder, dim, revision, byteLength, entries[] }
//
// WHY A GENERATOR: the binary is 795,648 B at N=518/dim=384 and cannot be
// authored by hand. Run this once and commit the two outputs:
//
//   node global/opencode/plugins/core-brain/test/fixtures/generate.mjs
//   node global/opencode/plugins/core-brain/test/fixtures/generate.mjs --check
//
// `--check` verifies the on-disk size equals N*dim*4 and does not rewrite.
//
// Zero dependencies (node:* only). Deterministic: same inputs => identical bytes.

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIXTURE_BINARY_BYTES,
  FIXTURE_DIM,
  FIXTURE_EMBEDDER_ID,
  FIXTURE_REVISION,
  FIXTURE_VECTOR_COUNT,
  PROBE_TEXTS,
  deterministicVector,
  normalizeText,
  vectorKey,
} from "./embedder.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "vectors.bin");
const MANIFEST = join(HERE, "manifest.json");

const checkOnly = process.argv.includes("--check");

const texts = [
  ...Object.values(PROBE_TEXTS),
  ...Array.from(
    { length: Math.max(0, FIXTURE_VECTOR_COUNT - Object.keys(PROBE_TEXTS).length) },
    (_, i) => `cb-fixture-entry-${String(i).padStart(4, "0")}`,
  ),
];

if (texts.length !== FIXTURE_VECTOR_COUNT) {
  console.error(
    `generate.mjs: expected ${FIXTURE_VECTOR_COUNT} vectors, built ${texts.length}`,
  );
  process.exit(2);
}

const expectedBytes = FIXTURE_VECTOR_COUNT * FIXTURE_DIM * 4;

if (checkOnly) {
  let ok = false;
  let actual = -1;
  try {
    actual = statSync(BIN).size;
    ok = actual === expectedBytes;
  } catch (error) {
    console.error(`generate.mjs --check: cannot stat ${BIN}: ${error.message}`);
    process.exit(1);
  }
  console.log(`vectors.bin bytes=${actual} expected=${expectedBytes}`);
  console.log(`generate.mjs --check: ${ok ? "OK" : "MISMATCH"}`);
  process.exit(ok ? 0 : 1);
}

const buffer = Buffer.allocUnsafe(expectedBytes);
const entries = [];
let offset = 0;

for (const text of texts) {
  const vector = deterministicVector(text, FIXTURE_DIM);
  if (vector.length !== FIXTURE_DIM) {
    console.error(`generate.mjs: vector for ${JSON.stringify(text)} has ${vector.length} dims`);
    process.exit(2);
  }
  for (let i = 0; i < FIXTURE_DIM; i += 1) buffer.writeFloatLE(vector[i], offset + i * 4);
  entries.push({
    text,
    key: normalizeText(text),
    sha256: vectorKey(text),
    offset,
    length: FIXTURE_DIM * 4,
  });
  offset += FIXTURE_DIM * 4;
}

mkdirSync(HERE, { recursive: true });
writeFileSync(BIN, buffer);
writeFileSync(
  MANIFEST,
  `${JSON.stringify(
    {
      embedder: FIXTURE_EMBEDDER_ID,
      dim: FIXTURE_DIM,
      revision: FIXTURE_REVISION,
      byteLength: expectedBytes,
      entries,
    },
    null,
    2,
  )}\n`,
);

console.log(`vectors.bin bytes=${buffer.length} expected=${expectedBytes}`);
console.log(`manifest.json entries=${entries.length} dim=${FIXTURE_DIM} revision=${FIXTURE_REVISION}`);
console.log(
  buffer.length === FIXTURE_BINARY_BYTES
    ? "generate.mjs: OK (B4 size exact)"
    : "generate.mjs: FAILED (B4 size mismatch)",
);
process.exit(buffer.length === FIXTURE_BINARY_BYTES ? 0 : 1);
