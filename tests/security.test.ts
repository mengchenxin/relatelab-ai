import assert from "node:assert/strict";
import test from "node:test";
import {
  createSessionToken,
  verifySessionToken
} from "../src/server/auth/session.ts";
import { validateImageDataUrl } from "../src/server/security/image.ts";
import { FixedWindowRateLimiter } from "../src/server/security/rateLimit.ts";

const sessionConfig = {
  secret: "test-session-secret",
  cookieName: "relatelab_session",
  ttlSeconds: 60
};

test("signs and verifies anonymous sessions", () => {
  const created = createSessionToken(sessionConfig);
  assert.equal(
    verifySessionToken(created.token, sessionConfig)?.userId,
    created.session.userId
  );
  assert.equal(
    verifySessionToken(`${created.token}tampered`, sessionConfig),
    null
  );
});

test("validates image magic bytes and size", () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("fixture")
  ]);
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  assert.equal(validateImageDataUrl(dataUrl).mimeType, "image/png");
  assert.throws(
    () => validateImageDataUrl(`data:image/jpeg;base64,${png.toString("base64")}`),
    /格式不匹配/
  );
});

test("enforces a fixed-window rate limit", () => {
  const limiter = new FixedWindowRateLimiter();
  assert.equal(limiter.consume("user", 2, 60_000).allowed, true);
  assert.equal(limiter.consume("user", 2, 60_000).allowed, true);
  assert.equal(limiter.consume("user", 2, 60_000).allowed, false);
});
