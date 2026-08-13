import { type AgentSpec } from "./agent-registry.js";
import { type TaskNode, type PermissionMode } from "./types.js";
import { SecurityGuard } from "./security.js";

export interface PolicyViolation {
  severity: "medium" | "high";
  message: string;
  file?: string;
}

export class PolicyGuard {
  private readonly security: SecurityGuard | null = null;

  constructor(security?: SecurityGuard) {
    this.security = security ?? null;
  }

  validateDiff(task: TaskNode, agent: AgentSpec, diffFiles: string[]): PolicyViolation[] {
    const violations: PolicyViolation[] = [];

    if (!agent.canWrite && diffFiles.length > 0) {
      violations.push({
        severity: "high",
        message: `${agent.role} is read-only but produced file changes.`,
      });
    }

    if (agent.canWrite && task.assignedFiles.length > 0) {
      for (const file of diffFiles) {
        if (!isWithinScope(file, task.assignedFiles)) {
          violations.push({
            severity: "high",
            message: `${agent.role} changed a file outside its assigned scope.`,
            file,
          });
        }
      }
    }

    return violations;
  }

  validatePermission(
    actor: string,
    action: string,
    resource: string,
    permission: PermissionMode,
    task?: TaskNode,
  ): { allowed: boolean; reason?: string } {
    if (this.security) {
      return this.security.checkPermission(actor, action, resource, permission, task);
    }

    if (permission === "read-only" && action !== "read") {
      return { allowed: false, reason: "read-only permission denies write operations" };
    }
    if (permission === "review-gate" && action !== "read") {
      return { allowed: false, reason: "review-gate requires explicit approval" };
    }
    return { allowed: true };
  }

  checkDataOutput(content: string, destination?: string): { allowed: boolean; sanitized: string; reason?: string } {
    if (this.security) {
      return this.security.checkDataExfiltration(content, destination);
    }
    return { allowed: true, sanitized: content };
  }

  redact(content: string): string {
    if (this.security) {
      return this.security.redactContent(content);
    }
    return content;
  }
}

function isWithinScope(file: string, scopes: string[]): boolean {
  const normalizedFile = normalizePath(file);
  return scopes.some((scope) => {
    const normalizedScope = normalizePath(scope);
    return normalizedFile === normalizedScope || normalizedFile.startsWith(`${normalizedScope}/`);
  });
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}
