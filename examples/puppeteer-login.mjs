// npm install tryagentkey puppeteer
import puppeteer from "puppeteer";
import { agentkey } from "tryagentkey";

const ak = await agentkey(); // Free Local Mode. No account needed.
const browser = await puppeteer.launch({ headless: false });
const page = await browser.newPage();

// You approve on a local page. The password is filled into this page, not returned here.
const result = await ak.login("https://github.com/login", { page });
console.log(result);

await browser.close();
