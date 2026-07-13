import { Orchestrator, MockAdapter } from "../src/index.js";

const adapter = new MockAdapter({ failureRate: 0.3 });
const orch = new Orchestrator({
  cwd: process.cwd(),
  maxConcurrency: 2,
  dryRun: false,
  adapter,
  maxRetries: 3,
  retryDelayMs: 1000,
  onProgress: (e) => {
    if (e.kind === "task-retry") {
      console.log(`  ⚠ Retry: ${e.role} — ${e.message} (attempt ${e.attempt}/${e.maxAttempts})`);
    } else if (e.kind === "task-fail") {
      console.log(`  ✗ Failed: ${e.role} — ${e.error}`);
    } else {
      console.log(`[${e.kind}] ${e.message}`);
    }
  },
});

const run = await orch.run("Add error handling to all API endpoints");
console.log(`\nFinal status: ${run.status}`);