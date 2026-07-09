import { AgentRegistry } from "./agent-registry.js";
import { MergeGate, buildRiskReport, createEmptyMergePlan } from "./merge-gate.js";
import { PolicyGuard } from "./policy-guard.js";
import { RunLedger } from "./run-ledger.js";
import { createTaskGraph, getReadyTasks, summarizeRun, updateTaskStatus } from "./task-graph.js";
import { setTimeout as sleep } from "node:timers/promises";
import {
  type AgentRun,
  type CoAgentRun,
  type OrchestratorOptions,
  type ProgressEvent,
  type TaskNode,
  newId,
  nowIso,
} from "./types.js";
import { type OpenCodeAdapter } from "../adapters/opencode-adapter.js";
import { MockAdapter } from "../adapters/mock-adapter.js";

export interface RunGoalOptions extends Partial<OrchestratorOptions> {
  goal: string;
  mode: "plan" | "run" | "resume";
  runId?: string;
}

export class Orchestrator {
  private readonly registry: AgentRegistry;
  private readonly ledger: RunLedger;
  private readonly mergeGate: MergeGate;
  private readonly policyGuard: PolicyGuard;

  constructor(
    private readonly options: OrchestratorOptions,
    private readonly adapter: OpenCodeAdapter = options.adapter ?? new MockAdapter(),
  ) {
    this.registry = new AgentRegistry();
    this.ledger = new RunLedger(options.cwd);
    this.mergeGate = new MergeGate();
    this.policyGuard = new PolicyGuard();
  }

  async init(): Promise<string[]> {
    return this.registry.ensureWorkspaceScaffold(this.options.cwd);
  }

  async plan(goal: string): Promise<CoAgentRun> {
    await this.init();
    const taskGraph = createTaskGraph(goal);
    const run = await this.ledger.create(goal, taskGraph);
    await this.ledger.save(run);
    return run;
  }

  async run(goal: string): Promise<CoAgentRun> {
    let run = await this.plan(goal);
    if (this.options.dryRun) {
      run = this.ledger.appendDecision(run, {
        actor: "coagent",
        kind: "dry-run",
        summary: "Created plan and scaffold without contacting OpenCode.",
        details: {},
      });
      run.mergePlan = createEmptyMergePlan("Dry run created no implementation diff.");
      await this.ledger.save(run);
      return run;
    }

    await this.adapter.ensureReady();
    const parent = await this.adapter.createParentSession(goal);
    run = this.ledger.setStatus(run, "running");
    run = this.ledger.appendDecision(run, {
      actor: "opencode",
      kind: "parent-session-created",
      summary: `Created parent session ${parent.id}.`,
      details: { sessionId: parent.id },
    });
    await this.ledger.save(run);

    try {
      run = await this.executeTasks(run, parent.id);
      run.mergePlan = this.mergeGate.evaluate(run);
      run.riskReport = buildRiskReport(run);
      run = this.ledger.setStatus(run, finalStatusAfterMerge(run));
      await this.ledger.save(run);
      return run;
    } finally {
      await this.adapter.close();
    }
  }

  async resume(runId: string): Promise<CoAgentRun> {
    let run = await this.ledger.load(runId);
    if (run.status === "completed" || run.status === "blocked" || run.status === "failed") {
      return run;
    }
    if (this.options.dryRun) {
      run = this.ledger.appendDecision(run, {
        actor: "coagent",
        kind: "dry-resume",
        summary: "Loaded run without contacting OpenCode.",
        details: { runId },
      });
      await this.ledger.save(run);
      return run;
    }
    await this.adapter.ensureReady();
    const parent = await this.adapter.createParentSession(run.goal);
    try {
      run = await this.executeTasks(run, parent.id);
      run.mergePlan = this.mergeGate.evaluate(run);
      run.riskReport = buildRiskReport(run);
      run = this.ledger.setStatus(run, finalStatusAfterMerge(run));
      await this.ledger.save(run);
      return run;
    } finally {
      await this.adapter.close();
    }
  }

  async status(runId?: string): Promise<CoAgentRun | undefined> {
    return runId ? this.ledger.load(runId) : this.ledger.latest();
  }

  summarize(run: CoAgentRun): string {
    return summarizeRun(run);
  }

  private async executeTasks(run: CoAgentRun, parentSessionId: string): Promise<CoAgentRun> {
    let current = run;
    while (true) {
      const ready = getReadyTasks(current.taskGraph);
      if (ready.length === 0) break;
      const batch = ready.slice(0, Math.max(1, this.options.maxConcurrency));
      this.emitProgress({
        kind: "info",
        runId: current.id,
        message: `Running ${batch.length} ready task(s): ${batch.map((t) => t.role).join(", ")}`,
        timestamp: nowIso(),
      });
      const results = await Promise.allSettled(
        batch.map((task) => this.executeTask(current, parentSessionId, task)),
      );
      for (const result of results) {
        if (result.status === "fulfilled") {
          current = mergeTaskResult(current, result.value.task, result.value.agentRun);
        }
      }
      await this.ledger.save(current);
    }
    return current;
  }

  private async executeTask(
    run: CoAgentRun,
    parentSessionId: string,
    task: TaskNode,
  ): Promise<{ task: TaskNode; agentRun: AgentRun }> {
    const spec = this.registry.get(task.role);
    const prompt = this.registry.buildPrompt(task, run.goal);
    const maxRetries = this.options.maxRetries ?? 2;
    const retryDelay = this.options.retryDelayMs ?? 2000;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      const startedAt = nowIso();
      const agentRun: AgentRun = {
        id: newId("agent_run"),
        taskId: task.id,
        role: task.role,
        status: "running",
        prompt,
        diffFiles: [],
        artifacts: [],
        startedAt,
      };

      try {
        this.emitProgress({
          kind: "task-start",
          runId: run.id,
          taskId: task.id,
          role: task.role,
          title: task.title,
          attempt,
          maxAttempts: maxRetries + 1,
          message: `${task.role}: ${task.title} (attempt ${attempt}/${maxRetries + 1})`,
          timestamp: nowIso(),
        });

        const child = await this.adapter.createChildSession(parentSessionId, task, spec);
        const result = await this.adapter.prompt(child.id, prompt, true);
        const diffFiles =
          result.diffFiles.length > 0 ? result.diffFiles : await this.adapter.diff(child.id);
        const violations = this.policyGuard.validateDiff(task, spec, diffFiles);
        if (violations.length > 0) {
          throw new Error(violations.map((v) => v.message).join(" "));
        }

        const completedAgentRun: AgentRun = {
          ...agentRun,
          status: "completed",
          childSessionId: child.id,
          sessionId: result.sessionId,
          summary: result.summary,
          diffFiles,
          endedAt: nowIso(),
        };

        this.emitProgress({
          kind: "task-complete",
          runId: run.id,
          taskId: task.id,
          role: task.role,
          title: task.title,
          attempt,
          maxAttempts: maxRetries + 1,
          message: `${task.role}: completed (${diffFiles.length} files)`,
          timestamp: nowIso(),
        });

        return { task: { ...task, status: "completed" }, agentRun: completedAgentRun };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt <= maxRetries) {
          const delay = retryDelay * Math.pow(2, attempt - 1);
          this.emitProgress({
            kind: "task-retry",
            runId: run.id,
            taskId: task.id,
            role: task.role,
            title: task.title,
            attempt,
            maxAttempts: maxRetries + 1,
            message: `${task.role}: failed (attempt ${attempt}), retrying in ${delay}ms`,
            error: lastError.message,
            timestamp: nowIso(),
          });
          await sleep(delay);
        }
      }
    }

    this.emitProgress({
      kind: "task-fail",
      runId: run.id,
      taskId: task.id,
      role: task.role,
      title: task.title,
      attempt: maxRetries + 1,
      maxAttempts: maxRetries + 1,
      message: `${task.role}: failed after ${maxRetries + 1} attempts`,
      error: lastError?.message,
      timestamp: nowIso(),
    });

    const failedAgentRun: AgentRun = {
      id: newId("agent_run"),
      taskId: task.id,
      role: task.role,
      status: "failed",
      prompt,
      diffFiles: [],
      artifacts: [],
      startedAt: nowIso(),
      endedAt: nowIso(),
      error: lastError?.message,
    };
    return { task: { ...task, status: "failed" }, agentRun: failedAgentRun };
  }

  private emitProgress(event: Omit<ProgressEvent, "runId"> & { runId: string }): void {
    this.options.onProgress?.(event as ProgressEvent);
  }
}

function finalStatusAfterMerge(run: CoAgentRun): CoAgentRun["status"] {
  if (run.taskGraph.status === "failed") return "failed";
  if (run.taskGraph.status === "blocked") return "blocked";
  if (run.mergePlan?.status === "blocked") return "blocked";
  if (run.mergePlan?.status === "needs-integrator") return "blocked";
  return "completed";
}

function mergeTaskResult(run: CoAgentRun, task: TaskNode, agentRun: AgentRun): CoAgentRun {
  const taskStatus = task.status;
  const taskGraph = updateTaskStatus(run.taskGraph, task.id, taskStatus);
  return {
    ...run,
    status: taskGraph.status,
    taskGraph,
    agentRuns: [...run.agentRuns, agentRun],
    decisions: [
      ...run.decisions,
      {
        id: newId("decision"),
        at: nowIso(),
        actor: agentRun.role,
        kind: taskStatus === "completed" ? "task-completed" : "task-failed",
        summary: `${task.title}: ${taskStatus}`,
        details: {
          taskId: task.id,
          agentRunId: agentRun.id,
          diffFiles: agentRun.diffFiles,
          error: agentRun.error,
        },
      },
    ],
  };
}
