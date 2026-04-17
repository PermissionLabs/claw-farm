// Secret detection and stripping — standalone functions + middleware factory

import { redactPii } from "./pii-redactor.ts";
import type {
  ProxyContext,
  ProxyResponse,
  RedactBodyResult,
  RedactResult,
  RequestMiddleware,
  SecretPatternGroup,
} from "./types.ts";
import { applyPatterns, walkJson } from "./utils.ts";

export const defaultSecretPatterns: SecretPatternGroup[] = [
  {
    name: "api-keys",
    patterns: [
      { name: "GOOGLE_API_KEY", regex: /AIza[0-9A-Za-z_-]{35}/g, replacement: "[REDACTED_GOOGLE_API_KEY]" },
      { name: "OPENROUTER_KEY", regex: /\bsk-or-v1-[A-Za-z0-9]{48,}\b/g, replacement: "[REDACTED_OPENROUTER_KEY]" },
      { name: "ANTHROPIC_KEY", regex: /sk-ant-[A-Za-z0-9-]{80,}/g, replacement: "[REDACTED_ANTHROPIC_KEY]" },
      { name: "OPENAI_KEY", regex: /sk-[A-Za-z0-9]{20,}/g, replacement: "[REDACTED_OPENAI_KEY]" },
      { name: "SUPABASE_KEY", regex: /\bsbp_[A-Za-z0-9]{40,}\b/g, replacement: "[REDACTED_SUPABASE_KEY]" },
      { name: "GITHUB_PAT", regex: /\bghp_[A-Za-z0-9]{36}\b/g, replacement: "[REDACTED_GITHUB_PAT]" },
      { name: "GITHUB_OAUTH", regex: /\bgho_[A-Za-z0-9]{36}\b/g, replacement: "[REDACTED_GITHUB_OAUTH]" },
      { name: "GITHUB_APP", regex: /\bghs_[A-Za-z0-9]{36}\b/g, replacement: "[REDACTED_GITHUB_APP]" },
      { name: "GITLAB_PAT", regex: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, replacement: "[REDACTED_GITLAB_PAT]" },
    ],
  },
  {
    name: "cloud",
    patterns: [
      { name: "AWS_ACCESS_KEY", regex: /AKIA[0-9A-Z]{16}/g, replacement: "[REDACTED_AWS_ACCESS_KEY]" },
      { name: "AWS_TEMP_ACCESS_KEY", regex: /ASIA[0-9A-Z]{16}/g, replacement: "[REDACTED_AWS_TEMP_ACCESS_KEY]" },
      {
        name: "AWS_SESSION_TOKEN",
        regex: /FwoGZ[A-Za-z0-9/+=_-]{200,}/g,
        replacement: "[REDACTED_AWS_SESSION_TOKEN]",
      },
      {
        name: "AWS_SECRET_KEY",
        regex: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)[\s=:]+[A-Za-z0-9/+=]{40}/gi,
        replacement: "[REDACTED_AWS_SECRET_KEY]",
      },
      {
        name: "AWS_SESSION_TOKEN_ENV",
        regex: /(?:aws_session_token|AWS_SESSION_TOKEN)[\s=:]+[A-Za-z0-9/+=]{100,}/gi,
        replacement: "[REDACTED_AWS_SESSION_TOKEN_ENV]",
      },
    ],
  },
  {
    name: "payment",
    patterns: [
      { name: "STRIPE_KEY", regex: /\b[rs]k_live_[A-Za-z0-9]{24,}\b/g, replacement: "[REDACTED_STRIPE_KEY]" },
      { name: "STRIPE_TEST_KEY", regex: /\b[rs]k_test_[A-Za-z0-9]{24,}\b/g, replacement: "[REDACTED_STRIPE_TEST_KEY]" },
    ],
  },
  {
    name: "tokens",
    patterns: [
      {
        name: "JWT",
        regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
        replacement: "[REDACTED_JWT]",
      },
      {
        name: "PRIVATE_KEY",
        regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
        replacement: "[REDACTED_PRIVATE_KEY]",
      },
      {
        name: "GENERIC_SECRET",
        regex: /(?:token|secret|password|apikey|api_key)\s*[=:]\s*['"`]?([A-Za-z0-9+/=_-]{32,})['"`]?/gi,
        replacement: "[REDACTED_GENERIC_SECRET]",
      },
    ],
  },
];

export interface ScanSecretsOptions {
  patterns?: SecretPatternGroup[];
}

/**
 * Scan text for secrets and replace with [REDACTED_<name>].
 */
export function scanSecrets(
  text: string,
  options?: ScanSecretsOptions,
): RedactResult {
  return applyPatterns(text, options?.patterns ?? defaultSecretPatterns);
}

/**
 * Parse JSON response body, strip secrets + PII from all string values.
 * Also runs PII redaction on responses (agent might echo user data).
 */
export function scanResponseBody(
  body: Buffer,
  options?: ScanSecretsOptions,
): RedactBodyResult {
  let data: unknown;
  try {
    data = JSON.parse(body.toString("utf-8"));
  } catch {
    // Non-JSON (SSE, plain text, HTML): apply raw text scanning
    const text = body.toString("utf-8");
    const { text: cleaned, findings: secretFindings } = scanSecrets(text, options);
    const { text: final, findings: piiFindings } = redactPii(cleaned);
    const allFindings = [...secretFindings, ...piiFindings];
    if (allFindings.length > 0) {
      return { body: Buffer.from(final, "utf-8"), findings: allFindings };
    }
    return { body, findings: [] };
  }

  const { data: cleaned, findings } = walkJson(data, (s) => {
    const { text: afterSecrets, findings: secretFindings } = scanSecrets(s, options);
    const { text: afterPii, findings: piiFindings } = redactPii(afterSecrets);
    return {
      text: afterPii,
      findings: [...secretFindings, ...piiFindings],
    };
  });

  if (findings.length > 0) {
    return {
      body: Buffer.from(JSON.stringify(cleaned), "utf-8"),
      findings,
    };
  }

  return { body, findings: [] };
}

// --- Middleware factory ---

export interface SecretScannerOptions {
  patterns?: SecretPatternGroup[];
}

/**
 * Create a response middleware that scans LLM responses for secrets.
 * Wraps next() and scans the response body after upstream returns.
 */
export function secretScanner(options?: SecretScannerOptions): RequestMiddleware {
  return async (_ctx: ProxyContext, next: () => Promise<ProxyResponse>) => {
    const response = await next();

    const result = scanResponseBody(response.body, options);
    if (result.findings.length > 0) {
      return {
        ...response,
        body: result.body,
      };
    }

    return response;
  };
}
