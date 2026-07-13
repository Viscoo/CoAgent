# CoAgent

[English](./README.md) | 中文

**CoAgent** 是一个基于 **OpenCode** 的轻量级多 Agent 编排层。它保留 OpenCode 作为执行引擎，在其之上增加了任务规划、角色化子会话、运行账本、审查关卡、合并检查、重试逻辑，以及多 Agent 集体意识层（Hub）。

## 特性

- **任务编排** — 将目标分解为任务图，按依赖关系并行执行
- **6 种角色** — Planner / Explorer / Implementer / Reviewer / Tester / Integrator
- **审查关卡** — 代码变更需通过 Review 和 Test 关卡才能合并
- **安全策略** — 只读角色禁止写入，实现者作用域限制，冲突自动检测
- **重试机制** — 失败任务指数退避重试，可配置重试次数
- **Hub 集体意识** — 多个 CLI 窗口共享状态、互相通信、并行协作
- **TUI 界面** — 全屏终端交互界面

## 快速开始

```bash
npm install
npm run build
npm start -- init
npm start -- plan "inspect the repo"
npm start -- run "add a new feature" --dry-run
npm start -- run "add a new feature"
```

开发模式（无需构建）：

```bash
npm run dev -- run "refactor the logger"
```

## 架构

```
                      ┌──────────────┐
                      │   CLI (cli.ts) │
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
```

## 命令

| 命令 | 说明 |
| --- | --- |
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
| `--concurrency <n>` | `2` | 最大并行任务数 |
| `--retries <n>` | `2` | 每个任务最大重试次数（指数退避） |
| `--dry-run` | `false` | 仅规划/账本，不执行 OpenCode |
| `--start-server` | `false` | 自动启动 `opencode serve` |
| `--opencode-url <url>` | — | OpenCode 服务地址 |
| `--port <n>` | `4876` | Hub 端口 |
| `--host <addr>` | `127.0.0.1` | Hub 监听地址 |
| `--role <name>` | `general` | Agent 角色名称 |
| `--hub <url>` | `http://127.0.0.1:4876` | Hub 地址（用于 `ps` 命令） |

## Agent 角色

| 角色 | 权限 | 模型倾向 | 时机 |
| --- | --- | --- | --- |
| **Planner** | 只读 | reasoning | 将目标分解为任务 |
| **Explorer** | 只读 | fast-reasoning | 检查仓库状态与风险 |
| **Implementer** | 作用域写入 | coding | 编写代码变更 |
| **Reviewer** | 审查关卡 | reasoning | 检查 bug 和回归 |
| **Tester** | 只读 | fast-reasoning | 运行验证命令 |
| **Integrator** | 审查关卡 | reasoning | 解决冲突，最终合并 |

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

## Hub 集体意识

CoAgent Hub 让多个 CLI 窗口互相透明、共享经验、并行工作：

```
┌────────────────────────────────────────────────────┐
│                    CoAgent Hub                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │ WebSocket    │  │ Agent 状态   │  │ 共享知识库│ │
│  │ 服务 :4876   │  │ 存储 (内存)  │  │ (文件)    │ │
│  └──────┬───────┘  └──────┬───────┘  └────┬─────┘ │
│  ┌──────┴──────────────────┴───────────────┴──────┐ │
│  │             消息路由 & 事件分发                  │ │
│  └──────────────────────┬─────────────────────────┘ │
└──────────────────────────┼──────────────────────────┘
                           │
       ┌───────────────────┼───────────────────┐
       │                   │                   │
  ┌────┴─────┐      ┌─────┴─────┐      ┌─────┴─────┐
  │ Agent A  │      │ Agent B   │      │ Agent C   │
  │ CLI 窗口1 │      │ CLI 窗口2  │      │ CLI 窗口3  │
  │ planner  │      │ implement │      │ reviewer  │
  └──────────┘      └───────────┘      └───────────┘
```

```bash
# 启动 Hub
coagent hub

# 在另一个终端打开 Agent（自动连接 Hub）
coagent open

# 查看所有在线 Agent
coagent ps
```

## 目录结构

```
.coagent/
  runs/
    <runId>/
      run.json          # 完整编排状态
.opencode/
  agents/
    coagent-planner.md  # 角色定义
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
- OpenCode CLI 二进制文件（用于 `coagent open` 和 `--start-server` 模式）

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