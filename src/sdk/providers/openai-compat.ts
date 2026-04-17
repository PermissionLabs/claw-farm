import type { LlmProvider } from "../types.ts";
import { validateUpstreamUrl } from "../lib/url-safety.ts";

export interface OpenAICompatOptions {
  apiKey: string;
  baseUrl?: string;
}

export async function openaiCompat(opts: OpenAICompatOptions): Promise<LlmProvider> {
  const rawBase = (opts.baseUrl ?? "https://api.openai.com").replace(/\/+$/, "");
  await validateUpstreamUrl(rawBase);
  return {
    name: "openai-compat",
    baseUrl: rawBase,
    authHeader: "authorization",
    authValue: `Bearer ${opts.apiKey}`,
    pathPrefixes: ["v1/"],
    queryAllowlist: new Set(),
  };
}
