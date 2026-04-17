import type { LlmProvider } from "../types.ts";
import { validateUpstreamUrl } from "../lib/url-safety.ts";

export interface GeminiOptions {
  apiKey: string;
  baseUrl?: string;
  disableThinking?: boolean;
}

export async function gemini(opts: GeminiOptions): Promise<LlmProvider> {
  const disableThinking = opts.disableThinking ?? false;
  const rawBase = opts.baseUrl ?? "https://generativelanguage.googleapis.com";
  await validateUpstreamUrl(rawBase);

  return {
    name: "gemini",
    baseUrl: rawBase,
    authHeader: "x-goog-api-key",
    authValue: opts.apiKey,
    pathPrefixes: ["v1beta/", "v1/", "v1alpha/", "v1beta1/"],
    queryAllowlist: new Set(["alt"]),
    transformRequest: disableThinking
      ? (body) => {
          const generationConfig =
            (body.generationConfig as Record<string, unknown>) ?? {};
          generationConfig.thinkingConfig = { thinkingBudget: 0 };
          return { ...body, generationConfig };
        }
      : undefined,
  };
}
