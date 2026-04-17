import { describe, it, expect } from "bun:test";
import { emitPythonSecretPatterns } from "../patterns/python-emitter.ts";
import { defaultSecretPatterns } from "../secret-scanner.ts";
import type { SecretPatternGroup } from "../types.ts";

describe("emitPythonSecretPatterns", () => {
  it("produces a non-empty string for defaultSecretPatterns", () => {
    const out = emitPythonSecretPatterns(defaultSecretPatterns);
    expect(out.length).toBeGreaterThan(0);
  });

  it("each line is a valid Python tuple entry with re.compile", () => {
    const out = emitPythonSecretPatterns(defaultSecretPatterns);
    for (const line of out.split("\n").filter(Boolean)) {
      expect(line.trim()).toMatch(/^\(re\.compile\(r".+"(, re\.[A-Z|]+)?\), "[A-Z0-9_]+"\),$/);

    }
  });

  it("includes every pattern name from defaultSecretPatterns", () => {
    const out = emitPythonSecretPatterns(defaultSecretPatterns);
    for (const group of defaultSecretPatterns) {
      for (const p of group.patterns) {
        expect(out).toContain(`"${p.name}"`);
      }
    }
  });

  it("emits IGNORECASE flag for case-insensitive patterns", () => {
    const groups: SecretPatternGroup[] = [
      {
        name: "test",
        patterns: [
          { name: "CASE_TEST", regex: /secret=[A-Za-z0-9]{32}/gi, replacement: "[REDACTED]" },
        ],
      },
    ];
    const out = emitPythonSecretPatterns(groups);
    expect(out).toContain("re.IGNORECASE");
  });

  it("does not emit re.IGNORECASE for case-sensitive patterns", () => {
    const groups: SecretPatternGroup[] = [
      {
        name: "test",
        patterns: [
          { name: "EXACT", regex: /AKIA[0-9A-Z]{16}/g, replacement: "[REDACTED]" },
        ],
      },
    ];
    const out = emitPythonSecretPatterns(groups);
    expect(out).not.toContain("re.IGNORECASE");
  });

  it("snapshot: stable output for a minimal pattern set", () => {
    const groups: SecretPatternGroup[] = [
      {
        name: "keys",
        patterns: [
          { name: "GOOGLE_API_KEY", regex: /AIza[0-9A-Za-z_-]{35}/g, replacement: "[REDACTED_GOOGLE_API_KEY]" },
        ],
      },
    ];
    const out = emitPythonSecretPatterns(groups);
    expect(out).toBe(`    (re.compile(r"AIza[0-9A-Za-z_-]{35}"), "GOOGLE_API_KEY"),`);
  });

  it("includes AWS STS patterns", () => {
    const out = emitPythonSecretPatterns(defaultSecretPatterns);
    expect(out).toContain("AWS_STS_TOKEN");
    expect(out).toContain("AWS_SESSION_TOKEN");
  });

  it("returns empty string for empty groups", () => {
    expect(emitPythonSecretPatterns([])).toBe("");
  });

  it("handles groups with no patterns", () => {
    const groups: SecretPatternGroup[] = [{ name: "empty", patterns: [] }];
    expect(emitPythonSecretPatterns(groups)).toBe("");
  });
});
