import test from "node:test";
import assert from "node:assert/strict";

import { MUTATING_OPS, isChange } from "../changed.ts";
import { RPC_ID, TODO_RPC_DEFINITION } from "../rpc.ts";

test("a successful mutation is a change", () => {
  for (const op of MUTATING_OPS) {
    assert.equal(isChange(op, "TODO: 3 items"), true, op);
  }
});

test("reading is never a change, whatever the output", () => {
  assert.equal(isChange("read", "TODO: 3 items"), false);
});

test("a failed write is not announced", () => {
  assert.equal(isChange("write", "ERROR: todo write failed: boom"), false);
  assert.equal(isChange("add", "ERROR: unknown op"), false);
});

test("an unknown or missing op is not announced", () => {
  assert.equal(isChange(undefined, "TODO: 1 item"), false);
  assert.equal(isChange("nuke", "TODO: 1 item"), false);
});

test("the announced event carries only the session id", () => {
  const event = TODO_RPC_DEFINITION.events.changed;
  assert.deepEqual(Object.keys(event.schema.properties), ["sessionID"]);
  assert.deepEqual(event.schema.required, ["sessionID"]);
  assert.equal(RPC_ID, "todo");
});
