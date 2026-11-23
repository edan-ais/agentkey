"""Positive sign-in confirmation, same rules as the JS SDK (confirm.mjs).
A blank page, an unsupported page or a page that merely lacks a login form is never
treated as signed in."""
import asyncio, contextvars, inspect, re, time
from urllib.parse import urlparse

SYNC = contextvars.ContextVar('agentkey_sync', default=False)

USER = 'input[autocomplete="username"],input[type="email"],input[name*="user" i],input[name*="email" i],input[name*="login" i]'
PASS = 'input[type="password"]'
CHALLENGE = 'iframe[src*="captcha" i],iframe[src*="challenges.cloudflare" i],[class*="captcha" i],input[autocomplete="one-time-code"],input[name*="otp" i],input[name*="code" i][inputmode="numeric"],input[name*="totp" i]'
SIGN_OUT = 'a[href*="logout" i],a[href*="signout" i],a[href*="sign-out" i],a[href*="log-out" i],button[name*="logout" i],[data-testid*="logout" i],[data-testid*="signout" i]'
_SIGN_OUT_TEXT = re.compile(r'^\s*(sign|log)\s?-?\s?out\s*$', re.I)
_LOOP = ("127.0.0.1", "localhost", "::1")

async def _a(v):
    return await v if inspect.isawaitable(v) else v

async def sleep(s):
    if SYNC.get():
        time.sleep(s)  # sync Playwright: nothing to yield to
    else:
        await asyncio.sleep(s)

async def _is_visible(h):
    try:
        return bool(await _a(h.is_visible()))
    except Exception:
        return False

async def visible(page, sel):
    for h in await _a(page.query_selector_all(sel)):
        if await _is_visible(h):
            return True
    return False

async def _body_text(page):
    try:
        return str(await _a(page.evaluate("() => document.body ? (document.body.innerText || '').trim().slice(0, 2000) : ''")) or '')
    except Exception:
        return ''

def _url(page):
    try:
        return str(page.url or '')
    except Exception:
        return ''

async def page_state(page):
    u = _url(page)
    if not u or u == "about:blank" or u.startswith("chrome-error:") or u.startswith("data:"):
        return "blank"
    if await visible(page, CHALLENGE): return "challenge"
    if await visible(page, PASS): return "login_form"
    if await visible(page, USER): return "username_step"
    if not await _body_text(page): return "blank"
    return "clear"

async def _has_sign_out(page):
    if await visible(page, SIGN_OUT):
        return True
    for h in await _a(page.query_selector_all('a,button,[role="button"],[role="menuitem"]')):
        try:
            t = await _a(h.evaluate("e => (e.innerText || e.textContent || e.value || '').slice(0, 40)"))
            if _SIGN_OUT_TEXT.match(t or '') and await _is_visible(h):
                return True
        except Exception:
            pass
    return False

async def confirm_signed_in(page, verify=None, success_selector=None, signin_url=None, submitted=True):
    """Returns 'verify' | 'success_selector' | 'sign_out_control', or None."""
    if verify:
        try:
            return "verify" if await _a(verify(page)) else None
        except Exception:
            return None
    if await page_state(page) != "clear":
        return None
    if success_selector:
        return "success_selector" if await visible(page, success_selector) else None
    if await _has_sign_out(page):
        return "sign_out_control"
    # A redirect to a public home/help/error page is not authentication proof.
    return None

async def wait_for(fn, secs, every=0.15):
    end = time.monotonic() + secs
    while time.monotonic() < end:
        try:
            if await fn():
                return True
        except Exception:
            pass
        await sleep(every)
    return False

async def wait_confirmed(page, secs=8, every=0.2, **opts):
    end = time.monotonic() + secs
    while True:
        c = await confirm_signed_in(page, **opts)
        if c or time.monotonic() >= end:
            return c
        await sleep(every)
