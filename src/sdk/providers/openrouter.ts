import type { LlmProvider } from "../types.ts";

export interface OpenRouterOptions {
  apiKey: string;
  referer?: string;
  title?: string;
}

export function openRouter(opts: OpenRouterOptions): LlmProvider {
  return {
    name: "openrouter",
    baseUrl: "https://openrouter.ai/api",
    authHeader: "authorization",
    authValue: `Bearer ${opts.apiKey}`,
    pathPrefixes: ["v1/"],
    queryAllowlist: new Set(),
    extraHeaders: {
      ...(opts.referer ? { "HTTP-Referer": opts.referer } : {}),
      ...(opts.title ? { "X-Title": opts.title } : {}),
    },
  };
}
