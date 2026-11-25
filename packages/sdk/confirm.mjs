// Positive sign-in confirmation shared by Free Local Mode and cloud mode.
// A blank page, an unsupported page or a page that merely lacks a login form is
// never treated as signed in: success needs the caller's verifier, a
// success selector, or a visible sign-out control. A changed URL is not proof
// of authentication: public home, help and error pages also receive redirects.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const USER='input[autocomplete="username"],input[type="email"],input[name*="user" i],input[name*="email" i],input[name*="login" i]';
export const PASS='input[type="password"]';
export const CHALLENGE='iframe[src*="captcha" i],iframe[src*="challenges.cloudflare" i],[class*="captcha" i],input[autocomplete="one-time-code"],input[name*="otp" i],input[name*="code" i][inputmode="numeric"],input[name*="totp" i]';
export const SIGN_OUT='a[href*="logout" i],a[href*="signout" i],a[href*="sign-out" i],a[href*="log-out" i],button[name*="logout" i],[data-testid*="logout" i],[data-testid*="signout" i]';
const SIGN_OUT_TEXT=/^\s*(sign|log)\s?-?\s?out\s*$/i;

async function isVisible(h){try{return (await h.isVisible?.())??((await h.boundingBox())!==null);}catch{return false;}}
export async function visible(page,sel){for(const h of await page.$$(sel))if(await isVisible(h))return true;return false;}
async function bodyText(page){try{return String(await page.evaluate(()=>document.body?(document.body.innerText||'').trim().slice(0,2000):''));}catch{return '';}}

export async function pageState(page,{root=page}={}){
 const url=String(page.url?.()??'');
 if(!url||url==='about:blank'||url.startsWith('chrome-error:')||url.startsWith('data:'))return 'blank';
 if(await visible(root,CHALLENGE))return 'challenge';
 if(await visible(root,PASS))return 'login_form';
 if(await visible(root,USER))return 'username_step';
 if(!(await bodyText(page)))return 'blank';
 return 'clear';
}

async function hasSignOut(page){
 if(await visible(page,SIGN_OUT))return true;
 for(const h of await page.$$('a,button,[role="button"],[role="menuitem"]')){
  try{const t=await h.evaluate(e=>(e.innerText||e.textContent||e.value||'').slice(0,40));if(SIGN_OUT_TEXT.test(t)&&await isVisible(h))return true;}catch{}
 }
 return false;
}

// Returns how sign-in was confirmed ('verify' | 'success_selector' | 'sign_out_control'), or null.
export async function confirmSignedIn(page,{verify,successSelector,signinUrl,submitted=true}={}){
 if(verify)return (await Promise.resolve().then(()=>verify(page)).catch(()=>false))?'verify':null;
 const st=await pageState(page);
 if(st!=='clear')return null;
 if(successSelector)return (await visible(page,successSelector))?'success_selector':null;
 if(await hasSignOut(page))return 'sign_out_control';
 // No account evidence: fail closed, even after a successful form navigation.
 return null;
}

export async function waitConfirmed(page,opts={},ms=8000,every=200){
 const end=Date.now()+ms;
 while(true){const c=await confirmSignedIn(page,opts).catch(()=>null);if(c)return c;if(Date.now()>=end)return null;await sleep(every);}
}
