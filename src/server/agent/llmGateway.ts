import { z } from "zod";
import type { AppConfig } from "../config.ts";

interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface StructuredGenerationRequest<T> {
  agent: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  fallback: () => T;
  imageDataUrl?: string;
  temperature?: number;
  normalize?: (input: unknown) => unknown;
}

export interface StructuredGenerationResult<T> {
  data: T;
  provider: string;
  model: string;
  usage?: Usage;
  degraded: boolean;
  warning?: string;
  error?: string;
}

interface OpenAiResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(withoutFence);
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("\n");
  }
  return "";
}

export class ModelGateway {
  private readonly config: AppConfig["llm"];

  constructor(config: AppConfig["llm"]) {
    this.config = config;
  }

  get providerMode(): string {
    return this.config.mode;
  }

  get model(): string {
    return this.config.mode === "mock" ? "deterministic-analyzer" : this.config.model;
  }

  get configured(): boolean {
    return this.config.mode === "mock" || Boolean(this.config.apiKey);
  }

  get enforceByok(): boolean {
    return this.config.enforceByok;
  }

  get keyMode(): "none" | "server" | "byok" {
    if (this.config.mode === "mock") {
      return "none";
    }
    if (this.config.enforceByok) {
      return "byok";
    }
    return this.config.apiKey ? "server" : "none";
  }

  get supportsVision(): boolean {
    return this.config.supportsVision;
  }

  async generate<T>(
    request: StructuredGenerationRequest<T>,
    apiKeyOverride?: string
  ): Promise<StructuredGenerationResult<T>> {
    if (this.config.mode === "mock") {
      return {
        data: request.fallback(),
        provider: "deterministic",
        model: "heuristic-analyzer-v1",
        degraded: false
      };
    }

    const apiKey = this.config.enforceByok
      ? apiKeyOverride
      : apiKeyOverride || this.config.apiKey;

    if (!apiKey) {
      return {
        data: request.fallback(),
        provider: "deterministic",
        model: "heuristic-analyzer-v1",
        degraded: true,
        warning:
          "No DeepSeek API key was supplied; the run used the deterministic fallback.",
        error: "missing_api_key"
      };
    }

    try {
      const contractedRequest: StructuredGenerationRequest<T> = {
        ...request,
        user: `${request.user}

Return JSON only. It must conform exactly to this JSON Schema:
${JSON.stringify(z.toJSONSchema(request.schema))}`
      };
      const raw = await this.callOpenAiCompatible(
        contractedRequest,
        true,
        apiKey
      );
      const parsed = this.parseCandidate(contractedRequest, raw.json);

      if (!parsed.success) {
        const repaired = await this.callOpenAiCompatible(
          {
            ...contractedRequest,
            user: `${contractedRequest.user}

The previous JSON failed contract validation:
${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n")}

Return a corrected JSON object only.`
          },
          false,
          apiKey
        );
        const repairedParsed = this.parseCandidate(
          contractedRequest,
          repaired.json
        );
        if (!repairedParsed.success) {
          throw new Error(
            `structured_output_invalid: ${repairedParsed.error.issues
              .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
              .join("; ")}`
          );
        }
        return {
          data: repairedParsed.data,
          provider: "openai-compatible",
          model: this.config.model,
          usage: repaired.usage,
          degraded: false
        };
      }

      return {
        data: parsed.data,
        provider: "openai-compatible",
        model: this.config.model,
        usage: raw.usage,
        degraded: false
      };
    } catch (error) {
      return {
        data: request.fallback(),
        provider: "deterministic",
        model: "heuristic-analyzer-v1",
        degraded: true,
        warning: `${request.agent} used the deterministic fallback after a model error.`,
        error: error instanceof Error ? error.message : "unknown_model_error"
      };
    }
  }

  private parseCandidate<T>(
    request: StructuredGenerationRequest<T>,
    raw: unknown
  ): z.ZodSafeParseResult<T> {
    const candidates = this.unwrapCandidates(raw);
    let lastResult: z.ZodSafeParseResult<T> | null = null;

    for (const candidate of candidates) {
      const normalized = request.normalize
        ? request.normalize(candidate)
        : candidate;
      const parsed = request.schema.safeParse(normalized);
      if (parsed.success) {
        return parsed;
      }
      lastResult = parsed;
    }

    return lastResult || request.schema.safeParse(raw);
  }

  private unwrapCandidates(raw: unknown): unknown[] {
    const candidates: unknown[] = [raw];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return candidates;
    }

    const record = raw as Record<string, unknown>;
    for (const key of [
      "data",
      "result",
      "output",
      "timeline",
      "analysis",
      "dynamics",
      "strategies",
      "strategy",
      "safety"
    ]) {
      if (key in record) {
        candidates.push(record[key]);
      }
    }
    return candidates;
  }

  private async callOpenAiCompatible<T>(
    request: StructuredGenerationRequest<T>,
    includeJsonMode: boolean,
    apiKey: string
  ): Promise<{ json: unknown; usage?: Usage }> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs
    );

    const userContent =
      request.imageDataUrl && this.config.supportsVision
      ? [
          { type: "text", text: request.user },
          { type: "image_url", image_url: { url: request.imageDataUrl } }
        ]
      : request.user;

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: request.temperature ?? 0.2,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: userContent }
          ],
          ...(includeJsonMode
            ? {
                response_format: {
                  type: "json_object"
                }
              }
            : {})
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        if (includeJsonMode && response.status === 400) {
          return this.callOpenAiCompatible(request, false, apiKey);
        }
        throw new Error(`model_http_${response.status}: ${body.slice(0, 300)}`);
      }

      const payload = (await response.json()) as OpenAiResponse;
      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("model_response_missing_content");
      }

      return {
        json: parseJsonContent(extractTextContent(content)),
        usage: payload.usage
          ? {
              promptTokens: payload.usage.prompt_tokens || 0,
              completionTokens: payload.usage.completion_tokens || 0,
              totalTokens: payload.usage.total_tokens || 0
            }
          : undefined
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
