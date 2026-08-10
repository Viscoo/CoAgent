# CoAgent

English | [中文](./README_zh.md)

**CoAgent** is a multi-agent orchestration layer that supports multiple AI backends (OpenCode, Claude Code, etc.). It breaks goals into task graphs, assigns roles, manages review gates, and enables cross-backend agent collaboration via Hub.

## Features

- **Multi-Backend Support** — Switch between OpenCode, Claude Code, or Mock via `--backend`
- **Task Orchestration** — Break goals into task graphs, execute in parallel by dependency
- **6 Agent Roles** — Planner / Explorer / Implementer / Reviewer / Tester / Integrator
- **Review Gates** — Code changes must pass Review and Test gates before merging
- **Safety Policies** — Read-only roles blocked from writing, implementers scoped, conflict detection
- **Retry Logic** — Failed tasks retry with exponential backoff, configurable retry count
- **Hub Collective Consciousness** — Cross-backend agent communication via WebSocket
- **TUI Interface** — OpenCode-style terminal UI with sidebar, command palette, and shortcuts

## Quick Start

```bash
npm install
npm run build

# Mock mode (default, no API key needed)
coagent run "add a hello-world endpoint"

# With OpenCode backend
coagent run "add auth middleware" --backend opencode --start-server

# With Claude Code backend
coagent run "refactor the logger" --backend claude

# Interactive TUI
coagent
```

## Multi-Backend Architecture

CoAgent supports multiple AI backends through a unified adapter interface:

```
CoAgentAdapter (unified interface)
  ├── SdkOpenCodeAdapter  --backend opencode   OpenCode SDK / HTTP API
  ├── ClaudeCodeAdapter   --backend claude     Claude Code CLI (claude -p)
  └── MockAdapter         --backend mock       Simulated (no API key needed)
```

### Backend Selection

```bash
# OpenCode — requires OpenCode CLI + API key
export ANTHROPIC_API_KEY=sk-ant-xxxxx
coagent run "add feature" --backend opencode --start-server

# Claude Code — requires Claude Code CLI + API key
npm install -g @anthropic-ai/claude-code
coagent run "add feature" --backend claude

# Mock — no requirements, for testing
coagent run "add feature" --backend mock
```

### Cross-Backend Collaboration via Hub

Agents using different backends can communicate through the Hub:

```
┌─────────────────────────────────────────────────────┐
│                    CoAgent Hub                        │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ WebSocket    │  │ Agent State  │  │ Message   │ │
│  │ Server :4876 │  │ Store (mem)  │  │ Routing   │ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘ │
└─────────┼─────────────────┼────────────────┼───────┘
          │                 │                │
    ┌─────┴─────┐    ┌─────┴─────┐    ┌─────┴─────┐
    │ Agent A   │    │ Agent B   │    │ Agent C   │
    │ opencode  │    │ claude    │    │ mock      │
    │ planner   │    │ implement │    │ reviewer  │
    └───────────┘    └───────────┘    └───────────┘
```

```typescript
import { startHub, AgentClient } from "coagent";

const hub = await startHub({ port: 4876 });

const planner = new AgentClient({ role: "planner", backend: "opencode" });
const implementer = new AgentClient({ role: "implementer", backend: "claude" });

await planner.connect();
await implementer.connect();

// Cross-backend communication
planner.sendToAgent(implementer.id, "Please implement the registration API");
```

### Live visibility: every window sees what other agents are doing

`coagent run` / `coagent chat` / `coagent open` / the TUI auto-register with the Hub
when it is online (best-effort: silently degrade if the Hub is not running).
Every task the orchestrator executes (role + task title) is reported to the Hub
in real time, so other windows see it instantly:

- **TUI sidebar (Ctrl+B)**: a Peers section shows each agent's name, role, status (▶ busy / ○ idle / ● online) and current task
- **`/peers` command**: lists all online agents and their live tasks in the chat area
- **`coagent ps`**: command-line view of all online agents
- **`chat` mode `peers` / `broadcast <msg>`**: see peers and broadcast a message to all agents

## Architecture

```
                       ┌──────────────┐
                       │   CLI / TUI  │
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
                       │
          ┌────────────▼────────────────┐
          │     CoAgentAdapter          │
          │  ┌────────┐ ┌──────┐ ┌────┐│
          │  │OpenCode│ │Claude│ │Mock││
          │  └────────┘ └──────┘ └────┘│
          └────────────────────────────┘
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
| `--backend <type>` | `mock` | AI backend: `opencode`, `claude`, `mock` |
| `--model <name>` | — | Model override (e.g. `anthropic/claude-sonnet-4-20250514`) |
| `--concurrency <n>` | `2` | Max parallel tasks |
| `--retries <n>` | `2` | Max retries per task (exponential backoff) |
| `--dry-run` | `false` | Plan/ledger only, no AI backend |
| `--start-server` | `false` | Start `opencode serve` automatically |
| `--opencode-url <url>` | — | OpenCode server URL |
| `--mock` | `false` | Force mock adapter |
| `--mock-failure-rate <n>` | `0` | Mock failure probability 0-1 |
| `--port <n>` | `4876` | Hub port |
| `--host <addr>` | `127.0.0.1` | Hub listen address |
| `--role <name>` | `general` | Agent role name |
| `--hub <url>` | `http://127.0.0.1:4876` | Hub URL (for `ps` command) |

## TUI Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+N` | New session |
| `Ctrl+P` | Command palette |
| `Ctrl+L` | Session list |
| `Ctrl+B` | Toggle sidebar |
| `F2` | Cycle model |
| `Shift+Enter` | Insert newline |
| `Ctrl+A/E` | Home/End |
| `Ctrl+U/K` | Delete to start/end |
| `Ctrl+Left/Right` | Word jump |

## TUI Slash Commands

| Command | Description |
| --- | --- |
| `/help` | Show available commands and shortcuts |
| `/new` | Start a new session |
| `/sessions` | List or switch sessions |
| `/plan <goal>` | Plan a task |
| `/run <goal>` | Run a task |
| `/status` | Show current run status |
| `/model [name]` | Show or change model |
| `/agents [role]` | List or switch agent roles |
| `/diff` | View file changes from last run |
| `/config` | Show current configuration |
| `/compact` | Compact conversation history |
| `/exit` | Exit CoAgent |

## Agent Roles

| Role | Permission | Color | When |
| --- | --- | --- | --- |
| **Planner** | Read-only | Purple | Break down goal into tasks |
| **Explorer** | Read-only | Cyan | Inspect repo state & risks |
| **Implementer** | Scoped-write | Orange | Make code changes |
| **Reviewer** | Review gate | Blue | Check for bugs & regressions |
| **Tester** | Read-only | Green | Run verification commands |
| **Integrator** | Review gate | Yellow | Resolve conflicts, final merge |

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
  opencode.json         # Model & backend config (via /model command)
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

CoAgent provides 7 progressive examples — no AI backend required for most of them.

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
- **OpenCode backend**: OpenCode CLI + API key
- **Claude Code backend**: `@anthropic-ai/claude-code` CLI + API key
- **Mock backend**: No requirements

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
