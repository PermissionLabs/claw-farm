import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { RuntimeType } from "../runtimes/interface.ts";
import { getRuntimePaths } from "../runtimes/paths.ts";

/**
 * Layer 0: Raw data collection — immutable, append-only.
 * Session logs and workspace snapshots are preserved here and never deleted.
 */

export async function ensureRawDirs(
  projectDir: string,
  runtimeType?: RuntimeType,
): Promise<void> {
  const rt = runtimeType ?? "openclaw";
  const paths = getRuntimePaths(rt);
  const mkdirs: Promise<string | undefined>[] = [
    mkdir(paths.sessions(projectDir), { recursive: true }),
    mkdir(join(projectDir, "raw", "workspace-snapshots"), { recursive: true }),
  ];
  if (rt === "openclaw") {
    mkdirs.push(mkdir(join(projectDir, "openclaw", "logs"), { recursive: true }));
  }
  await Promise.all(mkdirs);
}

export async function snapshotWorkspace(
  projectDir: string,
  runtimeType?: RuntimeType,
): Promise<string> {
  const rt = runtimeType ?? "openclaw";
  const paths = getRuntimePaths(rt);
  const wsDir = paths.workspace(projectDir);
  const snapDir = join(projectDir, "raw", "workspace-snapshots");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapPath = join(snapDir, timestamp);

  await mkdir(snapPath, { recursive: true });

  // Snapshot MEMORY.md and SOUL.md
  const memoryFile = paths.memory(wsDir);
  for (const { src, dest } of [
    { src: memoryFile, dest: "MEMORY.md" },
    { src: join(wsDir, "SOUL.md"), dest: "SOUL.md" },
  ]) {
    try {
      const content = await Bun.file(src).text();
      await Bun.write(join(snapPath, dest), content);
    } catch {
      // File doesn't exist yet — skip
    }
  }

  return snapPath;
}
