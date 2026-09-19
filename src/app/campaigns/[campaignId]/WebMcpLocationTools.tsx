"use client";
import { useEffect } from "react";
import { encodeWebMcpLocationIntent } from "@/lib/spatial/client-intents";

type ExecuteOptions = { signal?: AbortSignal };
type ModelContextLike = {
  registerTool: (tool: { name: string; title: string; description: string; inputSchema: Record<string, unknown>; execute: (input: Record<string, unknown>, options?: ExecuteOptions) => Promise<unknown> }, options?: { signal?: AbortSignal }) => Promise<void>;
};
const idSchema = { type: "string", format: "uuid" };

export function WebMcpLocationTools({ campaignId, userId }: { campaignId: string; userId: string }) {
  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext;
    if (!context) return;
    const controller = new AbortController();
    const endpoint = `/api/campaigns/${encodeURIComponent(campaignId)}/location-chat`;
    const request = async (url: string, options: ExecuteOptions = {}, body?: Record<string, unknown>) => {
      const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
      signal.throwIfAborted();
      const response = await fetch(url, {
        cache: "no-store", signal,
        ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
        headers: { "X-ODM-Expected-User": userId, ...(body ? { "Content-Type": "application/json" } : {}) },
      });
      const result = await response.json();
      signal.throwIfAborted();
      if (!response.ok) throw new Error(result?.code === "identity_changed" ? "Your account changed. Reload before using this tool." : result?.error || "Location request failed. Retry the same intentId and arguments if the result is uncertain.");
      return result;
    };
    const register = async () => {
      const tools = [
        {
          name: "odm_list_visible_locations", title: "List visible locations",
          description: "List authorized locations and the current roomId/revision for the signed-in player.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          execute: async (_input: Record<string, unknown>, options?: ExecuteOptions) => request(endpoint, options),
        },
        {
          name: "odm_read_location_history", title: "Read authorized location history",
          description: "Read only witnessed messages for an authorized location. Use roomId=ooc for global out-of-character chat.",
          inputSchema: { type: "object", properties: { roomId: { type: "string", minLength: 1, maxLength: 200 } }, required: ["roomId"], additionalProperties: false },
          execute: async ({ roomId }: Record<string, unknown>, options?: ExecuteOptions) => {
            if (typeof roomId !== "string" || !roomId || roomId.length > 200) throw new Error("roomId is required.");
            return request(`${endpoint}?roomId=${encodeURIComponent(roomId)}`, options);
          },
        },
        {
          name: "odm_send_location_message", title: "Send an authorized location message",
          description: "Read current roomId/revision first. Choose one UUID intentId per intended message. On uncertain failure retry ALL arguments unchanged, including intentId and revision. A new intentional message needs a new intentId, even with identical text. OOC uses null roomId and expectedRevision. DM operations are not exposed.",
          inputSchema: {
            type: "object", additionalProperties: false,
            properties: {
              intentId: idSchema, roomId: { type: ["string", "null"], format: "uuid" },
              expectedRevision: { type: ["integer", "null"], minimum: 1 },
              kind: { type: "string", enum: ["say", "do", "ooc"] }, content: { type: "string", minLength: 1, maxLength: 2000 },
            },
            required: ["intentId", "roomId", "expectedRevision", "kind", "content"],
            oneOf: [
              { properties: { kind: { const: "ooc" }, roomId: { type: "null" }, expectedRevision: { type: "null" } } },
              { properties: { kind: { enum: ["say", "do"] }, roomId: { type: "string" }, expectedRevision: { type: "integer" } } },
            ],
          },
          execute: async (input: Record<string, unknown>, options?: ExecuteOptions) => request(endpoint, options, encodeWebMcpLocationIntent(input)),
        },
      ];
      for (const tool of tools) { controller.signal.throwIfAborted(); await context.registerTool(tool, { signal: controller.signal }); }
    };
    void register().catch(() => { if (!controller.signal.aborted) console.warn("[webmcp] location_tool_registration_failed"); });
    return () => controller.abort();
  }, [campaignId, userId]);
  return null;
}
