# CoAgent

[English](./README.md) | 中文

**CoAgent** 是一个多 Agent 编排框架，核心是**框架无关的 Hub 适配层**。它将开源 AI 编码框架 — **OpenCode**、**OpenClaw**、**Claude Code**、**Hermes** 等 — 统一适配到同一接口，实现跨框架 Agent 协作、任务编排和集体智能。

## 特性

- **多框架 Hub 适配** — 可插拔适配器支持 OpenCode、OpenClaw、Claude Code、Hermes 等任意开源 Agent 框架
- **跨框架协作** — 不同框架构建的 Agent 通过 Hub WebSocket 层透明通信
- **任务编排** — 将目标分解为任务图，按依赖关系并行执行
- **6 种角色** — Planner / Explorer / Implementer / Reviewer / Tester / Integrator
- **审查关卡** — 代码变更需通过 Review 和 Test 关卡才能合并
- **安全策略** — 只读角色禁止写入，实现者作用域限制，冲突自动检测
- **重试机制** — 失败任务指数退避重试，可配置重试次数
- **TUI 界面** — 全屏终端交互界面，OpenCode 风格布局
- **直接 AI 对话** — 内置 DeepSeek / OpenAI / Anthropic API 流式支持

## 快速开始

```bash
npm install
npm run build

# 交互式 TUI（默认 — 读取 .coagent/chat.json 配置）
coagent

# Mock 模式（无需 API Key）
coagent run "add a hello-world endpoint"

# 使用 OpenCode 后端
coagent run "add auth middleware" --backend opencode --start-server

# 使用 Claude Code 后端
coagent run "refactor the logger" --backend claude
```

## 多框架 Hub 架构

CoAgent 的核心价值在于**框架无关的 Hub 层**。不锁定单一 AI Agent 框架，而是提供统一的 `CoAgentAdapter` 接口，任意开源 Agent 框架均可实现：

```
                    CoAgentAdapter (统一接口)
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
  │  (SDK/HTTP)  │ │  (CLI)      │ │  (规划中)   │
  └──────────────┘ └─────────────┘ └─────────────┘
  ┌──────────────┐ ┌─────────────┐ ┌─────────────┐
  │  Hermes      │ │  DeepSeek   │ │   Mock      │
  │  Adapter     │ │  Chat API   │ │  Adapter    │
  │  (规划中)    │ │  (内置)     │ │  (测试)     │
  └──────────────┘ └─────────────┘ └─────────────┘
```

### 已支持与规划中的适配器

| 框架 | 状态 | 后端标志 | 说明 |
| --- | --- | --- | --- |
| **OpenCode** | ✅ 已实现 | `--backend opencode` | OpenCode SDK / HTTP API |
| **Claude Code** | ✅ 已实现 | `--backend claude` | Claude Code CLI (`claude -p`) |
| **DeepSeek / OpenAI / Anthropic** | ✅ 内置 | TUI 对话 | 直接 API 调用 + 流式响应 |
| **Mock** | ✅ 已实现 | `--backend mock` | 模拟（无需 API Key） |
| **OpenClaw** | 🔜 规划中 | `--backend openclaw` | 开源 Agent 框架适配器 |
| **Hermes** | 🔜 规划中 | `--backend hermes` | Hermes Agent 框架适配器 |

### 添加新框架适配器

任意开源 AI Agent 框架均可通过实现 `CoAgentAdapter` 接口接入：

```typescript
import type { CoAgentAdapter } from "coagent";

class MyFrameworkAdapter implements CoAgentAdapter {
  readonly backend = "my-framework";

  async ensureReady(): Promise<void> { /* 检查框架是否安装 */ }
  async createParentSession(goal: string): Promise<CoAgentSession> { /* ... */ }
  async createChildSession(parentId: string, task: TaskNode, agent: AgentSpec): Promise<CoAgentSession> { /* ... */ }
  async prompt(sessionId: string, prompt: string): Promise<CoAgentPromptResult> { /* ... */ }
  async diff(sessionId: string): Promise<string[]> { /* ... */ }
  async close(): Promise<void> { /* ... */ }
}
```

在 `src/adapters/adapter.ts` → `createAdapter()` 中注册，将后端类型加入 `BackendType`，使用该框架的 Agent 即可通过 Hub 与所有其他框架协作。

### 跨框架协作 via Hub

不同框架的 Agent 通过 Hub 通信：

```
┌──────────────────────────────────────────────────────────┐
│                     CoAgent Hub                           │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ WebSocket    │  │ Agent 状态   │  │ 消息路由      │  │
│  │ 服务 :4876   │  │ 存储 (内存)  │  │               │  │
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

// 不同框架的 Agent，同一个 Hub
const planner = new AgentClient({ role: "planner", backend: "opencode" });
const implementer = new AgentClient({ role: "implementer", backend: "claude" });

await planner.connect();
await implementer.connect();

// 跨框架通信
planner.sendToAgent(implementer.id, "请实现注册 API");
```

## 架构

```
                        ┌──────────────┐
                        │   CLI / TUI  │
                        └──────┬───────┘
                               │
                 ┌─────────────▼──────────────┐
                 │     Orchestrator           │
                 │  - 任务调度                │
                 │  - 指数退避重试            │
                 │  - 进度事件                │
                 └──────┬──────────────┬──────┘
                        │              │
            ┌───────────▼──┐   ┌──────▼──────────┐
            │  AgentRegistry│   │  RunLedger      │
            │  - 6 种角色   │   │  - 持久化       │
            │  - 提示词     │   │  - .coagent/    │
            └───────────────┘   └──────┬──────────┘
                                       │
            ┌───────────────┐   ┌──────▼──────────┐
            │  MergeGate    │   │  PolicyGuard    │
            │  - 冲突检测   │   │  - 作用域检查   │
            │  - 关卡验证   │   │  - 权限控制     │
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

## 命令

| 命令 | 说明 |
| --- | --- |
| `coagent` | 打开交互式 TUI（全屏，OpenCode 风格） |
| `coagent init` | 创建 `.opencode/agents/*.md` 角色脚手架 |
| `coagent plan "<goal>"` | 创建任务图和运行账本（试运行） |
| `coagent run "<goal>"` | 完整编排：规划 → 执行 → 合并关卡 |
| `coagent status [run-id]` | 查看最新或指定运行的摘要 |
| `coagent resume <run-id>` | 继续未完成的运行 |
| `coagent logs [run-id]` | 查看运行的决策日志和产物 |
| `coagent chat` | 打开交互式 CoAgent 会话（REPL） |
| `coagent open` | 交互式打开 CoAgent（优先使用 OpenCode TUI，回退到 chat） |
| `coagent hub` | 启动 CoAgent Hub 服务（多 Agent 通信） |
| `coagent ps` | 查看所有在线 Agent |
| `coagent version` | 打印版本号 |

### 选项

| 标志 | 默认值 | 说明 |
| --- | --- | --- |
| `--cwd <path>` | `.` | 工作目录 |
| `--backend <type>` | `mock` | AI 后端：`opencode`、`claude`、`mock` |
| `--model <name>` | — | 模型覆盖（如 `anthropic/claude-sonnet-4-20250514`） |
| `--concurrency <n>` | `2` | 最大并行任务数 |
| `--retries <n>` | `2` | 每个任务最大重试次数（指数退避） |
| `--dry-run` | `false` | 仅规划/账本，不执行 AI 后端 |
| `--start-server` | `false` | 自动启动 `opencode serve` |
| `--opencode-url <url>` | — | OpenCode 服务地址 |
| `--mock` | `false` | 强制使用 Mock 适配器 |
| `--mock-failure-rate <n>` | `0` | Mock 失败概率 0-1 |
| `--port <n>` | `4876` | Hub 端口 |
| `--host <addr>` | `127.0.0.1` | Hub 监听地址 |
| `--role <name>` | `general` | Agent 角色名称 |
| `--hub <url>` | `http://127.0.0.1:4876` | Hub 地址（用于 `ps` 命令） |

## TUI 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+N` | 新建会话 |
| `Ctrl+P` | 命令面板 |
| `Ctrl+L` | 会话列表 |
| `Ctrl+B` | 切换侧边栏 |
| `F2` | 切换模型 |
| `Shift+Enter` | 插入换行 |
| `Ctrl+A/E` | 行首/行尾 |
| `Ctrl+U/K` | 删除至行首/行尾 |
| `Ctrl+Left/Right` | 按词跳转 |

## TUI 斜杠命令

| 命令 | 说明 |
| --- | --- |
| `/help` | 显示可用命令和快捷键 |
| `/new` | 新建会话 |
| `/sessions` | 列出或切换会话 |
| `/plan <goal>` | 规划任务 |
| `/run <goal>` | 运行任务 |
| `/status` | 显示当前运行状态 |
| `/model [name]` | 显示或切换模型（支持 DeepSeek、OpenAI、Anthropic） |
| `/agents [role]` | 列出或切换 Agent 角色 |
| `/diff` | 查看上次运行的文件变更 |
| `/config` | 显示当前配置 |
| `/compact` | 压缩对话历史 |
| `/exit` | 退出 CoAgent |

## Agent 角色

| 角色 | 权限 | 颜色 | 时机 |
| --- | --- | --- | --- |
| **Planner** | 只读 | 紫色 | 将目标分解为任务 |
| **Explorer** | 只读 | 青色 | 检查仓库状态与风险 |
| **Implementer** | 作用域写入 | 橙色 | 编写代码变更 |
| **Reviewer** | 审查关卡 | 蓝色 | 检查 bug 和回归 |
| **Tester** | 只读 | 绿色 | 运行验证命令 |
| **Integrator** | 审查关卡 | 黄色 | 解决冲突，最终合并 |

## 运行流程

```
plan ──► explore ──► implement ──┬──► review ──┐
                                  │             │
                                  └──► test  ───┼──► integrate ──► merge gate
                                               │
                                    ┌──────────┘
                                    ▼
                          ✓ clean — 准备应用
                          △ needs-integrator — 发现冲突
                          ⊘ blocked — 关卡失败或策略违规
```

## 目录结构

```
.coagent/
  chat.json              # AI 提供商配置（DeepSeek/OpenAI/Anthropic）
  runs/
    <runId>/
      run.json           # 完整编排状态
.opencode/
  agents/
    coagent-planner.md   # 角色定义
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

## 重试逻辑

失败任务使用指数退避重试：

- 第一次重试：2 秒延迟
- 第二次重试：4 秒延迟
- 可通过 `--retries <n>` 配置

耗尽重试次数的任务标记为 `failed`；依赖该任务的任务将被阻塞。

## 安全机制

- 只读角色如果产生了文件 diff，将被阻止
- Implementer 的修改范围限制在分配的文件内 — 超出范围触发策略违规
- Review 或 Test 关卡未通过时，合并被阻止
- 多个 Implementer 之间的文件所有权冲突需要 Integrator 解决

## 示例

CoAgent 提供 7 个渐进式示例 — 大部分无需 AI 后端。

```bash
npx tsx examples/01-task-graph.ts    # 理解任务图与依赖关系
npx tsx examples/02-agent-roles.ts   # 探索 6 种 Agent 角色与权限
npx tsx examples/03-mock-orchestration.ts  # Mock 完整编排运行
npx tsx examples/04-retry-logic.ts   # 指数退避重试
npx tsx examples/05-hub-collaboration.ts   # 多 Agent Hub 协作
npx tsx examples/06-real-opencode.ts # 连接真实 OpenCode（配置指南）
npx tsx examples/07-full-e2e.ts      # 端到端：init → plan → execute → merge
```

详见 [docs/usage-examples.md](./docs/usage-examples.md)。

## 开发

```bash
# 构建
npm run build

# 开发（无需构建）
npm run dev -- run "feature" --dry-run

# 类型检查
npm run check

# 测试（需要 bun）
bun test
```

## 环境要求

- Node.js >= 22 或 Bun >= 1.1
- **OpenCode 后端**：OpenCode CLI + API Key
- **Claude Code 后端**：`@anthropic-ai/claude-code` CLI + API Key
- **OpenClaw 后端**（规划中）：安装 OpenClaw 框架
- **Hermes 后端**（规划中）：安装 Hermes 框架
- **TUI 直接对话**：在 `.coagent/chat.json` 中配置 DeepSeek / OpenAI / Anthropic API Key
- **Mock 后端**：无要求

## 第三方许可证

本项目包含以下第三方项目的源代码：

### OpenCode AI SDK

- **来源**: [opencode-ai/opencode](https://github.com/opencode-ai/opencode) (`packages/sdk/js/`)
- **集成位置**: `src/opencode-sdk/`
- **许可证**: MIT License
- **版权**: Copyright (c) 2025 opencode

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
