// Trusted integration for a browser that the customer's Puppeteer host ALREADY controls.
// No puppeteer.launch/connect, browser endpoint, new page/context or profile export.
import {setupExistingBrowserAgentKey} from './setup.mjs';

const SITE='https://agentkey.waiwiser.com';

export async function setupPuppeteerAgentKey(options={}){
  const stop=(stage,next_action)=>Object.freeze({ready:false,stage,next_action});
  const {browser,relayPage,recordingDisabled,exclusiveBrowserTools}=options;
  if(recordingDisabled!==true||exclusiveBrowserTools!==true)
    return stop('framework_safety','disable_recording_and_expose_only_gated_browser_tools');
  if(!browser||typeof browser.pages!=='function'||browser.connected!==true)
    return stop('existing_browser','connect_customer_framework_to_its_existing_browser');

  // Puppeteer pages() returns Promise<Page[]>; the existing Playwright adapter
  // expects a synchronous page inventory. Refresh this list before each AgentKey
  // login operation, never create a new browser page or attach to an endpoint.
  let currentPages=[],pinnedContext=null;
  async function refresh(){
    if(browser.connected!==true)throw Error('existing_browser_not_connected');
    const pages=await browser.pages();
    if(!Array.isArray(pages)||pages.some(p=>!p||typeof p.url!=='function'||
      typeof p.evaluate!=='function'||typeof p.isClosed!=='function'||
      typeof p.browserContext!=='function'))
      throw Error('invalid_existing_browser');
    currentPages=pages.filter(p=>!p.isClosed()&&(!pinnedContext||p.browserContext()===pinnedContext));
    return currentPages;
  }

  try{await refresh();}catch{
    return stop('existing_browser','connect_customer_framework_to_its_existing_browser');
  }
  const eligible=p=>{
    try{return new URL(p.url()).origin===SITE;}catch{return false;}
  };
  let selected=relayPage;
  if(selected&&(!currentPages.includes(selected)||!eligible(selected)))
    return stop('relay_selection','select_existing_agentkey_page_in_this_browser');
  if(!selected){
    const matches=currentPages.filter(eligible);
    if(matches.length!==1)return stop('relay_selection',
      matches.length?'select_one_existing_agentkey_page':'open_agentkey_in_the_existing_browser');
    selected=matches[0];
  }

  // An extension in one profile must never authorize a target in a different
  // incognito / browser context. Retain only pages in the exact relay context.
  pinnedContext=selected.browserContext();
  if(!pinnedContext)return stop('relay_selection','verify_agentkey_browser_context');
  currentPages=currentPages.filter(p=>p.browserContext()===pinnedContext);
  const contextView=Object.freeze({pages:()=>currentPages});
  const browserView=Object.freeze({
    isConnected:()=>browser.connected===true,
    contexts:()=>[contextView],
  });
  const setup=await setupExistingBrowserAgentKey({...options,browser:browserView,relayPage:selected});
  if(!setup.ready)return setup;

  const tools=Object.fromEntries(Object.entries(setup.tools).map(([name,tool])=>[
    name,async args=>{
      if(name.startsWith('agentkey_login_')){
        await refresh();
        if(!currentPages.includes(selected)||!eligible(selected))
          throw Error('existing_agentkey_tab_required');
      }
      return tool(args);
    },
  ]));
  return Object.freeze({...setup,tools:Object.freeze(tools)});
}
