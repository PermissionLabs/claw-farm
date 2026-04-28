import { join } from "node:path";
import { mkdir, rm, readdir } from "node:fs/promises";
import type { MemoryProcessor } from "./interface.ts";
import { getRuntimePaths } from "../runtimes/paths.ts";

/**
 * Builtin processor: uses OpenClaw's native MEMORY.md markdown format.
 * This is the default — no external dependencies required.
 */
export const builtinProcessor: MemoryProcessor = {
  name: "builtin",
  // Supports both runtimes explicitly; empty list would also work but explicit is clearer
  supportedRuntimes: ["openclaw", "picoclaw"],

  async init(projectDir: string) {
    await mkdir(join(projectDir, "processed"), { recursive: true });
  },

  async rebuild(projectDir: string, runtimeType: "openclaw" | "picoclaw" = "openclaw") {
    const processedDir = join(projectDir, "processed");

    // Clear processed directory
    await rm(processedDir, { recursive: true, force: true });
    await mkdir(processedDir, { recursive: true });

    // For builtin processor, MEMORY.md is managed directly by OpenClaw.
    // Rebuild simply creates a fresh MEMORY.md from the latest snapshot.
    const snapshotsDir = join(projectDir, "raw", "workspace-snapshots");
    try {
      const snapshots = await readdir(snapshotsDir);
      if (snapshots.length === 0) {
        console.log("  No snapshots found — nothing to rebuild");
        return;
      }
      const sorted = snapshots.sort();
      const latest = sorted[sorted.length - 1];
      if (!latest) throw new Error("Unreachable: snapshots non-empty but at(-1) returned undefined");
      const memoryContent = await Bun.file(
        join(snapshotsDir, latest, "MEMORY.md"),
      ).text();
      const paths = getRuntimePaths(runtimeType);
      const wsDir = paths.workspace(projectDir);
      const memoryPath = paths.memory(wsDir);
      await Bun.write(memoryPath, memoryContent);
      console.log(`  Rebuilt MEMORY.md from snapshot: ${latest}`);
    } catch {
      console.log("  No snapshots available — skipping rebuild");
    }
  },
};
