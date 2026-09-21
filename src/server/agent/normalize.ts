import type {
  Dynamics,
  RelationshipEvent,
  SafetyAssessment,
  Strategy,
  Timeline
} from "../../shared/contracts.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstValue(
  record: Record<string, unknown>,
  keys: string[]
): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }
  return undefined;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return typeof value === "string" && value.trim() ? [value] : [];
}

function asNumber(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeActor(value: unknown): RelationshipEvent["actor"] {
  const actor = asString(value).toLowerCase();
  if (/^(self|me|user|我|本人|自己|用户)$/.test(actor)) {
    return "self";
  }
  if (/^(other|partner|friend|对方|伴侣|朋友|他|她|ta)$/.test(actor)) {
    return "other";
  }
  if (/^(both|双方|彼此)$/.test(actor)) {
    return "both";
  }
  return "unknown";
}

export function normalizeTimeline(input: unknown): Timeline {
  const record = isRecord(input) ? input : {};
  const rawEvents = Array.isArray(record.events)
    ? record.events
    : Array.isArray(record.timeline)
      ? record.timeline
      : Array.isArray(input)
        ? input
        : [];

  const events: RelationshipEvent[] = rawEvents.map((value, index) => {
    const event = isRecord(value) ? value : {};
    return {
      id: asString(firstValue(event, ["id", "eventId"]), `event-${index + 1}`),
      timestamp:
        firstValue(event, ["timestamp", "time", "date"]) === undefined
          ? null
          : asString(firstValue(event, ["timestamp", "time", "date"])) || null,
      actor: normalizeActor(
        firstValue(event, ["actor", "speaker", "role", "side"])
      ),
      summary: asString(
        firstValue(event, ["summary", "description", "meaning"]),
        "模型识别到一条关系事件"
      ),
      quote: asString(
        firstValue(event, ["quote", "text", "content", "message"]),
        ""
      ),
      emotions: asStringArray(
        firstValue(event, ["emotions", "emotion", "feelings"])
      ),
      signal: asString(
        firstValue(event, ["signal", "type", "pattern", "communicationSignal"]),
        "信息陈述"
      ),
      severity: Math.max(
        0,
        Math.min(1, asNumber(event.severity, 0.2))
      )
    };
  });

  return {
    events,
    openQuestions: asStringArray(
      firstValue(record, ["openQuestions", "questions", "unknowns"])
    )
  };
}

function normalizeParty(value: unknown): Dynamics["emotionalNeeds"][number]["party"] {
  return normalizeActor(value);
}

export function normalizeDynamics(input: unknown): Dynamics {
  const record = isRecord(input) ? input : {};
  const rawNeeds = Array.isArray(record.emotionalNeeds)
    ? record.emotionalNeeds
    : Array.isArray(record.needs)
      ? record.needs
      : [];

  const emotionalNeeds = rawNeeds.map((value) => {
    if (typeof value === "string") {
      return {
        party: "unknown" as const,
        need: value,
        evidence: "模型未提供独立引用"
      };
    }
    const need = isRecord(value) ? value : {};
    return {
      party: normalizeParty(firstValue(need, ["party", "actor", "side"])),
      need: asString(
        firstValue(need, ["need", "description", "value"]),
        "未被明确说明"
      ),
      evidence: asString(
        firstValue(need, ["evidence", "quote", "support"]),
        "模型未提供独立引用"
      )
    };
  });

  return {
    primaryPattern: asString(
      firstValue(record, ["primaryPattern", "mainPattern", "pattern"]),
      "需求表达不完整"
    ),
    secondaryPatterns: asStringArray(
      firstValue(record, ["secondaryPatterns", "patterns", "secondary"])
    ),
    emotionalNeeds,
    escalationCycle: asStringArray(
      firstValue(record, ["escalationCycle", "cycle", "escalation"])
    ),
    triggers: asStringArray(firstValue(record, ["triggers", "causes"])),
    blindSpots: asStringArray(
      firstValue(record, ["blindSpots", "blindspots", "risks"])
    ),
    evidenceQuotes: asStringArray(
      firstValue(record, ["evidenceQuotes", "evidence", "quotes"])
    ),
    confidence: Math.max(
      0,
      Math.min(
        1,
        asNumber(firstValue(record, ["confidence", "score"]), 0.5)
      )
    )
  };
}

function normalizeRiskLevel(
  value: unknown
): SafetyAssessment["riskLevel"] {
  const level = asString(value).toLowerCase();
  if (["none", "low", "medium", "high"].includes(level)) {
    return level as SafetyAssessment["riskLevel"];
  }
  if (/^(无|无风险|安全)$/.test(level)) {
    return "none";
  }
  if (/^(低|低风险)$/.test(level)) {
    return "low";
  }
  if (/^(中|中风险)$/.test(level)) {
    return "medium";
  }
  if (/^(高|高风险|危险)$/.test(level)) {
    return "high";
  }
  return "none";
}

export function normalizeSafety(input: unknown): SafetyAssessment {
  const record = isRecord(input) ? input : {};
  return {
    riskLevel: normalizeRiskLevel(
      firstValue(record, ["riskLevel", "risk", "level"])
    ),
    flags: asStringArray(firstValue(record, ["flags", "signals", "warnings"])),
    rationale: asString(
      firstValue(record, ["rationale", "reason", "explanation"]),
      "模型未提供原因说明"
    ),
    recommendedAction: asString(
      firstValue(record, [
        "recommendedAction",
        "action",
        "recommendation"
      ]),
      "建议由人工复核安全判断"
    )
  };
}

function normalizeTone(value: unknown): Strategy["tone"] {
  const tone = asString(value).toLowerCase();
  if (
    ["gentle", "direct", "boundary", "repair", "safety"].includes(tone)
  ) {
    return tone as Strategy["tone"];
  }
  if (/^(温和|关心|共情)$/.test(tone)) {
    return "gentle";
  }
  if (/^(直接|明确)$/.test(tone)) {
    return "direct";
  }
  if (/^(边界|拒绝)$/.test(tone)) {
    return "boundary";
  }
  if (/^(修复|道歉|和解)$/.test(tone)) {
    return "repair";
  }
  if (/^(安全|紧急)$/.test(tone)) {
    return "safety";
  }
  return "gentle";
}

export function normalizeStrategies(input: unknown): Strategy[] {
  const rawStrategies = Array.isArray(input)
    ? input
    : isRecord(input) && Array.isArray(input.strategies)
      ? input.strategies
      : [];

  return rawStrategies.map((value, index) => {
    const strategy = isRecord(value) ? value : {};
    return {
      id: asString(firstValue(strategy, ["id", "strategyId"]), `strategy-${index + 1}`),
      title: asString(
        firstValue(strategy, ["title", "name"]),
        `策略 ${index + 1}`
      ),
      tone: normalizeTone(firstValue(strategy, ["tone", "style", "type"])),
      objective: asString(
        firstValue(strategy, ["objective", "goal", "purpose"]),
        "改善当前沟通"
      ),
      message: asString(
        firstValue(strategy, ["message", "response", "reply", "draft"]),
        ""
      ),
      whyItWorks: asString(
        firstValue(strategy, ["whyItWorks", "reason", "rationale"]),
        "模型未提供独立解释"
      ),
      risk: asString(
        firstValue(strategy, ["risk", "tradeoff"]),
        "效果取决于对方是否愿意回应"
      ),
      whenToUse: asString(
        firstValue(strategy, ["whenToUse", "condition", "usage"]),
        "需要根据现场气氛谨慎使用"
      ),
      confidence: Math.max(
        0,
        Math.min(
          1,
          asNumber(firstValue(strategy, ["confidence", "score"]), 0.6)
        )
      ),
      evidenceQuotes: asStringArray(
        firstValue(strategy, ["evidenceQuotes", "evidence", "quotes"])
      )
    };
  });
}
