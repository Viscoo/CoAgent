# CoAgent

English | [中文](./README_zh.md)

**CoAgent** is a lightweight multi-agent orchestration layer for **OpenCode**. It keeps OpenCode as the execution engine and adds task planning, role-based child sessions, run ledgers, review gates, merge checks, retry logic, and a multi-agent collective consciousness layer (Hub).

## Features

- **Task Orchestration** — Break goals into task graphs, execute in parallel by dependency
- **6 Agent Roles** — Planner / Explorer / Implementer / Reviewer / Tester / Integrator
- **Review Gates** — Code changes must pass Review and Test gates before merging
- **Safety Policies** — Read-only roles blocked from writing, implementers scoped, conflict detection
- **Retry Logic** — Failed tasks retry with exponential backoff, configurable retry count
- **Hub Collective Consciousness** — Multiple CLI windows share state, communicate, and collaborate in parallel
- **TUI Interface** — Full-screen terminal interactive UI

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
| `coagent chat` | Open an interactive CoAgent session (REPL) |
| `coagent open` | Open CoAgent interactively (tries OpenCode TUI first, falls back to chat) |
| `coagent hub` | Start CoAgent Hub server (multi-agent communication) |
| `coagent ps` | List all online agents |
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
| `--port <n>` | `4876` | Hub port |
| `--host <addr>` | `127.0.0.1` | Hub listen address |
| `--role <name>` | `general` | Agent role name |
| `--hub <url>` | `http://127.0.0.1:4876` | Hub URL (for `ps` command) |

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

## Hub Collective Consciousness

CoAgent Hub lets multiple CLI windows see each other, share experience, and work in parallel:

```
┌────────────────────────────────────────────────────┐
│                    CoAgent Hub                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │ WebSocket    │  │ Agent State  │  │ Shared   │ │
│  │ Server :4876 │  │ Store (mem)  │  │ Knowledge│ │
│  └──────┬───────┘  └──────┬───────┘  └────┬─────┘ │
│  ┌──────┴──────────────────┴───────────────┴──────┐ │
│  │          Message Routing & Event Dispatch       │ │
│  └──────────────────────┬─────────────────────────┘ │
└──────────────────────────┼──────────────────────────┘
                           │
       ┌───────────────────┼───────────────────┐
       │                   │                   │
  ┌────┴─────┐      ┌─────┴─────┐      ┌─────┴─────┐
  │ Agent A  │      │ Agent B   │      │ Agent C   │
  │ CLI Win1 │      │ CLI Win2  │      │ CLI Win3  │
  │ planner  │      │ implement │      │ reviewer  │
  └──────────┘      └───────────┘      └───────────┘
```

```bash
# Start Hub
coagent hub

# Open an agent in another terminal (auto-connects to Hub)
coagent open

# List all online agents
coagent ps
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

## Examples

CoAgent provides 7 progressive examples to help you get started — no OpenCode server required for most of them.

```bash
npx tsx examples/01-task-graph.ts    # Understand task graphs & dependencies
npx tsx examples/02-agent-roles.ts   # Explore 6 agent roles & permissions
npx tsx examples/03-mock-orchestration.ts  # Mock full orchestration run
npx tsx examples/04-retry-logic.ts   # Retry with exponential backoff
npx tsx examples/05-hub-collaboration.ts   # Multi-agent Hub collaboration
npx tsx examples/06-real-opencode.ts # Connect to real OpenCode (config guide)
npx tsx examples/07-full-e2e.ts      # End-to-end: init → plan → execute → merge
```

See [docs/usage-examples.md](./docs/usage-examples.md) for detailed walkthrough of each example.

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
- OpenCode CLI binary (for `coagent open` and `--start-server` modes)

## Third-Party Licenses

This project includes source code from the following third-party projects:

### OpenCode AI SDK

- **Source**: [opencode-ai/opencode](https://github.com/opencode-ai/opencode) (`packages/sdk/js/`)
- **Integrated in**: `src/opencode-sdk/`
- **License**: MIT License
- **Copyright**: Copyright (c) 2025 opencode

```
MIT License

Copyright (c) 2025 opencode

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
