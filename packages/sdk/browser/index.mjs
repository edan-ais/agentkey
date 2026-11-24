// Metadata-only relay into an extension the host has ALREADY loaded.
// The caller supplies an existing Page-like object. This module has no browser
// launcher, new-context, new-page, profile, cookie or credential-read API.
const SITE='https://agentkey.waiwiser.com';
const EXTENSION='mbaclpelnfllnmbdcogmjlklfdklmamc';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const KEY=/^[A-Za-z0-9+/]{43}=$/;
export function connectExistingBrowser({page,expectedPublicKey,extensionID=EXTENSION}={}) {
 if(!page||typeof page.url!=='function'||typeof page.evaluate!=='function')throw Error('existing_browser_not_connected');
 if(typeof extensionID!=='string'||!/^[a-p]{32}$/.test(extensionID))throw Error('invalid_extension_id');
 if(expectedPublicKey!==undefined&&!KEY.test(expectedPublicKey))throw Error('invalid_executor_key');
 async function relay(type,operation_id) {
  let current;try{current=new URL(page.url());}catch{throw Error('existing_browser_not_connected');}
  if(current.origin!==SITE)throw Error('agentkey_tab_required');
  let result;
  try{result=await page.evaluate(async({site,extension,type,operation_id})=>{
   if(location.origin!==site||typeof chrome==='undefined'||!chrome.runtime?.sendMessage)return {ok:false};
   return await new Promise(resolve=>{
    let settled=false;
    const finish=value=>{if(!settled){settled=true;clearTimeout(timer);resolve(value);}};
    const timer=setTimeout(()=>finish({ok:false}),5000);
    try{chrome.runtime.sendMessage(extension,{type,...(operation_id?{operation_id}:{})},response=>{
     if(chrome.runtime.lastError||response?.ok!==true)return finish({ok:false});
     // Redact IN the page context, before any response leaves the browser host.
     if(type==='agentkey:executor-ping')return finish({ok:true,ready:response.ready===true,public_key:typeof response.executor_public_key==='string'?response.executor_public_key:''});
     finish({ok:true});
    });}catch{finish({ok:false});}
   });
  },{site:SITE,extension:extensionID,type,operation_id});}catch{throw Error('existing_browser_not_connected');}
  if(result?.ok!==true)throw Error('existing_browser_not_connected');
  return result;
 }
 async function status(){
  const response=await relay('agentkey:executor-ping');
  if(!KEY.test(response.public_key))throw Error('invalid_executor_key');
  if(expectedPublicKey&&response.public_key!==expectedPublicKey)throw Error('executor_key_mismatch');
  return {connected:true,paired:response.ready===true,public_key:response.public_key};
 }
 return {
  status,
  async deliver(operation_id){
   if(!UUID.test(operation_id??''))throw Error('invalid_operation');
   if(!expectedPublicKey)throw Error('executor_key_verification_required');
   const current=await status();if(!current.paired)throw Error('existing_browser_not_paired');
   await relay('agentkey:deliver-operation',operation_id);
   // Delivered only means queued in the existing extension, never approved,
   // claimed, filled, authenticated or persistent. The owner must confirm tab.
   return {operation_id,status:'queued',next_action:'confirm_in_paired_browser'};
  },
 };
}

// The browser host supplies its ALREADY-connected browser object. Only inspect
// its existing pages. Never attach to a new endpoint or make a page/context.
export async function connectExistingHost({browser,expectedPublicKey,extensionID}={}) {
 if(!browser||typeof browser.contexts!=='function')throw Error('existing_browser_not_connected');
 if(typeof browser.isConnected==='function'&&!browser.isConnected())throw Error('existing_browser_not_connected');
 let contexts;
 try{contexts=browser.contexts();}catch{throw Error('existing_browser_not_connected');}
 if(!Array.isArray(contexts))throw Error('existing_browser_not_connected');
 const matches=[];
 for(const context of contexts){
  if(!context||typeof context.pages!=='function')throw Error('invalid_existing_browser');
  let pages;try{pages=context.pages();}catch{throw Error('existing_browser_not_connected');}
  if(!Array.isArray(pages))throw Error('invalid_existing_browser');
  for(const page of pages){
   if(typeof page?.url!=='function'||typeof page?.evaluate!=='function')continue;
   try{if(typeof page.isClosed==='function'&&page.isClosed())continue;if(new URL(page.url()).origin===SITE)matches.push(page);}catch{}
  }
 }
 if(matches.length===0)throw Error('existing_agentkey_tab_required');
 if(matches.length!==1)throw Error('ambiguous_existing_agentkey_tabs');
 return connectExistingBrowser({page:matches[0],expectedPublicKey,extensionID});
}
