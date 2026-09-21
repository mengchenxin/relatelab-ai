import "dotenv/config";
import path from "node:path";

export type LlmMode = "mock" | "openai-compatible";

export interface AppConfig {
  port: number;
  host: string;
  sqlitePath: string;
  llm: {
    mode: LlmMode;
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs: number;
    supportsVision: boolean;
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
    llm: {
      mode: llmMode,
      baseUrl: (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(
        /\/$/,
        ""
      ),
      apiKey: process.env.LLM_API_KEY || "",
      model: process.env.LLM_MODEL || "gpt-4.1-mini",
      timeoutMs: readNumber(process.env.LLM_TIMEOUT_MS, 45_000),
      supportsVision: process.env.LLM_SUPPORTS_VISION === "true"
    }
  };

  return {
    ...defaultConfig,
    ...overrides,
    llm: {
      ...defaultConfig.llm,
      ...overrides.llm
    }
  };
}
