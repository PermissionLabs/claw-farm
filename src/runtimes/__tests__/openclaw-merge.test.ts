import { describe, it, expect } from "bun:test";
import { mergeOpenclawConfig } from "../openclaw.ts";

// Helper: build a minimal template JSON with gateway.controlUi settings
function templateWith(controlUi: Record<string, unknown>): string {
  return JSON.stringify({
    agents: { defaults: { model: { primary: "google/gemini-2.5-flash" } } },
    models: { providers: { google: { baseUrl: "http://api-proxy:8080/v1beta", models: [] } } },
    env: { GEMINI_API_KEY: "proxied" },
    gateway: { bind: "lan", port: 18789, controlUi },
  }, null, 2);
}

// Helper: build a user config JSON
function userWith(gateway: Record<string, unknown>): string {
  return JSON.stringify({ gateway }, null, 2);
}

describe("mergeOpenclawConfig — controlUi hardening (BKLG-028)", () => {
  it("forces dangerouslyDisableDeviceAuth=false when template disables controlUi", () => {
    const template = templateWith({ enabled: false });
    const existing = userWith({
      controlUi: { enabled: true, dangerouslyDisableDeviceAuth: true },
    });

    const merged = JSON.parse(mergeOpenclawConfig(template, existing)) as Record<string, unknown>;
    const gateway = merged["gateway"] as Record<string, unknown>;
    const cui = gateway["controlUi"] as Record<string, unknown>;

    expect(cui["enabled"]).toBe(false);
    expect(cui["dangerouslyDisableDeviceAuth"]).toBe(false);
  });

  it("preserves dangerouslyDisableDeviceAuth when template enables controlUi", () => {
    const template = templateWith({ enabled: true });
    const existing = userWith({
      controlUi: { enabled: false, dangerouslyDisableDeviceAuth: true },
    });

    const merged = JSON.parse(mergeOpenclawConfig(template, existing)) as Record<string, unknown>;
    const gateway = merged["gateway"] as Record<string, unknown>;
    const cui = gateway["controlUi"] as Record<string, unknown>;

    expect(cui["enabled"]).toBe(true);
    // When template says enabled=true, user's dangerouslyDisableDeviceAuth is preserved
    expect(cui["dangerouslyDisableDeviceAuth"]).toBe(true);
  });

  it("forces enabled=false from template even if user had enabled=true", () => {
    const template = templateWith({ enabled: false });
    const existing = userWith({ controlUi: { enabled: true } });

    const merged = JSON.parse(mergeOpenclawConfig(template, existing)) as Record<string, unknown>;
    const gateway = merged["gateway"] as Record<string, unknown>;
    const cui = gateway["controlUi"] as Record<string, unknown>;

    expect(cui["enabled"]).toBe(false);
  });

  it("preserves user allowedOrigins when template disables controlUi", () => {
    const template = templateWith({ enabled: false });
    const existing = userWith({
      controlUi: { enabled: true, allowedOrigins: ["https://my-app.example.com"], dangerouslyDisableDeviceAuth: false },
    });

    const merged = JSON.parse(mergeOpenclawConfig(template, existing)) as Record<string, unknown>;
    const gateway = merged["gateway"] as Record<string, unknown>;
    const cui = gateway["controlUi"] as Record<string, unknown>;

    expect(cui["enabled"]).toBe(false);
    expect(cui["dangerouslyDisableDeviceAuth"]).toBe(false);
    expect(cui["allowedOrigins"]).toEqual(["https://my-app.example.com"]);
  });

  it("handles missing controlUi in user config gracefully", () => {
    const template = templateWith({ enabled: false });
    const existing = JSON.stringify({ gateway: { bind: "lan" } }, null, 2);

    const merged = JSON.parse(mergeOpenclawConfig(template, existing)) as Record<string, unknown>;
    const gateway = merged["gateway"] as Record<string, unknown>;
    const cui = gateway["controlUi"] as Record<string, unknown>;

    expect(cui["enabled"]).toBe(false);
    expect(cui["dangerouslyDisableDeviceAuth"]).toBe(false);
  });
});
