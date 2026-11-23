// Short-lived local Approve page on 127.0.0.1. The human enters a login here,
// never in the agent. Single-use random path; closes after the answer.
// Protections: Host must be this loopback address (blocks DNS rebinding), a
// cross-site Origin is refused, the form carries a one-time nonce, and the page
// closes after 5 bad submissions.
import {createServer} from 'node:http';import {randomBytes,timingSafeEqual} from 'node:crypto';
const esc=s=>String(s).replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
const page=(body)=>`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgentKey — Approve</title><style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;max-width:440px;margin:48px auto;padding:0 20px}h1{font-size:22px}label{display:block;margin:14px 0 4px;font-weight:600}input[type=text],input[type=password],input:not([type]){width:100%;padding:10px;border:1px solid #8886;border-radius:8px;font:inherit;box-sizing:border-box}fieldset{border:1px solid #8886;border-radius:8px;margin:16px 0 0;padding:8px 12px}fieldset label{font-weight:400;margin:6px 0}button{margin-top:20px;width:100%;padding:12px;border:0;border-radius:8px;font:inherit;font-weight:600;background:CanvasText;color:Canvas;cursor:pointer}.muted{opacity:.7;font-size:14px}dl{margin:12px 0;font-size:14px}dt{opacity:.7}dd{margin:0 0 6px}</style>${body}</html>`;
const HEADERS={'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','referrer-policy':'no-referrer',
 'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"};
const same=(a,b)=>{const x=Buffer.from(String(a??'')),y=Buffer.from(String(b??''));return x.length===y.length&&timingSafeEqual(x,y);};

// mode: 'setup' (first run) | 'save' (new login + permission) | 'allow' (saved login, permission only)
export function startApproval({origin,agentName='your agent',project='',mode=origin?'save':'setup',timeoutMs=600000,maxAttempts=5}={}){
 const token=randomBytes(16).toString('hex'),nonce=randomBytes(16).toString('hex');let done,fail,port=0,attempts=0;
 const result=new Promise((a,b)=>{done=a;fail=b;});
 const scope=()=>`<dl><dt>Agent</dt><dd>${esc(agentName)}</dd>${project?`<dt>Project folder</dt><dd>${esc(project)}</dd>`:''}<dt>Website</dt><dd>${esc(new URL(origin).host)}</dd></dl>`;
 const duration=`<fieldset><legend class="muted">How long</legend><label><input type="radio" name="duration" value="standing" checked> Until I revoke it</label><label><input type="radio" name="duration" value="once"> Only this time</label></fieldset>`;
 const deny=`<form method="post"><input type="hidden" name="nonce" value="${nonce}"><input type="hidden" name="deny" value="1"><button style="background:transparent;color:CanvasText;border:1px solid #8886">Deny</button></form>`;
 const body=()=>mode==='setup'?`<h1>Set up AgentKey on this computer?</h1><p class="muted">Free Local Mode. Single user. Nothing leaves this computer.</p><form method="post"><input type="hidden" name="nonce" value="${nonce}"><button>Approve</button></form>`
  :mode==='allow'?`<h1>Let ${esc(agentName)} use your saved ${esc(new URL(origin).host)} login?</h1>${scope()}<p class="muted">${esc(agentName)} never sees the password. Revoke any time with <code>npx tryagentkey revoke</code>.</p><form method="post"><input type="hidden" name="nonce" value="${nonce}">${duration}<button>Allow</button></form>${deny}`
  :`<h1>Let ${esc(agentName)} sign in to ${esc(new URL(origin).host)}?</h1>${scope()}<p class="muted">Saved only on this computer, locked to it. ${esc(agentName)} never sees the password.</p><form method="post"><input type="hidden" name="nonce" value="${nonce}"><label for="u">Username or email</label><input id="u" name="username" autocomplete="username"><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required>${duration}<button>Approve</button></form>${deny}`;
 const server=createServer((req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');
  if(req.headers.host!==`127.0.0.1:${port}`||u.pathname!=='/approve/'+token){res.writeHead(404).end();return;}
  if(req.method==='GET'){res.writeHead(200,HEADERS);res.end(page(body()));return;}
  if(req.method==='POST'){
   const o=req.headers.origin;if(o&&o!=='null'&&o!==`http://127.0.0.1:${port}`){res.writeHead(403).end();return;}
   let b='';req.on('data',c=>{b+=c;if(b.length>8192)req.destroy();});req.on('end',()=>{
   const f=new URLSearchParams(b);
   const bad=msg=>{attempts++;res.writeHead(400,HEADERS);
    if(attempts>=maxAttempts){res.end(page('<h1>Too many tries.</h1><p class="muted">This link is closed. Run your agent again for a new one.</p>'));finish();fail(Object.assign(Error('approval_closed'),{code:'approval_closed'}));return;}
    res.end(page(`<h1>${msg}</h1><p><a href="">Try again</a></p>`));};
   if(!same(f.get('nonce'),nonce))return bad('This page expired.');
   if(f.get('deny')){res.writeHead(200,HEADERS);res.end(page('<h1>Denied.</h1><p class="muted">You can close this tab.</p>'));finish();fail(Object.assign(Error('denied'),{code:'request_denied'}));return;}
   if(mode==='save'&&!f.get('password'))return bad('Password needed.');
   const dur=f.get('duration')==='once'?'once':'standing';
   res.writeHead(200,HEADERS);res.end(page('<h1>Approved.</h1><p class="muted">You can close this tab — your agent is continuing.</p>'));finish();
   done(mode==='save'?{username:f.get('username')??'',password:f.get('password'),duration:dur}:mode==='allow'?{approved:true,duration:dur}:{approved:true});});return;}
  res.writeHead(405).end();
 });
 const timer=setTimeout(()=>{finish();fail(Object.assign(Error('approval_timeout'),{code:'approval_timeout'}));},timeoutMs);timer.unref?.();
 function finish(){clearTimeout(timer);server.close();}
 const ready=new Promise(r=>server.listen(0,'127.0.0.1',()=>{port=server.address().port;r(`http://127.0.0.1:${port}/approve/${token}`);}));
 return {ready,result,close:finish};
}
