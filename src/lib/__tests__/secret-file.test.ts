import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { stat, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { writeSecret } from "../secret-file.ts";

function tmpDir(): string {
  return join(tmpdir(), `secret-file-test-${randomBytes(6).toString("hex")}`);
}

describe("writeSecret", () => {
  let dir: string;

  beforeEach(async () => {
    dir = tmpDir();
    await mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    // Best-effort cleanup
    try {
      const { rm } = await import("node:fs/promises");
      await rm(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("creates a new file with 0o600 permissions", async () => {
    const path = join(dir, "secret.env");
    await writeSecret(path, "API_KEY=test-value\n");

    const s = await stat(path);
    // mode & 0o777 gives the permission bits
    expect(s.mode & 0o777).toBe(0o600);

    const contents = await readFile(path, "utf8");
    expect(contents).toBe("API_KEY=test-value\n");
  });

  it("accepts Uint8Array contents", async () => {
    const path = join(dir, "binary.dat");
    const data = new TextEncoder().encode("binary-data");
    await writeSecret(path, data);

    const s = await stat(path);
    expect(s.mode & 0o777).toBe(0o600);

    const contents = await readFile(path);
    expect(contents).toEqual(Buffer.from(data));
  });

  it("overwrites atomically without widening permissions", async () => {
    const path = join(dir, "overwrite.env");

    // Pre-create the file with content
    await writeFile(path, "OLD=value\n", { mode: 0o600 });

    // Overwrite via writeSecret
    await writeSecret(path, "NEW=value\n");

    const s = await stat(path);
    expect(s.mode & 0o777).toBe(0o600);

    const contents = await readFile(path, "utf8");
    expect(contents).toBe("NEW=value\n");
  });

  it("leaves no tempfile behind on success", async () => {
    const path = join(dir, "clean.env");
    // Create existing file so the overwrite path is exercised
    await writeFile(path, "FIRST=1\n", { mode: 0o600 });
    await writeSecret(path, "SECOND=2\n");

    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    // Should only be the target file — no .tmp-* leftovers
    const temps = files.filter((f) => f.startsWith(".tmp-"));
    expect(temps).toHaveLength(0);
  });

  it("creates file content correctly for multi-line strings", async () => {
    const path = join(dir, "multi.env");
    const content = "KEY1=val1\nKEY2=val2\n# comment\n";
    await writeSecret(path, content);

    const read = await readFile(path, "utf8");
    expect(read).toBe(content);
  });
});
