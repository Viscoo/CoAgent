import chalk from "chalk";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
	CombinedAutocompleteProvider,
	Container,
	Editor,
	type EditorTheme,
	Markdown,
	type MarkdownTheme,
	matchesKey,
	ProcessTerminal,
	type SlashCommand as TuiSlashCommand,
	Text,
	type TUI,
	TuiMainScreen,
} from "@earendil-works/pi-tui";
import { buildLogoLines } from "./logo.js";
import { matchSlashCommands, resolveCommand, SLASH_COMMANDS } from "./commands.js";
import { Orchestrator } from "../core/orchestrator.js";
import { MockAdapter } from "../adapters/mock-adapter.js";
import { HubBridge } from "../hub/bridge.js";
import { chat, loadChatConfig, saveChatConfig, resolveApiKey, getProviders, type ChatMessage, runAgent } from "./chat-client.js";
import { resolveModelInput, findConfigFile } from "./model-config.js";
import { loadSkills, buildSkillsSystemPrompt } from "./skills.js";
import { loadMcpConfig, McpClient, type McpServerConfig } from "./mcp.js";

const VERSION = "0.2.0";

const C = {
	text: chalk.hex("#eeeeee"),
	muted: chalk.hex("#6c7086"),
	primary: chalk.hex("#fab283"),
	secondary: chalk.hex("#7fd88f"),
	accent: chalk.hex("#9d7cd8"),
	error: chalk.hex("#e06c75"),
	warning: chalk.hex("#f5a742"),
	success: chalk.hex("#7fd88f"),
	info: chalk.hex("#56b6c2"),
	diffAdded: chalk.hex("#4fd6be"),
};

const AGENT_ROLES = [
	{ id: "planner", name: "Plan", color: C.accent, desc: "Break down goals into tasks" },
	{ id: "explorer", name: "Explore", color: C.info, desc: "Inspect repo and find risks" },
	{ id: "implementer", name: "Build", color: C.primary, desc: "Make scoped code changes" },
	{ id: "reviewer", name: "Review", color: C.secondary, desc: "Review for bugs & regressions" },
	{ id: "tester", name: "Test", color: C.success, desc: "Run verification commands" },
	{ id: "integrator", name: "Integrate", color: C.warning, desc: "Resolve conflicts, final merge" },
];

const markdownTheme: MarkdownTheme = {
	heading: (t) => chalk.bold.white(t),
	link: (t) => C.info(t),
	linkUrl: (t) => C.muted(t),
	code: (t) => C.primary(t),
	codeBlock: (t) => C.text(t),
	codeBlockBorder: (t) => C.muted(t),
	quote: (t) => C.muted(t),
	quoteBorder: (t) => C.muted(t),
	hr: (t) => C.muted(t),
	listBullet: (t) => C.primary(t),
	bold: (t) => chalk.bold.white(t),
	italic: (t) => chalk.italic(t),
	strikethrough: (t) => chalk.strikethrough(t),
	underline: (t) => chalk.underline(t),
};

const editorTheme: EditorTheme = {
	borderColor: (s) => C.primary(s),
	selectList: {
		selectedPrefix: (t) => C.primary(t),
		selectedText: (t) => chalk.bold.white(t),
		description: (t) => C.muted(t),
		scrollInfo: (t) => C.muted(t),
		noMatch: (t) => C.muted(t),
	},
};

export interface TuiOptions {
	cwd: string;
	failureRate?: number;
	concurrency?: number;
	retries?: number;
	backend?: "opencode" | "claude" | "mock";
}

interface SessionEntry {
	id: string;
	goal: string;
	status: string;
	createdAt: string;
}

export async function startTui(options: TuiOptions): Promise<void> {
	const terminal = new ProcessTerminal();
	const tui: TUI = new TuiMainScreen(terminal);
	const termWidth = () => terminal.columns ?? process.stdout.columns ?? 80;

	let currentAgentRole = "implementer";
	let messageCount = 0;
	let isProcessing = false;
	const pendingQueue: string[] = [];

	let hubBridge: HubBridge | null = null;
	let hubStatus = "connecting…";

	const messages = new Container();
	tui.addChild(messages);

	const statusLine = new Text("", 1, 0);
	tui.addChild(statusLine);

	const editor = new Editor(tui, editorTheme, { paddingX: 1 });
	editor.disableSubmit = false;
	tui.addChild(editor);

	const slashAutocomplete: TuiSlashCommand[] = SLASH_COMMANDS.map((c) => ({
		name: c.name,
		description: c.description,
	}));
	editor.setAutocompleteProvider(new CombinedAutocompleteProvider(slashAutocomplete, options.cwd));

	function addText(content: string, paddingX = 1): Text {
		const t = new Text(content, paddingX, 0);
		messages.addChild(t);
		tui.requestRender();
		return t;
	}

	function addMarkdown(content: string): Markdown {
		const md = new Markdown(content, 1, 0, markdownTheme);
		messages.addChild(md);
		tui.requestRender();
		return md;
	}

	function addBlank(): void {
		addText("");
	}

	function renderStatus(): void {
		const cfg = loadChatConfig(options.cwd);
		const agent = AGENT_ROLES.find((a) => a.id === currentAgentRole);
		const modelName = cfg.model.length > 28 ? cfg.model.slice(0, 25) + "…" : cfg.model;
		const shortCwd = options.cwd.split(/[/\\]/).slice(-2).join("/");
		const hubIcon = hubStatus === "online" ? C.success("●") : C.muted("○");
		statusLine.setText(
			C.muted(shortCwd) + "  " +
			C.muted("·") + "  " + (agent?.name ?? "Build") +
			C.muted(" · ") + modelName +
			C.muted(" · ") + hubIcon + " " + C.muted(hubStatus) +
			C.muted(" · ") + C.muted("/help"),
		);
		tui.requestRender();
	}

	for (const line of buildLogoLines(termWidth())) addText(line, 0);
	addBlank();
	addText(C.muted("Welcome! Type a goal to run, or /help for commands."));
	addBlank();

	const adapter = new MockAdapter({ failureRate: options.failureRate ?? 0 });
	const orchestrator = new Orchestrator({
		cwd: options.cwd,
		maxConcurrency: options.concurrency ?? 2,
		dryRun: false,
		adapter,
		maxRetries: options.retries ?? 2,
		onProgress: (event) => {
			hubBridge?.reportProgress(event);
			const agent = AGENT_ROLES.find((a) => a.id === event.role);
			const color = agent?.color ?? C.text;
			const icon = event.kind === "task-complete" ? C.success("✓")
				: event.kind === "task-fail" ? C.error("✗")
				: event.kind === "task-retry" ? C.warning("↻")
				: event.kind === "task-start" ? color("▶") : "·";
			const retry = (event.attempt && event.attempt > 1)
				? " " + C.warning(event.attempt + "/" + event.maxAttempts) : "";
			addText(icon + " " + event.message + retry);
			if (event.error) addText("  └─ " + C.error(event.error));
		},
	});

	HubBridge.connect({ cwd: options.cwd, role: currentAgentRole, capabilities: ["opencode", "coagent"] })
		.then((bridge) => {
			hubBridge = bridge;
			if (bridge.connected) {
				hubStatus = "online";
				bridge.onChange(() => renderStatus());
				bridge.client?.on("message", (msg: { from: string; text: string }) => {
					addText(C.info("◀ ") + C.muted("[from " + msg.from + "] ") + C.text(msg.text));
					addBlank();
					tui.requestRender();
				});
				addText(C.success("🧠") + " Hub connected as " + C.text(bridge.selfName) +
					" — " + C.muted(bridge.peerList.length + " peer(s) online"));
				addBlank();
			} else {
				hubStatus = "offline";
			}
			renderStatus();
		});

	const conversationHistory: ChatMessage[] = [];

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
					addText(C.success("✓") + " Model: " + C.primary(pid + "/" + provider.models[i]));
					addBlank();
					renderStatus();
					return;
				}
				if (pid === current.provider && provider.models[i] === current.model) found = true;
			}
		}
		const first = providers[0];
		if (first) {
			saveChatConfig(options.cwd, { ...current, provider: first[0], model: first[1].models[0]! });
			addText(C.success("✓") + " Model: " + C.primary(first[0] + "/" + first[1].models[0]));
			addBlank();
			renderStatus();
		}
	}

	async function handleSubmit(text: string): Promise<void> {
		const line = text.trim();
		if (!line) return;
		messageCount++;
		addText(C.primary("▶ " + line));

		if (isProcessing) {
			pendingQueue.push(line);
			return;
		}
		isProcessing = true;
		renderStatus();
		try {
			await handleCommand(line);
			while (pendingQueue.length > 0) {
				const next = pendingQueue.shift()!;
				messageCount++;
				addText(C.primary("▶ " + next));
				await handleCommand(next);
			}
		} finally {
			isProcessing = false;
			renderStatus();
		}
	}

	async function handleCommand(line: string): Promise<void> {
		const cmd = resolveCommand(line.split(" ")[0] ?? "");
		const rest = line.includes(" ") ? line.slice(line.indexOf(" ") + 1) : "";

		if (cmd?.name === "/exit") {
			addText(C.muted("Goodbye! 👋"));
			await hubBridge?.dispose();
			await new Promise((r) => setTimeout(r, 200));
			tui.stop();
			return;
		}

		if (cmd?.name === "/help") {
			addText(chalk.bold.white("Commands:"));
			for (const c of SLASH_COMMANDS) {
				const alias = c.aliases ? " " + C.muted("(" + c.aliases.join(", ") + ")") : "";
				addText("  " + C.text(c.name.padEnd(14)) + " " + C.muted(c.description) + alias);
			}
			addBlank();
			addText(chalk.bold.white("Shortcuts:"));
			const sc = [
				["Ctrl+N", "New session"], ["Ctrl+P", "Command palette"], ["Ctrl+L", "Session list"],
				["Ctrl+B", "Toggle sidebar"], ["F2", "Cycle model"], ["Shift+Enter", "Insert newline"],
				["Ctrl+A/E", "Home/End"], ["Ctrl+U/K", "Delete to start/end"], ["Ctrl+Left/Right", "Word jump"],
			];
			for (const [k, v] of sc) addText("  " + C.text(k.padEnd(16)) + v);
			addBlank();
			return;
		}

		if (cmd?.name === "/new") {
			const childCount = (messages as any).children?.length ?? 0;
			for (let i = 0; i < childCount; i++) {
				const child = (messages as any).children[0];
				if (child) messages.removeChild(child);
			}
			conversationHistory.length = 0;
			messageCount = 0;
			for (const l of buildLogoLines(termWidth())) addText(l, 0);
			addBlank();
			addText(C.text("◈") + " New session started.");
			addBlank();
			renderStatus();
			return;
		}

		if (cmd?.name === "/sessions") {
			const sessions = loadSessions();
			if (sessions.length === 0) {
				addText(C.muted("No sessions found. Run a goal to create one."));
			} else {
				addText(chalk.bold.white("Sessions:"));
				for (const s of sessions.slice(0, 20)) {
					const si = s.status === "completed" ? C.success("✓") : s.status === "failed" ? C.error("✗") : C.warning("○");
					const date = s.createdAt ? new Date(s.createdAt).toLocaleString() : "";
					addText("  " + si + " " + C.text(s.id.slice(0, 20)) + " " + C.muted(s.status));
					addText("    " + C.muted(s.goal.slice(0, 60) + (s.goal.length > 60 ? "…" : "")));
					if (date) addText("    " + C.muted(date));
				}
				addBlank();
				addText(C.muted("Use: coagent status <run-id> / coagent resume <run-id>"));
			}
			addBlank();
			return;
		}

		if (cmd?.name === "/status") {
			const run = await orchestrator.status();
			if (!run) { addText(C.muted("📭 No runs yet.")); addBlank(); }
			else printRun(run);
			return;
		}

		if (cmd?.name === "/model") {
			const parts = rest.split(/\s+/).filter(Boolean);
			if (parts.length >= 1) {
				const providers = getProviders();
				const modelCfg = loadChatConfig(options.cwd);

				if (parts[0] === "key" && parts[1]) {
					saveChatConfig(options.cwd, { ...modelCfg, apiKey: parts[1] });
					addText(C.success("✓") + " API key saved to .coagent/chat.json");
				} else if (providers[parts[0]]) {
					const provider = providers[parts[0]];
					const model = parts[1] && provider.models.includes(parts[1]) ? parts[1] : provider.models[0]!;
					const apiKey = parts[2] ?? modelCfg.apiKey;
					saveChatConfig(options.cwd, { provider: parts[0], model, apiKey });
					addText(C.success("✓") + " Provider: " + C.primary(parts[0]) + "  Model: " + C.primary(model));
					if (apiKey) addText(C.muted("  API key configured."));
					else addText(C.muted("  Set API key: /model key <your-key>  or  export " + provider.envKey + "=sk-xxx"));
				} else {
					const resolved = resolveModelInput(rest);
					if (resolved) {
						const cfg = loadChatConfig(options.cwd);
						saveChatConfig(options.cwd, { ...cfg, provider: resolved.provider, model: resolved.model });
						addText(C.success("✓") + " Model: " + C.primary(resolved.provider + "/" + resolved.model));
					} else {
						addText(C.error("✗") + " Unknown: " + rest);
						addText(C.muted("  Usage: /model <provider> [model] [api-key]"));
						addText(C.muted("  Or:    /model key <api-key>"));
						addText(C.muted("  Example: /model deepseek deepseek-chat sk-xxx"));
					}
				}
			} else {
				const cfg = loadChatConfig(options.cwd);
				const providers = getProviders();
				const provider = providers[cfg.provider];
				const hasKey = !!resolveApiKey(options.cwd);
				addText(C.text("◈") + " Current: " + C.primary(cfg.provider + "/" + cfg.model));
				addText("  API key: " + (hasKey ? C.success("✓ configured") : C.error("✗ missing")));
				if (!hasKey && provider) {
					addText(C.muted("  Set: /model key <key>  or  export " + provider.envKey + "=sk-xxx"));
				}
				addBlank();
				addText(C.text("Providers:"));
				for (const [id, p] of Object.entries(providers)) {
					addText("  " + C.secondary(id) + " " + C.muted("(" + p.name + ")"));
					for (const m of p.models) {
						const marker = id === cfg.provider && m === cfg.model ? " " + C.success("← current") : "";
						addText("    " + C.muted(id + "/" + m) + marker);
					}
				}
				addBlank();
				addText(C.muted("Usage: /model <provider> [model] [api-key]"));
				addText(C.muted("       /model key <api-key>"));
			}
			addBlank();
			renderStatus();
			return;
		}

		if (cmd?.name === "/agents") {
			if (rest) {
				const found = AGENT_ROLES.find((a) => a.id === rest.toLowerCase() || a.name.toLowerCase() === rest.toLowerCase());
				if (found) {
					currentAgentRole = found.id;
					addText(C.success("✓") + " Agent: " + found.color(found.name) + " — " + found.desc);
					editor.borderColor = found.color;
				} else { addText(C.error("✗") + " Unknown agent: " + rest); }
			} else {
				addText(chalk.bold.white("Agents:"));
				for (const a of AGENT_ROLES) {
					const marker = a.id === currentAgentRole ? " " + C.success("← current") : "";
					addText("  " + a.color(a.id.padEnd(14)) + " " + C.text(a.name) + " " + C.muted("— " + a.desc) + marker);
				}
				addBlank();
				addText(C.muted("Usage: /agents <role>"));
			}
			addBlank();
			renderStatus();
			return;
		}

		if (cmd?.name === "/theme") {
			addText(C.muted("Theme is fixed to CoAgent dark."));
			addBlank();
			return;
		}

		if (cmd?.name === "/peers") {
			if (!hubBridge?.connected) {
				addText(C.warning("○") + " Hub not running — start it with: " + C.text("coagent hub"));
			} else {
				const peers = hubBridge.peerList;
				if (peers.length === 0) {
					addText(C.muted("No other agents connected yet."));
				} else {
					addText(chalk.bold.white("Peers (" + peers.length + " online):"));
					for (const peer of peers) {
						const icon = peer.status === "busy" ? C.warning("▶")
							: peer.status === "idle" ? C.muted("○")
							: C.success("●");
						addText("  " + icon + " " + C.text(peer.name) + "  " + C.muted("[" + peer.role + "] " + peer.status));
						if (peer.currentTask) addText("      ▸ " + C.info(peer.currentTask));
						if (peer.goal) addText("      goal: " + C.muted(peer.goal.slice(0, 60)));
					}
				}
			}
			addBlank();
			return;
		}

		if (cmd?.name === "/msg") {
			if (!hubBridge?.connected) {
				addText(C.error("✗") + " Not connected to Hub. Start it with " + C.text("coagent hub"));
				addBlank();
				return;
			}
			const parts = rest.split(/\s+/);
			const peerName = parts[0];
			const msgText = parts.slice(1).join(" ");
			if (!peerName || !msgText) {
				addText(C.error("✗") + " Usage: /msg <peer-name> <message>");
				addBlank();
				return;
			}
			const peers = hubBridge.peerList;
			const peer = peers.find((p) => p.name === peerName || p.id === peerName);
			if (!peer) {
				addText(C.error("✗") + " Peer not found: " + peerName);
				addText(C.muted("  Use /peers to list connected agents"));
				addBlank();
				return;
			}
			hubBridge.client?.sendToAgent(peer.id, msgText);
			addText(C.primary("▶ ") + C.muted("[to " + peer.name + "] ") + C.text(msgText));
			addBlank();
			return;
		}

		if (cmd?.name === "/broadcast") {
			if (!hubBridge?.connected) {
				addText(C.error("✗") + " Not connected to Hub.");
				addBlank();
				return;
			}
			if (!rest) {
				addText(C.error("✗") + " Usage: /broadcast <message>");
				addBlank();
				return;
			}
			hubBridge.client?.broadcast(rest);
			addText(C.primary("▶ ") + C.muted("[broadcast] ") + C.text(rest));
			addBlank();
			return;
		}

		if (cmd?.name === "/compact") {
			addText(C.muted("◈ Compacted conversation history."));
			conversationHistory.length = 0;
			addBlank();
			return;
		}

		if (cmd?.name === "/diff") {
			const run = await orchestrator.status();
			if (!run) { addText(C.muted("No runs yet.")); }
			else {
				const changedFiles = new Set<string>();
				for (const ar of run.agentRuns) for (const f of ar.diffFiles) changedFiles.add(f);
				if (changedFiles.size === 0) { addText(C.muted("No file changes.")); }
				else {
					addText(chalk.bold.white("Changed (" + changedFiles.size + "):"));
					for (const f of [...changedFiles].sort()) addText("  " + C.diffAdded(f));
				}
			}
			addBlank();
			return;
		}

		if (cmd?.name === "/config") {
			const configPath = findConfigFile(options.cwd);
			if (configPath) {
				addText(C.text("◈") + " Config: " + C.secondary(configPath));
				try {
					const raw = readFileSync(configPath, "utf-8");
					for (const ln of raw.split("\n")) addText("  " + C.muted(ln));
				} catch { addText(C.error("✗") + " Could not read config."); }
			} else { addText(C.muted("No config file. Use /model to create one.")); }
			addBlank();
			return;
		}

		if (cmd?.name === "/plan") {
			if (!rest) { addText(C.error("✗") + " /plan requires a goal. Usage: /plan <goal>"); addBlank(); return; }
			addText(C.text("◈") + " Planning: " + rest);
			try { const run = await orchestrator.plan(rest); printRun(run); }
			catch (error) { addText(C.error("✗ Error: " + (error instanceof Error ? error.message : String(error)))); }
			return;
		}

		if (cmd?.name === "/run") {
			if (!rest) { addText(C.error("✗") + " /run requires a goal. Usage: /run <goal>"); addBlank(); return; }
			await orchestrateRun(rest);
			return;
		}

		if (line.startsWith("/")) {
			addText(C.error("✗") + " Unknown command: " + line + ". Type " + C.text("/help") + " for commands.");
			addBlank();
			return;
		}

		await runGoal(line);
	}

	async function runGoal(goal: string): Promise<void> {
		const skills = loadSkills(options.cwd);
		const skillsPrompt = buildSkillsSystemPrompt(skills);
		if (skillsPrompt && !conversationHistory.some((m) => m.role === "system" && m.content.includes("Available Skills"))) {
			conversationHistory.unshift({ role: "system", content: skillsPrompt + "\n\nYou are a coding agent with tools: read, write, edit, bash, grep. Use them to help the user. When done, respond directly." });
		}
		conversationHistory.push({ role: "user", content: goal });

		try {
			const apiKey = resolveApiKey(options.cwd);
			if (!apiKey) {
				const cfg = loadChatConfig(options.cwd);
				const providers = getProviders();
				const provider = providers[cfg.provider];
				addText(C.error("✗") + " No API key for " + C.text(cfg.provider) + ".");
				addText(C.muted("  Set " + (provider?.envKey ?? "API_KEY") + " env var or use:"));
				addText(C.muted("  /model " + cfg.provider + " <model> <api-key>"));
				addBlank();
				conversationHistory.pop();
				return;
			}

			const thinkingText = addText(C.muted("  ⠋ Thinking…"));

			let assistantText = "";
			let lastRender = 0;

			const result = await runAgent(conversationHistory, options.cwd, undefined, {
				onText: (token) => {
					assistantText += token;
					const now = Date.now();
					if (now - lastRender < 60) return;
					lastRender = now;
					thinkingText.setText(C.secondary("● ") + C.text(assistantText));
					tui.requestRender();
				},
				onToolCall: (call) => {
					const argPreview = call.arguments.length > 60 ? call.arguments.slice(0, 60) + "…" : call.arguments;
					addText(C.warning("⚙ ") + C.text(call.name) + C.muted(argPreview));
					tui.requestRender();
				},
				onToolResult: (call, res) => {
					const icon = res.isError ? C.error("✗") : C.success("✓");
					const lines = res.content.split("\n");
					let preview: string;
					if (lines.length <= 3) {
						preview = res.content.length > 150 ? res.content.slice(0, 150) + "…" : res.content;
					} else {
						preview = lines.slice(0, 3).join("\n") + `\n… (${lines.length} lines)`;
					}
					addText("  " + icon + " " + C.muted(preview));
					tui.requestRender();
				},
			});

			if (!result) {
				thinkingText.setText(C.error("✗") + " Empty response from API.");
			} else {
				thinkingText.setText(C.secondary("● ") + C.text(result));
			}

			conversationHistory.push({ role: "assistant", content: result });
			addBlank();
		} catch (error) {
			addText(C.error("✗ " + (error instanceof Error ? error.message : String(error))));
			addBlank();
			conversationHistory.pop();
		}
	}

	async function orchestrateRun(goal: string): Promise<void> {
		addText(C.text("◈") + " Orchestrating: " + goal);
		addText(C.muted("🎭 planner → explorer → implementer → reviewer + tester → integrator"));
		try {
			const run = await orchestrator.run(goal);
			addBlank();
			printRun(run);
		} catch (error) {
			addText(C.error("✗ Error: " + (error instanceof Error ? error.message : String(error))));
		}
		addBlank();
	}

	function printRun(run: import("../core/types.js").CoAgentRun): void {
		const badge = run.status === "completed" ? C.success("✓")
			: run.status === "failed" ? C.error("✗")
			: run.status === "blocked" ? C.warning("⊘") : "·";
		addText(badge + " Finished: " + run.id.slice(0, 12) + "…");
		addText("  Goal:   " + run.goal);
		addText("  Status: " + C.muted(run.status));
		if (run.mergePlan) addText("  Merge:  " + C.muted(run.mergePlan.status + (run.mergePlan.conflicts.length > 0 ? " (" + run.mergePlan.conflicts.length + " conflicts)" : "")));
		if (run.riskReport) addText("  Risk:   " + C.muted(run.riskReport.status + " (" + (run.riskReport.risks?.length ?? 0) + " risks)"));
		addText("  Tasks:");
		for (const task of run.taskGraph.tasks) {
			const agent = AGENT_ROLES.find((a) => a.id === task.role);
			const tBadge = task.status === "completed" ? C.success("✓")
				: task.status === "failed" ? C.error("✗")
				: task.status === "running" ? (agent?.color ?? C.text)("▶") : "·";
			addText("    " + tBadge + " " + (agent?.color ?? C.muted)(task.role.padEnd(11)) + " " + task.title);
		}
	}

	editor.onSubmit = (text) => { void handleSubmit(text); };

	tui.addInputListener((data) => {
		if (matchesKey(data, "ctrl+c")) {
			void (async () => {
				await hubBridge?.dispose();
				tui.stop();
			})();
			return { consume: true };
		}
		if (matchesKey(data, "escape")) {
			void (async () => {
				await hubBridge?.dispose();
				tui.stop();
			})();
			return { consume: true };
		}
		if (matchesKey(data, "ctrl+n")) {
			void handleCommand("/new");
			return { consume: true };
		}
		if (matchesKey(data, "ctrl+l")) {
			void handleCommand("/sessions");
			return { consume: true };
		}
		if (matchesKey(data, "ctrl+b")) {
			addText(C.muted("Sidebar toggle (use /peers to view agents)"));
			addBlank();
			return { consume: true };
		}
		if (matchesKey(data, "f2")) {
			cycleModel();
			return { consume: true };
		}
		return undefined;
	});

	renderStatus();
	tui.setFocus(editor);
	tui.start();
}
