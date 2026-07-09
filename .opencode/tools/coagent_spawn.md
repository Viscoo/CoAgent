# coagent_spawn

Create a child session for a specific CoAgent role task.

## When to use

The orchestrator calls this to dispatch a task to a role-specific OpenCode sub-agent.

## Contract

```ts
interface SpawnInput {
  role: AgentRole;
  taskId: string;
  prompt: string;
  assignedFiles: string[];
}

interface SpawnOutput {
  sessionId: string;
  summary: string;
  diffFiles: string[];
}
```

## Lifecycle

1. The orchestrator calls `coagent_spawn` with the task prompt and agent role.
2. OpenCode creates a new sub-agent session using the matching `.opencode/agents/coagent-<role>.md` definition.
3. The sub-agent works on the task and reports results.
4. The orchestrator records the output in the run ledger.

## Permissions

The spawned session inherits its permissions from the matching agent definition:
- Read-only roles (planner, explorer, tester): no write access.
- Scoped-write roles (implementer): write limited to `assignedFiles`.
- Review-gate roles (reviewer, integrator): read and verify, no write.
