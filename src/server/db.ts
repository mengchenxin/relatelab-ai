import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Pool } from "pg";
import type { AppConfig } from "./config.ts";
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

export interface RelateDatabase {
  readonly kind: "sqlite" | "postgres";
  saveCase(input: {
    id: string;
    ownerId: string;
    title: string;
    goal: string;
    relationshipType: string;
    transcript: string;
    hasImage: boolean;
    createdAt: string;
  }): Promise<void>;
  saveRun(input: {
    ownerId: string;
    result: AnalysisResult;
    request: unknown;
  }): Promise<void>;
  getRun(id: string, ownerId: string): Promise<AnalysisResult | null>;
  getLatestRunByCaseId(
    caseId: string,
    ownerId: string
  ): Promise<AnalysisResult | null>;
  deleteCase(caseId: string, ownerId: string): Promise<boolean>;
  deleteAllForOwner(ownerId: string): Promise<number>;
  deleteExpiredCases(cutoff: string): Promise<number>;
  listCases(ownerId: string, limit?: number): Promise<CaseSummary[]>;
  saveEvaluation(report: EvaluationReport): Promise<void>;
  getLatestEvaluation(): Promise<EvaluationReport | null>;
  close(): Promise<void>;
}

export class SqliteDatabase implements RelateDatabase {
  readonly kind = "sqlite";
  readonly databasePath: string;
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    if (databasePath !== ":memory:") {
      mkdirSync(path.dirname(databasePath), { recursive: true });
    }

    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode = WAL;");
    this.database.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private hasColumn(table: string, column: string): boolean {
    const rows = this.database
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name?: string }>;
    return rows.some((row) => row.name === column);
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS cases (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        transcript TEXT NOT NULL,
        has_image INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
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
    `);

    if (!this.hasColumn("cases", "owner_id")) {
      this.database.exec(
        "ALTER TABLE cases ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'legacy';"
      );
    }
    if (!this.hasColumn("runs", "owner_id")) {
      this.database.exec(
        "ALTER TABLE runs ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'legacy';"
      );
    }

    this.database.exec(`
      CREATE INDEX IF NOT EXISTS idx_cases_owner_id
        ON cases(owner_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_runs_owner_id
        ON runs(owner_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_runs_case_id ON runs(case_id);
      CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);
    `);
  }

  async saveCase(input: {
    id: string;
    ownerId: string;
    title: string;
    goal: string;
    relationshipType: string;
    transcript: string;
    hasImage: boolean;
    createdAt: string;
  }): Promise<void> {
    this.database
      .prepare(
        `INSERT OR REPLACE INTO cases
          (id, owner_id, title, goal, relationship_type, transcript, has_image, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.ownerId,
        input.title,
        input.goal,
        input.relationshipType,
        input.transcript,
        input.hasImage ? 1 : 0,
        input.createdAt
      );
  }

  async saveRun(input: {
    ownerId: string;
    result: AnalysisResult;
    request: unknown;
  }): Promise<void> {
    this.database
      .prepare(
        `INSERT OR REPLACE INTO runs
          (id, owner_id, case_id, status, provider_mode, model, risk_level,
           duration_ms, total_tokens, result_json, request_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.result.id,
        input.ownerId,
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

  async getRun(id: string, ownerId: string): Promise<AnalysisResult | null> {
    const row = this.database
      .prepare("SELECT result_json FROM runs WHERE id = ? AND owner_id = ?")
      .get(id, ownerId) as { result_json?: string } | undefined;
    return row ? jsonParse<AnalysisResult>(row.result_json) : null;
  }

  async getLatestRunByCaseId(
    caseId: string,
    ownerId: string
  ): Promise<AnalysisResult | null> {
    const row = this.database
      .prepare(
        `SELECT result_json FROM runs
         WHERE case_id = ? AND owner_id = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(caseId, ownerId) as { result_json?: string } | undefined;
    return row ? jsonParse<AnalysisResult>(row.result_json) : null;
  }

  async deleteCase(caseId: string, ownerId: string): Promise<boolean> {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const owned = this.database
        .prepare("SELECT id FROM cases WHERE id = ? AND owner_id = ?")
        .get(caseId, ownerId);
      if (!owned) {
        this.database.exec("ROLLBACK;");
        return false;
      }
      this.database
        .prepare("DELETE FROM runs WHERE case_id = ? AND owner_id = ?")
        .run(caseId, ownerId);
      this.database
        .prepare("DELETE FROM cases WHERE id = ? AND owner_id = ?")
        .run(caseId, ownerId);
      this.database.exec("COMMIT;");
      return true;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  async deleteAllForOwner(ownerId: string): Promise<number> {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database
        .prepare(
          "DELETE FROM runs WHERE case_id IN (SELECT id FROM cases WHERE owner_id = ?)"
        )
        .run(ownerId);
      const result = this.database
        .prepare("DELETE FROM cases WHERE owner_id = ?")
        .run(ownerId);
      this.database.exec("COMMIT;");
      return Number(result.changes);
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  async deleteExpiredCases(cutoff: string): Promise<number> {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database
        .prepare(
          "DELETE FROM runs WHERE case_id IN (SELECT id FROM cases WHERE created_at < ?)"
        )
        .run(cutoff);
      const result = this.database
        .prepare("DELETE FROM cases WHERE created_at < ?")
        .run(cutoff);
      this.database.exec("COMMIT;");
      return Number(result.changes);
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  async listCases(ownerId: string, limit = 50): Promise<CaseSummary[]> {
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
           WHERE case_id = c.id AND owner_id = c.owner_id
           ORDER BY created_at DESC
           LIMIT 1
         )
         WHERE c.owner_id = ?
         ORDER BY c.created_at DESC
         LIMIT ?`
      )
      .all(ownerId, limit) as Array<Record<string, unknown>>;

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

  async saveEvaluation(report: EvaluationReport): Promise<void> {
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

  async getLatestEvaluation(): Promise<EvaluationReport | null> {
    const row = this.database
      .prepare(
        `SELECT report_json FROM evaluation_runs
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get() as { report_json?: string } | undefined;
    return row ? jsonParse<EvaluationReport>(row.report_json) : null;
  }

  async close(): Promise<void> {
    this.database.close();
  }
}

export class PostgresDatabase implements RelateDatabase {
  readonly kind = "postgres";
  private readonly pool: Pool;
  private readonly ready: Promise<void>;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000
    });
    this.ready = this.migrate();
  }

  private async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS cases (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        transcript TEXT NOT NULL,
        has_image BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        provider_mode TEXT NOT NULL,
        model TEXT NOT NULL,
        risk_level TEXT,
        duration_ms INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        result_json JSONB NOT NULL,
        request_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS evaluation_runs (
        id TEXT PRIMARY KEY,
        dataset_version TEXT NOT NULL,
        provider_mode TEXT NOT NULL,
        average_score DOUBLE PRECISION NOT NULL,
        report_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_cases_owner_id
        ON cases(owner_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_runs_owner_id
        ON runs(owner_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_runs_case_id ON runs(case_id);
    `);
  }

  async saveCase(input: {
    id: string;
    ownerId: string;
    title: string;
    goal: string;
    relationshipType: string;
    transcript: string;
    hasImage: boolean;
    createdAt: string;
  }): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO cases
        (id, owner_id, title, goal, relationship_type, transcript, has_image, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         owner_id = EXCLUDED.owner_id,
         title = EXCLUDED.title,
         goal = EXCLUDED.goal,
         relationship_type = EXCLUDED.relationship_type,
         transcript = EXCLUDED.transcript,
         has_image = EXCLUDED.has_image,
         created_at = EXCLUDED.created_at`,
      [
        input.id,
        input.ownerId,
        input.title,
        input.goal,
        input.relationshipType,
        input.transcript,
        input.hasImage,
        input.createdAt
      ]
    );
  }

  async saveRun(input: {
    ownerId: string;
    result: AnalysisResult;
    request: unknown;
  }): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO runs
        (id, owner_id, case_id, status, provider_mode, model, risk_level,
         duration_ms, total_tokens, result_json, request_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12)
       ON CONFLICT (id) DO UPDATE SET
         owner_id = EXCLUDED.owner_id,
         case_id = EXCLUDED.case_id,
         status = EXCLUDED.status,
         provider_mode = EXCLUDED.provider_mode,
         model = EXCLUDED.model,
         risk_level = EXCLUDED.risk_level,
         duration_ms = EXCLUDED.duration_ms,
         total_tokens = EXCLUDED.total_tokens,
         result_json = EXCLUDED.result_json,
         request_json = EXCLUDED.request_json,
         created_at = EXCLUDED.created_at`,
      [
        input.result.id,
        input.ownerId,
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
      ]
    );
  }

  async getRun(id: string, ownerId: string): Promise<AnalysisResult | null> {
    await this.ready;
    const result = await this.pool.query<{ result_json: AnalysisResult }>(
      "SELECT result_json FROM runs WHERE id = $1 AND owner_id = $2",
      [id, ownerId]
    );
    return result.rows[0]?.result_json || null;
  }

  async getLatestRunByCaseId(
    caseId: string,
    ownerId: string
  ): Promise<AnalysisResult | null> {
    await this.ready;
    const result = await this.pool.query<{ result_json: AnalysisResult }>(
      `SELECT result_json FROM runs
       WHERE case_id = $1 AND owner_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [caseId, ownerId]
    );
    return result.rows[0]?.result_json || null;
  }

  async deleteCase(caseId: string, ownerId: string): Promise<boolean> {
    await this.ready;
    const result = await this.pool.query(
      "DELETE FROM cases WHERE id = $1 AND owner_id = $2",
      [caseId, ownerId]
    );
    return (result.rowCount || 0) > 0;
  }

  async deleteAllForOwner(ownerId: string): Promise<number> {
    await this.ready;
    const result = await this.pool.query(
      "DELETE FROM cases WHERE owner_id = $1",
      [ownerId]
    );
    return result.rowCount || 0;
  }

  async deleteExpiredCases(cutoff: string): Promise<number> {
    await this.ready;
    const result = await this.pool.query(
      "DELETE FROM cases WHERE created_at < $1",
      [cutoff]
    );
    return result.rowCount || 0;
  }

  async listCases(ownerId: string, limit = 50): Promise<CaseSummary[]> {
    await this.ready;
    const result = await this.pool.query<Record<string, unknown>>(
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
       LEFT JOIN LATERAL (
         SELECT id, status, risk_level, duration_ms
         FROM runs
         WHERE case_id = c.id AND owner_id = c.owner_id
         ORDER BY created_at DESC
         LIMIT 1
       ) r ON TRUE
       WHERE c.owner_id = $1
       ORDER BY c.created_at DESC
       LIMIT $2`,
      [ownerId, limit]
    );

    return result.rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      goal: String(row.goal) as CaseSummary["goal"],
      relationshipType: String(
        row.relationship_type
      ) as CaseSummary["relationshipType"],
      createdAt: new Date(String(row.created_at)).toISOString(),
      status: String(row.status || "pending"),
      riskLevel: row.risk_level ? String(row.risk_level) : null,
      durationMs: row.duration_ms === null ? null : Number(row.duration_ms)
    }));
  }

  async saveEvaluation(report: EvaluationReport): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO evaluation_runs
        (id, dataset_version, provider_mode, average_score, report_json, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (id) DO UPDATE SET
         dataset_version = EXCLUDED.dataset_version,
         provider_mode = EXCLUDED.provider_mode,
         average_score = EXCLUDED.average_score,
         report_json = EXCLUDED.report_json,
         created_at = EXCLUDED.created_at`,
      [
        report.id,
        report.datasetVersion,
        report.providerMode,
        report.averageScore,
        JSON.stringify(report),
        report.createdAt
      ]
    );
  }

  async getLatestEvaluation(): Promise<EvaluationReport | null> {
    await this.ready;
    const result = await this.pool.query<{ report_json: EvaluationReport }>(
      `SELECT report_json FROM evaluation_runs
       ORDER BY created_at DESC
       LIMIT 1`
    );
    return result.rows[0]?.report_json || null;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createDatabase(
  config: Pick<AppConfig, "databaseUrl" | "sqlitePath">
): RelateDatabase {
  return config.databaseUrl
    ? new PostgresDatabase(config.databaseUrl)
    : new SqliteDatabase(config.sqlitePath);
}
