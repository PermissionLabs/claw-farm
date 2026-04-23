import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mem0Processor } from "../mem0.ts";

let createdDirs: string[] = [];

afterEach(async () => {
  for (const dir of createdDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  createdDirs = [];
});

describe("mem0 template (BKLG-027)", () => {
  it("emitted Python contains fail-closed startup check for production", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "mem0-tpl-test-"));
    createdDirs.push(tmpDir);

    await mem0Processor.init(tmpDir);

    const serverPy = await readFile(join(tmpDir, "mem0", "mem0_server.py"), "utf-8");

    // Must import sys for sys.exit
    expect(serverPy).toContain("import sys");

    // Must check ENVIRONMENT == production AND missing MEM0_API_KEY
    expect(serverPy).toContain('ENVIRONMENT == "production"');
    expect(serverPy).toContain("MEM0_API_KEY");

    // Must call sys.exit on failure
    expect(serverPy).toContain("sys.exit(1)");

    // Must emit a warning when running non-production with no key
    expect(serverPy).toContain("WARNING");
  });

  it("emitted .env.example documents ENVIRONMENT variable", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "mem0-tpl-env-"));
    createdDirs.push(tmpDir);

    await mem0Processor.init(tmpDir);

    const envExample = await readFile(join(tmpDir, ".env.example"), "utf-8");

    expect(envExample).toContain("ENVIRONMENT");
    expect(envExample).toContain("production");
  });

  it("supportedRuntimes is ['openclaw'] only", () => {
    expect(mem0Processor.supportedRuntimes).toEqual(["openclaw"]);
  });
});
