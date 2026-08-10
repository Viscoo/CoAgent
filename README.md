# CoAgent

English | [中文](./README_zh.md)

**CoAgent** is a multi-agent orchestration framework with a framework-agnostic Hub layer. It adapts open-source AI coding agents — **OpenCode**, **OpenClaw**, **Claude Code**, **Hermes**, and more — into a unified interface, enabling cross-framework agent collaboration, task orchestration, and collective intelligence.

## Features

- **Multi-Framework Hub Adapters** — Pluggable adapters for OpenCode, OpenClaw, Claude Code, Hermes, and any open-source agent framework
- **Cross-Framework Collaboration** — Agents built on different frameworks communicate transparently via Hub WebSocket layer
- **Task Orchestration** — Break goals into task graphs, execute in parallel by dependency
- **6 Agent Roles** — Planner / Explorer / Implementer / Reviewer / Tester / Integrator
- **Review Gates** — Code changes must pass Review and Test gates before merging
- **Safety Policies** — Read-only roles blocked from writing, implementers scoped, conflict detection
- **Retry Logic** — Failed tasks retry with exponential backoff, configurable retry count
- **TUI Interface** — OpenCode-style terminal UI with sidebar, command palette, and shortcuts
- **Direct AI Chat** — Built-in DeepSeek / OpenAI / Anthropic API support with streaming

## Quick Start

```bash
npm install
npm run build

# Interactive TUI (default — uses .coagent/chat.json config)
coagent

# Mock mode (no API key needed)
coagent run "add a hello-world endpoint"

# With OpenCode backend
coagent run "add auth middleware" --backend opencode --start-server

# With Claude Code backend
coagent run "refactor the logger" --backend claude
```

## Multi-Framework Hub Architecture

CoAgent's core value is its **framework-agnostic Hub layer**. Instead of locking into one AI agent framework, CoAgent provides a unified `CoAgentAdapter` interface that any open-source agent framework can implement:

```
                    CoAgentAdapter (unified interface)
                    ├── ensureReady()
                    ├── createParentSession()
                    ├── createChildSession()
                    ├── prompt()
                    ├── diff()
                    └── close()
                          │
          ┌───────────────┼───────────────┐
          │               │               │
  ┌───────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
  │  OpenCode    │ │ Claude Code │ │  OpenClaw   │
  │  Adapter     │ │  Adapter    │ │  Adapter    │
  │  (SDK/HTTP)  │ │  (CLI)      │ │  (planned)  │
  └──────────────┘ └─────────────┘ └─────────────┘
  ┌──────────────┐ ┌─────────────┐ ┌─────────────┐
  │  Hermes      │ │  DeepSeek   │ │   Mock      │
  │  Adapter     │ │  Chat API   │ │  Adapter    │
  │  (planned)   │ │  (built-in) │ │  (testing)  │
  └──────────────┘ └─────────────┘ └─────────────┘
```

### Supported & Planned Adapters

| Framework | Status | Backend Flag | Description |
| --- | --- | --- | --- |
| **OpenCode** | ✅ Implemented | `--backend opencode` | OpenCode SDK / HTTP API |
| **Claude Code** | ✅ Implemented | `--backend claude` | Claude Code CLI (`claude -p`) |
| **DeepSeek / OpenAI / Anthropic** | ✅ Built-in | TUI chat | Direct API calls with streaming |
| **Mock** | ✅ Implemented | `--backend mock` | Simulated (no API key needed) |
| **OpenClaw** | 🔜 Planned | `--backend openclaw` | Open-source agent framework adapter |
| **Hermes** | 🔜 Planned | `--backend hermes` | Hermes agent framework adapter |

### Adding a New Framework Adapter

Any open-source AI agent framework can be integrated by implementing the `CoAgentAdapter` interface:

```typescript
import type { CoAgentAdapter } from "coagent";

class MyFrameworkAdapter implements CoAgentAdapter {
  readonly backend = "my-framework";

  async ensureReady(): Promise<void> { /* check framework is installed */ }
  async createParentSession(goal: string): Promise<CoAgentSession> { /* ... */ }
  async createChildSession(parentId: string, task: TaskNode, agent: AgentSpec): Promise<CoAgentSession> { /* ... */ }
  async prompt(sessionId: string, prompt: string): Promise<CoAgentPromptResult> { /* ... */ }
  async diff(sessionId: string): Promise<string[]> { /* ... */ }
  async close(): Promise<void> { /* ... */ }
}
```

Register in `src/adapters/adapter.ts` → `createAdapter()`, add the backend type to `BackendType`, and agents using this framework can immediately collaborate with all other frameworks through the Hub.

### Cross-Framework Collaboration via Hub

Agents using different frameworks communicate through the Hub:

```
┌──────────────────────────────────────────────────────────┐
│                     CoAgent Hub                           │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ WebSocket    │  │ Agent State  │  │ Message       │  │
│  │ Server :4876 │  │ Store (mem)  │  │ Routing       │  │
│  └──────┬───────┘  └──────┬───────┘  └─────┬─────────┘  │
└─────────┼─────────────────┼────────────────┼────────────┘
          │                 │                │
    ┌─────┴─────┐    ┌─────┴─────┐    ┌─────┴─────┐
    │ Agent A   │    │ Agent B   │    │ Agent C   │
    │ OpenCode  │    │ Claude    │    │ OpenClaw  │
    │ planner   │    │ implement │    │ reviewer  │
    └───────────┘    └───────────┘    └───────────┘
```

```typescript
import { startHub, AgentClient } from "coagent";

const hub = await startHub({ port: 4876 });

// Agents on different frameworks, same Hub
const planner = new AgentClient({ role: "planner", backend: "opencode" });
const implementer = new AgentClient({ role: "implementer", backend: "claude" });

await planner.connect();
await implementer.connect();

// Cross-framework communication
planner.sendToAgent(implementer.id, "Please implement the registration API");
```

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
           ┌────────────▼────────────────────┐
           │     CoAgentAdapter (Hub)        │
           │  ┌────────┐ ┌──────┐ ┌────────┐│
           │  │OpenCode│ │Claude│ │OpenClaw││
           │  │        │ │      │ │Hermes  ││
           │  │        │ │      │ │Mock    ││
           │  └────────┘ └──────┘ └────────┘│
           └────────────────────────────────┘
```

## Commands

| Command | Description |
| --- | --- |
| `coagent` | Open interactive TUI (full-screen, OpenCode-style) |
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
| `/model [name]` | Show or change model (supports DeepSeek, OpenAI, Anthropic) |
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
  chat.json              # AI provider config (DeepSeek/OpenAI/Anthropic)
  runs/
    <runId>/
      run.json           # Full orchestration state
.opencode/
  agents/
    coagent-planner.md   # Role definitions
    coagent-explorer.md
    coagent-implementer.md
    coagent-reviewer.md
    coagent-tester.md
    coagent-integrator.md
  opencode.json          # Model & backend config (via /model command)
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
- **OpenClaw backend** (planned): OpenClaw framework installed
- **Hermes backend** (planned): Hermes framework installed
- **TUI direct chat**: DeepSeek / OpenAI / Anthropic API key in `.coagent/chat.json`
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
