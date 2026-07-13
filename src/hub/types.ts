// CoAgent Hub — 共享类型定义
import { randomBytes } from "node:crypto";

// ─────────────── 消息协议 ───────────────

export type HubMessageType =
  // Agent → Hub
  | "agent.register"
  | "agent.heartbeat"
  | "agent.update"
  | "agent.message"
  | "agent.broadcast"
  | "agent.unregister"
  // Hub → Agent
  | "hub.registered"
  | "hub.peer.join"
  | "hub.peer.leave"
  | "hub.peer.update"
  | "hub.message"
  | "hub.error";

export interface HubMessage {
  type: HubMessageType;
  from: string;
  to?: string;          // 目标 agentId，空则为广播
  id: string;
  timestamp: string;
  payload: any;
}

// ─────────────── Agent 模型 ───────────────

export type AgentStatus = "online" | "busy" | "idle" | "offline";

export interface AgentProfile {
  totalSessions: number;
  totalMessagesSent: number;
  totalMessagesReceived: number;
  commonTasks: string[];
  expertise: string[];
  preferredTools: string[];
}

export interface AgentInfo {
  id: string;
  name: string;
  projectDir: string;
  role: string;
  status: AgentStatus;
  currentTask: string;
  goal: string;
  capabilities: string[];
  connectedAt: string;
  lastHeartbeat: string;
  profile: AgentProfile;
}

// ─────────────── 状态载荷 ───────────────

export interface RegisterPayload {
  name: string;
  projectDir: string;
  role: string;
  goal: string;
  capabilities: string[];
}

export interface HeartbeatPayload {
  status: AgentStatus;
  currentTask: string;
}

export interface UpdatePayload {
  status?: AgentStatus;
  goal?: string;
  currentTask?: string;
}

export interface MessagePayload {
  to: string;
  text: string;
  context?: Record<string, unknown>;
}

export interface BroadcastPayload {
  text: string;
  topic?: string;
}

// ─────────────── 工具函数 ───────────────

const FRUITS = [
  "Apple", "Apricot", "Avocado", "Banana", "Blackberry", "Blueberry",
  "Cherry", "Coconut", "Cranberry", "Dragonfruit", "Durian", "Fig",
  "Grape", "Grapefruit", "Guava", "Kiwi", "Lemon", "Lime",
  "Mango", "Melon", "Nectarine", "Orange", "Papaya", "Peach",
  "Pear", "Persimmon", "Pineapple", "Plum", "Pomegranate", "Raspberry",
  "Strawberry", "Tangerine", "Watermelon", "Yuzu",
  "Artichoke", "Broccoli", "Cabbage", "Carrot", "Cauliflower",
  "Celery", "Corn", "Cucumber", "Eggplant", "Garlic", "Ginger",
  "Kale", "Leek", "Lettuce", "Mushroom", "Onion", "Pepper",
  "Potato", "Pumpkin", "Radish", "Spinach", "Squash", "Tomato",
  "Turnip", "Zucchini",
];

const ADJECTIVES = [
  "Brave", "Calm", "Clever", "Curious", "Daring", "Eager",
  "Gentle", "Happy", "Honest", "Kind", "Lively", "Noble",
  "Patient", "Quick", "Quiet", "Radiant", "Swift", "Warm",
  "Wise", "Zen",
];

export function generateFruitName(): string {
  const adj = ADJECTIVES[randomBytes(1)[0] % ADJECTIVES.length];
  const fruit = FRUITS[randomBytes(1)[0] % FRUITS.length];
  return `${adj}${fruit}`;
}

export function newAgentId(): string {
  return `agent_${randomBytes(4).toString("hex")}`;
}

export function newMessageId(): string {
  return `msg_${randomBytes(6).toString("hex")}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function defaultProfile(): AgentProfile {
  return {
    totalSessions: 0,
    totalMessagesSent: 0,
    totalMessagesReceived: 0,
    commonTasks: [],
    expertise: [],
    preferredTools: [],
  };
}

export function makeMessage(
  type: HubMessageType,
  from: string,
  payload: any,
  to?: string,
): HubMessage {
  return {
    type,
    from,
    to,
    id: newMessageId(),
    timestamp: nowIso(),
    payload,
  };
}
