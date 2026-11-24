import type {BrowserTools, GatedTools} from './contracts.mjs';
type RequiredTools = 'agentkey_login_inspect' | 'agentkey_login_begin' | 'agentkey_login_resume';
export function createOpenAIAgentsTools<T extends BrowserTools, S extends object, RegisteredTool>(options: {
  bridge: {readonly tools: GatedTools<T>};
  tool: (definition: {name: string; description: string; strict: true; parameters: S; execute(input: unknown): Promise<unknown>}) => RegisteredTool;
  schemas: Readonly<Record<(keyof T & string) | RequiredTools, S>>;
  descriptions?: Partial<Record<(keyof T & string) | RequiredTools, string>>;
}): readonly RegisteredTool[];
