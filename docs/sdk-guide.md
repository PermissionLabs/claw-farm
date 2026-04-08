# SDK Integration Guide

This guide is for developers integrating claw-farm's security modules into their own TypeScript/Node.js server when `proxyMode: "none"` is set in `.claw-farm.json`. The SDK provides the same PII redaction, secret scanning, and audit logging as the Python api-proxy container, but as composable TypeScript modules.

**Audience:** Human developers and AI agents generating integration code.

---

## When to Use the SDK

Use the SDK when:

- You have your own TypeScript/Node.js/Bun server that handles HTTP routing
- You want the same security guarantees as the Python api-proxy without running a separate container
- Your `.claw-farm.json` has `"proxyMode": "none"`
- You manage container lifecycle yourself (e.g., via Dockerode, or your server is the container)

Do **not** use the SDK if your project uses `proxyMode: "per-instance"` or `proxyMode: "shared"` — the Python api-proxy container handles security in those modes.

---

## Install

**Bun:**
```bash
bun add @permissionlabs/claw-farm
```

**npm / pnpm / yarn:**
```bash
npm install @permissionlabs/claw-farm
```

**Git submodule (monorepo):**
```bash
git submodule add https://github.com/PermissionLabs/claw-farm vendor/claw-farm
```

### Import Paths

```typescript
// Full pipeline + all modules
import { createLlmProxy, gemini, piiRedactor, secretScanner, auditLogger } from "@permissionlabs/claw-farm/security";

// Pattern groups only
import { defaultPatterns, koreanPatterns, usPatterns } from "@permissionlabs/claw-farm/security/patterns";

// Provider factories only
import { gemini, anthropic, openRouter, openaiCompat } from "@permissionlabs/claw-farm/security/providers";
```

If importing from a local path (git submodule):
```typescript
import { createLlmProxy } from "./vendor/claw-farm/src/sdk/index.ts";
```

---

## Quick Start: Full Pipeline

The following wires the complete security pipeline into a Fastify route. All requests to `/llm/*` are PII-redacted, proxied to Gemini, and the response is secret-scanned and audit-logged.

```typescript
import Fastify from "fastify";
import {
  createLlmProxy,
  gemini,
  piiRedactor,
  secretScanner,
  auditLogger,
} from "@permissionlabs/claw-farm/security";

const app = Fastify({ logger: true });

const proxy = createLlmProxy({
  provider: gemini({ apiKey: process.env.GEMINI_API_KEY! }),
  pipeline: [
    piiRedactor({ mode: "redact" }),
    secretScanner(),
    auditLogger({ path: "/var/log/claw-farm/audit.jsonl" }),
  ],
});

app.all("/llm/*", async (req, reply) => {
  const result = await proxy.proxy({
    method: req.method,
    path: req.url.replace(/^\/llm\//, ""),
    queryString: new URL(req.url, "http://localhost").search.slice(1),
    headers: req.headers as Record<string, string>,
    body: Buffer.from(JSON.stringify(req.body ?? {})),
    sourceIp: req.ip,
  });

  reply.status(result.status);
  for (const [k, v] of Object.entries(result.headers)) {
    reply.header(k, v);
  }
  return reply.send(result.body);
});

app.listen({ port: 8080 });
```

**Express equivalent:**
```typescript
import express from "express";
import { createLlmProxy, gemini, piiRedactor, secretScanner } from "@permissionlabs/claw-farm/security";

const app = express();
app.use(express.raw({ type: "*/*", limit: "5mb" }));

const proxy = createLlmProxy({
  provider: gemini({ apiKey: process.env.GEMINI_API_KEY! }),
  pipeline: [piiRedactor({ mode: "redact" }), secretScanner()],
});

app.all("/llm/*", async (req, res) => {
  const result = await proxy.proxy({
    method: req.method,
    path: req.path.replace(/^\/llm\//, ""),
    queryString: req.url.split("?")[1] ?? "",
    headers: req.headers as Record<string, string>,
    body: Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {})),
    sourceIp: req.ip,
  });
  res.status(result.status).set(result.headers).send(result.body);
});
```

---

## Standalone Functions (No Pipeline)

Use standalone functions when you need a single security operation outside the full proxy pipeline.

### `redactPii(text, options?)`

```typescript
import { redactPii } from "@permissionlabs/claw-farm/security";

const { text, findings } = redactPii("Call me at 010-1234-5678 or email@example.com");
// text: "Call me at [REDACTED_KR_PHONE] or [REDACTED_EMAIL]"
// findings: [{ type: "KR_PHONE", count: 1 }, { type: "EMAIL", count: 1 }]
```

### `scanSecrets(text, options?)`

```typescript
import { scanSecrets } from "@permissionlabs/claw-farm/security";

const { text, findings } = scanSecrets("key=AIzaSyABC123def456ghi789jkl012mno345pqr");
// text: "key=[REDACTED_GOOGLE_API_KEY]"
// findings: [{ type: "GOOGLE_API_KEY", count: 1 }]
```

### `createAuditLogger(options)`

```typescript
import { createAuditLogger } from "@permissionlabs/claw-farm/security";

const logger = createAuditLogger({ path: "./audit.jsonl" });
logger.log({ event: "custom", userId: "u_123", action: "chat" });
// Appends: {"event":"custom","userId":"u_123","action":"chat","timestamp":"2026-04-08T..."}
```

**When to use standalone vs pipeline:**

| Scenario | Use |
|----------|-----|
| Scan one string in a webhook handler | `redactPii()` / `scanSecrets()` |
| Write a single event to audit log | `createAuditLogger().log()` |
| Full LLM proxying with composed security | `createLlmProxy()` with middleware |
| Need to check findings before forwarding | `redactRequestBody()` standalone |

---

## Middleware Deep Dive

### How the Pipeline Works

The pipeline uses a **Koa-style onion model**. Each middleware wraps all subsequent middleware plus the upstream fetch. Calling `next()` passes control inward; code after `next()` runs on the way back out.

```
Incoming request
       │
       ▼
┌─────────────────┐
│  piiRedactor    │  ← strips PII from request body before forwarding
│  ┌───────────┐  │
│  │ secretSc. │  │  ← scans response body after upstream returns
│  │ ┌───────┐ │  │
│  │ │audit  │ │  │  ← logs after response is finalized
│  │ │ ┌───┐ │ │  │
│  │ │ │ upstream fetch │
│  │ │ └───┘ │ │  │
│  │ └───────┘ │  │
│  └───────────┘  │
└─────────────────┘
       │
       ▼
Outgoing response
```

Built-in guards (path traversal prevention, path prefix validation, content size enforcement, header/query filtering, API key injection) are applied by the engine itself — they are not middleware and cannot be removed from the pipeline.

### Built-in Middleware

#### `piiRedactor(options?)`

Runs on the **request** path. Modifies `ctx.body` before forwarding to upstream.

```typescript
import { piiRedactor } from "@permissionlabs/claw-farm/security";
import { koreanPatterns, universalPatterns } from "@permissionlabs/claw-farm/security/patterns";

piiRedactor({
  mode: "redact",              // "redact" | "block" | "warn" — default: "redact"
  patterns: [...koreanPatterns.patterns],  // optional: override default pattern groups
  maxSizeMb: 5,               // reject bodies larger than this — default: 5
})
```

**Mode behavior:**

| Mode | Behavior |
|------|----------|
| `"redact"` | Replace PII with `[REDACTED_<name>]` tokens. Request proceeds. |
| `"block"` | Return HTTP 422 with `{ error: "Request blocked: PII detected", types: [...] }` |
| `"warn"` | Store findings in `ctx.state` ("piiFindings") but do not modify body. Request proceeds. |

#### `secretScanner(options?)`

Runs on the **response** path. Scans the response body returned by the LLM for leaked secrets and PII.

```typescript
import { secretScanner, defaultSecretPatterns } from "@permissionlabs/claw-farm/security";

secretScanner({
  patterns: defaultSecretPatterns,  // optional: provide custom SecretPatternGroup[]
})
```

Handles both JSON and non-JSON (SSE, plain text) responses. For JSON, walks all string values recursively. For non-JSON, applies raw text scanning.

#### `auditLogger(options)`

Runs on the **response** path. Writes one JSONL line per request. Fire-and-forget — never throws.

```typescript
import { auditLogger } from "@permissionlabs/claw-farm/security";

auditLogger({
  path: "/var/log/myapp/audit.jsonl",  // required: file path
  logger: console,                     // optional: { error: fn } for write failures
})
```

Each log line contains:
```json
{
  "event": "request",
  "method": "POST",
  "path": "v1beta/models/gemini-pro:generateContent",
  "source_ip": "127.0.0.1",
  "content_hash": "a1b2c3d4e5f6a7b8",
  "request_size": 512,
  "response_status": 200,
  "response_size": 1024,
  "elapsed_ms": 342,
  "pii_redacted": true,
  "timestamp": "2026-04-08T10:00:00.000Z"
}
```

### Writing Custom Middleware

The `RequestMiddleware` type signature:

```typescript
type RequestMiddleware = (
  ctx: ProxyContext,
  next: () => Promise<ProxyResponse>,
) => Promise<ProxyResponse>;
```

`ProxyContext` fields available to middleware:

```typescript
interface ProxyContext {
  method: string;                     // HTTP method ("POST", "GET", ...)
  path: string;                       // URL path without leading slash
  queryString: string;                // Raw query string (no "?")
  headers: Record<string, string>;    // Incoming request headers (mutable)
  body: Buffer;                       // Request body (mutable — set to modify)
  provider: LlmProvider;              // Active LLM provider config
  sourceIp?: string;                  // Client IP, if provided
  state: Map<string, unknown>;        // Cross-middleware state bag
}
```

**Example: request transformer (convert video URI to base64 for Gemini)**

```typescript
import type { RequestMiddleware } from "@permissionlabs/claw-farm/security";

const videoUriTransformer: RequestMiddleware = async (ctx, next) => {
  try {
    const data = JSON.parse(ctx.body.toString("utf-8"));
    // transform inline video URIs to Gemini fileData format
    if (Array.isArray(data.contents)) {
      data.contents = data.contents.map((part: unknown) => transformPart(part));
      ctx.body = Buffer.from(JSON.stringify(data), "utf-8");
    }
  } catch {
    // non-JSON body, skip
  }
  return next();
};
```

**Example: response logger**

```typescript
const responseLogger: RequestMiddleware = async (ctx, next) => {
  const response = await next();
  console.log(`[${ctx.method}] ${ctx.path} → ${response.status}`);
  return response;
};
```

**Example: rate limiter**

```typescript
const counts = new Map<string, number>();

const rateLimiter: RequestMiddleware = async (ctx, next) => {
  const key = ctx.sourceIp ?? "unknown";
  const current = (counts.get(key) ?? 0) + 1;
  counts.set(key, current);

  if (current > 100) {
    return {
      status: 429,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ error: "Rate limit exceeded" })),
    };
  }

  return next();
};
```

**Pipeline order matters.** Place middleware that short-circuits early (rate limiter, auth checks) first. Place middleware that needs the final response (audit logger) last before upstream. `secretScanner` should always be after the upstream call (it wraps `next()`), so place it near the end.

```typescript
pipeline: [
  rateLimiter,          // short-circuit fast
  piiRedactor(),        // modify request before forwarding
  secretScanner(),      // scan response after upstream
  auditLogger({ path: "..." }),  // log after everything is finalized
]
```

---

## PII Patterns

### Built-in Pattern Groups

All pattern groups are exported from `@permissionlabs/claw-farm/security/patterns`.

**`koreanPatterns`** — 8 patterns:

| Name | Matches | Replacement |
|------|---------|-------------|
| `KR_RRN` | Resident Registration Number: `######-[1-4]######` | `[REDACTED_KR_RRN]` |
| `KR_PHONE` | Mobile with hyphens: `01X-####-####` | `[REDACTED_KR_PHONE]` |
| `KR_PHONE_ALT` | Mobile with spaces/dots | `[REDACTED_KR_PHONE]` |
| `KR_PHONE_NOHYPHEN` | Mobile no separator: `01X########` | `[REDACTED_KR_PHONE]` |
| `KR_LANDLINE` | Landline: `0X-####-####` | `[REDACTED_KR_LANDLINE]` |
| `KR_BIZ_REG` | Business registration: `###-##-#####` | `[REDACTED_KR_BIZ_REG]` |
| `KR_PASSPORT` | Passport: one letter + 8 digits | `[REDACTED_KR_PASSPORT]` |
| `KR_DRIVER_LICENSE` | Driver license: `##-##-######-##` | `[REDACTED_KR_DRIVER_LICENSE]` |

**`usPatterns`** — 2 patterns:

| Name | Matches | Replacement |
|------|---------|-------------|
| `US_SSN` | SSN: `###-##-####` | `[REDACTED_US_SSN]` |
| `US_PHONE` | Phone: `###[-. ]###[-. ]####` | `[REDACTED_US_PHONE]` |

**`financialPatterns`** — 2 patterns:

| Name | Matches | Replacement |
|------|---------|-------------|
| `CREDIT_CARD` | Visa, MC, Amex, Discover (raw digits) | `[REDACTED_CREDIT_CARD]` |
| `CARD_FORMATTED` | Formatted card: `####-####-####-####` | `[REDACTED_CARD_FORMATTED]` |

**`universalPatterns`** — 1 pattern:

| Name | Matches | Replacement |
|------|---------|-------------|
| `EMAIL` | Standard email address | `[REDACTED_EMAIL]` |

**`defaultPatterns`** = `[koreanPatterns, usPatterns, financialPatterns, universalPatterns]`

### Adding Custom Patterns

The `PiiPatternGroup` interface:

```typescript
interface PiiPattern {
  name: string;        // identifier used in Finding.type and replacement token
  regex: RegExp;       // must have the /g flag
  replacement: string; // replacement string, conventionally [REDACTED_<NAME>]
}

interface PiiPatternGroup {
  name: string;           // group label (for logging/debugging)
  patterns: PiiPattern[]; // one or more patterns in this group
}
```

**Example: Japanese My Number**

```typescript
import { defaultPatterns } from "@permissionlabs/claw-farm/security/patterns";
import type { PiiPatternGroup } from "@permissionlabs/claw-farm/security";

const japanesePatterns: PiiPatternGroup = {
  name: "japanese",
  patterns: [
    {
      name: "MY_NUMBER",
      regex: /\d{4}\s\d{4}\s\d{4}/g,
      replacement: "[REDACTED_MY_NUMBER]",
    },
    {
      name: "JP_PHONE",
      regex: /0\d{1,4}-\d{1,4}-\d{4}/g,
      replacement: "[REDACTED_JP_PHONE]",
    },
  ],
};

// Use with standalone function
const { text } = redactPii(input, { patterns: [...defaultPatterns, japanesePatterns] });

// Use with middleware
piiRedactor({ patterns: [...defaultPatterns, japanesePatterns] })
```

**Example: domain-specific employee ID**

```typescript
const internalPatterns: PiiPatternGroup = {
  name: "internal",
  patterns: [
    {
      name: "EMPLOYEE_ID",
      regex: /\bEMP-[A-Z]{2}\d{6}\b/g,
      replacement: "[REDACTED_EMPLOYEE_ID]",
    },
  ],
};
```

---

## LLM Providers

### Built-in Providers

All providers return an `LlmProvider` object.

#### `gemini(options)`

```typescript
import { gemini } from "@permissionlabs/claw-farm/security/providers";

interface GeminiOptions {
  apiKey: string;
  baseUrl?: string;        // default: "https://generativelanguage.googleapis.com"
  disableThinking?: boolean; // sets thinkingBudget: 0 in generationConfig — default: false
}

const provider = gemini({ apiKey: process.env.GEMINI_API_KEY!, disableThinking: true });
```

Auth: `x-goog-api-key` header. Allowed path prefixes: `v1beta/`, `v1/`, `v1alpha/`, `v1beta1/`. Allowed query params: `alt`.

#### `anthropic(options)`

```typescript
import { anthropic } from "@permissionlabs/claw-farm/security/providers";

interface AnthropicOptions {
  apiKey: string;
  version?: string;  // default: "2023-06-01"
}

const provider = anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
```

Auth: `x-api-key` header. Injects `anthropic-version` header automatically. Allowed path prefix: `v1/`.

#### `openRouter(options)`

```typescript
import { openRouter } from "@permissionlabs/claw-farm/security/providers";

interface OpenRouterOptions {
  apiKey: string;
  referer?: string;  // sets HTTP-Referer header
  title?: string;    // sets X-Title header
}

const provider = openRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
  referer: "https://myapp.example.com",
  title: "My App",
});
```

Auth: `Authorization: Bearer <key>`. Base URL: `https://openrouter.ai/api`. Allowed path prefix: `v1/`.

#### `openaiCompat(options)`

```typescript
import { openaiCompat } from "@permissionlabs/claw-farm/security/providers";

interface OpenAICompatOptions {
  apiKey: string;
  baseUrl?: string;  // default: "https://api.openai.com"
}

const provider = openaiCompat({
  apiKey: process.env.OPENAI_API_KEY!,
  baseUrl: "https://api.openai.com",  // or any OpenAI-compatible endpoint
});
```

Auth: `Authorization: Bearer <key>`. Trailing slashes stripped from `baseUrl`. Allowed path prefix: `v1/`.

### Creating Custom Providers

The full `LlmProvider` interface:

```typescript
interface LlmProvider {
  name: string;                          // identifier for logging
  baseUrl: string;                       // upstream base URL, no trailing slash
  authHeader: string;                    // header name for API key injection
  authValue: string;                     // full header value ("Bearer sk-..." or raw key)
  pathPrefixes: string[];                // allowed path prefixes — requests not matching any are rejected 403
  queryAllowlist: Set<string>;           // allowed query param names — others are stripped
  extraHeaders?: Record<string, string>; // additional headers injected on every upstream request
  transformRequest?: (body: Record<string, unknown>) => Record<string, unknown>;   // optional body transform before forwarding
  transformResponse?: (body: Record<string, unknown>) => Record<string, unknown>;  // optional body transform after receiving
}
```

**Example: Groq**

```typescript
import type { LlmProvider } from "@permissionlabs/claw-farm/security";

function groq(apiKey: string): LlmProvider {
  return {
    name: "groq",
    baseUrl: "https://api.groq.com/openai",
    authHeader: "authorization",
    authValue: `Bearer ${apiKey}`,
    pathPrefixes: ["v1/"],
    queryAllowlist: new Set(),
  };
}

const proxy = createLlmProxy({
  provider: groq(process.env.GROQ_API_KEY!),
  pipeline: [piiRedactor(), secretScanner()],
});
```

**Example: local Ollama**

```typescript
function ollama(baseUrl = "http://localhost:11434"): LlmProvider {
  return {
    name: "ollama",
    baseUrl,
    authHeader: "authorization",
    authValue: "Bearer ollama",  // Ollama ignores auth but header is required by the engine
    pathPrefixes: ["api/", "v1/"],
    queryAllowlist: new Set(),
  };
}
```

**`transformRequest` / `transformResponse` hooks** run inside the engine on the final body after middleware. Use them for provider-specific reshaping that does not belong in middleware (e.g., Gemini's `thinkingConfig` injection, response field normalization).

---

## API Reference

### Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `createLlmProxy` | `(options: LlmProxyOptions) => { proxy, close }` | Create pipeline proxy |
| `redactPii` | `(text: string, options?: RedactPiiOptions) => RedactResult` | Scan + redact PII in string |
| `redactRequestBody` | `(body: Buffer, options?: RedactPiiOptions) => RedactBodyResult` | Redact PII in JSON Buffer |
| `piiRedactor` | `(options?: PiiRedactorOptions) => RequestMiddleware` | PII middleware factory |
| `scanSecrets` | `(text: string, options?: ScanSecretsOptions) => RedactResult` | Scan + redact secrets in string |
| `scanResponseBody` | `(body: Buffer, options?: ScanSecretsOptions) => RedactBodyResult` | Scan secrets in JSON/text Buffer |
| `secretScanner` | `(options?: SecretScannerOptions) => RequestMiddleware` | Secret scanner middleware factory |
| `createAuditLogger` | `(options: AuditLoggerOptions) => AuditLogger` | Create standalone JSONL logger |
| `auditLogger` | `(options: AuditLoggerOptions) => RequestMiddleware` | Audit logger middleware factory |
| `gemini` | `(opts: GeminiOptions) => LlmProvider` | Gemini provider factory |
| `anthropic` | `(opts: AnthropicOptions) => LlmProvider` | Anthropic provider factory |
| `openRouter` | `(opts: OpenRouterOptions) => LlmProvider` | OpenRouter provider factory |
| `openaiCompat` | `(opts: OpenAICompatOptions) => LlmProvider` | OpenAI-compatible provider factory |

### Types

```typescript
// Result types
interface Finding { type: string; count: number; }
interface RedactResult { text: string; findings: Finding[]; }
interface RedactBodyResult { body: Buffer; findings: Finding[]; }

// PII
type PiiMode = "redact" | "block" | "warn";
interface PiiPattern { name: string; regex: RegExp; replacement: string; }
interface PiiPatternGroup { name: string; patterns: PiiPattern[]; }

// Secrets
interface SecretPattern { name: string; regex: RegExp; replacement: string; }
interface SecretPatternGroup { name: string; patterns: SecretPattern[]; }

// Pipeline
interface LlmProvider {
  name: string; baseUrl: string; authHeader: string; authValue: string;
  pathPrefixes: string[]; queryAllowlist: Set<string>;
  extraHeaders?: Record<string, string>;
  transformRequest?: (body: Record<string, unknown>) => Record<string, unknown>;
  transformResponse?: (body: Record<string, unknown>) => Record<string, unknown>;
}
interface ProxyContext {
  method: string; path: string; queryString: string;
  headers: Record<string, string>; body: Buffer;
  provider: LlmProvider; sourceIp?: string;
  state: Map<string, unknown>;
}
interface ProxyResponse { status: number; headers: Record<string, string>; body: Buffer; }
interface ProxyRequest {
  method: string; path: string; queryString: string;
  headers: Record<string, string>; body: Buffer; sourceIp?: string;
}
type RequestMiddleware = (ctx: ProxyContext, next: () => Promise<ProxyResponse>) => Promise<ProxyResponse>;
interface LlmProxyOptions {
  provider: LlmProvider;
  pipeline?: RequestMiddleware[];
  logger?: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; };
  timeout?: number;       // ms — default: 120000
  maxSizeMb?: number;     // default: 5
  forwardHeaders?: Set<string>;  // headers to forward upstream — default: content-type, accept, accept-encoding, user-agent
}
interface AuditLogger { log: (entry: Record<string, unknown>) => void; }
```

### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `defaultPatterns` | `PiiPatternGroup[]` | Korean + US + financial + universal PII patterns |
| `koreanPatterns` | `PiiPatternGroup` | 8 Korean PII patterns |
| `usPatterns` | `PiiPatternGroup` | 2 US PII patterns |
| `financialPatterns` | `PiiPatternGroup` | 2 credit card patterns |
| `universalPatterns` | `PiiPatternGroup` | 1 email pattern |
| `defaultSecretPatterns` | `SecretPatternGroup[]` | api-keys + cloud + payment + tokens groups |

---

## Migration from Self-Implemented

If your server already has ad-hoc PII filtering, secret scanning, or an LLM proxy, follow these steps.

**Step 1 — Identify your existing code**

Look for files that:
- Apply regex replacements on request/response strings
- Inject an API key into outbound fetch calls
- Write request/response logs to a file or stdout

**Step 2 — Replace with SDK imports**

```typescript
// Before (ad-hoc)
function redactSsn(text: string) {
  return text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[SSN]");
}

// After
import { redactPii } from "@permissionlabs/claw-farm/security";
const { text } = redactPii(input);
```

```typescript
// Before (manual proxy)
async function proxyToGemini(body: Buffer) {
  return fetch("https://generativelanguage.googleapis.com/...", {
    headers: { "x-goog-api-key": process.env.GEMINI_KEY! },
    body,
  });
}

// After
const proxy = createLlmProxy({ provider: gemini({ apiKey: process.env.GEMINI_KEY! }) });
const result = await proxy.proxy({ method: "POST", path: "v1beta/models/...", ... });
```

**Step 3 — Wire custom logic as middleware**

If you have business-specific transformations (rate limiting, user-based routing, extra headers), keep them as `RequestMiddleware` functions in the pipeline rather than ad-hoc code around `fetch`.

```typescript
const pipeline = [
  myRateLimiter,                          // your existing logic, wrapped
  piiRedactor({ mode: "redact" }),
  secretScanner(),
  auditLogger({ path: "./audit.jsonl" }),
];
```

**Step 4 — Delete old files**

Remove your previous proxy module, redaction utilities, and manual audit writer. The SDK replaces all three.

**Step 5 — Test checklist**

- [ ] Send a request containing a Korean phone number — verify `[REDACTED_KR_PHONE]` appears in the upstream payload, not the original number
- [ ] Send a request containing `AIzaSy...` — verify it is blocked from reaching upstream
- [ ] Trigger a response from the LLM that contains a hardcoded API key — verify it is stripped from the response body
- [ ] Check `audit.jsonl` after a request — verify a line with `"event":"request"` and correct fields is written
- [ ] Send a request to a path not in `pathPrefixes` — verify HTTP 403
- [ ] Send a body over `maxSizeMb` — verify HTTP 413
