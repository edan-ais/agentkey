// Customer-framework setup, using only its already-running browser.
// This is not an extension installer and never attaches to a browser endpoint.
import {createPlaywrightAgentKey} from './playwright-integration.mjs';
const SITE='https://agentkey.waiwiser.com',KEY=/^[A-Za-z0-9+/]{43}=$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export async function setupExistingBrowserAgentKey(options={}){
 const {browser,relayPage,expectedPublicKey,recordingDisabled,exclusiveBrowserTools,agentID,client,browserTools,extensionID}=options;
 const stop=(stage,next_action)=>({ready:false,stage,next_action});
 // Do not offer tools before all setup checks pass. Never return raw handles.
 if(recordingDisabled!==true||exclusiveBrowserTools!==true)return stop('framework_safety','disable_recording_and_expose_only_gated_browser_tools');
 if(extensionID!==undefined&&(typeof extensionID!=='string'||!/^[a-p]{32}$/.test(extensionID)))return stop('framework_configuration','configure_trusted_extension_identity');
 if(!KEY.test(expectedPublicKey??''))return stop('executor_identity','configure_owner_verified_executor_key');
 if(!UUID.test(agentID??'')||!client||!['requestTarget','requestStatus','use'].every(k=>typeof client[k]==='function')||!browserTools||Object.values(browserTools).some(f=>typeof f!=='function'))return stop('framework_configuration','configure_agent_client_and_browser_tools');
 let pages;
 try{
  if(!browser||typeof browser.contexts!=='function'||typeof browser.isConnected==='function'&&!browser.isConnected())throw Error();
  pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>!p.isClosed?.());
 }catch{return stop('existing_browser','connect_customer_framework_to_its_existing_browser');}
 let selected=relayPage;
 const eligible=p=>{try{return typeof p.evaluate==='function'&&new URL(p.url()).origin===SITE}catch{return false}};
 if(selected&&(!pages.includes(selected)||!eligible(selected)))return stop('relay_selection','select_existing_agentkey_page_in_this_browser');
 if(!selected){const matches=pages.filter(eligible);if(matches.length!==1)return stop('relay_selection',matches.length?'select_one_existing_agentkey_page':'open_agentkey_in_the_existing_browser');selected=matches[0];}
 let keyReady=false,paired=false;
 try{
  // Independently check identity so a mismatch never looks like missing installation.
  const {connectExistingBrowser}=await import('./index.mjs');
  const status=await connectExistingBrowser({page:selected,expectedPublicKey,extensionID}).status();keyReady=true;paired=status.paired;
 }catch(error){return stop('extension_connection',error?.message==='executor_key_mismatch'?'resolve_executor_identity_mismatch':'install_or_enable_compatible_extension_in_existing_browser');}
 if(!keyReady||!paired)return stop('executor_pairing','pair_installed_extension_with_owner');
 const integration=createPlaywrightAgentKey({...options,relayPage:selected});
 const status=await integration.setupStatus();
 if(!status.target_protocol_ready)return stop('target_capability','release_matching_backend_and_compatible_extension');
 return Object.freeze({ready:true,stage:'ready_for_approved_login',next_action:'inspect_existing_login_page',tools:integration.tools,setupStatus:integration.setupStatus,browserStatus:integration.browserStatus});
}
