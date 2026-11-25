// Project instructions for coding agents. No website credentials or cloud enrollment.
import {lstatSync,readFileSync,writeFileSync,realpathSync,openSync,closeSync,fstatSync,constants} from 'node:fs';
import {join} from 'node:path';
const START='<!-- AgentKey managed instructions: start -->',END='<!-- AgentKey managed instructions: end -->';
const BODY=`## AgentKey login setup for this coding agent
The user ran npx tryagentkey to set up Free Local Mode. Use bare npx tryagentkey setup only, not init: direct init is a legacy human CLI that prints an approval link. Never approve setup or login on behalf of the owner. Finish supported integration without asking the developer to add imports or edit agent code manually.

- Inspect this project's actual agent entry point and browser tools. Install the published tryagentkey package in the project if missing. Use its local default, with no AgentKey account or cloud pairing required. Preserve an existing explicitly configured cloud mode; do not silently migrate vaults or credentials.
- Wire agentkey() and its login tools into the existing agent framework. Pass the EXISTING Playwright/Puppeteer page, or call setPage with it. Register the login tools in the actual agent, not only an unused starter file. Preserve existing tools and behavior. Do not start a replacement browser, export cookies, or copy a profile.
- When an authorized task needs a website login, use AgentKey's login tool in that same browser. Never ask for a password in chat, code or environment variables. The owner enters it on AgentKey's local approval page. A saved login is not permission; honor the owner's exact site, account and duration choice. Setup does not authorize arbitrary account access or actions.
- A recognized human check is an intermediate step, not a completed test. Use the site's normal UI within the task's authority, or ask the owner to complete it in the same browser. No paid solver, bypass, or automatic repeated credential submission. If a legitimate route cannot continue, report the exact remaining need, not success.
- Report signed in only after positive authenticated evidence on the intended account and original browser. Missing login fields or a changed URL is not proof. Keep an uncertain submission uncertain; never blindly retry.
- Read the installed package's AGENTKEY_GUIDE.md for the real API and trust limits. Free Local Mode trusts the host process and OS account; it is not a sandbox against arbitrary code there. For untrusted callers, a separately trusted credential boundary is required.
- After wiring, run the actual supported agent in production mode through owner approval and a real authorized login, then verify task continuation. Do not substitute a mock or prototype. Report wiring pending until the actual agent discovers and uses the login tool.

These are coding-agent integration instructions, not automatic runtime-host attachment. If this agent cannot edit its own project or access its existing browser through a supported API, say that the runtime browser bridge is still required. Never claim npx alone attached an unsupported browser.`;
const block=()=>START+'\n'+BODY+'\n'+END;
function snapshot(path){
 let fd;try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const st=fstatSync(fd);if(!st.isFile()||st.nlink!==1)throw Error('unsafe_agent_instruction_file');const body=readFileSync(fd,'utf8');const after=fstatSync(fd);if(st.ino!==after.ino||st.size!==after.size||st.mtimeMs!==after.mtimeMs)throw Error('agent_instructions_changed_retry_setup');return{body,dev:st.dev,ino:st.ino,size:st.size,mtimeMs:st.mtimeMs};}catch(e){if(e.code==='ENOENT')return null;throw e;}finally{if(fd!==undefined)closeSync(fd);}
}
export function preflightAgentInstructions({cwd=process.cwd()}={}){
 const root=realpathSync(cwd),files=['AGENTS.md'];if(snapshot(join(root,'CLAUDE.md')))files.push('CLAUDE.md');
 return files.map(file=>{const path=join(root,file),old=snapshot(path),body=old?.body??'';const a=body.indexOf(START),b=body.indexOf(END);
 if((a<0)!==(b<0)||a>=0&&(b<a||body.indexOf(START,a+START.length)>=0||body.indexOf(END,b+END.length)>=0))throw Error('agent_instruction_markers_conflict');
 if(a>=0&&body.slice(a,b+END.length)!==block())throw Error('agent_instruction_managed_section_differs_review_before_update');
 return{file,path,old,append:a<0?(body.endsWith('\n')?'':'\n')+'\n'+block()+'\n':null};});
}
// No rewrite/rename of existing user files: append only. This is not a
// multi-file transaction or protection against arbitrary concurrent writers.
export function installAgentInstructions({cwd=process.cwd(),plan=preflightAgentInstructions({cwd})}={}){
 const results=[];
 try{for(const item of plan){const{file,path,old,append}=item;let fd;
  try{if(!old){fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o644);writeFileSync(fd,append);}
  else{fd=openSync(path,constants.O_RDWR|constants.O_APPEND|constants.O_NOFOLLOW);const st=fstatSync(fd);if(!st.isFile()||st.nlink!==1||st.dev!==old.dev||st.ino!==old.ino||st.size!==old.size||st.mtimeMs!==old.mtimeMs||readFileSync(fd,'utf8')!==old.body)throw Error('agent_instructions_changed_retry_setup');
   const target=lstatSync(path);if(target.dev!==st.dev||target.ino!==st.ino||target.isSymbolicLink())throw Error('agent_instruction_target_changed');if(append!==null)writeFileSync(fd,append);
  }
  const now=snapshot(path),expected=(old?.body??'')+(append??'');if(!now||now.body!==expected)throw Error('agent_instructions_concurrent_change_inspect_file');
  results.push({file,status:append===null?'unchanged':old?'appended':'created'});
  }finally{if(fd!==undefined)closeSync(fd);}
 }
 }catch(e){e.message+='; local setup may already exist; instruction files already processed: '+(results.map(x=>x.file).join(', ')||'none')+'; inspect files before retrying';throw e;}
 return{instructions_installed:true,runtime_wired:false,files:results,next_action:'coding_agent_finishes_existing_browser_integration'};
}
