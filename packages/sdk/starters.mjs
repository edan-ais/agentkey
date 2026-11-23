// One starter file per detected framework, written by bare `npx tryagentkey`.
// Each one only wires AgentKey's login tools into the agent the developer already has.
export const STARTERS={
 'vercel-ai':`import { agentkey } from 'tryagentkey'
// Pass these to generateText/streamText: { tools: { ...ak.tools, ...yourTools } }
export const ak = await agentkey()
export const agentkeyTools = ak.tools
`,
 'openai-agents':`import { agentkey } from 'tryagentkey'
// new Agent({ name, instructions, tools: [...agentkeyTools, ...yourTools] })
export const ak = await agentkey()
export const agentkeyTools = ak.tools
`,
 'langchain':`import { agentkey } from 'tryagentkey'
// createReactAgent({ llm, tools: [...agentkeyTools, ...yourTools] })
export const ak = await agentkey()
export const agentkeyTools = ak.tools
`,
 'mastra':`import { agentkey } from 'tryagentkey'
// new Agent({ name, instructions, model, tools: { ...agentkeyTools, ...yourTools } })
export const ak = await agentkey()
export const agentkeyTools = ak.tools
`,
 'mcp':`import { agentkey } from 'tryagentkey'
// In your MCP server: list ak.tools.tools, and route calls to ak.tools.call(name, args)
export const ak = await agentkey()
export const agentkeyTools = ak.tools
`,
 'plain':`import { agentkey } from 'tryagentkey'
// const page = await browser.newPage(); await ak.login('https://site.example/login', { page })
export const ak = await agentkey()
export const agentkeyTools = ak.tools
`,
};
export const STARTER_FILE='agentkey.mjs';
