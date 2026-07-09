import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Orchestrator } from "../core/orchestrator.js";
import { MockAdapter } from "../adapters/mock-adapter.js";
import { type CoAgentRun } from "../core/types.js";

const BANNER = `
  ╔══════════════════════════════════════╗
  ║        CoAgent — Interactive        ║
  ║   Multi-agent orchestration shell   ║
  ╚══════════════════════════════════════╝

  Commands:
    <goal>       Run a full orchestration flow
    status       Show latest run status
    logs         Show latest run decision log
    runs         List recent runs
    help         Show this screen
    exit|quit    Leave CoAgent
`;

const CHEVRON = "🍤 ";

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
      console.log("Bye! 🍤");
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
        console.log("  No runs yet.\n");
        continue;
      }
      printChatRun(run);
      continue;
    }

    if (lower === "logs") {
      const run = await orchestrator.status();
      if (!run) {
        console.log("  No runs yet.\n");
        continue;
      }
      printChatLogs(run);
      continue;
    }

    if (lower === "runs") {
      const run = await orchestrator.status();
      if (!run) {
        console.log("  No runs yet.\n");
        continue;
      }
      console.log(`  Latest: ${run.id} — ${run.status} — ${run.goal.slice(0, 50)}\n`);
      continue;
    }

    // Treat as a goal
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
  const symbol = event.kind === "task-complete" ? "✓" : event.kind === "task-fail" ? "✗" : event.kind === "task-retry" ? "↻" : event.kind === "task-start" ? "▶" : "·";
  stdout.write(`  ${symbol} ${event.message}\n`);
  if (event.error) {
    stdout.write(`    └─ ${event.error}\n`);
  }
}

function printChatRun(run: CoAgentRun): void {
  const badge = run.status === "completed" ? "✓" : run.status === "failed" ? "✗" : run.status === "blocked" ? "⊘" : "·";
  console.log(`  ${badge} Run: ${run.id}`);
  console.log(`    Goal: ${run.goal}`);
  console.log(`    Status: ${run.status}`);
  if (run.mergePlan) {
    console.log(`    Merge: ${run.mergePlan.status}`);
  }
  console.log("    Tasks:");
  for (const task of run.taskGraph.tasks) {
    const tBadge = task.status === "completed" ? "✓" : task.status === "failed" ? "✗" : "·";
    console.log(`      ${tBadge} ${task.role.padEnd(11)} ${task.title}`);
  }
  console.log("");
}

function printChatLogs(run: CoAgentRun): void {
  console.log(`  Decisions for ${run.id}:`);
  for (const d of run.decisions) {
    const at = d.at.slice(11, 19);
    console.log(`    [${at}] ${d.actor} — ${d.summary.slice(0, 60)}`);
  }
  console.log("");
}
