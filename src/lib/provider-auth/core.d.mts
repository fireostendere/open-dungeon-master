export class ProviderError extends Error {code:string;status:number;constructor(code:string,status?:number);}
export function publicError(error:unknown):string;
export function equalSecret(expected:string,actual:unknown):boolean;
export function safeAuthUrl(raw:string):string;
export function loopbackOrigin(raw?:string):string;
export function profileFingerprint(p:object):string;
export function canApplyProfile(p:unknown):boolean;
export function requireVerifiedProfile(p:unknown):void;
export function profileHasChanged(a:object,b:object):boolean;
export function modelId(raw:unknown):string;
export function requestIsSameOrigin(request:Request):boolean;
