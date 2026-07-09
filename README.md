# CoAgent

**CoAgent** is a lightweight multi-agent orchestration layer for **OpenCode**. It keeps OpenCode as the execution engine and adds task planning, role-based child sessions, run ledgers, review gates, merge checks, and retry logic.

## Quick Start

```bash
npm install
npm run build
npm start -- init
npm start -- plan "inspect the repo"
npm start -- run "add a new feature" --dry-run
npm start -- run "add a new feature"
```

Development mode (no build step):

```bash
npm run dev -- run "refactor the logger"
```

## Architecture

```
                      ┌──────────────┐
                      │   CLI (cli.ts) │
                      └──────┬───────┘
                             │
               ┌─────────────▼──────────────┐
               │     Orchestrator           │
               │  - Task scheduling         │
               │  - Retry with backoff      │
               │  - Progress events         │
               └──────┬──────────────┬──────┘
                      │              │
          ┌───────────▼──┐   ┌──────▼──────────┐
          │  AgentRegistry│   │  RunLedger      │
          │  - 6 roles    │   │  - Persistence  │
          │  - Prompts    │   │  - .coagent/    │
          └───────────────┘   └──────┬──────────┘
                                     │
          ┌───────────────┐   ┌──────▼──────────┐
          │  MergeGate    │   │  PolicyGuard    │
          │  - Conflicts  │   │  - Scope checks │
          │  - Gate check │   │  - Permission   │
          └───────────────┘   └─────────────────┘
```

## Commands

| Command | Description |
| --- | --- |
| `coagent init` | Create `.opencode/agents/*.md` role scaffolds |
| `coagent plan "<goal>"` | Create task graph and run ledger (dry run) |
| `coagent run "<goal>"` | Full orchestration: plan → execute → merge gate |
| `coagent status [run-id]` | Print latest or selected run summary |
| `coagent resume <run-id>` | Continue an incomplete run |
| `coagent logs [run-id]` | View decision log and artifacts for a run |
| `coagent version` | Print version |

### Options

| Flag | Default | Description |
| --- | --- | --- |
| `--cwd <path>` | `.` | Workspace directory |
| `--concurrency <n>` | `2` | Max parallel tasks |
| `--retries <n>` | `2` | Max retries per task (exponential backoff) |
| `--dry-run` | `false` | Plan/ledger only, no OpenCode |
| `--start-server` | `false` | Start `opencode serve` automatically |
| `--opencode-url <url>` | — | OpenCode server URL |

## Agent Roles

| Role | Permission | Model Hint | When |
| --- | --- | --- | --- |
| **Planner** | Read-only | reasoning | Break down goal into tasks |
| **Explorer** | Read-only | fast-reasoning | Inspect repo state & risks |
| **Implementer** | Scoped-write | coding | Make code changes |
| **Reviewer** | Review gate | reasoning | Check for bugs & regressions |
| **Tester** | Read-only | fast-reasoning | Run verification commands |
| **Integrator** | Review gate | reasoning | Resolve conflicts, final merge |

## Run Flow

```
plan ──► explore ──► implement ──┬──► review ──┐
                                  │             │
                                  └──► test  ───┼──► integrate ──► merge gate
                                               │
                                    ┌──────────┘
                                    ▼
                          ✓ clean — ready to apply
                          △ needs-integrator — conflicts found
                          ⊘ blocked — gate failure or policy violation
```

## Directory Layout

```
.coagent/
  runs/
    <runId>/
      run.json          # Full orchestration state
.opencode/
  agents/
    coagent-planner.md  # Role definitions
    coagent-explorer.md
    coagent-implementer.md
    coagent-reviewer.md
    coagent-tester.md
    coagent-integrator.md
  tools/
    coagent_task_graph.md
    coagent_spawn.md
    coagent_collect.md
    coagent_merge_plan.md
  skills/
    coagent/SKILL.md
```

## Retry Logic

Failed tasks are retried with exponential backoff:

- First retry: 2s delay
- Second retry: 4s delay
- Configurable via `--retries <n>`

Tasks that exhaust retries are marked `failed`; dependent tasks are blocked.

## Safety

- Read-only roles are blocked if they produce file diffs.
- Implementers are scoped to assigned files — changes outside scope trigger policy violations.
- Merge is blocked when review or test gates fail.
- File ownership conflicts between multiple implementers require integrator resolution.

## Development

```bash
# Build
npm run build

# Dev (no build)
npm run dev -- run "feature" --dry-run

# Type-check
npm run check

# Test (requires bun)
bun test
```

## Requirements

- Node.js >= 22 or Bun >= 1.1
- OpenCode server (or `@opencode-ai/sdk`)
