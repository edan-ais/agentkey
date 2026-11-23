// Framework-side orchestration. No credential, browser launcher or cookie API.
// host is a trusted installed adapter, not an object supplied by a tool call.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TOKEN=/^[a-f0-9]{32}$/;
const KEY=/^[A-Za-z0-9+/]{43}=$/;
function id(x){if(!UUID.test(x??''))throw Error('invalid_id');return x;}
function https(x){const u=new URL(x);if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error('invalid_target_url');return u;}
export function createExistingBrowserLogin({client,host,now=Date.now,randomId=()=>crypto.randomUUID()}={}){
 if(!client||!['requestTarget','requestStatus','use'].every(k=>typeof client[k]==='function')||!host||!['prepareTarget','executeTarget','verifyLogin'].every(k=>typeof host[k]==='function'))throw Error('existing_browser_integration_required');
 const flows=new Map();
 function receipt(f,status,extra={}){return{login_id:f.id,request_id:f.request_id,status,...(f.target.login_step?{login_step:f.target.login_step}:{}),...extra};}
 function completion(f,checked){
  f.phase=checked?.authenticated===true&&checked?.same_browser===true?'signed_in':checked?.same_browser===true&&checked?.challenge==='one_time_code'?'challenge_required':'login_unverified';
  return receipt(f,f.phase,{filled:true,login_verified:f.phase==='signed_in',...(f.phase==='challenge_required'?{challenge_type:'one_time_code',next_action:'complete_challenge_in_existing_browser_then_recheck'}:{})});
 }
 async function begin({agent_id,intended_url,login_plan}={}){
  id(agent_id);const url=https(intended_url);
  const t=await host.prepareTarget(url.href,login_plan);
  if(t?.version!==2||!TOKEN.test(t.target_id??'')||!UUID.test(t.executor_id??'')||!UUID.test(t.executor_key_id??'')||!KEY.test(t.executor_key??'')||t.origin!==url.origin||!Number.isSafeInteger(t.target_expires_at)||t.target_expires_at<=now()||t.target_expires_at>now()+300000)throw Error('invalid_delivery_target');
  const r=await client.requestTarget({agent_id,executor_id:t.executor_id,target_id:t.target_id});
  if(!r||!UUID.test(r.request_id??'')||r.status!=='pending'||r.origin!==t.origin||r.executor_id!==t.executor_id||r.executor_key_id!==t.executor_key_id||!Number.isFinite(Date.parse(r.expires_at)))throw Error('target_request_mismatch');
  const link=https(r.request_url);if(link.origin!=='https://agentkey.waiwiser.com')throw Error('invalid_approval_url');
  const f={id:id(randomId()),request_id:r.request_id,agent_id,target:t,expires:Math.min(t.target_expires_at,Date.parse(r.expires_at)),idempotency_key:id(randomId()),phase:'waiting',busy:false};
  if(f.expires<=now()||flows.has(f.id))throw Error('expired_or_duplicate_flow');flows.set(f.id,f);
  return receipt(f,'awaiting_approval',{approval_url:link.href,expires_at:new Date(f.expires).toISOString()});
 }
 async function resume(login_id){
  const f=flows.get(id(login_id));if(!f)throw Error('unknown_login');
  if(f.busy)return receipt(f,'in_progress');
  if(['login_unverified','challenge_required'].includes(f.phase)){
   if(now()>=f.expires)return receipt(f,'login_unverified',{filled:true,login_verified:false,next_action:'verification_window_expired'});f.busy=true;
   try{const checked=await host.verifyLogin(f.target);return completion(f,checked);}
   catch{return receipt(f,'login_unverified',{filled:true,login_verified:false});}finally{f.busy=false;}
  }
  if(f.phase!=='waiting')return receipt(f,f.phase);
  if(now()>=f.expires){f.phase='expired';return receipt(f,f.phase);}
  f.busy=true;
  try{
   const r=await client.requestStatus(f.request_id);
   if(!r||r.request_id!==f.request_id||r.agent_id!==f.agent_id||r.executor_id!==f.target.executor_id||r.executor_key_id!==f.target.executor_key_id||r.origin!==f.target.origin)throw Error('request_scope_mismatch');
   if(r.state==='pending')return receipt(f,'awaiting_approval');
   if(r.state!=='approved'){f.phase=['denied','expired','revoked'].includes(r.state)?r.state:'unavailable';return receipt(f,f.phase);}
   id(r.grant_id);if(now()>=f.expires){f.phase='expired';return receipt(f,f.phase);}
   // From this point an ambiguous network failure is terminal. Never refill.
   f.phase='unknown';
   const op=await client.use(r.grant_id,{origin:f.target.origin,executor_key_id:f.target.executor_key_id,idempotency_key:f.idempotency_key});
   if(!UUID.test(op?.operation_id??'')||op.status!=='pending')throw Error('operation_unavailable');
   const fill=await host.executeTarget(op.operation_id,f.target);
   if(fill?.ok!==true||fill.filled!==true){f.phase='fill_failed';return receipt(f,f.phase);}
   if(f.target.login_step==='username'){
    f.phase='step_completed';
    return receipt(f,f.phase,{filled:true,login_verified:false,next_action:'inspect_next_page_and_request_new_approval'});
   }
   // Only the registered trusted host verifier can assert authentication.
   const checked=await host.verifyLogin(f.target);
   return completion(f,checked);
  }catch{if(f.phase==='waiting')f.phase='unavailable';return receipt(f,f.phase);}
  finally{f.busy=false;}
 }
 return{begin,resume};
}

// Register once in the trusted agent framework; tool arguments cannot replace host.
export function existingBrowserLoginTools(flow){
 if(typeof flow?.begin!=='function'||typeof flow?.resume!=='function')throw Error('login_flow_required');
 return{agentkey_login_begin:args=>flow.begin(args),agentkey_login_resume:({login_id})=>flow.resume(login_id)};
}
