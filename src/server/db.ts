import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AnalysisResult,
  CaseSummary,
  EvaluationReport
} from "../shared/contracts.ts";

function jsonParse<T>(value: unknown): T | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export class RelateDatabase {
  readonly path: string;
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.path = databasePath;

    if (databasePath !== ":memory:") {
      mkdirSync(path.dirname(databasePath), { recursive: true });
    }

    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode = WAL;");
    this.database.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS cases (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        transcript TEXT NOT NULL,
        has_image INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        status TEXT NOT NULL,
        provider_mode TEXT NOT NULL,
        model TEXT NOT NULL,
        risk_level TEXT,
        duration_ms INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        result_json TEXT NOT NULL,
        request_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (case_id) REFERENCES cases(id)
      );

      CREATE TABLE IF NOT EXISTS evaluation_runs (
        id TEXT PRIMARY KEY,
        dataset_version TEXT NOT NULL,
        provider_mode TEXT NOT NULL,
        average_score REAL NOT NULL,
        report_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_runs_case_id ON runs(case_id);
      CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);
    `);
  }

  saveCase(input: {
    id: string;
    title: string;
    goal: string;
    relationshipType: string;
    transcript: string;
    hasImage: boolean;
    createdAt: string;
  }): void {
    this.database
      .prepare(
        `INSERT OR REPLACE INTO cases
          (id, title, goal, relationship_type, transcript, has_image, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.title,
        input.goal,
        input.relationshipType,
        input.transcript,
        input.hasImage ? 1 : 0,
        input.createdAt
      );
  }

  saveRun(input: {
    result: AnalysisResult;
    request: unknown;
  }): void {
    this.database
      .prepare(
        `INSERT OR REPLACE INTO runs
          (id, case_id, status, provider_mode, model, risk_level, duration_ms,
           total_tokens, result_json, request_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.result.id,
        input.result.caseId,
        input.result.status,
        input.result.provider.mode,
        input.result.provider.model,
        input.result.safety.riskLevel,
        input.result.metrics.durationMs,
        input.result.metrics.totalTokens,
        JSON.stringify(input.result),
        JSON.stringify(input.request),
        input.result.createdAt
      );
  }

  getRun(id: string): AnalysisResult | null {
    const row = this.database
      .prepare("SELECT result_json FROM runs WHERE id = ?")
      .get(id) as { result_json?: string } | undefined;

    return row ? jsonParse<AnalysisResult>(row.result_json) : null;
  }

  getLatestRunByCaseId(caseId: string): AnalysisResult | null {
    const row = this.database
      .prepare(
        `SELECT result_json FROM runs
         WHERE case_id = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(caseId) as { result_json?: string } | undefined;

    return row ? jsonParse<AnalysisResult>(row.result_json) : null;
  }

  deleteCase(caseId: string): boolean {
    const existing = this.database
      .prepare("SELECT id FROM cases WHERE id = ?")
      .get(caseId) as { id?: string } | undefined;

    if (!existing?.id) {
      return false;
    }

    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database
        .prepare("DELETE FROM runs WHERE case_id = ?")
        .run(caseId);
      this.database.prepare("DELETE FROM cases WHERE id = ?").run(caseId);
      this.database.exec("COMMIT;");
      return true;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  listCases(limit = 50): CaseSummary[] {
    const rows = this.database
      .prepare(
        `SELECT
           c.id,
           c.title,
           c.goal,
           c.relationship_type,
           c.created_at,
           r.status,
           r.risk_level,
           r.duration_ms
         FROM cases c
         LEFT JOIN runs r ON r.id = (
           SELECT id FROM runs
           WHERE case_id = c.id
           ORDER BY created_at DESC
           LIMIT 1
         )
         ORDER BY c.created_at DESC
         LIMIT ?`
      )
      .all(limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      goal: String(row.goal) as CaseSummary["goal"],
      relationshipType: String(
        row.relationship_type
      ) as CaseSummary["relationshipType"],
      createdAt: String(row.created_at),
      status: String(row.status || "pending"),
      riskLevel: row.risk_level ? String(row.risk_level) : null,
      durationMs: row.duration_ms === null ? null : Number(row.duration_ms)
    }));
  }

  saveEvaluation(report: EvaluationReport): void {
    this.database
      .prepare(
        `INSERT OR REPLACE INTO evaluation_runs
          (id, dataset_version, provider_mode, average_score, report_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        report.id,
        report.datasetVersion,
        report.providerMode,
        report.averageScore,
        JSON.stringify(report),
        report.createdAt
      );
  }

  getLatestEvaluation(): EvaluationReport | null {
    const row = this.database
      .prepare(
        `SELECT report_json FROM evaluation_runs
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get() as { report_json?: string } | undefined;

    return row ? jsonParse<EvaluationReport>(row.report_json) : null;
  }

  close(): void {
    this.database.close();
  }
}
