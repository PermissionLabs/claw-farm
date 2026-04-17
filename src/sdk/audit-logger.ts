// JSONL audit logger — standalone factory + middleware factory
// BKLG-007: rotation (10MB × 5), rolling HMAC chain, 0o600 file permissions, flush()

import { appendFile, rename, stat, chmod, mkdir } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { dirname } from "node:path";
import type {
  Finding,
  ProxyContext,
  ProxyResponse,
  RequestMiddleware,
} from "./types.ts";
import { STATE_KEYS } from "./utils.ts";

export interface AuditLoggerOptions {
  path: string;
  /** Max file size in bytes before rotation. Default: 10 MB. */
  maxSizeBytes?: number;
  /** Max number of rotated files to keep. Default: 5. */
  maxFiles?: number;
  logger?: { error: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}

export interface AuditLogger {
  log: (entry: Record<string, unknown>) => void;
  flush: () => Promise<void>;
}

/** One-time warning flag: avoid spamming stderr on every log call. */
let _hmacKeyMissingWarned = false;

/**
 * Rotate log files: path.1 → path.2, …, path → path.1.
 * Rotates up to maxFiles backups.
 */
async function rotateLogs(logPath: string, maxFiles: number): Promise<void> {
  // Shift existing backups: .4 deleted, .3→.4, .2→.3, .1→.2
  for (let i = maxFiles - 1; i >= 1; i--) {
    const from = `${logPath}.${i}`;
    const to = `${logPath}.${i + 1}`;
    try {
      await rename(from, to);
    } catch {
      // intentional: best-effort rotation — file may not exist
    }
  }
  // Rename current log to .1
  try {
    await rename(logPath, `${logPath}.1`);
  } catch {
    // intentional: best-effort rotation — current log may not exist yet
  }
}

/**
 * Ensure the log file exists with 0o600 permissions (creates parent dir at 0o700 if needed).
 */
async function ensureLogFile(logPath: string): Promise<void> {
  const dir = dirname(logPath);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // Touch the file if it doesn't exist yet; set mode 0o600
  try {
    await appendFile(logPath, "", { mode: 0o600 });
    await chmod(logPath, 0o600);
  } catch {
    // intentional: best-effort permission set
  }
}

/**
 * Get current file size in bytes; returns 0 if file doesn't exist.
 */
async function getFileSize(logPath: string): Promise<number> {
  try {
    const s = await stat(logPath);
    return s.size;
  } catch {
    return 0;
  }
}

/**
 * Create an audit logger that writes JSONL to the specified path.
 *
 * Features (BKLG-007):
 * - Size-based rotation: when file exceeds maxSizeBytes, rotates to .1 … .maxFiles
 * - Rolling HMAC chain: each entry includes hmac field (HMAC-SHA256 over prev_hmac + line)
 *   Key read from env AUDIT_LOG_HMAC_KEY; if absent a one-time warning is emitted.
 * - File permissions: 0o600, parent dir 0o700
 * - flush(): resolves after all pending writes have landed
 *
 * Fire-and-forget writes: never throws, logs errors via optional logger.
 */
export function createAuditLogger(options: AuditLoggerOptions): AuditLogger {
  if (!options.path) {
    throw new Error("auditLogger: path is required");
  }

  const maxSizeBytes = options.maxSizeBytes ?? 10 * 1024 * 1024; // 10 MB
  const maxFiles = options.maxFiles ?? 5;
  const logPath = options.path;

  // HMAC key from environment
  const hmacKey = process.env["AUDIT_LOG_HMAC_KEY"] ?? "";
  if (!hmacKey && !_hmacKeyMissingWarned) {
    _hmacKeyMissingWarned = true;
    process.stderr.write(
      "[audit-logger] WARNING: AUDIT_LOG_HMAC_KEY is not set — HMAC integrity chain is disabled\n",
    );
  }

  // Rolling HMAC state: previous hmac hex (or empty string for first entry)
  let prevHmac = "";

  // Serialized write queue — ensures ordering and prevents concurrent rotation
  let queue: Promise<void> = Promise.resolve();

  function enqueue(task: () => Promise<void>): Promise<void> {
    queue = queue.then(task).catch(() => {
      // intentional: queue errors are surfaced inside task via options.logger
    });
    return queue;
  }

  async function writeEntry(entry: Record<string, unknown>): Promise<void> {
    try {
      await ensureLogFile(logPath);

      // Rotate if needed
      const size = await getFileSize(logPath);
      if (size >= maxSizeBytes) {
        await rotateLogs(logPath, maxFiles);
        await ensureLogFile(logPath);
        // Reset HMAC chain after rotation so the new file starts fresh
        prevHmac = "";
      }

      // Build the base line (without hmac field)
      const baseEntry = { ...entry, timestamp: new Date().toISOString() };
      const baseJson = JSON.stringify(baseEntry);

      // Compute HMAC if key is available
      let line: string;
      if (hmacKey) {
        const mac = createHmac("sha256", hmacKey)
          .update(prevHmac + baseJson)
          .digest("hex");
        prevHmac = mac;
        // Insert hmac into the final JSON
        const entryWithHmac = { ...baseEntry, hmac: mac };
        line = JSON.stringify(entryWithHmac) + "\n";
      } else {
        line = baseJson + "\n";
      }

      await appendFile(logPath, line, { encoding: "utf-8", mode: 0o600 });
    } catch (err) {
      options.logger?.error("Failed to write audit log", err);
    }
  }

  return {
    log(entry: Record<string, unknown>): void {
      enqueue(() => writeEntry(entry));
    },

    async flush(): Promise<void> {
      // Wait for all currently-queued writes to complete
      await queue;
    },
  };
}

/**
 * Create a middleware that logs request/response metadata as JSONL.
 */
export function auditLogger(options: AuditLoggerOptions): RequestMiddleware {
  const logger = createAuditLogger(options);

  return async (ctx: ProxyContext, next: () => Promise<ProxyResponse>) => {
    const start = performance.now();

    const response = await next();

    const elapsedMs = Math.round(performance.now() - start);
    const piiFindings = ctx.state.get(STATE_KEYS.PII_FINDINGS) as Finding[] | undefined;
    const contentHash = ctx.state.get(STATE_KEYS.CONTENT_HASH) as string | undefined;

    logger.log({
      event: "request",
      method: ctx.method,
      path: ctx.path,
      source_ip: ctx.sourceIp,
      content_hash: contentHash,
      request_size: ctx.body.length,
      response_status: response.status,
      response_size: response.body.length,
      elapsed_ms: elapsedMs,
      pii_redacted: piiFindings != null && piiFindings.length > 0,
    });

    return response;
  };
}
