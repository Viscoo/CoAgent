import { AgentRegistry, defaultAgentSpecs } from "../src/index.js";

const registry = new AgentRegistry();

console.log("=== Built-in Agent Roles ===\n");
for (const spec of registry.list()) {
  console.log(`--- ${spec.displayName} (${spec.role}) ---`);
  console.log(`  Mission: ${spec.mission}`);
  console.log(`  Permission: ${spec.permissionMode}`);
  console.log(`  Can write: ${spec.canWrite}`);
  console.log(`  Model hint: ${spec.defaultModelHint}`);
  console.log();
}

console.log("=== Sample Prompt (Implementer) ===\n");
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