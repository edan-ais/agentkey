import type {BrowserTools, PuppeteerOptions, SetupRequired} from './contracts.mjs';
export type Readiness = SetupRequired | Readonly<{
  ready: true; stage: 'ready_for_owner_approval'; inspected_controls: number; origin: string; original_browser_preserved: true;
  login_performed: false; owner_approval_requested: false; model_secret_exposure_verified: false;
  next_action: 'perform_owner_approved_login_and_verify_same_tab';
}>;
export function checkPuppeteerLoginReadiness<T extends BrowserTools>(options: PuppeteerOptions<T> & {intendedURL: string}): Promise<Readiness>;
