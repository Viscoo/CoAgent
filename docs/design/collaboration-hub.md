# CoAgent Hub — 多 Agent 集体意识层

> 让机器上所有 CLI agent 窗口互相透明、共享经验、并行工作、长期演化

## 1. 愿景

> **机器上每个 CLI 窗口都是一个自治的 agent 实例。它们通过一个「集体意识层」互相看见、共享知识、并行工作。随着使用，每个 agent 积累经验、形成角色个性，最终成为用户的智能助手集群。**

这与现有的 agent 框架（AutoGen、CrewAI、LangGraph）有本质区别：

| 传统编排 | CoAgent Hub |
|---------|------------|
| 一个进程内编排多个 agent | 多进程独立运行，通过 Hub 松散耦合 |
| 中央调度器控制所有 agent | 无中心调度，agent 自治 |
| agent 之间黑盒调用 | 全透明 —— 任何 agent 可看到其他 agent 的状态 |
| 知识不跨 session | 共享经验库，一次解决全局受益 |
| agent 无身份/角色演化 | agent 随时间积累 profile，可手动配置角色 |

## 2. 问题场景

### 场景 A：并行排查

用户开 3 个 CLI 窗口：

- 窗口 1：`coagent open` — 调研项目 A 的 API 文档
- 窗口 2：`coagent open` — 写项目 B 的单元测试
- 窗口 3：`coagent open` — 调优项目 C 的构建配置

**现状：** 三个窗口完全隔离，窗口 2 遇到一个构建问题，需要重新开一个窗口重新查
**理想：** 窗口 2 可以直接问窗口 1 "你刚才查的那个构建命令是什么？"，或者共享知识库自动匹配到了类似问题

### 场景 B：角色专业化

用户经常用 CoAgent 写后端 API，慢慢地其中一个实例积累了大量的 Express/Prisma 经验，另一个实例则擅长前端 React。

- 新的 API 任务来的时候，用户自动选择"那个懂后端的窗口"
- 或者 hub 自动分配：根据历史匹配度推荐窗口

### 场景 C：跨项目知识复用

项目 A 中解决了一个"Webpack 5 Module Federation 版本不兼容"的问题，写入共享知识库。一个月后在项目 B 遇到同样的错误，hub 自动提示"这个问题你在项目 A 解决过"。

## 3. 架构概览

```
┌────────────────────────────────────────────────────────┐
│                    CoAgent Hub                         │
│                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ WebSocket    │  │ Agent 状态   │  │ 共享知识库   │ │
│  │ 服务 :4876   │  │ 存储 (内存)  │  │ (文件/SQLite)│ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         │                 │                 │          │
│  ┌──────┴──────────────────┴──────────────────┴───────┐ │
│  │             消息路由 & 事件分发                     │ │
│  └──────────────────────┬─────────────────────────────┘ │
└──────────────────────────┼──────────────────────────────┘
                           │
         ┌─────────────────┼──────────────────┐
         │                 │                  │
    ┌────┴─────┐     ┌────┴─────┐      ┌────┴─────┐
    │ Agent A  │     │ Agent B  │      │ Agent C  │
    │ CLI 窗口1 │     │ CLI 窗口2 │      │ CLI 窗口3 │
    │ planner   │     │ implement│      │ reviewer  │
    │ 项目 A    │     │ 项目 B   │      │ 项目 A    │
    └───────────┘     └──────────┘      └──────────┘
         │                  │                  │
    ┌────┴────┐        ┌────┴────┐       ┌────┴────┐
    │OpenCode │        │OpenCode │       │OpenCode │
    │ session │        │ session │       │ session │
    └─────────┘        └─────────┘       └─────────┘
```

### 组件说明

#### CoAgent Hub（中央服务）

- **类型：** 单进程 WebSocket + HTTP 服务
- **职责：** agent 注册/心跳、状态广播、消息路由、知识库读写
- **启动方式：** `coagent hub` 或作为守护进程自动启动
- **端口默认：** 4876（可配置）

#### Agent Client（各 CLI 实例）

- **类型：** CoAgent 启动时自动创建的 WebSocket 客户端
- **职责：** 连接 hub、广播自身状态、收发消息、读写知识库
- **生命周期：** 与 CLI 进程同生共死
- **自动发现：** 启动时检查 hub 是否在运行，不在则自动启动

#### 共享知识库

- **类型：** 基于 `.coagent/hub/knowledge/` 的文件 + SQLite 存储
- **内容：** 问题-解决方案对、代码片段、工具使用经验
- **查询：** 语义搜索（嵌入向量） + 关键词搜索

## 4. 通信协议（Hub ↔ Agent）

### 4.1 传输层

- **WebSocket** 作为主通道（双向实时）
- **HTTP** 作为辅助通道（查询、知识库 CRUD）

### 4.2 WebSocket 消息格式

所有消息为 JSON：

```typescript
interface HubMessage {
  type: string;        // 消息类型
  from: string;        // 发送者 agentId
  to?: string;         // 接收者 agentId（为空则为广播）
  id: string;          // 消息唯一 ID
  timestamp: string;   // ISO 8601
  payload: any;        // 消息体
}
```

### 4.3 消息类型

#### Agent → Hub

| type | 说明 | payload |
|------|------|---------|
| `agent.register` | 注册上线 | `{ name, projectDir, role, goal, capabilities }` |
| `agent.heartbeat` | 心跳 | `{ status: "idle"\|"busy"\|"thinking", currentTask? }` |
| `agent.update` | 状态更新 | `{ status, goal, currentTask?, progress? }` |
| `agent.message` | 发消息给其他 agent | `{ to, text, context? }` |
| `agent.broadcast` | 群发 | `{ text, topic? }` |
| `agent.query` | 查询知识库 | `{ query: string, limit?: number }` |
| `agent.knowledge.add` | 添加知识 | `{ topic, problem, solution, tags, project? }` |
| `agent.unregister` | 下线 | `{}` |

#### Hub → Agent

| type | 说明 | payload |
|------|------|---------|
| `hub.registered` | 注册确认 | `{ agentId, peers }` |
| `hub.peer.join` | 新 agent 上线 | `{ agent }` |
| `hub.peer.leave` | agent 下线 | `{ agentId }` |
| `hub.peer.update` | agent 状态更新 | `{ agentId, status }` |
| `hub.message` | 收到消息 | `{ from, text, context? }` |
| `hub.knowledge.result` | 知识查询结果 | `{ results }` |
| `hub.knowledge.match` | 知识自动匹配 | `{ problem, solution, confidence }` |
| `hub.error` | 错误通知 | `{ code, message }` |

### 4.4 Agent 状态模型

```typescript
interface AgentInfo {
  id: string;
  name: string;               // 用户自定义名称或自动生成
  projectDir: string;         // 工作目录
  role?: string;              // 角色，如 "planner" / "api-专家"
  status: "online" | "busy" | "idle" | "offline";
  currentTask?: string;       // 当前任务描述
  goal?: string;              // 当前目标
  capabilities: string[];     // 能力标签
  connectedAt: string;
  lastHeartbeat: string;
  profile?: AgentProfile;     // 长期积累的 profile
}

interface AgentProfile {
  totalSessions: number;
  totalMessages: number;
  commonTasks: string[];
  expertise: string[];        // 自动识别的专长领域
  preferredTools: string[];
  avgResponseTime?: number;
}
```

## 5. 共享知识库模型

```typescript
interface KnowledgeEntry {
  id: string;
  type: "problem-solution" | "code-snippet" | "tool-usage" | "tip";
  title: string;
  problem: string;           // 问题描述
  solution: string;           // 解决方案
  tags: string[];
  projectDir?: string;        // 来源项目
  authorAgentId: string;      // 贡献者
  createdAt: string;
  updatedAt: string;
  upvotes: number;
  embedding?: number[];       // 向量嵌入，用于语义搜索
}
```

## 6. 实现路线

### Phase 1：核心通信（现在开始）

- [x] Hub WebSocket 服务
- [x] Agent 注册/心跳/状态广播
- [x] Agent-to-Agent 私信
- [x] Agent-to-All 广播
- [x] CLI 整合：`coagent hub` 命令
- [x] CLI 整合：`coagent open` 自动连接 hub
- [x] `coagent ps` 查看所有在线 agent
- [x] Git push

### Phase 2：并行执行 & 协作

- [ ] 跨 agent 任务委托（A 发消息给 B："帮我写这个函数"）
- [ ] 并行任务状态同步
- [ ] Hub 持久化（agent 状态重启恢复）

### Phase 3：共享知识库

- [ ] 知识条目 CRUD API
- [ ] 自动匹配（发送消息时自动查询相关经验）
- [ ] 语义搜索（简单嵌入）
- [ ] `coagent knowledge search "xxx"` CLI

### Phase 4：Profile & 角色演化

- [ ] 记录 agent 使用行为
- [ ] 自动提取 expertise
- [ ] 手动角色设定（`--role "API专家"`）
- [ ] Hub 推荐 agent（"这个任务最好交给窗口 2"）

## 7. 与现有系统的关系

| 系统 | 关系 |
|------|------|
| **OpenCode** | CoAgent 底层引擎，不变。Hub 不修改 OpenCode 代码 |
| **CoAgent Orchestrator** | 互补。Orchestrator 是任务编排，Hub 是 agent 之间的人肉/agent 通信层 |
| **A2A (Agent2Agent)** | 未来可兼容。Hub 可暴露 A2A Agent Card，让外部 agent 与内部 agent 通信 |
| **MCP** | 不变。agent 的工具仍通过 MCP 调用 |

## 8. 设计原则

1. **轻量优先** — 核心功能代码尽量少，不依赖重型框架
2. **渐进复杂** — 从简单的 WebSocket 通信开始，逐步加入持久化、语义搜索
3. **非侵入** — 不影响现有 CoAgent 功能。Hub 是可选的增强层
4. **自治** — Agent 没有 hub 也能独立工作，有 hub 则自动增强
5. **透明** — 所有 agent 的状态对用户和彼此可见
