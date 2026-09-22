import { z } from "zod";

export const GoalSchema = z.enum([
  "be_understood",
  "deescalate",
  "set_boundary",
  "apologize",
  "decide",
  "safety"
]);

export const RelationshipTypeSchema = z.enum([
  "partner",
  "friend",
  "roommate",
  "family",
  "coworker"
]);

export const AnalysisRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    goal: GoalSchema,
    relationshipType: RelationshipTypeSchema,
    transcript: z.string().trim().max(50_000).default(""),
    imageDataUrl: z.string().max(8_000_000).optional(),
    imageDataUrls: z.array(z.string().max(8_000_000)).max(6).default([]),
    consentAccepted: z.boolean().default(false),
    consentVersion: z.string().max(40).default("2026-09-22")
  })
  .refine(
    (value) =>
      value.transcript.length >= 10 ||
      Boolean(value.imageDataUrl) ||
      value.imageDataUrls.length > 0,
    {
      message:
        "Provide at least 10 characters of conversation text or a screenshot."
    }
  );

export const RedactionReportSchema = z.object({
  originalCharacters: z.number().int().nonnegative(),
  redactedCharacters: z.number().int().nonnegative(),
  counts: z.object({
    phone: z.number().int().nonnegative(),
    email: z.number().int().nonnegative(),
    idCard: z.number().int().nonnegative(),
    bankCard: z.number().int().nonnegative()
  }),
  text: z.string()
});

export const RelationshipEventSchema = z.object({
  id: z.string(),
  timestamp: z.string().nullable(),
  actor: z.enum(["self", "other", "both", "unknown"]),
  summary: z.string(),
  quote: z.string(),
  emotions: z.array(z.string()),
  signal: z.string(),
  severity: z.number().min(0).max(1),
  interpretation: z.string().default(""),
  need: z.string().default(""),
  recommendedAction: z.string().default(""),
  insightConfidence: z.number().min(0).max(1).default(0.5)
});

export const TimelineSchema = z.object({
  events: z.array(RelationshipEventSchema),
  openQuestions: z.array(z.string())
});

export const EmotionalNeedSchema = z.object({
  party: z.enum(["self", "other", "both", "unknown"]),
  need: z.string(),
  evidence: z.string()
});

export const DynamicsSchema = z.object({
  primaryPattern: z.string(),
  secondaryPatterns: z.array(z.string()),
  emotionalNeeds: z.array(EmotionalNeedSchema),
  escalationCycle: z.array(z.string()),
  triggers: z.array(z.string()),
  blindSpots: z.array(z.string()),
  evidenceQuotes: z.array(z.string()),
  confidence: z.number().min(0).max(1)
});

export const SafetyAssessmentSchema = z.object({
  riskLevel: z.enum(["none", "low", "medium", "high"]),
  flags: z.array(z.string()),
  rationale: z.string(),
  recommendedAction: z.string()
});

export const StrategySchema = z.object({
  id: z.string(),
  title: z.string(),
  tone: z.enum(["gentle", "direct", "boundary", "repair", "safety"]),
  objective: z.string(),
  message: z.string(),
  whyItWorks: z.string(),
  risk: z.string(),
  whenToUse: z.string(),
  confidence: z.number().min(0).max(1),
  evidenceQuotes: z.array(z.string())
});

export const TraceStepSchema = z.object({
  id: z.string(),
  agent: z.string(),
  status: z.enum(["completed", "degraded", "failed"]),
  provider: z.string(),
  model: z.string(),
  startedAt: z.string(),
  durationMs: z.number().nonnegative(),
  inputSummary: z.string(),
  outputSummary: z.string(),
  usage: z
    .object({
      promptTokens: z.number().nonnegative(),
      completionTokens: z.number().nonnegative(),
      totalTokens: z.number().nonnegative()
    })
    .optional(),
  error: z.string().optional()
});

export const AnalysisResultSchema = z.object({
  id: z.string(),
  caseId: z.string(),
  status: z.enum(["completed", "degraded"]),
  createdAt: z.string(),
  title: z.string(),
  goal: GoalSchema,
  relationshipType: RelationshipTypeSchema,
  redaction: RedactionReportSchema,
  timeline: TimelineSchema,
  dynamics: DynamicsSchema,
  safety: SafetyAssessmentSchema,
  strategies: z.array(StrategySchema),
  trace: z.array(TraceStepSchema),
  warnings: z.array(z.string()),
  versions: z.object({
    prompt: z.string(),
    schema: z.string(),
    normalizer: z.string()
  }),
  metrics: z.object({
    durationMs: z.number().nonnegative(),
    promptTokens: z.number().nonnegative(),
    completionTokens: z.number().nonnegative(),
    totalTokens: z.number().nonnegative(),
    estimatedCostUsd: z.number().nonnegative()
  }),
  provider: z.object({
    mode: z.string(),
    model: z.string()
  })
});

export const CaseSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  goal: GoalSchema,
  relationshipType: RelationshipTypeSchema,
  createdAt: z.string(),
  status: z.string(),
  riskLevel: z.string().nullable(),
  durationMs: z.number().nullable()
});

export const EvaluationCaseResultSchema = z.object({
  caseId: z.string(),
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  checks: z.array(
    z.object({
      name: z.string(),
      passed: z.boolean(),
      detail: z.string()
    })
  )
});

export const EvaluationReportSchema = z.object({
  id: z.string(),
  datasetVersion: z.string(),
  createdAt: z.string(),
  providerMode: z.string(),
  totalCases: z.number().int().nonnegative(),
  passedCases: z.number().int().nonnegative(),
  averageScore: z.number().min(0).max(1),
  metrics: z.object({
    schemaValidity: z.number().min(0).max(1),
    safetyMatch: z.number().min(0).max(1),
    evidenceCoverage: z.number().min(0).max(1),
    strategyDiversity: z.number().min(0).max(1),
    redactionCoverage: z.number().min(0).max(1)
  }),
  results: z.array(EvaluationCaseResultSchema)
});

export const HealthSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  version: z.string(),
  provider: z.object({
    mode: z.string(),
    model: z.string(),
    configured: z.boolean(),
    keyMode: z.enum(["none", "server", "byok"]),
    supportsVision: z.boolean()
  }),
  privacy: z.object({
    retentionDays: z.number().int().positive(),
    consentVersion: z.string(),
    storage: z.enum(["sqlite", "postgres"])
  }),
  database: z.string(),
  timestamp: z.string()
});

export const OutcomeRequestSchema = z.object({
  strategyId: z.string().min(1).max(80),
  adopted: z.boolean(),
  responseTone: z
    .enum([
      "not_sent",
      "improved",
      "neutral",
      "worsened",
      "no_response"
    ])
    .default("not_sent"),
  conflictChange: z
    .enum(["improved", "unchanged", "worsened", "unknown"])
    .default("unknown"),
  notes: z.string().trim().max(1_000).default("")
});

export const OutcomeSchema = OutcomeRequestSchema.extend({
  id: z.string(),
  caseId: z.string(),
  runId: z.string(),
  createdAt: z.string()
});

export const EventCorrectionSchema = z.object({
  quote: z.string().trim().min(1).max(4_000),
  actor: z.enum(["self", "other", "both", "unknown"]).default("unknown"),
  timestamp: z.string().trim().max(80).nullable().default(null)
});

export type Goal = z.infer<typeof GoalSchema>;
export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;
export type AnalysisRequest = z.infer<typeof AnalysisRequestSchema>;
export type RedactionReport = z.infer<typeof RedactionReportSchema>;
export type RelationshipEvent = z.infer<typeof RelationshipEventSchema>;
export type Timeline = z.infer<typeof TimelineSchema>;
export type Dynamics = z.infer<typeof DynamicsSchema>;
export type SafetyAssessment = z.infer<typeof SafetyAssessmentSchema>;
export type Strategy = z.infer<typeof StrategySchema>;
export type TraceStep = z.infer<typeof TraceStepSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type CaseSummary = z.infer<typeof CaseSummarySchema>;
export type EvaluationReport = z.infer<typeof EvaluationReportSchema>;
export type OutcomeRequest = z.infer<typeof OutcomeRequestSchema>;
export type Outcome = z.infer<typeof OutcomeSchema>;
export type EventCorrection = z.infer<typeof EventCorrectionSchema>;
