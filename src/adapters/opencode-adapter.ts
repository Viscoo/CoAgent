import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { type AgentSpec } from "../core/agent-registry.js";
import { type TaskNode } from "../core/types.js";

export interface OpenCodeSession {
  id: string;
}

export interface OpenCodePromptResult {
  sessionId: string;
  messageId?: string;
  summary?: string;
  diffFiles: string[];
  raw: unknown;
}

export interface OpenCodeAdapterOptions {
  cwd: string;
  baseUrl?: string;
  startServer?: boolean;
  serverCommand?: string;
  serverArgs?: string[];
}

export interface OpenCodeAdapter {
  ensureReady(): Promise<void>;
  createParentSession(goal: string): Promise<OpenCodeSession>;
  createChildSession(parentSessionId: string, task: TaskNode, agent: AgentSpec): Promise<OpenCodeSession>;
  prompt(sessionId: string, prompt: string, asyncMode?: boolean): Promise<OpenCodePromptResult>;
  diff(sessionId: string): Promise<string[]>;
  close(): Promise<void>;
}

type AnyClient = Record<string, unknown>;

interface ClientBundle {
  client: AnyClient;
  close?: () => void | Promise<void>;
}

export class SdkOpenCodeAdapter implements OpenCodeAdapter {
  private client?: AnyClient;
  private server?: ChildProcessWithoutNullStreams;
  private sdkClose?: () => void | Promise<void>;

  constructor(private readonly options: OpenCodeAdapterOptions) {}

  async ensureReady(): Promise<void> {
    if (this.options.startServer) {
      this.server = spawn(this.options.serverCommand ?? "opencode", this.options.serverArgs ?? ["serve"], {
        cwd: this.options.cwd,
        shell: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    const baseUrl = this.options.baseUrl ?? (this.options.startServer ? "http://localhost:4096" : undefined);
    const bundle = await createClient({
      baseUrl,
      cwd: this.options.cwd,
      createServer: !baseUrl,
    });
    this.client = bundle.client;
    this.sdkClose = bundle.close;
  }

  async createParentSession(goal: string): Promise<OpenCodeSession> {
    const session = await callFirst(
      this.requiredClient(),
      [
        ["session", "create"],
        ["sessions", "create"],
      ],
      [{ body: { title: `CoAgent: ${goal}` } }, { title: `CoAgent: ${goal}` }],
    );
    return normalizeSession(session);
  }

  async createChildSession(
    parentSessionId: string,
    task: TaskNode,
    agent: AgentSpec,
  ): Promise<OpenCodeSession> {
    const payload = {
      parentID: parentSessionId,
      parentId: parentSessionId,
      title: `${agent.role}: ${task.title}`,
      agent: `coagent-${agent.role}`,
    };
    const fallbackPayload = {
      title: `${agent.role}: ${task.title}`,
    };

    const session = await callFirst(
      this.requiredClient(),
      [
        ["session", "children"],
        ["session", "child"],
        ["sessions", "createChild"],
        ["session", "create"],
        ["sessions", "create"],
      ],
      [{ body: payload }, payload, { body: fallbackPayload }],
    );
    return normalizeSession(session);
  }

  async prompt(sessionId: string, prompt: string, asyncMode = true): Promise<OpenCodePromptResult> {
    const officialPayload = {
      path: { id: sessionId },
      body: {
        parts: [{ type: "text", text: prompt }],
        outputFormat: "text",
        async: asyncMode,
      },
    };
    const legacyPayload = {
      sessionID: sessionId,
      sessionId,
      message: prompt,
      prompt,
      async: asyncMode,
    };

    const result = await callFirst(
      this.requiredClient(),
      [
        ["session", "prompt"],
        ["sessions", "prompt"],
        ["message", "create"],
      ],
      [officialPayload, legacyPayload, { body: legacyPayload }],
    );

    return {
      sessionId,
      messageId: readString(result, ["id", "messageID", "messageId"]),
      summary: extractText(result),
      diffFiles: extractDiffFiles(result),
      raw: result,
    };
  }

  async diff(sessionId: string): Promise<string[]> {
    const result = await callFirst(
      this.requiredClient(),
      [
        ["file", "status"],
        ["session", "diff"],
        ["sessions", "diff"],
      ],
      [
        { query: {} },
        { path: { id: sessionId } },
        { sessionID: sessionId, sessionId },
        { body: { sessionID: sessionId, sessionId } },
      ],
    );
    return extractDiffFiles(result);
  }

  async close(): Promise<void> {
    if (this.sdkClose) {
      await this.sdkClose();
      this.sdkClose = undefined;
    }
    if (this.server) {
      this.server.kill();
      this.server = undefined;
    }
  }

  private requiredClient(): AnyClient {
    if (!this.client) {
      throw new Error("OpenCode adapter is not ready. Call ensureReady() first.");
    }
    return this.client;
  }
}

async function createClient(options: {
  baseUrl?: string;
  cwd: string;
  createServer: boolean;
}): Promise<ClientBundle> {
  try {
    const imported = (await import("@opencode-ai/sdk")) as Record<string, unknown>;
    const factory = options.createServer
      ? imported.createOpencode ?? imported.default
      : imported.createOpencodeClient ?? imported.default;
    if (typeof factory !== "function") {
      throw new Error("The @opencode-ai/sdk package did not expose a compatible client factory.");
    }

    const created = (await factory(
      options.baseUrl ? { baseUrl: options.baseUrl } : { cwd: options.cwd },
    )) as unknown;
    const client = unwrapClient(created);
    if (!client) {
      throw new Error("The OpenCode SDK factory returned an invalid client.");
    }

    return {
      client,
      close: readClose(created),
    };
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        "Unable to initialize OpenCode SDK.",
        "Install @opencode-ai/sdk and ensure an OpenCode server is reachable.",
        `Cause: ${cause}`,
      ].join(" "),
    );
  }
}

async function callFirst(
  client: AnyClient,
  paths: string[][],
  payloads: Array<Record<string, unknown>>,
): Promise<unknown> {
  const errors: string[] = [];
  for (const path of paths) {
    const fn = getPath(client, path);
    if (typeof fn !== "function") continue;
    for (const payload of payloads) {
      try {
        return await fn.call(getPath(client, path.slice(0, -1)), payload);
      } catch (error) {
        errors.push(`${path.join(".")}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  throw new Error(
    [
      "No compatible OpenCode SDK method succeeded.",
      `Tried: ${paths.map((path) => path.join(".")).join(", ")}.`,
      errors.length > 0 ? `Errors: ${errors.join(" | ")}` : "No candidate methods were present.",
    ].join(" "),
  );
}

function getPath(root: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, root);
}

function unwrapClient(input: unknown): AnyClient | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  if (record.client && typeof record.client === "object") return record.client as AnyClient;
  return record as AnyClient;
}

function readClose(input: unknown): (() => void | Promise<void>) | undefined {
  if (!input || typeof input !== "object") return undefined;
  const server = (input as Record<string, unknown>).server;
  if (!server || typeof server !== "object") return undefined;
  const close = (server as Record<string, unknown>).close;
  if (typeof close !== "function") return undefined;
  return () => close.call(server) as void | Promise<void>;
}

function normalizeSession(input: unknown): OpenCodeSession {
  const id = readString(input, ["id", "sessionID", "sessionId"]);
  if (!id) {
    throw new Error(`OpenCode session response did not include an id: ${JSON.stringify(input)}`);
  }
  return { id };
}

function readString(input: unknown, keys: string[]): string | undefined {
  const value = unwrapData(input);
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return undefined;
}

function extractDiffFiles(input: unknown): string[] {
  const value = unwrapData(input);
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return extractPaths(value);
  const record = value as Record<string, unknown>;
  const candidates = [record.files, record.diffFiles, record.modifiedFiles, record.paths, record.status];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return extractPaths(candidate);
    }
  }
  return [];
}

function extractText(input: unknown): string | undefined {
  const value = unwrapData(input);
  if (!value || typeof value !== "object") return undefined;
  const direct = readString(value, ["summary", "text", "content"]);
  if (direct) return direct;
  const parts = (value as Record<string, unknown>).parts;
  if (!Array.isArray(parts)) return undefined;
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return undefined;
      const text = (part as Record<string, unknown>).text;
      return typeof text === "string" ? text : undefined;
    })
    .filter((text): text is string => Boolean(text))
    .join("\n");
}

function extractPaths(values: unknown[]): string[] {
  return values
    .map((value) => {
      if (typeof value === "string") return value;
      if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        if (typeof record.path === "string") return record.path;
        if (typeof record.file === "string") return record.file;
      }
      return undefined;
    })
    .filter((value): value is string => Boolean(value))
    .sort();
}

function unwrapData(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  return (input as Record<string, unknown>).data ?? input;
}
