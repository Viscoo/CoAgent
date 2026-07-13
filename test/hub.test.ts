import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { WebSocket } from "ws";
import { Hub, startHub } from "../src/hub/server.js";
import { AgentClient } from "../src/hub/client.js";
import {
  type HubMessage,
  type AgentInfo,
  makeMessage,
  newAgentId,
  newMessageId,
  nowIso,
  defaultProfile,
} from "../src/hub/types.js";

let nextPort = 34876;
function getPort(): number {
  return nextPort++;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForEvent(emitter: AgentClient, event: string, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for event: ${event}`)), timeoutMs);
    emitter.once(event, (...args: any[]) => {
      clearTimeout(timer);
      resolve(args.length <= 1 ? args[0] : args);
    });
  });
}

function waitForWsMessage(ws: WebSocket, type: string, timeoutMs = 5000): Promise<HubMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for WS message: ${type}`)), timeoutMs);
    function handler(raw: any) {
      const msg: HubMessage = JSON.parse(raw.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(msg);
      }
    }
    ws.on("message", handler);
  });
}

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", (err) => reject(err));
  });
}

async function registerWs(ws: WebSocket, name: string): Promise<string> {
  const regPromise = waitForWsMessage(ws, "hub.registered");
  ws.send(JSON.stringify(makeMessage("agent.register", "self", {
    name, projectDir: "/tmp", role: "general", goal: "", capabilities: [],
  })));
  const msg = await regPromise;
  return msg.payload.agentId;
}

async function connectClient(hubUrl: string, name: string, opts?: { autoReconnect?: boolean }): Promise<{ client: AgentClient; registered: any }> {
  const client = new AgentClient({
    hubUrl,
    name,
    projectDir: "/tmp",
    role: "general",
    goal: "",
    capabilities: [],
    autoReconnect: opts?.autoReconnect ?? false,
  });
  const regPromise = waitForEvent(client, "registered");
  await client.connect();
  const registered = await regPromise;
  return { client, registered };
}

// ──────────────── Types 工具函数测试 ────────────────

describe("Hub Types — 工具函数", () => {
  test("newAgentId 生成 agent_ 前缀 ID", () => {
    const id = newAgentId();
    expect(id.startsWith("agent_")).toBe(true);
    expect(id.length).toBeGreaterThan(6);
  });

  test("newAgentId 每次生成不同 ID", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newAgentId()));
    expect(ids.size).toBe(100);
  });

  test("newMessageId 生成 msg_ 前缀 ID", () => {
    const id = newMessageId();
    expect(id.startsWith("msg_")).toBe(true);
  });

  test("nowIso 返回有效 ISO 8601 时间戳", () => {
    const ts = nowIso();
    expect(() => new Date(ts)).not.toThrow();
    expect(new Date(ts).getTime()).toBeLessThanOrEqual(Date.now());
  });

  test("defaultProfile 返回空 profile", () => {
    const p = defaultProfile();
    expect(p.totalSessions).toBe(0);
    expect(p.totalMessagesSent).toBe(0);
    expect(p.totalMessagesReceived).toBe(0);
    expect(p.commonTasks).toEqual([]);
    expect(p.expertise).toEqual([]);
    expect(p.preferredTools).toEqual([]);
  });

  test("makeMessage 构造标准消息", () => {
    const msg = makeMessage("agent.register", "agent_123", { name: "test" });
    expect(msg.type).toBe("agent.register");
    expect(msg.from).toBe("agent_123");
    expect(msg.payload).toEqual({ name: "test" });
    expect(msg.id.startsWith("msg_")).toBe(true);
    expect(msg.timestamp).toBeTruthy();
    expect(msg.to).toBeUndefined();
  });

  test("makeMessage 支持 to 参数", () => {
    const msg = makeMessage("agent.message", "agent_1", { text: "hi" }, "agent_2");
    expect(msg.to).toBe("agent_2");
  });
});

// ──────────────── Hub 服务端测试 ────────────────

describe("Hub 服务端", () => {
  let hub: Hub;
  let port: number;

  beforeAll(async () => {
    port = getPort();
    hub = new Hub({ port, host: "127.0.0.1" });
    await hub.start();
  });

  afterAll(async () => {
    await hub.stop();
  });

  const httpUrl = () => `http://127.0.0.1:${port}`;

  describe("HTTP 端点", () => {
    test("GET / 返回服务信息", async () => {
      const res = await fetch(httpUrl());
      const data = await res.json();
      expect(data.service).toBe("CoAgent Hub");
      expect(data.endpoints).toContain("GET /health");
    });

    test("GET /health 返回健康状态", async () => {
      const res = await fetch(`${httpUrl()}/health`);
      const data = await res.json();
      expect(data.status).toBe("ok");
      expect(typeof data.agentCount).toBe("number");
    });

    test("GET /agents 返回列表", async () => {
      const res = await fetch(`${httpUrl()}/agents`);
      const data = await res.json();
      expect(Array.isArray(data.agents)).toBe(true);
    });

    test("GET /unknown 返回 404", async () => {
      const res = await fetch(`${httpUrl()}/unknown`);
      expect(res.status).toBe(404);
    });
  });

  describe("Agent 注册", () => {
    test("注册成功后收到 hub.registered 消息", async () => {
      const ws = await connectWs(port);
      ws.send(JSON.stringify(makeMessage("agent.register", "self", {
        name: "test-agent", projectDir: "/tmp/project", role: "tester", goal: "testing", capabilities: ["test"],
      })));
      const msg = await waitForWsMessage(ws, "hub.registered");
      expect(msg.payload.agentId.startsWith("agent_")).toBe(true);
      expect(msg.payload.peers).toEqual([]);
      ws.close();
      await sleep(100);
    });

    test("注册后 Hub 内部维护 agent 列表", async () => {
      const ws = await connectWs(port);
      await registerWs(ws, "list-test-agent");
      await sleep(100);
      const agents = hub.getAgentList();
      expect(agents.find((a) => a.name === "list-test-agent")).toBeTruthy();
      ws.close();
      await sleep(200);
    });

    test("多个 agent 注册时 peers 列表正确", async () => {
      const ws1 = await connectWs(port);
      const ws2 = await connectWs(port);
      await registerWs(ws1, "peer-a");
      await sleep(100);
      ws2.send(JSON.stringify(makeMessage("agent.register", "self", {
        name: "peer-b", projectDir: "/b", role: "b", goal: "", capabilities: [],
      })));
      const msg = await waitForWsMessage(ws2, "hub.registered");
      expect(msg.payload.peers.map((p: any) => p.name)).toContain("peer-a");
      ws1.close();
      ws2.close();
      await sleep(200);
    });
  });

  describe("心跳", () => {
    test("心跳更新 lastHeartbeat 和状态", async () => {
      const ws = await connectWs(port);
      const agentId = await registerWs(ws, "heartbeat-agent");
      await sleep(100);
      const before = hub.getAgent(agentId)?.lastHeartbeat;
      await sleep(50);
      ws.send(JSON.stringify(makeMessage("agent.heartbeat", agentId, { status: "busy", currentTask: "working" })));
      await sleep(200);
      expect(hub.getAgent(agentId)?.lastHeartbeat).not.toBe(before);
      expect(hub.getAgent(agentId)?.status).toBe("busy");
      expect(hub.getAgent(agentId)?.currentTask).toBe("working");
      ws.close();
      await sleep(200);
    });

    test("心跳状态变更时广播 hub.peer.update", async () => {
      const ws1 = await connectWs(port);
      const ws2 = await connectWs(port);
      const agent1Id = await registerWs(ws1, "hb-bcast-1");
      await sleep(100);
      await registerWs(ws2, "hb-bcast-2");
      await sleep(100);
      const updatePromise = waitForWsMessage(ws2, "hub.peer.update");
      ws1.send(JSON.stringify(makeMessage("agent.heartbeat", agent1Id, { status: "busy", currentTask: "new task" })));
      const update = await updatePromise;
      expect(update.payload.status).toBe("busy");
      ws1.close();
      ws2.close();
      await sleep(200);
    });
  });

  describe("状态更新 (agent.update)", () => {
    test("更新 goal 和 currentTask", async () => {
      const ws = await connectWs(port);
      const agentId = await registerWs(ws, "update-agent");
      await sleep(100);
      ws.send(JSON.stringify(makeMessage("agent.update", agentId, { status: "busy", goal: "new goal", currentTask: "implementing" })));
      await sleep(200);
      expect(hub.getAgent(agentId)?.status).toBe("busy");
      expect(hub.getAgent(agentId)?.goal).toBe("new goal");
      expect(hub.getAgent(agentId)?.currentTask).toBe("implementing");
      ws.close();
      await sleep(200);
    });

    test("状态变更时广播 hub.peer.update", async () => {
      const ws1 = await connectWs(port);
      const ws2 = await connectWs(port);
      const agent1Id = await registerWs(ws1, "upd-1");
      await sleep(100);
      await registerWs(ws2, "upd-2");
      await sleep(100);
      const updatePromise = waitForWsMessage(ws2, "hub.peer.update");
      ws1.send(JSON.stringify(makeMessage("agent.update", agent1Id, { status: "idle", goal: "updated goal" })));
      const update = await updatePromise;
      expect(update.payload.status).toBe("idle");
      expect(update.payload.goal).toBe("updated goal");
      ws1.close();
      ws2.close();
      await sleep(200);
    });

    test("无变更时不广播", async () => {
      const ws = await connectWs(port);
      const agentId = await registerWs(ws, "no-change-agent");
      await sleep(100);
      const otherWs = await connectWs(port);
      await registerWs(otherWs, "no-change-observer");
      await sleep(100);
      let gotUpdate = false;
      otherWs.on("message", (raw) => {
        const msg: HubMessage = JSON.parse(raw.toString());
        if (msg.type === "hub.peer.update" && msg.payload.agentId === agentId) gotUpdate = true;
      });
      ws.send(JSON.stringify(makeMessage("agent.update", agentId, {})));
      await sleep(300);
      expect(gotUpdate).toBe(false);
      ws.close();
      otherWs.close();
      await sleep(200);
    });
  });

  describe("私信 (agent.message)", () => {
    test("Agent A 可以给 Agent B 发私信", async () => {
      const ws1 = await connectWs(port);
      const ws2 = await connectWs(port);
      const agent1Id = await registerWs(ws1, "dm-a");
      await sleep(100);
      const agent2Id = await registerWs(ws2, "dm-b");
      await sleep(100);
      const msgPromise = waitForWsMessage(ws2, "hub.message");
      ws1.send(JSON.stringify(makeMessage("agent.message", agent1Id, { to: agent2Id, text: "Hello B!", context: { key: "value" } })));
      const msg = await msgPromise;
      expect(msg.from).toBe(agent1Id);
      expect(msg.payload.text).toBe("Hello B!");
      expect(msg.payload.context).toEqual({ key: "value" });
      ws1.close();
      ws2.close();
      await sleep(200);
    });

    test("发给不存在的 agent 返回错误", async () => {
      const ws = await connectWs(port);
      const agentId = await registerWs(ws, "dm-error");
      await sleep(100);
      const errorPromise = waitForWsMessage(ws, "hub.error");
      ws.send(JSON.stringify(makeMessage("agent.message", agentId, { to: "agent_nonexistent", text: "test" })));
      const err = await errorPromise;
      expect(err.payload.code).toBe("agent_not_found");
      ws.close();
      await sleep(200);
    });

    test("缺少目标 agentId 返回错误", async () => {
      const ws = await connectWs(port);
      const agentId = await registerWs(ws, "dm-no-target");
      await sleep(100);
      const errorPromise = waitForWsMessage(ws, "hub.error");
      ws.send(JSON.stringify(makeMessage("agent.message", agentId, { text: "no target" })));
      const err = await errorPromise;
      expect(err.payload.code).toBe("missing_target");
      ws.close();
      await sleep(200);
    });

    test("私信更新双方消息计数", async () => {
      const ws1 = await connectWs(port);
      const ws2 = await connectWs(port);
      const agent1Id = await registerWs(ws1, "count-a");
      await sleep(100);
      const agent2Id = await registerWs(ws2, "count-b");
      await sleep(100);
      ws1.send(JSON.stringify(makeMessage("agent.message", agent1Id, { to: agent2Id, text: "msg1" })));
      await sleep(200);
      expect(hub.getAgent(agent1Id)?.profile.totalMessagesSent).toBe(1);
      expect(hub.getAgent(agent2Id)?.profile.totalMessagesReceived).toBe(1);
      ws1.close();
      ws2.close();
      await sleep(200);
    });
  });

  describe("广播 (agent.broadcast)", () => {
    test("广播消息发给除自己外的所有 agent", async () => {
      const ws1 = await connectWs(port);
      const ws2 = await connectWs(port);
      const ws3 = await connectWs(port);
      const agent1Id = await registerWs(ws1, "bc-1");
      await sleep(100);
      await registerWs(ws2, "bc-2");
      await sleep(100);
      await registerWs(ws3, "bc-3");
      await sleep(200);
      const msg2Promise = waitForWsMessage(ws2, "hub.message");
      const msg3Promise = waitForWsMessage(ws3, "hub.message");
      ws1.send(JSON.stringify(makeMessage("agent.broadcast", agent1Id, { text: "broadcast!", topic: "test" })));
      const [msg2, msg3] = await Promise.all([msg2Promise, msg3Promise]);
      expect(msg2.payload.text).toBe("broadcast!");
      expect(msg3.payload.text).toBe("broadcast!");
      ws1.close();
      ws2.close();
      ws3.close();
      await sleep(200);
    });

    test("广播者自己不会收到广播消息", async () => {
      const ws1 = await connectWs(port);
      const ws2 = await connectWs(port);
      const agent1Id = await registerWs(ws1, "bc-self-1");
      await sleep(100);
      await registerWs(ws2, "bc-self-2");
      await sleep(100);
      let ws1GotBroadcast = false;
      ws1.on("message", (raw) => {
        const msg: HubMessage = JSON.parse(raw.toString());
        if (msg.type === "hub.message" && msg.payload.text === "bc-test!") ws1GotBroadcast = true;
      });
      ws1.send(JSON.stringify(makeMessage("agent.broadcast", agent1Id, { text: "bc-test!" })));
      await sleep(300);
      expect(ws1GotBroadcast).toBe(false);
      ws1.close();
      ws2.close();
      await sleep(200);
    });
  });

  describe("Agent 下线", () => {
    test("主动下线广播 hub.peer.leave", async () => {
      const ws1 = await connectWs(port);
      const ws2 = await connectWs(port);
      const agent1Id = await registerWs(ws1, "leave-1");
      await sleep(100);
      await registerWs(ws2, "leave-2");
      await sleep(100);
      const leavePromise = waitForWsMessage(ws2, "hub.peer.leave");
      ws1.send(JSON.stringify(makeMessage("agent.unregister", agent1Id, {})));
      const msg = await leavePromise;
      expect(msg.payload.agentId).toBe(agent1Id);
      ws2.close();
      await sleep(200);
    });

    test("WebSocket 断开时自动下线", async () => {
      const ws1 = await connectWs(port);
      const ws2 = await connectWs(port);
      const agent1Id = await registerWs(ws1, "dc-1");
      await sleep(100);
      await registerWs(ws2, "dc-2");
      await sleep(100);
      const leavePromise = waitForWsMessage(ws2, "hub.peer.leave");
      ws1.close();
      const msg = await leavePromise;
      expect(msg.payload.agentId).toBe(agent1Id);
      ws2.close();
      await sleep(200);
    });

    test("下线后 Hub 不再包含该 agent", async () => {
      const ws = await connectWs(port);
      const agentId = await registerWs(ws, "gone-agent");
      await sleep(100);
      expect(hub.getAgent(agentId)).toBeTruthy();
      ws.close();
      await sleep(300);
      expect(hub.getAgent(agentId)).toBeUndefined();
    });
  });

  describe("错误处理", () => {
    test("发送无效 JSON 返回错误", async () => {
      const ws = await connectWs(port);
      const errPromise = waitForWsMessage(ws, "hub.error");
      ws.send("not valid json {{{");
      const err = await errPromise;
      expect(err.payload.code).toBe("parse_error");
      ws.close();
      await sleep(100);
    });

    test("发送未知消息类型返回错误", async () => {
      const ws = await connectWs(port);
      const errPromise = waitForWsMessage(ws, "hub.error");
      ws.send(JSON.stringify({ type: "unknown.type", from: "test", id: "1", timestamp: nowIso(), payload: {} }));
      const err = await errPromise;
      expect(err.payload.code).toBe("unknown_type");
      ws.close();
      await sleep(100);
    });
  });

  describe("Hub 启停", () => {
    test("startHub 便捷函数返回 Hub 实例", async () => {
      const p = getPort();
      const testHub = await startHub({ port: p, host: "127.0.0.1" });
      expect(testHub).toBeInstanceOf(Hub);
      const res = await fetch(`http://127.0.0.1:${p}/health`);
      expect((await res.json()).status).toBe("ok");
      await testHub.stop();
    });

    test("Hub stop 关闭所有连接", async () => {
      const p = getPort();
      const testHub = await startHub({ port: p, host: "127.0.0.1" });
      const ws = await connectWs(p);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      await testHub.stop();
      await sleep(300);
      expect(ws.readyState).not.toBe(WebSocket.OPEN);
    });
  });
});

// ──────────────── AgentClient 客户端测试 ────────────────

describe("AgentClient 客户端", () => {
  let hub: Hub;
  let port: number;
  let hubUrl: string;

  beforeAll(async () => {
    port = getPort();
    hub = new Hub({ port, host: "127.0.0.1" });
    await hub.start();
    hubUrl = `ws://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await hub.stop();
  });

  test("connect 连接 Hub 并触发 registered 事件", async () => {
    const { client, registered } = await connectClient(hubUrl, "client-test-1");
    expect(registered.agentId.startsWith("agent_")).toBe(true);
    expect(client.id).toBeTruthy();
    await client.disconnect();
  });

  test("connect 后 connected 属性为 true", async () => {
    const { client } = await connectClient(hubUrl, "conn-check");
    expect(client.connected).toBe(true);
    await client.disconnect();
  });

  test("disconnect 后 connected 属性为 false", async () => {
    const { client } = await connectClient(hubUrl, "disc-check");
    await client.disconnect();
    await sleep(100);
    expect(client.connected).toBe(false);
  });

  test("disconnect 触发 disconnected 事件", async () => {
    const { client } = await connectClient(hubUrl, "disc-event");
    const disconnected = waitForEvent(client, "disconnected");
    await client.disconnect();
    await disconnected;
  });

  test("注册后 peerList 包含已存在的 agent", async () => {
    const { client: client1 } = await connectClient(hubUrl, "peer-1");
    await sleep(100);
    const { registered } = await connectClient(hubUrl, "peer-2");
    expect(registered.peers.length).toBeGreaterThanOrEqual(1);
    expect(registered.peers.map((p: AgentInfo) => p.name)).toContain("peer-1");
    await client1.disconnect();
  });

  test("新 agent 上线触发 peer.join 事件", async () => {
    const { client: client1 } = await connectClient(hubUrl, "join-1");
    await sleep(100);
    const joinPromise = waitForEvent(client1, "peer.join");
    const { client: client2 } = await connectClient(hubUrl, "join-2");
    const newPeer = await joinPromise;
    expect(newPeer.name).toBe("join-2");
    await client1.disconnect();
    await client2.disconnect();
  });

  test("agent 下线触发 peer.leave 事件", async () => {
    const { client: client1, registered: reg1 } = await connectClient(hubUrl, "leave-1");
    const { client: client2, registered: reg2 } = await connectClient(hubUrl, "leave-2");
    await sleep(100);
    const leavePromise = waitForEvent(client1, "peer.leave");
    await client2.disconnect();
    const leftId = await leavePromise;
    expect(leftId).toBe(reg2.agentId);
    await client1.disconnect();
  });

  test("sendToAgent 发送私信", async () => {
    const { client: client1, registered: reg1 } = await connectClient(hubUrl, "dm-1");
    const { client: client2, registered: reg2 } = await connectClient(hubUrl, "dm-2");
    await sleep(100);
    const msgPromise = waitForEvent(client2, "message");
    client1.sendToAgent(reg2.agentId, "Hello from client1!", { key: "val" });
    const msg = await msgPromise;
    expect(msg.from).toBe(reg1.agentId);
    expect(msg.text).toBe("Hello from client1!");
    expect(msg.context).toEqual({ key: "val" });
    await client1.disconnect();
    await client2.disconnect();
  });

  test("broadcast 广播消息", async () => {
    const { client: client1 } = await connectClient(hubUrl, "bc-1");
    const { client: client2 } = await connectClient(hubUrl, "bc-2");
    const { client: client3 } = await connectClient(hubUrl, "bc-3");
    await sleep(200);
    const msg2Promise = waitForEvent(client2, "message");
    const msg3Promise = waitForEvent(client3, "message");
    client1.broadcast("Broadcast message!", "test-topic");
    const [msg2, msg3] = await Promise.all([msg2Promise, msg3Promise]);
    expect(msg2.text).toBe("Broadcast message!");
    expect(msg3.text).toBe("Broadcast message!");
    await client1.disconnect();
    await client2.disconnect();
    await client3.disconnect();
  });

  test("updateStatus 更新状态", async () => {
    const { client, registered: reg } = await connectClient(hubUrl, "status-upd");
    await sleep(100);
    client.updateStatus("busy", "working on tests");
    await sleep(200);
    expect(hub.getAgent(reg.agentId)?.status).toBe("busy");
    expect(hub.getAgent(reg.agentId)?.currentTask).toBe("working on tests");
    await client.disconnect();
  });

  test("updateGoal 更新目标", async () => {
    const { client, registered: reg } = await connectClient(hubUrl, "goal-upd");
    await sleep(100);
    client.updateGoal("new goal");
    await sleep(200);
    expect(hub.getAgent(reg.agentId)?.goal).toBe("new goal");
    await client.disconnect();
  });

  test("peer.update 事件携带状态变更信息", async () => {
    const { client: client1 } = await connectClient(hubUrl, "pu-1");
    const { client: client2 } = await connectClient(hubUrl, "pu-2");
    await sleep(200);
    const updatePromise = waitForEvent(client1, "peer.update");
    client2.updateStatus("busy", "doing stuff");
    const update = await updatePromise;
    expect(update.status).toBe("busy");
    await client1.disconnect();
    await client2.disconnect();
  });

  test("连接不存在的 Hub 抛出错误", async () => {
    const client = new AgentClient({
      hubUrl: "ws://127.0.0.1:19999",
      name: "fail-connect",
      autoReconnect: false,
    });
    client.on("error", () => {});
    await expect(client.connect()).rejects.toThrow();
  });

  test("重复 connect 不报错", async () => {
    const { client } = await connectClient(hubUrl, "dup-connect");
    await client.connect();
    expect(client.connected).toBe(true);
    await client.disconnect();
  });
});

// ──────────────── 集成场景测试 ────────────────

describe("集成场景", () => {
  let hub: Hub;
  let port: number;
  let hubUrl: string;

  beforeAll(async () => {
    port = getPort();
    hub = new Hub({ port, host: "127.0.0.1" });
    await hub.start();
    hubUrl = `ws://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await hub.stop();
  });

  test("3 个 agent 并行注册并互相通信", async () => {
    const results = await Promise.all(
      ["int-a", "int-b", "int-c"].map((name) => connectClient(hubUrl, name)),
    );
    const clients = results.map((r) => r.client);
    await sleep(300);
    expect(hub.getAgentList().length).toBe(3);
    const agentCId = clients[2].id;
    const msgPromise = waitForEvent(clients[2], "message");
    clients[0].sendToAgent(agentCId, "A -> C direct message");
    const msg = await msgPromise;
    expect(msg.text).toBe("A -> C direct message");
    for (const c of clients) await c.disconnect();
  });

  test("agent 断线后 Hub 自动清理", async () => {
    const { client, registered: reg } = await connectClient(hubUrl, "auto-clean");
    await sleep(100);
    expect(hub.getAgent(reg.agentId)).toBeTruthy();
    await client.disconnect();
    await sleep(300);
    expect(hub.getAgent(reg.agentId)).toBeUndefined();
  });

  test("Hub stop 后所有客户端断开", async () => {
    const stopPort = getPort();
    const stopHub = await startHub({ port: stopPort, host: "127.0.0.1" });
    const stopHubUrl = `ws://127.0.0.1:${stopPort}`;
    const client = new AgentClient({ hubUrl: stopHubUrl, name: "stop-test", autoReconnect: false });
    client.on("error", () => {});
    const regPromise = waitForEvent(client, "registered");
    await client.connect();
    await regPromise;
    expect(client.connected).toBe(true);
    const disconnected = waitForEvent(client, "disconnected");
    await stopHub.stop();
    await disconnected;
    expect(client.connected).toBe(false);
  });

  test("心跳状态不再硬编码 — updateStatus 后心跳反映真实状态", async () => {
    const { client, registered: reg } = await connectClient(hubUrl, "hb-real-status");
    await sleep(100);
    client.updateStatus("busy", "real task");
    await sleep(200);
    expect(hub.getAgent(reg.agentId)?.status).toBe("busy");
    expect(hub.getAgent(reg.agentId)?.currentTask).toBe("real task");
    await client.disconnect();
  });
});
