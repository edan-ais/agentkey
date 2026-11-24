import type {AgentKeyClient} from './index.mjs';
export type TargetClient = Pick<AgentKeyClient, 'requestTarget' | 'requestStatus' | 'use'>;
export interface LoginPlan {
  plan_id: string;
  username_ref?: string;
  password_ref?: string;
  submit_ref: string;
}
export interface DeliveryTarget {
  version: 2; target_id: string; executor_id: string; executor_key_id: string;
  executor_key: string; origin: string; target_expires_at: number;
  login_step?: 'username' | 'password' | 'username_and_password';
}
export interface LoginHost {
  prepareTarget(url: string, plan?: LoginPlan): Promise<DeliveryTarget>;
  preflightTarget(target: DeliveryTarget): Promise<void>;
  executeTarget(operationId: string, target: DeliveryTarget): Promise<{ok: boolean; filled: boolean}>;
  verifyLogin(target: DeliveryTarget): Promise<{authenticated: boolean; same_browser: boolean; challenge?: 'one_time_code' | 'human_verification'}>;
}
export type LoginReceipt = {
  login_id: string; request_id: string;
  status: 'awaiting_approval' | 'in_progress' | 'signed_in' | 'challenge_required' | 'login_unverified' | 'expired' |
    'denied' | 'revoked' | 'unavailable' | 'unknown' | 'fill_failed' | 'step_completed';
  login_step?: DeliveryTarget['login_step']; approval_url?: string; expires_at?: string;
  filled?: boolean; login_verified?: boolean; challenge_type?: 'one_time_code' | 'human_verification'; next_action?: string;
};
export type LoginInput = {agent_id: string; intended_url: string; login_plan?: LoginPlan};
export interface ExistingBrowserLogin {
  begin(input: LoginInput): Promise<LoginReceipt>;
  resume(loginId: string): Promise<LoginReceipt>;
}
export function createExistingBrowserLogin(options: {
  client: TargetClient; host: LoginHost; now?: () => number; randomId?: () => string;
}): ExistingBrowserLogin;
export function existingBrowserLoginTools(flow: ExistingBrowserLogin): {
  agentkey_login_begin: ExistingBrowserLogin['begin'];
  agentkey_login_resume(input: {login_id: string}): Promise<LoginReceipt>;
};
