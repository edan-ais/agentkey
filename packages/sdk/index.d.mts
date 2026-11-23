export * from './connector.mjs';
export * from './existing-browser-login.mjs';
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
export * from "./auto.mjs";
