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

const GLYPH: Record<TodoStatus, string> = {
  pending: "[ ]",
  in_progress: "[~]",
  completed: "[x]",
  cancelled: "[!]",
};

const POLL_MS = 1000;

function TodoPanel(props: { sessionID?: string }) {
  const ctx = usePlugin();
  const [items, setItems] = createSignal<TodoItem[]>([]);

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

  // 0.2.1 — cores por estado: "em andamento" em âmbar (destaque) e "cancelado"
  // apagado/acinzentado. Empírico: hex direto; ajuste fino após o teste visual.
  const itemFgFor = (item: TodoItem): string | undefined =>
    item.status === "in_progress"
      ? "#e0af68"
      : item.status === "cancelled"
        ? (themeText?.muted ?? "#565f89")
        : itemFg;

  // 0.2.1 — atributos de texto (bitmask do host): ITALIC=4, STRIKETHROUGH=128.
  // SÓ o cancelado é riscado (sem itálico — pedido do Master: "era só pra
  // riscar os cancelados"); concluídos voltam a ficar sem atributo.
  const itemAttrsFor = (item: TodoItem): number | undefined =>
    item.status === "cancelled" ? 128 : undefined;

  // Empty list → section hidden (spec Q12). Numbering is derived (0.2).
  const numbers = () => deriveNumbers(items());
  return (
    <Show when={items().length > 0}>
      <box flexShrink={0} flexGrow={0}>
        <text fg={headerFg}>Todos ({items().length})</text>
        <For each={items()}>
          {(item: TodoItem, index: () => number) => (
            <text
              fg={itemFgFor(item)}
              attributes={itemAttrsFor(item)}
            >
              {`${GLYPH[item.status]} ${numbers()[index()]}) ${displayContent(item)}`}
            </text>
          )}
        </For>
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
