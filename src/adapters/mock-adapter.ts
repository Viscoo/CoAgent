import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { type AgentSpec } from "../core/agent-registry.js";
import { type TaskNode } from "../core/types.js";
import {
  type OpenCodeAdapter,
  type OpenCodePromptResult,
  type OpenCodeSession,
} from "./opencode-adapter.js";

/**
 * Simulated adapter that runs agent tasks in-memory with fake results.
 *
 * No OpenCode server or SDK required — ideal for demo, dev, and CI.
 * Use --mock (default) to test the full orchestration flow end-to-end.
 */
export class MockAdapter implements OpenCodeAdapter {
  private sessions = new Map<string, { parentId?: string; role?: string; taskTitle?: string }>();
  private closed = false;
  private failureRate = 0;

  constructor(options?: { failureRate?: number }) {
    this.failureRate = options?.failureRate ?? 0;
  }

  async ensureReady(): Promise<void> {
    this.closed = false;
  }

  async createParentSession(goal: string): Promise<OpenCodeSession> {
    const id = `mock-parent-${randomBytes(4).toString("hex")}`;
    this.sessions.set(id, { taskTitle: goal });
    return { id };
  }

  async createChildSession(
    parentSessionId: string,
    task: TaskNode,
    _agent: AgentSpec,
  ): Promise<OpenCodeSession> {
    const id = `mock-${task.role}-${randomBytes(4).toString("hex")}`;
    this.sessions.set(id, { parentId: parentSessionId, role: task.role, taskTitle: task.title });
    return { id };
  }

  async prompt(sessionId: string, _prompt: string, _asyncMode?: boolean): Promise<OpenCodePromptResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown mock session: ${sessionId}`);

    // Simulate work duration
    await sleep(simulatedWorkMs(session.role));

    // Random failure for testing retry logic
    if (this.failureRate > 0 && Math.random() < this.failureRate) {
      throw new Error(`Simulated failure (failure rate: ${this.failureRate})`);
    }

    const role = session.role ?? "unknown";
    return {
      sessionId,
      messageId: `msg-${randomBytes(4).toString("hex")}`,
      summary: mockSummary(role, session.taskTitle ?? "task"),
      diffFiles: mockDiffFiles(role),
      raw: {},
    };
  }

  async diff(sessionId: string): Promise<string[]> {
    const session = this.sessions.get(sessionId);
    return mockDiffFiles(session?.role);
  }

  async close(): Promise<void> {
    this.sessions.clear();
    this.closed = true;
  }
}

function mockSummary(role: string, title: string): string {
  const summaries: Record<string, string[]> = {
    planner: [
      `Created task graph for "${title}": identified 3 sub-tasks, dependencies, and acceptance criteria.`,
      `Analyzed goal "${title}" and decomposed into 4 sequential steps with risk assessment.`,
    ],
    explorer: [
      `Inspected 12 source files. Found 2 configuration files and 3 public API surfaces relevant to "${title}".`,
      `Repository review complete. Identified 8 modules, conventions: ES modules, no barrel exports.`,
    ],
    implementer: [
      `Implemented "${title}". Changed 2 files: added helper functions and updated exports.`,
      `Applied scoped changes for "${title}". All existing tests pass.`,
    ],
    reviewer: [
      `Review complete. No bugs found. 1 style suggestion (unused import). Overall: approved.`,
      `Reviewed "${title}" changes. Found 1 edge case: input validation missing. Moderate risk.`,
    ],
    tester: [
      `Ran 42 tests: 42 passed, 0 failed. Coverage: 87%.`,
      `Verified "${title}" with 3 test scenarios. All pass.`,
    ],
    integrator: [
      `Merge plan created. 3 files changed, 0 conflicts. Ready to apply.`,
      `Integrated "${title}". Resolved 1 conflict in config file. Final result is clean.`,
    ],
  };

  const options = summaries[role] ?? [
    `Completed ${role} task: "${title}".`,
  ];
  return options[Math.floor(Math.random() * options.length)];
}

function mockDiffFiles(role?: string): string[] {
  // Only implementer produces file diffs; read-only roles produce none.
  if (role === "implementer") {
    const files = [
      "src/core/feature.ts",
      "src/core/types.ts",
      "src/cli.ts",
      "src/index.ts",
      "test/feature.test.ts",
    ];
    const count = Math.floor(Math.random() * 2) + 1;
    return shuffle(files).slice(0, count);
  }
  return [];
}

function simulatedWorkMs(role?: string): number {
  const delays: Record<string, number> = {
    planner: 300,
    explorer: 500,
    implementer: 800,
    reviewer: 400,
    tester: 600,
    integrator: 300,
  };
  return delays[role ?? ""] ?? 400;
}

function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
