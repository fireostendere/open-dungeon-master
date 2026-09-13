export function providerState():{root:string;controlKey:string;bridgeKey:string};
export function verifyLocalControl(request:Request):boolean;
export function verifyInference(request:Request):boolean;
export function bridgeProfile(model:string,requestOrigin?:string):{name:string;kind:'custom';protocol:'openai-compatible';baseUrl:string;model:string;authMode:'api-key';apiKey:string;thinking:'auto';timeoutMs:number};
export function authAction(owner:string,input:Record<string,unknown>):Promise<unknown>;
export function gateway():Promise<{status(owner:string):Promise<unknown>;models():Promise<Array<{id:string;displayName:string}>>;complete(body:unknown,options?:{signal?:AbortSignal}):Promise<unknown>}>;
