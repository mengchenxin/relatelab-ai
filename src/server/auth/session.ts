import {
  createHmac,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.ts";

interface SessionPayload {
  userId: string;
  expiresAt: number;
}

export interface UserSession {
  userId: string;
  expiresAt: number;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }

  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        if (separator === -1) {
          return [part, ""];
        }
        return [
          decodeURIComponent(part.slice(0, separator)),
          decodeURIComponent(part.slice(separator + 1))
        ];
      })
  );
}

export function createSessionToken(
  config: AppConfig["session"],
  userId = randomUUID()
): { token: string; session: UserSession } {
  const session = {
    userId,
    expiresAt: Date.now() + config.ttlSeconds * 1000
  };
  const payload = encode(
    JSON.stringify({
      userId: session.userId,
      expiresAt: session.expiresAt
    } satisfies SessionPayload)
  );
  return {
    token: `${payload}.${sign(payload, config.secret)}`,
    session
  };
}

export function verifySessionToken(
  token: string | undefined,
  config: AppConfig["session"]
): UserSession | null {
  if (!token) {
    return null;
  }

  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    return null;
  }

  const expected = sign(payload, config.secret);
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as SessionPayload;
    if (
      typeof parsed.userId !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now()
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function getRequestSession(
  request: FastifyRequest,
  config: AppConfig["session"]
): UserSession | null {
  const cookies = parseCookies(request.headers.cookie);
  return verifySessionToken(cookies[config.cookieName], config);
}

export function setSessionCookie(
  reply: FastifyReply,
  config: AppConfig,
  token: string
): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  reply.header(
    "Set-Cookie",
    `${config.session.cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.session.ttlSeconds}${secure}`
  );
}
