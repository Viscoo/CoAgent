import { createTaskGraph, getReadyTasks, updateTaskStatus, inferGraphStatus } from "../src/index.js";

const graph = createTaskGraph("Build a REST API for user management");

console.log("Initial task graph:");
for (const task of graph.tasks) {
  const deps = task.dependsOn.length > 0 ? ` → depends on [${task.dependsOn.join(", ")}]` : "";
  console.log(`  ${task.role.padEnd(14)} priority=${task.priority}${deps}`);
}

console.log("\nSimulating execution step by step:\n");
let current = graph;
while (true) {
  const ready = getReadyTasks(current);
  if (ready.length === 0) break;

  for (const task of ready) {
    console.log(`  ▶ Running: ${task.role} (${task.title})`);
    current = updateTaskStatus(current, task.id, "completed");
    console.log(`  ✓ Done: ${task.role}`);
  }
}

const finalStatus = inferGraphStatus(current.tasks);
console.log(`\nGraph final status: ${finalStatus}`);