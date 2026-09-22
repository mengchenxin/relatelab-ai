import assert from "node:assert/strict";
import test from "node:test";
import { AgentOrchestrator } from "../src/server/agent/orchestrator.ts";
import { ModelGateway } from "../src/server/agent/llmGateway.ts";
import { loadConfig } from "../src/server/config.ts";
import { SqliteDatabase } from "../src/server/db.ts";

test("runs the complete offline pipeline and persists a trace", async () => {
  const config = loadConfig({
    sqlitePath: ":memory:",
    llm: {
      mode: "mock",
      baseUrl: "",
      apiKey: "",
      model: "test-model",
      timeoutMs: 1000,
      supportsVision: false,
      enforceByok: false
    }
  });
  const database = new SqliteDatabase(config.sqlitePath);
  const ownerId = "test-owner";
  const orchestrator = new AgentOrchestrator(
    database,
    new ModelGateway(config.llm)
  );

  const result = await orchestrator.analyze({
    title: "测试案例",
    goal: "deescalate",
    relationshipType: "partner",
    transcript:
      "我 20:00 你今天又没提前说。\n对方 20:01 我在忙。\n我 20:02 你每次都这样。\n对方 20:03 算了。",
    consentAccepted: true,
    consentVersion: "2026-09-22"
  }, { ownerId });

  assert.equal(result.status, "completed");
  assert.equal(result.trace.length, 4);
  assert.equal(result.strategies.length, 3);
  assert.equal((await database.listCases(ownerId)).length, 1);
  assert.ok(await database.getRun(result.id, ownerId));
  assert.equal(
    (await database.getLatestRunByCaseId(result.caseId, ownerId))?.id,
    result.id
  );

  assert.equal(await database.deleteCase(result.caseId, ownerId), true);
  assert.equal((await database.listCases(ownerId)).length, 0);
  assert.equal(await database.getRun(result.id, ownerId), null);
  assert.equal(await database.deleteCase(result.caseId, ownerId), false);

  await database.close();
});
