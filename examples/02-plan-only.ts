import { Orchestrator, MockAdapter } from "../src/index.js";

const adapter = new MockAdapter();
const orch = new Orchestrator({
  cwd: process.cwd(),
  maxConcurrency: 2,
  dryRun: false,
  adapter,
});

const run = await orch.plan("Refactor the authentication module");

console.log("Plan created:");
console.log(`  Run ID: ${run.id}`);
console.log(`  Status: ${run.status}`);
console.log(`  Goal: ${run.goal}`);
console.log(`  Tasks:`);
for (const task of run.taskGraph.tasks) {
  const deps = task.dependsOn.length > 0 ? ` (depends: ${task.dependsOn.join(", ")})` : "";
  console.log(`    ${task.status === "pending" ? "○" : "●"} ${task.role.padEnd(14)} ${task.kind}${deps}`);
}