import { startHub, AgentClient } from "../src/index.js";

const hub = await startHub({ port: 4877 });
console.log("Hub started on ws://127.0.0.1:4877");

const planner = new AgentClient({ name: "planner-agent", role: "planner", hubUrl: "ws://127.0.0.1:4877" });
const implementer = new AgentClient({ name: "impl-agent", role: "implementer", hubUrl: "ws://127.0.0.1:4877" });

planner.on("registered", ({ agentId, peers }) => {
  console.log(`Planner registered: ${agentId}, peers: ${peers.length}`);
});

implementer.on("registered", ({ agentId, peers }) => {
  console.log(`Implementer registered: ${agentId}, peers: ${peers.length}`);
});

planner.on("peer.join", (agent) => {
  console.log(`Planner sees peer joined: ${agent.name} (${agent.role})`);
});

implementer.on("message", (msg) => {
  console.log(`Implementer received: "${msg.text}" from ${msg.from}`);
});

await planner.connect();
await implementer.connect();

planner.updateStatus("busy", "Planning feature X");
implementer.updateStatus("idle");

planner.sendToAgent(implementer.id, "Please implement feature X according to the plan");
planner.broadcast("Feature X planning is complete", "planning");

await new Promise((r) => setTimeout(r, 2000));

console.log("\nAgent list:");
for (const agent of hub.getAgentList()) {
  console.log(`  ${agent.name} (${agent.role}) — ${agent.status}, task: ${agent.currentTask}`);
}

await planner.disconnect();
await implementer.disconnect();
await hub.stop();
console.log("\nHub stopped.");