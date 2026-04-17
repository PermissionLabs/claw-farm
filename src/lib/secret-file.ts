import { writeFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Write a secret file atomically with 0o600 permissions.
 *
 * - Fresh create: uses writeFile with { mode: 0o600 } so the file is never
 *   world-readable even for a millisecond.
 * - Overwrite: writes to a sibling tempfile then renames so readers never see
 *   a partial write, and the permissions are set before the rename.
 */
export async function writeSecret(
  path: string,
  contents: string | Uint8Array,
): Promise<void> {
  const data =
    typeof contents === "string"
      ? new TextEncoder().encode(contents)
      : contents;

  // Check if target exists — if not, a direct create with mode=0o600 is atomic enough.
  let exists = false;
  try {
    await writeFile(path, data, { flag: "wx", mode: 0o600 });
    return; // created fresh
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      exists = true;
    } else {
      throw err;
    }
  }

  if (exists) {
    // Write to a tempfile in the same directory (same filesystem → rename is atomic)
    const tmp = join(dirname(path), `.tmp-${randomBytes(8).toString("hex")}`);
    try {
      await writeFile(tmp, data, { mode: 0o600 });
      await rename(tmp, path);
    } catch (err) {
      // Best-effort cleanup of tempfile
      try {
        await unlink(tmp);
      } catch {
        // ignore
      }
      throw err;
    }
  }
}
