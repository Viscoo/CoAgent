// CoAgent Hub — WebSocket 服务端
// 管理所有 agent 连接，路由消息，监控心跳

import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomBytes } from "node:crypto";
import {
  type AgentInfo,
  type AgentStatus,
  type HubMessage,
  type HubMessageType,
  type RegisterPayload,
  type HeartbeatPayload,
  type UpdatePayload,
  newAgentId,
  newMessageId,
  nowIso,
  defaultProfile,
  makeMessage,
} from "./types.js";

const DEFAULT_PORT = 4876;
const HEARTBEAT_INTERVAL_MS = 15_000;   // 每 15s 检查一次
const HEARTBEAT_TIMEOUT_MS = 45_000;    // 45s 无心跳视为离线

export interface HubOptions {
  port?: number;
  host?: string;
}

export class Hub {
  private readonly port: number;
  private readonly host: string;
  private httpServer: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private readonly agents = new Map<string, { info: AgentInfo; ws: WebSocket }>();
  private readonly wsToAgentId = new Map<WebSocket, string>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private shuttingDown = false;

  constructor(options: HubOptions = {}) {
    this.port = options.port ?? DEFAULT_PORT;
    this.host = options.host ?? "127.0.0.1";
  }

  /** 启动 Hub 服务 */
  async start(): Promise<void> {
    this.httpServer = createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });

    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on("connection", (ws, req) => {
      this.handleConnection(ws, req);
    });

    // 心跳检测定时器
    this.heartbeatTimer = setInterval(() => this.checkHeartbeats(), HEARTBEAT_INTERVAL_MS);

    return new Promise((resolve) => {
      this.httpServer!.listen(this.port, this.host, () => {
        console.log(`🧠 CoAgent Hub listening on ws://${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  /** 停止 Hub 服务 */
  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.shuttingDown = true;

    for (const [, { ws }] of this.agents) {
      try {
        ws.terminate();
      } catch { /* ignore */ }
    }
    this.agents.clear();
    this.wsToAgentId.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.httpServer) {
      this.httpServer.closeAllConnections?.();
      await new Promise<void>((resolve) => { this.httpServer!.close(() => resolve()); });
      this.httpServer = null;
    }
    this.shuttingDown = false;
  }

  /** 获取所有在线 agent 信息（不含 WebSocket 连接引用） */
  getAgentList(): AgentInfo[] {
    return Array.from(this.agents.values()).map(({ info }) => ({
      ...info,
      status: info.status as AgentStatus,
    }));
  }

  /** 获取指定 agent 信息 */
  getAgent(agentId: string): AgentInfo | undefined {
    return this.agents.get(agentId)?.info;
  }

  // ───────────── 内部方法 ─────────────

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const clientAddr = req.socket.remoteAddress ?? "unknown";
    console.log(`🔌 New connection from ${clientAddr}`);

    ws.on("message", (raw) => {
      try {
        const msg: HubMessage = JSON.parse(raw.toString());
        this.handleMessage(ws, msg);
      } catch (err) {
        this.sendError(ws, "parse_error", "Invalid JSON message");
      }
    });

    ws.on("close", () => {
      const agentId = this.wsToAgentId.get(ws);
      if (agentId) {
        this.unregisterAgent(agentId);
      }
    });

    ws.on("error", (err) => {
      console.error(`⚠️  WebSocket error: ${err.message}`);
      const agentId = this.wsToAgentId.get(ws);
      if (agentId) {
        this.unregisterAgent(agentId);
      }
    });
  }

  private handleMessage(ws: WebSocket, msg: HubMessage): void {
    switch (msg.type) {
      case "agent.register":
        this.handleRegister(ws, msg);
        break;
      case "agent.heartbeat":
        this.handleHeartbeat(ws, msg);
        break;
      case "agent.update":
        this.handleUpdate(ws, msg);
        break;
      case "agent.message":
        this.handleMessageSend(ws, msg);
        break;
      case "agent.broadcast":
        this.handleBroadcast(ws, msg);
        break;
      case "agent.unregister":
        this.handleUnregister(ws, msg);
        break;
      default:
        this.sendError(ws, "unknown_type", `Unknown message type: ${msg.type}`);
    }
  }

  // ── 注册 ──
  private handleRegister(ws: WebSocket, msg: HubMessage): void {
    const payload = msg.payload as RegisterPayload;
    const agentId = newAgentId();
    const now = nowIso();

    const info: AgentInfo = {
      id: agentId,
      name: payload.name || `agent-${agentId.slice(-6)}`,
      projectDir: payload.projectDir || process.cwd(),
      role: payload.role || "general",
      status: "online",
      currentTask: "",
      goal: payload.goal || "",
      capabilities: payload.capabilities || [],
      connectedAt: now,
      lastHeartbeat: now,
      profile: defaultProfile(),
    };

    this.agents.set(agentId, { info, ws });
    this.wsToAgentId.set(ws, agentId);

    // 回复注册确认 + 当前 peers 列表
    const peers = this.getAgentList().filter((a) => a.id !== agentId);
    this.send(ws, makeMessage("hub.registered", "hub", { agentId, peers }));

    // 广播新 agent 上线
    this.broadcast(makeMessage("hub.peer.join", "hub", { agent: info }), agentId);

    console.log(`✅ Agent registered: ${info.name} (${agentId})`);
  }

  // ── 心跳 ──
  private handleHeartbeat(ws: WebSocket, msg: HubMessage): void {
    const agentId = this.wsToAgentId.get(ws);
    if (!agentId) return;
    const entry = this.agents.get(agentId);
    if (!entry) return;

    const payload = msg.payload as HeartbeatPayload;
    entry.info.lastHeartbeat = nowIso();
    if (payload.status) {
      const oldStatus = entry.info.status;
      entry.info.status = payload.status;
      if (oldStatus !== payload.status) {
        this.broadcast(
          makeMessage("hub.peer.update", "hub", {
            agentId,
            status: payload.status,
            currentTask: entry.info.currentTask,
          }),
          agentId,
        );
      }
    }
    if (payload.currentTask !== undefined) {
      entry.info.currentTask = payload.currentTask;
    }
  }

  // ── 状态更新 ──
  private handleUpdate(ws: WebSocket, msg: HubMessage): void {
    const agentId = this.wsToAgentId.get(ws);
    if (!agentId) return;
    const entry = this.agents.get(agentId);
    if (!entry) return;

    const payload = msg.payload as UpdatePayload;
    const changed: string[] = [];

    if (payload.status && payload.status !== entry.info.status) {
      entry.info.status = payload.status;
      changed.push("status");
    }
    if (payload.goal !== undefined) {
      entry.info.goal = payload.goal;
      changed.push("goal");
    }
    if (payload.currentTask !== undefined) {
      entry.info.currentTask = payload.currentTask;
      changed.push("currentTask");
    }

    if (changed.length > 0) {
      this.broadcast(
        makeMessage("hub.peer.update", "hub", {
          agentId,
          status: entry.info.status,
          goal: entry.info.goal,
          currentTask: entry.info.currentTask,
        }),
        agentId,
      );
    }
  }

  // ── 私信 ──
  private handleMessageSend(ws: WebSocket, msg: HubMessage): void {
    const fromId = this.wsToAgentId.get(ws);
    if (!fromId) return;
    const payload = msg.payload as any;
    const toId = payload.to || msg.to;

    if (!toId) {
      this.sendError(ws, "missing_target", "Message requires a target agent ID");
      return;
    }

    const target = this.agents.get(toId);
    if (!target) {
      this.sendError(ws, "agent_not_found", `Agent ${toId} not found`);
      return;
    }

    // 转发给目标 agent
    this.send(target.ws, makeMessage("hub.message", fromId, {
      text: payload.text,
      context: payload.context,
    }));

    // 更新双方的消息计数
    const fromEntry = this.agents.get(fromId);
    if (fromEntry) fromEntry.info.profile.totalMessagesSent++;
    target.info.profile.totalMessagesReceived++;
  }

  // ── 广播 ──
  private handleBroadcast(ws: WebSocket, msg: HubMessage): void {
    const fromId = this.wsToAgentId.get(ws);
    if (!fromId) return;
    const payload = msg.payload as any;

    this.broadcast(
      makeMessage("hub.message", fromId, {
        text: payload.text,
        topic: payload.topic,
      }),
      fromId,
    );
  }

  // ── 下线 ──
  private handleUnregister(ws: WebSocket, msg: HubMessage): void {
    const agentId = this.wsToAgentId.get(ws);
    if (agentId) {
      this.unregisterAgent(agentId);
    }
  }

  private unregisterAgent(agentId: string): void {
    const entry = this.agents.get(agentId);
    if (!entry) return;

    this.agents.delete(agentId);
    this.wsToAgentId.delete(entry.ws);

    console.log(`❌ Agent left: ${entry.info.name} (${agentId})`);
    if (!this.shuttingDown) {
      this.broadcast(makeMessage("hub.peer.leave", "hub", { agentId }), agentId);
    }
  }

  // ── 心跳检查 ──
  private checkHeartbeats(): void {
    const now = Date.now();
    for (const [agentId, { info, ws }] of this.agents) {
      const lastBeat = new Date(info.lastHeartbeat).getTime();
      if (now - lastBeat > HEARTBEAT_TIMEOUT_MS) {
        console.warn(`⏰ Agent ${info.name} (${agentId}) heartbeat timeout, disconnecting`);
        try {
          ws.close(1001, "Heartbeat timeout");
        } catch { /* ignore */ }
        this.unregisterAgent(agentId);
      }
    }
  }

  // ── HTTP 请求处理 ──
  private handleHttpRequest(req: IncomingMessage, res: any): void {
    const url = req.url ?? "/";
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    if (url === "/health") {
      res.writeHead(200);
      res.end(JSON.stringify({ status: "ok", agentCount: this.agents.size }));
    } else if (url === "/agents") {
      res.writeHead(200);
      res.end(JSON.stringify({ agents: this.getAgentList() }));
    } else if (url === "/") {
      res.writeHead(200);
      res.end(JSON.stringify({
        service: "CoAgent Hub",
        version: "0.1.0",
        agents: this.agents.size,
        endpoints: ["GET /health", "GET /agents", "GET /", "WS /"],
      }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Not found" }));
    }
  }

  // ── 工具方法 ──

  private send(ws: WebSocket, msg: HubMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private sendError(ws: WebSocket, code: string, message: string): void {
    this.send(ws, makeMessage("hub.error", "hub", { code, message }));
  }

  private broadcast(msg: HubMessage, excludeAgentId?: string): void {
    for (const [id, { ws }] of this.agents) {
      if (id !== excludeAgentId) {
        this.send(ws, msg);
      }
    }
  }
}

/** 启动 Hub 服务（便捷入口） */
export async function startHub(options?: HubOptions): Promise<Hub> {
  const hub = new Hub(options);
  await hub.start();
  return hub;
}
