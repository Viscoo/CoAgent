import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { type AgentSpec } from "../core/agent-registry.js";
import { type TaskNode } from "../core/types.js";
import { type CoAgentAdapter, type CoAgentPromptResult, type CoAgentSession } from "./adapter.js";

export interface ClaudeCodeAdapterOptions {
  cwd: string;
  model?: string;
}

interface ClaudeSession {
  id: string;
  parentId?: string;
  role?: string;
  taskTitle?: string;
  output: string;
}

export class ClaudeCodeAdapter implements CoAgentAdapter {
  readonly backend = "claude";
  private sessions = new Map<string, ClaudeSession>();
  private closed = false;

  constructor(private readonly options: ClaudeCodeAdapterOptions) {}

  async ensureReady(): Promise<void> {
    this.closed = false;
    const available = await this.checkClaudeAvailable();
    if (!available) {
      throw new Error(
        "Claude Code CLI not found. Install it with: npm install -g @anthropic-ai/claude-code\n" +
        "Or set ANTHROPIC_API_KEY environment variable.",
      );
    }
  }

  async createParentSession(goal: string): Promise<CoAgentSession> {
    const id = "claude-parent-" + randomBytes(4).toString("hex");
    this.sessions.set(id, { id, taskTitle: goal, output: "" });
    return { id };
  }

  async createChildSession(
    parentSessionId: string,
    task: TaskNode,
    _agent: AgentSpec,
  ): Promise<CoAgentSession> {
    const id = "claude-" + task.role + "-" + randomBytes(4).toString("hex");
    this.sessions.set(id, { id, parentId: parentSessionId, role: task.role, taskTitle: task.title, output: "" });
    return { id };
  }

  async prompt(sessionId: string, prompt: string): Promise<CoAgentPromptResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Unknown claude session: " + sessionId);

    try {
      const output = await this.runClaude(prompt);
      session.output = output;

      const diffFiles = this.extractDiffFiles(output);
      const summary = this.extractSummary(output);

      return {
        sessionId,
        messageId: "claude-msg-" + randomBytes(4).toString("hex"),
        summary: summary || output.slice(0, 500),
        diffFiles,
        raw: { output, role: session.role },
      };
    } catch (error) {
      throw new Error("Claude Code execution failed: " + (error instanceof Error ? error.message : String(error)));
    }
  }

  async diff(sessionId: string): Promise<string[]> {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return this.extractDiffFiles(session.output);
  }

  async close(): Promise<void> {
    this.sessions.clear();
    this.closed = true;
  }

  private async checkClaudeAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn("claude", ["--version"], { stdio: "pipe", shell: true });
      proc.on("exit", (code) => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  }

  private runClaude(prompt: string): Promise<string> {
    const args = ["-p", prompt, "--output-format", "text"];
    if (this.options.model) {
      args.push("--model", this.options.model);
    }

    return new Promise((resolve, reject) => {
      const proc = spawn("claude", args, {
        cwd: this.options.cwd,
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.on("exit", (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(stderr.trim() || "Claude exited with code " + code));
        }
      });

      proc.on("error", (err) => reject(err));
    });
  }

  private extractDiffFiles(output: string): string[] {
    const files: string[] = [];
    const patterns = [
      /(?:modified|created|deleted|renamed):\s+(.+)/gi,
      /(?:M|A|D|R)\s+(.+)/g,
      /diff --git a\/(.+) b\//g,
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(output)) !== null) {
        const file = match[1]?.trim();
        if (file && !files.includes(file)) files.push(file);
      }
    }
    return files;
  }

  private extractSummary(output: string): string {
    const lines = output.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length <= 3) return output;
    return lines.slice(0, 5).join(" ").slice(0, 500);
  }
}