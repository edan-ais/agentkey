#!/usr/bin/env node
// npx tryagentkey init    — Free Local Mode: local vault + one-tap local approval
// npx tryagentkey link    — move this project to AgentKey Cloud (pairing code)
// npx tryagentkey doctor  — plain-English checks
// npx tryagentkey status  — mode, connected sites
// npx tryagentkey permissions / revoke <id|site|--all> / forget <site>
// npx tryagentkey secret set NAME — store a developer secret in the local vault
import {readFileSync,writeFileSync,existsSync,appendFileSync} from 'node:fs';
import {join,basename} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {agentkey,encodeApiKey,decodeApiKey,readEnv,AgentKeyError} from '../auto.mjs';
import {detectProject} from '../detect.mjs';
import {createLocal} from '../local/index.mjs';
import {openVault,agentkeyHome} from '../local/vault.mjs';
import {writeEnvVars} from '../local/env.mjs';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const BANNER='Running in Free Local Mode (Single-User). Upgrading to multi-tenant cloud? Run npx tryagentkey link.';
export async function initLocal({cwd=process.cwd(),log=console.log,...o}={}){
 const local=createLocal({onLink:(u,w)=>log(`AgentKey: ${w}\n  here is your link → ${u}`),...o});
 const id=await local.setup();writeEnvVars(cwd,{AGENTKEY_MODE:'local',AGENTKEY_LOCAL_KEY:id});
 log(`✓ Local vault ready (${local.vault.file})\n✓ .env updated (AGENTKEY_MODE=local), kept out of git\n${BANNER}\nNext: const ak = await agentkey(); await ak.login(url, { page })`);
 return {vault_id:id};
}
export async function status({cwd=process.cwd(),log=console.log,home=agentkeyHome()}={}){
 const cfg=readEnv(process.env,cwd);const mode=cfg.mode??(cfg.apiKey?'cloud':'local');const out=[];
 if(mode==='local'){out.push(BANNER);const v=openVault(home);const sites=v.sites();out.push(sites.length?'Connected sites:\n'+sites.map(s=>`  • ${s.origin}${s.username?` (${s.username})`:''} — ${s.permissions} permission${s.permissions===1?'':'s'}`).join('\n'):'No sites yet — the first ak.login(url) asks you once.');
  out.push('Active sessions: none kept (each run signs in fresh).');if(v.secretNames().length)out.push('Secrets: '+v.secretNames().join(', '));}
 else out.push('Running in AgentKey Cloud mode. Manage logins at https://agentkey.waiwiser.com.');
 log(out.join('\n'));return out;
}

export async function link({cwd=process.cwd(),code,name,fetchImpl=fetch,ask,log=console.log,enroll=true}={}){
 const cfg=readEnv(process.env,cwd);const site=new URL(cfg.baseURL).origin;
 if(cfg.apiKey&&cfg.mode==='cloud'){try{decodeApiKey(cfg.apiKey);log('Already linked to AgentKey Cloud.');return {already:true};}catch{}}
 if(!code){
  log(`\n1. Open ${site}/agents and tap “Generate agent pairing code”.\n2. Paste the code below.\n`);
  code=await (ask??(async q=>{const rl=createInterface({input:process.stdin,output:process.stdout});try{return await rl.question(q);}finally{rl.close();}}))('Pairing code: ');
 }
 const agent_name=name??basename(cwd);
 const r=await fetchImpl(site+'/api/public/agents/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:String(code).trim(),agent_name})});
 const j=await r.json().catch(()=>({}));
 if(!r.ok||!j.sign_in)throw new AgentKeyError(j.error||'pairing_failed','That code did not work. Codes are single-use and expire; generate a new one.');
 const key=encodeApiKey(j);
 writeEnvVars(cwd,{AGENTKEY_MODE:'cloud',AGENTKEY_API_KEY:key});
 log(`Connected “${agent_name}”. Saved AGENTKEY_API_KEY to .env (kept out of git).`);
 if(enroll){const ak=await agentkey({cwd,fetchImpl,env:{...process.env,AGENTKEY_API_KEY:key}});await ak.ensureRuntime();log('This agent browser is trusted. Add `const ak = await agentkey()` and call ak.login(url, { page }).');}
 return {agent_id:j.agent_id};
}

export async function doctor({cwd=process.cwd(),fetchImpl=fetch,log=console.log,home=agentkeyHome()}={}){
 const cfg=readEnv(process.env,cwd),p=detectProject(cwd),out=[],ok=(b,y,n)=>out.push(b?`✓ ${y}`:`✗ ${n}`);
 const major=+process.versions.node.split('.')[0];ok(major>=22,`Node ${major} detected`,`Node ${major} is too old — install Node 22 or newer`);
 ok(existsSync(join(cwd,'.env')),'.env found','.env missing — run npx tryagentkey init');
 const mode=cfg.mode??(cfg.apiKey?'cloud':'local');out.push(`• Mode: ${mode}`);
 out.push(`• Framework: ${p.framework}`);
 if(!p.browser)out.push('✗ No browser library — npm install playwright (or puppeteer)');
 else{let installed=false;try{const req=createRequire(join(cwd,'package.json'));const pw=req(p.browser.startsWith('puppeteer')?p.browser:p.browser==='@playwright/test'?'playwright':p.browser);const path=pw.chromium?.executablePath?.()??pw.executablePath?.();installed=!!path&&existsSync(path);}catch{}
  ok(installed,`${p.browser} browser installed`,`${p.browser} browser not installed — run npx playwright install chromium`);}
 if(mode==='local'){try{const v=openVault(home);ok(v.exists(),'Local vault readable','Local vault not set up — run npx tryagentkey init');if(v.exists())ok(cfg.localKey===v.id,'Local key matches this vault','Local key in .env does not match — run npx tryagentkey init');}catch(e){out.push('✗ '+(e.hint||e.message));}}
 else if(!cfg.apiKey)out.push('✗ AGENTKEY_API_KEY missing — run npx tryagentkey link');
 else{try{const k=decodeApiKey(cfg.apiKey);const r=await fetchImpl(k.url,{method:'POST',headers:{apikey:k.apikey,'Content-Type':'application/json'},body:JSON.stringify({email:k.email,password:k.password})});ok(r.ok,'Cloud agent sign-in works','Cloud sign-in failed — the owner may have removed this agent; run npx tryagentkey link');}catch(e){out.push('✗ '+(e.hint||e.message));}}
 log(out.join('\n'));return out;
}

export async function permissions({log=console.log,home=agentkeyHome()}={}){
 const ps=openVault(home).permissions();
 log(ps.length?'Permissions (site · project · agent · how long):\n'+ps.map(p=>`  ${p.id}  ${p.origin} · ${p.project} · ${p.agent} · ${p.kind==='standing'?(p.expires_at?'until '+p.expires_at:'until revoked'):`${p.max_uses-p.uses} use left`}`).join('\n')+'\nRevoke: npx tryagentkey revoke <id | https://site | --all>':'No permissions. The first ak.login(url) asks you once.');
 return ps;
}
export async function revoke(target,{log=console.log,home=agentkeyHome()}={}){
 if(!target)throw new AgentKeyError('usage','npx tryagentkey revoke <id | https://site | --all>');
 const t=target==='--all'?'all':/^[0-9a-f-]{36}$/i.test(target)?target:new URL(target).origin;
 const n=openVault(home).revoke(t);log(n?`✓ Revoked ${n} permission${n===1?'':'s'}. Running agents lose access at their next sign-in.`:'Nothing matched.');return n;
}
export async function forget(target,{log=console.log,home=agentkeyHome()}={}){
 if(!target)throw new AgentKeyError('usage','npx tryagentkey forget https://site');
 openVault(home).forget(new URL(target).origin);log('✓ Deleted the saved login and its permissions.');
}

let isMain=false;try{isMain=!!process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url);}catch{}
if(isMain){
 const [cmd,...rest]=process.argv.slice(2);const flag=n=>{const i=rest.indexOf('--'+n);return i>=0?rest[i+1]:undefined;};
 const usage='tryagentkey init | link [--code CODE] [--name NAME] | doctor | status | permissions | revoke <id|site|--all> | forget <site> | secret set NAME';
 const run=cmd==='init'?(rest.includes('--cloud')?link({code:flag('code'),name:flag('name')}):initLocal()):cmd==='link'?link({code:flag('code'),name:flag('name')}):cmd==='doctor'?doctor():cmd==='status'?status():cmd==='permissions'?permissions():cmd==='revoke'?revoke(rest[0]):cmd==='forget'?forget(rest[0]):cmd==='secret'&&rest[0]==='set'&&rest[1]?setSecret(rest[1]):Promise.reject(new AgentKeyError('usage',usage));
 run.then(()=>process.exit(0),e=>{console.error('AgentKey: '+(e.hint||e.message));process.exit(1);});
}

async function setSecret(name){
 if(!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name))throw new AgentKeyError('invalid_name','Use letters, numbers and _.');
 let v='';if(process.stdin.isTTY){process.stdout.write(`Value for ${name} (hidden): `);process.stdin.setRawMode(true);v=await new Promise(r=>{let b='';process.stdin.on('data',d=>{for(const c of d.toString()){if(c==='\r'||c==='\n'){process.stdin.setRawMode(false);process.stdout.write('\n');process.stdin.pause();r(b);return;}if(c==='\u0003')process.exit(1);b+=c;}});});}
 else{for await(const c of process.stdin)v+=c;v=v.replace(/\r?\n$/,'');}
 openVault().setSecret(name,v);console.log(`✓ Saved ${name} in the local vault. Read it with ak.vault.getSecret("${name}").`);
}
export const init=initLocal;
