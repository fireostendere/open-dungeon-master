import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { createMcpProxy } from '../src/lib/mcp-proxy.mjs';

async function server(t, handle) {
  const http = createServer(handle);
  await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  t.after(()=>{http.closeAllConnections();http.close();});
  return `http://127.0.0.1:${http.address().port}/mcp`;
}
function request(method='POST',body='{}',headers={}) {
  return new Request('http://application.test/mcp?session=fixture',{method,headers:{authorization:'Bearer client-only-token','content-type':'application/json',...headers},...(method==='GET'?{}:{body})});
}

test('bridge preserves protocol/session headers but drops cookies, Host and forwarding claims',async t=>{
  let seen;
  const upstream=await server(t,async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    seen={headers:req.headers,body,path:req.url};
    res.writeHead(201,{'content-type':'application/json','mcp-session-id':'session-2','set-cookie':'sidecar=not-for-app','connection':'x-internal','x-internal':'hidden'});
    res.end('{"ok":true}');
  });
  const proxy=createMcpProxy({upstream});
  const response=await proxy(request('POST','{"method":"tools/list"}',{cookie:'session=private; odm_portal_url=http://evil.test',host:'evil.test','x-forwarded-host':'evil.test','x-forwarded-for':'1.2.3.4','mcp-session-id':'session-1','mcp-protocol-version':'2025-03-26',origin:'https://allowed-client.test'}));
  assert.equal(response.status,201);assert.deepEqual(await response.json(),{ok:true});
  assert.equal(seen.headers.authorization,'Bearer client-only-token');assert.equal(seen.headers['mcp-session-id'],'session-1');assert.equal(seen.headers.origin,'https://allowed-client.test');
  assert.equal(seen.headers.cookie,undefined);assert.equal(seen.headers['x-forwarded-host'],undefined);assert.equal(seen.headers['x-forwarded-for'],undefined);
  assert.equal(seen.headers.host,new URL(upstream).host);assert.equal(seen.path,'/mcp?session=fixture');
  assert.equal(response.headers.get('mcp-session-id'),'session-2');assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('x-internal'),null);
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
});

test('missing bearer is refused before contacting the sidecar',async()=>{
  let calls=0;const proxy=createMcpProxy({fetchImpl:async()=>{calls++;throw Error('unexpected');}});
  for(const authorization of ['', 'Basic anything','Bearer ']) {
    const response=await proxy(request('POST','{}',{authorization}));assert.equal(response.status,401);assert.ok(response.headers.get('www-authenticate'));
  }
  assert.equal(calls,0);
});

test('sidecar authentication failure is preserved without substituting an application token',async t=>{
  const upstream=await server(t,(req,res)=>{assert.equal(req.headers.authorization,'Bearer client-only-token');res.writeHead(401,{'www-authenticate':'Bearer realm="sidecar"'});res.end('Unauthorized');});
  const response=await createMcpProxy({upstream})(request());assert.equal(response.status,401);assert.equal(await response.text(),'Unauthorized');assert.equal(response.headers.get('www-authenticate'),'Bearer realm="sidecar"');
});

for(const method of ['GET','DELETE','OPTIONS'])test(`bridge forwards ${method}`,async t=>{
  const upstream=await server(t,(req,res)=>{assert.equal(req.method,method);req.resume();res.writeHead(200);res.end('ok');});
  const response=await createMcpProxy({upstream})(request(method));assert.equal(await response.text(),'ok');
});

test('unsupported methods are rejected without an upstream call',async()=>{
  const proxy=createMcpProxy({fetchImpl:async()=>{throw Error('must not fetch');}});
  assert.equal((await proxy(request('PUT'))).status,405);
});

test('oversized declared and streamed bodies are bounded before upstream transmission',async()=>{
  let calls=0;const proxy=createMcpProxy({maximumBytes:16,fetchImpl:async()=>{calls++;return Response.json({});}});
  assert.equal((await proxy(request('POST','{}',{'content-length':'1000'}))).status,413);
  assert.equal((await proxy(request('POST','01234567890123456'))).status,413);
  assert.equal((await proxy(request('POST','{}',{'content-length':'NaN'}))).status,400);
  assert.equal(calls,0);
});

test('default bridge accepts an 8 MiB target image with base64 overhead and still caps the body',async()=>{
  const body=JSON.stringify({method:'tools/call',params:{name:'odm_assets',arguments:{operation:'set_image',data_base64:Buffer.alloc(8*1024*1024).toString('base64')}}});
  let received=0;
  const proxy=createMcpProxy({fetchImpl:async(_url,init)=>{received=init.body.byteLength;return Response.json({ok:true});}});
  assert.equal((await proxy(request('POST',body))).status,200);
  assert.equal(received,Buffer.byteLength(body));
  assert.equal((await proxy(request('POST','{}',{'content-length':String(12*1024*1024+1)}))).status,413);
});

test('redirects never move the bearer to another destination',async t=>{
  let leaked=0;const destination=await server(t,(_req,res)=>{leaked++;res.end('leaked');});
  const upstream=await server(t,(_req,res)=>{res.writeHead(302,{location:destination});res.end();});
  const response=await createMcpProxy({upstream})(request());assert.equal(response.status,503);assert.equal(leaked,0);
});

test('SSE stays streaming and cancelling the returned stream reaches the sidecar',async t=>{
  let closed=false;
  const upstream=await server(t,(req,res)=>{
    req.resume();res.writeHead(200,{'content-type':'text/event-stream','mcp-session-id':'s'});res.write('data: first\n\n');
    res.once('close',()=>closed=true);
  });
  const response=await createMcpProxy({upstream})(request('GET'));
  const reader=response.body.getReader();const first=await reader.read();assert.equal(new TextDecoder().decode(first.value),'data: first\n\n');
  await reader.cancel();for(let i=0;i<50&&!closed;i++)await delay(5);assert.equal(closed,true);
});

test('inbound cancellation and total deadline stop a stalled upstream request',async t=>{
  let started;const waiting=new Promise(resolve=>started=resolve);
  const upstream=await server(t,(req)=>{req.resume();started();});
  const controller=new AbortController();
  const req=new Request(request(),{signal:controller.signal});
  const pending=createMcpProxy({upstream})(req);await waiting;controller.abort();assert.equal((await pending).status,499);
  assert.equal((await createMcpProxy({upstream,timeoutMs:30})(request())).status,504);
});

test('abort during body upload does not start any upstream request',async()=>{
  let calls=0,cancelled=false;
  const controller=new AbortController();
  const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}});
  const req=new Request('http://app/mcp',{method:'POST',headers:{authorization:'Bearer x'},body,duplex:'half',signal:controller.signal});
  const pending=createMcpProxy({fetchImpl:async()=>{calls++;return Response.json({});}})(req);
  controller.abort();assert.equal((await pending).status,499);assert.equal(calls,0);assert.equal(cancelled,true);
});

test('compressed upstream payload is not marked encoded after native fetch decompresses it',async t=>{
  const upstream=await server(t,(req,res)=>{req.resume();res.writeHead(200,{'content-encoding':'gzip','content-type':'application/json'});res.end(gzipSync('{"ready":true}'));});
  const response=await createMcpProxy({upstream})(request());assert.equal(response.headers.get('content-encoding'),null);assert.equal(response.headers.get('content-length'),null);assert.deepEqual(await response.json(),{ready:true});
});

test('invalid server destination is rejected at setup, not accepted from client data',()=>{
  for(const upstream of ['file:///etc/passwd','http://user:password@host/mcp','http://host/other','http://host/mcp?target=x','http://host/mcp#x'])assert.throws(()=>createMcpProxy({upstream}),/Invalid server MCP proxy destination/);
});
