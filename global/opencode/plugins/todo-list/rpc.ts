/**
 * The one thing this plugin announces to the outside world: "a todo list changed".
 *
 * Design rule (DIP): the event says WHAT changed and nothing about WHERE anyone
 * cares. The core-brain plugin must never learn about Orca, a personal vault, or
 * any other consumer — a listener subscribes and decides what to do with it.
 *
 * Loading is defensive on purpose: `@opencode/plugin/rpc` is a runtime module and
 * an optional capability. If it is missing, the todo tool must keep working and
 * only the announcement is lost — never the plugin.
 */

export const RPC_ID = "todo";

/** The contract, as a plain object so a test can assert it without the runtime. */
export const TODO_RPC_DEFINITION = {
  id: RPC_ID,
  events: {
    changed: {
      schema: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
        },
        required: ["sessionID"],
        additionalProperties: false,
      },
    },
  },
} as const;

export type ChangeEmitter = (sessionID: string) => void;

/**
 * Registers the contract on the running plugin context and returns the emitter.
 * Returns null when the runtime does not provide RPC — callers then announce
 * nothing and stay silent (a listener being absent is not an error).
 */
export async function registerTodoRpc(
  ctx: { rpc?: { register?: (definition: unknown, handlers: unknown) => Promise<unknown> } },
  log: (message: string) => void = () => {},
): Promise<ChangeEmitter | null> {
  if (typeof ctx?.rpc?.register !== "function") {
    log("this runtime has no plugin RPC; todo changes are not announced");
    return null;
  }
  try {
    const { Rpc } = await import("@opencode/plugin/rpc");
    const registration = (await ctx.rpc.register(Rpc.define(TODO_RPC_DEFINITION), {})) as {
      events?: { emit?: (name: string, data: unknown) => Promise<unknown> };
    };
    const emit = registration?.events?.emit;
    if (typeof emit !== "function") {
      log("the RPC registration returned no emitter; todo changes are not announced");
      return null;
    }
    return (sessionID: string) => {
      // A listener that fails must never break the tool: the emit is fire-and-forget.
      void Promise.resolve(emit.call(registration.events, "changed", { sessionID })).catch(
        (error: unknown) => log(`todo change event failed: ${String(error)}`),
      );
    };
  } catch (error) {
    log(`plugin RPC unavailable (${String(error)}); todo changes are not announced`);
    return null;
  }
}
