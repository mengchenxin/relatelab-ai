import "dotenv/config";
import { randomBytes } from "node:crypto";
import path from "node:path";

export type LlmMode = "mock" | "openai-compatible";

export interface AppConfig {
  port: number;
  host: string;
  sqlitePath: string;
  databaseUrl: string;
  session: {
    secret: string;
    cookieName: string;
    ttlSeconds: number;
  };
  privacy: {
    retentionDays: number;
    consentVersion: string;
  };
  llm: {
    mode: LlmMode;
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs: number;
    supportsVision: boolean;
    enforceByok: boolean;
  };
}

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(
  overrides: Partial<AppConfig> = {}
): AppConfig {
  const llmMode =
    process.env.LLM_MODE === "openai-compatible"
      ? "openai-compatible"
      : "mock";

  const defaultConfig: AppConfig = {
    port: readNumber(process.env.PORT, 8787),
    host: process.env.HOST || "127.0.0.1",
    sqlitePath:
      process.env.SQLITE_PATH || path.resolve(process.cwd(), "data/relatelab.sqlite"),
    databaseUrl: process.env.DATABASE_URL || "",
    session: {
      secret: process.env.SESSION_SECRET || randomBytes(32).toString("hex"),
      cookieName: "relatelab_session",
      ttlSeconds: readNumber(
        process.env.SESSION_TTL_SECONDS,
        7 * 24 * 60 * 60
      )
    },
    privacy: {
      retentionDays: readNumber(process.env.DATA_RETENTION_DAYS, 30),
      consentVersion: process.env.CONSENT_VERSION || "2026-09-22"
    },
    llm: {
      mode: llmMode,
      baseUrl: (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(
        /\/$/,
        ""
      ),
      apiKey: process.env.LLM_API_KEY || "",
      model: process.env.LLM_MODEL || "gpt-4.1-mini",
      timeoutMs: readNumber(process.env.LLM_TIMEOUT_MS, 45_000),
      supportsVision: process.env.LLM_SUPPORTS_VISION === "true",
      enforceByok: process.env.LLM_ENFORCE_BYOK === "true"
    }
  };

  return {
    ...defaultConfig,
    ...overrides,
    llm: {
      ...defaultConfig.llm,
      ...overrides.llm
    },
    session: {
      ...defaultConfig.session,
      ...overrides.session
    },
    privacy: {
      ...defaultConfig.privacy,
      ...overrides.privacy
    }
  };
}
