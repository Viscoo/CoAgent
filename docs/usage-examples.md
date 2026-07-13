# CoAgent 使用指南与示例

本文档详细介绍如何使用 CoAgent 的 7 个入门示例，帮助你从零开始掌握多智能体编排。

## 前置条件

```bash
# 安装依赖
npm install

# 构建项目
npm run build
```

运行示例需要 `tsx`（已包含在 devDependencies 中）：

```bash
npx tsx examples/01-task-graph.ts
```

## 学习路径

```
01 任务图 ──► 02 角色认知 ──► 03 Mock运行 ──► 04 重试机制
                                                    │
                                                    ▼
                                          07 端到端完整流程
                                                    │
                                                    ▼
                                          05 Hub协作 ──► 06 真实OpenCode
```

---

## 示例 01：理解任务图

**文件**: `examples/01-task-graph.ts`

**你将学到**: CoAgent 如何将一个目标拆解为 6 个角色的任务，并按依赖顺序执行。

```bash
npx tsx examples/01-task-graph.ts
```

**输出示例**:
```
CoAgent 会将你的目标拆解为 6 个角色的任务，按依赖顺序执行：

  planner        Plan work ← 无依赖，可立即执行
  explorer       Explore repository ← 等待 [planner]
  implementer    Implement scoped changes ← 等待 [planner, explorer]
  reviewer       Review changes ← 等待 [implementer]
  tester         Verify behavior ← 等待 [implementer]
  integrator     Integrate final result ← 等待 [reviewer, tester]
```

**关键概念**:
- 任务图是一个有向无环图（DAG）
- `planner` 没有依赖，最先执行
- `reviewer` 和 `tester` 可以并行执行
- `integrator` 必须等 review 和 test 都完成

---

## 示例 02：认识 6 个 Agent 角色

**文件**: `examples/02-agent-roles.ts`

**你将学到**: 每个角色的权限、职责，以及它们收到的 Prompt 长什么样。

```bash
npx tsx examples/02-agent-roles.ts
```

**关键概念**:

| 角色 | 权限 | 职责 |
|------|------|------|
| 规划者 (Planner) | 只读 | 将目标拆解为任务图 |
| 探索者 (Explorer) | 只读 | 检查仓库现状和风险 |
| 实现者 (Implementer) | 限定写入 | 在分配的文件范围内编码 |
| 审查者 (Reviewer) | 审查关卡 | 检查 bug 和回归 |
| 测试者 (Tester) | 只读 | 运行验证命令 |
| 集成者 (Integrator) | 审查关卡 | 解决冲突，准备最终合并 |

---

## 示例 03：Mock 编排运行

**文件**: `examples/03-mock-orchestration.ts`

**你将学到**: 使用 MockAdapter 模拟完整编排流程，查看各角色的实际产出。

```bash
npx tsx examples/03-mock-orchestration.ts
```

**输出示例**:
```
目标: Add a hello-world API endpoint

开始编排执行：
  ▶ planner: Plan work
  ✓ planner: 完成
  ▶ implementer: Implement scoped changes
  ✓ implementer: 完成 — changed 1 file
  ...

各角色产出：
  ✓ planner
    摘要: Analyzed goal and decomposed into 4 sequential steps with risk assessment.
  ✓ implementer
    修改: src/cli.ts
    摘要: Applied scoped changes. All existing tests pass.

合并评估: ✓ 无冲突，可直接合并
```

**关键概念**:
- MockAdapter 不需要 OpenCode 服务，适合学习和开发
- 每个角色会返回模拟的摘要和文件变更
- 只有实现者（Implementer）会产生文件变更

---

## 示例 04：重试机制

**文件**: `examples/04-retry-logic.ts`

**你将学到**: 任务失败时的指数退避重试机制。

```bash
npx tsx examples/04-retry-logic.ts
```

**输出示例**:
```
模拟: 40% 随机失败率，最多重试 3 次

  ⚠ planner: 执行失败，2秒后重试...
  ↻ planner: 重试第 2 次 — Plan work
  ✓ planner: 完成
```

**关键概念**:
- `maxRetries` 控制最大重试次数
- `retryDelayMs` 控制初始延迟，每次重试翻倍（指数退避）
- 重试耗尽后任务标记为 `failed`，依赖它的任务会被阻塞

---

## 示例 05：Hub 多 Agent 协作

**文件**: `examples/05-hub-collaboration.ts`

**你将学到**: 多个 Agent 通过 WebSocket 互相通信和协作。

```bash
npx tsx examples/05-hub-collaboration.ts
```

**输出示例**:
```
1. Hub 服务已启动: ws://127.0.0.1:4877
2. 规划者已连接到 Hub
3. 实现者已连接到 Hub
4. 开始协作：
   实现者收到消息 [来自规划者]: 请按计划实现用户注册 API
5. 当前 Hub 上的 Agent 列表：
   规划者 (planner) — 状态: busy，任务: 分析需求，制定实现计划
```

**关键概念**:
- Hub 是 WebSocket 通信中心，默认端口 4876
- Agent 可以点对点发消息（`sendToAgent`）或广播（`broadcast`）
- 每个 Agent 可以更新自己的状态和当前任务

---

## 示例 06：连接真实 OpenCode

**文件**: `examples/06-real-opencode.ts`

**你将学到**: 如何配置模型、API Key，连接真实的 AI 后端。

```bash
npx tsx examples/06-real-opencode.ts
```

> 注意：此示例仅展示配置方法，不会实际执行（需要有效的 API Key）。

### 前置条件

1. **安装 OpenCode CLI**
   ```bash
   npm install -g opencode-ai
   ```

2. **配置 API Key**（以 Anthropic 为例）
   ```bash
   export ANTHROPIC_API_KEY=sk-ant-xxxxx
   ```

3. **创建 `.opencode.json` 配置**
   ```json
   {
     "agents": {
       "coder": {
         "model": "claude-sonnet-4-20250514",
         "maxTokens": 5000
       },
       "task": {
         "model": "claude-sonnet-4-20250514",
         "maxTokens": 5000
       }
     }
   }
   ```

### 三种连接方式

**方式一：自动启动 OpenCode 服务（推荐）**
```typescript
const adapter = new SdkOpenCodeAdapter({
  cwd: process.cwd(),
  startServer: true,  // 自动执行 opencode serve
});
```

**方式二：连接已运行的服务**
```bash
# 先在终端启动
opencode serve --port 4096
```
```typescript
const adapter = new SdkOpenCodeAdapter({
  cwd: process.cwd(),
  baseUrl: "http://127.0.0.1:4096",
});
```

**方式三：使用 CLI 命令**
```bash
coagent run "Add user registration" --start-server
coagent run "Add user registration" --opencode-url http://127.0.0.1:4096
coagent open  # 打开交互式 TUI
```

---

## 示例 07：端到端完整流程

**文件**: `examples/07-full-e2e.ts`

**你将学到**: 一次完整运行的 7 个步骤：初始化 → 规划 → 执行 → 安全检查 → 合并。

```bash
npx tsx examples/07-full-e2e.ts
```

**输出示例**:
```
步骤 1: 初始化项目脚手架
  创建了 11 个配置文件

步骤 2: 规划任务（仅创建计划，不执行）
  运行 ID: run_xxx
  任务数: 6

步骤 3: 执行完整编排
  ▶ planner: Plan work
  ✓ planner: 完成
  ...

步骤 4: 查看各角色执行结果
  【规划者】planner
    产出: Created task graph...
  【实现者】implementer
    修改: src/core/feature.ts, src/cli.ts

步骤 5: 安全检查
  策略违规: 0

步骤 6: 合并评估
  ✓ 无冲突，可以安全合并

步骤 7: 运行记录持久化
  运行记录已保存到 .coagent/runs/run_xxx/run.json
```

**关键概念**:
- `orch.init()` 创建 `.opencode/` 脚手架
- `orch.plan()` 仅规划不执行
- `orch.run()` 规划 + 执行
- PolicyGuard 检查权限违规
- MergeGate 评估合并冲突
- RunLedger 持久化运行记录

---

## 编程接口速查

### Orchestrator

```typescript
import { Orchestrator, MockAdapter } from "coagent";

const orch = new Orchestrator({
  cwd: process.cwd(),        // 工作目录
  maxConcurrency: 2,          // 最大并行任务数
  dryRun: false,              // true = 仅规划不执行
  adapter: new MockAdapter(), // 适配器
  maxRetries: 2,              // 最大重试次数
  retryDelayMs: 2000,         // 重试初始延迟(ms)
  onProgress: (e) => {},      // 进度回调
});

await orch.init();                    // 初始化脚手架
const plan = await orch.plan("目标"); // 仅规划
const run = await orch.run("目标");   // 规划 + 执行
const resumed = await orch.resume(run.id); // 恢复中断的运行
const status = await orch.status();   // 查询最新运行状态
```

### Hub

```typescript
import { startHub, AgentClient } from "coagent";

const hub = await startHub({ port: 4876 });

const agent = new AgentClient({ name: "my-agent", role: "planner" });
agent.on("message", (msg) => console.log(msg.text));
await agent.connect();

agent.sendToAgent(otherId, "直接消息");
agent.broadcast("广播消息", "topic");

await agent.disconnect();
await hub.stop();
```

### 任务图

```typescript
import { createTaskGraph, getReadyTasks, updateTaskStatus } from "coagent";

const graph = createTaskGraph("我的目标");
const ready = getReadyTasks(graph);           // 获取可执行任务
const updated = updateTaskStatus(graph, taskId, "completed"); // 更新状态
```