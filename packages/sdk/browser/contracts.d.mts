import type {LoginHost, LoginPlan, LoginReceipt, TargetClient} from '../existing-browser-login.mjs';

type Callable = (...args: never[]) => unknown;
export type BrowserTools = Record<string, Callable>;
export interface Page {
  url(): string;
  evaluate: Callable;
  isClosed?(): boolean;
}
export interface PuppeteerPage extends Page {isClosed(): boolean; browserContext(): unknown}
export interface PlaywrightBrowser {contexts(): ReadonlyArray<{pages(): readonly Page[]}>; isConnected?(): boolean}
export interface PuppeteerBrowser {readonly connected: boolean; pages(): Promise<readonly PuppeteerPage[]>}
export interface SetupStatus {connected: boolean; paired: boolean; target_protocol_ready: boolean; next_action: string}
export interface BrowserStatus {available: boolean; credential_use_active: boolean; quarantined: boolean}
export interface Inspection {
  origin: string; plan_id: string; expires_at?: number;
  controls: ReadonlyArray<{ref: string; tag?: string; type?: string; autocomplete?: string; label?: string}>;
}
export interface InspectedHost extends LoginHost {
  setupStatus(): Promise<SetupStatus>;
  inspectTarget(url: string): Promise<Inspection>;
}
export interface LoginTools {
  agentkey_login_inspect(input: {intended_url: string}): Promise<Inspection>;
  agentkey_login_begin(input: {intended_url: string; login_plan?: LoginPlan}): Promise<LoginReceipt | (SetupStatus & {status: 'setup_required'})>;
  agentkey_login_resume(input: {login_id: string}): Promise<LoginReceipt>;
}
export type GatedTools<T extends BrowserTools> = Readonly<LoginTools & {
  [K in keyof T]: (...args: Parameters<T[K]>) => Promise<Awaited<ReturnType<T[K]>>>;
}>;
export interface Bridge<T extends BrowserTools> {
  readonly tools: GatedTools<T>;
  setupStatus(): Promise<SetupStatus>;
  browserStatus(): BrowserStatus;
}
export interface HostOptions<T extends BrowserTools> {
  agentID: string; client: TargetClient; browserTools: T; recordingDisabled: true; generic?: boolean;
}
export type PlaywrightOptions<T extends BrowserTools> = HostOptions<T> & {
  browser: PlaywrightBrowser; relayPage?: Page; expectedPublicKey: string; extensionID?: string;
};
export type PuppeteerOptions<T extends BrowserTools> = HostOptions<T> & {
  browser: PuppeteerBrowser; relayPage?: PuppeteerPage; expectedPublicKey: string; extensionID?: string; exclusiveBrowserTools: true;
};
export type SetupRequired = Readonly<{ready: false; stage: string; next_action: string}>;
export type SetupResult<T extends BrowserTools> = SetupRequired | Readonly<Bridge<T> & {
  ready: true; stage: 'ready_for_approved_login'; next_action: 'inspect_existing_login_page';
}>;
