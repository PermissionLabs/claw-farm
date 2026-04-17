import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { validateUpstreamUrl } from "../lib/url-safety.ts";

// --- helpers ---

/** A resolver that always returns the given IP (for mocking DNS). */
function fixedResolver(ip: string) {
  return async (_hostname: string): Promise<string[]> => [ip];
}

/** A resolver that returns nothing (DNS failure / no resolution). */
const emptyResolver = async (_hostname: string): Promise<string[]> => [];

// Save and restore ALLOW_PRIVATE_BASE_URL around env-sensitive tests
let savedEnv: string | undefined;
beforeEach(() => {
  savedEnv = process.env["ALLOW_PRIVATE_BASE_URL"];
  delete process.env["ALLOW_PRIVATE_BASE_URL"];
});
afterEach(() => {
  if (savedEnv === undefined) {
    delete process.env["ALLOW_PRIVATE_BASE_URL"];
  } else {
    process.env["ALLOW_PRIVATE_BASE_URL"] = savedEnv;
  }
});

// --- Rejection cases ---

describe("validateUpstreamUrl — rejected URLs", () => {
  it("rejects http://169.254.169.254 (literal IMDS IP)", async () => {
    await expect(
      validateUpstreamUrl("http://169.254.169.254/latest/meta-data/", {
        resolveHost: emptyResolver,
      }),
    ).rejects.toThrow(/SSRF/);
  });

  it("rejects http://127.0.0.1 (loopback, no allowLoopback)", async () => {
    await expect(
      validateUpstreamUrl("http://127.0.0.1", {
        resolveHost: emptyResolver,
      }),
    ).rejects.toThrow(/SSRF/);
  });

  it("rejects http://localhost (loopback, no allowLoopback)", async () => {
    await expect(
      validateUpstreamUrl("http://localhost", {
        resolveHost: emptyResolver,
      }),
    ).rejects.toThrow(/SSRF/);
  });

  it("rejects http://10.0.0.5 (RFC-1918 private)", async () => {
    await expect(
      validateUpstreamUrl("http://10.0.0.5", {
        resolveHost: emptyResolver,
      }),
    ).rejects.toThrow(/SSRF/);
  });

  it("rejects http://192.168.1.100 (RFC-1918 private)", async () => {
    await expect(
      validateUpstreamUrl("http://192.168.1.100", {
        resolveHost: emptyResolver,
      }),
    ).rejects.toThrow(/SSRF/);
  });

  it("rejects http://172.16.0.1 (RFC-1918 private)", async () => {
    await expect(
      validateUpstreamUrl("http://172.16.0.1", {
        resolveHost: emptyResolver,
      }),
    ).rejects.toThrow(/SSRF/);
  });

  it("rejects http://metadata.google.internal (forbidden hostname)", async () => {
    await expect(
      validateUpstreamUrl("http://metadata.google.internal/computeMetadata/v1/", {
        resolveHost: emptyResolver,
      }),
    ).rejects.toThrow(/SSRF/);
  });

  it("rejects http://metadata.goog (forbidden hostname)", async () => {
    await expect(
      validateUpstreamUrl("http://metadata.goog/", {
        resolveHost: emptyResolver,
      }),
    ).rejects.toThrow(/SSRF/);
  });

  it("rejects ftp://foo.com (non-http scheme)", async () => {
    await expect(
      validateUpstreamUrl("ftp://foo.com/", {
        resolveHost: emptyResolver,
      }),
    ).rejects.toThrow(/SSRF/);
  });

  it("rejects a non-parseable string", async () => {
    await expect(
      validateUpstreamUrl("not a url at all !!!"),
    ).rejects.toThrow(/SSRF/);
  });

  it("rejects https://internal.corp when DNS resolves to 10.x", async () => {
    await expect(
      validateUpstreamUrl("https://internal.corp", {
        resolveHost: fixedResolver("10.20.30.40"),
      }),
    ).rejects.toThrow(/SSRF/);
  });

  it("rejects https://rebind.example when DNS resolves to 169.254.169.254", async () => {
    await expect(
      validateUpstreamUrl("https://rebind.example", {
        resolveHost: fixedResolver("169.254.169.254"),
      }),
    ).rejects.toThrow(/SSRF/);
  });
});

// --- Acceptance cases ---

describe("validateUpstreamUrl — accepted URLs", () => {
  it("accepts https://api.anthropic.com", async () => {
    const url = await validateUpstreamUrl("https://api.anthropic.com", {
      resolveHost: emptyResolver,
    });
    expect(url.hostname).toBe("api.anthropic.com");
  });

  it("accepts https://generativelanguage.googleapis.com", async () => {
    const url = await validateUpstreamUrl(
      "https://generativelanguage.googleapis.com",
      { resolveHost: emptyResolver },
    );
    expect(url.hostname).toBe("generativelanguage.googleapis.com");
  });

  it("accepts https://openrouter.ai/api", async () => {
    const url = await validateUpstreamUrl("https://openrouter.ai/api", {
      resolveHost: emptyResolver,
    });
    expect(url.hostname).toBe("openrouter.ai");
  });
});

// --- allowLoopback ---

describe("validateUpstreamUrl — allowLoopback: true", () => {
  it("accepts http://localhost with allowLoopback", async () => {
    const url = await validateUpstreamUrl("http://localhost", {
      allowLoopback: true,
      resolveHost: emptyResolver,
    });
    expect(url.hostname).toBe("localhost");
  });

  it("accepts http://127.0.0.1 with allowLoopback", async () => {
    const url = await validateUpstreamUrl("http://127.0.0.1", {
      allowLoopback: true,
      resolveHost: emptyResolver,
    });
    expect(url.hostname).toBe("127.0.0.1");
  });

  it("still rejects http://10.0.0.5 even with allowLoopback (not loopback)", async () => {
    await expect(
      validateUpstreamUrl("http://10.0.0.5", {
        allowLoopback: true,
        resolveHost: emptyResolver,
      }),
    ).rejects.toThrow(/SSRF/);
  });
});

// --- allowPrivate ---

describe("validateUpstreamUrl — allowPrivate: true", () => {
  it("accepts http://10.0.0.5 with allowPrivate", async () => {
    const url = await validateUpstreamUrl("http://10.0.0.5", {
      allowPrivate: true,
      resolveHost: emptyResolver,
    });
    expect(url.hostname).toBe("10.0.0.5");
  });

  it("accepts http://localhost with allowPrivate", async () => {
    const url = await validateUpstreamUrl("http://localhost", {
      allowPrivate: true,
      resolveHost: emptyResolver,
    });
    expect(url.hostname).toBe("localhost");
  });
});

// --- ALLOW_PRIVATE_BASE_URL env ---

describe("validateUpstreamUrl — ALLOW_PRIVATE_BASE_URL=1 env var", () => {
  it("accepts private IP when env is set", async () => {
    process.env["ALLOW_PRIVATE_BASE_URL"] = "1";
    const url = await validateUpstreamUrl("http://10.0.0.5", {
      resolveHost: emptyResolver,
    });
    expect(url.hostname).toBe("10.0.0.5");
  });

  it("accepts localhost when env is set", async () => {
    process.env["ALLOW_PRIVATE_BASE_URL"] = "1";
    const url = await validateUpstreamUrl("http://localhost", {
      resolveHost: emptyResolver,
    });
    expect(url.hostname).toBe("localhost");
  });

  it("rejects private IP when env is not set", async () => {
    // env is deleted in beforeEach
    await expect(
      validateUpstreamUrl("http://10.0.0.5", {
        resolveHost: emptyResolver,
      }),
    ).rejects.toThrow(/SSRF/);
  });
});
