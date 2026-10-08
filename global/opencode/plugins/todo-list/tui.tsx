// todo-list — OpenCode V2 plugin, TUI entry (spec §5.2): a live panel in the
// sidebar showing this session's list, below the MCP block.
//
// EMPIRICAL notes (spec §12 — confirmed on the first live test):
//  - Slot placement: `append: "sidebar.content"` should land below the MCP
//    block. Fallback (spec §12.3): `append: "sidebar.footer"`.
//  - Layout: the panel root is `<box flexShrink={0} flexGrow={0}>` and does
//    NOT participate in flex shrink (host sections use flexShrink:0 too).
//    The inner `<scrollbox>` was REMOVED after a live bug (2026-09-11): with
//    the list present, the MCP block above got squeezed and rendered garbled
//    ("eaten") in the sidebar. Bounded scrolling for long lists is a
//    follow-up iteration (re-add only with a safe maxHeight).
//  - JSX intrinsics: `box` / `text` are docs-verified; `strikethrough` was
//    verified in the host binary. `scrollbox` is registered but unsafe here
//    until its sizing behavior is settled.
//  - Reactivity: this panel POLLS the JSON store (our own file, not server
//    data — context.data events do not cover it). One refresh per second.
//
// Module shape: the TUI entry follows the official docs and imports
// `@opencode/plugin/tui` — the host resolves this import at runtime (docs:
// "OpenCode resolves this import at runtime, so local CLI plugins do not need
// an absolute path"). OpenTUI elements and solid-js are supplied by the host
// (spec Q11: no @opentui/* peers, no bundling).

import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { createSignal, For, onCleanup, Show } from "solid-js";
import { readList } from "./store.ts";
import { deriveNumbers, displayContent } from "./format.ts";
import type { TodoItem, TodoStatus } from "./types.ts";

const DOT = "•";

// Status colors read from the host theme (same source as the MCP dots),
// with hex fallbacks. done = completed only (USER decision).

const POLL_MS = 1000;

// The host fires the mouse event twice per physical click (measured in the
// click POC: twin log lines in the same millisecond) — ignore the echo.
const DEBOUNCE_MS = 50;

function TodoPanel(props: { sessionID?: string }) {
  const ctx = usePlugin();
  const [items, setItems] = createSignal<TodoItem[]>([]);
  // Visual-only collapse (no persistence — USER decision).
  const [collapsed, setCollapsed] = createSignal(false);
  let lastToggle = 0;

  const refresh = () => {
    const sessionID = props.sessionID;
    if (!sessionID) return;
    const list = readList(sessionID);
    setItems(list ? list.items : []);
  };
  refresh(); // immediate first paint, then poll
  const timer = setInterval(refresh, POLL_MS);
  onCleanup(() => clearInterval(timer));

  const themeText = (ctx?.theme as { text?: { default?: string; muted?: string } })
    ?.text;
  const headerFg = themeText?.muted ?? themeText?.default;
  const itemFg = themeText?.default;

  // Dot colors: exact MCP colors sampled by the USER (2026-10-08):
  // green 879a39 (done), red d14d41 (pending). Amber doing, muted cancelled.
  const feedback = (
    ctx?.theme as {
      text?: {
        feedback?: {
          warning?: { default?: string };
        };
      };
    }
  )?.text?.feedback;
  const itemFgFor = (item: TodoItem): string | undefined => {
    switch (item.status) {
      case "completed":
        return "#879a39";
      case "pending":
        return "#d14d41";
      case "in_progress":
        return feedback?.warning?.default ?? "#e0af68";
      case "cancelled":
        return themeText?.muted ?? "#565f89";
    }
  };

  // 0.2.1 — text attributes (host bitmask): ITALIC=4, STRIKETHROUGH=128.
  // ONLY cancelled is struck through (no italic — the Master's request: "it was
  // just to strike the cancelled ones"); completed go back to no attribute.
  const itemAttrsFor = (item: TodoItem): number | undefined =>
    item.status === "cancelled" ? 128 : undefined;

  // Empty list → section hidden (spec Q12). Numbering is derived (0.2).
  // Header: MCP-style triangle + (done/total); done = completed only.
  const numbers = () => deriveNumbers(items());
  const done = () => items().filter((i) => i.status === "completed").length;
  // Clickable header (host pattern: selectable={false} + onMouseUp LEFT —
  // onClick does not exist in the host; selectable text goes to terminal copy).
  const onHeaderMouseUp = (e: any) => {
    try {
      if (e && typeof e.button === "number" && e.button !== 0) return;
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
    } catch {
      // never break the panel on event-shape surprises
    }
    const now = Date.now();
    if (now - lastToggle < DEBOUNCE_MS) return; // host double-fire echo
    lastToggle = now;
    setCollapsed(!collapsed());
  };
  return (
    <Show when={items().length > 0}>
      <box flexShrink={0} flexGrow={0}>
        <box flexDirection="row" gap={1}>
          <text fg={itemFg} selectable={false} onMouseUp={onHeaderMouseUp}>
            {`${collapsed() ? "▶" : "▼"} TODOs`}
          </text>
          <text fg={headerFg} selectable={false} onMouseUp={onHeaderMouseUp}>
            {`(${done()}/${items().length})`}
          </text>
        </box>
        <Show when={!collapsed()}>
          <For each={items()}>
            {(item: TodoItem, index: () => number) => (
              <text
                fg={itemFgFor(item)}
                attributes={itemAttrsFor(item)}
              >
                {`${DOT} ${numbers()[index()]}) ${displayContent(item)}`}
              </text>
            )}
          </For>
        </Show>
      </box>
    </Show>
  );
}

export default Plugin.define({
  id: "oesc.todo-list",
  setup(context: {
    ui: {
      slot(input: {
        append: string;
        render: (input: { sessionID?: string }) => unknown;
      }): () => void;
    };
  }) {
    return context.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID }) => <TodoPanel sessionID={sessionID} />,
    });
  },
});
