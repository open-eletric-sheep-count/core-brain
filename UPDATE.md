# UPDATE — from 1.1 to 1.2 (the JSON store became a database)

**This file is for one case only: an install that is on 1.1.** The version number was introduced in
1.2; **1.1 has no `VERSION` file at all.** So:

| what you see | meaning | what to do |
|---|---|---|
| `VERSION` says `1.2.0` (or higher) | already migrated or installed fresh | **nothing** — do not run this |
| no `VERSION` file, and `agents/*/memories.json` exists | it is a **1.1** install | follow §2 below |
| no `VERSION` file, and no `memories.json` | a fresh install that predates the file | reinstall 1.2 |

```bash
cat ~/.config/opencode/plugins/core-brain/VERSION   # 1.2.0 → you are done
```

## 1. What 1.2 changed

| 1.1 | 1.2 |
|---|---|
| `agents/<AGENT>/memories.json`, `global/memories.json` | one SQLite file: `<data root>/memory.db` |
| `vectors/<space>/index.json` (+ per-memory vectors) | `memory.db` → table `vectors` (BLOB, one row per memory) |
| the word search read the JSON | `memories_fts` (FTS5: `memory_id`, `text`, `unicode61 remove_diacritics 2`) |
| retired rows stayed in the memory file | `memories_history` (same columns + `archived_at`) |
| — | `dreams` and `dream_memories` (the pass log, and the pairs a dream joined) |
| ranking ties came from a `retrievals` counter | `score`: starts at **10**, +1 per recall, −1 per dream, retired at 0 |
| every memory was "real" | `real`: **1** = lived, **0** = dreamed (a dream never becomes another dream's source) |

`episodes.json` and `dreams.json` **stay JSON** — for those two the files are still the live store.

## 2. What the agent must do (in this order)

1. **Read the version.**

   ```bash
   cat ~/.config/opencode/plugins/core-brain/VERSION
   ```

   `1.2.0` or higher → **stop here**. Nothing else in this file applies.

2. **Confirm it is a 1.1 install.**

   ```bash
   ls ~/.config/core-brain/agents/*/memories.json ~/.config/core-brain/global/memories.json
   ls ~/.config/core-brain/memory.db        # must NOT exist yet
   ```

   Both JSON files present and no `memory.db` → it is 1.1, go on.

3. **Make sure the JSON backend is not being forced.** If `CORE_BRAIN_STORE=json` is exported
   anywhere (shell profile, service unit, plugin config), unset it — 1.2 has to run on the database
   for the migration to happen.

4. **Install the 1.2 code** (do not delete the data root first):

   ```bash
   bash install.sh --host opencode --dry-run
   bash install.sh --host opencode
   ```

   The installer only replaces code; `~/.config/core-brain` is the data and is left alone.

5. **Let the store migrate itself.** There is nothing to run by hand. The **first** call that touches
   the store creates `memory.db`, copies everything in, and logs two lines:

   ```
   [core-brain][store] seeded <N> memories and <M> vectors from JSON
   [core-brain][store] moved <K> JSON file(s) to legacy/
   ```

   What the migrated rows get: `score` = **10** (the birth value), `real` = **1**, `retired_at` = NULL
   (a row retired in 1.1 keeps its `retiredAt`), `meta` copied verbatim, one `vectors` row and one
   `memories_fts` row per memory.

6. **The JSON store leaves the live data root.** `memories.json` (per space) and the whole `vectors/`
   tree are **moved**, not copied, to `<data root>/legacy/` — same bytes, same paths underneath:

   ```
   ~/.config/core-brain/legacy/agents/<AGENT>/memories.json
   ~/.config/core-brain/legacy/global/memories.json
   ~/.config/core-brain/legacy/vectors/…
   ```

   `episodes.json` and `dreams.json` stay where they were: they are still the live store for those.

7. **Verify.**

   ```bash
   sqlite3 ~/.config/core-brain/memory.db \
     "select 'memories', count(*) from memories
      union all select 'vectors', count(*) from vectors
      union all select 'fts', count(*) from memories_fts;"
   ```

   The three numbers must match how many memories 1.1 held. Then one functional check: a `recall`
   for a phrase you know is stored must return it.

8. **Report** the version read, the three counts, and the `legacy/` path. Nothing else changed for the
   user's data.

## 3. New settings in 1.2 (absent keys take the default, so an old config keeps working)

| key | default | meaning |
|---|---|---|
| `memoryMaxChars` | `650` | ceiling for one memory's text (1.1 hard-coded 600) |
| `dreams` | `false` | master switch of the dream pass — experimental, spends tokens |
| `dreamPerDay` | `1` | passes per day |
| `dreamIdleHours` | `4` | rest required before an automatic pass |
| `dreamEpisodesPerPass` | `5` | episodes one pass may read |
| `dream.model` | `{}` | model of the dream's session; `{}` = the OpenCode default |
| `synthesisMinCosine` | `0.9` | floor of the synthesis band (0.97+ is the mechanical union) |
| `synthesisWindowHours` | `48` | only one side of a pair must be younger than this |
| `embedModel` | `multilingual-minilm` | encoder behind the vector leg — **changing it requires a reindex** |
| `memoriesPerContext` | `5` | memories the automatic block carries per half |

## 4. If the seeding does not happen

- **`memory.db` exists but is empty** — the store did not find the JSON files; check the data root
  (`~/.config/core-brain`, or `CORE_BRAIN_HOME`, or `--memory-home` used at install).
- **A space was skipped** — its `memories.json` had no readable `records` array. Fix the file, delete
  `memory.db` (see §5) and let it seed again.
- **`CORE_BRAIN_STORE=json` still set** — the engine is running the old backend on purpose.

## 5. Rollback (only while `legacy/` still exists)

```bash
rm  ~/.config/core-brain/memory.db ~/.config/core-brain/memory.db-wal ~/.config/core-brain/memory.db-shm
mv  ~/.config/core-brain/legacy/agents  ~/.config/core-brain/agents.back 2>/dev/null || true
cp -a ~/.config/core-brain/legacy/agents/. ~/.config/core-brain/agents/
cp -a ~/.config/core-brain/legacy/global/memories.json ~/.config/core-brain/global/memories.json
cp -a ~/.config/core-brain/legacy/vectors ~/.config/core-brain/vectors
export CORE_BRAIN_STORE=json
```

Then run the 1.1 code. Nothing else has to be undone: the migration never edits the JSON files — it
only moves them, which is why the bytes survive.

## 6. What NOT to do

- Do **not** edit `memory.db` by hand: the store owns the schema and applies its own upgrades when it
  opens the file. A hand edit skips those invariants.
- Do **not** delete `legacy/` before a `recall` returns what you expect from the database.
- Do **not** copy a `memory.db` from another machine: its vectors belong to that machine's
  `embedModel`.
