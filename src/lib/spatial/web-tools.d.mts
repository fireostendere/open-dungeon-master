export type LocationWebTool = { name:string;title:string;description:string;inputSchema:Record<string,unknown>;execute:(input:Record<string,unknown>,options?:{signal?:AbortSignal})=>Promise<unknown> };
export function locationWebTools(options:{campaignId:string;userId:string;signal:AbortSignal;fetchImpl?:typeof fetch}):LocationWebTool[];
