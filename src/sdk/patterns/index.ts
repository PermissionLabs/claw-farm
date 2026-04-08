import type { PiiPatternGroup } from "../types.ts";
import { koreanPatterns } from "./korean.ts";
import { usPatterns } from "./us.ts";
import { financialPatterns } from "./financial.ts";

export { koreanPatterns } from "./korean.ts";
export { usPatterns } from "./us.ts";
export { financialPatterns } from "./financial.ts";

export const universalPatterns: PiiPatternGroup = {
  name: "universal",
  patterns: [
    {
      name: "EMAIL",
      regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
      replacement: "[REDACTED_EMAIL]",
    },
  ],
};

export const defaultPatterns: PiiPatternGroup[] = [
  koreanPatterns,
  usPatterns,
  financialPatterns,
  universalPatterns,
];
