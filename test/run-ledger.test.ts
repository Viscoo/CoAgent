import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { RunLedger } from "../src/core/run-ledger.js";
import { createTaskGraph } from "../src/core/task-graph.js";

describe("run ledger", () => {
  test("creates, saves, loads, and resolves latest run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coagent-ledger-"));
    try {
      const ledger = new RunLedger(dir);
      const run = await ledger.create("ship feature", createTaskGraph("ship feature"));
      const loaded = await ledger.load(run.id);
      const latest = await ledger.latest();

      expect(loaded.id).toBe(run.id);
      expect(latest?.id).toBe(run.id);
      expect(loaded.taskGraph.tasks.length).toBe(6);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
