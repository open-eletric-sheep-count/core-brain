// line-delimited MCP stdio transport, zero dependencies

/**
 * @param {(method: string, params: any) => any} onRequest
 *   called for every incoming REQUEST (a message with an `id`);
 *   may throw — the throw becomes a JSON-RPC error response.
 * @param {(method: string, params: any) => void} [onNotify]
 *   called for every incoming NOTIFICATION (a message with a method and NO `id`).
 */
export function serveStdio(onRequest, onNotify) {
  let buffer = "";

  function writeResponse(payload) {
    process.stdout.write(JSON.stringify(payload) + "\n");
  }

  function handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      writeResponse({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }

    if (typeof msg !== "object" || msg === null) return;

    if ("id" in msg) {
      // Request: has an id — expect a response
      let result;
      try {
        result = onRequest(msg.method, msg.params ?? {});
      } catch (err) {
        writeResponse({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: Number(err?.code) || -32603, message: String(err.message ?? err) },
        });
        return;
      }
      writeResponse({ jsonrpc: "2.0", id: msg.id, result });
    } else if (typeof msg.method === "string") {
      // Notification: has a method, no id — no response
      try {
        if (onNotify) onNotify(msg.method, msg.params ?? {});
      } catch {
        // swallow notification errors silently
      }
    }
  }

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    try {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep the incomplete tail
      for (const line of lines) handleLine(line);
    } catch {
      // never throw out of serveStdio
    }
  });
  process.stdin.on("end", () => {
    try {
      if (buffer) handleLine(buffer);
      buffer = "";
    } catch {
      // never throw out of serveStdio
    }
  });
}
