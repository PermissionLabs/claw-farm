/**
 * OpenClaw configuration template.
 * Routes LLM calls through api-proxy (no direct API key access).
 */
export function openclawConfigTemplate(
  name: string,
  processor: "builtin" | "mem0",
): string {
  // Output valid JSON (no comments) so JSON.parse works in config merge
  return JSON.stringify(
    {
      agents: {
        defaults: {
          model: {
            primary: "google/gemini-2.5-flash",
          },
        },
      },
      models: {
        providers: {
          google: {
            baseUrl: "http://api-proxy:8080/v1beta",
            models: [],
          },
        },
      },
      env: {
        GEMINI_API_KEY: "proxied",
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
