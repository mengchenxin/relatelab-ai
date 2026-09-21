import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../src/server/app.ts";
import { loadConfig } from "../src/server/config.ts";

test("loads a historical case and deletes it through the API", async (context) => {
  const application = await createApplication(
    loadConfig({
      sqlitePath: ":memory:",
      llm: {
        mode: "mock",
        baseUrl: "",
        apiKey: "",
        model: "test-model",
        timeoutMs: 1000,
        supportsVision: false
      }
    })
  );

  context.after(async () => {
    await application.app.close();
  });

  const analysisResponse = await application.app.inject({
    method: "POST",
    url: "/api/analyze",
    payload: {
      title: "删除与加载测试",
      goal: "deescalate",
      relationshipType: "partner",
      transcript:
        "我 20:00 你今天又没提前说。\n对方 20:01 我在忙。\n我 20:02 你每次都这样。\n对方 20:03 算了。"
    }
  });

  assert.equal(analysisResponse.statusCode, 200);
  const result = analysisResponse.json();

  const listResponse = await application.app.inject({
    method: "GET",
    url: "/api/cases"
  });
  assert.equal(listResponse.statusCode, 200);
  assert.equal(listResponse.json().cases.length, 1);
  assert.equal(listResponse.json().cases[0].id, result.caseId);

  const loadResponse = await application.app.inject({
    method: "GET",
    url: `/api/cases/${result.caseId}`
  });
  assert.equal(loadResponse.statusCode, 200);
  assert.equal(loadResponse.json().id, result.id);

  const deleteResponse = await application.app.inject({
    method: "DELETE",
    url: `/api/cases/${result.caseId}`
  });
  assert.equal(deleteResponse.statusCode, 200);
  assert.deepEqual(deleteResponse.json(), {
    deleted: true,
    id: result.caseId
  });

  const emptyListResponse = await application.app.inject({
    method: "GET",
    url: "/api/cases"
  });
  assert.equal(emptyListResponse.statusCode, 200);
  assert.deepEqual(emptyListResponse.json(), { cases: [] });

  const missingResponse = await application.app.inject({
    method: "GET",
    url: `/api/cases/${result.caseId}`
  });
  assert.equal(missingResponse.statusCode, 404);
});
