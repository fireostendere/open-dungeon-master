"use client";
import { useEffect } from "react";
import { locationWebTools, type LocationWebTool } from "@/lib/spatial/web-tools.mjs";

type ModelContextLike = {
  registerTool: (tool: LocationWebTool, options?: { signal?: AbortSignal }) => Promise<void>;
};

// Registration failures are observable, not silently presented as a passing
// WebMCP smoke. DOM operation stays available when native WebMCP is absent.
export function WebMcpLocationTools({ campaignId, userId }: { campaignId: string; userId: string }) {
  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext;
    const report = (status: string) => document.dispatchEvent(new CustomEvent("odm-webmcp-status", { detail: { status } }));
    if (!context) { report("unavailable"); return; }
    const controller = new AbortController();
    const register = async () => {
      for (const tool of locationWebTools({ campaignId, userId, signal: controller.signal })) {
        controller.signal.throwIfAborted();
        await context.registerTool(tool, { signal: controller.signal });
      }
      if (!controller.signal.aborted) report("ready");
    };
    void register().catch(() => {
      if (!controller.signal.aborted) { report("failed"); controller.abort(); }
    });
    return () => controller.abort();
  }, [campaignId, userId]);
  return null;
}
