import { Orchestrator, SdkOpenCodeAdapter } from "../src/index.js";

console.log("=== 连接真实 OpenCode 服务 ===\n");
console.log("前置条件：");
console.log("  1. 安装 OpenCode CLI: npm install -g opencode-ai");
console.log("  2. 配置 API Key (以 Anthropic 为例):");
console.log("     export ANTHROPIC_API_KEY=sk-ant-xxxxx");
console.log("  3. 在项目目录创建 .opencode.json 配置文件\n");

console.log("--- .opencode.json 示例 ---");
console.log(JSON.stringify({
  agents: {
    coder: {
      model: "claude-sonnet-4-20250514",
      maxTokens: 5000,
    },
    task: {
      model: "claude-sonnet-4-20250514",
      maxTokens: 5000,
    },
  },
}, null, 2));
console.log("---\n");

console.log("方式一：自动启动 OpenCode 服务（推荐）\n");

const autoStartAdapter = new SdkOpenCodeAdapter({
  cwd: process.cwd(),
  startServer: true,
});

const orch1 = new Orchestrator({
  cwd: process.cwd(),
  maxConcurrency: 2,
  dryRun: false,
  adapter: autoStartAdapter,
  onProgress: (e) => {
    if (e.kind === "task-start") console.log(`  ▶ ${e.role}: ${e.title}`);
    if (e.kind === "task-complete") console.log(`  ✓ ${e.role}: 完成`);
  },
});

console.log("const adapter = new SdkOpenCodeAdapter({");
console.log("  cwd: process.cwd(),");
console.log("  startServer: true,  // 自动执行 opencode serve");
console.log("});");
console.log("\nconst orch = new Orchestrator({ ... , adapter });");
console.log("const run = await orch.run('你的目标');\n");

console.log("方式二：连接已运行的 OpenCode 服务\n");
console.log("先在终端启动: opencode serve --port 4096");
console.log("然后：\n");

console.log("const adapter = new SdkOpenCodeAdapter({");
console.log("  cwd: process.cwd(),");
console.log("  baseUrl: 'http://127.0.0.1:4096',");
console.log("});\n");

console.log("方式三：使用 CLI 命令\n");
console.log("  coagent run 'Add user registration' --start-server");
console.log("  coagent run 'Add user registration' --opencode-url http://127.0.0.1:4096");
console.log("  coagent open  # 打开交互式 TUI\n");

console.log("注意：本示例仅展示配置方法，不实际执行（需要有效的 API Key）。");
console.log("要真正运行，请确保 API Key 已配置，然后取消下方注释：\n");
console.log("// const run = await orch1.run('Add a health check endpoint');");
console.log("// console.log(orch1.summarize(run));");
console.log("// await autoStartAdapter.close();");