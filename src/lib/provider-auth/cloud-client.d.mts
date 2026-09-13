import type {ChatMessage,ChatRequestOptions,UpstreamResult} from '../model-client';
export function isStrictCloudEndpoint(raw:string):boolean;
export function requestCloudCompletion(target:{baseUrl:string;model:string;apiKey:string},messages:ChatMessage[],options?:ChatRequestOptions&{maxOutputTokens?:number;top_p?:number},dependencies?:{read?:()=>Record<string,unknown>;write?:(value:Record<string,unknown>)=>void;fetchImpl?:typeof fetch}):Promise<UpstreamResult>;
