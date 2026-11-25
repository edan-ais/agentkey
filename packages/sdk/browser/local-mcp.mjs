// Local Playwright MCP bridge. The host process/OS account are trusted, not sandboxed.
import {createConnection} from '@playwright/mcp';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createLocal,openInBrowser} from '../local/index.mjs';
import {openVault,agentkeyHome} from '../local/vault.mjs';
import {pageState,confirmSignedIn} from '../confirm.mjs';
const text=x=>({content:[{type:'text',text:JSON.stringify(x)}]});
const allowed=new Set(['browser_navigate','browser_navigate_back','browser_snapshot','browser_click','browser_type','browser_fill_form','browser_press_key','browser_select_option','browser_hover','browser_drag','browser_wait_for','browser_tabs','browser_resize','browser_take_screenshot','browser_handle_dialog','browser_close']);
const schema=(name,description,properties={},required=[])=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}});
const extras=[schema('agentkey_pages','List opaque existing-browser page handles, without page contents.'),schema('agentkey_login','Request owner-approved login on the existing page. Poll status; no passwords in arguments.',{page:{type:'string'}},['page']),schema('agentkey_status','Read a login result or redacted state. Owner approval opens separately in the OS browser.',{request:{type:'string'}},['request'])];
export async function createLocalBrowserMCP({config={},cwd=process.cwd(),home=agentkeyHome(),managed=false}={}){
 if(managed)config={browser:{browserName:'chromium',isolated:true,launchOptions:{channel:'chromium',headless:false}},saveSession:false};
 if(!managed&&!config.browser?.cdpEndpoint&&!config.browser?.remoteEndpoint&&!config.browser?.extension)throw Error('existing_browser_connection_required');
 if(!managed&&(config.browser?.launchOptions||config.browser?.contextOptions))throw Error('launch_and_context_options_not_supported');
 if(config.saveSession||config.browser?.launchOptions?.tracesDir||config.browser?.contextOptions?.recordVideo||config.browser?.contextOptions?.recordHar)throw Error('recording_must_be_disabled');
 if(globalThis[Symbol.for('agentkey.playwright.register')])throw Error('one_bridge_per_process');
 if(process.env.CI||process.env.AGENTKEY_NO_OPEN)throw Error('desktop_session_required_for_owner_approval');
 const pages=new Map(),jobs=new Map();let busy=false,forwarding=false;
 const register=page=>{if([...pages.values()].includes(page))return;const id=randomUUID();pages.set(id,page);page.once('close',()=>pages.delete(id));};
 globalThis[Symbol.for('agentkey.playwright.register')]=register;
 const hook=fileURLToPath(new URL('./mcp-page-hook.cjs',import.meta.url));
 const inner=await createConnection({...config,saveSession:false,codegen:'none',console:{level:'error'},browser:{...config.browser,initPage:[...(config.browser.initPage??[]),hook]}});
 const client=new Client({name:'agentkey-trusted-browser',version:'0.6.0'});
 const [a,b]=InMemoryTransport.createLinkedPair();await inner.connect(b);await client.connect(a);
 const listed=await client.listTools();const tools=listed.tools.filter(t=>allowed.has(t.name));
 const server=new Server({name:'agentkey-local-browser',version:'0.6.0'},{capabilities:{tools:{}}});
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[...tools,...extras]}));
 server.setRequestHandler(CallToolRequestSchema,async req=>{
  const {name,arguments:args={}}=req.params;
  try{
   if(extras.some(t=>t.name===name)){
    const expected=name==='agentkey_login'?'page':name==='agentkey_status'?'request':null;
    if(Object.keys(args).some(k=>k!==expected)||expected&&(typeof args[expected]!=='string'||args[expected].length>80))return text({error:'invalid_arguments'});
    if(name==='agentkey_pages'){
     if(busy)return text({state:'login_in_progress'});
     // Initializes the actual existing MCP browser, never a new browser.
     await client.callTool({name:'browser_tabs',arguments:{action:'list'}});
     return text({pages:[...pages].filter(([,p])=>!p.isClosed()).map(([id,p])=>{let origin=null;try{origin=new URL(p.url()).origin}catch{}return {page:id,origin}})});
    }
    if(name==='agentkey_status'){const j=jobs.get(args.request);return text(j?{request:args.request,...j}:{error:'unknown_request'});}
    if(busy||forwarding)return text({error:'browser_busy'});
    const p=pages.get(args.page);if(!p||p.isClosed())return text({error:'page_lost'});
    const target=new URL(p.url());if(target.protocol!=='https:'||target.username||target.password)return text({error:'https_page_required'});
    const url=target.href,origin=target.origin,id=randomUUID();
    if(jobs.size>=32)return text({error:'session_request_limit_restart_bridge'});
    const resolveFormRoot=async page=>{
     const forms=await page.locator('form').filter({has:page.locator('input[type=password]')}).all();
     let selected;
     if(forms.length===1)selected=forms[0];
     else if(forms.length>1){const candidates=[];for(const f of forms){const labels=await f.locator('button,input[type=submit]').evaluateAll(es=>es.map(e=>(e.innerText||e.value||'').trim().toLowerCase()));if(labels.some(t=>/^(log ?in|sign ?in)$/.test(t)))candidates.push(f)}if(candidates.length!==1)throw Error('login_form_ambiguous');selected=candidates[0];}
     return selected?await selected.elementHandle():undefined;
    };
    busy=true;const state={state:'approval_required',origin};jobs.set(id,state);
    const local=createLocal({cwd,home,singleSubmission:true,agentName:'Playwright MCP '+(process.env.AGENTKEY_BRIDGE_ID??'manual-host'),onLink:()=>{state.state='owner_approval_required'},open:openInBrowser,handoffTimeoutMs:300000});
    const verify=async page=>{
     if(p!==page||p.isClosed()||new URL(page.url()).origin!==origin||await pageState(page)!=='clear')return false;
     if(!await confirmSignedIn(page))return false;
     const username=openVault(home).sites().find(s=>s.origin===origin)?.username;
     if(!username)return false;
     return page.evaluate(u=>{const t=document.body?.innerText??'';const tokens=t.split(/[\s<>()[\]{}:,;]+/);return tokens.includes(u)||[...document.querySelectorAll('a[href]')].some(a=>{try{const h=new URL(a.href);return h.origin===location.origin&&[...h.searchParams.values()].includes(u)}catch{return false}})},username);
    };
    void local.login(url,{page:p,verify,resolveFormRoot}).then(r=>{state.state=r.signed_in?'completed':r.outcome;state.signed_in=r.signed_in;if(r.code)state.code=r.code;},()=>{state.state='failed';state.code='login_failed_or_denied';}).finally(async()=>{
     delete state.approval_url;
     // Keep every model browser tool blocked until residual password fields are cleared.
     try{if(!p.isClosed()){const resume=p.url();await p.goto('about:blank');const u=new URL(resume);if(u.origin===origin)await p.goto(u.search||u.hash?u.origin:resume,{waitUntil:'domcontentloaded'});}busy=false;}catch{state.state='browser_lost';state.signed_in=false;state.code='restart_bridge_before_browsing';}
    });
    return text({request:id,state:'approval_required',origin});
   }
   if(name==='browser_navigate'){try{const u=new URL(args.url);if(u.protocol!=='https:')return text({error:'https_navigation_only'})}catch{return text({error:'invalid_navigation'})}}
   if(!tools.some(t=>t.name===name))return text({error:'tool_not_available'});
   if(busy||forwarding)return text({error:'browser_busy_wait_for_agentkey_status'});
   forwarding=true;try{return await client.callTool({name,arguments:args});}finally{forwarding=false;}
  }catch{return text({error:'bridge_operation_failed'});}
 });
 const close=async()=>{delete globalThis[Symbol.for('agentkey.playwright.register')];await client.close();await inner.close();};
 return {server,close};
}
