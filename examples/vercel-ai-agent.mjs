// npm install tryagentkey playwright ai @ai-sdk/openai && npx playwright install chromium
// Set OPENAI_API_KEY. Swap the model for any provider the AI SDK supports.
import { chromium } from "playwright";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { agentkey } from "tryagentkey";

const ak = await agentkey();
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
ak.setPage(page);

const { text } = await generateText({
  model: openai("gpt-4o-mini"),
  tools: ak.tools,
  maxSteps: 5,
  prompt: "Log in to https://github.com/login",
});
console.log(text);
await browser.close();
