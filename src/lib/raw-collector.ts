import { join } from "node:path";
import { mkdir } from "node:fs/promises";

/**
 * Layer 0: Raw data collection — immutable, append-only.
 * Session logs and workspace snapshots are preserved here and never deleted.
 */

export async function ensureRawDirs(projectDir: string): Promise<void> {
  const rawBase = join(projectDir, "openclaw", "raw");
  await mkdir(join(rawBase, "sessions"), { recursive: true });
  await mkdir(join(rawBase, "workspace-snapshots"), { recursive: true });
}

export async function snapshotWorkspace(projectDir: string): Promise<string> {
  const wsDir = join(projectDir, "openclaw", "workspace");
  const snapDir = join(projectDir, "openclaw", "raw", "workspace-snapshots");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapPath = join(snapDir, timestamp);

  await mkdir(snapPath, { recursive: true });

  // Snapshot MEMORY.md and SOUL.md
  for (const file of ["MEMORY.md", "SOUL.md"]) {
    try {
      const content = await Bun.file(join(wsDir, file)).text();
      await Bun.write(join(snapPath, file), content);
    } catch {
      // File doesn't exist yet — skip
    }
  }

  return snapPath;
}
