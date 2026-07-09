import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AGENT_ROLES, type AgentRole, type PermissionMode, type TaskNode } from "./types.js";

export interface AgentSpec {
  role: AgentRole;
  displayName: string;
  mission: string;
  permissionMode: PermissionMode;
  defaultModelHint: string;
  canWrite: boolean;
  promptTemplate(task: TaskNode, goal: string): string;
  markdown(): string;
}

export class AgentRegistry {
  private readonly specs: Map<AgentRole, AgentSpec>;

  constructor(specs: AgentSpec[] = defaultAgentSpecs()) {
    this.specs = new Map(specs.map((spec) => [spec.role, spec]));
  }

  get(role: AgentRole): AgentSpec {
    const spec = this.specs.get(role);
    if (!spec) {
      throw new Error(`Unknown CoAgent role: ${role}`);
    }
    return spec;
  }

  list(): AgentSpec[] {
    return AGENT_ROLES.map((role) => this.get(role));
  }

  buildPrompt(task: TaskNode, goal: string): string {
    return this.get(task.role).promptTemplate(task, goal);
  }

  async ensureWorkspaceScaffold(cwd: string): Promise<string[]> {
    const written: string[] = [];
    const agentsDir = join(cwd, ".opencode", "agents");
    const toolsDir = join(cwd, ".opencode", "tools");
    const skillsDir = join(cwd, ".opencode", "skills", "coagent");
    await mkdir(agentsDir, { recursive: true });
    await mkdir(toolsDir, { recursive: true });
    await mkdir(skillsDir, { recursive: true });

    for (const spec of this.list()) {
      const file = join(agentsDir, `coagent-${spec.role}.md`);
      await writeFile(file, spec.markdown(), { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      written.push(file);
    }

    const skillFile = join(skillsDir, "SKILL.md");
    await writeFile(skillFile, coagentSkillMarkdown(), { flag: "wx" }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      },
    );
    written.push(skillFile);

    for (const tool of coagentToolFiles()) {
      const file = join(toolsDir, tool.name);
      await writeFile(file, tool.content, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      written.push(file);
    }

    return written;
  }
}

export function defaultAgentSpecs(): AgentSpec[] {
  return [
    createSpec({
      role: "planner",
      displayName: "CoAgent Planner",
      mission: "Turn the user goal into a precise task graph and acceptance criteria.",
      permissionMode: "read-only",
      defaultModelHint: "reasoning-capable",
      canWrite: false,
    }),
    createSpec({
      role: "explorer",
      displayName: "CoAgent Explorer",
      mission: "Inspect the repository and report facts, constraints, and likely touch points.",
      permissionMode: "read-only",
      defaultModelHint: "fast-reasoning",
      canWrite: false,
    }),
    createSpec({
      role: "implementer",
      displayName: "CoAgent Implementer",
      mission: "Make scoped code changes that satisfy the task without broad refactors.",
      permissionMode: "scoped-write",
      defaultModelHint: "coding",
      canWrite: true,
    }),
    createSpec({
      role: "reviewer",
      displayName: "CoAgent Reviewer",
      mission: "Review changes for bugs, regressions, safety issues, and missing tests.",
      permissionMode: "review-gate",
      defaultModelHint: "reasoning-capable",
      canWrite: false,
    }),
    createSpec({
      role: "tester",
      displayName: "CoAgent Tester",
      mission: "Run focused verification commands and summarize results clearly.",
      permissionMode: "read-only",
      defaultModelHint: "fast-reasoning",
      canWrite: false,
    }),
    createSpec({
      role: "integrator",
      displayName: "CoAgent Integrator",
      mission: "Combine agent outputs, detect conflicts, and prepare a final handoff.",
      permissionMode: "review-gate",
      defaultModelHint: "reasoning-capable",
      canWrite: false,
    }),
  ];
}

function createSpec(input: Omit<AgentSpec, "promptTemplate" | "markdown">): AgentSpec {
  return {
    ...input,
    promptTemplate(task, goal) {
      const fileScope =
        task.assignedFiles.length > 0
          ? task.assignedFiles.map((file) => `- ${file}`).join("\n")
          : "- No explicit file scope. Discover and state the scope before acting.";

      return [
        `You are ${input.displayName}.`,
        `Mission: ${input.mission}`,
        `Global goal: ${goal}`,
        `Task: ${task.title}`,
        `Task details: ${task.description}`,
        `Permission mode: ${input.permissionMode}`,
        `Write access: ${input.canWrite ? "scoped" : "none"}`,
        "File scope:",
        fileScope,
        "Output contract:",
        "- State what you did or learned.",
        "- List files read or changed.",
        "- List risks, blockers, and verification commands.",
        "- Do not modify files outside the task scope.",
      ].join("\n");
    },
    markdown() {
      return [
        "---",
        `description: ${input.displayName}`,
        "mode: subagent",
        "permission:",
        ...permissionLines(input.permissionMode),
        "---",
        "",
        `# ${input.displayName}`,
        "",
        input.mission,
        "",
        `Permission mode: ${input.permissionMode}.`,
        `Model hint: ${input.defaultModelHint}.`,
        `Write access: ${input.canWrite ? "only within assigned task scope" : "none"}.`,
        "",
        "Rules:",
        "- Keep findings grounded in repository evidence.",
        "- Keep outputs concise and structured.",
        "- Mention every file you changed or every file that materially informed your conclusion.",
        "- Escalate unclear or risky actions instead of guessing.",
      ].join("\n");
    },
  };
}

function permissionLines(mode: PermissionMode): string[] {
  if (mode === "scoped-write") {
    return [
      "  edit: ask",
      "  bash:",
      '    "*": ask',
      '    "git status*": allow',
      '    "git diff*": allow',
      '    "rg *": allow',
      '    "bun test*": ask',
      "  external_directory: ask",
      "  webfetch: ask",
      "  websearch: ask",
    ];
  }

  return [
    "  edit: deny",
    "  bash:",
    '    "*": ask',
    '    "git status*": allow',
    '    "git diff*": allow',
    '    "rg *": allow',
    "  external_directory: ask",
    "  webfetch: ask",
    "  websearch: ask",
  ];
}

function coagentSkillMarkdown(): string {
  return [
    "# CoAgent Coordination",
    "",
    "Use this skill when participating in a CoAgent multi-agent run.",
    "",
    "Workflow:",
    "- Read the assigned role, task, dependencies, and file scope before acting.",
    "- Preserve the run ledger by reporting decisions, changed files, risks, and verification commands.",
    "- Read-only roles must not edit files.",
    "- Implementer roles must stay inside assigned files or explain why scope must change.",
    "- Reviewer and tester roles should produce pass, warn, or fail outcomes with evidence.",
  ].join("\n");
}

function coagentToolFiles(): Array<{ name: string; content: string }> {
  const toolNames = [
    "coagent_task_graph.md",
    "coagent_spawn.md",
    "coagent_collect.md",
    "coagent_merge_plan.md",
  ];

  return toolNames.map((name) => ({
    name,
    content: [
      `# ${name.replace(".md", "")}`,
      "",
      "This placeholder documents a CoAgent tool contract. The v0.1 CLI owns execution; future OpenCode custom tool bindings can call the same ledger and orchestrator APIs.",
    ].join("\n"),
  }));
}
