export function formatToolResult(value, options = {}) {
  const pretty = /^(1|true)$/i.test(process.env.ODM_MCP_PRETTY?.trim() || "");
  const compact = options.compact ?? !pretty;
  const text = compact ? JSON.stringify(value) : JSON.stringify(value, null, 2);
  const response = { content: [{ type: "text", text }] };
  const structured = options.structured ?? /^(1|true)$/i.test(process.env.ODM_MCP_STRUCTURED_RESULTS?.trim() || "");
  if (structured) response.structuredContent =
    value && typeof value === "object" && !Array.isArray(value) ? value : { result: value };
  return response;
}
