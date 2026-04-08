import type { PiiPatternGroup } from "../types.ts";

export const koreanPatterns: PiiPatternGroup = {
  name: "korean",
  patterns: [
    { name: "KR_RRN", regex: /\d{6}-[1-4]\d{6}/g, replacement: "[REDACTED_KR_RRN]" },
    { name: "KR_PHONE", regex: /01[016789]-\d{3,4}-\d{4}/g, replacement: "[REDACTED_KR_PHONE]" },
    { name: "KR_PHONE_ALT", regex: /01[016789][\s.]\d{3,4}[\s.]\d{4}/g, replacement: "[REDACTED_KR_PHONE]" },
    { name: "KR_PHONE_NOHYPHEN", regex: /\b01[016789]\d{7,8}\b/g, replacement: "[REDACTED_KR_PHONE]" },
    { name: "KR_LANDLINE", regex: /0[2-6][0-9]-\d{3,4}-\d{4}/g, replacement: "[REDACTED_KR_LANDLINE]" },
    { name: "KR_BIZ_REG", regex: /\d{3}-\d{2}-\d{5}/g, replacement: "[REDACTED_KR_BIZ_REG]" },
    { name: "KR_PASSPORT", regex: /\b[A-Z][0-9]{8}\b/g, replacement: "[REDACTED_KR_PASSPORT]" },
    { name: "KR_DRIVER_LICENSE", regex: /\d{2}-\d{2}-\d{6}-\d{2}/g, replacement: "[REDACTED_KR_DRIVER_LICENSE]" },
  ],
};
