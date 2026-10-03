# Fatia 2 — Core-Brain Automatic Layer — Plan

- **Slice:** Fatia 2 (A1–A4) of the core-brain migration.
- **Authority:** `docs/specs/core-brain-migration-plan.md` §3 (A1–A4) — the deliverables; `docs/specs/core-brain-v2.md` §8 — the order of work.
- **Code under change:** `global/opencode/plugins/core-brain/index.ts` (single source of truth for the plugin's runtime surface).
- **Status:** PLAN — not implemented. Every claim below carries the line it rests on; anything not measured is `UNKNOWN`/`[REQ]`.
- **Communication language of the flow:** PT. This document: EN.

> Rule of this document: **proof is the line that is IN THE FILE, at `file:line`.** No measured number, no assertion. Where the line does not exist yet, it is `UNKNOWN` and carries a `[REQ]` — never an invention.

---

## 1. Scope and hard rules

### 1.1 Scope

Fatia 2 turns the core-brain plugin's **inert** prompt hook — today it only records the session/agent for debug logging and never touches the prompt (`global/opencode/plugins/core-brain/index.ts:517-552`) — into the automatic memory layer, in four pieces:

- **A1 — automatic injection** of the core-brain block into the model's system context, **opt-in, OFF by default**.
- **A2 — automatic learning** from the USER prompt text, reading only; injection never travels through `prompt.text`.
- **A3 — compaction carry** of the block into the checkpoint transcript **plus** learning from the discarded messages.
- **A4 — closing ritual** — **`UNKNOWN`**: the plugin API's session-hook list is closed and documents no session-end hook. This plan does **not** invent one; it fixes the spike that measures it (§4.4).

**Out of scope:** any change to the `core_memory` tool contract, the engine's ranking, or the isolation model. Fatia 2 adds *triggers*; the read/write engine is reused as-is (`index.ts:452-494`).

### 1.2 Hard rules (non-negotiable)

1. **Opt-in, OFF by default.** An agent that does not opt in receives **nothing**. The opt-in is a **new, separate key** (working name `inject`) with default `false` — it is not a re-interpretation of `name/private/hasGlobalAccess` (`[REQ-1]`, §6).
2. **Identity never from the caller.** The agent is resolved through `ctx.session.get` (`index.ts:158-178`), exactly as the tool already does (`index.ts:473`).
3. **Injection never edits `prompt.text`.** The admission prompt is canonical; injection happens **only** by pushing into the context event's `system[]`, and the push is guarded by `Array.isArray(event?.system)` (precedent: `global/opencode/plugins/todo-list/index.ts:602-628`).
4. **The host's compaction summary is never taken over.** `event.result` is not set by us — the host keeps its summary (`[REQ-4]`, §6).
5. **Defensive envelope.** Every registration checks `typeof hook === "function"` inside `try/catch`, logs and degrades (pattern already in `index.ts:520-552`); every callback must be non-fatal (a hook must never break a session).
6. **Release what you register.** `setup` returns a disposer that disposes every registration (`index.ts:554-557`).
7. **Idempotent writes.** A2/A4 only *write memory* on a dedupe key `text + origin`; rollback is `forget` by `id` (op exists: `index.ts:333-361`). A1/A3 inject only — they are ephemeral and write nothing.
8. **Evidence or it did not happen.** Behaviour is proven by running the runtime; screens (where any) are proven by looking. A green suite is the floor.

---

## 2. Decisions (D1–Dn) — each with proof `file:line`

| # | Decision | Proof (`file:line`) |
|---|----------|---------------------|
| **D1** | All Fatia-2 hooks are registered inside the existing `setup(ctx)` of the single plugin definition, reusing the current envelope (`typeof hook === "function"` → `try/catch` → hold `Registration`) and disposed in the returned disposer. | `global/opencode/plugins/core-brain/index.ts:409-411` (definition + `setup`), `:520-552` (envelope), `:554-557` (dispose) |
| **D2 (A1)** | The injection hook is `hook("context")`; the block is injected with `event.system.push({ type: "text", text })`, **gated by the opt-in**; a non-listed agent pushes nothing. Guarded by `Array.isArray(event?.system)`. | Hook API: `tool_1035a5509001mq4HMis25Es10R` lines 1344, 1352-1357, 1586-1589. Precedent: `global/opencode/plugins/todo-list/index.ts:602-628` |
| **D3 (A2)** | The learning hook is `hook("prompt")`; it **reads** `event.prompt.text` to extract durable learnings and **never mutates it** (injection is A1's job). `event.agent` does not exist on this event → identity via `ctx.session.get`. | Hook API lines 1296-1336. Identity: `index.ts:158-178`. Precedent: `global/opencode/plugins/context-inject/index.ts:489` |
| **D4 (A3)** | The carry/learn hook is `hook("compaction")`: re-inject the block into the checkpoint's system context and learn from the discarded `event.messages`; **do not** set `event.result` (the host's summary stays). | Hook API lines 1345-1347, 1359-1361, 1591-1596. `[REQ-4]` for `system[]` mutability |
| **D5 (A4)** | The closing ritual hook is **`UNKNOWN`**. The session-hook list is closed — `prompt, context, compaction, generate, title, model.request, http.request, http.response, experimental.ws.*, retry` — with **no** session-end member. The plan fixes a **spike** against the server's `openapi.json`; no hook is named. | Hook API lines 1518-1531 |
| **D6 (config)** | The opt-in is a **new key** (working name `inject`, `boolean`, default `false`), separate from `name/private/hasGlobalAccess`, because the default policy refuses unknown keys. The `CB_*` test agents stay non-opted-in unless a test asks. | `[REQ-1]` — the exact validator line is not yet pinned (§6) |
| **D7 (idempotency)** | A2/A4 writes are deduped by `text + origin`; rollback is `forget` by `id`. A1/A3 write nothing. | `index.ts:333-361` (`forget` by id/query), `:224-287` (tool schema, ops) |

### 2.1 Decision notes

- **D2 gate placement.** The opt-in check happens **before** any recall call: a non-opted-in agent must not even pay the read cost. This is deliberate — isolation is a *no-op*, not a filtered result.
- **D3 vs D2 split.** A2 owns *learning* (write side) and A1 owns *injection* (read side). They are different hooks on purpose: the prompt event is admission-time (once per admission, synthetic/shell/compaction excluded — Hook API 1296-1336), while the context event runs every loop including tool continuations (Hook API 1352-1357). Conflating them would inject on admissions that are not model turns.
- **D4 marker.** The carried block must carry a stable marker token so the injected block is not duplicated when it is already in the live system context; the same marker is the dedupe anchor.
- **D7 anchor.** The dedupe key is not the raw text alone: the same sentence stated by two agents is two records. `origin` = `agent + source (prompt|compaction)`.

---

## 3. Files, in order

Order matters: config first (an unknown key must not be silently dropped), then the pure module, then the wiring, then proof.

1. **Engine config validator + loader** — allow the new key and read it.
   - Change: add the `inject` key to the accepted agent-policy schema, default `false`; expose it so the plugin can read the running agent's flag.
   - Path: `[REQ-1]` — locate via `createEngine` / `InvalidConfigurationError` (`index.ts:439-450`); the accepted-key set is `name/private/hasGlobalAccess` today.
   - Why first: registering hooks against a key the validator rejects would fail at init (`index.ts:444-449`).

2. **`global/opencode/plugins/core-brain/auto-layer.ts`** (proposed new module) — the pure, testable core. SRP: `index.ts` keeps wiring, this module keeps logic.
   - `composeContextBlock(recall, agent): string` — the injected text + its marker.
   - `extractLearnings(userText): Learning[]` — durable statements only; empty on ordinary chatter.
   - `dedupeKey(learning, origin): string` — `text + origin` anchor.
   - `shouldInject(event, optIn): boolean` — the single gate used by A1 and A3.
   - No I/O, no `ctx`: pure functions, unit-testable without the runtime.

3. **`global/opencode/plugins/core-brain/index.ts`** — wire the hooks.
   - Add: read the opt-in for the resolved agent; register `context` (A1) and `compaction` (A3) on the existing envelope; convert the inert `prompt` hook (A2) to learn-only; keep `prompt.text` untouched; return every registration's `dispose`.
   - Keep: the current prompt hook's `activeSessionID` fallback (`index.ts:531`) — the tool's second-arg path still depends on it (`index.ts:456`).
   - Evidence that must remain true after the change: `:517-519` comment becomes false and MUST be rewritten (it says "v1 has no injection path at all").

4. **Tests** — behaviour tests for the new hooks.
   - `auto-layer.ts` pure functions: unit tests (dedupe, extraction, gate).
   - Hook wiring: functional verification against the running runtime (see §5); the registration envelope itself is not meaningfully unit-testable.
   - Path: `[REQ-5]` — the plugin's test root is not pinned in this plan.

5. **`CHANGELOG.md`** — at delivery (permanent behaviour change), not in this plan.

---

## 4. Each deliverable and its gate

### 4.1 A1 — automatic injection (`context`)

- **Change:** register `hook("context", cb)`; `cb` resolves the agent, checks the opt-in, and on pass pushes the block: guarded `if (Array.isArray(event?.system)) event.system.push({ type: "text", text: block })`.
- **Gate (must hold):** (a) opted-in agent → the block is present exactly once in the model's system context; (b) non-opted-in agent → **zero** pushes, and no recall call is made; (c) identity in the block matches `ctx.session.get`, never the caller; (d) `prompt.text` is untouched.
- **Blocked by:** nothing beyond `[REQ-1]`.

### 4.2 A2 — learning from the USER prompt (`prompt`)

- **Change:** keep `hook("prompt", cb)`; the callback stores `activeSessionID` (existing), resolves the agent, and **reads** `event.prompt.text` to extract durable learnings, writing each through `engine.invoke(agent, {op:"store", ...})` on the dedupe key.
- **Gate (must hold):** (a) one durable statement → exactly one record, once; a repeated statement → still one (dedupe); (b) `prompt.text` is byte-identical before/after the hook (assert on the event object); (c) synthetic/shell/compaction admissions produce **no** learning (they do not fire this hook — Hook API 1296-1336); (d) a non-opted-in agent learns nothing.
- **Blocked by:** `[REQ-2]` (cost), `[REQ-1]`.

### 4.3 A3 — compaction carry + learn from the discarded (`compaction`)

- **Change:** register `hook("compaction", cb)`; `cb` re-injects the (marked) block into the checkpoint's system context and extracts learnings from `event.messages`; `event.result` is left untouched.
- **Gate (must hold):** (a) the block appears in the checkpoint transcript exactly once (marker dedupe); (b) learnings from discarded messages are persisted on the dedupe key; (c) the host's summary is byte-identical to what it would be — we did not set `event.result`; (d) non-opted-in agent → no carry, no learn.
- **Blocked by:** `[REQ-4]` — if the compaction event exposes no mutable `system[]`, the carry cannot use A1's mechanism and this deliverable must be re-planned (declared, not patched).

### 4.4 A4 — closing ritual (`UNKNOWN` → spike)

- **Change:** **none yet.** No hook is registered for A4.
- **Spike (the actual deliverable):** inspect the **running server's** `openapi.json` for any route or event denoting **session end/close**; if one exists, it becomes A4's trigger; if none exists, A4 is re-scoped to "no session-end signal available" and recorded as such.
- **Gate:** the spike is done when a written finding exists naming the OpenAPI path (or its absence), with the raw JSON excerpt as evidence. `UNKNOWN` until then — **no code**.
- **Blocked by:** `[REQ-3]` (the server URL/port of the OpenAPI document).

---

## 5. Acceptance criteria + the exact proving command (per deliverable)

Every AC below is proven by **running** the runtime. The debug log is `<dataRoot>/debug.log` — `resolveDataRoot`: `options.home` > `CORE_BRAIN_HOME` > `~/.core-brain` (`index.ts:180-190`), written by `debugLog` (`index.ts:420-431`), enabled by `DEBUG_ENV` (`index.ts:412-417`).

### AC-A1 (injection) — two runs, opposite expectations

```bash
# opted-in agent (the exact agent name comes from [REQ-1])
CORE_BRAIN_DEBUG=1 opencode run --agent <OPTED_IN_AGENT> "say ok"
grep -c "inject: session=.* agent=<OPTED_IN_AGENT> chars=[1-9]" ~/.core-brain/debug.log   # expect >= 1

CORE_BRAIN_DEBUG=1 opencode run --agent CB_ALPHA "say ok"
grep -c "inject: session=.* agent=CB_ALPHA chars=[1-9]" ~/.core-brain/debug.log         # expect == 0
```
Plus a by-hand assertion that `prompt.text` was not edited: the A2 AC below is the same evidence.

### AC-A2 (learning, read-only)

```bash
CORE_BRAIN_DEBUG=1 opencode run --agent <OPTED_IN_AGENT> "convention: always use pnpm"
grep -c "learn: stored .*origin=prompt" ~/.core-brain/debug.log   # expect == 1

# repeat the identical statement — dedupe must hold
CORE_BRAIN_DEBUG=1 opencode run --agent <OPTED_IN_AGENT> "convention: always use pnpm"
grep -c "learn: stored .*origin=prompt" ~/.core-brain/debug.log   # expect still == 1

# rollback proof
core_memory forget id=<ID>   # via a session; then recall must not find it
```

### AC-A3 (compaction) — requires the real runtime

```bash
CORE_BRAIN_DEBUG=1 opencode run --agent <OPTED_IN_AGENT> "<long session that triggers a checkpoint>"
grep -c "compaction hook: carried chars=[1-9]" ~/.core-brain/debug.log   # expect >= 1
grep -c "learn: stored .*origin=compaction"    ~/.core-brain/debug.log   # expect >= 1
```

- **Dependency:** forcing a real compaction needs a long enough session; the trigger threshold is the runtime's, not this plan's. `[REQ-6]`.
- The "host summary untouched" leg is proven by comparing the resulting summary with/without the plugin enabled — this is the strongest available evidence; it needs the runtime.

### AC-A4 (spike) — a finding, not a feature

```bash
curl -s <SERVER_URL>/openapi.json -o /tmp/openapi-fatia2.json     # [REQ-3] for the URL
jq -r '.paths | keys[]' /tmp/openapi-fatia2.json | grep -iE 'session.*(close|end|delete)|(close|end).*session'
```
- **AC:** the command's digest (or its empty result) is pasted into the finding; A4 stays `UNKNOWN` until that digest exists.

### AC-cross (no regression)

```bash
core_memory who        # policy still resolves, tool untouched
core_memory recall query="<known>"   # engine path untouched (index.ts:452-494)
```

---

## 6. Dependencies — what needs the real runtime

| Ref | Dependency | Why it cannot be closed statically |
|-----|-----------|------------------------------------|
| **REQ-1** | Exact validator line for the accepted agent keys (`name/private/hasGlobalAccess`) + how the plugin reads the flag | The schema is engine-side; the plugin only sees `createEngine`'s error surface (`index.ts:439-450`) |
| **REQ-2** | Per-turn cost of A2's embed | p50 4.0 ms was measured with **`mean`** pooling; the real adapter uses **`cls`** ⇒ estimate, not measurement |
| **REQ-3** | URL/port of the running server's `openapi.json` | Belongs to the runtime instance |
| **REQ-4** | Whether the `compaction` event exposes a mutable `system[]` | The doc fixes `messages`; it does not confirm `system` (Hook API 1345-1347, 1591-1596) |
| **REQ-5** | The plugin's test root | Not pinned in this plan |
| **REQ-6** | The compaction trigger threshold | Runtime behaviour |

**Runtime-only (cannot be unit-tested at all):** the hook registration envelope, `system.push` actually reaching the model, the opt-in read from config, A3's checkpoint, A4's spike, and every latency figure.

---

## 7. Risks and what is NOT proven

### 7.1 Risks

- **A1 prompt pollution.** Noisy recall pollutes every turn. Mitigation: opt-in default `false` + a size cap on the block + the marker so it is auditable.
- **A2 junk memory.** Learning from a USER turn can store pleasantries. Mitigation: `extractLearnings` returns `[]` unless the statement is durable; dedupe key `text + origin`.
- **A3 duplication / takeover.** Carrying the block could double it if the live system already has it; setting `event.result` would silently replace the host's summary. Mitigation: marker dedupe; `event.result` forbidden (rule 1.2.4).
- **Config key silently dropped.** Registering against a key the validator refuses fails at init. Mitigation: config first (§3.1); `[REQ-1]`.
- **A4 invented from impatience.** The closed hook list has no session-end member; any hook named without the spike is a fabrication. Mitigation: A4 is `UNKNOWN` and code-free.
- **Hook cost on every turn.** A1 fires every loop iteration; the opt-in check must run before the recall, or cost is paid by non-opted-in agents.

### 7.2 What is NOT proven (declared, not hidden)

- That injection **reaches the model** — proven only by AC-A1 in the real runtime.
- A2 latency with the real **`cls`** adapter (`[REQ-2]`).
- That the **`compaction` event's `system[]` is mutable** (`[REQ-4]`) — if not, A3 is re-planned.
- That a **session-end signal exists at all** (`[REQ-3]`) — A4 is `UNKNOWN`.
- The **compaction trigger threshold** (`[REQ-6]`).
- Any **visual/UI** claim: Fatia 2 touches no screen, so no visual pass applies — stated here so the absence is declared, not implied.
- **No implementation** is in scope of this document; this is the plan, and the gates above are what an implementation must satisfy before it is called done.
