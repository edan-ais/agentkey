// Infers which agent framework a project uses from its package.json. No setup.
import {readFileSync} from 'node:fs';import {join} from 'node:path';
const ORDER=[['ai','vercel-ai'],['@openai/agents','openai-agents'],['@langchain/core','langchain'],['langchain','langchain'],['@modelcontextprotocol/sdk','mcp']];
const BROWSERS=['playwright','playwright-core','@playwright/test','puppeteer','puppeteer-core'];
export function detectProject(cwd=process.cwd()){
 let pkg={};try{pkg=JSON.parse(readFileSync(join(cwd,'package.json'),'utf8'));}catch{}
 const deps={...pkg.dependencies,...pkg.devDependencies};
 const framework=(ORDER.find(([d])=>Object.hasOwn(deps,d))||[,'plain'])[1];
 const browser=BROWSERS.find(d=>Object.hasOwn(deps,d))||null;
 return {framework,browser};
}
