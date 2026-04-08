// PII detection and redaction — standalone functions + middleware factory

import { defaultPatterns } from "./patterns/index.ts";
import type {
  Finding,
  PiiMode,
  PiiPatternGroup,
  ProxyContext,
  ProxyResponse,
  RedactBodyResult,
  RedactResult,
  RequestMiddleware,
} from "./types.ts";

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
  const groups = options?.patterns ?? defaultPatterns;
  const findings: Finding[] = [];
  let redacted = text;

  for (const group of groups) {
    for (const { name, regex, replacement } of group.patterns) {
      regex.lastIndex = 0;
      const matches = redacted.match(regex);
      if (matches) {
        findings.push({ type: name, count: matches.length });
        redacted = redacted.replace(regex, replacement);
      }
    }
  }

  return { text: redacted, findings };
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

  const allFindings: Finding[] = [];

  function walk(obj: unknown): unknown {
    if (typeof obj === "string") {
      const { text, findings } = redactPii(obj, options);
      allFindings.push(...findings);
      return text;
    }
    if (Array.isArray(obj)) {
      return obj.map(walk);
    }
    if (obj !== null && typeof obj === "object") {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        result[k] = walk(v);
      }
      return result;
    }
    return obj;
  }

  const redacted = walk(data);

  if (allFindings.length > 0) {
    return {
      body: Buffer.from(JSON.stringify(redacted), "utf-8"),
      findings: allFindings,
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
    // Content size guard
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
        ctx.state.set("piiFindings", result.findings);
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
        ctx.state.set("piiFindings", findings);
      }
    }

    return next();
  };
}
