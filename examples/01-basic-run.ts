import { Orchestrator, MockAdapter } from "../src/index.js";

const adapter = new MockAdapter();
const orch = new Orchestrator({
  cwd: process.cwd(),
  maxConcurrency: 2,
  dryRun: false,
  adapter,
  onProgress: (e) => console.log(`[${e.kind}] ${e.message}`),
});

const run = await orch.run("Add a hello-world API endpoint");
console.log("\n--- Run Summary ---");
console.log(orch.summarize(run));