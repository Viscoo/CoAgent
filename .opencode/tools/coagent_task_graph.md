# coagent_task_graph

Read or update the CoAgent task graph for the current run.

## When to use

- Planner and explorer roles use this to read the task graph and understand dependencies.
- Integrator uses this to check task completion status before merging.

## Schema

```ts
interface TaskGraph {
  id: string;
  goal: string;
  status: "planned" | "running" | "completed" | "failed" | "blocked";
  tasks: TaskNode[];
}

interface TaskNode {
  id: string;
  role: "planner" | "explorer" | "implementer" | "reviewer" | "tester" | "integrator";
  status: "pending" | "running" | "completed" | "failed" | "skipped" | "blocked";
  dependsOn: string[];
  allowWrite: boolean;
  assignedFiles: string[];
}
```

## Location

`.coagent/runs/<runId>/run.json` — the task graph is embedded in the `taskGraph` field.

## Caveats

- Read-only operations only. Task status is updated by the orchestrator, not by individual agents.
- Agents may inspect the graph to determine which dependencies are still incomplete.
