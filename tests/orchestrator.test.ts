import assert from "node:assert/strict";
import test from "node:test";
import { AgentOrchestrator } from "../src/server/agent/orchestrator.ts";
import { ModelGateway } from "../src/server/agent/llmGateway.ts";
import { loadConfig } from "../src/server/config.ts";
import { RelateDatabase } from "../src/server/db.ts";

test("runs the complete offline pipeline and persists a trace", async () => {
  const config = loadConfig({
    sqlitePath: ":memory:",
    llm: {
      mode: "mock",
      baseUrl: "",
      apiKey: "",
      model: "test-model",
      timeoutMs: 1000,
      supportsVision: false
    }
  });
  const database = new RelateDatabase(config.sqlitePath);
  const orchestrator = new AgentOrchestrator(
    database,
    new ModelGateway(config.llm)
  );

  const result = await orchestrator.analyze({
    title: "测试案例",
    goal: "deescalate",
    relationshipType: "partner",
    transcript:
      "我 20:00 你今天又没提前说。\n对方 20:01 我在忙。\n我 20:02 你每次都这样。\n对方 20:03 算了。"
  });

  assert.equal(result.status, "completed");
  assert.equal(result.trace.length, 4);
  assert.equal(result.strategies.length, 3);
  assert.equal(database.listCases().length, 1);
  assert.ok(database.getRun(result.id));
  assert.equal(database.getLatestRunByCaseId(result.caseId)?.id, result.id);

  assert.equal(database.deleteCase(result.caseId), true);
  assert.equal(database.listCases().length, 0);
  assert.equal(database.getRun(result.id), null);
  assert.equal(database.deleteCase(result.caseId), false);

  database.close();
});
