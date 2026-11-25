// npm install tryagentkey playwright @openai/agents && npx playwright install chromium
// Set OPENAI_API_KEY. Tested with tryagentkey 0.6.2 and @openai/agents 0.22 on Node 22.
import { chromium } from "playwright";
import { Agent, run } from "@openai/agents";
import { agentkey } from "tryagentkey";

const ak = await agentkey(); // Free Local Mode. No account needed.
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
ak.setPage(page);

const agent = new Agent({
  name: "login-assistant",
  instructions: "You sign in to websites when asked. Use the AgentKey tools for any login.",
  tools: ak.tools, // ready-made tool array
});

const result = await run(agent, "Log in to https://github.com/login");
console.log(result.finalOutput);

await browser.close();
