import { describe, it, expect } from "bun:test";
import { scanSecrets, scanResponseBody, defaultSecretPatterns } from "../secret-scanner.ts";

describe("scanSecrets", () => {
  it("redacts Anthropic API keys", () => {
    const text = "key: sk-ant-api03-" + "a".repeat(80);
    const { text: out, findings } = scanSecrets(text);
    expect(findings.some((f) => f.type === "ANTHROPIC_KEY")).toBe(true);
    expect(out).not.toContain("sk-ant-");
  });

  it("redacts OpenAI keys", () => {
    const text = "Authorization: Bearer sk-" + "A".repeat(25);
    const { text: out, findings } = scanSecrets(text);
    expect(findings.some((f) => f.type === "OPENAI_KEY")).toBe(true);
    expect(out).not.toContain("sk-A");
  });

  it("redacts OpenRouter keys", () => {
    const text = "sk-or-v1-" + "b".repeat(50);
    const { text: out, findings } = scanSecrets(text);
    expect(findings.some((f) => f.type === "OPENROUTER_KEY")).toBe(true);
    expect(out).not.toContain("sk-or-v1-");
  });

  it("redacts Supabase keys", () => {
    const text = "sbp_" + "c".repeat(42);
    const { text: out, findings } = scanSecrets(text);
    expect(findings.some((f) => f.type === "SUPABASE_KEY")).toBe(true);
    expect(out).not.toContain("sbp_");
  });

  it("redacts AWS access keys (AKIA)", () => {
    const text = "AKIA" + "A".repeat(16);
    const { text: out, findings } = scanSecrets(text);
    expect(findings.some((f) => f.type === "AWS_ACCESS_KEY")).toBe(true);
    expect(out).not.toContain("AKIA");
  });

  it("redacts AWS temp access keys (ASIA) — STS", () => {
    const text = "aws_access_key_id = ASIA" + "B".repeat(16);
    const { text: out, findings } = scanSecrets(text);
    expect(findings.some((f) => f.type === "AWS_TEMP_ACCESS_KEY")).toBe(true);
    expect(out).not.toContain("ASIA");
  });

  it("redacts AWS session tokens (FwoGZ prefix)", () => {
    const sessionToken = "FwoGZ" + "X".repeat(250);
    const text = `AWS_SESSION_TOKEN=${sessionToken}`;
    const { text: out, findings } = scanSecrets(text);
    expect(findings.some((f) => f.type === "AWS_SESSION_TOKEN")).toBe(true);
    expect(out).not.toContain("FwoGZ");
  });

  it("redacts AWS session-token env var form", () => {
    const long = "A".repeat(110);
    const text = `aws_session_token = ${long}`;
    const { text: out, findings } = scanSecrets(text);
    expect(findings.some((f) => f.type === "AWS_SESSION_TOKEN_ENV")).toBe(true);
    expect(out).toContain("[REDACTED_AWS_SESSION_TOKEN_ENV]");
  });

  it("returns empty findings for clean text", () => {
    const { findings } = scanSecrets("hello world, no secrets here");
    expect(findings).toHaveLength(0);
  });
});

describe("scanResponseBody", () => {
  it("redacts secrets from JSON body", () => {
    const payload = JSON.stringify({
      message: "Your key is sk-ant-api03-" + "a".repeat(80),
    });
    const { body, findings } = scanResponseBody(Buffer.from(payload));
    expect(findings.length).toBeGreaterThan(0);
    expect(body.toString()).not.toContain("sk-ant-");
  });

  it("redacts secrets from plain-text (non-JSON) body", () => {
    const text = "Here is a key: AKIA" + "Z".repeat(16);
    const { body, findings } = scanResponseBody(Buffer.from(text));
    expect(findings.length).toBeGreaterThan(0);
    expect(body.toString()).not.toContain("AKIA");
  });

  it("exercises raw-text fallback path for SSE-style data", () => {
    const sse = `data: {"delta":"ASIA${"C".repeat(16)}"}\ndata: [DONE]\n`;
    const { body, findings } = scanResponseBody(Buffer.from(sse));
    expect(findings.length).toBeGreaterThan(0);
    expect(body.toString()).not.toContain("ASIA");
  });

  it("returns original body when nothing is found", () => {
    const payload = Buffer.from(JSON.stringify({ ok: true }));
    const { body, findings } = scanResponseBody(payload);
    expect(findings).toHaveLength(0);
    expect(body).toBe(payload);
  });

  it("redacts AWS session token in JSON response", () => {
    const token = "FwoGZ" + "T".repeat(220);
    const payload = JSON.stringify({ session_token: token });
    const { body, findings } = scanResponseBody(Buffer.from(payload));
    expect(findings.some((f) => f.type === "AWS_SESSION_TOKEN")).toBe(true);
    expect(body.toString()).not.toContain("FwoGZ");
  });
});
