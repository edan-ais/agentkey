import {readFileSync,writeFileSync,existsSync,appendFileSync,chmodSync} from 'node:fs';import {join} from 'node:path';
// Set or replace AGENTKEY_* lines in .env (owner-only) and keep secrets out of git.
export function writeEnvVars(cwd,vars){
 const p=join(cwd,'.env');let lines=existsSync(p)?readFileSync(p,'utf8').split(/\r?\n/):[];
 for(const[k,v]of Object.entries(vars)){const i=lines.findIndex(l=>new RegExp(`^\\s*(export\\s+)?${k}=`).test(l));if(i>=0)lines[i]=`${k}=${v}`;else lines.push(`${k}=${v}`);}
 writeFileSync(p,lines.filter((l,i,a)=>l||i<a.length-1).join('\n').replace(/\n*$/,'\n'),{mode:0o600});try{chmodSync(p,0o600);}catch{}
 ignore(cwd);
}
export function ignore(cwd){const gi=join(cwd,'.gitignore');const g=existsSync(gi)?readFileSync(gi,'utf8'):'';const add=['.env','.agentkey/'].filter(x=>!g.split(/\r?\n/).includes(x));if(add.length)appendFileSync(gi,(g&&!g.endsWith('\n')?'\n':'')+add.join('\n')+'\n');}
