import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { execSync } from "node:child_process";

export interface ToolDef {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	execute: (args: Record<string, unknown>, cwd: string) => Promise<ToolResult>;
}

export interface ToolResult {
	content: string;
	isError?: boolean;
}

function safePath(p: string, cwd: string): string {
	const resolved = isAbsolute(p) ? p : join(cwd, p);
	const normalized = resolve(resolved);
	const normalizedCwd = resolve(cwd);
	if (!normalized.startsWith(normalizedCwd)) {
		throw new Error("Path outside workspace: " + p);
	}
	return normalized;
}

const readTool: ToolDef = {
	name: "read",
	description: "Read the content of a file. Returns the file content as text.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string", description: "File path (relative to workspace or absolute)" },
		},
		required: ["path"],
	},
	async execute(args, cwd) {
		const p = safePath(String(args.path), cwd);
		if (!existsSync(p)) return { content: "File not found: " + args.path, isError: true };
		const stat = statSync(p);
		if (stat.isDirectory()) {
			const entries = readdirSync(p).map((e) => e + (statSync(join(p, e)).isDirectory() ? "/" : ""));
			return { content: entries.join("\n") };
		}
		const content = readFileSync(p, "utf-8");
		return { content };
	},
};

const writeTool: ToolDef = {
	name: "write",
	description: "Write content to a file. Creates the file if it does not exist, overwrites if it does.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string", description: "File path (relative to workspace or absolute)" },
			content: { type: "string", description: "Content to write" },
		},
		required: ["path", "content"],
	},
	async execute(args, cwd) {
		const p = safePath(String(args.path), cwd);
		writeFileSync(p, String(args.content), "utf-8");
		return { content: "Wrote " + relative(cwd, p) + " (" + String(args.content).length + " bytes)" };
	},
};

const editTool: ToolDef = {
	name: "edit",
	description: "Replace a string in a file. Fails if oldString is not found or not unique.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string", description: "File path" },
			oldString: { type: "string", description: "Exact string to replace" },
			newString: { type: "string", description: "Replacement string" },
		},
		required: ["path", "oldString", "newString"],
	},
	async execute(args, cwd) {
		const p = safePath(String(args.path), cwd);
		if (!existsSync(p)) return { content: "File not found: " + args.path, isError: true };
		const original = readFileSync(p, "utf-8");
		const oldStr = String(args.oldString);
		const newStr = String(args.newString);
		const count = original.split(oldStr).length - 1;
		if (count === 0) return { content: "oldString not found", isError: true };
		if (count > 1) return { content: "oldString not unique (" + count + " matches)", isError: true };
		writeFileSync(p, original.replace(oldStr, newStr), "utf-8");
		return { content: "Edited " + relative(cwd, p) };
	},
};

const bashTool: ToolDef = {
	name: "bash",
	description: "Execute a shell command in the workspace directory. Returns stdout+stderr.",
	parameters: {
		type: "object",
		properties: {
			command: { type: "string", description: "Shell command to execute" },
		},
		required: ["command"],
	},
	async execute(args, cwd) {
		try {
			const isWin = process.platform === "win32";
			const out = execSync(String(args.command), {
				cwd,
				encoding: "utf-8",
				timeout: 30000,
				maxBuffer: 1024 * 1024,
				stdio: ["pipe", "pipe", "pipe"],
				shell: isWin ? "powershell.exe" : true,
			});
			return { content: out.trim() || "(no output)" };
		} catch (err: any) {
			const msg = (err.stdout ?? "") + (err.stderr ?? "") + (err.message ?? "");
			return { content: msg.trim() || "Command failed", isError: true };
		}
	},
};

const grepTool: ToolDef = {
	name: "grep",
	description: "Search file contents with a regex pattern. Returns matching lines with file:line prefixes.",
	parameters: {
		type: "object",
		properties: {
			pattern: { type: "string", description: "Regex pattern" },
			path: { type: "string", description: "Directory or file to search (default: workspace root)" },
		},
		required: ["pattern"],
	},
	async execute(args, cwd) {
		const target = args.path ? safePath(String(args.path), cwd) : cwd;
		const pattern = String(args.pattern);
		try {
			const cmd = `rg -n --no-heading "${pattern.replace(/"/g, '\\"')}" "${target}" 2>nul`;
			const out = execSync(cmd, { encoding: "utf-8", timeout: 15000, maxBuffer: 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
			return { content: out.trim() || "No matches" };
		} catch (err: any) {
			const out = (err.stdout ?? "").toString().trim();
			if (out) return { content: out };
			return { content: "No matches (or rg not available)", isError: true };
		}
	},
};

export const builtinTools: ToolDef[] = [readTool, writeTool, editTool, bashTool, grepTool];

export function getTool(name: string): ToolDef | undefined {
	return builtinTools.find((t) => t.name === name);
}

export function toolsToOpenAI(tools: ToolDef[]): unknown[] {
	return tools.map((t) => ({
		type: "function",
		function: {
			name: t.name,
			description: t.description,
			parameters: t.parameters,
		},
	}));
}