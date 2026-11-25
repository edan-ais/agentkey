import {readFileSync,lstatSync,openSync,writeFileSync,closeSync,constants,realpathSync,renameSync,unlinkSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {join,resolve,relative,isAbsolute} from 'node:path';
const supported=new Set(['@playwright/mcp','@playwright/mcp@latest','@playwright/mcp@0.0.86']);
function load(path){let fd;try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const s=lstatSync(path);if(!s.isFile()||s.nlink!==1||s.size>262144)throw Error('unsafe_mcp_config');const body=readFileSync(fd,'utf8');return{body,data:JSON.parse(body)}}catch(e){if(e.code==='ENOENT')return null;throw e}finally{if(fd!==undefined)closeSync(fd)}}
export function installBrowserBridge({cwd=process.cwd(),write=true}={}){
 const root=realpathSync(cwd),path=join(root,'.mcp.json'),old=load(path);
 if(!old)return{plugin_registered:false,state:'no_project_mcp_config',next_action:'keep_existing_coding_instructions'};
 const servers=old.data.mcpServers;if(!servers||typeof servers!=='object'||Array.isArray(servers))throw Error('invalid_mcp_servers');
 const matches=Object.entries(servers).filter(([,s])=>s&&typeof s==='object'&&['npx','npx.cmd'].includes(s.command)&&Array.isArray(s.args)&&s.args.some(a=>supported.has(a)));
 if(matches.length!==1)return{plugin_registered:false,state:matches.length?'ambiguous_playwright_servers':'unsupported_mcp_host'};
 const [name,s]=matches[0];const i=s.args.findIndex(a=>supported.has(a)),args=s.args.slice(i+1);let config={browser:{}};
 // Only a config-file invocation is supported. Unknown flags are never silently dropped.
 if(args.length===2&&args[0]==='--config'){
  const cp=realpathSync(resolve(root,args[1]));if(relative(root,cp).startsWith('..')||isAbsolute(relative(root,cp)))throw Error('mcp_config_outside_project');const c=load(cp);if(!c)throw Error('missing_playwright_config');config=c.data;
  const b=config.browser??{};for(const key of ['userDataDir','initPage','initScript'])if(b[key])throw Error('relative_or_custom_browser_hooks_require_review');
 }else if(args.length===1&&args[0]==='--extension')config={browser:{extension:true}};
 else if(args.length===1&&args[0].startsWith('--cdp-endpoint='))config={browser:{cdpEndpoint:args[0].slice('--cdp-endpoint='.length)}};
 else return{plugin_registered:false,state:'unsupported_playwright_arguments'};
 if(!config.browser?.extension&&!config.browser?.cdpEndpoint&&!config.browser?.remoteEndpoint)return{plugin_registered:false,state:'existing_browser_connection_required'};
 if(config.browser?.launchOptions||config.browser?.contextOptions)throw Error('launch_and_context_options_not_supported');
 if(config.saveSession||config.browser?.contextOptions?.recordVideo||config.browser?.contextOptions?.recordHar)throw Error('disable_browser_recording_before_bridge');
 if(!write)return{plugin_registered:false,state:'ready_to_register',name};
 const source=JSON.stringify(config);if(Buffer.byteLength(source)>32768)throw Error('browser_config_too_large');
 servers[name]={...s,command:'npx',args:['-y','tryagentkey@0.6.0','browser-mcp'],env:{...s.env,AGENTKEY_BROWSER_CONFIG:source,AGENTKEY_PROJECT_ROOT:root,AGENTKEY_BRIDGE_ID:randomUUID()}};
 const current=load(path);if(current?.body!==old.body)throw Error('mcp_config_changed_retry');
 const backup=path+'.agentkey-backup-'+randomBytes(6).toString('hex');
 let fd;try{fd=openSync(backup,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);writeFileSync(fd,old.body)}finally{if(fd!==undefined)closeSync(fd)}
 const temporary=path+'.agentkey-new-'+randomBytes(6).toString('hex');
 try{fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);writeFileSync(fd,JSON.stringify(old.data,null,2)+'\n');closeSync(fd);fd=undefined;
 if(load(path)?.body!==old.body)throw Error('mcp_config_changed_retry');renameSync(temporary,path);
 }finally{if(fd!==undefined)closeSync(fd);try{unlinkSync(temporary)}catch{}}
 return{plugin_registered:true,state:'restart_mcp_host_to_attach_existing_browser',server:name,backup};
}
