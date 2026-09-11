# TODO TOOL — HOW TO

This session has a live todo list: the `todo` tool maintains it and the user
watches it in the sidebar panel "Todos" (below the MCP block). Keep it current.

## When
- Multi-step or long work: add items BEFORE starting, then update as you go.
- Progress honestly: pending / in_progress / completed / cancelled; clear the
  list when the work is done.
- Task accepted (finish-task): ASK the user whether to remove the list
  (`clear`) — never clear without asking.

## How (single tool `todo`, field `op`)
- `add` — append items, or insert with `after: <id>` (right after that item);
  stable integer ids are assigned and reported.
- `update` — change content/status/priority/depth by `id`.
- `remove` — delete by `id`; `read` — dump; `clear` — delete the whole list;
  `write` — replace the whole list.
- Status: pending `[ ]` · in_progress `[~]` · completed `[x]` (struck) ·
  cancelled `[!]` (struck). Priority: high | medium | low.
- Ids are stable and never reused — always reuse the ids from previous calls.

## Structure & numbering
- Before adding a NEW item, check the existing list for a fitting parent: if
  the item is a sub-step, nest it (add with `after: <parent id>` and
  `depth: <parent depth + 1>`) instead of creating another root item.
- Set `depth` (0 = top, 1 = child, …) to nest; do NOT write numbers like `1)`
  in the content — the numbering (1, 1.1, 1.1.1…) is generated automatically
  and renumbers itself on insert/remove.
- A level never jumps more than one step below the previous item; invalid
  jumps are clamped and reported as issues.

## Write for the user
- Item texts are READ BY THE USER in the panel: plain, friendly language —
  no internal jargon or agent shorthand (prefer "Insert a step between two
  existing ones" over "tool: add + after").
- Keep items short. Do not paste the list into chat (the user sees the panel);
  while the list is non-empty a one-line `TODO: …` reminder is injected.
