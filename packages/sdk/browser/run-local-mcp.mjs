import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {createLocalBrowserMCP} from './local-mcp.mjs';
export async function run({managed=false}={}){
 const raw=process.env.AGENTKEY_BROWSER_CONFIG??'';
 if(Buffer.byteLength(raw)>32768)throw Error('browser_config_too_large');
 const config=managed?{}:JSON.parse(raw),cwd=process.env.AGENTKEY_PROJECT_ROOT??process.cwd();
 // All SDK notices go to stderr, never corrupt MCP stdout or return secret errors.
 console.log=(...a)=>console.error(...a);
 const bridge=await createLocalBrowserMCP({config,cwd,managed});
 const transport=new StdioServerTransport();
 await bridge.server.connect(transport);
 transport.onclose=()=>{void bridge.close()};
}
