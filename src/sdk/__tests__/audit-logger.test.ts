import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createHmac } from "node:crypto";
import { mkdtemp, rm, stat, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Reset the one-time warning flag between tests by reimporting fresh each time.
// We do this by using dynamic import with a cache-bust approach via env manipulation.

async function freshLogger(path: string, opts: Record<string, unknown> = {}) {
  // Reset module-level warning flag via env
  const { createAuditLogger } = await import("../audit-logger.ts");
  return createAuditLogger({ path, ...opts } as Parameters<typeof createAuditLogger>[0]);
}

describe("audit-logger", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "audit-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("HMAC chain", () => {
    it("includes hmac field in each entry when key is set", async () => {
      const key = "test-hmac-key-abc123";
      process.env["AUDIT_LOG_HMAC_KEY"] = key;
      const logPath = join(tmpDir, "audit.jsonl");
      const logger = await freshLogger(logPath);

      logger.log({ event: "a", val: 1 });
      logger.log({ event: "b", val: 2 });
      logger.log({ event: "c", val: 3 });
      await logger.flush();

      const lines = (await readFile(logPath, "utf-8"))
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));

      expect(lines.length).toBe(3);

      // Verify HMAC chain: re-compute from scratch
      let prevHmac = "";
      for (const entry of lines) {
        const { hmac, ...rest } = entry;
        const baseJson = JSON.stringify(rest);
        const expected = createHmac("sha256", key)
          .update(prevHmac + baseJson)
          .digest("hex");
        expect(hmac).toBe(expected);
        prevHmac = hmac;
      }

      delete process.env["AUDIT_LOG_HMAC_KEY"];
    });

    it("omits hmac field and still writes when AUDIT_LOG_HMAC_KEY is absent", async () => {
      delete process.env["AUDIT_LOG_HMAC_KEY"];
      const logPath = join(tmpDir, "audit-nohash.jsonl");

      // Capture stderr to verify one-time warning
      const stderrChunks: string[] = [];
      const origWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (chunk: string | Uint8Array, encoding?: BufferEncoding | ((err?: Error | null) => void), cb?: (err?: Error | null) => void): boolean => {
        stderrChunks.push(chunk.toString());
        if (typeof encoding === "function") {
          return origWrite(chunk, encoding);
        }
        return origWrite(chunk, encoding as BufferEncoding, cb);
      };

      const logger = await freshLogger(logPath);
      logger.log({ event: "x" });
      await logger.flush();

      process.stderr.write = origWrite;

      const lines = (await readFile(logPath, "utf-8"))
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));

      expect(lines.length).toBe(1);
      expect(lines[0]).not.toHaveProperty("hmac");
      expect(stderrChunks.some((c) => c.includes("AUDIT_LOG_HMAC_KEY"))).toBe(true);
    });
  });

  describe("file permissions", () => {
    it("sets file mode to 0o600 after first write", async () => {
      delete process.env["AUDIT_LOG_HMAC_KEY"];
      const logPath = join(tmpDir, "audit-perms.jsonl");
      const logger = await freshLogger(logPath);
      logger.log({ event: "perm-test" });
      await logger.flush();

      const s = await stat(logPath);
      expect(s.mode & 0o777).toBe(0o600);
    });
  });

  describe("rotation", () => {
    it("rotates to .1 when file exceeds maxSizeBytes", async () => {
      delete process.env["AUDIT_LOG_HMAC_KEY"];
      const logPath = join(tmpDir, "audit-rot.jsonl");

      // Pre-fill the log with data exceeding 100 bytes threshold
      const bigData = "x".repeat(150);
      await writeFile(logPath, bigData);

      const logger = await freshLogger(logPath, { maxSizeBytes: 100, maxFiles: 5 });
      logger.log({ event: "trigger-rotation" });
      await logger.flush();

      // Original file should have been renamed to .1
      const rotatedStat = await stat(`${logPath}.1`);
      expect(rotatedStat.isFile()).toBe(true);

      // New log file should exist with the new entry
      const newLines = (await readFile(logPath, "utf-8"))
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      expect(newLines.length).toBeGreaterThan(0);
      expect(newLines[0].event).toBe("trigger-rotation");
    });

    it("shifts backup files on rotation (path.1 → path.2)", async () => {
      delete process.env["AUDIT_LOG_HMAC_KEY"];
      const logPath = join(tmpDir, "audit-shift.jsonl");

      // Pre-fill current and .1
      await writeFile(logPath, "x".repeat(200));
      await writeFile(`${logPath}.1`, "existing-backup");

      const logger = await freshLogger(logPath, { maxSizeBytes: 100, maxFiles: 5 });
      logger.log({ event: "shift-test" });
      await logger.flush();

      // .1 → .2
      const backup2 = await readFile(`${logPath}.2`, "utf-8");
      expect(backup2).toBe("existing-backup");
    });
  });

  describe("flush", () => {
    it("resolves after pending writes complete", async () => {
      delete process.env["AUDIT_LOG_HMAC_KEY"];
      const logPath = join(tmpDir, "audit-flush.jsonl");
      const logger = await freshLogger(logPath);
      logger.log({ event: "flush-1" });
      logger.log({ event: "flush-2" });
      await logger.flush();

      const lines = (await readFile(logPath, "utf-8"))
        .trim()
        .split("\n");
      expect(lines.length).toBe(2);
    });
  });
});
