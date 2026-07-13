// CoAgent Hub — Agent 客户端 SDK
// 供每个 CoAgent CLI 实例连接 Hub、注册、收发消息

import { EventEmitter } from "node:events";
import { type AgentInfo, type AgentStatus, type HubMessage, makeMessage, nowIso, defaultProfile } from "./types.js";

const DEFAULT_HUB_URL = "ws://127.0.0.1:4876";
const HEARTBEAT_INTERVAL_MS = 10_000;  // 每 10s 发一次心跳
const RECONNECT_DELAY_MS = 3_000;      // 断线重连间隔
const MAX_RECONNECT_ATTEMPTS = 10;

export interface AgentOptions {
  hubUrl?: string;
  name?: string;
  projectDir?: string;
  role?: string;
  goal?: string;
  capabilities?: string[];
  autoReconnect?: boolean;
}

export interface AgentMessage {
  from: string;
  text: string;
  context?: Record<string, unknown>;
}

export type HubEvent =
  | "connected"
  | "disconnected"
  | "error"
  | "registered"
  | "peer.join"
  | "peer.leave"
  | "peer.update"
  | "message"
  | "reconnecting";

export class AgentClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private readonly hubUrl: string;
  private readonly options: Required<AgentOptions>;
  private agentId: string = "";
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  constructor(options: AgentOptions = {}) {
    super();
    this.options = {
      hubUrl: options.hubUrl ?? DEFAULT_HUB_URL,
      name: options.name ?? `agent-${process.pid}`,
      projectDir: options.projectDir ?? process.cwd(),
      role: options.role ?? "general",
      goal: options.goal ?? "",
      capabilities: options.capabilities ?? [],
      autoReconnect: options.autoReconnect ?? true,
    };
    this.hubUrl = this.options.hubUrl;
  }

  get id(): string {
    return this.agentId;
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** 连接到 Hub，等待注册确认后 resolve */
  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(this.hubUrl);
        let settled = false;

        ws.onopen = () => {
          this.ws = ws;
          this.reconnectAttempts = 0;
          this.emit("connected");

          this.sendHub(makeMessage("agent.register", "self", {
            name: this.options.name,
            projectDir: this.options.projectDir,
            role: this.options.role,
            goal: this.options.goal,
            capabilities: this.options.capabilities,
          }));

          this.startHeartbeat();
        };

        ws.onerror = (event) => {
          const err = new Error(`WebSocket connection failed to ${this.hubUrl}`);
          if (!this.ws && !settled) {
            settled = true;
            reject(err);
          }
          this.emit("error", err);
        };

        ws.onclose = (event) => {
          this.ws = null;
          this.stopHeartbeat();
          this.emit("disconnected", event.code, event.reason);

          if (!this.intentionalClose && this.options.autoReconnect) {
            this.scheduleReconnect();
          }
        };

        ws.onmessage = (event) => {
          try {
            const msg: HubMessage = JSON.parse(event.data as string);
            this.handleMessage(msg);

            if (msg.type === "hub.registered" && !settled) {
              settled = true;
              resolve();
            }
          } catch (err) {
            this.emit("error", new Error(`Failed to parse hub message: ${err}`));
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /** 断开连接 */
  async disconnect(): Promise<void> {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connected) {
      this.sendHub(makeMessage("agent.unregister", this.agentId, {}));
    }
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, "Agent shutting down");
      this.ws = null;
    }
  }

  /** 更新状态 */
  updateStatus(status: AgentStatus, task?: string): void {
    this._currentStatus = status;
    if (task !== undefined) this._currentTask = task;
    this.sendHub(makeMessage("agent.update", this.agentId, {
      status,
      currentTask: task,
    }));
  }

  /** 更新目标 */
  updateGoal(goal: string): void {
    this.sendHub(makeMessage("agent.update", this.agentId, {
      goal,
    }));
  }

  /** 更新当前任务（用于心跳） */
  updateTask(task: string): void {
    this._currentTask = task;
    this.sendHub(makeMessage("agent.update", this.agentId, {
      currentTask: task,
    }));
  }

  /** 发送消息给指定 agent */
  sendToAgent(agentId: string, text: string, context?: Record<string, unknown>): void {
    this.sendHub(makeMessage("agent.message", this.agentId, {
      to: agentId,
      text,
      context,
    }));
  }

  /** 广播给所有 agent */
  broadcast(text: string, topic?: string): void {
    this.sendHub(makeMessage("agent.broadcast", this.agentId, {
      text,
      topic,
    }));
  }

  /** 获取当前连接的 peers 列表（由注册时 hub 返回） */
  private peers: AgentInfo[] = [];

  get peerList(): AgentInfo[] {
    return this.peers;
  }

  // ───────────── 内部方法 ─────────────

  private sendHub(msg: HubMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleMessage(msg: HubMessage): void {
    switch (msg.type) {
      case "hub.registered": {
        this.agentId = msg.payload.agentId;
        this.peers = msg.payload.peers || [];
        this.emit("registered", { agentId: this.agentId, peers: this.peers });
        break;
      }
      case "hub.peer.join": {
        const newPeer: AgentInfo = msg.payload.agent;
        // 替换或添加
        const idx = this.peers.findIndex((p) => p.id === newPeer.id);
        if (idx >= 0) {
          this.peers[idx] = newPeer;
        } else {
          this.peers.push(newPeer);
        }
        this.emit("peer.join", newPeer);
        break;
      }
      case "hub.peer.leave": {
        const leftId = msg.payload.agentId as string;
        this.peers = this.peers.filter((p) => p.id !== leftId);
        this.emit("peer.leave", leftId);
        break;
      }
      case "hub.peer.update": {
        const { agentId, status, goal, currentTask } = msg.payload;
        const peer = this.peers.find((p) => p.id === agentId);
        if (peer) {
          if (status) peer.status = status;
          if (goal !== undefined) peer.goal = goal;
          if (currentTask !== undefined) peer.currentTask = currentTask;
        }
        this.emit("peer.update", { agentId, status, goal, currentTask });
        break;
      }
      case "hub.message": {
        this.emit("message", {
          from: msg.from,
          text: msg.payload.text,
          context: msg.payload.context,
        } as AgentMessage);
        break;
      }
      case "hub.error": {
        this.emit("error", new Error(`Hub error: ${msg.payload.code} - ${msg.payload.message}`));
        break;
      }
    }
  }

  private _currentStatus: AgentStatus = "online";
  private _currentTask: string = "";

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendHub(makeMessage("agent.heartbeat", this.agentId, {
        status: this._currentStatus,
        currentTask: this._currentTask,
      }));
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.emit("error", new Error(`Failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts`));
      return;
    }
    this.reconnectAttempts++;
    this.emit("reconnecting", this.reconnectAttempts, MAX_RECONNECT_ATTEMPTS);
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {});
    }, RECONNECT_DELAY_MS);
  }
}
