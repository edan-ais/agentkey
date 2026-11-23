// Free Local Mode vault: ~/.agentkey/vault.enc, AES-256-GCM, key bound to this
// machine (random machine.key mixed with the host name via HKDF). Holds saved
// logins, scoped permissions and developer secrets. Never website cookies.
//
// A saved login is not permission. Each permission is scoped to one site, one
// saved login version, one project folder and one agent name; it can be
// standing (until revoked), single-use, or expire. Every check re-reads the
// file, so `npx tryagentkey revoke` takes effect in a running agent at once.
import {readFileSync,writeFileSync,mkdirSync,existsSync,chmodSync,renameSync} from 'node:fs';
import {join} from 'node:path';import {homedir,hostname} from 'node:os';
import {randomBytes,createCipheriv,createDecipheriv,hkdfSync,randomUUID} from 'node:crypto';

export const agentkeyHome=(env=process.env)=>env.AGENTKEY_HOME||join(homedir(),'.agentkey');
const write=(p,data)=>{const tmp=p+'.'+randomBytes(4).toString('hex')+'.tmp';writeFileSync(tmp,data,{mode:0o600});chmodSync(tmp,0o600);renameSync(tmp,p);};

function machineKey(home){
 mkdirSync(home,{recursive:true,mode:0o700});const p=join(home,'machine.key');
 if(!existsSync(p))write(p,randomBytes(32));
 return Buffer.from(hkdfSync('sha256',readFileSync(p),Buffer.from(hostname()),Buffer.from('AgentKey.local.vault.v1'),32));
}
const empty=()=>({v:1,vault_id:randomUUID(),logins:{},permissions:{},secrets:{}});
const nowIso=()=>new Date().toISOString();

// Older vaults stored `approvals[origin]=true` (unscoped, forever). Those are
// dropped: the next login asks once to grant a scoped permission (no retyping).
export function normalize(d){
 if(!d)return d;
 d.logins??={};d.permissions??={};d.secrets??={};
 for(const l of Object.values(d.logins)){l.item_id??=randomUUID();l.version??=1;}
 delete d.approvals;
 return d;
}
export function permissionValid(p,login,{origin,project_id,agent},now=Date.now()){
 return !!p&&!!login&&p.origin===origin&&p.project_id===project_id&&p.agent===agent&&p.item_id===login.item_id&&p.item_version===login.version
  &&!p.revoked_at&&(p.expires_at==null||Date.parse(p.expires_at)>now)&&(p.max_uses==null||p.uses<p.max_uses);
}
const publicPermission=p=>({id:p.id,origin:p.origin,project:p.project,project_id:p.project_id,agent:p.agent,created_at:p.created_at,expires_at:p.expires_at??null,
 kind:p.max_uses==null?'standing':'limited',uses:p.uses,max_uses:p.max_uses??null,last_used_at:p.last_used_at??null});

export function openVault(home=agentkeyHome()){
 const file=join(home,'vault.enc');const key=machineKey(home);
 const read=()=>{
  if(!existsSync(file))return null;
  const raw=readFileSync(file);const iv=raw.subarray(0,12),tag=raw.subarray(12,28),ct=raw.subarray(28);
  const d=createDecipheriv('aes-256-gcm',key,iv);d.setAuthTag(tag);d.setAAD(Buffer.from('AgentKey.local.vault.v1'));
  try{return normalize(JSON.parse(Buffer.concat([d.update(ct),d.final()]).toString('utf8')));}catch{const e=Error('vault_unreadable');e.hint='The local vault was made on another computer or is damaged. Move ~/.agentkey/vault.enc aside and run `npx tryagentkey init`.';throw e;}
 };
 const save=d=>{const iv=randomBytes(12);const c=createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from('AgentKey.local.vault.v1'));const ct=Buffer.concat([c.update(JSON.stringify(d)),c.final()]);write(file,Buffer.concat([iv,c.getAuthTag(),ct]));};
 let data=read();
 const reload=()=>{data=read();return data;};
 const prune=()=>{for(const [id,p] of Object.entries(data.permissions))if(!permissionValid(p,data.logins[p.origin],p))delete data.permissions[id];};
 const api={
  file,home,exists:()=>(reload()!==null),reload,
  init(){reload();if(!data){data=empty();save(data);}return data.vault_id;},
  get id(){return data?.vault_id??null;},
  sites:()=>{reload();return Object.keys(data?.logins??{}).map(o=>({origin:o,username:data.logins[o].username,saved_at:data.logins[o].saved_at,
   permissions:Object.values(data.permissions).filter(p=>p.origin===o&&permissionValid(p,data.logins[o],p)).length}));},
  hasLogin:o=>{reload();return !!data?.logins[o];},
  putLogin(o,{username,password}){api.init();const prev=data.logins[o];
   data.logins[o]={item_id:prev?.item_id??randomUUID(),version:(prev?.version??0)+1,username:String(username??''),password:String(password),saved_at:nowIso()};
   prune();save(data);return {item_id:data.logins[o].item_id,version:data.logins[o].version};},
  grant({origin,project_id,project,agent,expires_at=null,max_uses=null}){
   api.init();const l=data.logins[origin];if(!l)throw Object.assign(Error('login_not_saved'),{code:'login_not_saved'});
   if(!project_id||!agent)throw Object.assign(Error('scope_required'),{code:'scope_required'});
   const p={id:randomUUID(),origin,item_id:l.item_id,item_version:l.version,project_id,project:String(project??''),agent:String(agent),
    created_at:nowIso(),expires_at:expires_at?new Date(expires_at).toISOString():null,max_uses:max_uses==null?null:Math.max(1,Math.floor(max_uses)),uses:0,last_used_at:null};
   data.permissions[p.id]=p;save(data);return publicPermission(p);},
  findPermission(scope){reload();if(!data)return null;const l=data.logins[scope.origin];
   const p=Object.values(data.permissions).find(p=>permissionValid(p,l,scope));return p?publicPermission(p):null;},
  permissions:()=>{reload();if(!data)return [];return Object.values(data.permissions).filter(p=>permissionValid(p,data.logins[p.origin],p)).map(publicPermission);},
  // Internal: only the fill step calls this, right before typing. Re-checks the
  // permission from disk, counts the use, and returns the login. Never returned to callers or tools.
  _useCredential(permissionId,scope){
   reload();const p=data?.permissions[permissionId];const l=data?.logins[scope.origin];
   if(!permissionValid(p,l,scope))throw Object.assign(Error('permission_revoked'),{code:'permission_revoked',hint:'This permission was revoked or ran out. Run ak.login again to ask the owner.'});
   p.uses+=1;p.last_used_at=nowIso();if(p.max_uses!=null&&p.uses>=p.max_uses)delete data.permissions[p.id];save(data);
   return {username:l.username,password:l.password};},
  revoke(target){reload();if(!data)return 0;let n=0;
   for(const [id,p] of Object.entries(data.permissions))if(target==='all'||id===target||p.origin===target){delete data.permissions[id];n++;}
   if(n)save(data);return n;},
  forget(o){reload();if(!data)return;delete data.logins[o];for(const [id,p] of Object.entries(data.permissions))if(p.origin===o)delete data.permissions[id];save(data);},
  setSecret(n,v){api.init();data.secrets[n]=String(v);save(data);},
  getSecret:n=>{reload();return data?.secrets[n];},
  secretNames:()=>{reload();return Object.keys(data?.secrets??{});},
 };
 return api;
}
