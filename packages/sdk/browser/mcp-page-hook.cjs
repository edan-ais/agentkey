// Called by the supported Playwright MCP initPage API, inside the trusted host.
// No page-owned scripts or model-supplied endpoint participate in enrollment.
exports.default = async ({ page }) => {
  const register = globalThis[Symbol.for('agentkey.playwright.register')];
  if (typeof register !== 'function') throw new Error('agentkey_bridge_not_running');
  register(page);
};
