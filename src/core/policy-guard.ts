import { type AgentSpec } from "./agent-registry.js";
import { type TaskNode } from "./types.js";

export interface PolicyViolation {
  severity: "medium" | "high";
  message: string;
  file?: string;
}

export class PolicyGuard {
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
