"use client";

import { useEffect } from "react";

type ModelContextLike = {
  registerTool: (tool: { name: string; title: string; description: string; inputSchema: Record<string, unknown>; execute: (input: Record<string, unknown>) => Promise<unknown> }, options?: { signal?: AbortSignal }) => Promise<void>;
};

const idSchema = { type: "string", minLength: 1, maxLength: 200 };

// WebMCP is optional and currently experimental. The same authenticated HTTP
// routes remain the source of truth, so Playwright's DOM path works when the
// browser has no native modelContext.
export function WebMcpLocationTools({ campaignId, userId }: { campaignId: string; userId: string }) {
  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext;
    if (!context) return;
    const controller = new AbortController();
    const endpoint = `/api/campaigns/${encodeURIComponent(campaignId)}/location-chat`;
    const json = async (response: Response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Location request failed.");
      return body;
    };
    const register = async () => {
      const tools = [
        {
          name: "odm_list_visible_locations",
          title: "List visible locations",
          description: "List only locations authorized for the currently signed-in ODM player.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          execute: async () => json(await fetch(endpoint, { cache: "no-store" })),
        },
        {
          name: "odm_read_location_history",
          title: "Read authorized location history",
          description: "Read witnessed messages for one authorized location. The server enforces identity and retained history.",
          inputSchema: { type: "object", properties: { roomId: idSchema }, required: ["roomId"], additionalProperties: false },
          execute: async ({ roomId }: Record<string, unknown>) => json(await fetch(`${endpoint}?roomId=${encodeURIComponent(String(roomId))}`, { cache: "no-store" })),
        },
        {
          name: "odm_send_location_message",
          title: "Send an authorized location message",
          description: "Send say, do, or global OOC through the current authenticated player seat. DM operations are not exposed.",
          inputSchema: { type: "object", properties: { roomId: { ...idSchema, nullable: true }, kind: { type: "string", enum: ["say", "do", "ooc"] }, content: { type: "string", minLength: 1, maxLength: 2000 } }, required: ["kind", "content"], additionalProperties: false },
          execute: async ({ roomId, kind, content }: Record<string, unknown>) => {
            const view = await json(await fetch(endpoint, { cache: "no-store" }));
            const current = view.current;
            return json(await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
              operation: "send", requestId: crypto.randomUUID(), roomId: roomId ?? null, kind, content,
              ...(kind !== "ooc" && current ? { expectedRevision: current.revision } : {}),
            }) }));
          },
        },
      ];
      for (const tool of tools) {
        if (controller.signal.aborted) return;
        await context.registerTool(tool, { signal: controller.signal });
      }
    };
    void register().catch(() => undefined);
    return () => controller.abort();
  }, [campaignId, userId]);
  return null;
}
