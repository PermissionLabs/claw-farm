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
 * Apply pattern groups to text in a single pass per pattern.
 * Uses replace callback to count matches without double-scanning.
 */
export function applyPatterns(
  text: string,
  groups: PatternGroup[],
): { text: string; findings: Finding[] } {
  const findings: Finding[] = [];
  let result = text;

  for (const group of groups) {
    for (const { name, regex, replacement } of group.patterns) {
      regex.lastIndex = 0;
      let count = 0;
      result = result.replace(regex, () => {
        count++;
        return replacement;
      });
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
        result[k] = walk(v);
      }
      return result;
    }
    return value;
  }

  return { data: walk(obj), findings: allFindings };
}
