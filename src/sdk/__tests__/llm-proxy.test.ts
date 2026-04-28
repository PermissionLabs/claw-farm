import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLlmProxy } from "../llm-proxy.ts";
import { createAuditLogger } from "../audit-logger.ts";
import type { LlmProvider } from "../types.ts";

// Minimal fake provider for pipeline tests
const fakeProvider: LlmProvider = {
  name: "fake",
  baseUrl: "http://fake-upstream.internal",
  authHeader: "x-api-key",
  authValue: "test-key-123",
  pathPrefixes: ["v1/"],
  queryAllowlist: new Set(["safe-param"]),
  extraHeaders: {},
};

// SSRF options that skip real DNS and allow the http:// test upstream.
// In production, ssrfOptions is left unset (deny-by-default).
const testSsrfOptions = {
  allowPrivate: true,
  resolveHost: async (_hostname: string): Promise<string[]> => [],
};

// Intercept fetch calls
type FetchCall = { url: string; method: string; headers: Record<string, string> };
let fetchCalls: FetchCall[] = [];
let mockResponseBody = JSON.stringify({ ok: true });
let mockResponseStatus = 200;

const originalFetch = globalThis.fetch;

function installFetchMock() {
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k] = v;
      }
    }
    fetchCalls.push({ url, method: (init?.method ?? "GET").toUpperCase(), headers });
    return new Response(mockResponseBody, {
      status: mockResponseStatus,
      headers: { "content-type": "application/json", "server": "upstream-server" },
    });
  }) as unknown as typeof fetch;
}

function uninstallFetchMock() {
  globalThis.fetch = originalFetch;
}

describe("createLlmProxy", () => {
  beforeEach(() => {
    mockResponseBody = JSON.stringify({ ok: true });
    mockResponseStatus = 200;
    installFetchMock();
  });

  afterEach(() => {
    uninstallFetchMock();
  });

  it("proxies a valid request to the upstream URL", async () => {
    const { proxy } = createLlmProxy({ provider: fakeProvider, pipeline: [], ssrfOptions: testSsrfOptions });

    const response = await proxy({
      method: "POST",
      path: "/v1/chat",
      queryString: "",
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ message: "hello" })),
    });

    expect(response.status).toBe(200);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toBe("http://fake-upstream.internal/v1/chat");
  });

  it("returns 403 for disallowed path prefix", async () => {
    const { proxy } = createLlmProxy({ provider: fakeProvider, pipeline: [], ssrfOptions: testSsrfOptions });

    const response = await proxy({
      method: "GET",
      path: "/admin/secrets",
      queryString: "",
      headers: {},
      body: Buffer.from(""),
    });

    expect(response.status).toBe(403);
    expect(fetchCalls).toHaveLength(0);
  });

  it("returns 403 for path traversal", async () => {
    const { proxy } = createLlmProxy({ provider: fakeProvider, pipeline: [], ssrfOptions: testSsrfOptions });

    const response = await proxy({
      method: "GET",
      path: "/v1/../admin",
      queryString: "",
      headers: {},
      body: Buffer.from(""),
    });

    expect(response.status).toBe(403);
    expect(fetchCalls).toHaveLength(0);
  });

  // BKLG-042: non-canonical path forms that survive includes("..")
  it("returns 403 for double-slash interior path /v1/.//chat (BKLG-042)", async () => {
    const { proxy } = createLlmProxy({ provider: fakeProvider, pipeline: [], ssrfOptions: testSsrfOptions });

    const response = await proxy({
      method: "GET",
      path: "/v1/.//chat",
      queryString: "",
      headers: {},
      body: Buffer.from(""),
    });

    expect(response.status).toBe(403);
    expect(fetchCalls).toHaveLength(0);
  });

  it("returns 403 for dot-segment path /v1/./chat (BKLG-042)", async () => {
    const { proxy } = createLlmProxy({ provider: fakeProvider, pipeline: [], ssrfOptions: testSsrfOptions });

    const response = await proxy({
      method: "GET",
      path: "/v1/./chat",
      queryString: "",
      headers: {},
      body: Buffer.from(""),
    });

    expect(response.status).toBe(403);
    expect(fetchCalls).toHaveLength(0);
  });

  it("returns 403 for double-slash interior path /v1//chat (BKLG-042)", async () => {
    const { proxy } = createLlmProxy({ provider: fakeProvider, pipeline: [], ssrfOptions: testSsrfOptions });

    const response = await proxy({
      method: "GET",
      path: "/v1//chat",
      queryString: "",
      headers: {},
      body: Buffer.from(""),
    });

    expect(response.status).toBe(403);
    expect(fetchCalls).toHaveLength(0);
  });

  it("allows canonical path /v1/ with trailing slash (BKLG-042)", async () => {
    const { proxy } = createLlmProxy({ provider: fakeProvider, pipeline: [], ssrfOptions: testSsrfOptions });

    // posix.normalize("v1/") === "v1/" so this must pass the guard
    const response = await proxy({
      method: "GET",
      path: "/v1/models",
      queryString: "",
      headers: {},
      body: Buffer.from(""),
    });

    // Should reach upstream (200 from mock), not be rejected
    expect(response.status).toBe(200);
  });

  it("returns 413 when body exceeds maxSizeMb", async () => {
    const { proxy } = createLlmProxy({ provider: fakeProvider, pipeline: [], maxSizeMb: 0.0001, ssrfOptions: testSsrfOptions });

    const response = await proxy({
      method: "POST",
      path: "/v1/chat",
      queryString: "",
      headers: { "content-type": "application/json" },
      body: Buffer.alloc(200, "x"),
    });

    expect(response.status).toBe(413);
    expect(fetchCalls).toHaveLength(0);
  });

  it("strips x-forwarded-* headers before forwarding", async () => {
    const { proxy } = createLlmProxy({ provider: fakeProvider, pipeline: [], ssrfOptions: testSsrfOptions });

    await proxy({
      method: "POST",
      path: "/v1/chat",
      queryString: "",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "1.2.3.4",
        "x-forwarded-host": "evil.com",
        "x-forwarded-proto": "https",
      },
      body: Buffer.from(JSON.stringify({ q: "test" })),
    });

    expect(fetchCalls).toHaveLength(1);
    const sentHeaders = fetchCalls[0]!.headers;
    expect(Object.keys(sentHeaders).some((k) => k.toLowerCase().startsWith("x-forwarded-"))).toBe(false);
  });

  it("strips sensitive response headers (server, set-cookie, x-powered-by)", async () => {
    // The mock sets "server" header on the response
    const { proxy } = createLlmProxy({ provider: fakeProvider, pipeline: [], ssrfOptions: testSsrfOptions });

    const response = await proxy({
      method: "POST",
      path: "/v1/chat",
      queryString: "",
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ q: "test" })),
    });

    expect(response.status).toBe(200);
    expect(response.headers["server"]).toBeUndefined();
  });

  it("only forwards allowlisted query params", async () => {
    const { proxy } = createLlmProxy({ provider: fakeProvider, pipeline: [], ssrfOptions: testSsrfOptions });

    await proxy({
      method: "GET",
      path: "/v1/models",
      queryString: "safe-param=yes&key=LEAKED_KEY&evil=injection",
      headers: {},
      body: Buffer.from(""),
    });

    expect(fetchCalls).toHaveLength(1);
    const url = fetchCalls[0]!.url;
    expect(url).toContain("safe-param=yes");
    expect(url).not.toContain("key=LEAKED_KEY");
    expect(url).not.toContain("evil=injection");
  });

  it("injects auth header into upstream request", async () => {
    const { proxy } = createLlmProxy({ provider: fakeProvider, pipeline: [], ssrfOptions: testSsrfOptions });

    await proxy({
      method: "POST",
      path: "/v1/chat",
      queryString: "",
      headers: { "content-type": "application/json" },
      body: Buffer.from("{}"),
    });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.headers["x-api-key"]).toBe("test-key-123");
  });

  it("runs middleware pipeline in onion order", async () => {
    const order: string[] = [];

    const mwA = async (_ctx: unknown, next: () => Promise<unknown>) => {
      order.push("A-before");
      const result = await next();
      order.push("A-after");
      return result;
    };
    const mwB = async (_ctx: unknown, next: () => Promise<unknown>) => {
      order.push("B-before");
      const result = await next();
      order.push("B-after");
      return result;
    };

    const { proxy } = createLlmProxy({
      provider: fakeProvider,
      pipeline: [mwA as never, mwB as never],
      ssrfOptions: testSsrfOptions,
    });

    await proxy({
      method: "POST",
      path: "/v1/chat",
      queryString: "",
      headers: { "content-type": "application/json" },
      body: Buffer.from("{}"),
    });

    expect(order).toEqual(["A-before", "B-before", "B-after", "A-after"]);
  });
});

describe("createLlmProxy — close() flushes audit loggers (BKLG-036)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    delete process.env["AUDIT_LOG_HMAC_KEY"];
    tmpDir = await mkdtemp(join(tmpdir(), "proxy-flush-test-"));
    installFetchMock();
  });

  afterEach(async () => {
    uninstallFetchMock();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("close() flushes buffered audit log entries to disk", async () => {
    const logPath = join(tmpDir, "audit.jsonl");
    const logger = createAuditLogger({ path: logPath });

    const { close } = createLlmProxy({
      provider: fakeProvider,
      pipeline: [],
      ssrfOptions: testSsrfOptions,
      auditLoggers: [logger],
    });

    // Fire N log entries via the logger (simulating what auditLogger middleware does)
    logger.log({ event: "req-1", path: "/v1/chat" });
    logger.log({ event: "req-2", path: "/v1/chat" });
    logger.log({ event: "req-3", path: "/v1/chat" });

    // close() must flush all pending writes
    await close();

    const lines = (await readFile(logPath, "utf-8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));

    expect(lines.length).toBe(3);
    expect(lines[0].event).toBe("req-1");
    expect(lines[2].event).toBe("req-3");
  });

  it("close() with no audit loggers resolves without error", async () => {
    const { close } = createLlmProxy({
      provider: fakeProvider,
      pipeline: [],
      ssrfOptions: testSsrfOptions,
    });

    await expect(close()).resolves.toBeUndefined();
  });

  it("close() flushes multiple audit loggers", async () => {
    const logPath1 = join(tmpDir, "audit1.jsonl");
    const logPath2 = join(tmpDir, "audit2.jsonl");
    const logger1 = createAuditLogger({ path: logPath1 });
    const logger2 = createAuditLogger({ path: logPath2 });

    const { close } = createLlmProxy({
      provider: fakeProvider,
      pipeline: [],
      ssrfOptions: testSsrfOptions,
      auditLoggers: [logger1, logger2],
    });

    logger1.log({ event: "a" });
    logger2.log({ event: "b" });

    await close();

    const lines1 = (await readFile(logPath1, "utf-8")).trim().split("\n").filter(Boolean);
    const lines2 = (await readFile(logPath2, "utf-8")).trim().split("\n").filter(Boolean);

    expect(lines1.length).toBe(1);
    expect(lines2.length).toBe(1);
  });
});
