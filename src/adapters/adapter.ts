import { type TaskNode } from "../core/types.js";
import { type AgentSpec } from "../core/agent-registry.js";

export interface CoAgentSession {
  id: string;
}

export interface CoAgentPromptResult {
  sessionId: string;
  messageId?: string;
  summary?: string;
  diffFiles: string[];
  raw: unknown;
}

export interface CoAgentAdapter {
  readonly backend: string;
  ensureReady(): Promise<void>;
  createParentSession(goal: string): Promise<CoAgentSession>;
  createChildSession(parentSessionId: string, task: TaskNode, agent: AgentSpec): Promise<CoAgentSession>;
  prompt(sessionId: string, prompt: string): Promise<CoAgentPromptResult>;
  diff(sessionId: string): Promise<string[]>;
  close(): Promise<void>;
}

export type BackendType = "opencode" | "claude" | "mock";

export interface AdapterFactoryOptions {
  cwd: string;
  backend: BackendType;
  baseUrl?: string;
  startServer?: boolean;
  failureRate?: number;
  model?: string;
}

export function createAdapter(options: AdapterFactoryOptions): CoAgentAdapter {
  switch (options.backend) {
    case "opencode":
      return new (require("./opencode-adapter.js") as typeof import("./opencode-adapter.js")).SdkOpenCodeAdapter({
        cwd: options.cwd,
        baseUrl: options.baseUrl,
        startServer: options.startServer,
      });
    case "claude":
      return new (require("./claude-adapter.js") as typeof import("./claude-adapter.js")).ClaudeCodeAdapter({
        cwd: options.cwd,
        model: options.model,
      });
    case "mock":
    default:
      return new (require("./mock-adapter.js") as typeof import("./mock-adapter.js")).MockAdapter({
        failureRate: options.failureRate ?? 0,
      });
  }
}