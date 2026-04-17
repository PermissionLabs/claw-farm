import { describe, it, expect } from "bun:test";
import { CliError, parseEnumFlag, parseFlag, hasFlag } from "../cli-parser.ts";

const RUNTIMES = ["openclaw", "picoclaw"] as const;
const PROCESSORS = ["builtin", "mem0"] as const;

describe("parseEnumFlag", () => {
  it("returns default when flag absent", () => {
    expect(parseEnumFlag(["init", "myproject"], "--runtime", RUNTIMES, "openclaw")).toBe("openclaw");
  });

  it("returns valid value when flag present", () => {
    expect(parseEnumFlag(["--runtime", "picoclaw"], "--runtime", RUNTIMES, "openclaw")).toBe("picoclaw");
  });

  it("throws CliError when value is invalid", () => {
    expect(() =>
      parseEnumFlag(["--runtime", "badruntime"], "--runtime", RUNTIMES, "openclaw"),
    ).toThrow(CliError);
  });

  it("throws CliError when value is another flag", () => {
    expect(() =>
      parseEnumFlag(["--runtime", "--processor"], "--runtime", RUNTIMES, "openclaw"),
    ).toThrow(CliError);
  });

  it("throws CliError when flag present but no value (end of args)", () => {
    expect(() =>
      parseEnumFlag(["--runtime"], "--runtime", RUNTIMES, "openclaw"),
    ).toThrow(CliError);
  });

  it("CliError message mentions the flag name", () => {
    try {
      parseEnumFlag(["--processor", "bad"], "--processor", PROCESSORS, "builtin");
      throw new Error("should not reach");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).message).toContain("--processor");
    }
  });

  it("accepts any value in allowed list", () => {
    for (const v of RUNTIMES) {
      expect(parseEnumFlag(["--runtime", v], "--runtime", RUNTIMES, "openclaw")).toBe(v);
    }
  });
});

describe("parseFlag", () => {
  it("returns undefined when flag absent", () => {
    expect(parseFlag(["init", "myproject"], "--llm")).toBeUndefined();
  });

  it("returns value when flag present", () => {
    expect(parseFlag(["--llm", "anthropic"], "--llm")).toBe("anthropic");
  });

  it("returns undefined when next token is another flag", () => {
    expect(parseFlag(["--llm", "--runtime"], "--llm")).toBeUndefined();
  });

  it("returns undefined when flag is last token", () => {
    expect(parseFlag(["--llm"], "--llm")).toBeUndefined();
  });
});

describe("hasFlag", () => {
  it("returns true when flag present", () => {
    expect(hasFlag(["init", "foo", "--multi"], "--multi")).toBe(true);
  });

  it("returns false when flag absent", () => {
    expect(hasFlag(["init", "foo"], "--multi")).toBe(false);
  });

  it("returns false for empty args", () => {
    expect(hasFlag([], "--existing")).toBe(false);
  });
});
