import type {
  AnalysisRequest,
  AnalysisResult,
  CaseSummary,
  EvaluationReport
} from "../shared/contracts.ts";

interface HealthResponse {
  status: "ok";
  service: string;
  version: string;
  provider: {
    mode: string;
    model: string;
    configured: boolean;
    keyMode: "none" | "server" | "byok";
    supportsVision: boolean;
  };
  privacy: {
    retentionDays: number;
    consentVersion: string;
    storage: "sqlite" | "postgres";
  };
  database: string;
  timestamp: string;
}

async function request<T>(
  path: string,
  init?: RequestInit,
  retry = true
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers
    }
  });

  if (response.status === 401 && retry && path !== "/api/auth/session") {
    await ensureSession();
    return request<T>(path, init, false);
  }

  if (response.status === 204) {
    return null as T;
  }

  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export function ensureSession(): Promise<{
  userId: string;
  expiresAt: string;
}> {
  return request<{ userId: string; expiresAt: string }>(
    "/api/auth/session",
    {
      method: "POST",
      body: "{}"
    },
    false
  );
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/api/health");
}

export async function getCases(): Promise<CaseSummary[]> {
  const response = await request<{ cases: CaseSummary[] }>("/api/cases");
  return response.cases;
}

export function getCase(id: string): Promise<AnalysisResult> {
  return request<AnalysisResult>(`/api/cases/${encodeURIComponent(id)}`);
}

export function deleteCase(
  id: string
): Promise<{ deleted: boolean; id: string }> {
  return request<{ deleted: boolean; id: string }>(
    `/api/cases/${encodeURIComponent(id)}`,
    {
      method: "DELETE"
    }
  );
}

export function deleteAllData(): Promise<{
  deleted: boolean;
  deletedCases: number;
}> {
  return request<{ deleted: boolean; deletedCases: number }>(
    "/api/auth/data",
    {
      method: "DELETE"
    }
  );
}

export function analyzeCase(
  input: AnalysisRequest,
  apiKey?: string
): Promise<AnalysisResult> {
  return request<AnalysisResult>("/api/analyze", {
    method: "POST",
    body: JSON.stringify(input),
    headers: apiKey
      ? {
          "x-llm-api-key": apiKey
        }
      : undefined
  });
}

export function runEvaluation(): Promise<EvaluationReport> {
  return request<EvaluationReport>("/api/evals/run", {
    method: "POST",
    body: "{}"
  });
}

export function getLatestEvaluation(): Promise<EvaluationReport | null> {
  return request<EvaluationReport | null>("/api/evals/latest");
}
