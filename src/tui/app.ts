import blessed from "blessed";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildLogoLines } from "./logo.js";
import { matchSlashCommands, resolveCommand, SLASH_COMMANDS } from "./commands.js";
import { Orchestrator } from "../core/orchestrator.js";
import { MockAdapter } from "../adapters/mock-adapter.js";
import { HubBridge } from "../hub/bridge.js";
import { displayWidth } from "./logo.js";
import { chat, loadChatConfig, saveChatConfig, resolveApiKey, getProviders, type ChatMessage } from "./chat-client.js";
import {
  resolveModelInput,
  findConfigFile,
} from "./model-config.js";

const VERSION = "0.2.0";

const T = {
  bg: "#0a0a0a", bgPanel: "#141414", bgElement: "#1e1e1e", bgMenu: "#1e1e1e",
  text: "#eeeeee", textMuted: "#808080", primary: "#fab283", secondary: "#5c9cf5",
  accent: "#9d7cd8", error: "#e06c75", warning: "#f5a742", success: "#7fd88f",
  info: "#56b6c2", border: "#484848", borderActive: "#606060",
  diffAdded: "#4fd6be", diffRemoved: "#c53b53",
};

function fg(c: string, t: string): string { return "{" + c + "-fg}" + t + "{/}"; }
function bold(t: string): string { return "{bold}" + t + "{/bold}"; }
function hr(): string { return fg(T.border, "─".repeat(50)); }

const AGENT_ROLES = [
  { id: "planner", name: "Plan", color: T.accent, desc: "Break down goals into tasks" },
  { id: "explorer", name: "Explore", color: T.info, desc: "Inspect repo and find risks" },
  { id: "implementer", name: "Build", color: T.primary, desc: "Make scoped code changes" },
  { id: "reviewer", name: "Review", color: T.secondary, desc: "Review for bugs & regressions" },
  { id: "tester", name: "Test", color: T.success, desc: "Run verification commands" },
  { id: "integrator", name: "Integrate", color: T.warning, desc: "Resolve conflicts, final merge" },
];

const SIDEBAR_WIDTH = 32;

export interface TuiOptions {
  cwd: string; failureRate?: number; concurrency?: number; retries?: number;
  backend?: "opencode" | "claude" | "mock";
}

interface SessionEntry { id: string; goal: string; status: string; createdAt: string; }

export function startTui(options: TuiOptions): Promise<void> {
  return new Promise((resolve) => {
    let sidebarVisible = false;
    let currentAgentRole = "implementer";
    let messageCount = 0;
    let inputBuf = "";
    let cursorPos = 0;
    let showingAutoComplete = false;
    let selectedCmdIdx = 0;
    let matchedCmds: ReturnType<typeof matchSlashCommands> = [];
    let chatHistory: string[] = [];
    let historyIdx = -1;
    let isProcessing = false;

    let hubBridge: HubBridge | null = null;
    let hubStatus = "connecting…";

    const screen = blessed.screen({ smartCSR: false, title: "CoAgent", fullUnicode: true });

    const adapter = new MockAdapter({ failureRate: options.failureRate ?? 0 });
    const orchestrator = new Orchestrator({
      cwd: options.cwd, maxConcurrency: options.concurrency ?? 2, dryRun: false, adapter,
      maxRetries: options.retries ?? 2,
      onProgress: (event) => {
        hubBridge?.reportProgress(event);
        const agent = AGENT_ROLES.find((a) => a.id === event.role);
        const color = agent?.color ?? T.text;
        const icon = event.kind === "task-complete" ? fg(T.success, "✓")
          : event.kind === "task-fail" ? fg(T.error, "✗")
          : event.kind === "task-retry" ? fg(T.warning, "↻")
          : event.kind === "task-start" ? fg(color, "▶") : "·";
        const retry = (event.attempt && event.attempt > 1)
          ? " " + fg(T.warning, event.attempt + "/" + event.maxAttempts) : "";
        pushLine(icon + " " + event.message + retry);
        if (event.error) pushLine("  └─ " + fg(T.error, event.error));
                screen.render();
      },
    });

    // Best-effort Hub 连接：在线则注册并显示 peers，不在线则静默降级
    HubBridge.connect({ cwd: options.cwd, role: currentAgentRole, capabilities: ["opencode", "coagent"] })
      .then((bridge) => {
        hubBridge = bridge;
        if (bridge.connected) {
          hubStatus = "online";
          bridge.onChange(() => { renderSidebar(); renderInput(); });
          pushLine(fg(T.success, "🧠") + " Hub connected as " + fg(T.text, bridge.selfName) +
            " — " + fg(T.textMuted, bridge.peerList.length + " peer(s) online"));
          pushLine("");
                  } else {
          hubStatus = "offline";
        }
        screen.render();
      });

    const sidebar = blessed.box({
      parent: screen, top: 0, right: 0, width: SIDEBAR_WIDTH, height: "100%",
      style: { bg: T.bgPanel, fg: T.textMuted }, tags: true,
      padding: { top: 1, left: 2, right: 1, bottom: 1 }, hidden: !sidebarVisible,
    });

    const mainArea = blessed.box({
      parent: screen, top: 0, left: 0,
      width: "100%-" + (sidebarVisible ? SIDEBAR_WIDTH : 0), height: "100%",
      style: { bg: T.bg },
    });

    const chatArea = blessed.box({
      parent: mainArea, top: 0, left: 0, width: "100%", height: "100%-3",
      tags: true, padding: { left: 3, right: 2 }, wrap: true,
      style: { bg: T.bg, fg: T.text }, mouse: true,
      scrollable: true, scrollbar: { ch: " " },
    });

    let logLines: string[] = [];
    function pushLine(line: string): void {
      logLines.push(line);
      if (logLines.length > 500) logLines.splice(0, logLines.length - 500);
      chatArea.setContent(logLines.join("\n"));
      chatArea.setScrollPerc(100);
    }

    for (const line of buildLogoLines(screen.width as number)) pushLine(line);
    pushLine("");
    pushLine(fg(T.textMuted, "Welcome! Type a goal to run, or /help for commands."));
    pushLine("");

    const inputBorder = blessed.box({
      parent: mainArea, bottom: 1, left: 0, width: "100%", height: 1,
      style: { bg: T.bgElement }, tags: true,
    });

    const inputArea = blessed.box({
      parent: mainArea, bottom: 1, left: 1, width: "100%-1", height: 1,
      style: { bg: T.bgElement, fg: T.text }, tags: true, padding: { left: 2, right: 2 },
    });

    const inputMeta = blessed.box({
      parent: mainArea, bottom: 2, left: 0, width: "100%", height: 1,
      style: { bg: T.bgPanel, fg: T.textMuted }, tags: true, padding: { left: 3, right: 2 },
    });

    const footer = blessed.box({
      parent: mainArea, bottom: 0, left: 0, width: "100%", height: 1,
      style: { bg: T.bg, fg: T.textMuted }, tags: true, padding: { left: 3, right: 2 },
    });

    const autoCompleteBox = blessed.box({
      parent: screen, bottom: 4, left: 3, width: "45%", height: 0, hidden: true,
      style: { bg: T.bgMenu, fg: T.text }, border: { type: "line", fg: T.border as any },
      tags: true, label: " Commands ", padding: { left: 1, right: 1 },
    });

    function renderInput(): void {
      const agent = AGENT_ROLES.find((a) => a.id === currentAgentRole);
      const borderColor = agent?.color ?? T.primary;
      inputBorder.setContent(fg(borderColor, "┃"));
      inputArea.setContent(inputBuf || fg(T.textMuted, "Ask anything..."));
      const cfg = loadChatConfig(options.cwd);
      const modelName = cfg.model.length > 28 ? cfg.model.slice(0, 25) + "…" : cfg.model;
      inputMeta.setContent(
        fg(T.textMuted, "  " + (agent?.name ?? "Build") + " · " + modelName),
      );
      renderFooter();
      screen.render();
      const cursorCol = 3 + displayWidth(inputBuf.slice(0, cursorPos));
      const termHeight = screen.height as number;
      try { screen.program.cup(termHeight - 2, cursorCol); screen.program.showCursor(); } catch {}
    }

    function renderFooter(): void {
      const shortCwd = options.cwd.split(/[/\\]/).slice(-2).join("/");
      footer.setContent(fg(T.textMuted, shortCwd + "  ·  /help  ·  F2 model  ·  Ctrl+B  ·  Ctrl+N"));
    }

    function renderSidebar(): void {
      if (!sidebarVisible) { sidebar.hide(); mainArea.width = "100%"; return; }
      sidebar.show();
      mainArea.width = "100%-" + SIDEBAR_WIDTH;
      const cfg = loadChatConfig(options.cwd);
      const agent = AGENT_ROLES.find((a) => a.id === currentAgentRole);
      const shortCwd = options.cwd.split(/[/\\]/).slice(-2).join("/");
      const backendLabel = options.backend ?? "mock";
      const lines = [
        bold(fg(T.text, "CoAgent")), fg(T.textMuted, "v" + VERSION), "",
        fg(T.textMuted, "─── Backend ───"), fg(T.secondary, backendLabel), "",
        fg(T.textMuted, "─── Model ───"), fg(agent?.color ?? T.primary, cfg.provider + "/" + cfg.model), "",
        fg(T.textMuted, "─── Agent ───"), fg(agent?.color ?? T.primary, agent?.name ?? currentAgentRole),
        fg(T.textMuted, agent?.desc ?? ""), "",
        fg(T.textMuted, "─── Hub ───"),
        hubStatus === "online" ? fg(T.success, "● online") : fg(T.textMuted, "○ offline"),
        hubBridge?.connected ? fg(T.textMuted, "you: " + hubBridge.selfName) : "", "",
        fg(T.textMuted, "─── Peers ───"),
      ];
      const peers = hubBridge?.connected ? hubBridge.peerList : [];
      if (!hubBridge?.connected) {
        lines.push(fg(T.textMuted, "Hub not running"));
        lines.push(fg(T.textMuted, "start: coagent hub"));
      } else if (peers.length === 0) {
        lines.push(fg(T.textMuted, "(no other agents)"));
      } else {
        for (const peer of peers) {
          const icon = peer.status === "busy" ? fg(T.warning, "▶")
            : peer.status === "idle" ? fg(T.textMuted, "○")
            : fg(T.success, "●");
          const name = peer.name.length > 18 ? peer.name.slice(0, 16) + "…" : peer.name;
          lines.push(icon + " " + fg(T.text, name));
          lines.push("  " + fg(T.textMuted, peer.role));
          if (peer.currentTask) {
            const task = peer.currentTask.length > 22 ? peer.currentTask.slice(0, 20) + "…" : peer.currentTask;
            lines.push("  " + fg(T.info, task));
          }
        }
      }
      lines.push("", fg(T.textMuted, "─── Messages ───"), fg(T.text, String(messageCount)), "",
        fg(T.textMuted, "─── Directory ───"), fg(T.textMuted, shortCwd), "",
        fg(T.textMuted, "─── Shortcuts ───"),
        fg(T.textMuted, "Ctrl+N  New"), fg(T.textMuted, "Ctrl+P  Commands"),
        fg(T.textMuted, "Ctrl+L  Sessions"), fg(T.textMuted, "Ctrl+B  Sidebar"),
        fg(T.textMuted, "F2      Cycle model"), fg(T.textMuted, "Shift↵  Newline"),
      );
      sidebar.setContent(lines.join("\n"));
      screen.render();
    }

    function renderAutoComplete(): void {
      if (matchedCmds.length === 0 || !inputBuf.startsWith("/")) { hideAutoComplete(); return; }
      showingAutoComplete = true;
      const lines = matchedCmds.map((c, i) => {
        const sel = i === selectedCmdIdx;
        const name = sel ? bold(fg(T.text, c.name)) : fg(T.text, c.name);
        const desc = sel ? fg(T.text, c.description) : fg(T.textMuted, c.description);
        const alias = c.aliases?.length ? " " + fg(T.textMuted, "(" + c.aliases.join(",") + ")") : "";
        return " " + name.padEnd(14) + " " + desc + alias;
      });
      autoCompleteBox.setContent(lines.join("\n"));
      autoCompleteBox.height = Math.min(matchedCmds.length + 2, 12);
      autoCompleteBox.show();
      screen.render();
    }

    function hideAutoComplete(): void {
      showingAutoComplete = false; matchedCmds = []; selectedCmdIdx = 0; autoCompleteBox.hide();
    }

    function updateAutoComplete(): void {
      if (!inputBuf.startsWith("/")) { hideAutoComplete(); return; }
      matchedCmds = matchSlashCommands(inputBuf);
      if (matchedCmds.length === 0) { hideAutoComplete(); return; }
      selectedCmdIdx = 0; renderAutoComplete();
    }

    function applyAutoComplete(): void {
      if (!showingAutoComplete || matchedCmds.length === 0) return;
      const cmd = matchedCmds[selectedCmdIdx];
      if (cmd) { inputBuf = cmd.name + " "; cursorPos = inputBuf.length; hideAutoComplete(); renderInput(); }
    }

    function submitInput(): void {
      const line = inputBuf.trim();
      inputBuf = ""; cursorPos = 0; hideAutoComplete();
      if (line) {
        chatHistory.push(line); historyIdx = chatHistory.length; messageCount++;
        const agent = AGENT_ROLES.find((a) => a.id === currentAgentRole);
        pushLine(fg(agent?.color ?? T.primary, "┃") + " " + fg(T.text, line));
        pushLine(""); screen.render();
        if (!isProcessing) {
          isProcessing = true;
          handleCommand(line).finally(() => { isProcessing = false; renderInput(); renderSidebar(); });
        }
      }
      renderInput();
    }

    function loadSessions(): SessionEntry[] {
      const runsDir = join(options.cwd, ".coagent", "runs");
      try { if (!statSync(runsDir).isDirectory()) return []; } catch { return []; }
      const entries = readdirSync(runsDir);
      const sessions: SessionEntry[] = [];
      for (const entry of entries) {
        try {
          const raw = readFileSync(join(runsDir, entry, "run.json"), "utf-8");
          const run = JSON.parse(raw);
          sessions.push({ id: run.id, goal: run.goal ?? "", status: run.status ?? "unknown", createdAt: run.createdAt ?? "" });
        } catch {}
      }
      return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    function cycleModel(): void {
      const providers = Object.entries(getProviders());
      const current = loadChatConfig(options.cwd);
      let found = false;
      for (const [pid, provider] of providers) {
        for (let i = 0; i < provider.models.length; i++) {
          if (found) {
            saveChatConfig(options.cwd, { ...current, provider: pid, model: provider.models[i]! });
            pushLine(fg(T.success, "✓") + " Model: " + fg(T.primary, pid + "/" + provider.models[i]));
            pushLine(""); screen.render(); renderInput(); renderSidebar(); return;
          }
          if (pid === current.provider && provider.models[i] === current.model) found = true;
        }
      }
      const first = providers[0];
      if (first) {
        saveChatConfig(options.cwd, { ...current, provider: first[0], model: first[1].models[0]! });
        pushLine(fg(T.success, "✓") + " Model: " + fg(T.primary, first[0] + "/" + first[1].models[0]));
        pushLine(""); screen.render(); renderInput(); renderSidebar();
      }
    }

    async function handleCommand(line: string): Promise<void> {
      const cmd = resolveCommand(line.split(" ")[0] ?? "");
      const rest = line.includes(" ") ? line.slice(line.indexOf(" ") + 1) : "";

      if (cmd?.name === "/exit") {
        pushLine(fg(T.textMuted, "Goodbye! 👋")); screen.render();
        await hubBridge?.dispose();
        await new Promise((r) => setTimeout(r, 300)); screen.destroy(); resolve(); return;
      }

      if (cmd?.name === "/help") {
        pushLine(bold(fg(T.text, "Commands:"))); pushLine(hr());
        for (const c of SLASH_COMMANDS) {
          const alias = c.aliases ? " " + fg(T.textMuted, "(" + c.aliases.join(", ") + ")") : "";
          pushLine("  " + fg(T.text, c.name.padEnd(14)) + " " + fg(T.textMuted, c.description) + alias);
        }
        pushLine(""); pushLine(bold(fg(T.text, "Shortcuts:"))); pushLine(hr());
        const sc = [
          ["Ctrl+N", "New session"], ["Ctrl+P", "Command palette"], ["Ctrl+L", "Session list"],
          ["Ctrl+B", "Toggle sidebar"], ["F2", "Cycle model"], ["Shift+Enter", "Insert newline"],
          ["Ctrl+A/E", "Home/End"], ["Ctrl+U/K", "Delete to start/end"], ["Ctrl+Left/Right", "Word jump"],
        ];
        for (const [k, v] of sc) pushLine("  " + fg(T.text, k.padEnd(16)) + v);
        pushLine(""); screen.render(); return;
      }

      if (cmd?.name === "/new") {
        logLines = []; chatArea.setContent("");
        for (const l of buildLogoLines(screen.width as number)) pushLine(l);
        pushLine(""); pushLine(fg(T.text, "◈") + " New session started.");
        pushLine(""); messageCount = 0; screen.render(); renderSidebar(); return;
      }

      if (cmd?.name === "/sessions") {
        const sessions = loadSessions();
        if (sessions.length === 0) {
          pushLine(fg(T.textMuted, "No sessions found. Run a goal to create one."));
        } else {
          pushLine(bold(fg(T.text, "Sessions:"))); pushLine(hr());
          for (const s of sessions.slice(0, 20)) {
            const si = s.status === "completed" ? fg(T.success, "✓") : s.status === "failed" ? fg(T.error, "✗") : fg(T.warning, "○");
            const date = s.createdAt ? new Date(s.createdAt).toLocaleString() : "";
            pushLine("  " + si + " " + fg(T.text, s.id.slice(0, 20)) + " " + fg(T.textMuted, s.status));
            pushLine("    " + fg(T.textMuted, s.goal.slice(0, 60) + (s.goal.length > 60 ? "…" : "")));
            if (date) pushLine("    " + fg(T.textMuted, date));
          }
          pushLine(""); pushLine(fg(T.textMuted, "Use: coagent status <run-id> / coagent resume <run-id>"));
        }
        pushLine(""); screen.render(); return;
      }

      if (cmd?.name === "/status") {
        const run = await orchestrator.status();
        if (!run) { pushLine(fg(T.textMuted, "📭 No runs yet.")); pushLine(""); }
        else printRun(run);
        screen.render(); return;
      }

      if (cmd?.name === "/model") {
        const parts = rest.split(/\s+/).filter(Boolean);
        if (parts.length >= 1) {
          const providers = getProviders();
          const modelCfg = loadChatConfig(options.cwd);

          if (parts[0] === "key" && parts[1]) {
            saveChatConfig(options.cwd, { ...modelCfg, apiKey: parts[1] });
            pushLine(fg(T.success, "✓") + " API key saved to .coagent/chat.json");
          } else if (providers[parts[0]]) {
            const provider = providers[parts[0]];
            const model = parts[1] && provider.models.includes(parts[1]) ? parts[1] : provider.models[0]!;
            const apiKey = parts[2] ?? modelCfg.apiKey;
            saveChatConfig(options.cwd, { provider: parts[0], model, apiKey });
            pushLine(fg(T.success, "✓") + " Provider: " + fg(T.primary, parts[0]) + "  Model: " + fg(T.primary, model));
            if (apiKey) pushLine(fg(T.textMuted, "  API key configured."));
            else {
              const envKey = provider.envKey;
              pushLine(fg(T.textMuted, "  Set API key: /model key <your-key>  or  export " + envKey + "=sk-xxx"));
            }
          } else {
            const resolved = resolveModelInput(rest);
            if (resolved) {
              const cfg = loadChatConfig(options.cwd);
              saveChatConfig(options.cwd, { ...cfg, provider: resolved.provider, model: resolved.model });
              pushLine(fg(T.success, "✓") + " Model: " + fg(T.primary, resolved.provider + "/" + resolved.model));
            } else {
              pushLine(fg(T.error, "✗") + " Unknown: " + rest);
              pushLine(fg(T.textMuted, "  Usage: /model <provider> [model] [api-key]"));
              pushLine(fg(T.textMuted, "  Or:    /model key <api-key>"));
              pushLine(fg(T.textMuted, "  Example: /model deepseek deepseek-chat sk-xxx"));
            }
          }
        } else {
          const cfg = loadChatConfig(options.cwd);
          const providers = getProviders();
          const provider = providers[cfg.provider];
          const hasKey = !!resolveApiKey(options.cwd);
          pushLine(fg(T.text, "◈") + " Current: " + fg(T.primary, cfg.provider + "/" + cfg.model));
          pushLine("  API key: " + (hasKey ? fg(T.success, "✓ configured") : fg(T.error, "✗ missing")));
          if (!hasKey && provider) {
            pushLine(fg(T.textMuted, "  Set: /model key <key>  or  export " + provider.envKey + "=sk-xxx"));
          }
          pushLine(""); pushLine(fg(T.text, "Providers:"));
          for (const [id, p] of Object.entries(providers)) {
            pushLine("  " + fg(T.secondary, id) + " " + fg(T.textMuted, "(" + p.name + ")"));
            for (const m of p.models) {
              const marker = id === cfg.provider && m === cfg.model ? " " + fg(T.success, "← current") : "";
              pushLine("    " + fg(T.textMuted, id + "/" + m) + marker);
            }
          }
          pushLine("");
          pushLine(fg(T.textMuted, "Usage: /model <provider> [model] [api-key]"));
          pushLine(fg(T.textMuted, "       /model key <api-key>"));
        }
        pushLine(""); screen.render(); renderInput(); renderSidebar(); return;
      }

      if (cmd?.name === "/agents") {
        if (rest) {
          const found = AGENT_ROLES.find((a) => a.id === rest.toLowerCase() || a.name.toLowerCase() === rest.toLowerCase());
          if (found) {
            currentAgentRole = found.id;
            pushLine(fg(T.success, "✓") + " Agent: " + fg(found.color, found.name) + " — " + found.desc);
          } else { pushLine(fg(T.error, "✗") + " Unknown agent: " + rest); }
        } else {
          pushLine(bold(fg(T.text, "Agents:")));
          for (const a of AGENT_ROLES) {
            const marker = a.id === currentAgentRole ? " " + fg(T.success, "← current") : "";
            pushLine("  " + fg(a.color, a.id.padEnd(14)) + " " + fg(T.text, a.name) + " " + fg(T.textMuted, "— " + a.desc) + marker);
          }
          pushLine(""); pushLine(fg(T.textMuted, "Usage: /agents <role>"));
        }
        pushLine(""); screen.render(); renderInput(); renderSidebar(); return;
      }

      if (cmd?.name === "/theme") {
        pushLine(fg(T.textMuted, "Theme is fixed to OpenCode dark.")); pushLine("");
        screen.render(); return;
      }

      if (cmd?.name === "/peers") {
        if (!hubBridge?.connected) {
          pushLine(fg(T.warning, "○") + " Hub not running — start it with: " + fg(T.text, "coagent hub"));
        } else {
          const peers = hubBridge.peerList;
          if (peers.length === 0) {
            pushLine(fg(T.textMuted, "No other agents connected yet."));
          } else {
            pushLine(bold(fg(T.text, "Peers (" + peers.length + " online):")));
            for (const peer of peers) {
              const icon = peer.status === "busy" ? fg(T.warning, "▶")
                : peer.status === "idle" ? fg(T.textMuted, "○")
                : fg(T.success, "●");
              pushLine("  " + icon + " " + fg(T.text, peer.name) + "  " + fg(T.textMuted, "[" + peer.role + "] " + peer.status));
              if (peer.currentTask) pushLine("      ▸ " + fg(T.info, peer.currentTask));
              if (peer.goal) pushLine("      goal: " + fg(T.textMuted, peer.goal.slice(0, 60)));
            }
          }
        }
        pushLine(""); screen.render(); return;
      }

      if (cmd?.name === "/compact") {
        const total = logLines.length;
        if (total > 50) {
          logLines = []; chatArea.setContent("");
          pushLine(fg(T.textMuted, "◈ Compacted " + total + " lines → kept last 20 messages"));
          pushLine("");
        } else { pushLine(fg(T.text, "◈") + " Already compact."); pushLine(""); }
        screen.render(); return;
      }

      if (cmd?.name === "/diff") {
        const run = await orchestrator.status();
        if (!run) { pushLine(fg(T.textMuted, "No runs yet.")); }
        else {
          const changedFiles = new Set<string>();
          for (const ar of run.agentRuns) for (const f of ar.diffFiles) changedFiles.add(f);
          if (changedFiles.size === 0) { pushLine(fg(T.textMuted, "No file changes.")); }
          else {
            pushLine(bold(fg(T.text, "Changed (" + changedFiles.size + "):")));
            for (const f of [...changedFiles].sort()) pushLine("  " + fg(T.diffAdded, f));
          }
        }
        pushLine(""); screen.render(); return;
      }

      if (cmd?.name === "/config") {
        const configPath = findConfigFile(options.cwd);
        if (configPath) {
          pushLine(fg(T.text, "◈") + " Config: " + fg(T.secondary, configPath));
          try {
            const raw = readFileSync(configPath, "utf-8");
            pushLine(hr());
            for (const ln of raw.split("\n")) pushLine("  " + fg(T.textMuted, ln));
          } catch { pushLine(fg(T.error, "✗") + " Could not read config."); }
        } else { pushLine(fg(T.textMuted, "No config file. Use /model to create one.")); }
        pushLine(""); screen.render(); return;
      }

      if (cmd?.name === "/plan") {
        if (!rest) { pushLine(fg(T.error, "✗") + " /plan requires a goal. Usage: /plan <goal>"); pushLine(""); screen.render(); return; }
        pushLine(fg(T.text, "◈") + " Planning: " + rest); pushLine(hr());
        screen.render();
        try { const run = await orchestrator.plan(rest); printRun(run); }
        catch (error) { pushLine(fg(T.error, "✗ Error: " + (error instanceof Error ? error.message : String(error)))); }
        screen.render(); return;
      }

      if (cmd?.name === "/run") {
        if (!rest) { pushLine(fg(T.error, "✗") + " /run requires a goal. Usage: /run <goal>"); pushLine(""); screen.render(); return; }
        await orchestrateRun(rest); return;
      }

      if (line.startsWith("/")) {
        pushLine(fg(T.error, "✗") + " Unknown command: " + line + ". Type " + fg(T.text, "/help") + " for commands.");
        pushLine(""); screen.render(); return;
      }

      await runGoal(line);
    }

    const conversationHistory: ChatMessage[] = [];

    async function runGoal(goal: string): Promise<void> {
      conversationHistory.push({ role: "user", content: goal });


      try {
        const apiKey = resolveApiKey(options.cwd);
        if (!apiKey) {
          const cfg = loadChatConfig(options.cwd);
          const providers = getProviders();
          const provider = providers[cfg.provider];
          pushLine(fg(T.error, "✗") + " No API key for " + fg(T.text, cfg.provider) + ".");

          pushLine(fg(T.textMuted, "  Set " + (provider?.envKey ?? "API_KEY") + " env var or use:"));
          pushLine(fg(T.textMuted, "  /model " + cfg.provider + " <model> <api-key>"));
          pushLine("");
          conversationHistory.pop();
          screen.render();
          return;
        }

        pushLine(fg(T.textMuted, "  ⠋ Thinking…"));
        screen.render();

        let assistantText = "";
        const thinkingLineIdx = logLines.length - 1;

        const result = await chat(conversationHistory, options.cwd, (token) => {
          assistantText += token;
          logLines[thinkingLineIdx] = fg(T.secondary, "┃") + " " + fg(T.text, assistantText);
          chatArea.setContent(logLines.join("\n"));
          chatArea.setScrollPerc(100);
          screen.render();
        });

        if (!result) {
          logLines[thinkingLineIdx] = fg(T.error, "✗") + " Empty response from API.";
        }

        conversationHistory.push({ role: "assistant", content: result });
        pushLine("");
        screen.render();
      } catch (error) {
        pushLine(fg(T.error, "✗ " + (error instanceof Error ? error.message : String(error))));
        pushLine("");
        conversationHistory.pop();
        screen.render();
      }
    }

    async function orchestrateRun(goal: string): Promise<void> {
      pushLine(fg(T.text, "◈") + " Orchestrating: " + goal);
      pushLine(fg(T.textMuted, "🎭 planner → explorer → implementer → reviewer + tester → integrator"));
      pushLine(hr()); screen.render();
      try {
        const run = await orchestrator.run(goal);
        pushLine(""); printRun(run);
      } catch (error) {
        pushLine(fg(T.error, "✗ Error: " + (error instanceof Error ? error.message : String(error))));
      }
      pushLine(""); screen.render();
    }

    function printRun(run: import("../core/types.js").CoAgentRun): void {
      const badge = run.status === "completed" ? fg(T.success, "✓")
        : run.status === "failed" ? fg(T.error, "✗")
        : run.status === "blocked" ? fg(T.warning, "⊘") : "·";
      pushLine(badge + " Finished: " + run.id.slice(0, 12) + "…");
      pushLine("  Goal:   " + run.goal);
      pushLine("  Status: " + fg(T.textMuted, run.status));
      if (run.mergePlan) pushLine("  Merge:  " + fg(T.textMuted, run.mergePlan.status + (run.mergePlan.conflicts.length > 0 ? " (" + run.mergePlan.conflicts.length + " conflicts)" : "")));
      if (run.riskReport) pushLine("  Risk:   " + fg(T.textMuted, run.riskReport.status + " (" + (run.riskReport.risks?.length ?? 0) + " risks)"));
      pushLine("  Tasks:");
      for (const task of run.taskGraph.tasks) {
        const agent = AGENT_ROLES.find((a) => a.id === task.role);
        const tBadge = task.status === "completed" ? fg(T.success, "✓")
          : task.status === "failed" ? fg(T.error, "✗")
          : task.status === "running" ? fg(agent?.color ?? T.text, "▶") : "·";
        pushLine("    " + tBadge + " " + fg(agent?.color ?? T.textMuted, task.role.padEnd(11)) + " " + task.title);
      }
    }

    // ── Key handler ─────────────────────────────────────────

    screen.program.on("keypress", (ch: string, key: any) => {
      if (!key) return;

      if (key.full === "C-c") { screen.destroy(); hubBridge?.dispose(); resolve(); return; }
      if (key.full === "escape") {
        if (showingAutoComplete) { hideAutoComplete(); renderInput(); return; }
        screen.destroy(); hubBridge?.dispose(); resolve(); return;
      }

      if (key.full === "C-n") { handleCommand("/new"); return; }
      if (key.full === "C-p") { inputBuf = "/"; cursorPos = 1; updateAutoComplete(); renderInput(); return; }
      if (key.full === "C-l") { handleCommand("/sessions"); return; }
      if (key.full === "C-b") { sidebarVisible = !sidebarVisible; renderSidebar(); renderInput(); return; }
      if (key.name === "f2") { cycleModel(); return; }

      if (showingAutoComplete) {
        if (key.name === "up") { selectedCmdIdx = Math.max(0, selectedCmdIdx - 1); renderAutoComplete(); return; }
        if (key.name === "down") { selectedCmdIdx = Math.min(matchedCmds.length - 1, selectedCmdIdx + 1); renderAutoComplete(); return; }
        if (key.name === "return" || key.name === "tab") { applyAutoComplete(); return; }
        if (key.full === "escape") { hideAutoComplete(); renderInput(); return; }
      }

      if (key.name === "tab" && !showingAutoComplete) {
        if (inputBuf.startsWith("/") && matchedCmds.length > 0) applyAutoComplete(); return;
      }

      if (key.name === "return" || key.name === "enter") {
        if (key.shift) { inputBuf = inputBuf.slice(0, cursorPos) + "\n" + inputBuf.slice(cursorPos); cursorPos++; renderInput(); return; }
        if (inputBuf.startsWith("/")) {
          const matches = matchSlashCommands(inputBuf.trim());
          const exact = resolveCommand(inputBuf.trim());
          if (!exact && matches.length > 0) {
            selectedCmdIdx = 0; matchedCmds = matches; showingAutoComplete = true; applyAutoComplete(); return;
          }
        }
        submitInput(); return;
      }

      if (key.name === "backspace") {
        if (key.ctrl) {
          const before = inputBuf.slice(0, cursorPos);
          const wordEnd = before.search(/\S\s*$/);
          const cutTo = wordEnd >= 0 ? wordEnd + 1 : 0;
          inputBuf = inputBuf.slice(0, cutTo) + inputBuf.slice(cursorPos); cursorPos = cutTo;
        } else if (cursorPos > 0) { inputBuf = inputBuf.slice(0, cursorPos - 1) + inputBuf.slice(cursorPos); cursorPos--; }
        updateAutoComplete(); renderInput(); return;
      }

      if (key.name === "delete") {
        if (cursorPos < inputBuf.length) { inputBuf = inputBuf.slice(0, cursorPos) + inputBuf.slice(cursorPos + 1); updateAutoComplete(); renderInput(); }
        return;
      }

      if (key.full === "C-u") { inputBuf = inputBuf.slice(cursorPos); cursorPos = 0; updateAutoComplete(); renderInput(); return; }
      if (key.full === "C-k") { inputBuf = inputBuf.slice(0, cursorPos); updateAutoComplete(); renderInput(); return; }

      if (key.name === "left") {
        if (key.ctrl) { const before = inputBuf.slice(0, cursorPos).replace(/\s+$/, ""); const m = before.match(/\S*$/); cursorPos = m ? m.index ?? cursorPos : cursorPos; }
        else if (cursorPos > 0) cursorPos--;
        renderInput(); return;
      }
      if (key.name === "right") {
        if (key.ctrl) { const after = inputBuf.slice(cursorPos); const m = after.match(/^\S*\s*/); cursorPos += m ? m[0].length : 0; }
        else if (cursorPos < inputBuf.length) cursorPos++;
        renderInput(); return;
      }

      if (key.name === "home" || key.full === "C-a") { cursorPos = 0; renderInput(); return; }
      if (key.name === "end" || key.full === "C-e") { cursorPos = inputBuf.length; renderInput(); return; }

      if (key.name === "up" && !showingAutoComplete) {
        if (chatHistory.length > 0 && historyIdx > 0) { historyIdx--; inputBuf = chatHistory[historyIdx]; cursorPos = inputBuf.length; updateAutoComplete(); renderInput(); } return;
      }
      if (key.name === "down" && !showingAutoComplete) {
        if (historyIdx < chatHistory.length - 1) { historyIdx++; inputBuf = chatHistory[historyIdx]; }
        else { historyIdx = chatHistory.length; inputBuf = ""; }
        cursorPos = inputBuf.length; updateAutoComplete(); renderInput(); return;
      }

      if (key.name === "pageup") { chatArea.scroll(-(Math.max(5, (screen.height as number) - 5))); renderInput(); return; }
      if (key.name === "pagedown") { chatArea.scroll(Math.max(5, (screen.height as number) - 5)); renderInput(); return; }

      if (ch && ch.length === 1 && !key.ctrl && !key.meta) {
        inputBuf = inputBuf.slice(0, cursorPos) + ch + inputBuf.slice(cursorPos);
        cursorPos++; updateAutoComplete(); renderInput();
      }
    });

    screen.program.hideCursor();
    screen.program.cup(screen.height as number - 2, 3);
    screen.program.showCursor();

    chatArea.on("click", () => { renderInput(); });
    screen.on("resize", () => { renderInput(); renderSidebar(); });

    renderSidebar();
    renderInput();
  });
}
