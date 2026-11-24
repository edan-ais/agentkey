// Trusted bootstrap for an ALREADY-running Playwright-compatible browser.
// The framework must retain the raw browser/recorders outside all model channels.
import {createAgentKeyFrameworkBridge} from './framework-integration.mjs';
import {createTargetedBrowserHost} from './targeted.mjs';

export function createPlaywrightAgentKey({
  browser,relayPage,expectedPublicKey,client,agentID,browserTools,
  recordingDisabled,generic=true,extensionID,
}={}){
  if(generic!==true)throw Error('generic_exact_identity_flow_required');
  return createAgentKeyFrameworkBridge({
    client,agentID,browserTools,recordingDisabled,generic,
    createHost:()=>{
      return createTargetedBrowserHost({
        browser,relayPage,expectedPublicKey,
        // Targeted host's legacy direct API accepts a callback. The shared
        // bridge now owns the outer credential gate and calls this host only
        // while the model browser channel is locked.
        withCredentialUse:action=>action(),
        genericOnly:true,extensionID,
      });
    },
  });
}
