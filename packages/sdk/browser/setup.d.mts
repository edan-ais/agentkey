import type {BrowserTools, PlaywrightOptions, SetupResult} from './contracts.mjs';
export type {Bridge, BrowserStatus, BrowserTools, LoginTools, PlaywrightOptions, PuppeteerOptions, SetupRequired, SetupResult, SetupStatus} from './contracts.mjs';
export function setupExistingBrowserAgentKey<T extends BrowserTools>(options: PlaywrightOptions<T> & {exclusiveBrowserTools: true}): Promise<SetupResult<T>>;
