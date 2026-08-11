import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { type AgentSpec } from "../core/agent-registry.js";
import { type TaskNode } from "../core/types.js";
import { type CoAgentAdapter, type CoAgentPromptResult, type CoAgentSession } from "./adapter.js";

export interface HermesAdapterOptions {
  cwd: string;
  model?: string;
}

interface HermesSession {
  id: string;
  parentId?: string;
  role?: string;
  taskTitle?: string;
  output: string;
}

export class HermesAdapter implements CoAgentAdapter {
  readonly backend = "hermes";
  private sessions = new Map<string, HermesSession>();
  private closed = false;

  constructor(private readonly options: HermesAdapterOptions) {}

  async ensureReady(): Promise<void> {
    this.closed = false;
    const available = await this.checkHermesAvailable();
    if (!available) {
      throw new Error(
        "Hermes CLI not found. Install it or ensure 'hermes' is on PATH.",
      );
    }
  }

  async createParentSession(goal: string): Promise<CoAgentSession> {
    const id = "hermes-parent-" + randomBytes(4).toString("hex");
    this.sessions.set(id, { id, taskTitle: goal, output: "" });
    return { id };
  }

  async createChildSession(
    parentSessionId: string,
    task: TaskNode,
    _agent: AgentSpec,
  ): Promise<CoAgentSession> {
    const id = "hermes-" + task.role + "-" + randomBytes(4).toString("hex");
    this.sessions.set(id, { id, parentId: parentSessionId, role: task.role, taskTitle: task.title, output: "" });
    return { id };
  }

  async prompt(sessionId: string, prompt: string): Promise<CoAgentPromptResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Unknown hermes session: " + sessionId);

    try {
      const output = await this.runHermes(prompt);
      session.output = output;

      const diffFiles = this.extractDiffFiles(output);
      const summary = this.extractSummary(output);

      return {
        sessionId,
        messageId: "hermes-msg-" + randomBytes(4).toString("hex"),
        summary: summary || output.slice(0, 500),
        diffFiles,
        raw: { output, role: session.role },
      };
    } catch (error) {
      throw new Error("Hermes execution failed: " + (error instanceof Error ? error.message : String(error)));
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

  private async checkHermesAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn("hermes", ["--version"], { stdio: "pipe", shell: true });
      proc.on("exit", (code) => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  }

  private runHermes(prompt: string): Promise<string> {
    const args = ["--prompt", prompt];
    if (this.options.model) {
      args.push("--model", this.options.model);
    }

    return new Promise((resolve, reject) => {
      const proc = spawn("hermes", args, {
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
          reject(new Error(stderr.trim() || "Hermes exited with code " + code));
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