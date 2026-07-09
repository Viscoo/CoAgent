import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type AgentRun,
  type Artifact,
  type CoAgentRun,
  type DecisionLog,
  type RunStatus,
  type TaskGraph,
  newId,
  nowIso,
} from "./types.js";

export class RunLedger {
  readonly rootDir: string;

  constructor(private readonly cwd: string) {
    this.rootDir = join(cwd, ".coagent", "runs");
  }

  async create(goal: string, taskGraph: TaskGraph): Promise<CoAgentRun> {
    const timestamp = nowIso();
    const run: CoAgentRun = {
      id: newId("run"),
      cwd: this.cwd,
      goal,
      status: "planned",
      taskGraph,
      agentRuns: [],
      artifacts: [],
      decisions: [
        {
          id: newId("decision"),
          at: timestamp,
          actor: "coagent",
          kind: "run-created",
          summary: "Created CoAgent run ledger.",
          details: {},
        },
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.save(run);
    return run;
  }

  async save(run: CoAgentRun): Promise<void> {
    const runDir = this.runDir(run.id);
    await mkdir(runDir, { recursive: true });
    const serialized: CoAgentRun = { ...run, updatedAt: nowIso() };
    await writeFile(join(runDir, "run.json"), `${JSON.stringify(serialized, null, 2)}\n`, "utf8");
  }

  async load(runId: string): Promise<CoAgentRun> {
    const content = await readFile(join(this.runDir(runId), "run.json"), "utf8");
    return JSON.parse(content) as CoAgentRun;
  }

  async latest(): Promise<CoAgentRun | undefined> {
    await mkdir(this.rootDir, { recursive: true });
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const runs = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => this.load(entry.name).catch(() => undefined)),
    );
    return runs
      .filter((run): run is CoAgentRun => Boolean(run))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  }

  appendDecision(run: CoAgentRun, decision: Omit<DecisionLog, "id" | "at">): CoAgentRun {
    return {
      ...run,
      decisions: [
        ...run.decisions,
        {
          id: newId("decision"),
          at: nowIso(),
          ...decision,
        },
      ],
    };
  }

  appendArtifact(run: CoAgentRun, artifact: Omit<Artifact, "id" | "runId" | "createdAt">): CoAgentRun {
    const next: Artifact = {
      id: newId("artifact"),
      runId: run.id,
      createdAt: nowIso(),
      ...artifact,
    };
    return {
      ...run,
      artifacts: [...run.artifacts, next],
    };
  }

  appendAgentRun(run: CoAgentRun, agentRun: AgentRun): CoAgentRun {
    return {
      ...run,
      agentRuns: [...run.agentRuns, agentRun],
    };
  }

  setStatus(run: CoAgentRun, status: RunStatus): CoAgentRun {
    return {
      ...run,
      status,
      taskGraph: {
        ...run.taskGraph,
        status,
      },
    };
  }

  private runDir(runId: string): string {
    return join(this.rootDir, runId);
  }
}
