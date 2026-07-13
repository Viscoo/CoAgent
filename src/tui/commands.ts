export interface SlashCommand {
  name: string;
  description: string;
  handler: (args: string) => void | Promise<void>;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/help", description: "Show available commands", handler: async () => {} },
  { name: "/plan", description: "Plan a task with a goal", handler: async () => {} },
  { name: "/run", description: "Run a task with a goal", handler: async () => {} },
  { name: "/status", description: "Show current run status", handler: async () => {} },
  { name: "/model", description: "Change or show the model", handler: async () => {} },
  { name: "/clear", description: "Clear the chat area", handler: async () => {} },
  { name: "/compact", description: "Compact conversation history", handler: async () => {} },
  { name: "/exit", description: "Exit CoAgent", handler: async () => {} },
];

export function matchSlashCommands(input: string): SlashCommand[] {
  if (!input.startsWith("/")) return [];
  const partial = input.toLowerCase().trim();
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(partial));
}