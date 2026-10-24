#!/usr/bin/env node
// core-brain admin CLI — operator-only maintenance, deliberately OUTSIDE the
// MCP tool surface (see context-inject/ADMIN_CLI_HOWTO.md).
//
// A restricted agent (no bash) cannot reach this file; an agent with bash is
// already fully privileged, so the CLI adds no new capability for it. The
// security boundary is the ABSENCE of the tool, not the secrecy of the command.
//
// Usage:
//   node admin-cli.js <purge|reindex|export|import|compact> [options]
//     --ns <label>   target namespace (required for purge; optional filter for
//                    reindex/export/compact)
//     --file <path>  export/import document (must live inside the data root)
//     --force        purge a private agent namespace
//
// Exit codes: 0 ok, 1 engine error, 2 usage error.
import { createEngine } from "../store.ts";

const ACTIONS = new Set(["purge", "reindex", "export", "import", "compact"]);

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error(
    `usage: node admin-cli.js <${[...ACTIONS].join("|")}> ` +
      `[--ns <label>] [--file <path>] [--force]`,
  );
  process.exit(2);
}

function parseArgv(argv) {
  const [action, ...rest] = argv;
  if (!action || !ACTIONS.has(action)) usage(`unknown action '${action ?? ""}'`);

  const args = {};
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (flag === "--ns" || flag === "--file") {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith("--")) usage(`${flag} needs a value`);
      args[flag === "--ns" ? "ns" : "file"] = value;
      i += 1;
    } else if (flag === "--force") {
      args.force = true;
    } else {
      usage(`unknown flag '${flag}'`);
    }
  }

  if (action === "purge" && typeof args.ns !== "string") usage("purge needs --ns <label>");
  if ((action === "export" || action === "import") && typeof args.file !== "string") {
    usage(`${action} needs --file <path>`);
  }
  return { action, args };
}

const { action, args } = parseArgv(process.argv.slice(2));

let engine;
try {
  engine = createEngine();
} catch (error) {
  console.error(`ERROR: ${error?.message ?? error}`);
  process.exit(1);
}

try {
  const result = await engine.invoke("core-brain-admin", { op: "admin", action, args });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`ERROR: ${error?.message ?? error}`);
  process.exit(1);
}
