// Framework binding for an application-owned OpenAI Agents SDK runner.
// It maps every model-visible browser tool through AgentKey's exclusive gate.
// No OpenAI API client, agent, browser or credential is created here.
const REQUIRED=['agentkey_login_inspect','agentkey_login_begin','agentkey_login_resume'];
const EXPLANATIONS={
  agentkey_login_inspect:'Inspect redacted controls on an already open HTTPS sign-in page in the current browser.',
  agentkey_login_begin:'Request owner approval for the exact current page and selected login form controls; never request a password.',
  agentkey_login_resume:'Resume an already-approved AgentKey login and report verified sign-in or challenge status.',
};
const CODE=/^[a-z][a-z0-9_]{0,63}$/;

export function createOpenAIAgentsTools({bridge,tool,schemas,descriptions={}}={}){
  if(!bridge||!bridge.tools||typeof bridge.tools!=='object'||!Object.isFrozen(bridge.tools))
    throw Error('verified_agentkey_bridge_required');
  if(typeof tool!=='function'||!schemas||typeof schemas!=='object')
    throw Error('sdk_tool_factory_and_schema_map_required');
  const names=Object.keys(bridge.tools);
  if(REQUIRED.some(n=>!names.includes(n)))throw Error('required_agentkey_tools_missing');
  if(names.some(n=>!CODE.test(n)||typeof bridge.tools[n]!=='function'))
    throw Error('invalid_browser_tool');
  // Prevent an unsafe partial registration. A host must remove all original
  // builtin computer/browser/screenshot tools and replace them with this array.
  // Every registered tool must have a locally validated strict schema.
  if(names.some(n=>!schemas[n]||typeof schemas[n]!=='object'))
    throw Error('every_browser_tool_requires_a_schema');
  if(Object.keys(schemas).some(n=>!names.includes(n)))
    throw Error('unregistered_browser_tool_schema');

  return Object.freeze(names.map(name=>{
    const description=descriptions[name]??EXPLANATIONS[name];
    if(typeof description!=='string'||!description.trim()||description.length>512)
      throw Error('tool_description_required');
    return tool({
      name,description,strict:true,parameters:schemas[name],
      async execute(args){
        try{
          return await bridge.tools[name](args);
        }catch{
          // Do not forward browser-side errors that could contain untrusted
          // website text, selectors, usernames or sensitive runtime details.
          return {status:'unavailable',reason:'agentkey_operation_failed'};
        }
      },
    });
  }));
}
