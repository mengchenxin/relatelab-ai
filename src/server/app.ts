import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import cors from "@fastify/cors";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from "fastify";
import {
  AnalysisRequestSchema,
  EventCorrectionSchema,
  HealthSchema,
  OutcomeRequestSchema,
  type AnalysisResult
} from "../shared/contracts.ts";
import { AgentOrchestrator } from "./agent/orchestrator.ts";
import { ModelGateway } from "./agent/llmGateway.ts";
import {
  createSessionToken,
  getRequestSession,
  setSessionCookie,
  type UserSession
} from "./auth/session.ts";
import { loadConfig, type AppConfig } from "./config.ts";
import { createDatabase, type RelateDatabase } from "./db.ts";
import { runEvaluation } from "./evaluation/evaluator.ts";
import { validateImageDataUrl } from "./security/image.ts";
import { FixedWindowRateLimiter } from "./security/rateLimit.ts";

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
  const database = createDatabase(config);
  const gateway = new ModelGateway(config.llm);
  const orchestrator = new AgentOrchestrator(database, gateway);
  const rateLimiter = new FixedWindowRateLimiter();

  const readSession = (request: FastifyRequest): UserSession | null =>
    getRequestSession(request, config.session);

  const requireSession = (
    request: FastifyRequest,
    reply: FastifyReply
  ): UserSession | null => {
    const session = readSession(request);
    if (!session) {
      reply.code(401).send({
        error: "authentication_required",
        message: "会话已过期，请刷新页面后重试。"
      });
      return null;
    }
    return session;
  };

  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-llm-api-key"]
  });

  app.addHook("onSend", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
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
      privacy: {
        retentionDays: config.privacy.retentionDays,
        consentVersion: config.privacy.consentVersion,
        storage: database.kind
      },
      database: database.kind,
      timestamp: new Date().toISOString()
    });
  });

  app.post("/api/auth/session", async (request, reply) => {
    const rate = rateLimiter.consume(
      `session:${request.ip}`,
      20,
      60_000
    );
    if (!rate.allowed) {
      reply.header("Retry-After", rate.retryAfterSeconds);
      return reply.code(429).send({
        error: "rate_limited"
      });
    }

    const existing = readSession(request);
    if (existing) {
      return {
        userId: existing.userId,
        expiresAt: new Date(existing.expiresAt).toISOString()
      };
    }

    const created = createSessionToken(config.session);
    setSessionCookie(reply, config, created.token);
    return {
      userId: created.session.userId,
      expiresAt: new Date(created.session.expiresAt).toISOString()
    };
  });

  app.get("/api/auth/me", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) {
      return;
    }
    return {
      userId: session.userId,
      expiresAt: new Date(session.expiresAt).toISOString()
    };
  });

  app.delete("/api/auth/data", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) {
      return;
    }
    const deletedCases = await database.deleteAllForOwner(session.userId);
    return {
      deleted: true,
      deletedCases
    };
  });

  app.get("/api/cases", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) {
      return;
    }
    return {
      cases: await database.listCases(session.userId)
    };
  });

  app.get<{ Params: { id: string } }>(
    "/api/cases/:id",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) {
        return;
      }
      const run = await database.getLatestRunByCaseId(
        request.params.id,
        session.userId
      );
      if (!run) {
        return reply.code(404).send({
          error: "case_not_found",
          message: "没有找到这个案例的运行结果。"
        });
      }
      return run;
    }
  );

  app.patch<{
    Params: { caseId: string; eventId: string };
  }>(
    "/api/cases/:caseId/events/:eventId",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) {
        return;
      }
      const parsed = EventCorrectionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_correction",
          issues: parsed.error.issues
        });
      }

      const run = await database.getLatestRunByCaseId(
        request.params.caseId,
        session.userId
      );
      if (!run) {
        return reply.code(404).send({
          error: "case_not_found"
        });
      }

      const eventIndex = run.timeline.events.findIndex(
        (event) => event.id === request.params.eventId
      );
      if (eventIndex === -1) {
        return reply.code(404).send({
          error: "event_not_found"
        });
      }

      const updatedEvents = [...run.timeline.events];
      updatedEvents[eventIndex] = {
        ...updatedEvents[eventIndex],
        quote: parsed.data.quote,
        actor: parsed.data.actor,
        timestamp: parsed.data.timestamp,
        insightConfidence: 1
      };
      const updated: AnalysisResult = {
        ...run,
        timeline: {
          ...run.timeline,
          events: updatedEvents
        }
      };

      await database.saveRun({
        ownerId: session.userId,
        result: updated,
        request: {
          source: "manual_correction",
          eventId: request.params.eventId
        }
      });
      return updated;
    }
  );

  app.post<{ Params: { caseId: string } }>(
    "/api/cases/:caseId/outcomes",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) {
        return;
      }
      const parsed = OutcomeRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_outcome",
          issues: parsed.error.issues
        });
      }
      const run = await database.getLatestRunByCaseId(
        request.params.caseId,
        session.userId
      );
      if (!run) {
        return reply.code(404).send({
          error: "case_not_found"
        });
      }
      const outcome = {
        id: randomUUID(),
        caseId: request.params.caseId,
        runId: run.id,
        createdAt: new Date().toISOString(),
        ...parsed.data
      };
      await database.saveOutcome(session.userId, outcome);
      return outcome;
    }
  );

  app.get<{ Params: { caseId: string } }>(
    "/api/cases/:caseId/outcomes",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) {
        return;
      }
      return {
        outcomes: await database.listOutcomes(
          session.userId,
          request.params.caseId
        )
      };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/cases/:id",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) {
        return;
      }
      const deleted = await database.deleteCase(
        request.params.id,
        session.userId
      );
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

  app.get<{ Params: { id: string } }>(
    "/api/runs/:id",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) {
        return;
      }
      const run = await database.getRun(
        request.params.id,
        session.userId
      );
      if (!run) {
        return reply.code(404).send({
          error: "run_not_found",
          message: "没有找到对应的分析记录。"
        });
      }
      return run;
    }
  );

  app.post("/api/analyze", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) {
      return;
    }

    const rate = rateLimiter.consume(
      `analyze:${session.userId}`,
      6,
      60_000
    );
    if (!rate.allowed) {
      reply.header("Retry-After", rate.retryAfterSeconds);
      return reply.code(429).send({
        error: "rate_limited",
        message: "分析请求过于频繁，请稍后重试。"
      });
    }

    const parsed = AnalysisRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        issues: parsed.error.issues
      });
    }

    if (!parsed.data.consentAccepted) {
      return reply.code(400).send({
        error: "consent_required",
        message: "请先确认数据使用和隐私说明。"
      });
    }

    const submittedImages = [
      ...(parsed.data.imageDataUrl ? [parsed.data.imageDataUrl] : []),
      ...parsed.data.imageDataUrls
    ];
    if (submittedImages.length > 0) {
      try {
        for (const image of submittedImages) {
          validateImageDataUrl(image);
        }
      } catch (error) {
        return reply.code(400).send({
          error: "invalid_image",
          message:
            error instanceof Error ? error.message : "聊天截图无效。"
        });
      }
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
      apiKey: suppliedApiKey || undefined,
      ownerId: session.userId
    });
  });

  app.post("/api/evals/run", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) {
      return;
    }
    return runEvaluation(orchestrator, database, gateway.providerMode);
  });

  app.get("/api/evals/latest", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) {
      return;
    }
    const report = await database.getLatestEvaluation();
    if (!report) {
      return reply.code(204).send();
    }
    return report;
  });

  const retentionCutoff = new Date(
    Date.now() - config.privacy.retentionDays * 24 * 60 * 60 * 1000
  ).toISOString();
  void database.deleteExpiredCases(retentionCutoff).catch((error) => {
    app.log.error(error, "failed to purge expired cases");
  });
  const cleanupTimer = setInterval(() => {
    const cutoff = new Date(
      Date.now() - config.privacy.retentionDays * 24 * 60 * 60 * 1000
    ).toISOString();
    void database.deleteExpiredCases(cutoff).catch((error) => {
      app.log.error(error, "failed to purge expired cases");
    });
  }, 6 * 60 * 60 * 1000);
  cleanupTimer.unref();

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
    clearInterval(cleanupTimer);
    rateLimiter.clear();
    await database.close();
  });

  return {
    app,
    database,
    orchestrator,
    gateway
  };
}
