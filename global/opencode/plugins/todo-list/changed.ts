/**
 * Which ops count as a change worth announcing.
 *
 * `read` never changes anything, and every failure in this plugin is reported as
 * a string starting with "ERROR" (see `execute`), so a successful mutation is
 * exactly: a mutating op whose output does not start with "ERROR".
 */
export const MUTATING_OPS = ["write", "add", "update", "remove", "clear"] as const;

export type MutatingOp = (typeof MUTATING_OPS)[number];

export function isChange(op: unknown, content: unknown): op is MutatingOp {
  if (typeof op !== "string") return false;
  if (!(MUTATING_OPS as readonly string[]).includes(op)) return false;
  return typeof content === "string" && !content.startsWith("ERROR");
}
