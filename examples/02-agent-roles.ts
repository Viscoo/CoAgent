import { AgentRegistry, defaultAgentSpecs } from "../src/index.js";

const registry = new AgentRegistry();

console.log("CoAgent 内置 6 个 Agent 角色，各有不同权限和职责：\n");

const roleNames: Record<string, string> = {
  planner: "规划者",
  explorer: "探索者",
  implementer: "实现者",
  reviewer: "审查者",
  tester: "测试者",
  integrator: "集成者",
};

for (const spec of registry.list()) {
  const permMap: Record<string, string> = {
    "read-only": "只读 — 不能修改文件",
    "scoped-write": "限定写入 — 只能修改分配的文件",
    "review-gate": "审查关卡 — 必须通过才能继续",
  };
  console.log(`【${roleNames[spec.role] ?? spec.role}】${spec.displayName}`);
  console.log(`  职责: ${spec.mission}`);
  console.log(`  权限: ${permMap[spec.permissionMode] ?? spec.permissionMode}`);
  console.log();
}

console.log("--- 示例：实现者(Implementer)收到的 Prompt ---\n");
const implementer = registry.get("implementer");
const samplePrompt = implementer.promptTemplate(
  {
    id: "task_1",
    title: "Add health check endpoint",
    description: "Create a GET /health endpoint that returns service status",
    kind: "implementation",
    role: "implementer",
    dependsOn: [],
    status: "pending",
    allowWrite: true,
    assignedFiles: ["src/routes/health.ts"],
    attempts: 0,
    priority: 70,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  "Add a health check endpoint to the API",
);
console.log(samplePrompt);