// One-line AgentKey: `const ak = await agentkey()`.
// Reads AGENTKEY_API_KEY (written by `npx tryagentkey init`), signs the agent in,
// keeps its runtime enrolled, and fills approved logins into the agent's OWN
// page. Passwords never reach the agent, the model or this object's return values.
import {readFileSync,writeFileSync,mkdirSync,existsSync,chmodSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {AgentKeyClient} from './index.mjs';
import {detectProject} from './detect.mjs';
import {createLocal} from './local/index.mjs';
import {waitConfirmed} from './confirm.mjs';
import {writeEnvVars} from './local/env.mjs';

export const DEFAULT_BASE='https://agentkey.waiwiser.com/api/public/agentkey-api';
const PREFIX='ak_';
const b64u={enc:s=>Buffer.from(s).toString('base64url'),dec:s=>Buffer.from(s,'base64url').toString('utf8')};

// The API key bundles the agent's own sign-in, issued once at pairing.
export function encodeApiKey({agent_id,sign_in}){return PREFIX+b64u.enc(JSON.stringify({v:1,agent_id,url:sign_in.url,email:sign_in.email,password:sign_in.password,apikey:sign_in.apikey}));}
export function decodeApiKey(key){
 if(typeof key!=='string'||!key.startsWith(PREFIX))throw new AgentKeyError('invalid_api_key','AGENTKEY_API_KEY must start with ak_. Run `npx tryagentkey link`.');
 let k;try{k=JSON.parse(b64u.dec(key.slice(PREFIX.length)));}catch{throw new AgentKeyError('invalid_api_key','AGENTKEY_API_KEY is damaged. Run `npx tryagentkey link` again.');}
 const u=new URL(k.url);if(k.v!==1||u.protocol!=='https:'||!k.agent_id||!k.email||!k.password||!k.apikey)throw new AgentKeyError('invalid_api_key','AGENTKEY_API_KEY is not valid. Run `npx tryagentkey link` again.');
 return k;
}
export class AgentKeyError extends Error{constructor(code,hint){super(hint?`${code}: ${hint}`:code);this.code=code;this.hint=hint;}}

// Standard names first; older kit names still work.
export function readEnv(env=process.env,cwd=process.cwd()){
 const file=loadDotEnv(cwd);const get=n=>env[n]??file[n];
 return {mode:get('AGENTKEY_MODE'),localKey:get('AGENTKEY_LOCAL_KEY'),apiKey:get('AGENTKEY_API_KEY'),baseURL:get('AGENTKEY_BASE_URL')??get('AGENTKEY_API')??get('AGENTKEY_SERVICE_URL')??DEFAULT_BASE,legacyToken:get('AGENTKEY_TOKEN')??get('AGENTKEY_ACCESS_TOKEN')??get('AGENTKEY_AGENT_TOKEN'),agentId:get('AGENTKEY_AGENT_ID')};
}
function loadDotEnv(cwd){
 const out={};for(const f of ['.env.local','.env']){try{for(const line of readFileSync(join(cwd,f),'utf8').split(/\r?\n/)){const m=line.match(/^\s*(?:export\s+)?(AGENTKEY_[A-Z_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);if(m&&!(m[1] in out))out[m[1]]=m[2];}}catch{}}
 return out;
}

function tokenSource(k,fetchImpl){
 let cur=null;
 return async()=>{
  if(cur&&cur.exp>Date.now()+60000)return cur.token;
  const r=await fetchImpl(k.url,{method:'POST',headers:{apikey:k.apikey,'Content-Type':'application/json'},body:JSON.stringify({email:k.email,password:k.password}),signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new AgentKeyError('agent_sign_in_failed','The owner may have removed this agent. Run `npx tryagentkey link` again.');
  const j=await r.json();cur={token:j.access_token,exp:Date.now()+(j.expires_in??3600)*1000};return cur.token;
 };
}

// Local runtime state (private key + runtime session). Never printed.
export function fileStore(path){
 return {load:()=>{try{return JSON.parse(readFileSync(path,'utf8'));}catch{return null;}},
  save:v=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(v),{mode:0o600});try{chmodSync(path,0o600);}catch{}}};
}

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const defaultLink=(url,why)=>console.log(`\nAgentKey: ${why}\n  here is your link → ${url}\n`);

export async function agentkey(options={}){
 const {cwd=process.cwd(),env=process.env,fetchImpl=fetch,onLink=defaultLink,pollMs=1500,store}=options;
 const cfg=readEnv(env,cwd);const baseURL=options.baseURL??cfg.baseURL;
 const mode=options.mode??cfg.mode??(cfg.apiKey||options.apiKey?'cloud':'local');
 if(mode==='local')return localAgentkey({...options,cwd,onLink});
 if(mode!=='cloud')throw new AgentKeyError('invalid_mode','AGENTKEY_MODE must be local or cloud.');
 if(!cfg.apiKey)throw new AgentKeyError('missing_api_key','Cloud mode needs AGENTKEY_API_KEY. Run `npx tryagentkey link`, or remove AGENTKEY_MODE=cloud for Free Local Mode.');
 const k=decodeApiKey(options.apiKey??cfg.apiKey);
 const token=tokenSource(k,fetchImpl);
 const client=new AgentKeyClient({baseURL,token,fetchImpl});
 const state=store??fileStore(join(cwd,'.agentkey','runtime.json'));
 const project=detectProject(cwd);
 let runtime=options.runtime??null;

 async function ensureRuntime(){
  if(runtime)return runtime;
  const saved=state.load(),persist=key=>s=>state.save({key,session:s});
  const {AgentKeyRuntime,exportRuntimeKey,importRuntimeKey}=await import('@tryagentkey/runtime').catch(()=>import('../agentkey-runtime/index.mjs'));
  if(saved?.key&&saved?.session){
   const key=await importRuntimeKey(saved.key);
   runtime=new AgentKeyRuntime({baseURL,key,session:saved.session,fetchImpl,onSession:persist(saved.key)});
  }else{
   let exported;
   const r=await AgentKeyRuntime.enroll({baseURL,fetchImpl,agentToken:await token(),agentId:k.agent_id,label:options.label??'Agent browser',onSession:async s=>{state.save({key:exported,session:s});}});
   exported=await exportRuntimeKey(r.key);state.save({key:exported,session:r.runtime.session});
   runtime=r.runtime;runtime.onSession=persist(exported);
   onLink(r.approvalURL,'trust this agent browser once');
  }
  await runtime.waitUntilEnabled({intervalMs:pollMs});
  return runtime;
 }

 async function waitApproved(request_id,timeoutMs){
  const end=Date.now()+timeoutMs;
  for(;;){const s=await client.requestStatus(request_id);
   if(s.state==='approved'&&s.grant_id)return s;
   if(s.state&&s.state!=='pending')throw new AgentKeyError('request_'+s.state,'The owner did not approve this login.');
   if(Date.now()>end)throw new AgentKeyError('approval_pending','Still waiting for the owner. Call login() again to keep waiting on the same request.');
   await sleep(pollMs);}
 }

 // Sign the agent's own page in. One call: approval → fill → verify.
 async function login(url,{page,verify,successSelector,timeoutMs=600000}={}){
  const target=new URL(url);if(target.protocol!=='https:')throw new AgentKeyError('invalid_url','Use an https sign-in page.');
  page??=options.page;
  if(!page)throw new AgentKeyError('page_required','Pass your Playwright/Puppeteer page: ak.login(url, { page }).');
  if(new URL(page.url()).origin!==target.origin)await page.goto(target.href);
  const rt=await ensureRuntime();const e=await rt.enrollment();
  const {targetId}=await rt.registerTarget({origin:target.origin});
  const req=await client.requestTarget({agent_id:k.agent_id,executor_id:e.executor_id,target_id:targetId});
  if(req.status!=='approved'&&req.request_url)onLink(req.request_url,`approve sign-in to ${target.hostname}`);
  const ok=await waitApproved(req.request_id,timeoutMs);
  const op=await client.use(ok.grant_id,{origin:target.origin,executor_key_id:ok.executor_key_id??e.key_id,idempotency_key:crypto.randomUUID()});
  if(!op.operation_id)throw new AgentKeyError(op.code||'operation_unavailable',op.next_action);
  // Positive confirmation: the caller's check, or real signed-in evidence after the submit (never "no form visible").
  const signinUrl=String(page.url());
  const confirm=verify??(p=>waitConfirmed(p,{signinUrl,successSelector,submitted:true},8000));
  const r=await rt.fillOperation(op.operation_id,page,{targetBound:true,verify:confirm});
  return {site:target.hostname,signed_in:r.outcome==='completed',outcome:r.outcome,operation_id:r.operation_id};
 }

 const plain={
  agentkey_login:{description:'Sign the current browser page into a website using an owner-approved AgentKey login. The password is never shown to you.',
   parameters:{type:'object',properties:{url:{type:'string',description:'https sign-in page'}},required:['url'],additionalProperties:false},
   execute:({url})=>login(url)},
 };
 const withAuth=async(url,fn,o={})=>{const r=await login(url,o);if(!r.signed_in)throw new AgentKeyError('not_signed_in');return fn(o.page??options.page,r);};
 const tools=await shapeTools(plain,project.framework,{login,withAuth});
 return {mode:'cloud',login,withAuth,tools,project,agentId:k.agent_id,client,ensureRuntime,vault:{getSecret:()=>undefined,sites:async()=>(await client.call('/v1/inventory',undefined,['sites'])).sites??[]},setPage:p=>{options.page=p;}};
}

async function localAgentkey(options){
 const {cwd}=options;const project=detectProject(cwd);
 const local=createLocal({...(options.home?{home:options.home}:{}),onLink:options.onLink,...(options.open?{open:options.open}:{}),...(options.onApprovalURL?{onApprovalURL:options.onApprovalURL}:{}),agentName:options.agentName??'your agent',cwd,...(options.permissionDays?{permissionDays:options.permissionDays}:{})});
 // Self-healing first run: approve once, then remember this project.
 const setup=async()=>{const id=await local.setup();const cfg=readEnv(options.env??process.env,cwd);if(cfg.localKey!==id||cfg.mode!=='local')writeEnvVars(cwd,{AGENTKEY_MODE:'local',AGENTKEY_LOCAL_KEY:id});return id;};
 const login=async(url,o={})=>{await setup();return local.login(url,{...o,page:o.page??options.page});};
 const withAuth=async(url,fn,o={})=>{await setup();return local.withAuth(url,fn,{...o,page:o.page??options.page});};
 const plain={agentkey_login:{description:'Sign the current browser page into a website using a login the owner approved on this computer. The password is never shown to you.',
  parameters:{type:'object',properties:{url:{type:'string',description:'https sign-in page'}},required:['url'],additionalProperties:false},execute:({url})=>login(url)}};
 const tools=await shapeTools(plain,project.framework,{login,withAuth});
 return {mode:'local',login,withAuth,tools,project,vault:local.vaultApi,setup,ensureRuntime:setup,setPage:p=>{options.page=p;}};
}

async function shapeTools(plain,framework,fns){
 const entries=Object.entries(plain);
 try{
  if(framework==='vercel-ai'){const {tool,jsonSchema}=await import('ai');return Object.fromEntries(entries.map(([n,t])=>[n,tool({description:t.description,inputSchema:jsonSchema(t.parameters),parameters:jsonSchema(t.parameters),execute:a=>t.execute(a)})]));}
  if(framework==='openai-agents'){const {tool}=await import('@openai/agents');return entries.map(([n,t])=>tool({name:n,description:t.description,parameters:t.parameters,strict:false,execute:a=>t.execute(a)}));}
  if(framework==='mcp')return {tools:entries.map(([n,t])=>({name:n,description:t.description,inputSchema:t.parameters})),call:async(name,args)=>{const t=plain[name];if(!t)throw new AgentKeyError('unknown_tool');return {content:[{type:'text',text:JSON.stringify(await t.execute(args??{}))}]};},login:fns.login,withAuth:fns.withAuth};
  if(framework==='mastra'){const {createTool}=await import('@mastra/core/tools');const {z}=await import('zod');return Object.fromEntries(entries.map(([n,t])=>[n,createTool({id:n,description:t.description,inputSchema:z.object({url:z.string().url().describe('https sign-in page')}).strict(),execute:async(input)=>t.execute(input)})]));}
  if(framework==='langchain'){const {DynamicStructuredTool}=await import('@langchain/core/tools');return entries.map(([n,t])=>new DynamicStructuredTool({name:n,description:t.description,schema:t.parameters,func:async a=>JSON.stringify(await t.execute(a))}));}
 }catch{}
 // Plain JS/TS: tools.login(url), tools.withAuth(url, fn), plus the tool definition.
 return {...Object.fromEntries(entries.map(([n,t])=>[n,{...t,execute:a=>t.execute(a)}])),login:fns.login,withAuth:fns.withAuth};
}
