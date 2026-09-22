import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  EvaluationReportSchema,
  type AnalysisRequest,
  type EvaluationReport,
  type Goal,
  type RelationshipType,
  type SafetyAssessment
} from "../../shared/contracts.ts";
import type { RelateDatabase } from "../db.ts";
import type { AgentOrchestrator } from "../agent/orchestrator.ts";

interface EvaluationDataset {
  version: string;
  cases: Array<{
    id: string;
    title: string;
    goal: Goal;
    relationshipType: RelationshipType;
    expectedRisk: SafetyAssessment["riskLevel"];
    transcript: string;
  }>;
}

function coverage(values: boolean[]): number {
  if (values.length === 0) {
    return 1;
  }
  return values.filter(Boolean).length / values.length;
}

export async function runEvaluation(
  orchestrator: AgentOrchestrator,
  database: RelateDatabase,
  providerMode: string
): Promise<EvaluationReport> {
  const source = JSON.parse(
    readFileSync(path.resolve(process.cwd(), "evals/dataset.json"), "utf8")
  ) as EvaluationDataset;
  const results: EvaluationReport["results"] = [];

  for (const item of source.cases) {
    const request: AnalysisRequest = {
      title: item.title,
      goal: item.goal,
      relationshipType: item.relationshipType,
      transcript: item.transcript,
      consentAccepted: true,
      consentVersion: "2026-09-22"
    };
    const result = await orchestrator.analyze(request, { persist: false });
    const containsPii =
      /test@example\.com/.test(item.transcript) ||
      /13800138000/.test(item.transcript);

    const checks = [
      {
        name: "contract",
        passed: result.trace.every((step) => step.status !== "failed"),
        detail: "The full result passed the shared runtime contract."
      },
      {
        name: "safety",
        passed: result.safety.riskLevel === item.expectedRisk,
        detail: `Expected ${item.expectedRisk}, received ${result.safety.riskLevel}.`
      },
      {
        name: "evidence",
        passed:
          result.dynamics.evidenceQuotes.length > 0 &&
          result.strategies.every((strategy) => strategy.evidenceQuotes.length > 0),
        detail: "Dynamics and strategies include evidence quotes."
      },
      {
        name: "strategy_diversity",
        passed:
          (result.safety.riskLevel === "high" && result.strategies.length === 1) ||
          new Set(result.strategies.map((strategy) => strategy.tone)).size >= 2,
        detail: "At least two response tones are represented, unless safety restricts the case."
      },
      {
        name: "redaction",
        passed: !containsPii || Object.values(result.redaction.counts).some((count) => count > 0),
        detail: containsPii
          ? `Redaction counts: ${JSON.stringify(result.redaction.counts)}`
          : "No required redaction in this sample."
      }
    ];

    const score =
      checks.filter((check) => check.passed).length / checks.length;

    results.push({
      caseId: item.id,
      passed: checks.every((check) => check.passed),
      score,
      checks
    });
  }

  const metric = (name: string): number =>
    coverage(results.map((item) => item.checks.find((check) => check.name === name)?.passed || false));

  const report = EvaluationReportSchema.parse({
    id: randomUUID(),
    datasetVersion: source.version,
    createdAt: new Date().toISOString(),
    providerMode,
    totalCases: results.length,
    passedCases: results.filter((item) => item.passed).length,
    averageScore:
      results.reduce((total, item) => total + item.score, 0) /
      Math.max(1, results.length),
    metrics: {
      schemaValidity: metric("contract"),
      safetyMatch: metric("safety"),
      evidenceCoverage: metric("evidence"),
      strategyDiversity: metric("strategy_diversity"),
      redactionCoverage: metric("redaction")
    },
    results
  });

  await database.saveEvaluation(report);
  return report;
}
