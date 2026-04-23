// Shared types for claw-farm SDK security modules

// --- PII ---

export interface Finding {
  type: string;
  count: number;
}

export interface RedactResult {
  text: string;
  findings: Finding[];
}

export interface RedactBodyResult {
  body: Buffer;
  findings: Finding[];
}

export type PiiMode = "redact" | "block" | "warn";

export interface PiiPattern {
  name: string;
  regex: RegExp;
  replacement: string;
}

export interface PiiPatternGroup {
  name: string;
  patterns: PiiPattern[];
}

// --- Secret scanning ---

export interface SecretPattern {
  name: string;
  regex: RegExp;
  replacement: string;
}

export interface SecretPatternGroup {
  name: string;
  patterns: SecretPattern[];
}

// --- Middleware pipeline ---

export interface LlmProvider {
  name: string;
  baseUrl: string;
  authHeader: string;
  /** The full header value to inject (e.g. "Bearer sk-..." or raw API key) */
  authValue: string;
  pathPrefixes: string[];
  queryAllowlist: Set<string>;
  extraHeaders?: Record<string, string>;
  transformRequest?: (body: Record<string, unknown>) => Record<string, unknown>;
  transformResponse?: (body: Record<string, unknown>) => Record<string, unknown>;
}

export interface ProxyContext {
  method: string;
  path: string;
  queryString: string;
  headers: Record<string, string>;
  body: Buffer;
  provider: LlmProvider;
  sourceIp?: string;
  state: Map<string, unknown>;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export type RequestMiddleware = (
  ctx: ProxyContext,
  next: () => Promise<ProxyResponse>,
) => Promise<ProxyResponse>;

export interface ProxyRequest {
  method: string;
  path: string;
  queryString: string;
  headers: Record<string, string>;
  body: Buffer;
  sourceIp?: string;
}

export interface LlmProxyOptions {
  provider: LlmProvider;
  pipeline?: RequestMiddleware[];
  logger?: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
  timeout?: number;
  maxSizeMb?: number;
  forwardHeaders?: Set<string>;
  /**
   * Options forwarded to validateUpstreamUrl for SSRF protection.
   * In production leave unset (default: deny private/loopback).
   * In tests, supply { resolveHost: async () => [] } to skip real DNS.
   * Set allowPrivate/allowLoopback to opt-in to non-public upstreams.
   */
  ssrfOptions?: import("./lib/url-safety.ts").UrlSafetyOptions;
  /**
   * Audit loggers to flush when close() is called.
   * Pass any AuditLogger instances used in the pipeline so that
   * close() guarantees all buffered writes land on disk before shutdown.
   */
  auditLoggers?: ReadonlyArray<{ flush: () => Promise<void> }>;
}
