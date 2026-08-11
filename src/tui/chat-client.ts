import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinTools, getTool, toolsToOpenAI, type ToolDef, type ToolResult } from "./tools.js";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");


export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatProvider {
  id: string;
  name: string;
  apiUrl: string;
  envKey: string;
  models: string[];
}

const PROVIDERS: Record<string, ChatProvider> = {
  ark: {
    id: "ark",
    name: "Volcengine ARK",
    apiUrl: "https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions",
    envKey: "ARK_API_KEY",
    models: ["auto"],
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    apiUrl: "https://api.deepseek.com/v1/chat/completions",
    envKey: "DEEPSEEK_API_KEY",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    apiUrl: "https://api.anthropic.com/v1/messages",
    envKey: "ANTHROPIC_API_KEY",
    models: ["claude-sonnet-4-20250514", "claude-haiku-3-5-20241022"],
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    apiUrl: "https://api.openai.com/v1/chat/completions",
    envKey: "OPENAI_API_KEY",
    models: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
  },
};

export function getProviders(): Record<string, ChatProvider> {
  return PROVIDERS;
}

export function getProvider(id: string): ChatProvider | undefined {
  return PROVIDERS[id];
}

interface ChatConfig {
  provider: string;
  model: string;
  apiKey?: string;
}

function configPath(cwd: string): string {
  return join(cwd, ".coagent", "chat.json");
}

function readConfig(p: string): ChatConfig | null {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as ChatConfig;
  } catch {
    return null;
  }
}

export function loadChatConfig(cwd: string): ChatConfig {
  const cwdCfg = readConfig(configPath(cwd));
  const pkgCfg = readConfig(configPath(PACKAGE_ROOT));
  if (cwdCfg && pkgCfg) {
    return {
      provider: cwdCfg.provider,
      model: cwdCfg.model,
      apiKey: cwdCfg.apiKey ?? pkgCfg.apiKey,
    };
  }
  return cwdCfg ?? pkgCfg ?? { provider: "deepseek", model: "deepseek-chat" };
}

export function saveChatConfig(cwd: string, config: ChatConfig): void {
  const targetDir = existsSync(configPath(cwd)) ? cwd : PACKAGE_ROOT;
  const dir = join(targetDir, ".coagent");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath(targetDir), JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function resolveApiKey(cwd: string): string | undefined {
  const config = loadChatConfig(cwd);
  if (config.apiKey) return config.apiKey;
  const provider = PROVIDERS[config.provider];
  if (provider) {
    const env = process.env[provider.envKey];
    if (env) return env;
  }
  return undefined;
}

export async function chat(
  messages: ChatMessage[],
  cwd: string,
  onToken?: (token: string) => void,
): Promise<string> {
  const config = loadChatConfig(cwd);
  const provider = PROVIDERS[config.provider];
  if (!provider) throw new Error("Unknown provider: " + config.provider);

  const apiKey = resolveApiKey(cwd);
  if (!apiKey) {
    throw new Error(
      "No API key found. Set " + provider.envKey +
      " environment variable or configure with /model command.\n" +
      "Example: export " + provider.envKey + "=sk-xxxxx",
    );
  }

  if (config.provider === "anthropic") {
    return chatAnthropic(messages, config.model, apiKey, provider.apiUrl, onToken);
  }

  return chatOpenAICompatible(messages, config.model, apiKey, provider.apiUrl, onToken);
}

export interface ToolCall {
	id: string;
	name: string;
	arguments: string;
}

export interface AgentEvent {
	type: "text_delta" | "tool_call" | "tool_result" | "done";
	delta?: string;
	toolCall?: ToolCall;
	toolResult?: { id: string; name: string; result: ToolResult };
	text?: string;
}

export interface AgentCallbacks {
	onText?: (delta: string) => void;
	onToolCall?: (call: ToolCall) => void;
	onToolResult?: (call: ToolCall, result: ToolResult) => void;
}

export async function runAgent(
	messages: ChatMessage[],
	cwd: string,
	tools: ToolDef[] = builtinTools,
	callbacks?: AgentCallbacks,
	maxTurns = 20,
): Promise<string> {
	const config = loadChatConfig(cwd);
	const provider = PROVIDERS[config.provider];
	if (!provider) throw new Error("Unknown provider: " + config.provider);
	const apiKey = resolveApiKey(cwd);
	if (!apiKey) {
		throw new Error("No API key. Set " + provider.envKey + " or use /model " + config.provider + " <model> <key>");
	}
	if (config.provider === "anthropic") {
		return chatAnthropic(messages, config.model, apiKey, provider.apiUrl, callbacks?.onText);
	}

	const workingMessages: ChatMessage[] = [...messages];
	const openaiTools = toolsToOpenAI(tools);

	for (let turn = 0; turn < maxTurns; turn++) {
		const { text, toolCalls } = await chatWithTools(
			workingMessages, config.model, apiKey, provider.apiUrl, openaiTools, callbacks?.onText,
		);

		if (text) {
			workingMessages.push({ role: "assistant", content: text });
		}

		if (!toolCalls || toolCalls.length === 0) {
			return text;
		}

		const assistantToolMsg: ChatMessage = {
			role: "assistant",
			content: text + toolCalls.map((c) => `\n[tool: ${c.name}(${c.arguments})]`).join(""),
		};
		if (turn > 0 && workingMessages[workingMessages.length - 1]?.role === "assistant") {
			workingMessages[workingMessages.length - 1] = assistantToolMsg;
		} else {
			workingMessages.push(assistantToolMsg);
		}

		for (const call of toolCalls) {
			callbacks?.onToolCall?.(call);
			let result: ToolResult;
			try {
				const args = JSON.parse(call.arguments || "{}");
				const tool = getTool(call.name);
				if (!tool) {
					result = { content: "Unknown tool: " + call.name, isError: true };
				} else {
					result = await tool.execute(args, cwd);
				}
			} catch (err) {
				result = { content: String(err), isError: true };
			}
			callbacks?.onToolResult?.(call, result);
			workingMessages.push({
				role: "user",
				content: `[result of ${call.name}]: ${result.content}`,
			});
		}
	}

	return "(reached max turns)";
}

interface ChatWithToolsResult {
	text: string;
	toolCalls: ToolCall[] | null;
}

async function chatWithTools(
	messages: ChatMessage[],
	model: string,
	apiKey: string,
	apiUrl: string,
	tools: unknown[],
	onToken?: (token: string) => void,
): Promise<ChatWithToolsResult> {
	const response = await fetch(apiUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Authorization": "Bearer " + apiKey,
		},
		body: JSON.stringify({
			model,
			messages,
			tools,
			stream: !!onToken,
			max_tokens: 4096,
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error("API error " + response.status + ": " + text);
	}

	if (!onToken || !response.body) {
		const data = await response.json() as any;
		const msg = data.choices?.[0]?.message;
		return {
			text: msg?.content ?? "",
			toolCalls: msg?.tool_calls ? msg.tool_calls.map((tc: any) => ({
				id: tc.id,
				name: tc.function.name,
				arguments: tc.function.arguments ?? "",
			})) : null,
		};
	}

	let fullText = "";
	const toolCallMap = new Map<number, ToolCall>();
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || !trimmed.startsWith("data: ")) continue;
			const data = trimmed.slice(6);
			if (data === "[DONE]") continue;
			try {
				const parsed = JSON.parse(data);
				const delta = parsed.choices?.[0]?.delta;
				if (delta?.content) {
					fullText += delta.content;
					onToken(delta.content);
				}
				if (delta?.tool_calls) {
					for (const tc of delta.tool_calls) {
						const idx = tc.index ?? 0;
						const existing = toolCallMap.get(idx) ?? { id: "", name: "", arguments: "" };
						if (tc.id) existing.id = tc.id;
						if (tc.function?.name) existing.name = tc.function.name;
						if (tc.function?.arguments) existing.arguments += tc.function.arguments;
						toolCallMap.set(idx, existing);
					}
				}
			} catch {}
		}
	}

	const toolCalls = toolCallMap.size > 0 ? [...toolCallMap.values()] : null;
	return { text: fullText, toolCalls };
}

async function chatOpenAICompatible(
  messages: ChatMessage[],
  model: string,
  apiKey: string,
  apiUrl: string,
  onToken?: (token: string) => void,
): Promise<string> {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: !!onToken,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error("API error " + response.status + ": " + text);
  }

  if (!onToken || !response.body) {
    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content ?? "";
  }

  let fullText = "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          onToken(delta);
        }
      } catch {}
    }
  }

  return fullText;
}

async function chatAnthropic(
  messages: ChatMessage[],
  model: string,
  apiKey: string,
  apiUrl: string,
  onToken?: (token: string) => void,
): Promise<string> {
  const systemMsg = messages.find((m) => m.role === "system");
  const chatMsgs = messages.filter((m) => m.role !== "system");

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemMsg?.content,
      messages: chatMsgs.map((m) => ({ role: m.role, content: m.content })),
      stream: !!onToken,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error("API error " + response.status + ": " + text);
  }

  if (!onToken || !response.body) {
    const data = await response.json() as any;
    return data.content?.map((c: any) => c.text).join("") ?? "";
  }

  let fullText = "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === "content_block_delta" && parsed.delta?.text) {
          fullText += parsed.delta.text;
          onToken(parsed.delta.text);
        }
      } catch {}
    }
  }

  return fullText;
}