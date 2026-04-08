// JSONL audit logger — standalone factory + middleware factory

import { appendFile } from "node:fs/promises";
import type {
  Finding,
  ProxyContext,
  ProxyResponse,
  RequestMiddleware,
} from "./types.ts";
import { STATE_KEYS } from "./utils.ts";

export interface AuditLoggerOptions {
  path: string;
  logger?: { error: (...args: unknown[]) => void };
}

export interface AuditLogger {
  log: (entry: Record<string, unknown>) => void;
}

/**
 * Create an audit logger that writes JSONL to the specified path.
 * Fire-and-forget: never throws, logs errors via optional logger.
 */
export function createAuditLogger(options: AuditLoggerOptions): AuditLogger {
  return {
    log(entry: Record<string, unknown>): void {
      const line =
        JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) +
        "\n";
      appendFile(options.path, line, "utf-8").catch((err) => {
        options.logger?.error("Failed to write audit log", err);
      });
    },
  };
}

/**
 * Create a middleware that logs request/response metadata as JSONL.
 */
export function auditLogger(options: AuditLoggerOptions): RequestMiddleware {
  const logger = createAuditLogger(options);

  return async (ctx: ProxyContext, next: () => Promise<ProxyResponse>) => {
    const start = performance.now();

    const response = await next();

    const elapsedMs = Math.round(performance.now() - start);
    const piiFindings = ctx.state.get(STATE_KEYS.PII_FINDINGS) as Finding[] | undefined;
    const contentHash = ctx.state.get(STATE_KEYS.CONTENT_HASH) as string | undefined;

    logger.log({
      event: "request",
      method: ctx.method,
      path: ctx.path,
      source_ip: ctx.sourceIp,
      content_hash: contentHash,
      request_size: ctx.body.length,
      response_status: response.status,
      response_size: response.body.length,
      elapsed_ms: elapsedMs,
      pii_redacted: piiFindings != null && piiFindings.length > 0,
    });

    return response;
  };
}
