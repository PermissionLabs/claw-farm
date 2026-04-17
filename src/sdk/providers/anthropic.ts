import type { LlmProvider } from "../types.ts";
import { validateUpstreamUrl } from "../lib/url-safety.ts";

export interface AnthropicOptions {
  apiKey: string;
  version?: string;
}

export async function anthropic(opts: AnthropicOptions): Promise<LlmProvider> {
  const baseUrl = "https://api.anthropic.com";
  await validateUpstreamUrl(baseUrl);
  return {
    name: "anthropic",
    baseUrl,
    authHeader: "x-api-key",
    authValue: opts.apiKey,
    pathPrefixes: ["v1/"],
    queryAllowlist: new Set(),
    extraHeaders: {
      "anthropic-version": opts.version ?? "2023-06-01",
    },
  };
}
