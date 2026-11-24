import type {Bridge, BrowserTools, HostOptions, InspectedHost} from './contracts.mjs';
export function createAgentKeyFrameworkBridge<T extends BrowserTools>(options: HostOptions<T> & {
  createHost: () => InspectedHost; validateOrigin?: (origin: string) => unknown;
}): Bridge<T>;
