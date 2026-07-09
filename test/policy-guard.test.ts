import { describe, expect, test } from "bun:test";
import { AgentRegistry } from "../src/core/agent-registry.js";
import { PolicyGuard } from "../src/core/policy-guard.js";
import { createTaskGraph } from "../src/core/task-graph.js";

describe("policy guard", () => {
  test("blocks read-only agents that produce diffs", () => {
    const registry = new AgentRegistry();
    const task = createTaskGraph("ship").tasks.find((item) => item.role === "explorer");
    if (!task) throw new Error("explorer task missing");

    const violations = new PolicyGuard().validateDiff(task, registry.get("explorer"), ["src/a.ts"]);
    expect(violations[0]?.severity).toBe("high");
  });

  test("blocks implementers outside assigned scope", () => {
    const registry = new AgentRegistry();
    const task = createTaskGraph("ship").tasks.find((item) => item.role === "implementer");
    if (!task) throw new Error("implementer task missing");
    task.assignedFiles = ["src/allowed"];

    const violations = new PolicyGuard().validateDiff(task, registry.get("implementer"), [
      "src/other/file.ts",
    ]);
    expect(violations).toHaveLength(1);
  });

  test("allows implementers inside assigned scope", () => {
    const registry = new AgentRegistry();
    const task = createTaskGraph("ship").tasks.find((item) => item.role === "implementer");
    if (!task) throw new Error("implementer task missing");
    task.assignedFiles = ["src/allowed"];

    const violations = new PolicyGuard().validateDiff(task, registry.get("implementer"), [
      "src/allowed/file.ts",
    ]);
    expect(violations).toHaveLength(0);
  });
});
