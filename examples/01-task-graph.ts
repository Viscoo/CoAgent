import { createTaskGraph, getReadyTasks, updateTaskStatus } from "../src/index.js";

const graph = createTaskGraph("Add a user registration API");

console.log("CoAgent 会将你的目标拆解为 6 个角色的任务，按依赖顺序执行：\n");

for (const task of graph.tasks) {
  const deps = task.dependsOn.length > 0 ? ` ← 等待 [${task.dependsOn.map((id) => graph.tasks.find((t) => t.id === id)?.role).join(", ")}]` : " ← 无依赖，可立即执行";
  console.log(`  ${task.role.padEnd(14)} ${task.title}${deps}`);
}

console.log("\n模拟逐步执行：\n");

let current = graph;
while (true) {
  const ready = getReadyTasks(current);
  if (ready.length === 0) break;
  for (const task of ready) {
    console.log(`  ▶ ${task.role}: ${task.title}`);
    current = updateTaskStatus(current, task.id, "completed");
  }
}

console.log("\n所有任务完成！这就是 CoAgent 的核心执行流程。");