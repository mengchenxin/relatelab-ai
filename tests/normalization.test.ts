import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDynamics,
  normalizeStrategies,
  normalizeTimeline
} from "../src/server/agent/normalize.ts";

test("normalizes alternate timeline field names from a provider", () => {
  const timeline = normalizeTimeline({
    events: [
      {
        speaker: "我",
        time: "21:10",
        text: "你今天又这么晚。",
        emotion: "失望"
      }
    ]
  });

  assert.equal(timeline.events[0].id, "event-1");
  assert.equal(timeline.events[0].actor, "self");
  assert.equal(timeline.events[0].quote, "你今天又这么晚。");
  assert.deepEqual(timeline.events[0].emotions, ["失望"]);
});

test("normalizes string needs and wrapped strategy arrays", () => {
  const dynamics = normalizeDynamics({
    pattern: "要求与撤退循环",
    needs: ["获得明确回应"],
    confidence: "0.82"
  });
  const strategies = normalizeStrategies({
    strategies: [
      {
        name: "先暂停争论",
        type: "repair",
        response: "我们先停一下，稍后再谈。",
        evidence: "你每次都这么说。"
      }
    ]
  });

  assert.equal(dynamics.emotionalNeeds[0].need, "获得明确回应");
  assert.equal(strategies[0].title, "先暂停争论");
  assert.equal(strategies[0].tone, "repair");
  assert.deepEqual(strategies[0].evidenceQuotes, ["你每次都这么说。"]);
});
