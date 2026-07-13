import { startHub, AgentClient } from "../src/index.js";

console.log("=== Hub 多 Agent 协作示例 ===\n");
console.log("Hub 是 CoAgent 的 WebSocket 通信中心，让多个 Agent 实例互相协作。\n");

const hub = await startHub({ port: 4877 });
console.log("1. Hub 服务已启动: ws://127.0.0.1:4877\n");

const planner = new AgentClient({
  name: "规划者",
  role: "planner",
  hubUrl: "ws://127.0.0.1:4877",
});

const implementer = new AgentClient({
  name: "实现者",
  role: "implementer",
  hubUrl: "ws://127.0.0.1:4877",
});

planner.on("registered", () => console.log("2. 规划者已连接到 Hub"));
planner.on("peer.join", (agent) => console.log(`   规划者发现新伙伴: ${agent.name} (${agent.role})`));

implementer.on("registered", () => console.log("3. 实现者已连接到 Hub"));
implementer.on("message", (msg) => {
  const sender = msg.from === planner.id ? "规划者" : msg.from;
  console.log(`   实现者收到消息 [来自${sender}]: ${msg.text}`);
});

await planner.connect();
await implementer.connect();

console.log("\n4. 开始协作：");
planner.updateStatus("busy", "分析需求，制定实现计划");
implementer.updateStatus("idle");

await new Promise((r) => setTimeout(r, 500));

planner.sendToAgent(implementer.id, "请按计划实现用户注册 API，涉及文件: src/routes/register.ts");
planner.broadcast("需求分析完成，开始实现阶段", "planning");

await new Promise((r) => setTimeout(r, 1000));

console.log("\n5. 当前 Hub 上的 Agent 列表：");
for (const agent of hub.getAgentList()) {
  console.log(`   ${agent.name} (${agent.role}) — 状态: ${agent.status}，任务: ${agent.currentTask || "无"}`);
}

await planner.disconnect();
await implementer.disconnect();
await hub.stop();
console.log("\n6. 协作结束，Hub 已关闭。");