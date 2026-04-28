import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

// withLock uses REGISTRY_DIR based on homedir — we patch the lock path via
// a temp dir by monkey-patching the module. Since Bun doesn't support jest.mock,
// we test withLock by importing it and relying on the real lock path but using
// a unique test process environment.

// Instead, we test the locking logic directly by importing withLock and verifying
// acquire/release semantics through observable side effects.

import { withLock } from "../registry.ts";

describe("withLock", () => {
  it("runs the callback and returns its result", async () => {
    const result = await withLock(async () => 42);
    expect(result).toBe(42);
  });

  it("releases the lock after the callback completes", async () => {
    await withLock(async () => "first");
    // If lock was not released, this would hang/timeout
    const result = await withLock(async () => "second");
    expect(result).toBe("second");
  });

  it("releases the lock even when the callback throws", async () => {
    await expect(
      withLock(async () => {
        throw new Error("callback error");
      }),
    ).rejects.toThrow("callback error");

    // Lock must be released — next acquire should succeed
    const result = await withLock(async () => "after error");
    expect(result).toBe("after error");
  });

  it("serializes concurrent lock requests", async () => {
    const order: number[] = [];

    // Start two locks concurrently — they must execute serially
    const [, ] = await Promise.all([
      withLock(async () => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 20));
        order.push(2);
      }),
      withLock(async () => {
        order.push(3);
      }),
    ]);

    // First lock must complete (1,2) before second runs (3)
    expect(order).toEqual([1, 2, 3]);
  });
});

describe("withLock stale lock cleanup", () => {
  // This test creates a stale lock file with a dead PID to verify cleanup
  it("cleans up a stale lock with a dead PID and proceeds", async () => {
    const { homedir } = await import("node:os");
    const lockPath = join(homedir(), ".claw-farm", "registry.lock");

    // Write a lock file with a definitely-dead PID (PID 1 is init/systemd,
    // but we can't kill it; instead use a large fake PID unlikely to exist)
    const deadPid = 9999999; // unlikely to be a real process
    const lockDir = join(homedir(), ".claw-farm");
    await mkdir(lockDir, { recursive: true });

    // Set mtime to 31 seconds ago by writing then backdating
    await writeFile(lockPath, String(deadPid), { flag: "w", mode: 0o600 });
    // Backdate mtime by 31s using utimes
    const { utimes } = await import("node:fs/promises");
    const past = new Date(Date.now() - 31_000);
    await utimes(lockPath, past, past);

    // withLock should detect stale lock (dead PID + old mtime) and clean it up
    const result = await withLock(async () => "after stale");
    expect(result).toBe("after stale");
  });

  // BKLG-037: monotonic stale detection — structured lock content with startTime
  it("cleans up a stale structured lock (monotonic) with a dead PID and proceeds", async () => {
    const { homedir } = await import("node:os");
    const lockPath = join(homedir(), ".claw-farm", "registry.lock");
    const lockDir = join(homedir(), ".claw-farm");
    await mkdir(lockDir, { recursive: true });

    const deadPid = 9999999;
    // Write structured lock content with a startTime that looks 40 seconds old
    // (Bun.nanoseconds() - 40s in ns). We can't easily manipulate Bun.nanoseconds()
    // so we set mtime-based staleness via utimes as the fallback path.
    const staleLock = JSON.stringify({ pid: deadPid, startTime: 0 }); // startTime=0 → very old
    await writeFile(lockPath, staleLock, { flag: "w", mode: 0o600 });

    // Backdate mtime to trigger fallback stale path too
    const { utimes } = await import("node:fs/promises");
    const past = new Date(Date.now() - 31_000);
    await utimes(lockPath, past, past);

    // withLock must reclaim the stale lock and run the callback
    const result = await withLock(async () => "after monotonic stale");
    expect(result).toBe("after monotonic stale");
  });
});
