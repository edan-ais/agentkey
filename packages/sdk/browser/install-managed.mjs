// Provision a separate browser tool. Never replace or attach existing browsers.
import {readFileSync,writeFileSync,openSync,closeSync,lstatSync,mkdirSync,constants,realpathSync,renameSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname} from 'node:path';
const require=createRequire(import.meta.url),version='0.6.2';
function read(path){let fd;try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const st=lstatSync(path);if(!st.isFile()||st.nlink!==1||st.size>262144)throw Error('unsafe_host_config');return readFileSync(fd,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}finally{if(fd!==undefined)closeSync(fd)}}
function write(path,before,after){if(read(path)!==before)throw Error('host_config_changed');const tmp=path+'.agentkey-new-'+randomBytes(6).toString('hex');let fd;try{fd=openSync(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);writeFileSync(fd,after);closeSync(fd);fd=undefined;if(read(path)!==before)throw Error('host_config_changed');if(before!==null){const backup=path+'.agentkey-backup-'+randomBytes(6).toString('hex');const b=openSync(backup,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(b,before)}finally{closeSync(b)}}renameSync(tmp,path);}finally{if(fd!==undefined)closeSync(fd);try{unlinkSync(tmp)}catch{}}}
function secureDir(path,root){try{const st=lstatSync(path);if(!st.isDirectory()||st.isSymbolicLink())throw Error('unsafe_host_directory');}catch(e){if(e.code!=='ENOENT')throw e;mkdirSync(path,{mode:0o700});}if(!realpathSync(path).startsWith(root+'/'))throw Error('host_directory_outside_project')}
export function installManagedBrowser({cwd=process.cwd(),install=true}={}){
 const root=realpathSync(cwd),plans=[];
 for(const dir of ['.cursor','.codex']){try{const st=lstatSync(join(root,dir));if(st.isSymbolicLink()||!st.isDirectory())throw Error('unsafe_host_directory');}catch(e){if(e.code!=='ENOENT')throw e;}}
 for(const [relative,host]of [['.mcp.json','Claude Code'],['.cursor/mcp.json','Cursor']]){
  const path=join(root,relative),before=read(path),data=before===null?{}:JSON.parse(before);if(data===null||Array.isArray(data)||typeof data!=='object')throw Error('invalid_host_config');data.mcpServers??={};if(Array.isArray(data.mcpServers)||typeof data.mcpServers!=='object'||data.mcpServers===null)throw Error('invalid_host_servers');
  if(data.mcpServers.agentkey){const s=data.mcpServers.agentkey;if(!['npx','npx.cmd'].includes(s.command)||s.args?.join(' ')!==`-y tryagentkey@${version} browser-mcp-managed`)throw Error('agentkey_host_name_in_use');plans.push({host,path,status:'already_configured'});continue;}
  data.mcpServers.agentkey={command:'npx',args:['-y',`tryagentkey@${version}`,'browser-mcp-managed'],env:{AGENTKEY_PROJECT_ROOT:root}};plans.push({host,path,before,after:JSON.stringify(data,null,2)+'\n',status:'configured'});
 }
 const path=join(root,'.codex/config.toml'),before=read(path);let after=before??'';
 const codexExists=/\[\s*mcp_servers\.(?:"agentkey"|agentkey)(?:\s*\]|\.)/.test(after);
 if(codexExists && !after.includes('args = ["-y", "tryagentkey@'+version+'", "browser-mcp-managed"]'))throw Error('codex_agentkey_name_in_use');
 if(!codexExists)after+='\n# AgentKey dedicated browser, existing servers are unchanged.\n[mcp_servers.agentkey]\ncommand = "npx"\nargs = ["-y", "tryagentkey@'+version+'", "browser-mcp-managed"]\n[mcp_servers.agentkey.env]\nAGENTKEY_PROJECT_ROOT = '+JSON.stringify(root)+'\n';
 plans.push({host:'Codex',path,before,...(codexExists?{}:{after}),status:codexExists?'already_configured':'configured'});
 if(!install)return{plans};
 // Install the exact Playwright dependency's Chromium. No sudo or system changes.
 const cli=join(dirname(require.resolve('playwright/package.json')),'cli.js');
 const result=spawnSync(process.execPath,[cli,'install','chromium'],{stdio:['ignore','inherit','inherit']});if(result.status!==0)throw Error('chromium_install_failed');
 secureDir(join(root,'.cursor'),root);secureDir(join(root,'.codex'),root);
 for(const p of plans)if(p.after!==undefined)write(p.path,p.before,p.after);
 return{plugin_registered:true,state:'dedicated_browser_configured',hosts:plans.map(({host,status})=>({host,status})),next_action:'Host trust approval or reload may be required. No code edits.'};
}
