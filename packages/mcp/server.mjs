#!/usr/bin/env node
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';
const sdk=await import('tryagentkey').catch(()=>import('../sdk/index.mjs'));
const {AgentKeyClient}=sdk;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const schema=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const id={type:'string',format:'uuid'},origin={type:'string',format:'uri'};
export const tools=[
 {name:'agentkey_request',description:'Request owner-approved credential use. Never returns credentials.',inputSchema:{type:'object',properties:{agent_id:id,executor_id:id,origin,site_name:{type:'string',minLength:1,maxLength:120},signin_url:{type:'string',format:'uri'}},required:['agent_id','executor_id','origin','site_name'],additionalProperties:false}},
 {name:'agentkey_request_status',description:'Read redacted approval status.',inputSchema:schema({request_id:id})},
 {name:'agentkey_use',description:'Use an active grant through its enrolled executor. Returns pending operation, not a secret.',inputSchema:schema({grant_id:id,origin,executor_key_id:id,idempotency_key:id})},
 {name:'agentkey_receipt',description:'Read redacted executor operation receipt.',inputSchema:schema({operation_id:id})}
];
const output={agentkey_request:['site_name','request_id','status','grant_id','expires_at','request_url','signin_link','code','next_action'],agentkey_request_status:['request_id','agent_id','agent_name','executor_id','executor_key_id','origin','action','state','expires_at','grant_id'],agentkey_use:['operation_id','status','code','next_action'],agentkey_receipt:['operation_id','grant_id','status','reserved_at','finished_at']};
function argumentsFor(name,args){
 const tool=tools.find(t=>t.name===name);if(!tool||!args||typeof args!=='object'||Array.isArray(args))throw Error('invalid_arguments');
 const keys=tool.inputSchema.required,allowed=Object.keys(tool.inputSchema.properties);if(Object.keys(args).some(k=>!allowed.includes(k)||typeof args[k]!=='string')||keys.some(k=>typeof args[k]!=='string'))throw Error('invalid_arguments');
 for(const k of keys){if(k==='site_name'){if(!args[k].trim()||args[k].trim().length>120||/[\u0000-\u001f\u007f]/.test(args[k]))throw Error('invalid_arguments');}else if(k==='origin'){const u=new URL(args[k]);if(u.protocol!=='https:'||u.origin!==args[k]||u.username||u.password)throw Error('invalid_arguments');}else if(!uuid.test(args[k]))throw Error('invalid_arguments');}
 if(Object.hasOwn(args,'signin_url')){const v=args.signin_url;if(v.length>2048||/[\u0000-\u0020\u007f]/.test(v))throw Error('invalid_arguments');const u=new URL(v);if(u.protocol!=='https:'||u.origin!==args.origin||u.username||u.password||u.hash)throw Error('invalid_arguments');}
 return args;
}
export function mcpHandler(client){
 let initialized=false,ready=false;
 const error=(id,code,message)=>({jsonrpc:'2.0',id,error:{code,message}});
 return async message=>{
  const id=message?.id??null;
  if(!message||Array.isArray(message)||message.jsonrpc!=='2.0'||typeof message.method!=='string'||(Object.hasOwn(message,'id')&&typeof message.id!=='string'&&typeof message.id!=='number'))return error(id,-32600,'Invalid Request');
  if(!Object.hasOwn(message,'id')){if(message.method==='notifications/initialized'&&initialized)ready=true;return null;}
  let result;
  try{
   if(message.method==='initialize'){
    if(initialized||!['2025-06-18','2024-11-05'].includes(message.params?.protocolVersion))return error(id,-32602,'Unsupported initialization');
    initialized=true;result={protocolVersion:message.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'AgentKey',version:'0.1.0'}};
   }else if(message.method==='ping')result={};
   else if(!ready)return error(id,-32000,'Server not initialized');
   else if(message.method==='tools/list')result={tools};
   else if(message.method==='tools/call'){
    const name=message.params?.name,args=argumentsFor(name,message.params?.arguments);
    try{
     let data;
     if(name==='agentkey_request')data=await client.request(args);
     else if(name==='agentkey_request_status')data=await client.requestStatus(args.request_id);
     else if(name==='agentkey_use'){const {grant_id,...body}=args;data=await client.use(grant_id,body);}
     else data=await client.receipt(args.operation_id);
     // Defend the transport boundary even if an upstream service adds private fields.
     const safe=Object.fromEntries(output[name].filter(k=>Object.hasOwn(data,k)).map(k=>[k,data[k]]));
     if(Object.values(safe).some(v=>v!==null&&typeof v!=='string'&&typeof v!=='number'&&typeof v!=='boolean'))throw Error('invalid_response');
     result={content:[{type:'text',text:JSON.stringify(safe)}],isError:false};
    }catch{result={content:[{type:'text',text:'AgentKey request failed'}],isError:true};}
   }else return error(id,-32601,'Method not found');
  }catch{return error(id,-32602,'Invalid params');}
  return {jsonrpc:'2.0',id,result};
 };
}
export async function serveStdio(client,{input=process.stdin,output=process.stdout}={}){
 const handler=mcpHandler(client),lines=createInterface({input,crlfDelay:Infinity});
 for await(const line of lines){let response;if(Buffer.byteLength(line)>65536)response={jsonrpc:'2.0',id:null,error:{code:-32600,message:'Request too large'}};
  else try{response=await handler(JSON.parse(line));}catch{response={jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}};}
  if(response)output.write(JSON.stringify(response)+'\n');
 }
}
// Accepts the one-line SDK key (AGENTKEY_API_KEY) or a legacy access token.
export async function clientFromEnv(env=process.env,fetchImpl=fetch){
 const baseURL=env.AGENTKEY_BASE_URL??env.AGENTKEY_SERVICE_URL??'https://agentkey.waiwiser.com/api/public/agentkey-api';
 if(env.AGENTKEY_API_KEY){
  const {decodeApiKey}=await import('tryagentkey/auto').catch(()=>import('../sdk/auto.mjs'));
  const k=decodeApiKey(env.AGENTKEY_API_KEY);let cur=null;
  const token=async()=>{if(cur&&cur.exp>Date.now()+60000)return cur.token;const r=await fetchImpl(k.url,{method:'POST',headers:{apikey:k.apikey,'Content-Type':'application/json'},body:JSON.stringify({email:k.email,password:k.password})});if(!r.ok)throw Error('agent_sign_in_failed');const j=await r.json();cur={token:j.access_token,exp:Date.now()+(j.expires_in??3600)*1000};return cur.token;};
  return new AgentKeyClient({baseURL,token,fetchImpl});
 }
 const t=env.AGENTKEY_ACCESS_TOKEN;if(!t)return null;
 return new AgentKeyClient({baseURL,token:async()=>t,fetchImpl});
}
// Works on Windows, macOS and Linux (file URLs differ per platform).
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv[2]==='config'){const {printConfig}=await import('./config.mjs');printConfig(process.argv[3]);}
 else{let client=null;try{client=await clientFromEnv();}catch(e){process.stderr.write(`AgentKey setup problem: ${e.message}\n`);process.exit(1);}
 if(!client){process.stderr.write('Set AGENTKEY_API_KEY (run `npx tryagentkey link`).\n');process.exitCode=1;}
 else await serveStdio(client);}
}
