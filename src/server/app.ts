import { existsSync } from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import {
  AnalysisRequestSchema,
  HealthSchema
} from "../shared/contracts.ts";
import { AgentOrchestrator } from "./agent/orchestrator.ts";
import { ModelGateway } from "./agent/llmGateway.ts";
import { loadConfig, type AppConfig } from "./config.ts";
import { RelateDatabase } from "./db.ts";
import { runEvaluation } from "./evaluation/evaluator.ts";

export interface ApplicationContext {
  app: FastifyInstance;
  database: RelateDatabase;
  orchestrator: AgentOrchestrator;
  gateway: ModelGateway;
}

export async function createApplication(
  config: AppConfig = loadConfig()
): Promise<ApplicationContext> {
  const app = Fastify({
    logger: true,
    bodyLimit: 8 * 1024 * 1024
  });
  const database = new RelateDatabase(config.sqlitePath);
  const gateway = new ModelGateway(config.llm);
  const orchestrator = new AgentOrchestrator(database, gateway);

  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-llm-api-key"]
  });

  app.get("/api/health", async () => {
    return HealthSchema.parse({
      status: "ok",
      service: "relatelab-ai",
      version: "0.1.0",
      provider: {
        mode: gateway.providerMode,
        model: gateway.model,
        configured: gateway.configured,
        keyMode: gateway.keyMode,
        supportsVision: gateway.supportsVision
      },
      database: config.sqlitePath === ":memory:" ? "memory" : "sqlite",
      timestamp: new Date().toISOString()
    });
  });

  app.get("/api/cases", async () => {
    return {
      cases: database.listCases()
    };
  });

  app.get<{ Params: { id: string } }>("/api/cases/:id", async (request, reply) => {
    const run = database.getLatestRunByCaseId(request.params.id);
    if (!run) {
      return reply.code(404).send({
        error: "case_not_found",
        message: "没有找到这个案例的运行结果。"
      });
    }
    return run;
  });

  app.delete<{ Params: { id: string } }>(
    "/api/cases/:id",
    async (request, reply) => {
      const deleted = database.deleteCase(request.params.id);
      if (!deleted) {
        return reply.code(404).send({
          error: "case_not_found",
          message: "没有找到要删除的案例。"
        });
      }
      return {
        deleted: true,
        id: request.params.id
      };
    }
  );

  app.get<{ Params: { id: string } }>("/api/runs/:id", async (request, reply) => {
    const run = database.getRun(request.params.id);
    if (!run) {
      return reply.code(404).send({
        error: "run_not_found",
        message: "No analysis run exists for this identifier."
      });
    }
    return run;
  });

  app.post("/api/analyze", async (request, reply) => {
    const parsed = AnalysisRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        issues: parsed.error.issues
      });
    }

    const suppliedKeyHeader = request.headers["x-llm-api-key"];
    const suppliedApiKey =
      typeof suppliedKeyHeader === "string" ? suppliedKeyHeader.trim() : "";

    if (
      gateway.providerMode !== "mock" &&
      (gateway.enforceByok || !gateway.configured) &&
      !suppliedApiKey
    ) {
      return reply.code(400).send({
        error: "missing_api_key",
        message: "请先填写你自己的 DeepSeek API Key。"
      });
    }

    return orchestrator.analyze(parsed.data, {
      apiKey: suppliedApiKey || undefined
    });
  });

  app.post("/api/evals/run", async () => {
    return runEvaluation(
      orchestrator,
      database,
      gateway.providerMode
    );
  });

  app.get("/api/evals/latest", async (_request, reply) => {
    const report = database.getLatestEvaluation();
    if (!report) {
      return reply.code(204).send();
    }
    return report;
  });

  const clientRoot = path.resolve(process.cwd(), "dist/client");
  if (existsSync(clientRoot)) {
    await app.register(fastifyStatic, {
      root: clientRoot,
      prefix: "/"
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({
          error: "not_found"
        });
      }
      return reply.sendFile("index.html");
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    const message =
      error instanceof Error ? error.message : "Unexpected internal error";
    return reply.code(500).send({
      error: "internal_error",
      message
    });
  });

  app.addHook("onClose", async () => {
    database.close();
  });

  return {
    app,
    database,
    orchestrator,
    gateway
  };
}
