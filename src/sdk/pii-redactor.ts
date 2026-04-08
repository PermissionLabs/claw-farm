// PII detection and redaction — standalone functions + middleware factory

import { defaultPatterns } from "./patterns/index.ts";
import type {
  PiiMode,
  PiiPatternGroup,
  ProxyContext,
  ProxyResponse,
  RedactBodyResult,
  RedactResult,
  RequestMiddleware,
} from "./types.ts";
import { applyPatterns, STATE_KEYS, walkJson } from "./utils.ts";

export interface RedactPiiOptions {
  patterns?: PiiPatternGroup[];
}

/**
 * Scan text for PII and replace with [REDACTED_<name>].
 * Uses defaultPatterns if none specified.
 */
export function redactPii(
  text: string,
  options?: RedactPiiOptions,
): RedactResult {
  return applyPatterns(text, options?.patterns ?? defaultPatterns);
}

/**
 * Parse JSON body, redact PII from all string values, return modified body.
 */
export function redactRequestBody(
  body: Buffer,
  options?: RedactPiiOptions,
): RedactBodyResult {
  let data: unknown;
  try {
    data = JSON.parse(body.toString("utf-8"));
  } catch {
    return { body, findings: [] };
  }

  const { data: redacted, findings } = walkJson(data, (s) =>
    redactPii(s, options),
  );

  if (findings.length > 0) {
    return {
      body: Buffer.from(JSON.stringify(redacted), "utf-8"),
      findings,
    };
  }

  return { body, findings: [] };
}

// --- Middleware factory ---

export interface PiiRedactorOptions {
  mode?: PiiMode;
  patterns?: PiiPatternGroup[];
  maxSizeMb?: number;
}

/**
 * Create a request middleware that redacts/blocks/warns on PII.
 */
export function piiRedactor(options?: PiiRedactorOptions): RequestMiddleware {
  const mode: PiiMode = options?.mode ?? "redact";
  const patterns = options?.patterns;
  const maxSizeMb = options?.maxSizeMb ?? 5;

  return async (ctx: ProxyContext, next: () => Promise<ProxyResponse>) => {
    if (ctx.body.length > maxSizeMb * 1024 * 1024) {
      return {
        status: 413,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ error: "Request too large" })),
      };
    }

    if (mode === "redact") {
      const result = redactRequestBody(ctx.body, { patterns });
      ctx.body = result.body;
      if (result.findings.length > 0) {
        ctx.state.set(STATE_KEYS.PII_FINDINGS, result.findings);
      }
    } else if (mode === "block") {
      const text = ctx.body.toString("utf-8");
      const { findings } = redactPii(text, { patterns });
      if (findings.length > 0) {
        return {
          status: 422,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({
              error: "Request blocked: PII detected",
              types: findings.map((f) => f.type),
            }),
          ),
        };
      }
    } else if (mode === "warn") {
      const text = ctx.body.toString("utf-8");
      const { findings } = redactPii(text, { patterns });
      if (findings.length > 0) {
        ctx.state.set(STATE_KEYS.PII_FINDINGS, findings);
      }
    }

    return next();
  };
}
