import { describe, it, expect } from "bun:test";
import { isNotFoundError } from "../errors.ts";

describe("isNotFoundError", () => {
  it("returns true for ENOENT error objects", () => {
    const err = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
    expect(isNotFoundError(err)).toBe(true);
  });

  it("returns true for ENOTDIR error objects", () => {
    const err = Object.assign(new Error("ENOTDIR: not a directory"), { code: "ENOTDIR" });
    expect(isNotFoundError(err)).toBe(true);
  });

  it("returns false for null", () => {
    expect(isNotFoundError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isNotFoundError(undefined)).toBe(false);
  });

  it("returns false for a plain string", () => {
    expect(isNotFoundError("ENOENT")).toBe(false);
  });

  it("returns false for a plain object without code", () => {
    expect(isNotFoundError({ message: "ENOENT" })).toBe(false);
  });

  it("returns false for a generic Error (no code)", () => {
    expect(isNotFoundError(new Error("something else"))).toBe(false);
  });

  it("returns false for an error with an unrelated code", () => {
    const err = Object.assign(new Error("EACCES"), { code: "EACCES" });
    expect(isNotFoundError(err)).toBe(false);
  });

  it("returns false for a number", () => {
    expect(isNotFoundError(42)).toBe(false);
  });
});
