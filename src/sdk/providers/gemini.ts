import type { LlmProvider } from "../types.ts";

export interface GeminiOptions {
  apiKey: string;
  baseUrl?: string;
  disableThinking?: boolean;
}

export function gemini(opts: GeminiOptions): LlmProvider {
  const disableThinking = opts.disableThinking ?? false;

  return {
    name: "gemini",
    baseUrl: opts.baseUrl ?? "https://generativelanguage.googleapis.com",
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
