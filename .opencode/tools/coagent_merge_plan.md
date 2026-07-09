# coagent_merge_plan

Evaluate the merge plan for a completed CoAgent run.

## When to use

- Integrator evaluates merge conflicts before final handoff.
- Human operator reviews merge gate status before applying changes.

## Contract

```ts
interface MergePlan {
  status: "clean" | "needs-integrator" | "blocked";
  modifiedFiles: string[];
  conflicts: MergeConflict[];
  requiredAgents: AgentRole[];
  summary: string;
  createdAt: string;
}

interface MergeConflict {
  file: string;
  taskIds: string[];
  reason: string;
}
```

## Gate Rules

- **Clean**: No file ownership conflicts, no failed review/test gates.
- **Needs-integrator**: Multiple implementers edited the same file(s) — an integrator must resolve.
- **Blocked**: A reviewer or tester gate failed — changes cannot merge until the gate passes.

## Integrator Actions

For `needs-integrator`:
1. Read conflicted file(s) from each implementer's diff.
2. Produce a unified resolution.
3. Update the merge plan to `clean`.

## Location

Emitted by the merge gate and stored in `run.json` under the `mergePlan` field.
