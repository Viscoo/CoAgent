import blessed from "blessed";
import { LOGO } from "./logo.js";
import { matchSlashCommands, SLASH_COMMANDS, type SlashCommand } from "./commands.js";
import { Orchestrator } from "../core/orchestrator.js";
import { MockAdapter } from "../adapters/mock-adapter.js";

const VERSION = "0.2.0";

export interface TuiOptions {
  cwd: string;
  failureRate?: number;
  concurrency?: number;
  retries?: number;
}

export function startTui(options: TuiOptions): Promise<void> {
  return new Promise((resolve) => {
    const screen = blessed.screen({
      smartCSR: true,
      title: "CoAgent",
      fullUnicode: true,
      cursor: {
        artificial: true,
        shape: "line",
        blink: true,
        color: "white",
      },
    });

    const adapter = new MockAdapter({ failureRate: options.failureRate ?? 0 });
    const orchestrator = new Orchestrator({
      cwd: options.cwd,
      maxConcurrency: options.concurrency ?? 2,
      dryRun: false,
      adapter,
      maxRetries: options.retries ?? 2,
      onProgress: (event) => {
        const icon =
          event.kind === "task-complete"
            ? "{green-fg}✓{/green-fg}"
            : event.kind === "task-fail"
              ? "{red-fg}✗{/red-fg}"
              : event.kind === "task-retry"
                ? "{yellow-fg}↻{/yellow-fg}"
                : event.kind === "task-start"
                  ? "{cyan-fg}▶{/cyan-fg}"
                  : "·";
        const retry =
          event.attempt && event.maxAttempts
            ? ` [{yellow-fg}${event.attempt}/${event.maxAttempts}{/yellow-fg}]`
            : "";
        chatArea.pushLine(`${icon} ${event.message}${retry}`);
        if (event.error) {
          chatArea.pushLine(`  └─ {red-fg}${event.error}{/red-fg}`);
        }
        chatArea.scroll(10);
        screen.render();
      },
    });

    const headerBar = blessed.box({
      parent: screen,
      top: 0,
      left: 0,
      width: "100%",
      height: 1,
      style: {
        bg: "#6366f1",
        fg: "white",
        bold: true,
      },
      content: ` CoAgent v${VERSION}`,
    });

    const chatArea = blessed.log({
      parent: screen,
      top: 1,
      left: 0,
      width: "100%",
      height: "100%-4",
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: "│",
        style: { fg: "#8b5cf6" },
        track: { bg: "#1e1e2e" },
      },
      tags: true,
      padding: { left: 1, right: 1 },
      style: {
        bg: "#0f0f1a",
        fg: "#cdd6f4",
      },
    });

    chatArea.pushLine(LOGO);
    chatArea.pushLine(
      " {grey-fg}Welcome! Type a goal to run, or /help for commands.{/grey-fg}",
    );
    chatArea.pushLine("");

    const autoComplete = blessed.list({
      parent: screen,
      bottom: 3,
      left: 2,
      width: "50%",
      height: Math.min(SLASH_COMMANDS.length + 2, 10),
      hidden: true,
      style: {
        bg: "#1e1e2e",
        fg: "#cdd6f4",
        selected: { bg: "#6366f1", fg: "white", bold: true },
        item: { bg: "#1e1e2e", fg: "#cdd6f4" },
      },
      border: { type: "line" },
      label: " Commands ",
      keys: true,
      vi: true,
      mouse: true,
    });

    let showingAutoComplete = false;
    let selectedCommandIdx = -1;

    function updateAutoComplete(value: string) {
      const matches = matchSlashCommands(value);
      if (matches.length > 0 && value.startsWith("/")) {
        autoComplete.setItems(
          matches.map((c) => `${c.name}  {grey-fg}${c.description}{/grey-fg}`),
        );
        autoComplete.height = Math.min(matches.length + 2, 10);
        autoComplete.show();
        autoComplete.select(0);
        selectedCommandIdx = 0;
        showingAutoComplete = true;
      } else {
        autoComplete.hide();
        showingAutoComplete = false;
        selectedCommandIdx = -1;
      }
      screen.render();
    }

    const inputBox = blessed.textbox({
      parent: screen,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 3,
      border: { type: "line" },
      style: {
        bg: "#1e1e2e",
        fg: "#cdd6f4",
        border: { fg: "#6366f1" },
        focus: {
          border: { fg: "#a855f7" },
        },
      },
      inputOnFocus: true,
      padding: { left: 1 },
    });

    const statusBar = blessed.box({
      parent: screen,
      bottom: 3,
      left: 0,
      width: "100%",
      height: 1,
      style: {
        bg: "#1e1e2e",
        fg: "#6c7086",
      },
      content: " {cyan-fg}◈{/cyan-fg} CoAgent │ Multi-Agent · Task Graph · Orchestration │ Ctrl+C: exit",
    });

    screen.append(headerBar);
    screen.append(chatArea);
    screen.append(statusBar);
    screen.append(autoComplete);
    screen.append(inputBox);

    inputBox.focus();

    screen.key(["escape", "C-c"], () => {
      screen.destroy();
      resolve();
    });

    screen.key(["up"], () => {
      if (showingAutoComplete && selectedCommandIdx > 0) {
        selectedCommandIdx--;
        autoComplete.up(1);
        screen.render();
        return false;
      }
    });

    screen.key(["down"], () => {
      if (showingAutoComplete) {
        const itemCount = (autoComplete as any).items?.length ?? 0;
        if (selectedCommandIdx < itemCount - 1) {
          selectedCommandIdx++;
          autoComplete.down(1);
          screen.render();
        }
        return false;
      }
    });

    screen.key(["tab"], () => {
      if (showingAutoComplete && selectedCommandIdx >= 0) {
        const matches = matchSlashCommands(inputBox.getValue());
        if (matches[selectedCommandIdx]) {
          inputBox.setValue(matches[selectedCommandIdx].name + " ");
          autoComplete.hide();
          showingAutoComplete = false;
          screen.render();
        }
        return false;
      }
    });

    inputBox.on("keypress", (ch, key) => {
      if (key.name === "return" || key.name === "enter") {
        return;
      }
      setTimeout(() => {
        updateAutoComplete(inputBox.getValue());
      }, 0);
    });

    inputBox.on("submit", async (value: string) => {
      const line = value.trim();
      inputBox.clearValue();

      if (showingAutoComplete) {
        autoComplete.hide();
        showingAutoComplete = false;
      }

      if (!line) {
        inputBox.focus();
        screen.render();
        return;
      }

      chatArea.pushLine(`{cyan-fg}❯{/cyan-fg} ${line}`);
      chatArea.pushLine("");
      chatArea.scroll(10);
      screen.render();

      await handleCommand(line);

      inputBox.focus();
      screen.render();
    });

    async function handleCommand(line: string): Promise<void> {
      const lower = line.toLowerCase();

      if (lower === "/exit" || lower === "/quit") {
        chatArea.pushLine("{grey-fg}Goodbye! 👋{/grey-fg}");
        screen.render();
        setTimeout(() => {
          screen.destroy();
          resolve();
        }, 500);
        return;
      }

      if (lower === "/help") {
        chatArea.pushLine("{bold}Available Commands:{/bold}");
        chatArea.pushLine("─".repeat(50));
        for (const cmd of SLASH_COMMANDS) {
          chatArea.pushLine(
            `  {cyan-fg}${cmd.name.padEnd(12)}{/cyan-fg} ${cmd.description}`,
          );
        }
        chatArea.pushLine("");
        chatArea.pushLine(
          "{grey-fg}Type a goal directly to run it through the agent pipeline.{/grey-fg}",
        );
        chatArea.pushLine("");
        chatArea.scroll(10);
        screen.render();
        return;
      }

      if (lower === "/clear") {
        chatArea.setContent("");
        chatArea.pushLine(LOGO);
        chatArea.pushLine("");
        chatArea.scroll(10);
        screen.render();
        return;
      }

      if (lower === "/status") {
        const run = await orchestrator.status();
        if (!run) {
          chatArea.pushLine("{grey-fg}📭 No runs yet.{/grey-fg}");
          chatArea.pushLine("");
        } else {
          printRun(run);
        }
        chatArea.scroll(10);
        screen.render();
        return;
      }

      if (lower.startsWith("/model")) {
        const model = line.slice(6).trim();
        if (model) {
          chatArea.pushLine(`{cyan-fg}◈{/cyan-fg} Model set to: ${model}`);
        } else {
          chatArea.pushLine("{cyan-fg}◈{/cyan-fg} Current model: opencode/claude-sonnet-4-6");
        }
        chatArea.pushLine("");
        chatArea.scroll(10);
        screen.render();
        return;
      }

      if (lower.startsWith("/plan")) {
        const goal = line.slice(5).trim();
        if (!goal) {
          chatArea.pushLine("{red-fg}✗{/red-fg} /plan requires a goal. Usage: /plan <goal>");
          chatArea.pushLine("");
          chatArea.scroll(10);
          screen.render();
          return;
        }
        chatArea.pushLine(`{cyan-fg}◈{/cyan-fg} Planning: ${goal}`);
        chatArea.pushLine("─".repeat(50));
        chatArea.scroll(10);
        screen.render();
        try {
          const run = await orchestrator.plan(goal);
          printRun(run);
        } catch (error) {
          chatArea.pushLine(
            `{red-fg}✗ Error: ${error instanceof Error ? error.message : String(error)}{/red-fg}`,
          );
        }
        chatArea.scroll(10);
        screen.render();
        return;
      }

      if (lower.startsWith("/run")) {
        const goal = line.slice(4).trim();
        if (!goal) {
          chatArea.pushLine("{red-fg}✗{/red-fg} /run requires a goal. Usage: /run <goal>");
          chatArea.pushLine("");
          chatArea.scroll(10);
          screen.render();
          return;
        }
        await runGoal(goal);
        return;
      }

      if (lower.startsWith("/compact")) {
        chatArea.pushLine("{cyan-fg}◈{/cyan-fg} Conversation compacted.");
        chatArea.pushLine("");
        chatArea.scroll(10);
        screen.render();
        return;
      }

      if (line.startsWith("/")) {
        chatArea.pushLine(
          `{red-fg}✗{/red-fg} Unknown command: ${line}. Type {cyan-fg}/help{/cyan-fg} for available commands.`,
        );
        chatArea.pushLine("");
        chatArea.scroll(10);
        screen.render();
        return;
      }

      await runGoal(line);
    }

    async function runGoal(goal: string): Promise<void> {
      chatArea.pushLine(`{cyan-fg}◈{/cyan-fg} Goal: ${goal}`);
      chatArea.pushLine(
        `{grey-fg}🎭 Roles: planner → explorer → implementer → reviewer + tester → integrator{/grey-fg}`,
      );
      chatArea.pushLine("─".repeat(50));
      chatArea.scroll(10);
      screen.render();

      try {
        const run = await orchestrator.run(goal);
        chatArea.pushLine("");
        printRun(run);
      } catch (error) {
        chatArea.pushLine(
          `{red-fg}✗ Error: ${error instanceof Error ? error.message : String(error)}{/red-fg}`,
        );
      }
      chatArea.pushLine("");
      chatArea.scroll(10);
      screen.render();
    }

    function printRun(run: import("../core/types.js").CoAgentRun): void {
      const badge =
        run.status === "completed"
          ? "{green-fg}✓{/green-fg}"
          : run.status === "failed"
            ? "{red-fg}✗{/red-fg}"
            : run.status === "blocked"
              ? "{yellow-fg}⊘{/yellow-fg}"
              : "·";
      chatArea.pushLine(`${badge} Finished: ${run.id.slice(0, 12)}…`);
      chatArea.pushLine(`  Goal:   ${run.goal}`);
      chatArea.pushLine(`  Status: ${run.status}`);
      if (run.mergePlan) {
        chatArea.pushLine(
          `  Merge:  ${run.mergePlan.status}${run.mergePlan.conflicts.length > 0 ? ` (${run.mergePlan.conflicts.length} conflicts)` : ""}`,
        );
      }
      if (run.riskReport) {
        chatArea.pushLine(
          `  Risk:   ${run.riskReport.status} (${run.riskReport.risks.length} risks)`,
        );
      }
      chatArea.pushLine("  Tasks:");
      for (const task of run.taskGraph.tasks) {
        const tBadge =
          task.status === "completed"
            ? "{green-fg}✓{/green-fg}"
            : task.status === "failed"
              ? "{red-fg}✗{/red-fg}"
              : task.status === "running"
                ? "{cyan-fg}▶{/cyan-fg}"
                : "·";
        chatArea.pushLine(`    ${tBadge} ${task.role.padEnd(11)} ${task.title}`);
      }
    }

    screen.render();
  });
}