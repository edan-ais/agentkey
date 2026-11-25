// Fills a saved login into the builder's OWN Playwright/Puppeteer page and
// detects CAPTCHA / two-step pages, waiting for the human to finish them.
// Success needs positive confirmation (see ../confirm.mjs); an uncertain
// submission is reported as 'unverified' and never retried automatically.
import {USER,PASS,pageState,confirmSignedIn,waitConfirmed} from '../confirm.mjs';
export {pageState} from '../confirm.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fail=(code,extra={})=>({outcome:'failed',filled:false,code,...extra});

// takeCredential(): called only right before typing, after the page origin is re-checked.
export async function fillLogin(page,takeCredential,{origin,verify,successSelector,onHandoff,handoffTimeoutMs=300000,settleMs=8000,singleSubmission=false,formRoot,resolveFormRoot}={}){
 const signinUrl=String(page.url());
 const secureForm=async()=>{if(resolveFormRoot)formRoot=await resolveFormRoot(page);if(formRoot){const action=await formRoot.evaluate(e=>e.getAttribute('action'));if(action&&new URL(action,page.url()).protocol!=='https:')throw Object.assign(Error('insecure_form_action'),{code:'insecure_form_action'});}};
 await secureForm();
 let submitted=false;
 const state=async()=>{if(await pageState(page)==='challenge')return 'challenge';return pageState(page,{root:!submitted&&formRoot?formRoot:page})};
 const first=await state();
 if(first==='blank')return fail('blank_page');
 if(first==='clear'){
  // No login form. Only report success if the caller's own check says so.
  const c=(verify||successSelector)?await confirmSignedIn(page,{verify,successSelector,submitted:false}):null;
  return c?{outcome:'completed',filled:false,confirmed_by:c}:fail('no_login_form');
 }
 const sameOrigin=()=>{try{return !origin||new URL(page.url()).origin===origin;}catch{return false;}};
 let cred=null,filledPassword=false;
 const getCred=()=>{if(!sameOrigin())throw Error('page_origin_mismatch');if(!cred)cred=takeCredential();return cred;};
 try{
  for(let step=0;step<3&&!filledPassword;step++){
   await secureForm();
   const st=await state();
   if(st==='challenge'||st==='blank'||st==='clear')break;
   if(!sameOrigin())return fail('page_origin_mismatch');
   const users=await (formRoot??page).$$(USER);
   if(users.length>1&&st!=='login_form')return fail('login_form_ambiguous');
   if(users.length>=1&&getCred().username)await setValue(page,users[0],getCred().username);
   if(st==='login_form'){const pw=await (formRoot??page).$$(PASS);if(pw.length!==1)return fail('login_form_ambiguous');
    if(!sameOrigin())return fail('page_origin_mismatch');
    await setValue(page,pw[0],getCred().password);await pw[0].press('Enter');filledPassword=true;submitted=true;
    if(!singleSubmission&&!(await waitFor(async()=>(await state())!=='login_form',1500)))await clickSubmit(formRoot??page);}
   else{await users[0].press('Enter');await waitFor(async()=>(await state())!=='username_step',settleMs);}
  }
 }finally{cred=null;}
 if(!filledPassword&&(await state())!=='challenge')return fail('login_form_unsupported');
 const opts={verify,successSelector,signinUrl,submitted:true};
 const settled=await waitFor(async()=>!!(await confirmSignedIn(page,opts))||(await state())==='challenge',settleMs);
 let c=settled?await confirmSignedIn(page,opts):null;
 if(c)return {outcome:'completed',filled:true,confirmed_by:c};
 if((await state())==='challenge'){
  await onHandoff?.(page);
  c=await waitConfirmed(page,opts,handoffTimeoutMs,500);
  return c?{outcome:'completed',filled:true,handoff:true,confirmed_by:c}:{outcome:'needs_you',filled:true,code:'handoff_timeout'};
 }
 return {outcome:'unverified',filled:true,code:'login_unconfirmed'};
}
async function setValue(page,h,v){if(typeof h.fill==='function')return h.fill(v);await h.click({clickCount:3});await h.type(v);}
async function waitFor(fn,ms,every=150){const end=Date.now()+ms;while(Date.now()<end){try{if(await fn())return true;}catch{}await sleep(every);}return false;}
async function clickSubmit(page){
 const cands=[];for(const h of await page.$$('button,input[type="submit"]')){try{const t=((await h.evaluate(e=>(e.type||'')+' '+(e.innerText||e.value||'')))||'').toLowerCase();const vis=await h.isVisible?.()??(await h.boundingBox())!==null;if(vis&&/submit|log ?in|sign ?in|continue|next/.test(t))cands.push(h);}catch{}}
 if(cands.length>=1)await cands[0].click();
}
