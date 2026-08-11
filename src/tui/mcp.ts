import { spawn, type ChildProcess } from "node:child_process";

export interface McpTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export interface McpServerConfig {
	name: string;
	command: string;
	args?: string[];
	env?: Record<string, string>;
}

export class McpClient {
	private proc: ChildProcess | null = null;
	private nextId = 1;
	private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
	private buffer = "";
	readonly tools: McpTool[] = [];
	readonly name: string;

	constructor(config: McpServerConfig) {
		this.name = config.name;
		this.proc = spawn(config.command, config.args ?? [], {
			env: { ...process.env, ...config.env },
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.proc.stdout?.setEncoding("utf-8");
		this.proc.stdout?.on("data", (data: string) => this.onData(data));
		this.proc.on("error", () => {});
	}

	private onData(data: string): void {
		this.buffer += data;
		const lines = this.buffer.split("\n");
		this.buffer = lines.pop() ?? "";
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const msg = JSON.parse(trimmed);
				if (msg.id !== undefined && this.pending.has(msg.id)) {
					const p = this.pending.get(msg.id)!;
					this.pending.delete(msg.id);
					if (msg.error) p.reject(msg.error);
					else p.resolve(msg.result);
				}
			} catch {}
		}
	}

	private request(method: string, params?: unknown): Promise<unknown> {
		return new Promise((resolve, reject) => {
			if (!this.proc?.stdin?.writable) {
				reject(new Error("MCP server not connected"));
				return;
			}
			const id = this.nextId++;
			this.pending.set(id, { resolve, reject });
			this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
		});
	}

	async initialize(): Promise<void> {
		await this.request("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "coagent", version: "0.2.0" },
		});
		this.proc?.stdin?.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
	}

	async loadTools(): Promise<McpTool[]> {
		try {
			const result = await this.request("tools/list") as { tools?: McpTool[] };
			this.tools.length = 0;
			if (result?.tools) this.tools.push(...result.tools);
			return this.tools;
		} catch {
			return [];
		}
	}

	async callTool(name: string, args: Record<string, unknown>): Promise<string> {
		try {
			const result = await this.request("tools/call", { name, arguments: args }) as { content?: Array<{ type: string; text?: string }> };
			if (result?.content) {
				return result.content.map((c) => c.text ?? "").join("");
			}
			return JSON.stringify(result);
		} catch (err) {
			return "MCP error: " + String(err);
		}
	}

	close(): void {
		this.proc?.stdin?.end();
		this.proc?.kill();
		this.proc = null;
	}
}

export function loadMcpConfig(cwd: string): McpServerConfig[] {
	try {
		const { readFileSync, existsSync } = require("node:fs");
		const { join } = require("node:path");
		const configPath = join(cwd, ".coagent", "mcp.json");
		if (!existsSync(configPath)) return [];
		const raw = readFileSync(configPath, "utf-8");
		const config = JSON.parse(raw);
		if (Array.isArray(config.servers)) return config.servers;
		if (config.mcpServers) return Object.entries(config.mcpServers).map(([name, s]: [string, any]) => ({ name, ...s }));
		return [];
	} catch {
		return [];
	}
}