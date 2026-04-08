import type { PiiPatternGroup } from "../types.ts";

export const usPatterns: PiiPatternGroup = {
  name: "us",
  patterns: [
    { name: "US_SSN", regex: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[REDACTED_US_SSN]" },
    { name: "US_PHONE", regex: /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g, replacement: "[REDACTED_US_PHONE]" },
  ],
};
