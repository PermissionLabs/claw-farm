// LLM Proxy pipeline engine — Koa-style onion middleware model

import { createHash } from "node:crypto";
import { validateUpstreamUrl } from "./lib/url-safety.ts";
import { piiRedactor } from "./pii-redactor.ts";
import { secretScanner } from "./secret-scanner.ts";
import type {
  LlmProxyOptions,
  ProxyContext,
  ProxyRequest,
  ProxyResponse,
  RequestMiddleware,
} from "./types.ts";
import { STATE_KEYS } from "./utils.ts";

const DEFAULT_FORWARD_HEADERS = new Set([
  "content-type",
  "accept",
  "accept-encoding",
  "user-agent",
]);

const DEFAULT_TIMEOUT = 120_000;
const DEFAULT_MAX_SIZE_MB = 5;

const noopLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
};

/**
 * Create an LLM proxy with a composable middleware pipeline.
 *
 * Built-in security guards (path traversal, prefix validation, header/query filtering)
 * are applied by the engine itself — they are not middleware, so they cannot be skipped.
 *
 * Default pipeline (when none specified): [piiRedactor(), secretScanner()]
 */
export function createLlmProxy(options: LlmProxyOptions) {
  const {
    provider,
    logger = noopLogger,
    timeout = DEFAULT_TIMEOUT,
    maxSizeMb = DEFAULT_MAX_SIZE_MB,
    forwardHeaders = DEFAULT_FORWARD_HEADERS,
    ssrfOptions,
    auditLoggers = [],
  } = options;

  const pipeline: RequestMiddleware[] =
    options.pipeline ?? [piiRedactor(), secretScanner()];

  async function proxy(request: ProxyRequest): Promise<ProxyResponse> {
    const { method, queryString, headers: incomingHeaders, body: rawBody } = request;
    // Prevent double-slash in upstream URL and prefix mismatch
    const path = request.path.replace(/^\/+/, "");

    // --- Built-in guard: path traversal + prefix validation ---
    if (
      path.includes("..") ||
      !provider.pathPrefixes.some((p) => path.startsWith(p))
    ) {
      return {
        status: 403,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ error: "Path not allowed" })),
      };
    }

    // --- Built-in guard: content size ---
    if (rawBody.length > maxSizeMb * 1024 * 1024) {
      return {
        status: 413,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ error: "Request too large" })),
      };
    }

    // --- Build context ---
    const ctx: ProxyContext = {
      method,
      path,
      queryString,
      headers: { ...incomingHeaders },
      body: rawBody,
      provider,
      sourceIp: request.sourceIp,
      state: new Map(),
    };

    const contentHash =
      rawBody.length > 0
        ? createHash("sha256").update(rawBody).digest("hex").slice(0, 16)
        : "empty";
    ctx.state.set(STATE_KEYS.CONTENT_HASH, contentHash);

    // --- Upstream fetch function (innermost layer of the onion) ---
    async function upstreamFetch(): Promise<ProxyResponse> {
      // Apply provider transformRequest if defined
      let body = ctx.body;
      if (provider.transformRequest) {
        try {
          const data = JSON.parse(body.toString("utf-8")) as Record<string, unknown>;
          const transformed = provider.transformRequest(data);
          body = Buffer.from(JSON.stringify(transformed), "utf-8");
        } catch (err) {
          if (!(err instanceof SyntaxError)) throw err;
          // Non-JSON body, skip transform
        }
      }

      // Build upstream URL
      let upstreamUrl = `${provider.baseUrl}/${path}`;

      if (queryString && provider.queryAllowlist.size > 0) {
        const params = new URLSearchParams(queryString);
        const filtered: string[] = [];
        for (const [k, v] of params) {
          if (provider.queryAllowlist.has(k)) {
            filtered.push(
              `${encodeURIComponent(k)}=${encodeURIComponent(v)}`,
            );
          }
        }
        if (filtered.length > 0) {
          upstreamUrl += `?${filtered.join("&")}`;
        }
      }

      // Forward only safe headers; strip x-forwarded-* variants to prevent
      // header smuggling where an internal header could influence upstream routing.
      const fetchHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(ctx.headers)) {
        const lower = k.toLowerCase();
        if (lower.startsWith("x-forwarded-")) continue;
        if (forwardHeaders.has(lower)) {
          fetchHeaders[k] = v;
        }
      }

      // Inject API key
      if (provider.authValue) {
        fetchHeaders[provider.authHeader] = provider.authValue;
      }

      // Inject extra headers
      if (provider.extraHeaders) {
        for (const [k, v] of Object.entries(provider.extraHeaders)) {
          fetchHeaders[k] = v;
        }
      }

      // SSRF guard: validate the upstream URL immediately before fetching.
      // This catches any runtime-mutated provider.baseUrl that was not
      // validated at provider-factory time (e.g. set after construction).
      try {
        await validateUpstreamUrl(upstreamUrl, ssrfOptions);
      } catch (err) {
        logger.error("SSRF validation rejected upstream URL", err);
        return {
          status: 403,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({ error: "Upstream URL rejected by SSRF policy" }),
          ),
        };
      }

      // Fetch upstream
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      let response: Response;
      try {
        response = await fetch(upstreamUrl, {
          method,
          headers: fetchHeaders,
          body:
            method !== "GET" && method !== "HEAD"
              ? new Uint8Array(body)
              : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        logger.error("Upstream fetch failed", err);
        return {
          status: 502,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({ error: "Upstream request failed" }),
          ),
        };
      }

      clearTimeout(timer);

      // Apply provider transformResponse if defined
      let responseBody = Buffer.from(
        new Uint8Array(await response.arrayBuffer()),
      );
      if (provider.transformResponse) {
        try {
          const data = JSON.parse(responseBody.toString("utf-8")) as Record<string, unknown>;
          const transformed = provider.transformResponse(data);
          responseBody = Buffer.from(JSON.stringify(transformed), "utf-8");
        } catch (err) {
          if (!(err instanceof SyntaxError)) throw err;
          // Non-JSON response, skip transform
        }
      }

      // Forward response headers (skip hop-by-hop and sensitive disclosure headers)
      const skipHeaders = new Set([
        "transfer-encoding",
        "content-encoding",
        "content-length",
        "set-cookie",
        "set-cookie2",
        "server",
        "x-powered-by",
        "strict-transport-security",
      ]);
      const respHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        if (!skipHeaders.has(k.toLowerCase())) {
          respHeaders[k] = v;
        }
      });

      return {
        status: response.status,
        headers: respHeaders,
        body: responseBody,
      };
    }

    // --- Compose middleware chain (onion model) ---
    let index = 0;
    function dispatch(): Promise<ProxyResponse> {
      const mw = pipeline[index++];
      if (mw !== undefined) {
        return mw(ctx, dispatch);
      }
      return upstreamFetch();
    }

    return dispatch();
  }

  async function close(): Promise<void> {
    // Flush all registered audit loggers before shutdown
    if (auditLoggers.length > 0) {
      await Promise.all(auditLoggers.map((al) => al.flush()));
    }
  }

  return { proxy, close };
}
