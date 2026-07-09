import { describe, expect, test } from "bun:test";
import { MergeGate, buildRiskReport } from "../src/core/merge-gate.js";
import { createTaskGraph } from "../src/core/task-graph.js";
import { type CoAgentRun } from "../src/core/types.js";

describe("merge gate", () => {
  test("passes when implementers edit different files", () => {
    const run = fixtureRun([
      ["task_a", ["src/a.ts"]],
      ["task_b", ["src/b.ts"]],
    ]);
    expect(new MergeGate().evaluate(run).status).toBe("clean");
  });

  test("requires integrator when implementers edit the same file", () => {
    const run = fixtureRun([
      ["task_a", ["src/shared.ts"]],
      ["task_b", ["src/shared.ts"]],
    ]);
    const plan = new MergeGate().evaluate(run);
    expect(plan.status).toBe("needs-integrator");
    expect(plan.conflicts[0]?.file).toBe("src/shared.ts");
  });

  test("emits a warning risk report when integrator is required", () => {
    const run = fixtureRun([
      ["task_a", ["src/shared.ts"]],
      ["task_b", ["src/shared.ts"]],
    ]);
    const gate = new MergeGate();
    run.mergePlan = gate.evaluate(run);
    const report = buildRiskReport(run);

    expect(run.mergePlan.status).toBe("needs-integrator");
    expect(report.status).toBe("warn");
    expect(report.requiredApprovals).toEqual(["integrator"]);
  });

  test("blocks when a review gate fails", () => {
    const run = fixtureRun([["task_a", ["src/a.ts"]]]);
    run.agentRuns.push({
      id: "review_run",
      taskId: "review_task",
      role: "reviewer",
      status: "failed",
      prompt: "review",
      diffFiles: [],
      artifacts: [],
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    });
    expect(new MergeGate().evaluate(run).status).toBe("blocked");
  });
});

function fixtureRun(entries: Array<[string, string[]]>): CoAgentRun {
  const graph = createTaskGraph("test");
  return {
    id: "run_test",
    cwd: "/tmp/coagent",
    goal: "test",
    status: "running",
    taskGraph: graph,
    agentRuns: entries.map(([taskId, diffFiles], index) => ({
      id: `agent_${index}`,
      taskId,
      role: "implementer",
      status: "completed",
      prompt: "implement",
      diffFiles,
      artifacts: [],
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    })),
    artifacts: [],
    decisions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
