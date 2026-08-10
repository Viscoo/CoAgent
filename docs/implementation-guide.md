# CoAgent Implementation Guide

CoAgent v0.2 is a multi-framework agent orchestration layer. It provides a framework-agnostic Hub that adapts open-source AI coding agents — OpenCode, OpenClaw, Claude Code, Hermes, and more — into a unified `CoAgentAdapter` interface for task orchestration, role-based sessions, audit logs, policy checks, merge gates, retries, and cross-framework collaboration.

## Runtime Flow

1. `coagent plan "<goal>"` creates `.opencode` scaffolding and a `.coagent/runs/<runId>/run.json` ledger.
2. `coagent run "<goal>"` creates an OpenCode parent session, dispatches ready tasks to role-specific child sessions with retry logic, records AgentRun results, and evaluates the merge gate.
3. `coagent resume <runId>` reloads an incomplete ledger and continues scheduling ready tasks.
4. `coagent status [runId]` prints the latest or selected ledger summary.
5. `coagent logs [runId]` prints the decision history and artifact list.

## Task Lifecycle

```
pending → running → completed  (success)
pending → running → failed     → retry → running → completed/failed (exhausted)
```

Failed tasks trigger exponential backoff: 2s, 4s, 8s (configurable).

## Retry Architecture

- `OrchestratorOptions.maxRetries` (default: 2) controls how many times a failed task is retried.
- `OrchestratorOptions.retryDelayMs` (default: 2000) sets the base delay; actual delay doubles each attempt.
- `OrchestratorOptions.onProgress` emits a `ProgressEvent` for each lifecycle change:
  - `task-start`: before execution begins.
  - `task-retry`: after a failure, before the next attempt.
  - `task-complete`: on successful completion.
  - `task-fail`: after all attempts are exhausted.
- The CLI wires `onProgress` to display real-time symbols (▶, ↻, ✓, ✗).

## Safety Rules

| Rule | Enforced By | Consequence |
| --- | --- | --- |
| Read-only roles produce no diffs | PolicyGuard | Task fails immediately |
| Implementers stay in assigned scope | PolicyGuard | Task fails with violation |
| Review/test gates pass | MergeGate | Merge is blocked |
| No file ownership conflicts | MergeGate | Integrator required |

## Extension Points

- **Task graph planning**: Extend `createTaskGraph()` in `src/core/task-graph.ts` to support dynamic task generation or LLM-driven planning.
- **Framework adapters**: Implement `CoAgentAdapter` in `src/adapters/` to support new frameworks (OpenClaw, Hermes, etc.). Register in `createAdapter()` and add to `BackendType`.
- **Role templates**: Add agent specs in `src/core/agent-registry.ts`. Each role gets a prompt template and `.opencode/agents` definition.
- **Policy checks**: Add rules in `src/core/policy-guard.ts`. Violations prevent merge.
- **Custom tools**: Promote `.opencode/tools/*.md` contracts into real OpenCode custom tool bindings.
- **Hub integration**: Any adapter that implements `CoAgentAdapter` automatically works with the Hub for cross-framework agent communication.

## Connascence Points

If you change one of these, check the others:

- `src/core/types.ts` — shared types across all modules.
- `src/core/orchestrator.ts` — depends on all core modules and adapter interface.
- `src/adapters/adapter.ts` — defines `CoAgentAdapter` interface and `createAdapter()` factory; all framework adapters must conform.
- `src/adapters/opencode-adapter.ts` — must match the real OpenCode SDK API surface.
- `src/adapters/claude-adapter.ts` — must match the Claude Code CLI interface.
- `.opencode/agents/*.md` — must match the agent specs in `agent-registry.ts`.
