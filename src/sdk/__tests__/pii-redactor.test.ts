import { describe, it, expect } from "bun:test";
import { redactPii } from "../pii-redactor.ts";

describe("redactPii — ASCII baseline", () => {
  it("redacts Korean RRN (주민등록번호)", () => {
    const { text, findings } = redactPii("id: 910101-1234567");
    expect(findings.some((f) => f.type === "KR_RRN")).toBe(true);
    expect(text).not.toMatch(/910101-1234567/);
  });

  it("redacts US SSN", () => {
    const { text, findings } = redactPii("SSN: 123-45-6789");
    expect(findings.some((f) => f.type === "US_SSN")).toBe(true);
    expect(text).not.toMatch(/123-45-6789/);
  });

  it("redacts US phone", () => {
    const { text, findings } = redactPii("call 555-123-4567 now");
    expect(findings.some((f) => f.type === "US_PHONE")).toBe(true);
    expect(text).not.toMatch(/555-123-4567/);
  });

  it("redacts email address", () => {
    const { text, findings } = redactPii("reach me at user@example.com please");
    expect(findings.some((f) => f.type === "EMAIL")).toBe(true);
    expect(text).not.toMatch(/user@example\.com/);
  });

  it("returns no findings for clean text", () => {
    const { findings } = redactPii("hello world, nothing sensitive here");
    expect(findings).toHaveLength(0);
  });
});

describe("redactPii — NFKC Unicode normalization (BKLG-002)", () => {
  it("redacts Korean RRN with fullwidth digits (９１０１０１－１２３４５６７)", () => {
    // Fullwidth digits 0-9 are U+FF10..U+FF19; fullwidth hyphen is U+FF0D
    const rrn = "\uFF19\uFF11\uFF10\uFF11\uFF10\uFF11\uFF0D\uFF11\uFF12\uFF13\uFF14\uFF15\uFF16\uFF17";
    const { text, findings } = redactPii(`id: ${rrn}`);
    expect(findings.some((f) => f.type === "KR_RRN")).toBe(true);
    // The output should not contain the original fullwidth digit sequence
    expect(text).not.toContain(rrn);
  });

  it("redacts US phone with fullwidth digits (５５５－１２３－４５６７)", () => {
    // Fullwidth digits U+FF10-U+FF19 and fullwidth hyphen U+FF0D DO normalize
    // to ASCII equivalents via NFKC in all JS engines (V8, JavaScriptCore, SpiderMonkey).
    // Arabic-Indic digits (U+0660-U+0669) are NOT NFKC-equivalent to ASCII digits
    // per Unicode — that is a known V8/Bun behavior, not a bug in our implementation.
    // 5=\uFF15, 1=\uFF11, 2=\uFF12, 3=\uFF13, 4=\uFF14, 6=\uFF16, 7=\uFF17, hyphen=\uFF0D
    const phone = "\uFF15\uFF15\uFF15\uFF0D\uFF11\uFF12\uFF13\uFF0D\uFF14\uFF15\uFF16\uFF17";
    const { text, findings } = redactPii(`call ${phone} please`);
    expect(findings.some((f) => f.type === "US_PHONE")).toBe(true);
    expect(text).not.toContain(phone);
  });

  it("redacts email with zero-width space inserted (a@b\\u200B.com)", () => {
    const email = "a@b\u200B.com";
    const { text, findings } = redactPii(`contact: ${email}`);
    expect(findings.some((f) => f.type === "EMAIL")).toBe(true);
    expect(text).not.toContain(email);
  });

  it("redacts SSN with RTL-override character embedded", () => {
    // RTL override U+202E injected in the middle
    const ssn = "123\u202E-45-6789";
    const { text, findings } = redactPii(`SSN is ${ssn}`);
    expect(findings.some((f) => f.type === "US_SSN")).toBe(true);
    expect(text).not.toContain(ssn);
  });

  it("redacts RRN with zero-width non-joiner between digits", () => {
    // ZWNJ (U+200C) inserted between groups
    const rrn = "910101\u200C-\u200C1234567";
    const { text, findings } = redactPii(`id: ${rrn}`);
    expect(findings.some((f) => f.type === "KR_RRN")).toBe(true);
    expect(text).not.toContain(rrn);
  });
});
