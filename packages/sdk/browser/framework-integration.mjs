// Framework-neutral model tool boundary for trusted AgentKey integrations.
// The bridge itself locks every model-visible browser tool during credential
// delivery, fill, submission and cleanup. The host cannot forget the gate.
import {createCredentialUseGate} from './credential-gate.mjs';
import {createExistingBrowserLogin} from '../existing-browser-login.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const RESERVED=['agentkey_login_begin','agentkey_login_resume','agentkey_login_inspect'];

/**
 * Adapt any trusted, already-connected browser host to the same AgentKey tools.
 *
 * createHost returns a trusted existing-browser executor with setupStatus,
 * inspectTarget, prepareTarget, executeTarget and verifyLogin. The bridge
 * invokes executeTarget inside its own locked boundary, through private cleanup.
 * Hosts must not perform credential delivery outside executeTarget.
 *
 * All original model browser tools must be passed in browserTools and replaced
 * with the returned tools. The host must enforce that no other model browser
 * path, screenshot recorder or raw driver remains accessible.
 *
 * This does NOT attach to or install into an unsupported browser, supply vault
 * secrets to the model, or attest that a host really disabled its recorders.
 */
export function createAgentKeyFrameworkBridge({
  createHost,client,agentID,browserTools,recordingDisabled,
  generic=true,validateOrigin,
}={}){
  if(recordingDisabled!==true)throw Error('disable_browser_recording_before_integration');
  if(!browserTools||typeof browserTools!=='object'||Array.isArray(browserTools)||
    Object.values(browserTools).some(f=>typeof f!=='function'))throw Error('trusted_browser_tool_map_required');
  if(RESERVED.some(name=>Object.hasOwn(browserTools,name)))throw Error('reserved_tool_name');
  if(typeof createHost!=='function')throw Error('trusted_browser_host_factory_required');
  if(!UUID.test(agentID??''))throw Error('verified_agent_identity_required');
  if(!client||!['requestTarget','requestStatus','use'].every(k=>typeof client[k]==='function'))
    throw Error('agentkey_client_required');
  if(!generic&&typeof validateOrigin!=='function')throw Error('fixed_site_validator_required');

  const gate=createCredentialUseGate();
  const host=createHost();
  if(!host||!['setupStatus','inspectTarget','prepareTarget','preflightTarget','executeTarget','verifyLogin'].every(k=>typeof host[k]==='function'))
    throw Error('trusted_existing_browser_integration_required');
  // A future adapter cannot accidentally bypass the model browser lock by
  // forgetting to invoke a callback. Gate the entire sensitive execution here.
  const guardedHost={
    prepareTarget:(...args)=>host.prepareTarget(...args),
    preflightTarget:(...args)=>host.preflightTarget(...args),
    executeTarget:(...args)=>gate.withCredentialUse(()=>host.executeTarget(...args)),
    verifyLogin:(...args)=>host.verifyLogin(...args),
  };
  const flow=createExistingBrowserLogin({client,host:guardedHost});
  const tools=Object.fromEntries(Object.entries(browserTools).map(([name,handler])=>
    [name,args=>gate.modelAction(()=>handler(args))]));

  tools.agentkey_login_begin=async(args={})=>{
    if(!args||typeof args!=='object'||Array.isArray(args)||
      Object.keys(args).some(k=>!['intended_url','login_plan'].includes(k)))
      throw Error('invalid_login_arguments');
    const url=new URL(args.intended_url);
    if(!generic)validateOrigin(url.origin);
    return gate.modelAction(async()=>{
      const status=await host.setupStatus();
      if(!status?.target_protocol_ready)return{status:'setup_required',...status};
      return flow.begin({agent_id:agentID,intended_url:args.intended_url,login_plan:args.login_plan});
    });
  };
  tools.agentkey_login_inspect=({intended_url}={})=>
    gate.modelAction(()=>host.inspectTarget(intended_url));
  tools.agentkey_login_resume=({login_id}={})=>flow.resume(login_id);
  return Object.freeze({
    tools:Object.freeze(tools),
    setupStatus:host.setupStatus,
    browserStatus:gate.status,
  });
}
