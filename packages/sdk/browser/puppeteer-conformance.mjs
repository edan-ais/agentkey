// Non-secret capability acceptance for an authorized Puppeteer agent browser.
// It cannot prove a credential fill or provider isolation; it requires an
// actual pre-existing browser and compatible connected AgentKey extension.
import {setupPuppeteerAgentKey} from './puppeteer-integration.mjs';
const SITE='https://agentkey.waiwiser.com';
const TOKEN=/^[a-f0-9]{32}$/;
const REF=/^p[a-f0-9]{32}_[0-9]{1,3}$/;

const fail=(stage,next_action)=>Object.freeze({ready:false,stage,next_action});
export async function checkPuppeteerLoginReadiness({
  browser,relayPage,intendedURL,...setupConfig
}={}){
  let destination;
  try{
    if(typeof intendedURL!=='string'||intendedURL.length>2048)throw Error();
    destination=new URL(intendedURL);
    if(destination.protocol!=='https:'||destination.username||destination.password||
      destination.hash||destination.origin===SITE)throw Error();
  }catch{return fail('destination','select_exact_existing_https_login_page');}
  if(!browser||browser.connected!==true||typeof browser.pages!=='function')
    return fail('existing_browser','connect_customer_framework_to_its_existing_browser');

  // No new tabs. Bind the requested URL to exactly one already-open tab.
  // A different Puppeteer BrowserContext can never satisfy this probe.
  let pages;
  try{pages=await browser.pages();}catch{
    return fail('existing_browser','connect_customer_framework_to_its_existing_browser');
  }
  if(!Array.isArray(pages)||pages.some(p=>!p||
    typeof p.url!=='function'||typeof p.isClosed!=='function'||
    typeof p.browserContext!=='function'))
    return fail('existing_browser','connect_customer_framework_to_its_existing_browser');
  const relay=relayPage??pages.filter(p=>{
    try{return !p.isClosed()&&new URL(p.url()).origin===SITE;}catch{return false;}
  })[0];
  const relayMatches=pages.filter(p=>{
    try{return !p.isClosed()&&new URL(p.url()).origin===SITE;}catch{return false;}
  });
  if(!relay||!relayMatches.includes(relay)||(!relayPage&&relayMatches.length!==1))
    return fail('relay_selection','select_one_existing_agentkey_page');
  const matches=pages.filter(p=>{
    try{return !p.isClosed()&&p.url()===intendedURL&&p.browserContext()===relay.browserContext();}
    catch{return false;}
  });
  if(matches.length!==1)return fail('login_tab_selection','select_exactly_one_existing_login_tab_in_agentkey_browser_context');
  const original=matches[0],context=original.browserContext();
  if(!context)return fail('login_tab_selection','verify_original_browser_context');

  const integration=await setupPuppeteerAgentKey({browser,relayPage:relay,...setupConfig});
  if(integration.ready!==true)return fail(integration.stage||'setup',integration.next_action||'complete_setup');

  try{
    const details=await integration.tools.agentkey_login_inspect({intended_url:intendedURL});
    // Do not return the control snapshot or page labels. It may contain
    // website-supplied strings. Only structural / redacted evidence escapes.
    if(!details||details.origin!==destination.origin||
      !TOKEN.test(details.plan_id??'')||!Array.isArray(details.controls)||
      details.controls.length<1||details.controls.length>100||
      details.controls.some(c=>!c||!REF.test(c.ref??'')))
      return fail('login_inspection','unsupported_or_ambiguous_login_controls');
    const fresh=await browser.pages();
    if(browser.connected!==true||!fresh.includes(original)||original.isClosed()||
      original.browserContext()!==context||original.url()!==intendedURL)
      return fail('login_tab_changed','restore_original_login_tab');
    return Object.freeze({
      ready:true,stage:'ready_for_owner_approval',
      inspected_controls:details.controls.length,
      origin:destination.origin,
      original_browser_preserved:true,
      login_performed:false,owner_approval_requested:false,
      model_secret_exposure_verified:false,
      next_action:'perform_owner_approved_login_and_verify_same_tab',
    });
  }catch{
    return fail('login_inspection','check_extension_and_original_login_tab');
  }
}
