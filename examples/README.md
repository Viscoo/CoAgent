# CoAgent 示例

从零开始，循序渐进地掌握 CoAgent 多智能体编排。

## 前置条件

```bash
npm install
npm run build
```

## 运行方式

```bash
npx tsx examples/01-task-graph.ts
```

## 示例列表

| # | 文件 | 内容 | 需要 OpenCode? |
|---|------|------|:-:|
| 01 | [task-graph.ts](./01-task-graph.ts) | 理解任务图：CoAgent 如何将目标拆解为 6 个角色的任务 | 否 |
| 02 | [agent-roles.ts](./02-agent-roles.ts) | 认识 6 个 Agent 角色：权限、职责、Prompt 模板 | 否 |
| 03 | [mock-orchestration.ts](./03-mock-orchestration.ts) | Mock 编排运行：模拟完整执行流程，查看各角色产出 | 否 |
| 04 | [retry-logic.ts](./04-retry-logic.ts) | 重试机制：模拟失败场景，观察指数退避重试 | 否 |
| 05 | [hub-collaboration.ts](./05-hub-collaboration.ts) | Hub 协作：多 Agent 通过 WebSocket 互相通信 | 否 |
| 06 | [real-opencode.ts](./06-real-opencode.ts) | 连接真实 OpenCode：配置模型、API Key、启动服务 | 是 |
| 07 | [full-e2e.ts](./07-full-e2e.ts) | 端到端完整流程：初始化 → 规划 → 执行 → 安全检查 → 合并 | 否 |

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

## 连接真实 OpenCode（示例 06）

要让 CoAgent 调用真实的 AI 模型，需要：

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

4. **运行**
   ```bash
   # 方式一：自动启动 OpenCode 服务
   coagent run "Add user registration" --start-server

   # 方式二：手动启动后连接
   opencode serve --port 4096
   coagent run "Add user registration" --opencode-url http://127.0.0.1:4096

   # 方式三：交互式 TUI
   coagent open
   ```
