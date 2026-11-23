// AgentKey runtime for an agent's own existing browser, with no extension.
// Runs in the agent's runtime process beside its already-open browser
// (Playwright/Puppeteer page objects the agent already holds). It never
// launches a browser, opens a context or exports cookies. The private key and
// opened credentials stay in this process; nothing here logs or returns them.
import {webcrypto as crypto} from 'node:crypto';
const enc=new TextEncoder(),dec=new TextDecoder();
const b64e=u=>Buffer.from(u).toString('base64'),b64d=s=>new Uint8Array(Buffer.from(s,'base64'));
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const NAMES=['ownerID','requestID','agentID','executorID','executorKeyID','itemID'];
const ALPHA='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export class RuntimeError extends Error{constructor(code,help){super(code);this.code=code;if(help)this.help=help;}}

export async function generateRuntimeKey(){
 const pair=await crypto.subtle.generateKey({name:'X25519'},true,['deriveBits']);
 return {privateKey:pair.privateKey,publicKeyB64:b64e(new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey)))};
}
// Persist with exportRuntimeKey into the runtime's own secret store; never log it.
export async function exportRuntimeKey(key){return {jwk:await crypto.subtle.exportKey('jwk',key.privateKey),publicKeyB64:key.publicKeyB64};}
export async function importRuntimeKey({jwk,publicKeyB64}){return {privateKey:await crypto.subtle.importKey('jwk',jwk,{name:'X25519'},true,['deriveBits']),publicKeyB64};}

async function aesKey(privateKey,ephemeralB64,info){
 const eph=await crypto.subtle.importKey('raw',b64d(ephemeralB64),{name:'X25519'},false,[]);
 const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'X25519',public:eph},privateKey,256));
 const hk=await crypto.subtle.importKey('raw',shared,{name:'HKDF'},false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:enc.encode('AgentKey.executor.v1'),info},hk,{name:'AES-GCM',length:256},false,['decrypt']);
}
async function openSealed(e,privateKey,binding){
 const k=await aesKey(privateKey,e.ephemeralPublicKey,binding),c=b64d(e.sealed);
 if(c.length<28)throw new RuntimeError('invalid_envelope');
 try{return JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:c.slice(0,12),additionalData:binding},k,c.slice(12))));}catch{throw new RuntimeError('scope_mismatch');}
}
export async function openSessionEnvelope(encoded,pairingId,key){
 const binding=enc.encode(['AgentKey.deviceSession.v1',pairingId.toLowerCase(),key.publicKeyB64].join('\n'));
 const e=JSON.parse(dec.decode(b64d(encoded)));if(!e||e.version!==1)throw new RuntimeError('invalid_envelope');
 const p=await openSealed(e,key.privateKey,binding);
 if(p?.pairing_id!==pairingId||typeof p.access_token!=='string'||typeof p.refresh_token!=='string')throw new RuntimeError('invalid_envelope');
 return {access_token:p.access_token,refresh_token:p.refresh_token,expires_at:p.expires_at??0};
}
function validOrigin(o){try{const u=new URL(o);return u.protocol==='https:'&&u.origin===o;}catch{return false;}}
function targetBinding(s,now){
 const t=s.deliveryTarget;if(t===undefined)return [];
 if(!t||t.version!==2||!/^[a-f0-9]{32}$/.test(t.targetID)||!/^[A-Za-z0-9+/]{43}=$/.test(t.executorPublicKey)||t.origin!==s.origin||!Number.isSafeInteger(t.expiresAt)||t.expiresAt<=now||t.expiresAt>now+300000||s.maxUses!==1)throw new RuntimeError('scope_mismatch');
 return ['AgentKey.deliveryTarget.v2',t.targetID,t.executorPublicKey,t.origin,String(t.expiresAt)];
}
export function scopeBinding(s,now=Date.now()){
 if(!s||typeof s!=='object'||Array.isArray(s))throw new RuntimeError('scope_mismatch');
 if(s.auxOrigins!==undefined&&(!Array.isArray(s.auxOrigins)||s.auxOrigins.length>4||s.auxOrigins.some(o=>!validOrigin(o))))throw new RuntimeError('scope_mismatch');
 const auxOrigins=s.auxOrigins===undefined?[]:[...new Set(s.auxOrigins)].sort();
 if(Object.hasOwn(s,'standingGrantID')){
  const names=['ownerID','standingGrantID','agentID','executorID','executorKeyID','itemID'];
  for(const n of names)if(typeof s[n]!=='string'||!UUID.test(s[n]))throw new RuntimeError('scope_mismatch');
  if(!Number.isSafeInteger(s.itemVersion)||s.itemVersion<1||s.action!=='credential.fill'||!validOrigin(s.origin)||s.requestID!==undefined||s.expiresAt!==undefined||s.maxUses!==undefined||s.deliveryTarget!==undefined)throw new RuntimeError('scope_mismatch');
  return enc.encode(['AgentKey.standing-envelope.v1',...names.map(n=>s[n].toLowerCase()),String(s.itemVersion),s.origin,s.action,...auxOrigins].join('\n'));
 }
 for(const n of NAMES)if(typeof s[n]!=='string'||!UUID.test(s[n]))throw new RuntimeError('scope_mismatch');
 if(s.action!=='credential.fill'||!validOrigin(s.origin)||!Number.isSafeInteger(s.itemVersion)||!Number.isSafeInteger(s.expiresAt)||!Number.isSafeInteger(s.maxUses)||s.maxUses<1||s.maxUses>3)throw new RuntimeError('scope_mismatch');
 if(now/1000>=s.expiresAt)throw new RuntimeError('inactive_grant');
 const aux=s.auxOrigins===undefined?[]:[...new Set(s.auxOrigins)].sort();
 if(aux.some(o=>!validOrigin(o))||aux.length>4)throw new RuntimeError('scope_mismatch');
 return enc.encode([s.deliveryTarget?'AgentKey.envelope.v2':'AgentKey.envelope.v1',...NAMES.map(n=>s[n].toLowerCase()),String(s.itemVersion),s.origin,s.action,String(s.expiresAt),String(s.maxUses),...aux,...targetBinding(s,now)].join('\n'));
}
export async function openGrantEnvelope(encoded,scope,key){
 const binding=scopeBinding(scope);
 if(typeof encoded!=='string'||encoded.length>65536)throw new RuntimeError('invalid_envelope');
 const e=JSON.parse(dec.decode(b64d(encoded)));if(!e||e.version!==(scope.deliveryTarget?2:1))throw new RuntimeError('invalid_envelope');
 const p=await openSealed(e,key.privateKey,binding);
 if(!p?.scope||!Buffer.from(scopeBinding(p.scope)).equals(Buffer.from(binding))||typeof p.username!=='string'||typeof p.password!=='string'||p.session!==undefined)throw new RuntimeError('scope_mismatch');
 return {username:p.username,password:p.password};
}

export class AgentKeyRuntime{
 constructor({baseURL='https://agentkey.waiwiser.com/api/public/agentkey-api',key,session,onSession,fetchImpl=fetch}){Object.assign(this,{baseURL,key,session,onSession,fetchImpl});}
 async #call(method,path,body,bearer){
  const r=await this.fetchImpl(this.baseURL+path,{method,headers:{...(bearer?{Authorization:'Bearer '+bearer}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(15000)});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new RuntimeError(j.code||'request_failed',j.help);return j;
 }
 // Ask AgentKey for the fastest path and the next exact call. Guidance only:
 // it grants nothing, and owner approval still gates every login.
 static async guide({baseURL='https://agentkey.waiwiser.com/api/public/agentkey-api',agentToken,agentId,goal,environment={browser:'automation',can_run_code:true},fetchImpl=fetch}={}){
  const r=await fetchImpl(baseURL+'/v1/guide',{method:'POST',headers:{'Content-Type':'application/json',...(agentToken?{Authorization:'Bearer '+agentToken}:{})},body:JSON.stringify({environment,...(goal?{goal}:{}),...(agentId?{agent_id:agentId}:{})})});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new RuntimeError(j.code||'request_failed',j.help);return j;
 }
 async guide(){return AgentKeyRuntime.guide({baseURL:this.baseURL,agentToken:await this.#token(),fetchImpl:this.fetchImpl});}
 // Enroll a fresh runtime with the agent's own requester token. Returns the
 // owner approval link; the runtime stays disabled until the owner enables it.
 static async enroll({baseURL,agentToken,agentId,label,key,fetchImpl=fetch,onSession}){
  key??=await generateRuntimeKey();
  const rt=new AgentKeyRuntime({baseURL,key,fetchImpl,onSession});
  const code=Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>ALPHA[b%36]).join('');
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',enc.encode(code))).toString('hex');
  const p=await rt.#call('POST','/v1/executor/pairings',{agent_id:agentId,code_hash:hash,...(label?{label}:{})},agentToken);
  const red=await rt.#call('POST','/v1/executor/redeem',{code,public_key:key.publicKeyB64});
  rt.session=await openSessionEnvelope(red.sealed_session,red.pairing_id,key);await onSession?.(rt.session);
  return {runtime:rt,key,approvalURL:p.approval_url,pairingId:p.pairing_id};
 }
 #refreshing=null;
 #sessionUnsaved=false;
 async #token(){
  if(!this.session)throw new RuntimeError('not_enrolled');
  if(this.#refreshing)await this.#refreshing;
  else if(this.#sessionUnsaved||(this.session.expires_at&&this.session.expires_at*1000<Date.now()+60000)){
   this.#refreshing??=(async()=>{
    if(!this.#sessionUnsaved){this.session=await this.#call('POST','/v1/executor/session/refresh',{refresh_token:this.session.refresh_token});this.#sessionUnsaved=true;}
    await this.onSession?.(this.session);this.#sessionUnsaved=false;
   })().finally(()=>{this.#refreshing=null;});
   await this.#refreshing;
  }
  return this.session.access_token;
 }
 async self(){const {executors}=await this.#call('GET','/v1/executor/self',null,await this.#token());return executors.filter(e=>e.enabled&&e.public_key===this.key.publicKeyB64);}
 async enrollment(){const rows=await this.self();if(rows.length!==1)throw new RuntimeError('executor_not_enabled');return rows[0];}
 async waitUntilEnabled({timeoutMs=600000,intervalMs=3000}={}){const end=Date.now()+timeoutMs;for(;;){const rows=await this.self();if(rows.length===1)return rows[0];if(Date.now()>end)throw new RuntimeError('owner_approval_pending');await new Promise(r=>setTimeout(r,intervalMs));}}
 async heartbeat(){return (await this.#call('POST','/v1/executor/heartbeat',{public_key:this.key.publicKeyB64},await this.#token())).recorded;}
 async pending(){return (await this.#call('GET','/v1/executor/pending',null,await this.#token())).operations;}
 async preview(id){return this.#call('GET','/v1/executor/operations/'+id,null,await this.#token());}
 async complete(id,outcome){return this.#call('POST','/v1/executor/operations/'+id+'/complete',{outcome},await this.#token());}
 async registerTarget({origin,targetId,ttlMs=300000}){
  const e=await this.enrollment();targetId??=Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex');
  const r=await this.#call('POST','/v1/executor/targets',{executor_id:e.executor_id,key_id:e.key_id,target_id:targetId,origin,expires_epoch_ms:Date.now()+Math.min(ttlMs,300000)},await this.#token());
  return {targetId,executorId:e.executor_id,target:r.target};
 }
 // Glove host calls (packages/agentkey-glove). The glove host is this same
 // owner-trusted runtime; it only ever follows the agent's own commands.
 async gloveHost({executorId,connectURL,capacity}){return this.#call('POST','/v1/executor/glove/host',{executor_id:executorId,connect_url:connectURL,capacity},await this.#token());}
 async gloveRedeem({executorId,ticket}){return this.#call('POST','/v1/executor/glove/redeem',{executor_id:executorId,ticket},await this.#token());}
 async gloveHeartbeat({executorId,sessions}){return (await this.#call('POST','/v1/executor/glove/heartbeat',{executor_id:executorId,sessions},await this.#token())).open;}
 async gloveClose({executorId,sessionId,reason}){return this.#call('POST','/v1/executor/glove/sessions/'+sessionId+'/close',{executor_id:executorId,reason},await this.#token());}
 // Claim one operation and fill it into the agent's EXISTING page. Fails
 // closed unless the page's current origin exactly matches the grant origin.
 // Reports exactly one outcome; a submitted form is reported as 'unknown'
 // unless verify() confirms the signed-in state.
 async fillOperation(operationId,page,{usernameSelector='input[autocomplete="username"],input[type="email"],input[name*="user" i],input[name*="email" i]',passwordSelector='input[type="password"]',submit=true,verify,targetBound=false,gloveSessionId,onSecret}={}){
  if(!UUID.test(operationId)||(gloveSessionId!==undefined&&(!UUID.test(gloveSessionId)||targetBound)))throw new RuntimeError('invalid_request');
  if(verify!==undefined&&typeof verify!=='function')throw new RuntimeError('invalid_verification');
  const pageOrigin=new URL(page.url()).origin;
  const claim=await this.#call('POST','/v1/executor/'+(targetBound?'target-operations/':'operations/')+operationId+'/claim',gloveSessionId?{glove_session_id:gloveSessionId}:{},await this.#token());
  let cred,outcome='failed',submitted=false,verification='not_requested',failure=null;
  try{
   if(claim.scope.origin!==pageOrigin||new URL(page.url()).origin!==pageOrigin)throw new RuntimeError('page_origin_mismatch');
   if(gloveSessionId&&claim.glove_session_id!==gloveSessionId)throw new RuntimeError('glove_session_mismatch');
   cred=await openGrantEnvelope(claim.encoded,claim.scope,this.key);
   // Host-only sink for output redaction. Never returned, logged or accepted
   // from a wire command. It remains in this same credential process.
   onSecret?.(cred.password);
   const pw=page.locator(passwordSelector);if(await pw.count()!==1)throw new RuntimeError('login_form_ambiguous');
   const user=page.locator(usernameSelector);const uc=await user.count();if(uc>1)throw new RuntimeError('login_form_ambiguous');
   if(uc===1)await user.first().fill(cred.username);
   await pw.fill(cred.password);
   cred=null;
   if(submit){
    submitted=true; // Set before dispatch: a timeout may still have submitted.
    await pw.press('Enter');
    if(verify){verification=(await verify(page))?'matched':'not_matched';outcome=verification==='matched'?'completed':'unknown';}
    else outcome='unknown';
   }else outcome='completed';
  }catch(e){
   failure=e;
   outcome=submitted?'unknown':'failed';
   if(submitted&&verify)verification='unconfirmed';
  }finally{cred=null;}
  // Exactly one completion attempt. Never retry an uncertain submission or
  // convert a verifier/navigation error after submission into a failed login.
  await this.complete(operationId,outcome);
  if(failure&&!submitted)throw failure;
  return {operation_id:operationId,outcome,submitted,verification,...(failure?{code:'submission_unconfirmed'}:{})};
 }
}
