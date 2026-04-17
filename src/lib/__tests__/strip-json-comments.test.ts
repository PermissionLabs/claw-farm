import { describe, it, expect } from "bun:test";
import { stripJsonComments } from "../config.ts";

describe("stripJsonComments", () => {
  it("strips trailing // line comment", () => {
    const input = `{"a": 1} // comment`;
    expect(stripJsonComments(input)).toBe(`{"a": 1} `);
  });

  it("strips // line comment mid-line, preserves rest of object", () => {
    const input = `{\n  "a": 1 // inline comment\n}`;
    expect(JSON.parse(stripJsonComments(input))).toEqual({ a: 1 });
  });

  it("strips /* block */ comment", () => {
    const input = `{"a": /* block */ 1}`;
    expect(JSON.parse(stripJsonComments(input))).toEqual({ a: 1 });
  });

  it("strips multi-line /* block */ comment", () => {
    const input = `{\n  /* start\n     end */\n  "a": 1\n}`;
    expect(JSON.parse(stripJsonComments(input))).toEqual({ a: 1 });
  });

  it("does NOT strip // inside a string literal", () => {
    const input = `{"url": "http://example.com"}`;
    expect(JSON.parse(stripJsonComments(input))).toEqual({ url: "http://example.com" });
  });

  it("does NOT strip /* ... */ inside a string literal", () => {
    const input = `{"doc": "/* not a comment */"}`;
    expect(JSON.parse(stripJsonComments(input))).toEqual({ doc: "/* not a comment */" });
  });

  it("preserves escaped quotes inside strings", () => {
    const input = `{"key": "\\"b\\""}`;
    expect(JSON.parse(stripJsonComments(input))).toEqual({ key: '"b"' });
  });

  it("returns empty string for empty input", () => {
    expect(stripJsonComments("")).toBe("");
  });

  it("returns input unchanged when no comments present", () => {
    const input = `{"a": 1, "b": [2, 3]}`;
    expect(stripJsonComments(input)).toBe(input);
  });
});
