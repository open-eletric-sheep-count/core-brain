// order.ts — the OpenCode plugin's view of the ordering law.
//
// The law itself lives in ONE place: `lib/todo-laws.mts`, shared with the Orca todo
// plugin (which vendors the generated `lib/todo-laws.mjs`). This file keeps the
// plugin's public surface — `index.ts` imports from here — and adds nothing: any rule
// that changes must change in the library, so the two plugins can never drift.
//
// TypeScript resolves the `./lib/todo-laws.mjs` import to its `.mts` source, so `tsc`
// checks the real file; Node loads the emitted `.mjs` (built by `lib/build.sh`).

export {
  isClosedStatus,
  deriveNumbers,
  findOrderingViolations,
  formatOrderingRejection,
} from "./lib/todo-laws.mjs";
