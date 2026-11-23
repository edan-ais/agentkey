import {randomUUID} from 'node:crypto';
import {mcpHandler} from './server.mjs';
// Single-instance bounded sessions. Restart invalidates them (404); no SSE.
// Remote host must provide TLS and verified per-request principal authentication.
export function streamableHTTP({authenticate,clientForPrincipal,allowedOrigins=[],clock=()=>Date.now(),maxSessions=1000}={}){
 if(typeof authenticate!=='function'||typeof clientForPrincipal!=='function'||!Number.isSafeInteger(maxSessions)||maxSessions<1||maxSessions>10000)throw Error('MCP_HTTP_NOT_CONFIGURED');
 for(const origin of allowedOrigins){const u=new URL(origin);if(u.origin!==origin||u.protocol!=='https:')throw Error('invalid_allowed_origin');}
 const sessions=new Map();
 const response=(status,data,headers={})=>new Response(data===undefined?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
 return async request=>{
  try{
   const url=new URL(request.url);if(url.pathname!=='/mcp'||url.search)return response(404,{code:'not_found'});
   const origin=request.headers.get('Origin');if(origin!==null&&!allowedOrigins.includes(origin))return response(403,{code:'invalid_origin'});
   const principal=await authenticate(request);if(typeof principal!=='string'||!principal)return response(401,{code:'unauthorized'});
   const now=clock();for(const [id,s]of sessions)if(s.expires<=now)sessions.delete(id);
   const sessionID=request.headers.get('Mcp-Session-Id');if(sessionID&&(!/^[0-9a-f-]{36}$/.test(sessionID)||!sessions.has(sessionID)||sessions.get(sessionID).principal!==principal))return response(404,{code:'session_not_found'});
   if(request.method==='DELETE'){if(!sessionID)return response(400,{code:'session_required'});sessions.delete(sessionID);return response(204);}
   if(request.method==='GET')return response(405,{code:'sse_not_supported'},{Allow:'POST, DELETE'});
   if(request.method!=='POST')return response(405,{code:'method_not_allowed'},{Allow:'POST, DELETE'});
   const accept=request.headers.get('Accept')||'';if(!accept.includes('application/json')||!accept.includes('text/event-stream'))return response(406,{code:'invalid_accept'});
   if(!request.headers.get('Content-Type')?.startsWith('application/json'))return response(415,{code:'invalid_content_type'});
   const reader=request.body?.getReader();let size=0;const chunks=[];if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();return response(413,{code:'body_too_large'});}chunks.push(value);}
   const data=new Uint8Array(size);let at=0;for(const c of chunks){data.set(c,at);at+=c.length;}
   if(sessionID){const current=sessions.get(sessionID);if(!current||current.principal!==principal||current.expires<=clock()){if(current?.expires<=clock())sessions.delete(sessionID);return response(404,{code:'session_not_found'});}}
   const message=JSON.parse(new TextDecoder().decode(data));if(!message||Array.isArray(message)||message.jsonrpc!=='2.0')return response(400,{code:'invalid_request'});
   if(!sessionID){
    if(message.method!=='initialize'||message.params?.protocolVersion!=='2025-06-18')return response(400,{code:'initialization_required'});
    if(sessions.size>=maxSessions)return response(503,{code:'capacity'});
    const client=await clientForPrincipal(principal),handler=mcpHandler(client),result=await handler(message);
    if(!result?.result)return response(400,result||{code:'invalid_initialize'});
    if(sessions.size>=maxSessions)return response(503,{code:'capacity'});
    const id=randomUUID();sessions.set(id,{principal,handler,expires:clock()+900000,busy:false});return response(200,result,{'Mcp-Session-Id':id});
   }
   if(request.headers.get('MCP-Protocol-Version')!=='2025-06-18')return response(400,{code:'invalid_protocol_version'});
   const session=sessions.get(sessionID);if(session.busy)return response(409,{code:'session_busy'});
   session.busy=true;try{const result=await session.handler(message);return result===null?response(202):response(200,result);}finally{session.busy=false;}
  }catch{return response(400,{code:'invalid_request'});}
 };
}
// Not deployed. Authentication/OAuth, operational rate limits and supported host
// consent/installation are separate gates, not implied by transport existence.
