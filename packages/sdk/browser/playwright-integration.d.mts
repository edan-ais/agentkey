import type {Bridge, BrowserTools, Page, PlaywrightOptions} from './contracts.mjs';
export function createPlaywrightAgentKey<T extends BrowserTools>(options: PlaywrightOptions<T> & {relayPage: Page}): Bridge<T>;
