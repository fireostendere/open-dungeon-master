// Both historical UUID names map to the same server requestId. Tool retries
// never refetch a room revision or silently allocate a new intended message.
const uuid={type:'string',format:'uuid'};
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function locationWebTools({campaignId,userId,signal,fetchImpl=globalThis.fetch}) {
  const endpoint=`/api/campaigns/${encodeURIComponent(campaignId)}/location-chat`;
  const request=async(suffix='',options={},execution={})=>{
    const requestSignal=execution.signal?AbortSignal.any([signal,execution.signal]):signal;
    requestSignal.throwIfAborted();
    const response=await fetchImpl(endpoint+suffix,{...options,cache:'no-store',signal:requestSignal,
      headers:{'X-ODM-Actor':userId,'X-ODM-Expected-User':userId,...options.headers}});
    const body=await response.json();requestSignal.throwIfAborted();
    if(!response.ok)throw new Error(body?.error||'Location request failed. Retry the same UUID and arguments if the outcome is uncertain.');
    return body;
  };
  return [
    {name:'odm_list_visible_locations',title:'List visible locations',description:'List locations and current room/revision authorized for this signed-in player.',
      inputSchema:{type:'object',properties:{},additionalProperties:false},execute:(_input={},execution)=>request('',{},execution)},
    {name:'odm_read_location_history',title:'Read authorized location history',description:'Read witnessed messages only; roomId=ooc reads global table talk.',
      inputSchema:{type:'object',properties:{roomId:{type:'string',minLength:1,maxLength:200}},required:['roomId'],additionalProperties:false},
      execute:({roomId},execution)=>{
        if(roomId!=='ooc'&&!uuidPattern.test(String(roomId)))throw new Error('Invalid room ID.');
        return request(`?roomId=${encodeURIComponent(roomId)}`,{},execution);
      }},
    {name:'odm_send_location_message',title:'Send an authorized location message',
      description:'Persist a UUID requestId (legacy alias intentId) before sending. Repeat identical arguments and the same ID after an uncertain failure. For say/do read and pass roomId and expectedRevision explicitly. OOC is global. No DM powers.',
      inputSchema:{type:'object',additionalProperties:false,properties:{requestId:uuid,intentId:uuid,
        roomId:{type:['string','null'],format:'uuid'},expectedRevision:{type:['integer','null'],minimum:1},
        kind:{type:'string',enum:['say','do','ooc']},content:{type:'string',minLength:1,maxLength:2000}},
        required:['kind','content'],anyOf:[{required:['requestId']},{required:['intentId']}],
        oneOf:[{properties:{kind:{const:'ooc'},roomId:{type:'null'},expectedRevision:{type:'null'}}},
          {properties:{kind:{enum:['say','do']},roomId:uuid,expectedRevision:{type:'integer',minimum:1}},required:['roomId','expectedRevision']}]},
      execute:(input,execution)=>{
        if(!input||typeof input!=='object'||Object.keys(input).some(key=>!['requestId','intentId','roomId','expectedRevision','kind','content'].includes(key)))throw new Error('Unknown message argument.');
        if(input.intentId!==undefined&&input.requestId!==undefined&&input.intentId!==input.requestId)throw new Error('Conflicting intentId and requestId.');
        const requestId=input.requestId??input.intentId;
        if(!uuidPattern.test(String(requestId))||!['say','do','ooc'].includes(input.kind)||typeof input.content!=='string'||!input.content.trim()||input.content.length>2000)throw new Error('Invalid message arguments.');
        if(input.kind!=='ooc'&&(!uuidPattern.test(String(input.roomId))||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1))throw new Error('Read the current roomId/revision first, then send both explicitly.');
        if(input.kind==='ooc'&&(input.roomId!=null||input.expectedRevision!=null))throw new Error('OOC does not belong to a room/revision.');
        return request('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'send',requestId,
          roomId:input.kind==='ooc'?null:input.roomId,kind:input.kind,content:input.content,
          ...(input.kind==='ooc'?{}:{expectedRevision:input.expectedRevision})})},execution);
      }},
  ];
}
