// Free Local Mode: single user, everything on this computer, no cloud calls.
import {openVault,agentkeyHome} from './vault.mjs';
import {startApproval} from './approve.mjs';
import {fillLogin,pageState} from './fill.mjs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {basename} from 'node:path';

export function openInBrowser(url){
 if(process.env.CI||process.env.AGENTKEY_NO_OPEN)return;
 const cmd=process.platform==='darwin'?['open',[url]]:process.platform==='win32'?['cmd',['/c','start','',url]]:['xdg-open',[url]];
 try{spawn(cmd[0],cmd[1],{stdio:'ignore',detached:true}).on('error',()=>{}).unref();}catch{}
}
const defaultLink=(url,why)=>console.log(`\nAgentKey: ${why}\n  here is your link → ${url}\n`);
const originOf=u=>{const x=new URL(u);const loop=['127.0.0.1','localhost','[::1]'].includes(x.hostname);if(x.protocol!=='https:'&&!(x.protocol==='http:'&&loop))throw Object.assign(Error('invalid_url'),{code:'invalid_url',hint:'Use an https sign-in page.'});return x.origin;};
// Project scope = this project folder (same hash in the Python SDK).
export function projectScope(cwd=process.cwd()){let p=cwd;try{p=realpathSync(cwd);}catch{}return {project_id:createHash('sha256').update(p).digest('hex').slice(0,16),project:basename(p)};}

export function createLocal({home=agentkeyHome(),cwd=process.cwd(),onLink=defaultLink,open=openInBrowser,onApprovalURL,agentName='your agent',approvalTimeoutMs=600000,handoffTimeoutMs=300000,permissionDays=null,singleSubmission=false}={}){
 const vault=openVault(home);const proj=projectScope(cwd);
 const scopeFor=origin=>({origin,project_id:proj.project_id,agent:String(agentName)});
 async function ask(origin,why,mode){
  const a=startApproval({origin,agentName,project:proj.project,mode,timeoutMs:approvalTimeoutMs});const url=await a.ready;
  onLink(url,why);open(url);await onApprovalURL?.(url);return a.result;
 }
 async function setup(){if(vault.exists())return vault.id;await ask(undefined,'approve Free Local Mode on this computer','setup');return vault.init();}

 // Valid standing permission for this exact site + saved login + project + agent is reused without asking.
 async function permit(site){
  const scope=scopeFor(site);
  const have=vault.findPermission(scope);if(have)return have;
  const saved=vault.hasLogin(site);const host=new URL(site).host;
  const r=await ask(site,saved?`allow ${agentName} to use your saved ${host} login`:`approve sign-in to ${host}`,saved?'allow':'save');
  if(!saved)vault.putLogin(site,r);
  return vault.grant({...scope,project:proj.project,max_uses:r.duration==='once'?1:null,expires_at:permissionDays?Date.now()+permissionDays*864e5:null});
 }

 async function login(url,{page,verify,successSelector,resolveFormRoot}={}){
  if(!page)throw Object.assign(Error('page_required'),{code:'page_required',hint:'Pass your Playwright/Puppeteer page: ak.login(url, { page }).'});
  originOf(url);await setup();
  if(page.url()!==url)await page.goto(url);
  const site=originOf(page.url()); // after redirects, e.g. a single sign-on page
  const perm=await permit(site);
  if(originOf(page.url())!==site)throw Error('page_origin_mismatch');
  const formRoot=resolveFormRoot?await resolveFormRoot(page):undefined;
  if(originOf(page.url())!==site)throw Error('page_origin_mismatch');
  const r=await fillLogin(page,()=>vault._useCredential(perm.id,scopeFor(site)),{origin:site,verify,successSelector,handoffTimeoutMs,singleSubmission,formRoot,resolveFormRoot,onHandoff:async p=>{
   try{await p.bringToFront?.();}catch{}
   console.log(`\nAgentKey: ${new URL(site).host} needs you (a check or code). Finish it in the browser window; your agent continues automatically.\n`);}});
  return {site:new URL(site).host,signed_in:r.outcome==='completed',outcome:r.outcome,permission_id:perm.id,...(r.confirmed_by?{confirmed_by:r.confirmed_by}:{}),...(r.handoff?{handoff:true}:{}),...(r.code?{code:r.code}:{})};
 }
 async function withAuth(url,fn,{page,verify,successSelector}={}){const r=await login(url,{page,verify,successSelector});if(!r.signed_in)throw Object.assign(Error('not_signed_in'),{code:r.code||'not_signed_in',result:r});return fn(page,r);}
 return {mode:'local',setup,login,withAuth,pageState,
  vaultApi:{getSecret:n=>vault.getSecret(n),setSecret:(n,v)=>vault.setSecret(n,v),sites:()=>vault.sites(),permissions:()=>vault.permissions(),
   revoke:t=>vault.revoke(t==='all'?'all':/^[0-9a-f-]{36}$/i.test(t)?t:originOf(t)),forget:o=>vault.forget(originOf(o))}};
}
