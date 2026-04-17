import { describe, it, expect } from "bun:test";
import { openclawPaths, picoclawPaths, getRuntimePaths } from "../paths.ts";

describe("openclawPaths", () => {
  describe("memory", () => {
    it("places MEMORY.md directly in workspaceRoot", () => {
      expect(openclawPaths.memory("/proj/openclaw/workspace")).toBe(
        "/proj/openclaw/workspace/MEMORY.md",
      );
    });
  });

  describe("sessions", () => {
    it("places sessions under <instanceRoot>/openclaw/sessions", () => {
      expect(openclawPaths.sessions("/proj")).toBe("/proj/openclaw/sessions");
    });
  });

  describe("workspace", () => {
    it("resolves workspace under <instanceRoot>/openclaw/workspace", () => {
      expect(openclawPaths.workspace("/proj")).toBe(
        "/proj/openclaw/workspace",
      );
    });
  });

  describe("rawSessions", () => {
    it("is the same as sessions for openclaw", () => {
      const root = "/proj";
      expect(openclawPaths.rawSessions(root)).toBe(
        openclawPaths.sessions(root),
      );
    });
  });
});

describe("picoclawPaths", () => {
  describe("memory", () => {
    it("places MEMORY.md under memory/ subdirectory of workspaceRoot", () => {
      expect(picoclawPaths.memory("/proj/picoclaw/workspace")).toBe(
        "/proj/picoclaw/workspace/memory/MEMORY.md",
      );
    });
  });

  describe("sessions", () => {
    it("places sessions under <instanceRoot>/picoclaw/workspace/sessions", () => {
      expect(picoclawPaths.sessions("/proj")).toBe(
        "/proj/picoclaw/workspace/sessions",
      );
    });
  });

  describe("workspace", () => {
    it("resolves workspace under <instanceRoot>/picoclaw/workspace", () => {
      expect(picoclawPaths.workspace("/proj")).toBe(
        "/proj/picoclaw/workspace",
      );
    });
  });

  describe("rawSessions", () => {
    it("is the same as sessions for picoclaw", () => {
      const root = "/proj";
      expect(picoclawPaths.rawSessions(root)).toBe(
        picoclawPaths.sessions(root),
      );
    });
  });
});

describe("getRuntimePaths", () => {
  it("returns openclawPaths for openclaw", () => {
    expect(getRuntimePaths("openclaw")).toBe(openclawPaths);
  });

  it("returns picoclawPaths for picoclaw", () => {
    expect(getRuntimePaths("picoclaw")).toBe(picoclawPaths);
  });

  it("table: memory paths differ between runtimes", () => {
    const ws = "/root/workspace";
    expect(getRuntimePaths("openclaw").memory(ws)).toBe(`${ws}/MEMORY.md`);
    expect(getRuntimePaths("picoclaw").memory(ws)).toBe(`${ws}/memory/MEMORY.md`);
  });

  it("table: sessions paths differ between runtimes", () => {
    const root = "/root";
    expect(getRuntimePaths("openclaw").sessions(root)).toBe(`${root}/openclaw/sessions`);
    expect(getRuntimePaths("picoclaw").sessions(root)).toBe(`${root}/picoclaw/workspace/sessions`);
  });

  it("table: workspace paths differ between runtimes", () => {
    const root = "/root";
    expect(getRuntimePaths("openclaw").workspace(root)).toBe(`${root}/openclaw/workspace`);
    expect(getRuntimePaths("picoclaw").workspace(root)).toBe(`${root}/picoclaw/workspace`);
  });
});
