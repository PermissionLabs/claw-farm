import { describe, it, expect } from "bun:test";
import { validateProcessorRuntimeCombo } from "../validate-config.ts";

describe("validateProcessorRuntimeCombo", () => {
  it("accepts builtin + openclaw", () => {
    expect(() => validateProcessorRuntimeCombo("builtin", "openclaw")).not.toThrow();
  });

  it("accepts builtin + picoclaw", () => {
    expect(() => validateProcessorRuntimeCombo("builtin", "picoclaw")).not.toThrow();
  });

  it("accepts mem0 + openclaw", () => {
    expect(() => validateProcessorRuntimeCombo("mem0", "openclaw")).not.toThrow();
  });

  it("rejects mem0 + picoclaw with a clear error", () => {
    expect(() => validateProcessorRuntimeCombo("mem0", "picoclaw")).toThrow(
      /Processor "mem0" does not support runtime "picoclaw"/,
    );
  });

  it("includes supported runtimes list in error message", () => {
    let msg = "";
    try {
      validateProcessorRuntimeCombo("mem0", "picoclaw");
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toContain("openclaw");
  });
});
