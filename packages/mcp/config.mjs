// Ready-to-paste MCP client setup for Windows, macOS and Linux.
import {homedir,platform} from 'node:os';import {join} from 'node:path';
export const CLIENTS=['claude-desktop','claude-code','cursor','vscode','windsurf'];
export function configPath(client,{os=platform(),home=homedir(),env=process.env}={}){
 const appData=env.APPDATA??join(home,'AppData','Roaming');
 if(client==='claude-desktop')return os==='win32'?join(appData,'Claude','claude_desktop_config.json'):os==='darwin'?join(home,'Library','Application Support','Claude','claude_desktop_config.json'):join(env.XDG_CONFIG_HOME??join(home,'.config'),'Claude','claude_desktop_config.json');
 if(client==='cursor')return join(home,'.cursor','mcp.json');
 if(client==='windsurf')return join(home,'.codeium','windsurf','mcp_config.json');
 if(client==='vscode')return join('.vscode','mcp.json');
 if(client==='claude-code')return null;
 throw Error('unknown_client');
}
export function serverEntry({os=platform()}={}){
 // Windows runs npx through cmd so MCP clients can spawn it.
 const args=['-y','@tryagentkey/mcp'];
 return os==='win32'?{command:'cmd',args:['/c','npx',...args],env:{AGENTKEY_API_KEY:'${env:AGENTKEY_API_KEY}'}}:{command:'npx',args,env:{AGENTKEY_API_KEY:'${env:AGENTKEY_API_KEY}'}};
}
export function clientConfig(client,opts={}){
 const entry=serverEntry(opts);
 if(client==='claude-code')return {command:'claude mcp add agentkey -- '+[entry.command,...entry.args].join(' ')};
 if(client==='vscode')return {path:configPath(client,opts),json:{servers:{agentkey:{type:'stdio',...entry}}}};
 return {path:configPath(client,opts),json:{mcpServers:{agentkey:entry}}};
}
export function printConfig(client='claude-desktop'){
 const c=clientConfig(client);
 process.stdout.write(c.command?c.command+'\n':`Add to ${c.path}:\n${JSON.stringify(c.json,null,2)}\nKeep AGENTKEY_API_KEY in your environment, never in this file.\n`);
}
