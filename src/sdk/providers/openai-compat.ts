import type { LlmProvider } from "../types.ts";

export interface OpenAICompatOptions {
  apiKey: string;
  baseUrl?: string;
}

export function openaiCompat(opts: OpenAICompatOptions): LlmProvider {
  return {
    name: "openai-compat",
    baseUrl: (opts.baseUrl ?? "https://api.openai.com").replace(/\/+$/, ""),
    authHeader: "authorization",
    authValue: `Bearer ${opts.apiKey}`,
    pathPrefixes: ["v1/"],
    queryAllowlist: new Set(),
  };
}
