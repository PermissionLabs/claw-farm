import type { LlmProvider } from "../types.ts";
import { validateUpstreamUrl } from "../lib/url-safety.ts";

export interface OpenRouterOptions {
  apiKey: string;
  referer?: string;
  title?: string;
}

export async function openRouter(opts: OpenRouterOptions): Promise<LlmProvider> {
  const baseUrl = "https://openrouter.ai/api";
  await validateUpstreamUrl(baseUrl);
  return {
    name: "openrouter",
    baseUrl,
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
