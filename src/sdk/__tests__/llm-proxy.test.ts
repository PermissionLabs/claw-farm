import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createLlmProxy } from "../llm-proxy.ts";
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

// Intercept fetch calls
type FetchCall = { url: string; method: string; headers: Record<string, string> };
let fetchCalls: FetchCall[] = [];
let mockResponseBody = JSON.stringify({ ok: true });
let mockResponseStatus = 200;

const originalFetch = globalThis.fetch;

function installFetchMock() {
  fetchCalls = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
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
  };
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
    const { proxy } = createLlmProxy({ provider: fakeProvider, pipeline: [] });

    const response = await proxy({
      method: "POST",
      path: "/v1/chat",
      queryString: "",
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ message: "hello" })),
    });

    expect(response.status).toBe(200);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("http://fake-upstream.internal/v1/chat");
  });

  it("returns 403 for disallowed path prefix", async () => {
    const { proxy } = createLlmProxy({ provider: fakeProvider, pipeline: [] });

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
    const { proxy } = createLlmProxy({ provider: fakeProvider, pipeline: [] });

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

  it("returns 413 when body exceeds maxSizeMb", async () => {
    const { proxy } = createLlmProxy({ provider: fakeProvider, pipeline: [], maxSizeMb: 0.0001 });

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
    const { proxy } = createLlmProxy({ provider: fakeProvider, pipeline: [] });

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
    const sentHeaders = fetchCalls[0].headers;
    expect(Object.keys(sentHeaders).some((k) => k.toLowerCase().startsWith("x-forwarded-"))).toBe(false);
  });

  it("strips sensitive response headers (server, set-cookie, x-powered-by)", async () => {
    // The mock sets "server" header on the response
    const { proxy } = createLlmProxy({ provider: fakeProvider, pipeline: [] });

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
    const { proxy } = createLlmProxy({ provider: fakeProvider, pipeline: [] });

    await proxy({
      method: "GET",
      path: "/v1/models",
      queryString: "safe-param=yes&key=LEAKED_KEY&evil=injection",
      headers: {},
      body: Buffer.from(""),
    });

    expect(fetchCalls).toHaveLength(1);
    const url = fetchCalls[0].url;
    expect(url).toContain("safe-param=yes");
    expect(url).not.toContain("key=LEAKED_KEY");
    expect(url).not.toContain("evil=injection");
  });

  it("injects auth header into upstream request", async () => {
    const { proxy } = createLlmProxy({ provider: fakeProvider, pipeline: [] });

    await proxy({
      method: "POST",
      path: "/v1/chat",
      queryString: "",
      headers: { "content-type": "application/json" },
      body: Buffer.from("{}"),
    });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].headers["x-api-key"]).toBe("test-key-123");
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
