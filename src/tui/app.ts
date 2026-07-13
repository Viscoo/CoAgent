import blessed from "blessed";
import { buildLogoLines } from "./logo.js";
import { matchSlashCommands, SLASH_COMMANDS } from "./commands.js";
import { Orchestrator } from "../core/orchestrator.js";
import { MockAdapter } from "../adapters/mock-adapter.js";
import { displayWidth } from "./logo.js";

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
    });

    let inputBuf = "";
    let cursorPos = 0;
    let showingAutoComplete = false;
    let selectedCmdIdx = 0;
    let matchedCmds: ReturnType<typeof matchSlashCommands> = [];
    let chatHistory: string[] = [];
    let historyIdx = -1;
    let isProcessing = false;

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
                  ? "{white-fg}▶{/white-fg}"
                  : "·";
        const retry =
          event.attempt && event.maxAttempts
            ? ` [{yellow-fg}${event.attempt}/${event.maxAttempts}{/yellow-fg}]`
            : "";
        chatArea.pushLine(`${icon} ${event.message}${retry}`);
        if (event.error) {
          chatArea.pushLine(`  └─ {red-fg}${event.error}{/red-fg}`);
        }
        chatArea.setScrollPerc(100);
        screen.render();
      },
    });

    const chatArea = blessed.log({
      parent: screen,
      top: 0,
      left: 0,
      width: "100%",
      height: "100%-1",
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: "│",
        style: { fg: "#8b5cf6" },
        track: { bg: "#1e1e2e" },
      },
      tags: true,
      padding: { left: 2, right: 2 },
      style: { bg: "#0f0f1a", fg: "#cdd6f4" },
      mouse: true,
    });

    for (const line of buildLogoLines(screen.width as number)) {
      chatArea.pushLine(line);
    }
    chatArea.pushLine("");
    chatArea.pushLine("{grey-fg}Welcome! Type a goal to run, or /help for commands.{/grey-fg}");
    chatArea.pushLine("");

    const inputLine = blessed.box({
      parent: screen,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 1,
      style: { bg: "#0f0f1a", fg: "#cdd6f4" },
      tags: true,
    });


    const autoCompleteBox = blessed.box({
      parent: screen,
      bottom: 1,
      left: 2,
      width: "50%",
      height: 0,
      hidden: true,
      style: { bg: "#1e1e2e", fg: "#cdd6f4" },
      border: { type: "line" as const, fg: "#6366f1" as any },
      tags: true,
      label: " Commands ",
    });

    function renderInput(): void {
      const prompt = "{white-fg}❯{/white-fg} ";
      const ver = `{#6c7086-fg}CoAgent v${VERSION}{/#6c7086-fg}`;
      inputLine.setContent(`${prompt}${inputBuf}${ver}`);
      screen.render();
      const promptDisplayWidth = 2;
      const cursorCol = promptDisplayWidth + displayWidth(inputBuf.slice(0, cursorPos));
      const termHeight = screen.height as number;
      try {
        screen.program.cup(termHeight - 1, cursorCol);
        screen.program.showCursor();
      } catch {}
    }

    function renderAutoComplete(): void {
      if (matchedCmds.length === 0 || !inputBuf.startsWith("/")) {
        hideAutoComplete();
        return;
      }
      showingAutoComplete = true;
      const lines = matchedCmds.map((c, i) => {
        const sel = i === selectedCmdIdx;
        const name = sel
          ? `{bold}{white-fg}${c.name}{/white-fg}{/bold}`
          : `{white-fg}${c.name}{/white-fg}`;
        const desc = sel
          ? `{white-fg}${c.description}{/white-fg}`
          : `{#6c7086-fg}${c.description}{/#6c7086-fg}`;
        return ` ${name.padEnd(14)} ${desc}`;
      });
      autoCompleteBox.setContent(lines.join("\n"));
      autoCompleteBox.height = matchedCmds.length + 2;
      autoCompleteBox.show();
      screen.render();
    }

    function hideAutoComplete(): void {
      showingAutoComplete = false;
      matchedCmds = [];
      selectedCmdIdx = 0;
      autoCompleteBox.hide();
    }

    function updateAutoComplete(): void {
      if (!inputBuf.startsWith("/")) {
        hideAutoComplete();
        return;
      }
      matchedCmds = matchSlashCommands(inputBuf);
      if (matchedCmds.length === 0) {
        hideAutoComplete();
        return;
      }
      selectedCmdIdx = 0;
      renderAutoComplete();
    }

    function applyAutoComplete(): void {
      if (!showingAutoComplete || matchedCmds.length === 0) return;
      const cmd = matchedCmds[selectedCmdIdx];
      if (cmd) {
        inputBuf = cmd.name + " ";
        cursorPos = inputBuf.length;
        hideAutoComplete();
        renderInput();
      }
    }

    function submitInput(): void {
      const line = inputBuf.trim();
      inputBuf = "";
      cursorPos = 0;
      hideAutoComplete();

      if (line) {
        chatHistory.push(line);
        historyIdx = chatHistory.length;
        chatArea.pushLine(`{white-fg}❯{/white-fg} ${line}`);
        chatArea.pushLine("");
        chatArea.setScrollPerc(100);
        screen.render();

        if (!isProcessing) {
          isProcessing = true;
          handleCommand(line).finally(() => {
            isProcessing = false;
            renderInput();
          });
        }
      }

      renderInput();
    }

    async function handleCommand(line: string): Promise<void> {
      const lower = line.toLowerCase();

      if (lower === "/exit" || lower === "/quit") {
        chatArea.pushLine("{grey-fg}Goodbye! 👋{/grey-fg}");
        chatArea.setScrollPerc(100);
        screen.render();
        await new Promise((r) => setTimeout(r, 300));
        screen.destroy();
        resolve();
        return;
      }

      if (lower === "/help") {
        chatArea.pushLine("{bold}Available Commands:{/bold}");
        chatArea.pushLine("─".repeat(50));
        for (const cmd of SLASH_COMMANDS) {
          chatArea.pushLine(
            `  {white-fg}${cmd.name.padEnd(12)}{/white-fg} ${cmd.description}`,
          );
        }
        chatArea.pushLine("");
        chatArea.pushLine(
          "{grey-fg}Type a goal directly to run it through the agent pipeline.{/grey-fg}",
        );
        chatArea.pushLine("");
        chatArea.setScrollPerc(100);
        screen.render();
        return;
      }

      if (lower === "/clear") {
        chatArea.setContent("");
        for (const l of buildLogoLines(screen.width as number)) chatArea.pushLine(l);
        chatArea.pushLine("");
        chatArea.setScrollPerc(100);
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
        chatArea.setScrollPerc(100);
        screen.render();
        return;
      }

      if (lower.startsWith("/model")) {
        const model = line.slice(6).trim();
        if (model) {
          chatArea.pushLine(`{white-fg}◈{/white-fg} Model set to: ${model}`);
        } else {
          chatArea.pushLine(
            "{white-fg}◈{/white-fg} Current model: opencode/claude-sonnet-4-6",
          );
        }
        chatArea.pushLine("");
        chatArea.setScrollPerc(100);
        screen.render();
        return;
      }

      if (lower.startsWith("/plan")) {
        const goal = line.slice(5).trim();
        if (!goal) {
          chatArea.pushLine(
            "{red-fg}✗{/red-fg} /plan requires a goal. Usage: /plan <goal>",
          );
          chatArea.pushLine("");
          chatArea.setScrollPerc(100);
          screen.render();
          return;
        }
        chatArea.pushLine(`{white-fg}◈{/white-fg} Planning: ${goal}`);
        chatArea.pushLine("─".repeat(50));
        chatArea.setScrollPerc(100);
        screen.render();
        try {
          const run = await orchestrator.plan(goal);
          printRun(run);
        } catch (error) {
          chatArea.pushLine(
            `{red-fg}✗ Error: ${error instanceof Error ? error.message : String(error)}{/red-fg}`,
          );
        }
        chatArea.setScrollPerc(100);
        screen.render();
        return;
      }

      if (lower.startsWith("/run")) {
        const goal = line.slice(4).trim();
        if (!goal) {
          chatArea.pushLine(
            "{red-fg}✗{/red-fg} /run requires a goal. Usage: /run <goal>",
          );
          chatArea.pushLine("");
          chatArea.setScrollPerc(100);
          screen.render();
          return;
        }
        await runGoal(goal);
        return;
      }

      if (lower.startsWith("/compact")) {
        chatArea.pushLine("{white-fg}◈{/white-fg} Conversation compacted.");
        chatArea.pushLine("");
        chatArea.setScrollPerc(100);
        screen.render();
        return;
      }

      if (line.startsWith("/")) {
        chatArea.pushLine(
          `{red-fg}✗{/red-fg} Unknown command: ${line}. Type {cyan-fg}/help{/cyan-fg} for available commands.`,
        );
        chatArea.pushLine("");
        chatArea.setScrollPerc(100);
        screen.render();
        return;
      }

      await runGoal(line);
    }

    async function runGoal(goal: string): Promise<void> {
      chatArea.pushLine(`{white-fg}◈{/white-fg} Goal: ${goal}`);
      chatArea.pushLine(
        "{grey-fg}🎭 Roles: planner → explorer → implementer → reviewer + tester → integrator{/grey-fg}",
      );
      chatArea.pushLine("─".repeat(50));
      chatArea.setScrollPerc(100);
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
      chatArea.setScrollPerc(100);
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
                ? "{white-fg}▶{/white-fg}"
                : "·";
        chatArea.pushLine(
          `    ${tBadge} ${task.role.padEnd(11)} ${task.title}`,
        );
      }
    }

    screen.program.on("keypress", (ch: string, key: any) => {
      if (!key) return;

      if (key.full === "C-c" || key.full === "escape") {
        screen.destroy();
        resolve();
        return;
      }

      if (showingAutoComplete) {
        if (key.name === "up") {
          selectedCmdIdx = Math.max(0, selectedCmdIdx - 1);
          renderAutoComplete();
          return;
        }
        if (key.name === "down") {
          selectedCmdIdx = Math.min(matchedCmds.length - 1, selectedCmdIdx + 1);
          renderAutoComplete();
          return;
        }
        if (key.name === "return") {
          applyAutoComplete();
          submitInput();
          return;
        }
      }

      if (key.name === "tab") {
        if (inputBuf.startsWith("/") && matchedCmds.length > 0) {
          applyAutoComplete();
        }
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        submitInput();
        return;
      }

      if (key.name === "backspace") {
        if (cursorPos > 0) {
          inputBuf =
            inputBuf.slice(0, cursorPos - 1) + inputBuf.slice(cursorPos);
          cursorPos--;
          updateAutoComplete();
          renderInput();
        }
        return;
      }

      if (key.name === "delete") {
        if (cursorPos < inputBuf.length) {
          inputBuf =
            inputBuf.slice(0, cursorPos) + inputBuf.slice(cursorPos + 1);
          updateAutoComplete();
          renderInput();
        }
        return;
      }

      if (key.name === "left") {
        if (cursorPos > 0) cursorPos--;
        renderInput();
        return;
      }

      if (key.name === "right") {
        if (cursorPos < inputBuf.length) cursorPos++;
        renderInput();
        return;
      }

      if (key.name === "home") {
        cursorPos = 0;
        renderInput();
        return;
      }

      if (key.name === "end") {
        cursorPos = inputBuf.length;
        renderInput();
        return;
      }

      if (key.name === "up" && !showingAutoComplete) {
        if (chatHistory.length > 0 && historyIdx > 0) {
          historyIdx--;
          inputBuf = chatHistory[historyIdx];
          cursorPos = inputBuf.length;
          updateAutoComplete();
          renderInput();
        }
        return;
      }

      if (key.name === "down" && !showingAutoComplete) {
        if (historyIdx < chatHistory.length - 1) {
          historyIdx++;
          inputBuf = chatHistory[historyIdx];
        } else {
          historyIdx = chatHistory.length;
          inputBuf = "";
        }
        cursorPos = inputBuf.length;
        updateAutoComplete();
        renderInput();
        return;
      }

      if (key.name === "pageup") {
        chatArea.scroll(-20);
        screen.render();
        return;
      }

      if (key.name === "pagedown") {
        chatArea.scroll(20);
        screen.render();
        return;
      }

      if (ch && ch.length === 1 && !key.ctrl && !key.meta) {
        inputBuf =
          inputBuf.slice(0, cursorPos) + ch + inputBuf.slice(cursorPos);
        cursorPos++;
        updateAutoComplete();
        renderInput();
      }
    });

    screen.program.hideCursor();
    screen.program.cup(screen.height as number - 1, 2);
    screen.program.showCursor();

    chatArea.on("click", () => {
      renderInput();
    });

    screen.on("resize", () => {
      renderInput();
    });

    renderInput();
  });
}
