import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../src/server/app.ts";
import { loadConfig } from "../src/server/config.ts";

function sessionCookie(response: {
  headers: Record<string, unknown>;
}): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header)
    ? String(header[0])
    : typeof header === "string"
      ? header
      : undefined;
  if (!value) {
    throw new Error("session cookie missing");
  }
  return value.split(";")[0];
}

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
        supportsVision: false,
        enforceByok: false
      }
    })
  );

  context.after(async () => {
    await application.app.close();
  });

  const sessionResponse = await application.app.inject({
    method: "POST",
    url: "/api/auth/session",
    payload: {}
  });
  const cookie = sessionCookie(sessionResponse);

  const analysisResponse = await application.app.inject({
    method: "POST",
    url: "/api/analyze",
    headers: { cookie },
    payload: {
      title: "删除与加载测试",
      goal: "deescalate",
      relationshipType: "partner",
      transcript:
        "我 20:00 你今天又没提前说。\n对方 20:01 我在忙。\n我 20:02 你每次都这样。\n对方 20:03 算了。",
      consentAccepted: true,
      consentVersion: "2026-09-22"
    }
  });

  assert.equal(analysisResponse.statusCode, 200);
  const result = analysisResponse.json();

  const listResponse = await application.app.inject({
    method: "GET",
    url: "/api/cases",
    headers: { cookie }
  });
  assert.equal(listResponse.statusCode, 200);
  assert.equal(listResponse.json().cases.length, 1);
  assert.equal(listResponse.json().cases[0].id, result.caseId);

  const loadResponse = await application.app.inject({
    method: "GET",
    url: `/api/cases/${result.caseId}`,
    headers: { cookie }
  });
  assert.equal(loadResponse.statusCode, 200);
  assert.equal(loadResponse.json().id, result.id);

  const deleteResponse = await application.app.inject({
    method: "DELETE",
    url: `/api/cases/${result.caseId}`,
    headers: { cookie }
  });
  assert.equal(deleteResponse.statusCode, 200);
  assert.deepEqual(deleteResponse.json(), {
    deleted: true,
    id: result.caseId
  });

  const emptyListResponse = await application.app.inject({
    method: "GET",
    url: "/api/cases",
    headers: { cookie }
  });
  assert.equal(emptyListResponse.statusCode, 200);
  assert.deepEqual(emptyListResponse.json(), { cases: [] });

  const missingResponse = await application.app.inject({
    method: "GET",
    url: `/api/cases/${result.caseId}`,
    headers: { cookie }
  });
  assert.equal(missingResponse.statusCode, 404);
});

test("requires a user-supplied key when BYOK is enforced", async (context) => {
  const application = await createApplication(
    loadConfig({
      sqlitePath: ":memory:",
      llm: {
        mode: "openai-compatible",
        baseUrl: "https://api.deepseek.com",
        apiKey: "server-key-that-must-be-ignored",
        model: "deepseek-flash",
        timeoutMs: 1000,
        supportsVision: true,
        enforceByok: true
      }
    })
  );

  context.after(async () => {
    await application.app.close();
  });

  const healthResponse = await application.app.inject({
    method: "GET",
    url: "/api/health"
  });
  assert.equal(healthResponse.statusCode, 200);
  assert.equal(healthResponse.json().provider.keyMode, "byok");

  const sessionResponse = await application.app.inject({
    method: "POST",
    url: "/api/auth/session",
    payload: {}
  });
  const cookie = sessionCookie(sessionResponse);

  const analyzeResponse = await application.app.inject({
    method: "POST",
    url: "/api/analyze",
    headers: { cookie },
    payload: {
      title: "BYOK 测试",
      goal: "deescalate",
      relationshipType: "partner",
      transcript: "我 20:00 你今天又没提前说。",
      imageDataUrl: undefined,
      consentAccepted: true,
      consentVersion: "2026-09-22"
    }
  });

  assert.equal(analyzeResponse.statusCode, 400);
  assert.equal(analyzeResponse.json().error, "missing_api_key");
});

test("isolates cases between anonymous sessions", async (context) => {
  const application = await createApplication(
    loadConfig({
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
    })
  );

  context.after(async () => {
    await application.app.close();
  });

  const firstSession = sessionCookie(
    await application.app.inject({
      method: "POST",
      url: "/api/auth/session",
      payload: {}
    })
  );
  const secondSession = sessionCookie(
    await application.app.inject({
      method: "POST",
      url: "/api/auth/session",
      payload: {}
    })
  );

  const analysisResponse = await application.app.inject({
    method: "POST",
    url: "/api/analyze",
    headers: { cookie: firstSession },
    payload: {
      title: "用户隔离测试",
      goal: "deescalate",
      relationshipType: "partner",
      transcript: "我 20:00 你今天又没提前说。",
      consentAccepted: true,
      consentVersion: "2026-09-22"
    }
  });
  assert.equal(analysisResponse.statusCode, 200);
  const result = analysisResponse.json();

  const firstList = await application.app.inject({
    method: "GET",
    url: "/api/cases",
    headers: { cookie: firstSession }
  });
  assert.equal(firstList.json().cases.length, 1);

  const secondList = await application.app.inject({
    method: "GET",
    url: "/api/cases",
    headers: { cookie: secondSession }
  });
  assert.equal(secondList.json().cases.length, 0);

  const secondAccess = await application.app.inject({
    method: "GET",
    url: `/api/cases/${result.caseId}`,
    headers: { cookie: secondSession }
  });
  assert.equal(secondAccess.statusCode, 404);
});
