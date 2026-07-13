import { Orchestrator, RunLedger, createTaskGraph, MockAdapter } from "../src/index.js";

const adapter = new MockAdapter();
const orch = new Orchestrator({
  cwd: process.cwd(),
  maxConcurrency: 2,
  dryRun: false,
  adapter,
  onProgress: (e) => console.log(`[${e.kind}] ${e.message}`),
});

const run = await orch.run("Add logging middleware");

console.log("\n--- Run Details ---");
console.log(`ID: ${run.id}`);
console.log(`Status: ${run.status}`);
console.log(`Goal: ${run.goal}`);
console.log(`Agent runs: ${run.agentRuns.length}`);
console.log(`Artifacts: ${run.artifacts.length}`);
console.log(`Decisions: ${run.decisions.length}`);

if (run.riskReport) {
  console.log(`\nRisk Report:`);
  console.log(`  Overall risk: ${run.riskReport.overallRisk}`);
  console.log(`  Findings: ${run.riskReport.findings.length}`);
}

if (run.mergePlan) {
  console.log(`\nMerge Plan:`);
  console.log(`  Summary: ${run.mergePlan.summary}`);
  console.log(`  Conflicts: ${run.mergePlan.conflicts.length}`);
}

console.log("\n--- Task Results ---");
for (const task of run.taskGraph.tasks) {
  const agentRun = run.agentRuns.find((ar) => ar.taskId === task.id);
  const diffInfo = agentRun?.diffFiles.length ? ` → changed: ${agentRun.diffFiles.join(", ")}` : "";
  console.log(`  ${task.status === "completed" ? "✓" : "✗"} ${task.role.padEnd(14)} ${task.title}${diffInfo}`);
}