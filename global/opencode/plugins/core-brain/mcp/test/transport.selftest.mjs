#!/usr/bin/env node
// Layer-A transport self-test for the core-brain MCP server (spec §10).
// Spawns mcp/server.js, speaks newline-delimited JSON-RPC 2.0 and asserts the
// tool surface, the isolation refusal and the JSON-RPC error codes.
// Zero dependencies.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "server.js");
const root = mkdtempSync(join(tmpdir(), "core-brain-mcp-selftest."));
const exportedFile = join(root, "export.json");

let pass = 0;
let fail = 0;
const line = (ok, text) => {
  const n = pass + fail + 1;
  if (ok) { pass += 1; console.log(`PASS ${n} ${text}`); }
  else { fail += 1; console.log(`FAIL ${n} ${text}`); }
};

// D4: the child process is put on the deterministic offline fixture so it
// never downloads a model (the env route exists exactly for this child).
const FIXTURE_DIR = join(HERE, "..", "..", "test", "fixtures");
const child = spawn("node", [SERVER], {
  env: {
    ...process.env,
    CORE_BRAIN_HOME: root,
    CORE_BRAIN_EMBEDDER: process.env.CORE_BRAIN_EMBEDDER || "fixture",
    CORE_BRAIN_FIXTURE_DIR: FIXTURE_DIR,
  },
  stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
const queue = [];
child.stdout.on("data", (chunk) => {
  buffer += String(chunk);
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const raw = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (raw === "") continue;
    const waiter = queue.shift();
    if (waiter) waiter(JSON.parse(raw));
  }
});
const stderrChunks = [];
child.stderr.on("data", (chunk) => stderrChunks.push(String(chunk)));

let nextId = 0;
const request = (method, params) => {
  nextId += 1;
  const payload = { jsonrpc: "2.0", id: nextId, method, params: params ?? {} };
  const reply = new Promise((resolve) => queue.push(resolve));
  child.stdin.write(`${JSON.stringify(payload)}\n`);
  return reply;
};
const callTool = (name, args) => request("tools/call", { name, arguments: args ?? {} });
const resultText = (reply) => reply?.result?.content?.[0]?.text;

try {
  const init = await request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "cli", version: "2.0.21" },
  });
  line(init?.result?.protocolVersion === "2025-11-25", "initialize echoes the requested protocolVersion");
  line(init?.result?.serverInfo?.name === "core-brain", "initialize reports serverInfo.name = core-brain");
  line(init?.result?.capabilities?.tools !== undefined, "initialize advertises capabilities.tools");

  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const afterNotify = await request("tools/list", {});
  line(afterNotify?.id === 2 && afterNotify?.result !== undefined, "notifications/initialized produced no response");

  const tools = afterNotify?.result?.tools ?? [];
  const names = tools.map((tool) => tool.name).sort();
  line(
    JSON.stringify(names) === JSON.stringify(["core_admin", "core_doctor", "core_recall", "core_receipt", "core_status"]),
    `tools/list advertises exactly the five tools: ${names.join(", ")}`,
  );
  line(tools.every((tool) => tool.inputSchema?.type === "object" && tool.inputSchema?.additionalProperties === false), "every tool inputSchema is a closed object");

  // D3 — the async seam must NOT reorder responses: two requests written
  // back-to-back must answer in the order they were written.
  const pA = request("tools/call", { name: "core_status", arguments: {} });
  const pB = request("tools/call", { name: "core_status", arguments: {} });
  const [rA, rB] = await Promise.all([pA, pB]);
  line(
    rA?.id === 3 && rB?.id === 4,
    `two back-to-back requests answer in order (ids ${rA?.id}/${rB?.id}, expected 3/4)`,
  );

  const recallTool = tools.find((tool) => tool.name === "core_recall") ?? {};
  line(
    String(recallTool.description ?? "").includes("global namespace only — this is not an agent view; per-agent recall goes through the `core_memory` tool."),
    "core_recall description carries the verbatim isolation sentence",
  );

  const recall = await callTool("core_recall", { query: "x" });
  line(JSON.stringify(JSON.parse(resultText(recall)).scanned) === JSON.stringify(["global"]), "core_recall scans only the global namespace");

  const recallFrom = await callTool("core_recall", { from: "agent:CB_BETA" });
  line(recallFrom?.error?.code === -32602, "core_recall refuses the 'from' argument with -32602");

  const doctor = JSON.parse(resultText(await callTool("core_doctor", {})));
  const doctorIds = (doctor.checks ?? []).map((check) => check.id);
  line(
    JSON.stringify(doctorIds) === JSON.stringify(["config-rows", "embedder-dim", "store-writable", "vector-record-pairing", "vector-dimension"]),
    "core_doctor runs the five checks in order",
  );

  const status = JSON.parse(resultText(await callTool("core_status", {})));
  line(
    typeof status.storageRoot === "string" && typeof status.configPath === "string" && typeof status.embedder === "string" &&
      typeof status.dim === "number" && Array.isArray(status.namespaces) && typeof status.totals === "object",
    "core_status returns the documented counters shape",
  );
  line(!resultText(await callTool("core_status", {})).includes("text"), "core_status never returns memory text");

  const receipt = JSON.parse(resultText(await callTool("core_receipt", {})));
  line(
    typeof receipt.stored === "number" && typeof receipt.retrieved === "number" && typeof receipt.hits === "number" && Array.isArray(receipt.byNamespace),
    "core_receipt returns the documented counters shape",
  );

  const exported = JSON.parse(resultText(await callTool("core_admin", { action: "export", args: { file: exportedFile } })));
  line(exported.ok === true && existsSync(exportedFile), "core_admin export writes the caller-named file");

  line((await callTool("core_admin", { action: "bogus" }))?.error?.code === -32602, "unknown admin action is refused with -32602");
  line((await callTool("no_such_tool", {}))?.error?.code === -32602, "unknown tool is refused with -32602");
  line((await request("no/such/method", {}))?.error?.code === -32601, "unknown method is refused with -32601");
  child.stdin.write("this is not json\n");
  const parseError = await new Promise((resolve) => queue.push(resolve));
  line(parseError?.error?.code === -32700, "an unparsable line answers -32700");
} catch (error) {
  fail += 1;
  console.log(`FAIL probe crashed: ${error && error.message ? error.message : error}`);
} finally {
  child.kill();
  if (fail > 0) process.stderr.write(stderrChunks.join(""));
  rmSync(root, { recursive: true, force: true });
}

console.log("");
console.log(`${pass}/${pass + fail} lines PASS`);
process.exit(fail === 0 ? 0 : 1);
