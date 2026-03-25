import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { MemoryProcessor } from "./interface.ts";

/**
 * Builtin processor: uses OpenClaw's native MEMORY.md markdown format.
 * This is the default — no external dependencies required.
 */
export const builtinProcessor: MemoryProcessor = {
  name: "builtin",

  async init(projectDir: string) {
    await mkdir(join(projectDir, "processed"), { recursive: true });
  },

  async rebuild(projectDir: string) {
    const processedDir = join(projectDir, "processed");

    // Clear processed directory
    const { rm } = await import("node:fs/promises");
    await rm(processedDir, { recursive: true, force: true });
    await mkdir(processedDir, { recursive: true });

    // For builtin processor, MEMORY.md is managed directly by OpenClaw.
    // Rebuild simply creates a fresh MEMORY.md from the latest snapshot.
    const snapshotsDir = join(projectDir, "raw", "workspace-snapshots");
    try {
      const { readdir } = await import("node:fs/promises");
      const snapshots = await readdir(snapshotsDir);
      if (snapshots.length === 0) {
        console.log("  No snapshots found — nothing to rebuild");
        return;
      }
      const latest = snapshots.sort().at(-1)!;
      const memoryContent = await Bun.file(
        join(snapshotsDir, latest, "MEMORY.md"),
      ).text();
      await Bun.write(
        join(projectDir, "openclaw", "workspace", "MEMORY.md"),
        memoryContent,
      );
      console.log(`  Rebuilt MEMORY.md from snapshot: ${latest}`);
    } catch {
      console.log("  No snapshots available — skipping rebuild");
    }
  },
};
