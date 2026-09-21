import assert from "node:assert/strict";
import test from "node:test";
import { redactText } from "../src/server/security/redact.ts";

test("redacts common identifiers and keeps an audit count", () => {
  const report = redactText(
    "手机号 13800138000，邮箱 test@example.com，身份证 110105199001011234。"
  );

  assert.equal(report.counts.phone, 1);
  assert.equal(report.counts.email, 1);
  assert.equal(report.counts.idCard, 1);
  assert.doesNotMatch(report.text, /13800138000/);
  assert.doesNotMatch(report.text, /test@example\.com/);
  assert.doesNotMatch(report.text, /110105199001011234/);
});

test("leaves ordinary relationship text unchanged", () => {
  const report = redactText("我 21:10 你今天又这么晚。");
  assert.equal(report.text, "我 21:10 你今天又这么晚。");
  assert.equal(Object.values(report.counts).reduce((sum, value) => sum + value, 0), 0);
});
