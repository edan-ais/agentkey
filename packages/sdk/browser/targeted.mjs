// Trusted framework integration. Uses existing objects only. No launch/attach API.
// withCredentialUse must enforce the framework's exclusive secret-use boundary:
// pause model reads/screenshots/recording until submission and cleanup finish.
import { connectExistingBrowser } from './index.mjs';
const SITE='https://agentkey.waiwiser.com', TOKEN=/^[a-f0-9]{32}$/, UUID=/^[a-f0-9-]{36}$/i;
export function createTargetedBrowserHost({browser,relayPage,expectedPublicKey,withCredentialUse,signInAdapter,genericOnly=false,extensionID}={}){
 if(!browser||typeof browser.contexts!=='function'||!relayPage||typeof withCredentialUse!=='function'||(!genericOnly&&(typeof signInAdapter?.submit!=='function'||typeof signInAdapter?.verify!=='function'||typeof signInAdapter?.clear!=='function')))throw Error('trusted_existing_browser_integration_required');
 const relay=connectExistingBrowser({page:relayPage,expectedPublicKey,extensionID});
 if(!expectedPublicKey)throw Error('executor_key_verification_required');
 const relayContexts=browser.contexts().filter(c=>c.pages().includes(relayPage));
 if(relayContexts.length!==1)throw Error('relay_context_missing_or_ambiguous');
 const pinnedContext=relayContexts[0];
 const targets=new Map();
 function pages(){
  if(typeof browser.isConnected==='function'&&!browser.isConnected())throw Error('existing_browser_not_connected');
  if(!browser.contexts().includes(pinnedContext))throw Error('relay_context_disconnected');
  const existing=pinnedContext.pages();
  if(!existing.includes(relayPage)||relayPage.isClosed?.())throw Error('existing_agentkey_tab_required');
  return existing;
 }
 function current(t){const r=targets.get(t?.target_id);if(!r||r.target!==t||!pages().includes(r.page)||r.page.isClosed?.())throw Error('target_not_in_existing_browser');return r;}
 async function send(message){
  if(new URL(relayPage.url()).origin!==SITE)throw Error('agentkey_tab_required');
  const result=await relayPage.evaluate(async({site,extension,message})=>{
   if(location.origin!==site||typeof chrome==='undefined'||!chrome.runtime?.sendMessage)return{ok:false};
   return await new Promise(resolve=>{
    let settled=false;const finish=value=>{if(!settled){settled=true;clearTimeout(timer);resolve(value);}};
    const timer=setTimeout(()=>finish({ok:false}),10000);
    try{chrome.runtime.sendMessage(extension,message,r=>{
     if(chrome.runtime.lastError||r?.ok!==true)return finish({ok:false});
     if(message.type==='agentkey:target-support-v2')return finish({ok:true,version:r.version,ready:r.ready===true,generic:r.generic===true,human_verification_guard:r.human_verification_guard===true});
     if(message.type==='agentkey:inspect-target-v2')return finish({ok:true,plan_id:r.plan_id,origin:r.origin,expires_at:r.expires_at,controls:Array.isArray(r.controls)?r.controls.map(c=>({ref:c.ref,tag:c.tag,type:c.type,autocomplete:c.autocomplete,label:c.label})):[]});
     if(message.type==='agentkey:verify-target-v2')return finish({ok:true,authenticated:r.authenticated===true&&!['one_time_code','human_verification'].includes(r.challenge),...(['one_time_code','human_verification'].includes(r.challenge)?{challenge:r.challenge}:{})});
     if(message.type==='agentkey:prepare-target-v2')return finish({ok:true,version:r.version,target_id:r.target_id,executor_id:r.executor_id,executor_key_id:r.executor_key_id,executor_key:r.executor_key,origin:r.origin,target_expires_at:r.target_expires_at});
     finish({ok:true,filled:r.filled===true,submitted:r.submitted===true,cleared:r.cleared===true});
    });}catch{finish({ok:false});}
   });
  },{site:SITE,extension:extensionID??'mbaclpelnfllnmbdcogmjlklfdklmamc',message});
  if(result?.ok!==true)throw Error('target_protocol_unavailable');return result;
 }
 return{
  async setupStatus(){
   // Readiness is not installation or login success. Never launch as fallback.
   try{
    const s=await relay.status();
    if(!s.paired)return{connected:true,paired:false,target_protocol_ready:false,next_action:'pair_installed_extension'};
    let ready=false;try{const c=await send({type:'agentkey:target-support-v2'});ready=c.version===2&&c.ready===true&&c.human_verification_guard===true&&(!genericOnly||c.generic===true);}catch{}
    return{connected:true,paired:true,target_protocol_ready:ready,next_action:ready?'prepare_existing_target':'update_executor_or_server'};
   }
   catch{return{connected:false,paired:false,target_protocol_ready:false,next_action:'provision_extension_in_existing_browser'};}
  },
  async inspectTarget(intended_url){
   const status=await relay.status();if(!status.paired)throw Error('existing_browser_not_paired');
   const url=new URL(intended_url);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw Error('invalid_target_url');
   const matches=pages().filter(p=>!p.isClosed?.()&&p.url()===url.href);if(matches.length!==1)throw Error('existing_target_missing_or_ambiguous');
   return await send({type:'agentkey:inspect-target-v2',intended_url:url.href});
  },
  async prepareTarget(intended_url,login_plan){
   if(genericOnly&&!login_plan)throw Error('opaque_login_plan_required');
   const u=new URL(intended_url);if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error('invalid_target_url');
   const s=await relay.status();if(!s.paired)throw Error('existing_browser_not_paired');
   const matches=pages().filter(p=>!p.isClosed?.()&&p.url()===u.href);
   if(matches.length!==1)throw Error('existing_target_missing_or_ambiguous');
   const t=await send({type:'agentkey:prepare-target-v2',intended_url:u.href,...(login_plan?{login_plan}:{})});
   if(login_plan)t.login_step=login_plan.password_ref?(login_plan.username_ref?'username_and_password':'password'):'username';
   if(t.version!==2||!TOKEN.test(t.target_id??'')||t.executor_key!==expectedPublicKey||t.origin!==u.origin||targets.has(t.target_id))throw Error('invalid_delivery_target');
   targets.set(t.target_id,{target:t,page:matches[0],intended_url:u.href,spent:false,filled:false,generic:!!login_plan});return t;
  },
  async preflightTarget(t){
   const r=current(t);if(r.spent||r.page.url()!==r.intended_url)throw Error('target_changed_or_consumed');
   await send({type:'agentkey:inspect-target-v2',intended_url:r.intended_url});
   current(t);if(r.page.url()!==r.intended_url)throw Error('target_changed');
  },
  async executeTarget(operation_id,t){
   if(!UUID.test(operation_id??''))throw Error('invalid_operation');const r=current(t);
   if(r.spent||r.page.url()!==r.intended_url)throw Error('target_changed_or_consumed');
   r.spent=true;
   return await withCredentialUse(async()=>{
    const s=await relay.status();if(!s.paired)throw Error('existing_browser_not_paired');
    if(current(t)!==r||r.page.url()!==r.intended_url)throw Error('target_changed');
    if(r.generic){
     const filled=await send({type:'agentkey:execute-target-v2',operation_id});
     if(filled.filled!==true||filled.submitted!==true||filled.cleared!==true)throw Error('generic_execution_or_cleanup_unverified');
     r.filled=true;return{ok:true,filled:true,login_verified:false};
    }
    try {
     const filled=await send({type:'agentkey:execute-target-v2',operation_id});
     if(filled.filled!==true)return{ok:false,filled:false};
     // Fixed trusted site adapter submits. No agent-supplied script or selectors.
     await signInAdapter.submit(r.page);
     r.filled=true;return{ok:true,filled:true,login_verified:false};
    } finally {
     // An ambiguous fill may have populated fields even when its reply was lost.
     let cleaned;try{cleaned=await signInAdapter.clear(r.page);}catch{r.filled=false;throw Error('credential_cleanup_unverified');}
     if(cleaned?.cleared!==true){r.filled=false;throw Error('credential_cleanup_unverified');}
    }
   });
  },
  async verifyLogin(t){
   const r=current(t);if(!r.spent||!r.filled)return{authenticated:false,same_browser:true};
   const proof=r.generic?await send({type:'agentkey:verify-target-v2',target_id:t.target_id}):{authenticated:await signInAdapter.verify(r.page)};
   const authenticated=proof.authenticated===true&&!['one_time_code','human_verification'].includes(proof.challenge);
   // Recheck page membership after asynchronous verifier before success.
   current(t);return{authenticated:authenticated===true&&new URL(r.page.url()).origin===t.origin,same_browser:true,...(!authenticated&&new URL(r.page.url()).origin===t.origin&&['one_time_code','human_verification'].includes(proof.challenge)?{challenge:proof.challenge}:{})};
  },
 };
}
