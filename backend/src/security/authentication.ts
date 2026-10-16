import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config";

/**
 * Administrative authentication (spec §13, §14).
 *
 * `/admin/*` endpoints require `Authorization: Bearer <ADMIN_API_TOKEN>`.
 * Both sides are hashed with SHA-256 and compared with `crypto.timingSafeEqual`
 * so the comparison runs in constant time regardless of the supplied token.
 */
export type AdminPreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function parseBearer(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1];
  return token && token.length > 0 ? token : null;
}

/** Builds the Fastify `preHandler` that guards the administrative routes. */
export function requireAdmin(config: AppConfig): AdminPreHandler {
  const expected = sha256(config.ADMIN_API_TOKEN);
  return async (request, reply) => {
    const provided = parseBearer(request.headers.authorization);
    // Hash before comparing to keep both buffers the same length.
    if (provided === null || !timingSafeEqual(sha256(provided), expected)) {
      await reply.code(401).send({ error: "UNAUTHORIZED" });
    }
  };
}
