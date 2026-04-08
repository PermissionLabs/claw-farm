import type { LlmProvider } from "../types.ts";

export interface AnthropicOptions {
  apiKey: string;
  version?: string;
}

export function anthropic(opts: AnthropicOptions): LlmProvider {
  return {
    name: "anthropic",
    baseUrl: "https://api.anthropic.com",
    authHeader: "x-api-key",
    authValue: opts.apiKey,
    pathPrefixes: ["v1/"],
    queryAllowlist: new Set(),
    extraHeaders: {
      "anthropic-version": opts.version ?? "2023-06-01",
    },
  };
}
