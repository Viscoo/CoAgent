import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Orchestrator } from "../core/orchestrator.js";
import { MockAdapter } from "../adapters/mock-adapter.js";
import { type CoAgentRun } from "../core/types.js";

const BANNER = `
  ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
  ██                                                    ██
  ██            ▄▄█▀▀▀▀█▄▄   ▄▄█▀▀▀▀█▄▄               ██
  ██            ██        ██ ██        ██              ██
  ██            ▀▀█▄▄▄▄▄▄▄▀▀ ▀▀█▄▄▄▄▄▄▄▀▀              ██
  ██                                                    ██
  ██       🍤 CoAgent — Multi-Agent Orchestrator       ██
  ██        6 roles · task graph · merge gate          ██
  ██                                                    ██
  ██  Commands:                                         ██
  ██    <goal>       Run full orchestration flow        ██
  ██    status       Latest run status                  ██
  ██    logs         Decision log for last run          ██
  ██    runs         List recent runs                   ██
  ██    help         This screen                        ██
  ██    exit         Leave CoAgent                      ██
  ██                                                    ██
  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀

  例：输入 "重构项目配置" ，CoAgent 会启动 6 个角色协作
`;

const CHEVRON = "🍤  ";
const SEPARATOR = "  ─────────────────────────────────────────────";

export interface ChatOptions {
  cwd: string;
  failureRate?: number;
  concurrency?: number;
  retries?: number;
}

export async function startChat(options: ChatOptions): Promise<void> {
  const adapter = new MockAdapter({ failureRate: options.failureRate ?? 0 });
  const orchestrator = new Orchestrator({
    cwd: options.cwd,
    maxConcurrency: options.concurrency ?? 2,
    dryRun: false,
    adapter,
    maxRetries: options.retries ?? 2,
    onProgress: chatProgress,
  });

  const rl = createInterface({ input: stdin, output: stdout });
  console.log(BANNER);

  while (true) {
    const line = (await rl.question(CHEVRON)).trim();
    if (!line) continue;

    const lower = line.toLowerCase();

    if (lower === "exit" || lower === "quit" || lower === "q") {
      console.log(`\n  👋 Bye! 下次见 🍤\n`);
      rl.close();
      return;
    }

    if (lower === "help") {
      console.log(BANNER);
      continue;
    }

    if (lower === "status") {
      const run = await orchestrator.status();
      if (!run) {
        console.log("  📭 No runs yet.\n");
        continue;
      }
      printChatRun(run);
      continue;
    }

    if (lower === "logs") {
      const run = await orchestrator.status();
      if (!run) {
        console.log("  📭 No runs yet.\n");
        continue;
      }
      printChatLogs(run);
      continue;
    }

    if (lower === "runs") {
      const run = await orchestrator.status();
      if (!run) {
        console.log("  📭 No runs yet.\n");
        continue;
      }
      console.log(`  📋 Latest: ${run.id.slice(0, 12)}…  ${run.status}  ${run.goal.slice(0, 50)}\n`);
      continue;
    }

    // Treat as a goal — show role flow header
    console.log(`  📋 Goal: ${line}`);
    console.log(`  🎭 Roles: planner → explorer → implementer → reviewer + tester → integrator`);
    console.log(SEPARATOR);

    try {
      const run = await orchestrator.run(line);
      console.log("");
      printChatRun(run);
    } catch (error) {
      console.error(`  ✗ Error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
}

function chatProgress(event: {
  kind: string;
  role?: string;
  title?: string;
  message: string;
  error?: string;
}): void {
  const icon = event.kind === "task-complete" ? "  ✓" : event.kind === "task-fail" ? "  ✗" : event.kind === "task-retry" ? "  ↻" : event.kind === "task-start" ? "  ▶" : "  ·";
  stdout.write(`${icon} ${event.message}\n`);
  if (event.error) {
    stdout.write(`     └─ ${event.error}\n`);
  }
}

function printChatRun(run: CoAgentRun): void {
  const badge = run.status === "completed" ? "✓" : run.status === "failed" ? "✗" : run.status === "blocked" ? "⊘" : "·";
  console.log(`  ${SEPARATOR}`);
  console.log(`  ${badge} Finished: ${run.id.slice(0, 12)}…`);
  console.log(`    Goal: ${run.goal}`);
  console.log(`    Status: ${run.status}`);
  if (run.mergePlan) {
    console.log(`    Merge gate: ${run.mergePlan.status}${run.mergePlan.conflicts.length > 0 ? ` (${run.mergePlan.conflicts.length} conflicts)` : ""}`);
  }
  if (run.riskReport) {
    console.log(`    Risk: ${run.riskReport.status} (${run.riskReport.risks.length} risks)`);
  }
  console.log("    Tasks:");
  for (const task of run.taskGraph.tasks) {
    const tBadge = task.status === "completed" ? "✓" : task.status === "failed" ? "✗" : task.status === "running" ? "▶" : "·";
    const files = task.role === "implementer" ? " — files changed" : "";
    console.log(`      ${tBadge} ${task.role.padEnd(11)} ${task.title}${files}`);
  }
  console.log("");
}

function printChatLogs(run: CoAgentRun): void {
  console.log(`  📝 Decision log — ${run.id.slice(0, 12)}…`);
  console.log(SEPARATOR);
  for (const d of run.decisions) {
    const at = d.at.slice(11, 19);
    console.log(`  [${at}] ${d.actor.padEnd(10)} ${d.summary.slice(0, 60)}`);
  }
  console.log("");
}
