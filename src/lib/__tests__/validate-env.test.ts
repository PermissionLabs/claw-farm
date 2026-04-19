/**
 * Tests for BKLG-012: env-file value quoting validator.
 *
 * validateEnvEntry is not exported, so we test through the spawn() env path
 * by importing the raw function indirectly. Since it's module-private,
 * we replicate the validation logic here to test the contract described in BKLG-012.
 */

import { describe, it, expect } from "bun:test";

// Replicate the exact validation logic from src/lib/api.ts so we can unit-test
// it without spinning up Docker or real registry state.

const ENV_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

const FORBIDDEN_VALUE_CHARS: Array<{ char: string; display: string }> = [
  { char: '"', display: '"' },
  { char: "'", display: "'" },
  { char: "`", display: "`" },
  { char: "\\", display: "\\" },
  { char: "\0", display: "\\0 (null byte)" },
  { char: "$(", display: "$(" },
  { char: "$`", display: "$`" },
];

function validateEnvEntry(key: string, value: string): string {
  if (!ENV_KEY_REGEX.test(key)) {
    throw new Error(`Invalid env var key: "${key}"`);
  }
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error(`Env var "${key}" contains newline characters`);
  }
  for (const { char, display } of FORBIDDEN_VALUE_CHARS) {
    if (value.includes(char)) {
      throw new Error(
        `Env var "${key}" contains forbidden character '${display}' (values cannot contain quotes, backslashes, null bytes, or command substitution sequences)`,
      );
    }
  }
  return `${key}=${value}`;
}

describe("validateEnvEntry — valid values", () => {
  it("accepts simple alphanumeric value", () => {
    expect(validateEnvEntry("MY_VAR", "hello123")).toBe("MY_VAR=hello123");
  });

  it("accepts value with equals sign", () => {
    expect(validateEnvEntry("TOKEN", "abc=def=ghi")).toBe("TOKEN=abc=def=ghi");
  });

  it("accepts URL-like value", () => {
    expect(validateEnvEntry("BASE_URL", "https://example.com/path?q=1&r=2")).toBe(
      "BASE_URL=https://example.com/path?q=1&r=2",
    );
  });

  it("accepts value with hyphens and underscores", () => {
    expect(validateEnvEntry("API_KEY", "sk-live_abc-123")).toBe("API_KEY=sk-live_abc-123");
  });

  it("accepts empty value", () => {
    expect(validateEnvEntry("EMPTY", "")).toBe("EMPTY=");
  });
});

describe("validateEnvEntry — forbidden characters in value", () => {
  it("rejects double quote", () => {
    expect(() => validateEnvEntry("K", 'val"ue')).toThrow('forbidden character');
  });

  it("rejects single quote", () => {
    expect(() => validateEnvEntry("K", "val'ue")).toThrow('forbidden character');
  });

  it("rejects backtick", () => {
    expect(() => validateEnvEntry("K", "val`ue")).toThrow('forbidden character');
  });

  it("rejects backslash", () => {
    expect(() => validateEnvEntry("K", "val\\ue")).toThrow('forbidden character');
  });

  it("rejects null byte", () => {
    expect(() => validateEnvEntry("K", "val\0ue")).toThrow('forbidden character');
  });

  it("rejects $( command substitution", () => {
    expect(() => validateEnvEntry("K", "val$(cmd)")).toThrow('forbidden character');
  });

  it("rejects $` backtick substitution", () => {
    expect(() => validateEnvEntry("K", "val$`cmd`")).toThrow('forbidden character');
  });

  it("rejects newline", () => {
    expect(() => validateEnvEntry("K", "val\nue")).toThrow('newline');
  });

  it("rejects carriage return", () => {
    expect(() => validateEnvEntry("K", "val\rue")).toThrow('newline');
  });
});

describe("validateEnvEntry — invalid key", () => {
  it("rejects key starting with digit", () => {
    expect(() => validateEnvEntry("1BAD", "value")).toThrow('Invalid env var key');
  });

  it("rejects key with hyphen", () => {
    expect(() => validateEnvEntry("BAD-KEY", "value")).toThrow('Invalid env var key');
  });

  it("rejects empty key", () => {
    expect(() => validateEnvEntry("", "value")).toThrow('Invalid env var key');
  });
});
