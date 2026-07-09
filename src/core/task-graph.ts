import {
  type AgentRole,
  type CoAgentRun,
  type RunStatus,
  type TaskGraph,
  type TaskKind,
  type TaskNode,
  newId,
  nowIso,
} from "./types.js";

interface TaskSpec {
  title: string;
  description: string;
  kind: TaskKind;
  role: AgentRole;
  dependsOn?: string[];
  allowWrite?: boolean;
  assignedFiles?: string[];
  priority?: number;
}

export function createTaskGraph(goal: string): TaskGraph {
  const createdAt = nowIso();
  const plannerId = newId("task");
  const exploreId = newId("task");
  const implementId = newId("task");
  const reviewId = newId("task");
  const testId = newId("task");
  const integrateId = newId("task");

  const specs: Array<TaskSpec & { id: string }> = [
    {
      id: plannerId,
      title: "Plan work",
      description: `Break down the user goal into concrete repo tasks: ${goal}`,
      kind: "planning",
      role: "planner",
      allowWrite: false,
      priority: 100,
    },
    {
      id: exploreId,
      title: "Explore repository",
      description: "Inspect relevant files, conventions, commands, and risks before editing.",
      kind: "exploration",
      role: "explorer",
      dependsOn: [plannerId],
      allowWrite: false,
      priority: 90,
    },
    {
      id: implementId,
      title: "Implement scoped changes",
      description: "Apply the smallest implementation that satisfies the plan and local conventions.",
      kind: "implementation",
      role: "implementer",
      dependsOn: [plannerId, exploreId],
      allowWrite: true,
      priority: 70,
    },
    {
      id: reviewId,
      title: "Review changes",
      description: "Find correctness, safety, compatibility, and missing-test risks in the implementation.",
      kind: "review",
      role: "reviewer",
      dependsOn: [implementId],
      allowWrite: false,
      priority: 60,
    },
    {
      id: testId,
      title: "Verify behavior",
      description: "Run focused checks and summarize pass/fail output with reproduction commands.",
      kind: "test",
      role: "tester",
      dependsOn: [implementId],
      allowWrite: false,
      priority: 60,
    },
    {
      id: integrateId,
      title: "Integrate final result",
      description: "Prepare the final merge plan, resolve non-overlapping outputs, and block conflicts.",
      kind: "integration",
      role: "integrator",
      dependsOn: [reviewId, testId],
      allowWrite: false,
      priority: 40,
    },
  ];

  return {
    id: newId("graph"),
    goal,
    status: "planned",
    tasks: specs.map((spec) => taskFromSpec(spec, createdAt)),
    createdAt,
    updatedAt: createdAt,
  };
}

function taskFromSpec(spec: TaskSpec & { id: string }, timestamp: string): TaskNode {
  return {
    id: spec.id,
    title: spec.title,
    description: spec.description,
    kind: spec.kind,
    role: spec.role,
    dependsOn: spec.dependsOn ?? [],
    status: "pending",
    allowWrite: spec.allowWrite ?? false,
    assignedFiles: spec.assignedFiles ?? [],
    attempts: 0,
    priority: spec.priority ?? 50,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function getReadyTasks(graph: TaskGraph): TaskNode[] {
  const completed = new Set(
    graph.tasks.filter((task) => task.status === "completed").map((task) => task.id),
  );

  return graph.tasks
    .filter((task) => task.status === "pending")
    .filter((task) => task.dependsOn.every((dependency) => completed.has(dependency)))
    .sort((left, right) => right.priority - left.priority);
}

export function updateTaskStatus(
  graph: TaskGraph,
  taskId: string,
  status: TaskNode["status"],
): TaskGraph {
  const updatedAt = nowIso();
  return {
    ...graph,
    updatedAt,
    status: inferGraphStatus(graph.tasks.map((task) => (task.id === taskId ? { ...task, status } : task))),
    tasks: graph.tasks.map((task) =>
      task.id === taskId ? { ...task, status, updatedAt } : task,
    ),
  };
}

export function inferGraphStatus(tasks: TaskNode[]): RunStatus {
  if (tasks.some((task) => task.status === "failed")) return "failed";
  if (tasks.some((task) => task.status === "blocked")) return "blocked";
  if (tasks.every((task) => task.status === "completed" || task.status === "skipped")) {
    return "completed";
  }
  if (tasks.some((task) => task.status === "running" || task.status === "completed")) {
    return "running";
  }
  return "planned";
}

export function summarizeRun(run: CoAgentRun): string {
  const counts = run.taskGraph.tasks.reduce<Record<string, number>>((accumulator, task) => {
    accumulator[task.status] = (accumulator[task.status] ?? 0) + 1;
    return accumulator;
  }, {});
  const parts = Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${status}:${count}`)
    .join(" ");
  return `${run.id} ${run.status} ${parts}`;
}
