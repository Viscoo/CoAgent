import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface ModelConfig {
  provider: string;
  model: string;
  maxTokens?: number;
}

export interface CoAgentConfig {
  model?: ModelConfig;
  agents?: Record<string, ModelConfig>;
}

const CONFIG_FILES = [".opencode.json", "opencode.json", ".opencode/opencode.json"];

const KNOWN_PROVIDERS: Record<string, { name: string; models: string[] }> = {
  anthropic: {
    name: "Anthropic",
    models: [
      "claude-sonnet-4-20250514",
      "claude-opus-4-20250514",
      "claude-haiku-3-5-20241022",
    ],
  },
  openai: {
    name: "OpenAI",
    models: [
      "gpt-4o",
      "gpt-4o-mini",
      "o3",
      "o3-mini",
      "o4-mini",
    ],
  },
  google: {
    name: "Google",
    models: [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
    ],
  },
  deepseek: {
    name: "DeepSeek",
    models: [
      "deepseek-chat",
      "deepseek-reasoner",
    ],
  },
  openrouter: {
    name: "OpenRouter",
    models: [
      "anthropic/claude-sonnet-4-20250514",
      "openai/gpt-4o",
      "google/gemini-2.5-pro",
    ],
  },
};

export function getKnownProviders() {
  return KNOWN_PROVIDERS;
}

export function parseModelString(value: string): ModelConfig {
  const slashIdx = value.indexOf("/");
  if (slashIdx < 0) {
    return { provider: "anthropic", model: value };
  }
  return {
    provider: value.slice(0, slashIdx),
    model: value.slice(slashIdx + 1),
  };
}

export function formatModelString(config: ModelConfig): string {
  return `${config.provider}/${config.model}`;
}

export function findConfigFile(cwd: string): string | null {
  for (const name of CONFIG_FILES) {
    const path = join(cwd, name);
    if (existsSync(path)) return path;
  }
  return null;
}

export function loadConfig(cwd: string): CoAgentConfig {
  const path = findConfigFile(cwd);
  if (!path) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as CoAgentConfig;
  } catch {
    return {};
  }
}

export function saveConfig(cwd: string, config: CoAgentConfig): string {
  let path = findConfigFile(cwd);
  if (!path) {
    const dir = join(cwd, ".opencode");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    path = join(dir, "opencode.json");
  }
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return path;
}

export function getCurrentModel(cwd: string): ModelConfig {
  const config = loadConfig(cwd);
  if (config.model) return config.model;
  if (config.agents?.coder) return config.agents.coder;
  if (config.agents?.task) return config.agents.task;
  return { provider: "anthropic", model: "claude-sonnet-4-20250514" };
}

export function setCurrentModel(cwd: string, model: ModelConfig): string {
  const config = loadConfig(cwd);
  config.model = model;
  if (!config.agents) config.agents = {};
  config.agents.coder = model;
  config.agents.task = model;
  return saveConfig(cwd, config);
}

export function resolveModelInput(input: string): ModelConfig | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.includes("/")) {
    return parseModelString(trimmed);
  }

  for (const [providerId, provider] of Object.entries(KNOWN_PROVIDERS)) {
    const found = provider.models.find(
      (m) => m.toLowerCase() === trimmed.toLowerCase(),
    );
    if (found) {
      return { provider: providerId, model: found };
    }
  }

  for (const [providerId, provider] of Object.entries(KNOWN_PROVIDERS)) {
    if (providerId === trimmed.toLowerCase() || provider.name.toLowerCase() === trimmed.toLowerCase()) {
      return { provider: providerId, model: provider.models[0] };
    }
  }

  return null;
}