import { readdir, cp, rm } from "node:fs/promises";
import { mkdir } from "node:fs/promises";

/** Returns true if a file exists at the given path. */
export async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

/**
 * Copy a file from src to dest only if it exists.
 * No-ops silently if src does not exist.
 */
export async function copyIfExists(src: string, dest: string): Promise<void> {
  const file = Bun.file(src);
  if (!await file.exists()) return;
  await Bun.write(dest, await file.arrayBuffer());
}

/** Returns true if a directory exists at the given path. */
export async function dirExists(path: string): Promise<boolean> {
  try {
    await readdir(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively copy all children of srcDir into destDir.
 * Creates destDir if it does not exist.
 * No-op if srcDir does not exist.
 */
export async function copyDirContents(srcDir: string, destDir: string): Promise<void> {
  let files: string[];
  try {
    files = await readdir(srcDir);
  } catch {
    return; // srcDir does not exist
  }
  if (files.length === 0) return;
  await mkdir(destDir, { recursive: true });
  for (const file of files) {
    await cp(`${srcDir}/${file}`, `${destDir}/${file}`, { recursive: true });
  }
}

/**
 * Move a single file from src to dest (copy + delete).
 * No-op if src does not exist.
 */
export async function moveFile(src: string, dest: string): Promise<void> {
  const file = Bun.file(src);
  if (!await file.exists()) return;
  await Bun.write(dest, await file.arrayBuffer());
  await rm(src, { force: true });
}

/**
 * Move all children of srcDir into destDir (copy then delete sources).
 * No-op if srcDir does not exist or is empty.
 */
export async function moveDirContents(srcDir: string, destDir: string): Promise<void> {
  let files: string[];
  try {
    files = await readdir(srcDir);
  } catch {
    return; // srcDir does not exist
  }
  if (files.length === 0) return;
  await copyDirContents(srcDir, destDir);
  for (const file of files) {
    await rm(`${srcDir}/${file}`, { recursive: true, force: true });
  }
}

/**
 * Remove a directory if it is empty; otherwise no-op.
 * Also no-ops if the directory does not exist.
 */
export async function rmIfEmpty(dir: string): Promise<void> {
  try {
    const files = await readdir(dir);
    if (files.length === 0) await rm(dir, { recursive: true });
  } catch {
    // dir does not exist — no-op
  }
}
