# CoAgent Implementation Guide

CoAgent v0.2 keeps OpenCode as the execution engine and adds a local orchestration layer for planning, child sessions, role prompts, audit logs, policy checks, merge gates, task retries, and progress reporting.

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
- **OpenCode adapter**: Add alternative adapters in `src/adapters/` (e.g., HTTP-only, mock, or CLI-based).
- **Role templates**: Add agent specs in `src/core/agent-registry.ts`. Each role gets a prompt template and `.opencode/agents` definition.
- **Policy checks**: Add rules in `src/core/policy-guard.ts`. Violations prevent merge.
- **Custom tools**: Promote `.opencode/tools/*.md` contracts into real OpenCode custom tool bindings.

## Connascence Points

If you change one of these, check the others:

- `src/core/types.ts` — shared types across all modules.
- `src/core/orchestrator.ts` — depends on all core modules and adapter interface.
- `src/adapters/opencode-adapter.ts` — must match the real OpenCode SDK API surface.
- `.opencode/agents/*.md` — must match the agent specs in `agent-registry.ts`.
