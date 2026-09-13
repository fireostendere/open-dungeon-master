import type { LlmProfileCreate } from '../schemas/llm-profile';
export function connectionTarget(input:Record<string,unknown>):LlmProfileCreate;
export function chatUrl(raw:string):string;
export function modelsUrl(raw:string):string;
export function listModels(target:{baseUrl:string;apiKey?:string},options?:{timeoutMs?:number}):Promise<Array<{id:string;displayName:string}>>;
export function probeConnection(target:{baseUrl:string;model:string;apiKey?:string},options?:{timeoutMs?:number}):Promise<{ok:boolean;stages:Record<string,{ok:boolean;ms:number;detail?:string}>}>;
