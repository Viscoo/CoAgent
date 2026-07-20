import { type AgentSpec } from "../core/agent-registry.js";
import { type TaskNode } from "../core/types.js";
import { type CoAgentAdapter, type CoAgentSession, type CoAgentPromptResult } from "./adapter.js";

export interface OpenCodeSession extends CoAgentSession {}

export interface OpenCodePromptResult extends CoAgentPromptResult {}

export interface OpenCodeAdapterOptions {
  cwd: string;
  baseUrl?: string;
  startServer?: boolean;
}

export interface OpenCodeAdapter extends CoAgentAdapter {
  ensureReady(): Promise<void>;
  createParentSession(goal: string): Promise<OpenCodeSession>;
  createChildSession(parentSessionId: string, task: TaskNode, agent: AgentSpec): Promise<OpenCodeSession>;
  prompt(sessionId: string, prompt: string): Promise<OpenCodePromptResult>;
  diff(sessionId: string): Promise<string[]>;
  close(): Promise<void>;
}

export class SdkOpenCodeAdapter implements OpenCodeAdapter {
  readonly backend = "opencode";
  private client: import("../opencode-sdk/client.js").OpencodeClient | null = null;
  private serverClose: (() => void) | null = null;

  constructor(private readonly options: OpenCodeAdapterOptions) {}

  async ensureReady(): Promise<void> {
    let baseUrl: string | undefined = this.options.baseUrl;
    if (!baseUrl && this.options.startServer) {
      const { url, close } = await startLocalServer(this.options.cwd);
      baseUrl = url;
      this.serverClose = close;
    }

    if (!baseUrl) {
      throw new Error(
        "No OpenCode server URL. Provide --opencode-url or enable --start-server to start one.",
      );
    }

    const { createOpencodeClient } = await import("../opencode-sdk/client.js");
    this.client = createOpencodeClient({ baseUrl, directory: this.options.cwd });
  }

  async createParentSession(goal: string): Promise<OpenCodeSession> {
    const res = await this.requiredClient().session.create({
      body: { title: `CoAgent: ${goal}` },
    });
    if (res.error) throw new Error(`Failed to create session: ${sdkErrorMessage(res.error)}`);
    if (!res.data) throw new Error("Session create returned no data.");
    return { id: res.data.id };
  }

  async createChildSession(
    parentSessionId: string,
    task: TaskNode,
    agent: AgentSpec,
  ): Promise<OpenCodeSession> {
    const res = await this.requiredClient().session.create({
      body: {
        parentID: parentSessionId,
        title: `${agent.role}: ${task.title}`,
      },
    });
    if (res.error) throw new Error(`Failed to create child session: ${sdkErrorMessage(res.error)}`);
    if (!res.data) throw new Error("Child session create returned no data.");
    return { id: res.data.id };
  }

  async prompt(sessionId: string, userPrompt: string): Promise<OpenCodePromptResult> {
    const res = await this.requiredClient().session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: "text", text: userPrompt }],
      },
    });

    if (res.error) throw new Error(`Prompt failed: ${sdkErrorMessage(res.error)}`);
    if (!res.data) throw new Error("Prompt returned no data.");

    const info = res.data.info;
    const parts = res.data.parts;

    // Extract diff files from summary, or find file paths in tool parts
    const diffFiles: string[] = [];
    // `summary` may be false (no summary) or an object with diffs
    if (info.summary && typeof info.summary === "object") {
      const diffs: Array<{ file: string }> | undefined = (info.summary as Record<string, unknown>).diffs as Array<{ file: string }> | undefined;
      if (diffs) {
        for (const diff of diffs) {
          diffFiles.push(diff.file);
        }
      }
    }
    for (const part of parts) {
      if (part.type === "patch") {
        for (const file of part.files) {
          if (!diffFiles.includes(file)) diffFiles.push(file);
        }
      }
    }

    // Extract summary text
    let summary = "";
    for (const part of parts) {
      if (part.type === "text" && !part.synthetic) {
        summary += part.text + "\n";
      }
    }

    return {
      sessionId,
      messageId: info.id,
      summary: summary.trim() || undefined,
      diffFiles: [...new Set(diffFiles)].sort(),
      raw: res.data,
    };
  }

  async diff(sessionId: string): Promise<string[]> {
    const res = await this.requiredClient().session.diff({
      path: { id: sessionId },
    });
    if (res.error || !res.data) return [];
    return res.data.map((d: { file: string }) => d.file).sort();
  }

  async close(): Promise<void> {
    this.client = null;
    if (this.serverClose) {
      this.serverClose();
      this.serverClose = null;
    }
  }

  private requiredClient(): import("../opencode-sdk/client.js").OpencodeClient {
    if (!this.client) throw new Error("Adapter not ready. Call ensureReady() first.");
    return this.client;
  }
}

async function startLocalServer(cwd: string): Promise<{ url: string; close: () => void }> {
  const { createOpencodeServer } = await import("../opencode-sdk/server.js");
  const server = await createOpencodeServer({
    config: { logLevel: "ERROR" },
    hostname: "127.0.0.1",
    port: 0,
    timeout: 15000,
  });
  return { url: server.url, close: server.close };
}

function sdkErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    const data = e.data as { message?: string } | undefined;
    if (data?.message) return data.message;
    if (typeof e.message === "string") return e.message;
  }
  return String(error);
}
