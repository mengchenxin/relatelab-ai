import { randomUUID } from "node:crypto";
import {
  AnalysisResultSchema,
  DynamicsSchema,
  SafetyAssessmentSchema,
  StrategySchema,
  TimelineSchema,
  type AnalysisRequest,
  type AnalysisResult,
  type Dynamics,
  type SafetyAssessment,
  type Strategy,
  type Timeline,
  type TraceStep
} from "../../shared/contracts.ts";
import type { RelateDatabase } from "../db.ts";
import type {
  ModelGateway,
  StructuredGenerationResult
} from "./llmGateway.ts";
import {
  analyzeDynamics,
  assessSafety,
  generateStrategies,
  mergeSafety,
  parseTimeline
} from "./heuristics.ts";
import {
  normalizeDynamics,
  normalizeSafety,
  normalizeStrategies,
  normalizeTimeline
} from "./normalize.ts";
import {
  dynamicsPrompt,
  PROMPT_VERSION,
  safetyPrompt,
  safetySystemPrompt,
  strategyPrompt,
  timelinePrompt
} from "./prompts.ts";
import { redactText } from "../security/redact.ts";

interface AnalyzeOptions {
  persist?: boolean;
  apiKey?: string;
  ownerId?: string;
}

function summarize(value: unknown, maxLength = 160): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function addUsage(
  current: { promptTokens: number; completionTokens: number; totalTokens: number },
  result: StructuredGenerationResult<unknown>
): void {
  current.promptTokens += result.usage?.promptTokens || 0;
  current.completionTokens += result.usage?.completionTokens || 0;
  current.totalTokens += result.usage?.totalTokens || 0;
}

export class AgentOrchestrator {
  private readonly database: RelateDatabase;
  private readonly gateway: ModelGateway;

  constructor(database: RelateDatabase, gateway: ModelGateway) {
    this.database = database;
    this.gateway = gateway;
  }

  async analyze(
    request: AnalysisRequest,
    options: AnalyzeOptions = {}
  ): Promise<AnalysisResult> {
    const startedAt = new Date();
    const caseId = randomUUID();
    const runId = randomUUID();
    const trace: TraceStep[] = [];
    const warnings: string[] = [];
    const usage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    };

    const redaction = redactText(request.transcript);

    const executeStep = async <T>(
      agent: string,
      inputSummary: string,
      operation: () => Promise<StructuredGenerationResult<T>>,
      outputSummary: (value: T) => string
    ): Promise<T> => {
      const stepStarted = new Date();
      const result = await operation();
      const completed = new Date();
      addUsage(usage, result);

      if (result.warning) {
        warnings.push(result.warning);
      }

      trace.push({
        id: randomUUID(),
        agent,
        status: result.degraded ? "degraded" : "completed",
        provider: result.provider,
        model: result.model,
        startedAt: stepStarted.toISOString(),
        durationMs: completed.getTime() - stepStarted.getTime(),
        inputSummary,
        outputSummary: outputSummary(result.data),
        usage: result.usage,
        error: result.error
      });

      return result.data;
    };

    if (request.imageDataUrl) {
      if (this.gateway.providerMode === "mock") {
        warnings.push(
          "A screenshot was attached, but mock mode does not perform OCR or vision extraction."
        );
      } else if (!this.gateway.supportsVision) {
        warnings.push(
          "The configured model does not support vision. The screenshot was not sent; analysis used the transcript only."
        );
      }
    }

    const timeline = await executeStep<Timeline>(
      "timeline_extraction",
      `relationship=${request.relationshipType}; characters=${redaction.text.length}; image=${Boolean(request.imageDataUrl)}`,
      () =>
        this.gateway.generate({
          agent: "timeline_extraction",
          system: safetySystemPrompt,
          user: timelinePrompt(
            request,
            redaction,
            this.gateway.supportsVision
          ),
          schema: TimelineSchema,
          fallback: () => parseTimeline(redaction.text),
          normalize: normalizeTimeline,
          imageDataUrl: this.gateway.supportsVision
            ? request.imageDataUrl
            : undefined
        }, options.apiKey),
      (value) => `${value.events.length} events; ${value.openQuestions.length} open questions`
    );

    const dynamics = await executeStep<Dynamics>(
      "dynamics_analysis",
      `${timeline.events.length} timeline events`,
      () =>
        this.gateway.generate({
          agent: "dynamics_analysis",
          system: safetySystemPrompt,
          user: dynamicsPrompt(request, timeline),
          schema: DynamicsSchema,
          fallback: () => analyzeDynamics(timeline),
          normalize: normalizeDynamics
        }, options.apiKey),
      (value) => `${value.primaryPattern}; confidence=${value.confidence.toFixed(2)}`
    );

    const modelSafety = await executeStep<SafetyAssessment>(
      "safety_triage",
      `${timeline.events.length} events; goal=${request.goal}`,
      () =>
        this.gateway.generate({
          agent: "safety_triage",
          system: safetySystemPrompt,
          user: safetyPrompt(request, redaction, timeline),
          schema: SafetyAssessmentSchema,
          fallback: () => assessSafety(redaction.text),
          normalize: normalizeSafety
        }, options.apiKey),
      (value) => `${value.riskLevel}; ${value.flags.join(", ") || "no flags"}`
    );

    const safety = mergeSafety(assessSafety(redaction.text), modelSafety);

    const strategies = await executeStep<Strategy[]>(
      "strategy_generation",
      `${dynamics.primaryPattern}; safety=${safety.riskLevel}; goal=${request.goal}`,
      () =>
        this.gateway.generate({
          agent: "strategy_generation",
          system: safetySystemPrompt,
          user: strategyPrompt(request, dynamics, safety),
          schema: StrategySchema.array().min(1),
          fallback: () => generateStrategies(request.goal, dynamics, safety, timeline),
          normalize: normalizeStrategies
        }, options.apiKey),
      (value) => `${value.length} strategies; tones=${[...new Set(value.map((item) => item.tone))].join(",")}`
    );

    const completedAt = new Date();
    const result = AnalysisResultSchema.parse({
      id: runId,
      caseId,
      status: trace.some((step) => step.status === "degraded")
        ? "degraded"
        : "completed",
      createdAt: completedAt.toISOString(),
      title: request.title,
      goal: request.goal,
      relationshipType: request.relationshipType,
      redaction,
      timeline,
      dynamics,
      safety,
      strategies,
      trace,
      warnings: [...new Set(warnings)],
      metrics: {
        durationMs: completedAt.getTime() - startedAt.getTime(),
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        estimatedCostUsd: 0
      },
      provider: {
        mode: this.gateway.providerMode,
        model: this.gateway.model
      }
    });

    if (options.persist !== false) {
      const ownerId = options.ownerId || "system";
      await this.database.saveCase({
        id: caseId,
        ownerId,
        title: request.title,
        goal: request.goal,
        relationshipType: request.relationshipType,
        transcript: redaction.text,
        hasImage: Boolean(request.imageDataUrl),
        createdAt: startedAt.toISOString()
      });
      await this.database.saveRun({
        ownerId,
        result,
        request: {
          ...request,
          transcript: redaction.text,
          imageDataUrl: request.imageDataUrl ? "[omitted]" : undefined
        }
      });
    }

    return result;
  }
}
