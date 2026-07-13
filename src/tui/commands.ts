export interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  requiresArg?: boolean;
  handler: (args: string) => void | Promise<void>;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/help", aliases: ["/?"], description: "Show available commands", handler: async () => {} },
  { name: "/new", aliases: ["/clear"], description: "Start a new session / clear chat", handler: async () => {} },
  { name: "/sessions", aliases: ["/resume", "/continue"], description: "List or switch sessions", handler: async () => {} },
  { name: "/plan", description: "Plan a task with a goal", requiresArg: true, handler: async () => {} },
  { name: "/run", description: "Run a task with a goal", requiresArg: true, handler: async () => {} },
  { name: "/status", description: "Show current run status", handler: async () => {} },
  { name: "/model", aliases: ["/models", "/mo"], description: "Show or change model (provider/model)", handler: async () => {} },
  { name: "/agents", description: "List or switch agent roles", handler: async () => {} },
  { name: "/theme", description: "Switch color theme", handler: async () => {} },
  { name: "/compact", description: "Compact conversation history", handler: async () => {} },
  { name: "/diff", description: "View file changes from last run", handler: async () => {} },
  { name: "/config", description: "Show or edit configuration", handler: async () => {} },
  { name: "/exit", aliases: ["/quit", "/q", ":q"], description: "Exit CoAgent", handler: async () => {} },
];

export function matchSlashCommands(input: string): SlashCommand[] {
  if (!input.startsWith("/") && !input.startsWith(":")) return [];
  const partial = input.toLowerCase().trim();
  return SLASH_COMMANDS.filter((c) => {
    if (c.name.startsWith(partial)) return true;
    return c.aliases?.some((a) => a.startsWith(partial));
  });
}

export function resolveCommand(input: string): SlashCommand | undefined {
  const lower = input.toLowerCase().trim();
  return SLASH_COMMANDS.find((c) => {
    if (c.name === lower) return true;
    return c.aliases?.some((a) => a === lower);
  });
}
