import { Orchestrator, MockAdapter } from "../src/index.js";

const adapter = new MockAdapter({ failureRate: 0.4 });
const orch = new Orchestrator({
  cwd: process.cwd(),
  maxConcurrency: 2,
  dryRun: false,
  adapter,
  maxRetries: 3,
  retryDelayMs: 500,
  onProgress: (e) => {
    switch (e.kind) {
      case "task-start":
        if (e.attempt && e.attempt > 1) {
          console.log(`  ↻ ${e.role}: 重试第 ${e.attempt} 次 — ${e.title}`);
        }
        break;
      case "task-complete":
        console.log(`  ✓ ${e.role}: 完成`);
        break;
      case "task-retry":
        console.log(`  ⚠ ${e.role}: 执行失败，${(e.attempt ?? 0) + 1}秒后重试... (${e.error})`);
        break;
      case "task-fail":
        console.log(`  ✗ ${e.role}: 重试耗尽，最终失败 — ${e.error}`);
        break;
    }
  },
});

console.log("目标: Add error handling to all API endpoints");
console.log("模拟: 40% 随机失败率，最多重试 3 次\n");

const run = await orch.run("Add error handling to all API endpoints");

const completed = run.agentRuns.filter((ar) => ar.status === "completed").length;
const failed = run.agentRuns.filter((ar) => ar.status === "failed").length;
console.log(`\n结果: ${completed} 成功, ${failed} 失败 — 总状态: ${run.status}`);