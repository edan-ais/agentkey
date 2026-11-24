// npm install tryagentkey playwright && npx playwright install chromium
import { chromium } from "playwright";
import { agentkey } from "tryagentkey";

const ak = await agentkey(); // Free Local Mode. No account needed.
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

// You approve on a local page. The password is filled into this page, not returned here.
const result = await ak.login("https://github.com/login", { page });
console.log(result);

await browser.close();
