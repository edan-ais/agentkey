export type ConnectorScope = 'agentkey:updates' | 'agentkey:inventory' | 'agentkey:request' | 'agentkey:fill' | 'offline_access';
export interface TokenView {
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
  scope: string;
  obtained_at: number;
}
export interface ConnectorOptions {
  issuer?: string;
  clientId: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
  /** Persist privately per end user. The null value removes that user's token view. */
  onTokens?: (tokens: Readonly<TokenView> | null) => void | Promise<void>;
}
export interface Connector {
  issuer: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  connectUrl(options?: {scopes?: readonly ConnectorScope[]; state?: string}): {url: string; verifier: string; state: string};
  completeConnect(input: {code: string; verifier: string}): Promise<Pick<TokenView, 'scope' | 'expires_in'>>;
  refresh(): Promise<Pick<TokenView, 'scope' | 'expires_in'>>;
  accessToken(): Promise<string>;
  restore(view: Pick<TokenView, 'access_token' | 'refresh_token' | 'obtained_at'> & Partial<Pick<TokenView, 'scope' | 'expires_in'>>): void | Promise<void>;
  callTool(name: string, args?: Record<string, unknown>): Promise<unknown[]>;
  updates(): Promise<unknown[]>;
  inventory(): Promise<unknown[]>;
  requestLogin(input: {origin: string; siteName: string; signinUrl: string}): Promise<unknown[]>;
  requestStatus(requestId: string): Promise<unknown[]>;
  useGrant(input: {grantId: string; origin: string; executorKeyId: string; idempotencyKey?: string}): Promise<unknown[]>;
  disconnect(): Promise<{revoked: boolean}>;
}
export function createAgentKeyConnector(options: ConnectorOptions): Connector;
export function createEmbeddedConnector(options: Omit<ConnectorOptions, 'redirectUri'>): Connector;
export function registerAgentKeyClient(options: {
  issuer?: string; clientName: string; redirectUris: readonly string[]; fetchImpl?: typeof fetch;
}): Promise<{clientId: string; redirectUris: string[]}>;
