/** Fixed-watermark replay and bounded live delivery. Authorization and the
 * immutable recipient projection are checked when a buffered frame is read.
 */
type ReplayEvent={seq:number;type:string;payload:unknown};
type StreamOptions={
  afterSeq:number;signal:AbortSignal;latestSeq:()=>number;
  listEventsSince:(afterSeq:number,limit:number)=>ReplayEvent[];
  subscribe:(send:(chunk:string)=>void)=>()=>void;
  sseChunk:(type:string,payload:unknown,id?:number)=>string;
  canDeliver?:()=>boolean;
  assertAccess?:()=>void;
  projectEvent?:(event:ReplayEvent)=>ReplayEvent;
  projectLive?:(chunk:string)=>string|null;
  heartbeatMs?:number;maximumBufferedBytes?:number;
};
const REFRESH_EVENTS=['ask_activity','whisper_activity','facts_updated','side_activity','battle_map_updated','relationships_updated'];
const PAGE_SIZE=500;
export function createCampaignStream(options:StreamOptions):ReadableStream<Uint8Array>{
  const encoder=new TextEncoder(),maximum=options.maximumBufferedBytes??2*1024*1024;
  let closed=false,replaying=true,cursor=options.afterSeq,watermark=0,bufferedBytes=0;
  const live:Array<{chunk:string;bytes:number}>=[];
  let wake:(()=>void)|undefined,unsubscribe=()=>{},heartbeat:ReturnType<typeof setInterval>|undefined;
  let controller:ReadableStreamDefaultController<Uint8Array>;
  function cleanup(error?:unknown){
    if(closed)return;closed=true;if(heartbeat)clearInterval(heartbeat);
    options.signal.removeEventListener('abort',abort);unsubscribe();live.length=0;wake?.();wake=undefined;
    try{if(error)controller.error(error);else controller.close();}catch{/* cancelled reader */}
  }
  function authorized(){
    if(closed)return false;
    try{options.assertAccess?.();if(options.canDeliver&&!options.canDeliver()){cleanup();return false;}return true;}
    catch(error){cleanup(error);return false;}
  }
  function abort(){cleanup();}
  function receive(chunk:string){
    if(!authorized())return;
    const match=/^id: (\d+)\n/.exec(chunk);
    if(match&&Number(match[1])<=watermark&&!chunk.includes('\nevent: campaign_rewound\n'))return;
    const bytes=encoder.encode(chunk).byteLength;
    if(bufferedBytes+bytes>maximum){cleanup(new Error('Campaign stream consumer fell behind; reconnect to replay.'));return;}
    live.push({chunk,bytes});bufferedBytes+=bytes;wake?.();wake=undefined;
  }
  function finishReplay(){
    if(!authorized())return;replaying=false;
    controller.enqueue(encoder.encode(options.sseChunk('stream_checkpoint',{},watermark)));
    for(const type of REFRESH_EVENTS)controller.enqueue(encoder.encode(options.sseChunk(type,{})));
  }
  return new ReadableStream<Uint8Array>({
    start(target){
      controller=target;if(options.signal.aborted){cleanup();return;}if(!authorized())return;
      watermark=options.latestSeq();unsubscribe=options.subscribe(receive);
      if(closed){unsubscribe();return;}if(options.signal.aborted){cleanup();return;}
      options.signal.addEventListener('abort',abort,{once:true});heartbeat=setInterval(()=>receive(': ping\n\n'),options.heartbeatMs??20000);
      if(cursor>watermark){controller.enqueue(encoder.encode(options.sseChunk('campaign_rewound',{reason:'cursor_ahead'},watermark)));finishReplay();}
    },
    async pull(){
      try{
        if(!authorized())return;
        if(replaying){
          const page=options.listEventsSince(cursor,PAGE_SIZE).filter(event=>event.seq<=watermark);
          for(const event of page){
            if(!authorized())return;
            if(!Number.isSafeInteger(event.seq)||event.seq<=cursor)throw new Error('Invalid campaign replay order.');
            const projected=options.projectEvent?.(event)??event;
            if(projected.seq!==event.seq)throw new Error('Projection changed the campaign cursor.');
            controller.enqueue(encoder.encode(options.sseChunk(projected.type,projected.payload,projected.seq)));cursor=event.seq;
          }
          if(page.length<PAGE_SIZE||cursor>=watermark)finishReplay();return;
        }
        while(!closed){
          while(!closed&&!live.length)await new Promise<void>(resolve=>{wake=resolve;});
          if(!authorized())return;
          const item=live.shift()!;bufferedBytes-=item.bytes;
          const chunk=options.projectLive?options.projectLive(item.chunk):item.chunk;
          if(chunk===null)continue;
          controller.enqueue(encoder.encode(chunk));
          if(chunk.includes('\nevent: campaign_rewound\n'))cleanup();
          return;
        }
      }catch(error){cleanup(error);}
    },
    cancel(){cleanup();},
  });
}
