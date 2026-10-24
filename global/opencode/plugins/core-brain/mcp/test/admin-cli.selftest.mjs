#!/usr/bin/env node
// Self-test for the operator CLI (mcp/admin-cli.js): proves maintenance still
// works OUTSIDE the MCP surface, after core_admin was removed from server.js.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "admin-cli.js");
const FIXTURE_DIR = join(HERE, "..", "..", "test", "fixtures");
const root = mkdtempSync(join(tmpdir(), "core-brain-admin-cli-selftest."));
const outside = join(root, "..", `outside-${process.pid}.json`);

let pass = 0;
let fail = 0;
const check = (ok, text) => {
  pass += ok ? 1 : 0;
  fail += ok ? 0 : 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${pass + fail} ${text}`);
};

function seed() {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, "global"), { recursive: true });
  mkdirSync(join(root, "agents", "victim"), { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(
    join(root, "global", "memories.json"),
    JSON.stringify(
      [{ id: "seed-g1", agent: "global", scope: "global", text: "CLI SEED global memory", meta: {}, createdAt: now, updatedAt: now, retrievals: 0 }],
      null, 2,
    ),
  );
  writeFileSync(
    join(root, "agents", "victim", "memories.json"),
    JSON.stringify(
      [{ id: "seed-v1", agent: "victim", scope: "agent", text: "CLI SEED victim memory", meta: {}, createdAt: now, updatedAt: now, retrievals: 0 }],
      null, 2,
    ),
  );
  writeFileSync(
    join(root, "config.json"),
    JSON.stringify({ agents: [{ name: "victim", hasGlobalAccess: false, private: true, inject: false }] }, null, 2),
  );
}

function run(...args) {
  return spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      CORE_BRAIN_HOME: root,
      CORE_BRAIN_EMBEDDER: "fixture",
      CORE_BRAIN_FIXTURE_DIR: FIXTURE_DIR,
    },
  });
}

try {
  seed();

  let r = run("reindex");
  check(r.status === 0 && r.stdout.includes('"action": "reindex"'), "reindex exits 0 and reports the action");

  const good = join(root, "exports", "dump.json");
  r = run("export", "--file", good);
  check(
    r.status === 0 && existsSync(good) && readFileSync(good, "utf8").includes("CLI SEED global memory"),
    "export inside the data root writes the document",
  );

  rmSync(outside, { force: true });
  r = run("export", "--file", outside);
  check(
    r.status === 1 && /must live inside the core-brain memory root/.test(r.stderr) && !existsSync(outside),
    "export outside the data root is refused and writes nothing",
  );

  const forged = join(root, "forged.json");
  writeFileSync(
    forged,
    JSON.stringify({
      version: 1,
      namespaces: [{
        ns: "global",
        records: [{ id: "forged-cli", agent: "global", scope: "global", text: "CLI FORGED record", meta: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), retrievals: 0 }],
        vectors: {},
      }],
    }, null, 2),
  );
  r = run("import", "--file", forged);
  check(
    r.status === 0 && readFileSync(join(root, "global", "memories.json"), "utf8").includes("forged-cli"),
    "import from inside the data root appends the record",
  );

  r = run("purge", "--ns", "agent:victim");
  check(
    r.status === 1 && /private/.test(r.stderr) && existsSync(join(root, "agents", "victim", "memories.json")),
    "purge of a private namespace without --force is refused",
  );

  r = run("purge", "--ns", "agent:victim", "--force");
  check(
    r.status === 0 && !existsSync(join(root, "agents", "victim", "memories.json")),
    "purge of a private namespace with --force removes memories.json",
  );

  r = run("purge", "--ns", "global");
  check(r.status === 0 && !existsSync(join(root, "global", "memories.json")), "purge of global removes memories.json");

  check(run("bogus").status === 2, "unknown action exits 2");
  check(run("export").status === 2, "export without --file exits 2");
  check(run("purge").status === 2, "purge without --ns exits 2");
} finally {
  rmSync(outside, { force: true });
  rmSync(root, { recursive: true, force: true });
}

console.log("");
console.log(`${pass}/${pass + fail} lines PASS`);
process.exit(fail === 0 ? 0 : 1);
