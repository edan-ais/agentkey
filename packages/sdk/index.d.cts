export interface PageLike { url(): string; goto(url: string): Promise<unknown>; $$(selector: string): Promise<unknown[]>; bringToFront?(): Promise<void> }
export interface LoginResult {
  site: string; signed_in: boolean;
  /** completed = signed in; needs_you = a CAPTCHA/2-step code was not finished in time; unknown = submitted but not confirmed. */
  outcome: 'completed' | 'needs_you' | 'unknown' | 'failed'; handoff?: boolean; code?: string; operation_id?: string;
}
export interface LoginOptions { page?: PageLike; verify?: (page: PageLike) => Promise<boolean>; timeoutMs?: number }
export interface AgentKeyVault {
  /** Developer secrets saved with `npx tryagentkey secret set NAME`. Website passwords are never returned. */
  getSecret(name: string): string | undefined;
  setSecret?(name: string, value: string): void;
  sites(): unknown;
  forget?(origin: string): void;
}
export interface PlainTools {
  login(url: string, opts?: LoginOptions): Promise<LoginResult>;
  withAuth<T>(url: string, fn: (page: PageLike, result: LoginResult) => Promise<T> | T, opts?: LoginOptions): Promise<T>;
  agentkey_login: { description: string; parameters: object; execute(args: { url: string }): Promise<LoginResult> };
}
export interface AgentKeyOptions {
  mode?: 'local' | 'cloud'; page?: PageLike; apiKey?: string; baseURL?: string; cwd?: string; home?: string; label?: string; agentName?: string;
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

// Cloud client types, shared by the ESM and CommonJS entries.
export interface RequestInput {
  agent_id: string; executor_id: string; origin: string; site_name: string; signin_url?: string;
}
export interface UseInput {origin: string; executor_key_id: string; idempotency_key: string}
export type RequestResult = Partial<{
  site_name: string; request_id: string; status: string; grant_id: string | null; expires_at: string | null;
  request_url: string; signin_link: string; code: string; next_action: string;
}>;
export type TargetRequestResult = Partial<{
  request_id: string; status: string; origin: string; executor_id: string; executor_key_id: string;
  expires_at: string; request_url: string; next_action: string;
}>;
export type RequestStatus = Partial<{
  request_id: string; agent_id: string; agent_name: string; executor_id: string; executor_key_id: string;
  origin: string; action: string; state: string; expires_at: string | null; grant_id: string | null;
}>;
export type OperationResult = Partial<{operation_id: string; status: string; code: string; next_action: string}>;
export type OperationReceipt = Partial<{operation_id: string; grant_id: string; status: string; reserved_at: string; finished_at: string | null}>;
export interface AgentRules {agent_id: string; current_version: number; acknowledged_version: number; status: string; update: {version: number; kind: 'full' | 'diff'; text: string} | null}
export class AgentKeyClient {
  constructor(options: {baseURL?: string; token: () => string | Promise<string>; fetchImpl?: typeof fetch});
  request(input: RequestInput): Promise<RequestResult>;
  requestTarget(input: {agent_id: string; executor_id: string; target_id: string}): Promise<TargetRequestResult>;
  requestStatus(id: string): Promise<RequestStatus>;
  use(grantId: string, input: UseInput): Promise<OperationResult>;
  receipt(id: string): Promise<OperationReceipt>;
  rules(options?: {acknowledge?: boolean}): Promise<AgentRules[]>;
}
export function agentKeyTools(client: AgentKeyClient): {
  agentkey_request(input: RequestInput): Promise<RequestResult>;
  agentkey_request_status(input: {request_id: string}): Promise<RequestStatus>;
  agentkey_use(input: UseInput & {grant_id: string}): Promise<OperationResult>;
  agentkey_receipt(input: {operation_id: string}): Promise<OperationReceipt>;
  agentkey_rules(): Promise<AgentRules[]>;
};
