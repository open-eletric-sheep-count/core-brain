// format.ts — display & structure helpers shared by the tool dump and the TUI
// panel (0.2): the hierarchical numbering ("1", "1.1", "1.2", "2"…) is DERIVED
// from item order + `depth` — never stored, never written by the agent.
// Legacy text prefixes ("1)", "1.1)") are tolerated: stripped on input (with
// depth inference) and on display (numbered output would double otherwise).

import type { TodoItem } from "./types.ts";

/** Strips a leading hierarchical enumeration ("1)", "1.1)", "1.1.2)") from
 * item text and returns the inferred depth (dots count). */
export function stripEnumeration(text: string): { text: string; depth?: number } {
  const match = /^\s*(\d+(?:\.\d+)*)\)\s*/.exec(text);
  if (!match) return { text };
  const depth = match[1].split(".").length - 1;
  return { text: text.slice(match[0].length), depth };
}

/** Text as displayed: leading legacy enumerations removed (numbering is
 * generated); falls back to the stored text when stripping empties it. */
export function displayContent(item: TodoItem): string {
  return stripEnumeration(item.content).text || item.content;
}

/** Depth normalized to a non-negative integer (0 when absent/invalid). */
export function normalizeDepth(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

/** Clamps `items[index].depth` so a level never jumps more than one step
 * below its predecessor (callers process left→right). Mutates the item and
 * reports the clamp in `issues`. */
export function clampDepthAt(
  items: TodoItem[],
  index: number,
  issues: string[],
): void {
  const item = items[index];
  if (!item) return;
  const wanted = normalizeDepth(item.depth);
  const max = index > 0 ? normalizeDepth(items[index - 1]?.depth) + 1 : 0;
  if (wanted > max) {
    issues.push(
      `id ${item.id}: depth ${wanted} invalid at this position (max ${max}) — used ${max}`,
    );
    item.depth = max;
  } else {
    item.depth = wanted;
  }
}

/** Hierarchical numbers derived from order + depth (display-side sanitizing:
 * depth can never exceed previous + 1, so the counters never have "holes"). */
export function deriveNumbers(items: TodoItem[]): string[] {
  const out: string[] = [];
  const counters: number[] = [];
  let prev = -1;
  for (const item of items) {
    const depth = Math.min(normalizeDepth(item.depth), prev + 1);
    counters.length = depth + 1;
    counters[depth] = (counters[depth] ?? 0) + 1;
    out.push(counters.join("."));
    prev = depth;
  }
  return out;
}
