export interface PageLike { url(): string; goto(url: string): Promise<unknown>; $$(selector: string): Promise<unknown[]>; bringToFront?(): Promise<void> }
export interface LoginResult {
  site: string; signed_in: boolean;
  /** completed = signed in and positively confirmed; needs_you = a CAPTCHA/2-step code was not finished in time;
   *  unverified/unknown = submitted but not confirmed (never retried automatically); failed = blank, unsupported or mismatched page. */
  outcome: 'completed' | 'needs_you' | 'unverified' | 'unknown' | 'failed'; handoff?: boolean; code?: string; operation_id?: string;
  /** How success was confirmed: your verify(), successSelector, a visible sign-out control, or leaving the sign-in page. */
  confirmed_by?: 'verify' | 'success_selector' | 'sign_out_control';
  /** Free Local Mode: the scoped permission used (revoke with `npx tryagentkey revoke <id>`). */
  permission_id?: string;
}
export interface LoginOptions { page?: PageLike; verify?: (page: PageLike) => Promise<boolean>; successSelector?: string; timeoutMs?: number }
export interface LocalPermission { id: string; origin: string; project: string; project_id: string; agent: string; created_at: string; expires_at: string | null; kind: 'standing' | 'limited'; uses: number; max_uses: number | null; last_used_at: string | null }
export interface AgentKeyVault {
  /** Developer secrets saved with `npx tryagentkey secret set NAME`. Website passwords are never returned. */
  getSecret(name: string): string | undefined;
  setSecret?(name: string, value: string): void;
  sites(): unknown;
  forget?(origin: string): void;
  /** Free Local Mode: scoped permissions (site + saved login + project folder + agent). */
  permissions?(): LocalPermission[];
  /** Revoke by permission id, site origin, or 'all'. Takes effect immediately, even in a running agent. */
  revoke?(target: string): number;
}
export interface PlainTools {
  login(url: string, opts?: LoginOptions): Promise<LoginResult>;
  withAuth<T>(url: string, fn: (page: PageLike, result: LoginResult) => Promise<T> | T, opts?: LoginOptions): Promise<T>;
  agentkey_login: { description: string; parameters: object; execute(args: { url: string }): Promise<LoginResult> };
}
export interface AgentKeyOptions {
  mode?: 'local' | 'cloud'; page?: PageLike; apiKey?: string; baseURL?: string; cwd?: string; home?: string; label?: string; agentName?: string; permissionDays?: number;
  onLink?: (url: string, why: string) => void; open?: (url: string) => void; pollMs?: number; fetchImpl?: typeof fetch;
}
export interface AgentKey {
  mode: 'local' | 'cloud';
  login(url: string, opts?: LoginOptions): Promise<LoginResult>;
  withAuth<T>(url: string, fn: (page: PageLike, result: LoginResult) => Promise<T> | T, opts?: LoginOptions): Promise<T>;
  /** Shaped for your framework: Vercel AI SDK tools, OpenAI Agents/LangChain tool arrays, MCP {tools, call}, or PlainTools. */
  tools: PlainTools | any;
  vault: AgentKeyVault;
  project: { framework: string; browser: string | null };
  agentId?: string;
  setPage(page: PageLike): void;
  ensureRuntime(): Promise<unknown>;
}
/** One line: reads .env / AGENTKEY_* and starts in Free Local Mode when no cloud key is set. */
export function agentkey(options?: AgentKeyOptions): Promise<AgentKey>;
export class AgentKeyError extends Error { code: string; hint?: string }
export function readEnv(env?: Record<string, string | undefined>, cwd?: string): { mode?: string; localKey?: string; apiKey?: string; baseURL: string; legacyToken?: string; agentId?: string };
