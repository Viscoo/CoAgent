import { Orchestrator, MockAdapter, PolicyGuard, MergeGate, RunLedger, buildRiskReport } from "../src/index.js";

console.log("=== 端到端完整示例 ===\n");
console.log("这个示例展示 CoAgent 编排一次完整运行的全过程：\n");

const adapter = new MockAdapter();
const orch = new Orchestrator({
  cwd: process.cwd(),
  maxConcurrency: 2,
  dryRun: false,
  adapter,
  onProgress: (e) => {
    if (e.kind === "task-start") console.log(`  ▶ ${e.role}: ${e.title}`);
    if (e.kind === "task-complete") {
      const changed = e.message.includes("changed") ? ` — ${e.message.split("(")[1]?.replace(")", "")}` : "";
      console.log(`  ✓ ${e.role}: 完成${changed}`);
    }
  },
});

console.log("步骤 1: 初始化项目脚手架");
const files = await orch.init();
console.log(`  创建了 ${files.length} 个配置文件\n`);

console.log("步骤 2: 规划任务（仅创建计划，不执行）");
const plan = await orch.plan("Add user registration with email verification");
console.log(`  运行 ID: ${plan.id}`);
console.log(`  任务数: ${plan.taskGraph.tasks.length}`);
console.log(`  状态: ${plan.status}\n`);

console.log("步骤 3: 执行完整编排");
const run = await orch.run("Add user registration with email verification");
console.log();

console.log("步骤 4: 查看各角色执行结果\n");

const roleLabels: Record<string, string> = {
  planner: "规划者",
  explorer: "探索者",
  implementer: "实现者",
  reviewer: "审查者",
  tester: "测试者",
  integrator: "集成者",
};

for (const ar of run.agentRuns) {
  const label = roleLabels[ar.role] ?? ar.role;
  console.log(`【${label}】${ar.role}`);
  if (ar.summary) console.log(`  产出: ${ar.summary}`);
  if (ar.diffFiles.length > 0) console.log(`  修改: ${ar.diffFiles.join(", ")}`);
  console.log(`  状态: ${ar.status}`);
  console.log();
}

console.log("步骤 5: 安全检查");

const policyGuard = new PolicyGuard();
let violations = 0;
for (const ar of run.agentRuns) {
  const spec = orch["registry"].get(ar.role);
  const v = policyGuard.validateDiff(
    run.taskGraph.tasks.find((t) => t.id === ar.taskId)!,
    spec,
    ar.diffFiles,
  );
  violations += v.length;
}
console.log(`  策略违规: ${violations} (只读角色不应产生文件变更，实现者不应超出分配范围)\n`);

console.log("步骤 6: 合并评估");
if (run.mergePlan) {
  const statusMap: Record<string, string> = {
    clean: "✓ 无冲突，可以安全合并",
    "needs-integrator": "△ 存在冲突，需要集成者处理",
    blocked: "✗ 被阻止，审查或测试未通过",
  };
  console.log(`  ${statusMap[run.mergePlan.status] ?? run.mergePlan.status}`);
  console.log(`  ${run.mergePlan.summary}`);
}

console.log("\n步骤 7: 运行记录持久化");
const ledger = new RunLedger(process.cwd());
const saved = await ledger.load(run.id);
console.log(`  运行记录已保存到 .coagent/runs/${run.id}/run.json`);
console.log(`  可用 coagent status ${run.id} 或 coagent logs ${run.id} 查看\n`);

console.log("--- 完成 ---");
console.log(`总状态: ${run.status === "completed" ? "✓ 成功" : "✗ 失败"}`);