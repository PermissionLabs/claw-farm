/**
 * OpenClaw configuration template.
 * Routes LLM calls through api-proxy (no direct API key access).
 */
export function openclawConfigTemplate(
  _name: string,
  processor: "builtin" | "mem0",
  llm: "gemini" | "anthropic" | "openai-compat" = "gemini",
): string {
  const providerConfigs: Record<string, { model: string; providerKey: string; baseUrl: string; envKey: string }> = {
    gemini: {
      model: "google/gemini-2.5-flash",
      providerKey: "google",
      baseUrl: "http://api-proxy:8080/v1beta",
      envKey: "GEMINI_API_KEY",
    },
    anthropic: {
      model: "anthropic/claude-sonnet-4-6",
      providerKey: "anthropic",
      baseUrl: "http://api-proxy:8080/v1",
      envKey: "ANTHROPIC_API_KEY",
    },
    "openai-compat": {
      model: "openai/gpt-4o",
      providerKey: "openai",
      baseUrl: "http://api-proxy:8080/v1",
      envKey: "OPENAI_API_KEY",
    },
  };

  const config = providerConfigs[llm];
  if (!config) throw new Error(`Unknown LLM provider: "${llm}"`);

  // Output valid JSON (no comments) so JSON.parse works in config merge
  return JSON.stringify(
    {
      agents: {
        defaults: {
          model: {
            primary: config.model,
          },
        },
      },
      models: {
        providers: {
          [config.providerKey]: {
            baseUrl: config.baseUrl,
            models: [],
          },
        },
      },
      env: {
        [config.envKey]: "proxied",
      },
      ...(processor === "mem0"
        ? {
            plugins: [
              {
                name: "mem0",
                type: "memory",
                endpoint: "http://mem0-api:8050",
                autoSave: true,
                autoRecall: true,
              },
            ],
          }
        : {}),
      gateway: {
        bind: "lan",
        port: 18789,
        controlUi: {
          enabled: false,
        },
      },
    },
    null,
    2,
  ) + "\n";
}
