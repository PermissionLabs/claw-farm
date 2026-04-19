/**
 * Error utility helpers for claw-farm.
 *
 * BKLG-006: typed ENOENT guard replaces silent catch {} at "source may not exist" sites.
 */

/**
 * Returns true when `err` represents a missing file or directory (ENOENT / ENOTDIR).
 * Use this to guard catches that should only swallow "not found" errors:
 *
 *   } catch (err) {
 *     if (!isNotFoundError(err)) throw err;
 *   }
 */
export function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "ENOENT" || code === "ENOTDIR";
}
