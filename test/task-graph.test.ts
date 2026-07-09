import { describe, expect, test } from "bun:test";
import { createTaskGraph, getReadyTasks, updateTaskStatus } from "../src/core/task-graph.js";

describe("task graph", () => {
  test("creates the default CoAgent workflow", () => {
    const graph = createTaskGraph("ship feature");
    expect(graph.tasks.map((task) => task.role)).toEqual([
      "planner",
      "explorer",
      "implementer",
      "reviewer",
      "tester",
      "integrator",
    ]);
    expect(getReadyTasks(graph).map((task) => task.role)).toEqual(["planner"]);
  });

  test("unlocks dependent tasks after completion", () => {
    const graph = createTaskGraph("ship feature");
    const planner = graph.tasks.find((task) => task.role === "planner");
    if (!planner) throw new Error("planner task missing");

    const updated = updateTaskStatus(graph, planner.id, "completed");
    expect(getReadyTasks(updated).map((task) => task.role)).toEqual(["explorer"]);
  });
});
