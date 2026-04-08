// claw-farm SDK — security modules barrel export

// Standalone functions
export { redactPii, redactRequestBody, piiRedactor } from "./pii-redactor.ts";
export {
  scanSecrets,
  scanResponseBody,
  secretScanner,
  defaultSecretPatterns,
} from "./secret-scanner.ts";
export { createAuditLogger, auditLogger } from "./audit-logger.ts";
export { createLlmProxy } from "./llm-proxy.ts";

// Providers
export {
  gemini,
  anthropic,
  openRouter,
  openaiCompat,
} from "./providers/index.ts";

// Patterns
export {
  defaultPatterns,
  koreanPatterns,
  usPatterns,
  financialPatterns,
  universalPatterns,
} from "./patterns/index.ts";

// Types
export type {
  Finding,
  RedactResult,
  RedactBodyResult,
  PiiMode,
  PiiPattern,
  PiiPatternGroup,
  SecretPattern,
  SecretPatternGroup,
  LlmProvider,
  ProxyContext,
  ProxyResponse,
  ProxyRequest,
  RequestMiddleware,
  LlmProxyOptions,
} from "./types.ts";
