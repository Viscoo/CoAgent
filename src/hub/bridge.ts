// CoAgent Hub — 桥接层
// 把 Orchestrator 的进度事件上报到 Hub，并维护 peers 视图，
// 让每个 CLI 窗口都能看到其他 Agent 在做什么。

import { AgentClient, type AgentMessage } from "./client.js";
import { type AgentInfo, type AgentStatus } from "./types.js";
import { type ProgressEvent } from "../core/types.js";

const HUB_HTTP_URL = "http://127.0.0.1:4876";
const HUB_WS_URL = "ws://127.0.0.1:4876";
const HEALTH_TIMEOUT_MS = 1000;

export interface HubBridgeOptions {
  cwd: string;
  role?: string;
  goal?: string;
  name?: string;
  capabilities?: string[];
  hubUrl?: string;
}

export interface PeerView {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  currentTask: string;
  goal: string;
  projectDir: string;
}

export class HubBridge {
  readonly client: AgentClient | null;
  readonly connected: boolean;
  private readonly peers = new Map<string, PeerView>();
  private readonly listeners = new Set<() => void>();

  private constructor(client: AgentClient | null) {
    this.client = client;
    this.connected = client !== null;
    if (client) {
      client.on("registered", (info: { agentId: string; peers: AgentInfo[] }) => {
        this.peers.clear();
        for (const peer of info.peers) HubBridge.upsertInto(this.peers, peer);
        this.notify();
      });
      client.on("peer.join", (agent: AgentInfo) => this.upsertPeer(agent));
      client.on("peer.update", (payload: { agentId: string; status?: AgentStatus; goal?: string; currentTask?: string }) => {
        const peer = this.peers.get(payload.agentId);
        if (peer) {
          if (payload.status) peer.status = payload.status;
          if (payload.goal !== undefined) peer.goal = payload.goal;
          if (payload.currentTask !== undefined) peer.currentTask = payload.currentTask;
          this.notify();
        }
      });
      client.on("peer.leave", (agentId: string) => {
        this.peers.delete(agentId);
        this.notify();
      });
      client.on("message", (msg: AgentMessage) => this.notify());
    }
  }

  /** 探测 Hub 是否在线；在线则注册并返回 bridge，否则返回空 bridge（best-effort） */
  static async connect(options: HubBridgeOptions): Promise<HubBridge> {
    const httpUrl = options.hubUrl ?? HUB_HTTP_URL;
    const wsUrl = options.hubUrl ? options.hubUrl.replace(/^http/, "ws") : HUB_WS_URL;
    try {
      const res = await fetch(`${httpUrl}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      if (!res.ok) return new HubBridge(null);
    } catch {
      return new HubBridge(null);
    }
    try {
      const client = new AgentClient({
        hubUrl: wsUrl,
        name: options.name,
        projectDir: options.cwd,
        role: options.role ?? "general",
        goal: options.goal ?? "",
        capabilities: options.capabilities ?? ["opencode", "coagent"],
      });
      await client.connect();
      const bridge = new HubBridge(client);
      // hub.registered 已把初始 peers 写入 client.peerList，补齐 bridge 缓存
      for (const peer of client.peerList) {
        HubBridge.upsertInto(bridge.peers, peer);
      }
      return bridge;
    } catch {
      return new HubBridge(null);
    }
  }

  private static upsertInto(map: Map<string, PeerView>, agent: AgentInfo): void {
    map.set(agent.id, {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      status: agent.status,
      currentTask: agent.currentTask,
      goal: agent.goal,
      projectDir: agent.projectDir,
    });
  }

  private upsertPeer(agent: AgentInfo): void {
    HubBridge.upsertInto(this.peers, agent);
    this.notify();
  }

  /** 上报 Orchestrator 进度事件 → Hub 状态/任务 */
  reportProgress(event: ProgressEvent): void {
    if (!this.client) return;
    const role = event.role ?? "coagent";
    const title = event.title ?? "";
    switch (event.kind) {
      case "task-start":
        this.client.updateStatus("busy", title ? `${role}: ${title}` : `${role} working`);
        break;
      case "task-retry":
        this.client.updateStatus("busy", `${role}: ${title} (retry ${event.attempt ?? ""}/${event.maxAttempts ?? ""})`);
        break;
      case "task-complete":
        this.client.updateStatus("idle", title ? `${role}: ${title} ✓` : "");
        break;
      case "task-fail":
        this.client.updateStatus("idle", title ? `${role}: ${title} ✗` : "");
        break;
      case "run-status":
        this.client.updateTask(event.message);
        break;
      default:
        break;
    }
  }

  /** 更新自己的 goal */
  updateGoal(goal: string): void {
    this.client?.updateGoal(goal);
  }

  /** 订阅 peers 变化（join/update/leave/message） */
  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  /** 当前 peers 快照（含自己之外的 agent） */
  get peerList(): PeerView[] {
    return [...this.peers.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get selfName(): string {
    return this.client?.name ?? "";
  }

  async dispose(): Promise<void> {
    if (this.client?.connected) {
      this.client.updateStatus("idle", "");
      await this.client.disconnect();
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
