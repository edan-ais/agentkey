import type {BrowserTools, PuppeteerOptions, SetupResult} from './contracts.mjs';
export function setupPuppeteerAgentKey<T extends BrowserTools>(options: PuppeteerOptions<T>): Promise<SetupResult<T>>;
