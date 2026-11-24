# SDK 0.5.5

Adds existing agent-browser integration entry points for Playwright, Puppeteer and trusted framework hosts. This uses the existing owner-authorized browser and paired extension, not a new browser or profile.

Custom hosts must implement preflightTarget(target) before grant use. Use only the returned gated browser tools and disable independent recordings and bypass tools. Built-in adapters require the exact-identity generic flow and pin the relay browser context. This is a trusted-host boundary, not isolation against malicious code in the host process.

Human-check handoff requires extension 0.3.1 with human_verification_guard capability. Extension 0.3.0 will not pass the new readiness gate. A recognized human check is handed back to the owner in the same browser, never clicked or solved by AgentKey. Resume only checks the existing attempt; it never refills, and the original verification deadline is not extended. Unknown challenges and expired checks remain unverified.

Availability limit: before claiming, the extension checks every locally prepared generic target. A challenge or unavailable guard in one prepared target can block another prepared target's execution. This conservative check avoids relying on an operation preview that does not identify its target. Start with only the intended prepared target when possible; never bypass a failed guard.

This release has static review and artifact/build evidence. Production acceptance with a user's real paired profile remains pending. It does not establish universal site support, challenge detection, completed real-site sign-in, or compatibility with every agent host. Extension 0.3.1 is a separate store release and is not yet installed or accepted in the user's browser.
