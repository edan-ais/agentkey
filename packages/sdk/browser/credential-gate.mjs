// Trusted framework boundary. Keep the original driver outside model tools.
// Every model read, screenshot, recording, script and write must pass modelAction.
// Not a sandbox for a model that already holds another browser control channel.
export function createCredentialUseGate(){
 let locked=false,poisoned=false,active=0,drained;
 return Object.freeze({
  async modelAction(action){
   if(typeof action!=='function')throw Error('browser_action_required');
   if(locked||poisoned)throw Error('credential_use_in_progress_or_cleanup_required');
   active++;
   try{return await action();}finally{active--;if(active===0&&drained){const done=drained;drained=undefined;done();}}
  },
  async withCredentialUse(action){
   if(typeof action!=='function'||locked||poisoned)throw Error('credential_boundary_unavailable');
   locked=true;
   try{
    if(active>0)await new Promise(resolve=>{drained=resolve;});
    return await action();
   }catch{poisoned=true;throw Error('credential_use_failed_browser_quarantined');}
   finally{locked=false;}
  },
  status(){return{available:!locked&&!poisoned,credential_use_active:locked,quarantined:poisoned};},
 });
}
