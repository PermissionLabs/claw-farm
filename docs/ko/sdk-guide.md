> English version: [sdk-guide.md](../sdk-guide.md)

# SDK 통합 가이드

이 가이드는 `.claw-farm.json`에 `proxyMode: "none"`이 설정된 경우, claw-farm의 보안 모듈을 자체 TypeScript/Node.js 서버에 통합하려는 개발자를 위한 문서입니다. SDK는 Python api-proxy 컨테이너와 동일한 PII 제거, 시크릿 스캐닝, 감사 로깅 기능을 조합 가능한 TypeScript 모듈 형태로 제공합니다.

**대상:** 통합 코드를 작성하는 개발자 및 AI 에이전트.

---

## SDK를 사용해야 할 때

다음 경우에 SDK를 사용하세요:

- HTTP 라우팅을 직접 처리하는 TypeScript/Node.js/Bun 서버가 있는 경우
- 별도의 컨테이너 없이 Python api-proxy와 동일한 보안 보장을 원하는 경우
- `.claw-farm.json`에 `"proxyMode": "none"`이 설정된 경우
- 컨테이너 생명주기를 직접 관리하는 경우 (예: Dockerode 사용, 또는 서버 자체가 컨테이너인 경우)

프로젝트가 `proxyMode: "per-instance"` 또는 `proxyMode: "shared"`를 사용하는 경우에는 SDK를 사용하지 **마세요** — 해당 모드에서는 Python api-proxy 컨테이너가 보안을 처리합니다.

---

## 설치

**Bun:**
```bash
bun add @permissionlabs/claw-farm
```

**npm / pnpm / yarn:**
```bash
npm install @permissionlabs/claw-farm
```

**Git 서브모듈 (모노레포):**
```bash
git submodule add https://github.com/PermissionLabs/claw-farm vendor/claw-farm
```

### 임포트 경로

```typescript
// 전체 파이프라인 + 모든 모듈
import { createLlmProxy, gemini, piiRedactor, secretScanner, auditLogger } from "@permissionlabs/claw-farm/security";

// 패턴 그룹만
import { defaultPatterns, koreanPatterns, usPatterns } from "@permissionlabs/claw-farm/security/patterns";

// 프로바이더 팩토리만
import { gemini, anthropic, openRouter, openaiCompat } from "@permissionlabs/claw-farm/security/providers";
```

로컬 경로(git 서브모듈)에서 임포트하는 경우:
```typescript
import { createLlmProxy } from "./vendor/claw-farm/src/sdk/index.ts";
```

---

## 빠른 시작: 전체 파이프라인

아래 예시는 Fastify 라우트에 전체 보안 파이프라인을 연결합니다. `/llm/*`로 오는 모든 요청은 PII가 제거되고, Gemini로 프록시되며, 응답은 시크릿 스캔 후 감사 로그에 기록됩니다.

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

**Express 동등 코드:**
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

## 독립 실행 함수 (파이프라인 없이)

전체 프록시 파이프라인 없이 단일 보안 작업이 필요한 경우 독립 실행 함수를 사용하세요.

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
// 추가됨: {"event":"custom","userId":"u_123","action":"chat","timestamp":"2026-04-08T..."}
```

**독립 실행 vs 파이프라인 사용 기준:**

| 시나리오 | 사용 방법 |
|----------|-----------|
| 웹훅 핸들러에서 문자열 하나 스캔 | `redactPii()` / `scanSecrets()` |
| 감사 로그에 단일 이벤트 기록 | `createAuditLogger().log()` |
| 보안이 적용된 전체 LLM 프록시 | `createLlmProxy()`와 미들웨어 조합 |
| 전달 전 findings 확인 필요 | `redactRequestBody()` 독립 실행 |

---

## 미들웨어 상세 가이드

### 파이프라인 동작 방식

파이프라인은 **Koa 스타일의 양파 모델**을 사용합니다. 각 미들웨어는 이후의 모든 미들웨어와 업스트림 fetch를 감쌉니다. `next()`를 호출하면 안쪽으로 제어가 넘어가고, `next()` 이후 코드는 돌아오는 길에 실행됩니다.

```
인입 요청
       │
       ▼
┌─────────────────┐
│  piiRedactor    │  ← 전달 전 요청 본문에서 PII 제거
│  ┌───────────┐  │
│  │ secretSc. │  │  ← 업스트림 응답 후 응답 본문 스캔
│  │ ┌───────┐ │  │
│  │ │audit  │ │  │  ← 응답 확정 후 로깅
│  │ │ ┌───┐ │ │  │
│  │ │ │ upstream fetch │
│  │ │ └───┘ │ │  │
│  │ └───────┘ │  │
│  └───────────┘  │
└─────────────────┘
       │
       ▼
송출 응답
```

내장 가드(경로 탐색 방지, 경로 접두사 검증, 콘텐츠 크기 제한, 헤더/쿼리 필터링, API 키 주입)는 엔진 자체에서 적용되며 — 미들웨어가 아니므로 파이프라인에서 제거할 수 없습니다.

### 내장 미들웨어

#### `piiRedactor(options?)`

**요청** 경로에서 실행됩니다. 업스트림으로 전달하기 전에 `ctx.body`를 수정합니다.

```typescript
import { piiRedactor } from "@permissionlabs/claw-farm/security";
import { koreanPatterns, universalPatterns } from "@permissionlabs/claw-farm/security/patterns";

piiRedactor({
  mode: "redact",              // "redact" | "block" | "warn" — 기본값: "redact"
  patterns: [...koreanPatterns.patterns],  // 선택사항: 기본 패턴 그룹 재정의
  maxSizeMb: 5,               // 이보다 큰 본문 거부 — 기본값: 5
})
```

**모드 동작:**

| 모드 | 동작 |
|------|------|
| `"redact"` | PII를 `[REDACTED_<name>]` 토큰으로 대체. 요청 진행. |
| `"block"` | `{ error: "Request blocked: PII detected", types: [...] }`와 함께 HTTP 422 반환 |
| `"warn"` | findings를 `ctx.state`("piiFindings")에 저장하지만 본문은 수정하지 않음. 요청 진행. |

#### `secretScanner(options?)`

**응답** 경로에서 실행됩니다. LLM이 반환한 응답 본문에서 유출된 시크릿과 PII를 스캔합니다.

```typescript
import { secretScanner, defaultSecretPatterns } from "@permissionlabs/claw-farm/security";

secretScanner({
  patterns: defaultSecretPatterns,  // 선택사항: 커스텀 SecretPatternGroup[] 제공
})
```

JSON과 비JSON(SSE, 일반 텍스트) 응답을 모두 처리합니다. JSON의 경우 모든 문자열 값을 재귀적으로 검사합니다. 비JSON의 경우 원시 텍스트 스캔을 적용합니다.

#### `auditLogger(options)`

**응답** 경로에서 실행됩니다. 요청당 JSONL 한 줄을 씁니다. Fire-and-forget — 절대 throw하지 않습니다.

```typescript
import { auditLogger } from "@permissionlabs/claw-farm/security";

auditLogger({
  path: "/var/log/myapp/audit.jsonl",  // 필수: 파일 경로
  logger: console,                     // 선택사항: 쓰기 실패 시 { error: fn }
})
```

각 로그 라인의 내용:
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

### 커스텀 미들웨어 작성

`RequestMiddleware` 타입 시그니처:

```typescript
type RequestMiddleware = (
  ctx: ProxyContext,
  next: () => Promise<ProxyResponse>,
) => Promise<ProxyResponse>;
```

미들웨어에서 사용할 수 있는 `ProxyContext` 필드:

```typescript
interface ProxyContext {
  method: string;                     // HTTP 메서드 ("POST", "GET", ...)
  path: string;                       // 앞의 슬래시 없는 URL 경로
  queryString: string;                // 원시 쿼리 문자열 ("?" 없음)
  headers: Record<string, string>;    // 인입 요청 헤더 (가변)
  body: Buffer;                       // 요청 본문 (가변 — 수정하려면 set)
  provider: LlmProvider;              // 활성 LLM 프로바이더 설정
  sourceIp?: string;                  // 클라이언트 IP (제공된 경우)
  state: Map<string, unknown>;        // 미들웨어 간 상태 공유 저장소
}
```

**예시: 요청 변환기 (Gemini용 비디오 URI를 base64로 변환)**

```typescript
import type { RequestMiddleware } from "@permissionlabs/claw-farm/security";

const videoUriTransformer: RequestMiddleware = async (ctx, next) => {
  try {
    const data = JSON.parse(ctx.body.toString("utf-8"));
    // 인라인 비디오 URI를 Gemini fileData 형식으로 변환
    if (Array.isArray(data.contents)) {
      data.contents = data.contents.map((part: unknown) => transformPart(part));
      ctx.body = Buffer.from(JSON.stringify(data), "utf-8");
    }
  } catch {
    // 비JSON 본문, 건너뜀
  }
  return next();
};
```

**예시: 응답 로거**

```typescript
const responseLogger: RequestMiddleware = async (ctx, next) => {
  const response = await next();
  console.log(`[${ctx.method}] ${ctx.path} → ${response.status}`);
  return response;
};
```

**예시: 속도 제한기**

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

**파이프라인 순서가 중요합니다.** 조기 단락(속도 제한기, 인증 검사)하는 미들웨어를 먼저 배치하세요. 최종 응답이 필요한 미들웨어(감사 로거)는 업스트림 직전 마지막에 배치하세요. `secretScanner`는 항상 업스트림 호출 이후에 실행되어야 하므로(`next()`를 감쌈), 끝 가까이에 배치하세요.

```typescript
pipeline: [
  rateLimiter,          // 빠르게 단락
  piiRedactor(),        // 전달 전 요청 수정
  secretScanner(),      // 업스트림 후 응답 스캔
  auditLogger({ path: "..." }),  // 모든 것이 확정된 후 로깅
]
```

---

## PII 패턴

### 내장 패턴 그룹

모든 패턴 그룹은 `@permissionlabs/claw-farm/security/patterns`에서 내보내집니다.

**`koreanPatterns`** — 8개 패턴:

| 이름 | 매칭 대상 | 대체 값 |
|------|-----------|---------|
| `KR_RRN` | 주민등록번호: `######-[1-4]######` | `[REDACTED_KR_RRN]` |
| `KR_PHONE` | 하이픈 포함 휴대폰: `01X-####-####` | `[REDACTED_KR_PHONE]` |
| `KR_PHONE_ALT` | 공백/점 구분 휴대폰 | `[REDACTED_KR_PHONE]` |
| `KR_PHONE_NOHYPHEN` | 구분자 없는 휴대폰: `01X########` | `[REDACTED_KR_PHONE]` |
| `KR_LANDLINE` | 유선전화: `0X-####-####` | `[REDACTED_KR_LANDLINE]` |
| `KR_BIZ_REG` | 사업자등록번호: `###-##-#####` | `[REDACTED_KR_BIZ_REG]` |
| `KR_PASSPORT` | 여권번호: 영문자 1자 + 숫자 8자리 | `[REDACTED_KR_PASSPORT]` |
| `KR_DRIVER_LICENSE` | 운전면허번호: `##-##-######-##` | `[REDACTED_KR_DRIVER_LICENSE]` |

**`usPatterns`** — 2개 패턴:

| 이름 | 매칭 대상 | 대체 값 |
|------|-----------|---------|
| `US_SSN` | SSN: `###-##-####` | `[REDACTED_US_SSN]` |
| `US_PHONE` | 전화번호: `###[-. ]###[-. ]####` | `[REDACTED_US_PHONE]` |

**`financialPatterns`** — 2개 패턴:

| 이름 | 매칭 대상 | 대체 값 |
|------|-----------|---------|
| `CREDIT_CARD` | Visa, MC, Amex, Discover (원시 숫자) | `[REDACTED_CREDIT_CARD]` |
| `CARD_FORMATTED` | 포맷된 카드번호: `####-####-####-####` | `[REDACTED_CARD_FORMATTED]` |

**`universalPatterns`** — 1개 패턴:

| 이름 | 매칭 대상 | 대체 값 |
|------|-----------|---------|
| `EMAIL` | 표준 이메일 주소 | `[REDACTED_EMAIL]` |

**`defaultPatterns`** = `[koreanPatterns, usPatterns, financialPatterns, universalPatterns]`

### 커스텀 패턴 추가

`PiiPatternGroup` 인터페이스:

```typescript
interface PiiPattern {
  name: string;        // Finding.type 및 대체 토큰에 사용되는 식별자
  regex: RegExp;       // /g 플래그 필수
  replacement: string; // 대체 문자열, 관례상 [REDACTED_<NAME>]
}

interface PiiPatternGroup {
  name: string;           // 그룹 레이블 (로깅/디버깅용)
  patterns: PiiPattern[]; // 이 그룹의 하나 이상의 패턴
}
```

**예시: 일본 마이넘버**

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

// 독립 실행 함수와 함께 사용
const { text } = redactPii(input, { patterns: [...defaultPatterns, japanesePatterns] });

// 미들웨어와 함께 사용
piiRedactor({ patterns: [...defaultPatterns, japanesePatterns] })
```

**예시: 도메인 특화 사원 ID**

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

## LLM 프로바이더

### 내장 프로바이더

모든 프로바이더는 `LlmProvider` 객체를 반환합니다.

#### `gemini(options)`

```typescript
import { gemini } from "@permissionlabs/claw-farm/security/providers";

interface GeminiOptions {
  apiKey: string;
  baseUrl?: string;        // 기본값: "https://generativelanguage.googleapis.com"
  disableThinking?: boolean; // generationConfig에 thinkingBudget: 0 설정 — 기본값: false
}

const provider = gemini({ apiKey: process.env.GEMINI_API_KEY!, disableThinking: true });
```

인증: `x-goog-api-key` 헤더. 허용 경로 접두사: `v1beta/`, `v1/`, `v1alpha/`, `v1beta1/`. 허용 쿼리 파라미터: `alt`.

#### `anthropic(options)`

```typescript
import { anthropic } from "@permissionlabs/claw-farm/security/providers";

interface AnthropicOptions {
  apiKey: string;
  version?: string;  // 기본값: "2023-06-01"
}

const provider = anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
```

인증: `x-api-key` 헤더. `anthropic-version` 헤더 자동 주입. 허용 경로 접두사: `v1/`.

#### `openRouter(options)`

```typescript
import { openRouter } from "@permissionlabs/claw-farm/security/providers";

interface OpenRouterOptions {
  apiKey: string;
  referer?: string;  // HTTP-Referer 헤더 설정
  title?: string;    // X-Title 헤더 설정
}

const provider = openRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
  referer: "https://myapp.example.com",
  title: "My App",
});
```

인증: `Authorization: Bearer <key>`. 기본 URL: `https://openrouter.ai/api`. 허용 경로 접두사: `v1/`.

#### `openaiCompat(options)`

```typescript
import { openaiCompat } from "@permissionlabs/claw-farm/security/providers";

interface OpenAICompatOptions {
  apiKey: string;
  baseUrl?: string;  // 기본값: "https://api.openai.com"
}

const provider = openaiCompat({
  apiKey: process.env.OPENAI_API_KEY!,
  baseUrl: "https://api.openai.com",  // 또는 OpenAI 호환 엔드포인트
});
```

인증: `Authorization: Bearer <key>`. `baseUrl`의 후행 슬래시 제거. 허용 경로 접두사: `v1/`.

### 커스텀 프로바이더 생성

전체 `LlmProvider` 인터페이스:

```typescript
interface LlmProvider {
  name: string;                          // 로깅용 식별자
  baseUrl: string;                       // 업스트림 기본 URL, 후행 슬래시 없음
  authHeader: string;                    // API 키 주입에 사용할 헤더 이름
  authValue: string;                     // 전체 헤더 값 ("Bearer sk-..." 또는 원시 키)
  pathPrefixes: string[];                // 허용 경로 접두사 — 매칭 안 되면 403 거부
  queryAllowlist: Set<string>;           // 허용 쿼리 파라미터 이름 — 나머지는 제거
  extraHeaders?: Record<string, string>; // 모든 업스트림 요청에 주입할 추가 헤더
  transformRequest?: (body: Record<string, unknown>) => Record<string, unknown>;   // 전달 전 선택적 본문 변환
  transformResponse?: (body: Record<string, unknown>) => Record<string, unknown>;  // 수신 후 선택적 본문 변환
}
```

**예시: Groq**

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

**예시: 로컬 Ollama**

```typescript
function ollama(baseUrl = "http://localhost:11434"): LlmProvider {
  return {
    name: "ollama",
    baseUrl,
    authHeader: "authorization",
    authValue: "Bearer ollama",  // Ollama는 인증을 무시하지만 엔진이 헤더를 요구함
    pathPrefixes: ["api/", "v1/"],
    queryAllowlist: new Set(),
  };
}
```

**`transformRequest` / `transformResponse` 훅**은 미들웨어 이후 최종 본문에 대해 엔진 내부에서 실행됩니다. 미들웨어에 속하지 않는 프로바이더 특화 재구성(예: Gemini의 `thinkingConfig` 주입, 응답 필드 정규화)에 사용하세요.

---

## API 레퍼런스

### 함수

| 함수 | 시그니처 | 설명 |
|------|----------|------|
| `createLlmProxy` | `(options: LlmProxyOptions) => { proxy, close }` | 파이프라인 프록시 생성 |
| `redactPii` | `(text: string, options?: RedactPiiOptions) => RedactResult` | 문자열에서 PII 스캔 및 제거 |
| `redactRequestBody` | `(body: Buffer, options?: RedactPiiOptions) => RedactBodyResult` | JSON Buffer에서 PII 제거 |
| `piiRedactor` | `(options?: PiiRedactorOptions) => RequestMiddleware` | PII 미들웨어 팩토리 |
| `scanSecrets` | `(text: string, options?: ScanSecretsOptions) => RedactResult` | 문자열에서 시크릿 스캔 및 제거 |
| `scanResponseBody` | `(body: Buffer, options?: ScanSecretsOptions) => RedactBodyResult` | JSON/텍스트 Buffer에서 시크릿 스캔 |
| `secretScanner` | `(options?: SecretScannerOptions) => RequestMiddleware` | 시크릿 스캐너 미들웨어 팩토리 |
| `createAuditLogger` | `(options: AuditLoggerOptions) => AuditLogger` | 독립 실행 JSONL 로거 생성 |
| `auditLogger` | `(options: AuditLoggerOptions) => RequestMiddleware` | 감사 로거 미들웨어 팩토리 |
| `gemini` | `(opts: GeminiOptions) => LlmProvider` | Gemini 프로바이더 팩토리 |
| `anthropic` | `(opts: AnthropicOptions) => LlmProvider` | Anthropic 프로바이더 팩토리 |
| `openRouter` | `(opts: OpenRouterOptions) => LlmProvider` | OpenRouter 프로바이더 팩토리 |
| `openaiCompat` | `(opts: OpenAICompatOptions) => LlmProvider` | OpenAI 호환 프로바이더 팩토리 |

### 타입

```typescript
// 결과 타입
interface Finding { type: string; count: number; }
interface RedactResult { text: string; findings: Finding[]; }
interface RedactBodyResult { body: Buffer; findings: Finding[]; }

// PII
type PiiMode = "redact" | "block" | "warn";
interface PiiPattern { name: string; regex: RegExp; replacement: string; }
interface PiiPatternGroup { name: string; patterns: PiiPattern[]; }

// 시크릿
interface SecretPattern { name: string; regex: RegExp; replacement: string; }
interface SecretPatternGroup { name: string; patterns: SecretPattern[]; }

// 파이프라인
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
  timeout?: number;       // ms — 기본값: 120000
  maxSizeMb?: number;     // 기본값: 5
  forwardHeaders?: Set<string>;  // 업스트림으로 전달할 헤더 — 기본값: content-type, accept, accept-encoding, user-agent
}
interface AuditLogger { log: (entry: Record<string, unknown>) => void; }
```

### 상수

| 상수 | 값 | 설명 |
|------|----|------|
| `defaultPatterns` | `PiiPatternGroup[]` | 한국 + 미국 + 금융 + 범용 PII 패턴 |
| `koreanPatterns` | `PiiPatternGroup` | 한국 PII 패턴 8개 |
| `usPatterns` | `PiiPatternGroup` | 미국 PII 패턴 2개 |
| `financialPatterns` | `PiiPatternGroup` | 신용카드 패턴 2개 |
| `universalPatterns` | `PiiPatternGroup` | 이메일 패턴 1개 |
| `defaultSecretPatterns` | `SecretPatternGroup[]` | api-keys + cloud + payment + tokens 그룹 |

---

## 기존 구현에서 마이그레이션

서버에 이미 임시 PII 필터링, 시크릿 스캐닝, 또는 LLM 프록시가 있는 경우 아래 단계를 따르세요.

**1단계 — 기존 코드 파악**

다음을 수행하는 파일을 찾으세요:
- 요청/응답 문자열에 정규식 대체 적용
- 아웃바운드 fetch 호출에 API 키 주입
- 파일 또는 stdout에 요청/응답 로그 작성

**2단계 — SDK 임포트로 교체**

```typescript
// 이전 (임시)
function redactSsn(text: string) {
  return text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[SSN]");
}

// 이후
import { redactPii } from "@permissionlabs/claw-farm/security";
const { text } = redactPii(input);
```

```typescript
// 이전 (수동 프록시)
async function proxyToGemini(body: Buffer) {
  return fetch("https://generativelanguage.googleapis.com/...", {
    headers: { "x-goog-api-key": process.env.GEMINI_KEY! },
    body,
  });
}

// 이후
const proxy = createLlmProxy({ provider: gemini({ apiKey: process.env.GEMINI_KEY! }) });
const result = await proxy.proxy({ method: "POST", path: "v1beta/models/...", ... });
```

**3단계 — 커스텀 로직을 미들웨어로 연결**

비즈니스 특화 변환(속도 제한, 사용자 기반 라우팅, 추가 헤더)이 있다면, `fetch` 주변의 임시 코드 대신 파이프라인의 `RequestMiddleware` 함수로 유지하세요.

```typescript
const pipeline = [
  myRateLimiter,                          // 기존 로직을 래핑
  piiRedactor({ mode: "redact" }),
  secretScanner(),
  auditLogger({ path: "./audit.jsonl" }),
];
```

**4단계 — 기존 파일 삭제**

이전 프록시 모듈, 제거 유틸리티, 수동 감사 작성기를 삭제하세요. SDK가 세 가지 모두를 대체합니다.

**5단계 — 테스트 체크리스트**

- [ ] 한국 전화번호가 포함된 요청 전송 — 업스트림 페이로드에 원본 번호 대신 `[REDACTED_KR_PHONE]`이 나타나는지 확인
- [ ] `AIzaSy...`가 포함된 요청 전송 — 업스트림 도달 전 차단되는지 확인
- [ ] LLM이 하드코딩된 API 키가 포함된 응답을 반환하도록 유도 — 응답 본문에서 제거되는지 확인
- [ ] 요청 후 `audit.jsonl` 확인 — `"event":"request"`와 올바른 필드가 포함된 라인이 작성되는지 확인
- [ ] `pathPrefixes`에 없는 경로로 요청 전송 — HTTP 403 확인
- [ ] `maxSizeMb`를 초과하는 본문 전송 — HTTP 413 확인
