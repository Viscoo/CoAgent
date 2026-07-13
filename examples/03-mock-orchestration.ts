import { Orchestrator, MockAdapter } from "../src/index.js";

const adapter = new MockAdapter();
const orch = new Orchestrator({
  cwd: process.cwd(),
  maxConcurrency: 2,
  dryRun: false,
  adapter,
  onProgress: (e) => {
    switch (e.kind) {
      case "info":
        break;
      case "task-start":
        console.log(`  ▶ ${e.role}: ${e.title}`);
        break;
      case "task-complete":
        console.log(`  ✓ ${e.role}: 完成${e.message.includes("changed") ? ` — ${e.message.split("(")[1]?.replace(")", "")}` : ""}`);
        break;
      case "task-retry":
        console.log(`  ⚠ ${e.role}: 失败，正在重试 (${e.attempt}/${e.maxAttempts})`);
        break;
      case "task-fail":
        console.log(`  ✗ ${e.role}: 最终失败 — ${e.error}`);
        break;
    }
  },
});

console.log("目标: Add a hello-world API endpoint\n");
console.log("开始编排执行：\n");

const run = await orch.run("Add a hello-world API endpoint");

console.log("\n--- 执行结果 ---");
console.log(`状态: ${run.status === "completed" ? "✓ 完成" : "✗ 失败"}`);
console.log(`运行 ID: ${run.id}`);

console.log("\n各角色产出：");
for (const ar of run.agentRuns) {
  const icon = ar.status === "completed" ? "✓" : "✗";
  const diffInfo = ar.diffFiles.length > 0 ? `\n    修改文件: ${ar.diffFiles.join(", ")}` : "";
  const summaryInfo = ar.summary ? `\n    摘要: ${ar.summary}` : "";
  console.log(`  ${icon} ${ar.role}${diffInfo}${summaryInfo}`);
}

if (run.mergePlan) {
  console.log(`\n合并评估: ${run.mergePlan.status === "clean" ? "✓ 无冲突，可直接合并" : `△ ${run.mergePlan.summary}`}`);
}