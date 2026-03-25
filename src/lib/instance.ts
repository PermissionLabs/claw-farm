import { join, resolve, sep } from "node:path";
import { mkdir } from "node:fs/promises";
import { validateName } from "./registry.ts";

/**
 * Instance directory helpers for multi-instance projects.
 * Manages per-user instance directories under instances/<userId>/
 */

/** Resolve instance directory with path traversal protection. */
export function instanceDir(projectDir: string, userId: string): string {
  const instancesBase = resolve(projectDir, "instances");
  const resolved = resolve(instancesBase, userId);
  if (!resolved.startsWith(instancesBase + sep)) {
    throw new Error(`Invalid userId: path traversal detected ("${userId}")`);
  }
  return resolved;
}

export function templateDir(projectDir: string): string {
  return join(projectDir, "template");
}

export async function ensureInstanceDirs(
  projectDir: string,
  userId: string,
): Promise<string> {
  validateName(userId, "user ID");
  const instDir = instanceDir(projectDir, userId);
  // Container mount directory (openclaw/ = /home/node/.openclaw)
  await mkdir(join(instDir, "openclaw", "workspace", "memory"), { recursive: true, mode: 0o700 });
  await mkdir(join(instDir, "openclaw", "sessions"), { recursive: true, mode: 0o700 });
  await mkdir(join(instDir, "openclaw", "logs"), { recursive: true, mode: 0o700 });
  // Memory pipeline directories (not in container)
  await mkdir(join(instDir, "raw", "workspace-snapshots"), { recursive: true, mode: 0o700 });
  await mkdir(join(instDir, "processed"), { recursive: true, mode: 0o700 });
  return instDir;
}

export async function ensureTemplateDirs(projectDir: string): Promise<void> {
  const tmplDir = templateDir(projectDir);
  await mkdir(join(tmplDir, "skills"), { recursive: true });
  await mkdir(join(tmplDir, "config"), { recursive: true });
}
