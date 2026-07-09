#!/usr/bin/env bun
import { execSync } from "node:child_process";
import { cwd as processCwd, exit, stdout } from "node:process";
import { SdkOpenCodeAdapter } from "./adapters/opencode-adapter.js";
import { MockAdapter } from "./adapters/mock-adapter.js";
import { startChat } from "./cli/chat.js";
import { Orchestrator } from "./core/orchestrator.js";
import { type CoAgentRun, type OrchestratorOptions } from "./core/types.js";

const VERSION = "0.2.0";

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Map<string, string | boolean>;
}

async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const command = parsed.command;

  if (command === "version" || command === "--version" || command === "-v") {
    console.log(`coagent v${VERSION}`);
    return;
  }

  if (command === "help" || command === "--help" || command === "-h" || !command) {
    printHelp();
    return;
  }

  const cwd = stringFlag(parsed, "cwd") ?? processCwd();
  const useMock = booleanFlag(parsed, "mock") || !stringFlag(parsed, "opencode-url");
  const adapter = useMock
    ? new MockAdapter({ failureRate: Number(stringFlag(parsed, "mock-failure-rate") ?? "0") })
    : new SdkOpenCodeAdapter({
        cwd,
        baseUrl: stringFlag(parsed, "opencode-url"),
        startServer: booleanFlag(parsed, "start-server"),
      });
  const options: OrchestratorOptions = {
    cwd,
    maxConcurrency: Number(stringFlag(parsed, "concurrency") ?? "2"),
    dryRun: booleanFlag(parsed, "dry-run") || command === "plan",
    startOpenCodeServer: booleanFlag(parsed, "start-server"),
    openCodeBaseUrl: stringFlag(parsed, "opencode-url"),
    maxRetries: Number(stringFlag(parsed, "retries") ?? "2"),
    onProgress: booleanFlag(parsed, "dry-run") ? undefined : printProgress,
    adapter,
  };
  const orchestrator = new Orchestrator(options);

  if (command === "init") {
    const files = await orchestrator.init();
    console.log(`CoAgent scaffold ready (${files.length} files checked).`);
    return;
  }

  if (command === "plan") {
    const goal = requireGoal(parsed);
    const run = await orchestrator.plan(goal);
    printRun(run, "Plan created");
    return;
  }

  if (command === "run") {
    const goal = requireGoal(parsed);
    const run = await orchestrator.run(goal);
    console.log(""); // newline after progress output
    printRun(run, "Run finished");
    return;
  }

  if (command === "status") {
    const run = await orchestrator.status(parsed.positional[0]);
    if (!run) {
      console.log("No CoAgent runs found.");
      return;
    }
    printRun(run, "Status");
    return;
  }

  if (command === "resume") {
    const runId = parsed.positional[0];
    if (!runId) throw new Error("resume requires a run id.");
    const run = await orchestrator.resume(runId);
    printRun(run, "Resume finished");
    return;
  }

  if (command === "logs") {
    const runId = parsed.positional[0];
    const run = runId ? await orchestrator.status(runId) : await orchestrator.status();
    if (!run) {
      console.log("No CoAgent runs found.");
      return;
    }
    printLogs(run);
    return;
  }

  if (command === "chat") {
    await startChat({
      cwd,
      failureRate: Number(stringFlag(parsed, "mock-failure-rate") ?? "0"),
      concurrency: options.maxConcurrency,
      retries: options.maxRetries,
    });
    return;
  }

  if (command === "open") {
    const opencodeBin = await findOpencodeBinary();
    if (opencodeBin) {
      try {
        const { createOpencodeTui } = await import("@opencode-ai/sdk/server");
        console.log("Launching OpenCode with CoAgent config...");
        createOpencodeTui({
          project: cwd,
          config: {
            model: stringFlag(parsed, "model") ?? "opencode/claude-sonnet-4-6",
          },
          signal: new AbortController().signal,
        });
        // The TUI runs in the foreground; we only reach here on signal/close
        return;
      } catch {
        // Fall through to chat
      }
    }
    console.log("No OpenCode binary found — starting CoAgent interactive chat instead.");
    console.log("  (install the opencode CLI to use the native TUI)");
    console.log("");
    await startChat({
      cwd,
      failureRate: Number(stringFlag(parsed, "mock-failure-rate") ?? "0"),
      concurrency: options.maxConcurrency,
      retries: options.maxRetries,
    });
    return;
  }

  throw new Error(`Unknown command: ${command || "<empty>"}. Run coagent help.`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "", ...rest] = argv;
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = rest[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      index += 1;
    } else {
      flags.set(key, true);
    }
  }
  return { command, positional, flags };
}

function requireGoal(parsed: ParsedArgs): string {
  const goal = parsed.positional.join(" ").trim();
  if (!goal) throw new Error(`${parsed.command} requires a goal.`);
  return goal;
}

function stringFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function booleanFlag(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags.get(name) === true;
}

function printProgress(event: {
  kind: string;
  role?: string;
  title?: string;
  attempt?: number;
  maxAttempts?: number;
  message: string;
  error?: string;
}): void {
  const symbol = progressSymbol(event.kind);
  const retry = event.attempt && event.maxAttempts ? ` [${event.attempt}/${event.maxAttempts}]` : "";
  stdout.write(`\r${symbol} ${event.message}${retry}\n`);
  if (event.error) {
    stdout.write(`  └─ ${event.error}\n`);
  }
}

function progressSymbol(kind: string): string {
  switch (kind) {
    case "task-start":
      return "▶";
    case "task-retry":
      return "↻";
    case "task-complete":
      return "✓";
    case "task-fail":
      return "✗";
    case "run-status":
      return "◆";
    default:
      return "·";
  }
}

const sigintMessage = "\n⚠️  Caught SIGINT. Finishing current task batch before exit...\n";

function setupSignalHandler(): () => void {
  let shuttingDown = false;
  const handler = (signal: string) => {
    if (shuttingDown) {
      console.error(`\n⚠️  ${signal} received again. Forcing exit.`);
      exit(1);
    }
    shuttingDown = true;
    stdout.write(sigintMessage);
  };
  process.on("SIGINT", () => handler("SIGINT"));
  process.on("SIGTERM", () => handler("SIGTERM"));
  return () => {
    shuttingDown = true;
  };
}

function printRun(run: CoAgentRun, title: string): void {
  console.log(`\n${title}: ${run.id}`);
  console.log(`  Status: ${statusBadge(run.status)}`);
  console.log(`  Goal: ${run.goal}`);
  console.log(`  Ledger: ${run.cwd}/.coagent/runs/${run.id}/run.json`);
  if (run.mergePlan) {
    console.log(`  Merge gate: ${run.mergePlan.status} - ${run.mergePlan.summary}`);
  }
  if (run.riskReport) {
    console.log(`  Risk: ${run.riskReport.status} (${run.riskReport.risks.length} risks)`);
  }
  console.log("  Tasks:");
  for (const task of run.taskGraph.tasks) {
    console.log(`    ${statusBadge(task.status)} ${task.role.padEnd(11)} ${task.title}`);
  }
}

function statusBadge(status: string): string {
  const badges: Record<string, string> = {
    completed: "✓",
    running: "▶",
    pending: "·",
    failed: "✗",
    blocked: "⊘",
    skipped: "−",
    planned: "○",
    clean: "✓",
    "needs-integrator": "△",
    pass: "✓",
    warn: "△",
    fail: "✗",
  };
  return (badges[status] ?? "?").padEnd(3);
}

function printLogs(run: CoAgentRun): void {
  console.log(`Decisions for ${run.id} (${run.goal})\n`);
  for (const decision of run.decisions) {
    const at = decision.at.slice(0, 19).replace("T", " ");
    console.log(`  [${at}] ${decision.actor} ${decision.kind}`);
    console.log(`         ${decision.summary}`);
  }

  if (run.artifacts.length > 0) {
    console.log(`\nArtifacts (${run.artifacts.length}):`);
    for (const artifact of run.artifacts) {
      console.log(`  - ${artifact.type}: ${artifact.path ?? "(inline)"}`);
    }
  }
}

function printHelp(): void {
  console.log(`CoAgent v${VERSION} — Multi-agent orchestration for OpenCode

Usage:
  coagent init
  coagent plan "<goal>"
  coagent run "<goal>" [--dry-run] [--start-server] [--opencode-url <url>]
  coagent status [run-id]
  coagent resume <run-id>
  coagent logs [run-id]
  coagent chat
  coagent open [--opencode-url <url>]
  coagent version

Options:
  --cwd <path>             Workspace directory. Defaults to current directory.
  --concurrency <n>        Max ready tasks to run together. Defaults to 2.
  --retries <n>            Max retries per task (exponential backoff). Defaults to 2.
  --dry-run                Create local plan/ledger without contacting OpenCode.
  --start-server           Start "opencode serve" before using the SDK adapter.
  --opencode-url <url>     OpenCode server base URL.
  --mock                   Force mock adapter (default: auto when no URL given).
  --mock-failure-rate <n>  Mock adapter failure probability 0-1. Defaults to 0.

Interative chat:
  coagent chat              Open an interactive CoAgent session.
  ctrl-c or "exit"          Leave the interactive session.
`);
}

async function findOpencodeBinary(): Promise<string | undefined> {
  try {
    const result = execSync(
      process.platform === "win32" ? "where opencode 2>nul" : "which opencode 2>/dev/null",
      { encoding: "utf8", timeout: 2000 },
    ).trim();
    return result || undefined;
  } catch {
    return undefined;
  }
}

const exitHandler = setupSignalHandler();

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
});
