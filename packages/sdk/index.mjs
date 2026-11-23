const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const validID=id=>{if(typeof id!=='string'||!uuid.test(id))throw Error('invalid_id');return id;};
const validOrigin=origin=>{const u=new URL(origin);if(typeof origin!=='string'||u.protocol!=='https:'||u.origin!==origin||u.username||u.password)throw Error('invalid_origin');return origin;};
// Agent-facing SDK. No credential read, owner approval or secret-return method.
export class AgentKeyClient {
 constructor({baseURL='https://agentkey.waiwiser.com/api/public/agentkey-api',token,fetchImpl=fetch}){
  const u=new URL(baseURL);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||!['/','/api/public/agentkey-api'].includes(u.pathname))throw Error('invalid_service');
  if(typeof token!=='function'||typeof fetchImpl!=='function')throw Error('invalid_client');
  this.baseURL=u.origin+(u.pathname==='/'?'':u.pathname);this.token=token;this.fetchImpl=fetchImpl;
 }
 async call(path,body,allowed){
  const r=await this.fetchImpl(this.baseURL+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+await this.token(),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('agentkey_request_failed');const data=await r.json();
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('invalid_response');
  const safe=Object.fromEntries(allowed.filter(k=>Object.hasOwn(data,k)).map(k=>[k,data[k]]));
  if(Object.values(safe).some(v=>v!==null&&!['string','number','boolean'].includes(typeof v)))throw Error('invalid_response');return safe;
 }
 request({agent_id,executor_id,origin,site_name,signin_url}){
  validID(agent_id);validID(executor_id);validOrigin(origin);
  if(typeof site_name!=='string'||!site_name.trim()||site_name.trim().length>120||/[\u0000-\u001f\u007f]/.test(site_name))throw Error('invalid_site_name');
  const body={protocol_version:'1',agent_id,executor_id,origin,site_name:site_name.trim()};
  if(signin_url!==undefined){
   if(typeof signin_url!=='string'||signin_url.length>2048||/[\u0000-\u0020\u007f]/.test(signin_url))throw Error('invalid_signin_url');
   const u=new URL(signin_url);if(u.protocol!=='https:'||u.origin!==origin||u.username||u.password||u.hash)throw Error('invalid_signin_url');body.signin_url=u.href;
  }
  return this.call('/v1/requests',body,['site_name','request_id','status','grant_id','expires_at','request_url','signin_link','code','next_action']);
 }
 requestTarget({agent_id,executor_id,target_id}){
  validID(agent_id);validID(executor_id);if(typeof target_id!=='string'||!/^[a-f0-9]{32}$/.test(target_id))throw Error('invalid_target');
  return this.call('/v2/target-requests',{agent_id,executor_id,target_id},['request_id','status','origin','executor_id','executor_key_id','expires_at','request_url','next_action']);
 }
 requestStatus(id){return this.call('/v1/requests/'+validID(id),undefined,['request_id','agent_id','agent_name','executor_id','executor_key_id','origin','action','state','expires_at','grant_id']);}
 use(grant_id,{origin,executor_key_id,idempotency_key}){validID(grant_id);validOrigin(origin);validID(executor_key_id);validID(idempotency_key);return this.call('/v1/grants/'+grant_id+'/use',{origin,executor_key_id,idempotency_key},['operation_id','status','code','next_action']);}
 receipt(id){return this.call('/v1/operations/'+validID(id),undefined,['operation_id','grant_id','status','reserved_at','finished_at']);}
}
export function agentKeyTools(client){
 return {agentkey_request:args=>client.request(args),agentkey_request_status:({request_id})=>client.requestStatus(request_id),agentkey_use:({grant_id,...args})=>client.use(grant_id,args),agentkey_receipt:({operation_id})=>client.receipt(operation_id)};
}

export { createExistingBrowserLogin, existingBrowserLoginTools } from './existing-browser-login.mjs';

export { createAgentKeyConnector, createEmbeddedConnector, registerAgentKeyClient } from './connector.mjs';

export { agentkey, AgentKeyError, readEnv } from './auto.mjs';
