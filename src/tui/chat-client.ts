import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

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

export function loadChatConfig(cwd: string): ChatConfig {
  const p = configPath(cwd);
  if (existsSync(p)) {
    try {
      return JSON.parse(readFileSync(p, "utf-8")) as ChatConfig;
    } catch {}
  }
  return { provider: "deepseek", model: "deepseek-chat" };
}

export function saveChatConfig(cwd: string, config: ChatConfig): void {
  const dir = join(cwd, ".coagent");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath(cwd), JSON.stringify(config, null, 2) + "\n", "utf-8");
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