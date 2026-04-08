import type { PiiPatternGroup } from "../types.ts";

export const financialPatterns: PiiPatternGroup = {
  name: "financial",
  patterns: [
    {
      name: "CREDIT_CARD",
      regex: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
      replacement: "[REDACTED_CREDIT_CARD]",
    },
    {
      name: "CARD_FORMATTED",
      regex: /\b\d{3,4}-\d{4}-\d{4}-\d{4}\b/g,
      replacement: "[REDACTED_CARD_FORMATTED]",
    },
  ],
};
