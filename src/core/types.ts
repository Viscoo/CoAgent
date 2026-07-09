import type { OpenCodeAdapter } from "../adapters/opencode-adapter.js";
import { randomBytes } from "node:crypto";

export const AGENT_ROLES = [
  "planner",
  "explorer",
  "implementer",
  "reviewer",
  "tester",
  "integrator",
] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

export type TaskKind =
  | "planning"
  | "exploration"
  | "implementation"
  | "review"
  | "test"
  | "integration";

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "blocked";

export type RunStatus =
  | "planned"
  | "running"
  | "completed"
  | "failed"
  | "blocked";

export type PermissionMode =
  | "read-only"
  | "scoped-write"
  | "review-gate"
  | "trusted";

export type ArtifactType =
  | "prompt"
  | "summary"
  | "diff"
  | "test-output"
  | "risk-report"
  | "merge-plan"
  | "event";

export interface TaskNode {
  id: string;
  title: string;
  description: string;
  kind: TaskKind;
  role: AgentRole;
  dependsOn: string[];
  status: TaskStatus;
  allowWrite: boolean;
  assignedFiles: string[];
  attempts: number;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskGraph {
  id: string;
  goal: string;
  status: RunStatus;
  tasks: TaskNode[];
  createdAt: string;
  updatedAt: string;
}

export interface Artifact {
  id: string;
  runId: string;
  taskId?: string;
  type: ArtifactType;
  path?: string;
  content?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  taskId: string;
  role: AgentRole;
  status: TaskStatus;
  prompt: string;
  sessionId?: string;
  childSessionId?: string;
  summary?: string;
  diffFiles: string[];
  artifacts: string[];
  startedAt: string;
  endedAt?: string;
  error?: string;
}

export interface DecisionLog {
  id: string;
  at: string;
  actor: string;
  kind: string;
  summary: string;
  details: Record<string, unknown>;
}

export interface RiskItem {
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
  file?: string;
}

export interface RiskReport {
  status: "pass" | "warn" | "fail";
  risks: RiskItem[];
  requiredApprovals: string[];
  createdAt: string;
}

export interface MergeConflict {
  file: string;
  taskIds: string[];
  reason: string;
}

export interface MergePlan {
  status: "clean" | "needs-integrator" | "blocked";
  modifiedFiles: string[];
  conflicts: MergeConflict[];
  requiredAgents: AgentRole[];
  summary: string;
  createdAt: string;
}

export interface CoAgentRun {
  id: string;
  cwd: string;
  goal: string;
  status: RunStatus;
  taskGraph: TaskGraph;
  agentRuns: AgentRun[];
  artifacts: Artifact[];
  decisions: DecisionLog[];
  riskReport?: RiskReport;
  mergePlan?: MergePlan;
  createdAt: string;
  updatedAt: string;
}

export interface OrchestratorOptions {
  cwd: string;
  maxConcurrency: number;
  dryRun: boolean;
  startOpenCodeServer?: boolean;
  openCodeBaseUrl?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  onProgress?: (event: ProgressEvent) => void;
  adapter?: OpenCodeAdapter;
}

export interface ProgressEvent {
  kind: "task-start" | "task-retry" | "task-complete" | "task-fail" | "run-status" | "info";
  runId: string;
  taskId?: string;
  role?: AgentRole;
  title?: string;
  attempt?: number;
  maxAttempts?: number;
  message: string;
  error?: string;
  timestamp: string;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}
