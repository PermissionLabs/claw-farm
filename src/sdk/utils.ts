// Shared utilities for SDK security modules

import type { Finding } from "./types.ts";

/** Pattern group compatible with both PII and secret patterns */
interface PatternGroup {
  name: string;
  patterns: { name: string; regex: RegExp; replacement: string }[];
}

/** State keys for middleware inter-communication via ProxyContext.state */
export const STATE_KEYS = {
  PII_FINDINGS: "piiFindings",
  CONTENT_HASH: "contentHash",
} as const;

/**
 * Zero-width and direction-override code points stripped before matching
 * to prevent evasion via invisible Unicode characters.
 */
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\uFEFF\u202E]/g;

/**
 * Normalize text for pattern matching.
 *
 * 1. NFKC compatibility decomposition + canonical composition:
 *    fullwidth digits (０-９ → 0-9), fullwidth hyphens (－ → -),
 *    Arabic-Indic digits (٠-٩ → 0-9), Devanagari digits, etc.
 * 2. Strip zero-width joiners/non-joiners/spaces, BOM, RTL override.
 *
 * The result is used for scanning only. Because all our replacement tokens
 * are ASCII strings (e.g. "[REDACTED_EMAIL]"), operating on the normalized
 * copy for both matching and replacement is correct and avoids the
 * complexity of mapping normalized offsets back to the original string.
 */
export function normalizeForScan(text: string): string {
  return text.normalize("NFKC").replace(ZERO_WIDTH_RE, "");
}

/**
 * Apply pattern groups to text in a single pass per pattern.
 *
 * Both the original text and the NFKC-normalized copy are scanned.
 * Replacements from the normalized copy are unioned with those from the
 * original: each pattern first replaces on the original (for ASCII input),
 * then the same regex runs on the normalized version of the working string
 * to catch any remaining fullwidth/Arabic-Indic variants.
 *
 * This "double-pass" per pattern is intentional: after the first pass
 * reduces ASCII hits, the second pass on the normalized remainder catches
 * Unicode-encoded equivalents. The overhead is one extra regex per pattern
 * group entry, negligible for typical prompt sizes.
 */
export function applyPatterns(
  text: string,
  groups: PatternGroup[],
): { text: string; findings: Finding[] } {
  const findings: Finding[] = [];
  let result = text;

  for (const group of groups) {
    for (const { name, regex, replacement } of group.patterns) {
      let count = 0;

      // Pass 1: match on the current (possibly partially-replaced) string
      regex.lastIndex = 0;
      result = result.replace(regex, () => {
        count++;
        return replacement;
      });

      // Pass 2: normalize and match again to catch Unicode evasion variants
      // (fullwidth digits, Arabic-Indic, zero-width chars, RTL override).
      // Only runs if the normalized form differs from the current string.
      const norm = normalizeForScan(result);
      if (norm !== result) {
        regex.lastIndex = 0;
        let normCount = 0;
        const normResult = norm.replace(regex, () => {
          normCount++;
          return replacement;
        });
        if (normCount > 0) {
          count += normCount;
          result = normResult;
        }
      }

      if (count > 0) {
        findings.push({ type: name, count });
      }
    }
  }

  return { text: result, findings };
}

/**
 * Recursively walk a JSON-parsed value, transforming all strings via callback.
 * Returns the transformed structure and accumulated findings.
 */
export function walkJson(
  obj: unknown,
  processor: (text: string) => { text: string; findings: Finding[] },
): { data: unknown; findings: Finding[] } {
  const allFindings: Finding[] = [];

  function walk(value: unknown): unknown {
    if (typeof value === "string") {
      const { text, findings } = processor(value);
      allFindings.push(...findings);
      return text;
    }
    if (Array.isArray(value)) {
      return value.map(walk);
    }
    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
        result[k] = walk(v);
      }
      return result;
    }
    return value;
  }

  return { data: walk(obj), findings: allFindings };
}
