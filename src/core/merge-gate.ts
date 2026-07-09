import {
  type AgentRun,
  type CoAgentRun,
  type MergePlan,
  type RiskItem,
  type RiskReport,
  nowIso,
} from "./types.js";

export class MergeGate {
  evaluate(run: CoAgentRun): MergePlan {
    const implementationRuns = run.agentRuns.filter(
      (agentRun) => agentRun.role === "implementer" && agentRun.status === "completed",
    );
    const fileOwners = new Map<string, Set<string>>();

    for (const agentRun of implementationRuns) {
      for (const file of agentRun.diffFiles) {
        if (!fileOwners.has(file)) fileOwners.set(file, new Set());
        fileOwners.get(file)?.add(agentRun.taskId);
      }
    }

    const conflicts = [...fileOwners.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([file, owners]) => ({
        file,
        taskIds: [...owners].sort(),
        reason: "Multiple implementer tasks modified the same file.",
      }));

    const reviewBlocked = this.isGateFailed(run.agentRuns, "reviewer");
    const testBlocked = this.isGateFailed(run.agentRuns, "tester");
    const status = reviewBlocked || testBlocked ? "blocked" : conflicts.length > 0 ? "needs-integrator" : "clean";

    return {
      status,
      modifiedFiles: [...fileOwners.keys()].sort(),
      conflicts,
      requiredAgents: status === "clean" ? [] : ["integrator"],
      summary: this.summaryFor(status, conflicts.length, reviewBlocked, testBlocked),
      createdAt: nowIso(),
    };
  }

  private isGateFailed(agentRuns: AgentRun[], role: "reviewer" | "tester"): boolean {
    const matchingRuns = agentRuns.filter((agentRun) => agentRun.role === role);
    return matchingRuns.some((agentRun) => agentRun.status === "failed" || agentRun.status === "blocked");
  }

  private summaryFor(
    status: MergePlan["status"],
    conflictCount: number,
    reviewBlocked: boolean,
    testBlocked: boolean,
  ): string {
    if (reviewBlocked || testBlocked) {
      const gates = [
        reviewBlocked ? "review" : undefined,
        testBlocked ? "test" : undefined,
      ].filter(Boolean);
      return `Merge blocked by failed gates: ${gates.join(", ")}.`;
    }
    if (status === "needs-integrator") {
      return `Integrator required for ${conflictCount} conflicting file(s).`;
    }
    return "Merge gate passed with no file ownership conflicts.";
  }
}

export function buildRiskReport(run: CoAgentRun): RiskReport {
  const risks: RiskItem[] = run.agentRuns
    .filter((agentRun) => agentRun.status === "failed" || agentRun.status === "blocked")
    .map((agentRun) => ({
      severity: "high" as const,
      title: `${agentRun.role} ${agentRun.status}`,
      detail: agentRun.error ?? agentRun.summary ?? "Agent did not complete successfully.",
    }));

  if (run.mergePlan?.status === "needs-integrator") {
    risks.push({
      severity: "medium",
      title: "Integrator required",
      detail: run.mergePlan.summary,
    });
  }

  return {
    status: risks.some((risk) => risk.severity === "high") ? "fail" : risks.length > 0 ? "warn" : "pass",
    risks,
    requiredApprovals: run.mergePlan?.requiredAgents.map((role) => role) ?? [],
    createdAt: nowIso(),
  };
}

export function createEmptyMergePlan(summary = "No implementation diff recorded yet."): MergePlan {
  return {
    status: "clean",
    modifiedFiles: [],
    conflicts: [],
    requiredAgents: [],
    summary,
    createdAt: nowIso(),
  };
}
