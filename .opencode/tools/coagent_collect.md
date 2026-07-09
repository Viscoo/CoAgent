# coagent_collect

Gather completed agent run results for inspection or audit.

## When to use

- Reviewer and tester roles can inspect what implementers produced.
- Integrator can collect all results before building a merge plan.
- Human operators can audit run history.

## Contract

```ts
interface CollectInput {
  runId: string;
  filter?: {
    roles?: AgentRole[];
    status?: "completed" | "failed" | "all";
  };
}

interface CollectOutput {
  agentRuns: Array<{
    role: AgentRole;
    taskId: string;
    status: TaskStatus;
    summary?: string;
    diffFiles: string[];
    error?: string;
  }>;
}
```

## Location

`.coagent/runs/<runId>/run.json` — the `agentRuns` array contains all results.

## Caveats

- Active runs may have incomplete results for tasks still in progress.
- Use `coagent_task_graph` first to check overall run status before collecting results.
