/**
 * True when an MCP JSON-RPC request body calls a tool (single or batched).
 *
 * Only tool calls publish anything. Handshake and discovery requests
 * (initialize, notifications/initialized, tools/list, ping) must not count
 * toward the publish rate limit, or a client uses up its hourly budget just
 * connecting.
 */
export function isMcpToolCall(body: unknown): boolean {
  const messages = Array.isArray(body) ? body : [body];
  return messages.some(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      (m as { method?: unknown }).method === "tools/call",
  );
}

/**
 * How many tool calls a request body carries. Rate limits count a request
 * once, so a batch of many tool calls would publish many pages for the price
 * of one: /mcp refuses bodies with more than one.
 */
export function countMcpToolCalls(body: unknown): number {
  const messages = Array.isArray(body) ? body : [body];
  return messages.filter(
    (m) => typeof m === "object" && m !== null && (m as { method?: unknown }).method === "tools/call",
  ).length;
}
