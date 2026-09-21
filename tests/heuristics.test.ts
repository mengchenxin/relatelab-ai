import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeDynamics,
  assessSafety,
  generateStrategies,
  parseTimeline
} from "../src/server/agent/heuristics.ts";

const transcript = [
  "我 21:10 你今天又这么晚。",
  "对方 21:12 工作又不是我能控制的。",
  "我 21:12 你每次都这么说。",
  "对方 21:14 那你想我怎样？",
  "我 21:15 我只是想你提前告诉我。",
  "对方 21:17 算了，没什么好说的。"
].join("\n");

test("extracts a timeline and detects the pursue-withdraw pattern", () => {
  const timeline = parseTimeline(transcript);
  const dynamics = analyzeDynamics(timeline);

  assert.equal(timeline.events.length, 6);
  assert.equal(dynamics.primaryPattern, "要求与撤退循环");
  assert.ok(dynamics.evidenceQuotes.length > 0);
});

test("flags high-risk language before ordinary strategy generation", () => {
  const safety = assessSafety("你再不回来我就打死你，大家一起同归于尽。");
  assert.equal(safety.riskLevel, "high");

  const timeline = parseTimeline(transcript);
  const strategies = generateStrategies(
    "deescalate",
    analyzeDynamics(timeline),
    safety,
    timeline
  );
  assert.equal(strategies.length, 1);
  assert.equal(strategies[0].tone, "safety");
});
