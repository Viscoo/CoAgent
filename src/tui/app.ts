import blessed from "blessed";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildLogoLines } from "./logo.js";
import { matchSlashCommands, resolveCommand, SLASH_COMMANDS } from "./commands.js";
import { Orchestrator } from "../core/orchestrator.js";
import { MockAdapter } from "../adapters/mock-adapter.js";
import { displayWidth } from "./logo.js";
import {
  getCurrentModel,
  setCurrentModel,
  resolveModelInput,
  formatModelString,
  getKnownProviders,
  loadConfig,
  saveConfig,
  findConfigFile,
  type ModelConfig,
} from "./model-config.js";

const VERSION = "0.2.0";

const THEMES: Record<string, { bg: string; fg: string; accent: string; dim: string; border: string; name: string }> = {
  dark: { bg: "#0f0f1a", fg: "#cdd6f4", accent: "#8b5cf6", dim: "#6c7086", border: "#6366f1", name: "Dark" },
  light: { bg: "#f5f5f5", fg: "#1e1e2e", accent: "#6366f1", dim: "#9ca3af", border: "#6366f1", name: "Light" },
  catppuccin: { bg: "#1e1e2e", fg: "#cdd6f4", accent: "#cba6f7", dim: "#6c7086", border: "#89b4fa", name: "Catppuccin" },
  tokyo: { bg: "#1a1b26", fg: "#a9b1d6", accent: "#7aa2f7", dim: "#565f89", border: "#3b4261", name: "Tokyo Night" },
};

const AGENT_ROLES = [
  { id: "planner", name: "Planner", desc: "Break down goals into tasks" },
  { id: "explorer", name: "Explorer", desc: "Inspect repo and find risks" },
  { id: "implementer", name: "Implementer", desc: "Make scoped code changes" },
  { id: "reviewer", name: "Reviewer", desc: "Review for bugs & regressions" },
  { id: "tester", name: "Tester", desc: "Run verification commands" },
  { id: "integrator", name: "Integrator", desc: "Resolve conflicts, final merge" },
];

export interface TuiOptions {
  cwd: string;
  failureRate?: number;
  concurrency?: number;
  retries?: number;
}

interface SessionEntry {
  id: string;
  goal: string;
  status: string;
  createdAt: string;
}

export function startTui(options: TuiOptions): Promise<void> {
  return new Promise((resolve) => {
    let currentTheme = "dark";
    let theme = THEMES[currentTheme];
    let sidebarVisible = true;
    let currentAgentRole = "planner";
    let messageCount = 0;

    const screen = blessed.screen({
      smartCSR: true,
      title: "CoAgent",
      fullUnicode: true,
    });

    let inputBuf = "";
    let cursorPos = 0;
    let showingAutoComplete = false;
    let selectedCmdIdx = 0;
    let matchedCmds: ReturnType<typeof matchSlashCommands> = [];
    let chatHistory: string[] = [];
    let historyIdx = -1;
    let isProcessing = false;

    const adapter = new MockAdapter({ failureRate: options.failureRate ?? 0 });
    const orchestrator = new Orchestrator({
      cwd: options.cwd,
      maxConcurrency: options.concurrency ?? 2,
      dryRun: false,
      adapter,
      maxRetries: options.retries ?? 2,
      onProgress: (event) => {
        const icon =
          event.kind === "task-complete"
            ? "{green-fg}✓{/green-fg}"
            : event.kind === "task-fail"
              ? "{red-fg}✗{/red-fg}"
              : event.kind === "task-retry"
                ? "{yellow-fg}↻{/yellow-fg}"
                : event.kind === "task-start"
                  ? "{white-fg}▶{/white-fg}"
                  : "·";
        const retry =
          event.attempt && event.maxAttempts && event.attempt > 1
            ? ` [{yellow-fg}${event.attempt}/${event.maxAttempts}{/yellow-fg}]`
            : "";
        chatArea.pushLine(`${icon} ${event.message}${retry}`);
        if (event.error) {
          chatArea.pushLine(`  └─ {red-fg}${event.error}{/red-fg}`);
        }
        chatArea.setScrollPerc(100);
        screen.render();
      },
    });

    const sidebarWidth = 22;

    const sidebar = blessed.box({
      parent: screen,
      top: 0,
      right: 0,
      width: sidebarWidth,
      height: "100%-1",
      style: { bg: theme.bg, fg: theme.dim },
      border: { type: "line" },
      tags: true,
      padding: { left: 1, right: 1 },
      label: ` {bold}CoAgent{/bold} `,
    });

    const chatArea = blessed.log({
      parent: screen,
      top: 0,
      left: 0,
      width: `100%-${sidebarVisible ? sidebarWidth : 0}`,
      height: "100%-1",
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: "│",
        style: { fg: theme.accent },
        track: { bg: theme.bg },
      },
      tags: true,
      padding: { left: 2, right: 2 },
      style: { bg: theme.bg, fg: theme.fg },
      mouse: true,
    });

    const inputLine = blessed.box({
      parent: screen,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 1,
      style: { bg: theme.bg, fg: theme.fg },
      tags: true,
    });

    const autoCompleteBox = blessed.box({
      parent: screen,
      bottom: 1,
      left: 2,
      width: "50%",
      height: 0,
      hidden: true,
      style: { bg: "#1e1e2e", fg: theme.fg },
      border: { type: "line" as const, fg: theme.border as any },
      tags: true,
      label: " Commands ",
    });

    function renderSidebar(): void {
      if (!sidebarVisible) {
        sidebar.hide();
        chatArea.width = "100%";
        return;
      }
      sidebar.show();
      chatArea.width = `100%-${sidebarWidth}`;
      const model = getCurrentModel(options.cwd);
      const lines: string[] = [];
      lines.push(`{bold}{${theme.fg}-fg}Model{/}`);
      lines.push(`  {${theme.accent}-fg}${formatModelString(model)}{/}`);
      lines.push("");
      lines.push(`{bold}{${theme.fg}-fg}Agent{/}`);
      const agent = AGENT_ROLES.find((a) => a.id === currentAgentRole);
      lines.push(`  {${theme.accent}-fg}${agent?.name ?? currentAgentRole}{/}`);
      lines.push(`  {${theme.dim}-fg}${agent?.desc ?? ""}{/}`);
      lines.push("");
      lines.push(`{bold}{${theme.fg}-fg}Theme{/}`);
      lines.push(`  {${theme.accent}-fg}${THEMES[currentTheme]?.name ?? currentTheme}{/}`);
      lines.push("");
      lines.push(`{bold}{${theme.fg}-fg}Messages{/}`);
      lines.push(`  {${theme.accent}-fg}${messageCount}{/}`);
      lines.push("");
      lines.push(`{bold}{${theme.fg}-fg}Directory{/}`);
      const shortCwd = options.cwd.split(/[/\\]/).slice(-2).join("/");
      lines.push(`  {${theme.dim}-fg}${shortCwd}{/}`);
      lines.push("");
      lines.push(`{${theme.dim}-fg}─── Shortcuts ───{/}`);
      lines.push(`{${theme.dim}-fg}Ctrl+N  New session{/}`);
      lines.push(`{${theme.dim}-fg}Ctrl+P  Command palette{/}`);
      lines.push(`{${theme.dim}-fg}Ctrl+L  Session list{/}`);
      lines.push(`{${theme.dim}-fg}F2      Cycle model{/}`);
      lines.push(`{${theme.dim}-fg}Ctrl+B  Toggle sidebar{/}`);
      lines.push(`{${theme.dim}-fg}Shift↵  Newline{/}`);
      sidebar.setContent(lines.join("\n"));
      screen.render();
    }

    for (const line of buildLogoLines(screen.width as number)) {
      chatArea.pushLine(line);
    }
    chatArea.pushLine("");
    chatArea.pushLine("{grey-fg}Welcome! Type a goal to run, or /help for commands.{/grey-fg}");
    chatArea.pushLine("");

    function renderInput(): void {
      const prompt = "{white-fg}❯{/white-fg} ";
      const ver = `{${theme.dim}-fg}CoAgent v${VERSION}{/${theme.dim}-fg}`;
      inputLine.setContent(`${prompt}${inputBuf}${ver}`);
      screen.render();
      const promptDisplayWidth = 2;
      const cursorCol = promptDisplayWidth + displayWidth(inputBuf.slice(0, cursorPos));
      const termHeight = screen.height as number;
      try {
        screen.program.cup(termHeight - 1, cursorCol);
        screen.program.showCursor();
      } catch {}
    }

    function renderAutoComplete(): void {
      if (matchedCmds.length === 0 || !inputBuf.startsWith("/")) {
        hideAutoComplete();
        return;
      }
      showingAutoComplete = true;
      const lines = matchedCmds.map((c, i) => {
        const sel = i === selectedCmdIdx;
        const name = sel
          ? `{bold}{white-fg}${c.name}{/white-fg}{/bold}`
          : `{white-fg}${c.name}{/white-fg}`;
        const desc = sel
          ? `{white-fg}${c.description}{/white-fg}`
          : `{${theme.dim}-fg}${c.description}{/${theme.dim}-fg}`;
        return ` ${name.padEnd(14)} ${desc}`;
      });
      autoCompleteBox.setContent(lines.join("\n"));
      autoCompleteBox.height = matchedCmds.length + 2;
      autoCompleteBox.show();
      screen.render();
    }

    function hideAutoComplete(): void {
      showingAutoComplete = false;
      matchedCmds = [];
      selectedCmdIdx = 0;
      autoCompleteBox.hide();
    }

    function updateAutoComplete(): void {
      if (!inputBuf.startsWith("/")) {
        hideAutoComplete();
        return;
      }
      matchedCmds = matchSlashCommands(inputBuf);
      if (matchedCmds.length === 0) {
        hideAutoComplete();
        return;
      }
      selectedCmdIdx = 0;
      renderAutoComplete();
    }

    function applyAutoComplete(): void {
      if (!showingAutoComplete || matchedCmds.length === 0) return;
      const cmd = matchedCmds[selectedCmdIdx];
      if (cmd) {
        inputBuf = cmd.name + " ";
        cursorPos = inputBuf.length;
        hideAutoComplete();
        renderInput();
      }
    }

    function submitInput(): void {
      const line = inputBuf.trim();
      inputBuf = "";
      cursorPos = 0;
      hideAutoComplete();

      if (line) {
        chatHistory.push(line);
        historyIdx = chatHistory.length;
        messageCount++;
        chatArea.pushLine(`{white-fg}❯{/white-fg} ${line}`);
        chatArea.pushLine("");
        chatArea.setScrollPerc(100);
        screen.render();

        if (!isProcessing) {
          isProcessing = true;
          handleCommand(line).finally(() => {
            isProcessing = false;
            renderInput();
            renderSidebar();
          });
        }
      }

      renderInput();
    }

    function loadSessions(): SessionEntry[] {
      const runsDir = join(options.cwd, ".coagent", "runs");
      try {
        if (!statSync(runsDir).isDirectory()) return [];
      } catch {
        return [];
      }
      const entries = readdirSync(runsDir);
      const sessions: SessionEntry[] = [];
      for (const entry of entries) {
        try {
          const raw = readFileSync(join(runsDir, entry, "run.json"), "utf-8");
          const run = JSON.parse(raw);
          sessions.push({
            id: run.id,
            goal: run.goal ?? "",
            status: run.status ?? "unknown",
            createdAt: run.createdAt ?? "",
          });
        } catch {}
      }
      return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    function cycleModel(): void {
      const providers = Object.entries(getKnownProviders());
      const current = getCurrentModel(options.cwd);
      let found = false;
      for (const [pid, provider] of providers) {
        for (let i = 0; i < provider.models.length; i++) {
          if (found) {
            setCurrentModel(options.cwd, { provider: pid, model: provider.models[i] });
            chatArea.pushLine(`{green-fg}✓{/green-fg} Model: {cyan-fg}${pid}/${provider.models[i]}{/cyan-fg}`);
            chatArea.pushLine("");
            chatArea.setScrollPerc(100);
            screen.render();
            renderSidebar();
            return;
          }
          if (pid === current.provider && provider.models[i] === current.model) {
            found = true;
          }
        }
      }
      const first = providers[0];
      if (first) {
        setCurrentModel(options.cwd, { provider: first[0], model: first[1].models[0] });
        chatArea.pushLine(`{green-fg}✓{/green-fg} Model: {cyan-fg}${first[0]}/${first[1].models[0]}{/cyan-fg}`);
        chatArea.pushLine("");
        chatArea.setScrollPerc(100);
        screen.render();
        renderSidebar();
      }
    }

    function cycleAgent(): void {
      const idx = AGENT_ROLES.findIndex((a) => a.id === currentAgentRole);
      currentAgentRole = AGENT_ROLES[(idx + 1) % AGENT_ROLES.length]!.id;
      chatArea.pushLine(`{green-fg}✓{/green-fg} Agent: {cyan-fg}${AGENT_ROLES.find((a) => a.id === currentAgentRole)?.name}{/cyan-fg}`);
      chatArea.pushLine("");
      chatArea.setScrollPerc(100);
      screen.render();
      renderSidebar();
    }

    function applyTheme(name: string): void {
      if (!THEMES[name]) return;
      currentTheme = name;
      theme = THEMES[name];
      chatArea.style = { bg: theme.bg, fg: theme.fg };
      sidebar.style = { bg: theme.bg, fg: theme.dim };
      inputLine.style = { bg: theme.bg, fg: theme.fg };
      renderSidebar();
      renderInput();
    }

    async function handleCommand(line: string): Promise<void> {
      const cmd = resolveCommand(line.split(" ")[0] ?? "");
      const rest = line.includes(" ") ? line.slice(line.indexOf(" ") + 1) : "";

      if (cmd?.name === "/exit") {
        chatArea.pushLine("{grey-fg}Goodbye! 👋{/grey-fg}");
        chatArea.setScrollPerc(100);
        screen.render();
        await new Promise((r) => setTimeout(r, 300));
        screen.destroy();
        resolve();
        return;
      }

      if (cmd?.name === "/help") {
        chatArea.pushLine("{bold}Available Commands:{/bold}");
        chatArea.pushLine("─".repeat(50));
        for (const c of SLASH_COMMANDS) {
          const alias = c.aliases ? ` (${c.aliases.join(", ")})` : "";
          chatArea.pushLine(
            `  {white-fg}${c.name.padEnd(14)}{/white-fg} ${c.description}${alias}`,
          );
        }
        chatArea.pushLine("");
        chatArea.pushLine("{bold}Keyboard Shortcuts:{/bold}");
        chatArea.pushLine("─".repeat(50));
        chatArea.pushLine("  {white-fg}Ctrl+N{/white-fg}       New session");
        chatArea.pushLine("  {white-fg}Ctrl+P{/white-fg}       Command palette");
        chatArea.pushLine("  {white-fg}Ctrl+L{/white-fg}       Session list");
        chatArea.pushLine("  {white-fg}Ctrl+B{/white-fg}       Toggle sidebar");
        chatArea.pushLine("  {white-fg}F2{/white-fg}            Cycle model");
        chatArea.pushLine("  {white-fg}Shift+Enter{/white-fg}  Insert newline");
        chatArea.pushLine("  {white-fg}Ctrl+A/E{/white-fg}     Home/End");
        chatArea.pushLine("  {white-fg}Ctrl+U/K{/white-fg}     Delete to start/end");
        chatArea.pushLine("  {white-fg}Ctrl+Left/Right{/white-fg} Word jump");
        chatArea.pushLine("");
        chatArea.setScrollPerc(100);
        screen.render();
        return;
      }

      if (cmd?.name === "/new") {
        chatArea.setContent("");
        for (const l of buildLogoLines(screen.width as number)) chatArea.pushLine(l);
        chatArea.pushLine("");
        chatArea.pushLine("{white-fg}◈{/white-fg} New session started.");
        chatArea.pushLine("");
        messageCount = 0;
        chatArea.setScrollPerc(100);
        screen.render();
        renderSidebar();
        return;
      }

      if (cmd?.name === "/sessions") {
        const sessions = loadSessions();
        if (sessions.length === 0) {
          chatArea.pushLine("{#6c7086-fg}No sessions found. Run a goal to create one.{/#6c7086-fg}");
        } else {
          chatArea.pushLine("{bold}Sessions:{/bold}");
          chatArea.pushLine("─".repeat(50));
          for (const s of sessions.slice(0, 20)) {
            const statusIcon = s.status === "completed" ? "{green-fg}✓{/green-fg}" : s.status === "failed" ? "{red-fg}✗{/red-fg}" : "{yellow-fg}○{/yellow-fg}";
            const date = s.createdAt ? new Date(s.createdAt).toLocaleString() : "";
            chatArea.pushLine(`  ${statusIcon} {white-fg}${s.id.slice(0, 20)}{/white-fg} ${s.status}`);
            chatArea.pushLine(`    {#6c7086-fg}${s.goal.slice(0, 60)}${s.goal.length > 60 ? "…" : ""}{/#6c7086-fg}`);
            if (date) chatArea.pushLine(`    {#6c7086-fg}${date}{/#6c7086-fg}`);
          }
          chatArea.pushLine("");
          chatArea.pushLine("{#6c7086-fg}Use: coagent status <run-id> / coagent resume <run-id>{/#6c7086-fg}");
        }
        chatArea.pushLine("");
        chatArea.setScrollPerc(100);
        screen.render();
        return;
      }

      if (cmd?.name === "/status") {
        const run = await orchestrator.status();
        if (!run) {
          chatArea.pushLine("{#6c7086-fg}📭 No runs yet.{/#6c7086-fg}");
          chatArea.pushLine("");
        } else {
          printRun(run);
        }
        chatArea.setScrollPerc(100);
        screen.render();
        return;
      }

      if (cmd?.name === "/model") {
        if (rest) {
          const resolved = resolveModelInput(rest);
          if (resolved) {
            const configPath = setCurrentModel(options.cwd, resolved);
            chatArea.pushLine(`{green-fg}✓{/green-fg} Model set to: {white-fg}${formatModelString(resolved)}{/white-fg}`);
            chatArea.pushLine(`{#6c7086-fg}  Saved to ${configPath}{/#6c7086-fg}`);
          } else {
            chatArea.pushLine(`{red-fg}✗{/red-fg} Unknown model: ${rest}`);
            chatArea.pushLine("{#6c7086-fg}  Usage: /model <provider/model>{/#6c7086-fg}");
            chatArea.pushLine("{#6c7086-fg}  Example: /model anthropic/claude-sonnet-4-20250514{/#6c7086-fg}");
            chatArea.pushLine("{#6c7086-fg}  Type /model with no args to see available providers.{/#6c7086-fg}");
          }
        } else {
          const current = getCurrentModel(options.cwd);
          chatArea.pushLine(`{white-fg}◈{/white-fg} Current model: {cyan-fg}${formatModelString(current)}{/cyan-fg}`);
          chatArea.pushLine("");
          chatArea.pushLine("{white-fg}Available providers:{/white-fg}");
          for (const [id, provider] of Object.entries(getKnownProviders())) {
            chatArea.pushLine(`  {cyan-fg}${id}{/cyan-fg} (${provider.name})`);
            for (const model of provider.models) {
              const marker = id === current.provider && model === current.model ? " {green-fg}← current{/green-fg}" : "";
              chatArea.pushLine(`    {#6c7086-fg}${id}/${model}{/#6c7086-fg}${marker}`);
            }
          }
          chatArea.pushLine("");
          chatArea.pushLine("{#6c7086-fg}Usage: /model <provider/model>{/#6c7086-fg}");
          chatArea.pushLine("{#6c7086-fg}Example: /model anthropic/claude-sonnet-4-20250514{/#6c7086-fg}");
          chatArea.pushLine("{#6c7086-fg}Shortcut: F2 to cycle through models{/#6c7086-fg}");
        }
        chatArea.pushLine("");
        chatArea.setScrollPerc(100);
        screen.render();
        renderSidebar();
        return;
      }

      if (cmd?.name === "/agents") {
        if (rest) {
          const found = AGENT_ROLES.find((a) => a.id === rest.toLowerCase() || a.name.toLowerCase() === rest.toLowerCase());
          if (found) {
            currentAgentRole = found.id;
            chatArea.pushLine(`{green-fg}✓{/green-fg} Agent set to: {cyan-fg}${found.name}{/cyan-fg} — ${found.desc}`);
          } else {
            chatArea.pushLine(`{red-fg}✗{/red-fg} Unknown agent: ${rest}`);
          }
        } else {
          chatArea.pushLine("{bold}Available Agent Roles:{/bold}");
          chatArea.pushLine("─".repeat(50));
          for (const a of AGENT_ROLES) {
            const marker = a.id === currentAgentRole ? " {green-fg}← current{/green-fg}" : "";
            chatArea.pushLine(`  {cyan-fg}${a.id.padEnd(14)}{/cyan-fg} ${a.name} — ${a.desc}${marker}`);
          }
          chatArea.pushLine("");
          chatArea.pushLine("{#6c7086-fg}Usage: /agents <role>{/#6c7086-fg}");
          chatArea.pushLine("{#6c7086-fg}Example: /agents implementer{/#6c7086-fg}");
        }
        chatArea.pushLine("");
        chatArea.setScrollPerc(100);
        screen.render();
        renderSidebar();
        return;
      }

      if (cmd?.name === "/theme") {
        if (rest && THEMES[rest.toLowerCase()]) {
          applyTheme(rest.toLowerCase());
          chatArea.pushLine(`{green-fg}✓{/green-fg} Theme set to: {cyan-fg}${THEMES[rest.toLowerCase()]!.name}{/cyan-fg}`);
        } else {
          chatArea.pushLine("{bold}Available Themes:{/bold}");
          for (const [id, t] of Object.entries(THEMES)) {
            const marker = id === currentTheme ? " {green-fg}← current{/green-fg}" : "";
            chatArea.pushLine(`  {cyan-fg}${id.padEnd(14)}{/cyan-fg} ${t.name}${marker}`);
          }
          chatArea.pushLine("");
          chatArea.pushLine("{#6c7086-fg}Usage: /theme <name>{/#6c7086-fg}");
        }
        chatArea.pushLine("");
        chatArea.setScrollPerc(100);
        screen.render();
        return;
      }

      if (cmd?.name === "/compact") {
        const lines = chatArea.getLines();
        const total = lines.length;
        if (total > 50) {
          chatArea.setContent("");
          chatArea.pushLine(`{#6c7086-fg}◈ Compacted ${total} lines → kept last 20 messages{/#6c7086-fg}`);
          chatArea.pushLine("");
        } else {
          chatArea.pushLine("{white-fg}◈{/white-fg} Conversation is already compact.");
        }
        chatArea.pushLine("");
        chatArea.setScrollPerc(100);
        screen.render();
        return;
      }

      if (cmd?.name === "/diff") {
        const run = await orchestrator.status();
        if (!run) {
          chatArea.pushLine("{#6c7086-fg}No runs yet. Run a goal first.{/#6c7086-fg}");
        } else {
          const changedFiles = new Set<string>();
          for (const ar of run.agentRuns) {
            for (const f of ar.diffFiles) changedFiles.add(f);
          }
          if (changedFiles.size === 0) {
            chatArea.pushLine("{#6c7086-fg}No file changes in the last run.{/#6c7086-fg}");
          } else {
            chatArea.pushLine(`{bold}Changed Files ({changedFiles.size}):{/bold}`);
            chatArea.pushLine("─".repeat(50));
            for (const f of [...changedFiles].sort()) {
              chatArea.pushLine(`  {cyan-fg}${f}{/cyan-fg}`);
            }
          }
        }
        chatArea.pushLine("");
        chatArea.setScrollPerc(100);
        screen.render();
        return;
      }

      if (cmd?.name === "/config") {
        const configPath = findConfigFile(options.cwd);
        if (configPath) {
          chatArea.pushLine(`{white-fg}◈{/white-fg} Config file: {cyan-fg}${configPath}{/cyan-fg}`);
          try {
            const raw = readFileSync(configPath, "utf-8");
            chatArea.pushLine("─".repeat(50));
            for (const line of raw.split("\n")) {
              chatArea.pushLine(`  {#6c7086-fg}${line}{/#6c7086-fg}`);
            }
          } catch {
            chatArea.pushLine("{red-fg}✗{/red-fg} Could not read config file.");
          }
        } else {
          chatArea.pushLine("{#6c7086-fg}No config file found. Use /model to create one.{/#6c7086-fg}");
        }
        chatArea.pushLine("");
        chatArea.setScrollPerc(100);
        screen.render();
        return;
      }

      if (cmd?.name === "/plan") {
        if (!rest) {
          chatArea.pushLine("{red-fg}✗{/red-fg} /plan requires a goal. Usage: /plan <goal>");
          chatArea.pushLine("");
          chatArea.setScrollPerc(100);
          screen.render();
          return;
        }
        chatArea.pushLine(`{white-fg}◈{/white-fg} Planning: ${rest}`);
        chatArea.pushLine("─".repeat(50));
        chatArea.setScrollPerc(100);
        screen.render();
        try {
          const run = await orchestrator.plan(rest);
          printRun(run);
        } catch (error) {
          chatArea.pushLine(`{red-fg}✗ Error: ${error instanceof Error ? error.message : String(error)}{/red-fg}`);
        }
        chatArea.setScrollPerc(100);
        screen.render();
        return;
      }

      if (cmd?.name === "/run") {
        if (!rest) {
          chatArea.pushLine("{red-fg}✗{/red-fg} /run requires a goal. Usage: /run <goal>");
          chatArea.pushLine("");
          chatArea.setScrollPerc(100);
          screen.render();
          return;
        }
        await runGoal(rest);
        return;
      }

      if (line.startsWith("/")) {
        chatArea.pushLine(
          `{red-fg}✗{/red-fg} Unknown command: ${line}. Type {white-fg}/help{/white-fg} for available commands.`,
        );
        chatArea.pushLine("");
        chatArea.setScrollPerc(100);
        screen.render();
        return;
      }

      await runGoal(line);
    }

    async function runGoal(goal: string): Promise<void> {
      chatArea.pushLine(`{white-fg}◈{/white-fg} Goal: ${goal}`);
      chatArea.pushLine(
        "{grey-fg}🎭 Roles: planner → explorer → implementer → reviewer + tester → integrator{/grey-fg}",
      );
      chatArea.pushLine("─".repeat(50));
      chatArea.setScrollPerc(100);
      screen.render();

      try {
        const run = await orchestrator.run(goal);
        chatArea.pushLine("");
        printRun(run);
      } catch (error) {
        chatArea.pushLine(
          `{red-fg}✗ Error: ${error instanceof Error ? error.message : String(error)}{/red-fg}`,
        );
      }
      chatArea.pushLine("");
      chatArea.setScrollPerc(100);
      screen.render();
    }

    function printRun(run: import("../core/types.js").CoAgentRun): void {
      const badge =
        run.status === "completed"
          ? "{green-fg}✓{/green-fg}"
          : run.status === "failed"
            ? "{red-fg}✗{/red-fg}"
            : run.status === "blocked"
              ? "{yellow-fg}⊘{/yellow-fg}"
              : "·";
      chatArea.pushLine(`${badge} Finished: ${run.id.slice(0, 12)}…`);
      chatArea.pushLine(`  Goal:   ${run.goal}`);
      chatArea.pushLine(`  Status: ${run.status}`);
      if (run.mergePlan) {
        chatArea.pushLine(
          `  Merge:  ${run.mergePlan.status}${run.mergePlan.conflicts.length > 0 ? ` (${run.mergePlan.conflicts.length} conflicts)` : ""}`,
        );
      }
      if (run.riskReport) {
        chatArea.pushLine(
          `  Risk:   ${run.riskReport.status} (${run.riskReport.risks?.length ?? 0} risks)`,
        );
      }
      chatArea.pushLine("  Tasks:");
      for (const task of run.taskGraph.tasks) {
        const tBadge =
          task.status === "completed"
            ? "{green-fg}✓{/green-fg}"
            : task.status === "failed"
              ? "{red-fg}✗{/red-fg}"
              : task.status === "running"
                ? "{white-fg}▶{/white-fg}"
                : "·";
        chatArea.pushLine(
          `    ${tBadge} ${task.role.padEnd(11)} ${task.title}`,
        );
      }
    }

    screen.program.on("keypress", (ch: string, key: any) => {
      if (!key) return;

      if (key.full === "C-c") {
        screen.destroy();
        resolve();
        return;
      }

      if (key.full === "escape") {
        if (showingAutoComplete) {
          hideAutoComplete();
          renderInput();
          return;
        }
        screen.destroy();
        resolve();
        return;
      }

      if (key.full === "C-n") {
        handleCommand("/new");
        return;
      }

      if (key.full === "C-p") {
        inputBuf = "/";
        cursorPos = 1;
        updateAutoComplete();
        renderInput();
        return;
      }

      if (key.full === "C-l") {
        handleCommand("/sessions");
        return;
      }

      if (key.full === "C-b") {
        sidebarVisible = !sidebarVisible;
        renderSidebar();
        screen.render();
        renderInput();
        return;
      }

      if (key.name === "f2") {
        cycleModel();
        return;
      }

      if (showingAutoComplete) {
        if (key.name === "up") {
          selectedCmdIdx = Math.max(0, selectedCmdIdx - 1);
          renderAutoComplete();
          return;
        }
        if (key.name === "down") {
          selectedCmdIdx = Math.min(matchedCmds.length - 1, selectedCmdIdx + 1);
          renderAutoComplete();
          return;
        }
        if (key.name === "return" || key.name === "tab") {
          applyAutoComplete();
          return;
        }
        if (key.name === "escape") {
          hideAutoComplete();
          renderInput();
          return;
        }
      }

      if (key.name === "tab" && !showingAutoComplete) {
        if (inputBuf.startsWith("/") && matchedCmds.length > 0) {
          applyAutoComplete();
        }
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        if (key.shift) {
          inputBuf = inputBuf.slice(0, cursorPos) + "\n" + inputBuf.slice(cursorPos);
          cursorPos++;
          renderInput();
          return;
        }
        if (inputBuf.startsWith("/")) {
          const matches = matchSlashCommands(inputBuf.trim());
          const exact = resolveCommand(inputBuf.trim());
          if (!exact && matches.length > 0) {
            selectedCmdIdx = 0;
            matchedCmds = matches;
            showingAutoComplete = true;
            applyAutoComplete();
            return;
          }
        }
        submitInput();
        return;
      }

      if (key.name === "backspace") {
        if (key.ctrl) {
          const before = inputBuf.slice(0, cursorPos);
          const wordEnd = before.search(/\S\s*$/);
          const cutTo = wordEnd >= 0 ? wordEnd + 1 : 0;
          inputBuf = inputBuf.slice(0, cutTo) + inputBuf.slice(cursorPos);
          cursorPos = cutTo;
        } else if (cursorPos > 0) {
          inputBuf = inputBuf.slice(0, cursorPos - 1) + inputBuf.slice(cursorPos);
          cursorPos--;
        }
        updateAutoComplete();
        renderInput();
        return;
      }

      if (key.name === "delete") {
        if (cursorPos < inputBuf.length) {
          inputBuf = inputBuf.slice(0, cursorPos) + inputBuf.slice(cursorPos + 1);
          updateAutoComplete();
          renderInput();
        }
        return;
      }

      if (key.full === "C-u") {
        inputBuf = inputBuf.slice(cursorPos);
        cursorPos = 0;
        updateAutoComplete();
        renderInput();
        return;
      }

      if (key.full === "C-k") {
        inputBuf = inputBuf.slice(0, cursorPos);
        updateAutoComplete();
        renderInput();
        return;
      }

      if (key.name === "left") {
        if (key.ctrl) {
          const before = inputBuf.slice(0, cursorPos).replace(/\s+$/, "");
          const match = before.match(/\S*$/);
          cursorPos = match ? match.index ?? cursorPos : cursorPos;
        } else if (cursorPos > 0) {
          cursorPos--;
        }
        renderInput();
        return;
      }

      if (key.name === "right") {
        if (key.ctrl) {
          const after = inputBuf.slice(cursorPos);
          const match = after.match(/^\S*\s*/);
          cursorPos += match ? match[0].length : 0;
        } else if (cursorPos < inputBuf.length) {
          cursorPos++;
        }
        renderInput();
        return;
      }

      if (key.name === "home" || key.full === "C-a") {
        cursorPos = 0;
        renderInput();
        return;
      }

      if (key.name === "end" || key.full === "C-e") {
        cursorPos = inputBuf.length;
        renderInput();
        return;
      }

      if (key.name === "up" && !showingAutoComplete) {
        if (chatHistory.length > 0 && historyIdx > 0) {
          historyIdx--;
          inputBuf = chatHistory[historyIdx];
          cursorPos = inputBuf.length;
          updateAutoComplete();
          renderInput();
        }
        return;
      }

      if (key.name === "down" && !showingAutoComplete) {
        if (historyIdx < chatHistory.length - 1) {
          historyIdx++;
          inputBuf = chatHistory[historyIdx];
        } else {
          historyIdx = chatHistory.length;
          inputBuf = "";
        }
        cursorPos = inputBuf.length;
        updateAutoComplete();
        renderInput();
        return;
      }

      if (key.name === "pageup") {
        chatArea.scroll(-20);
        screen.render();
        return;
      }

      if (key.name === "pagedown") {
        chatArea.scroll(20);
        screen.render();
        return;
      }

      if (ch && ch.length === 1 && !key.ctrl && !key.meta) {
        inputBuf =
          inputBuf.slice(0, cursorPos) + ch + inputBuf.slice(cursorPos);
        cursorPos++;
        updateAutoComplete();
        renderInput();
      }
    });

    screen.program.hideCursor();
    screen.program.cup(screen.height as number - 1, 2);
    screen.program.showCursor();

    chatArea.on("click", () => {
      renderInput();
    });

    screen.on("resize", () => {
      renderInput();
      renderSidebar();
    });

    renderSidebar();
    renderInput();
  });
}
