import { describe, it, expect } from "bun:test";
import { join, resolve, sep } from "node:path";
import { projectKindOf } from "../project-kind.ts";
import { COMPOSE_FILENAME } from "../compose.ts";
import type { ProjectEntry } from "../registry.ts";

function makeEntry(overrides: Partial<ProjectEntry> = {}): ProjectEntry {
  return {
    path: "/proj",
    port: 18789,
    processor: "builtin",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const singleEntry = makeEntry();
const multiEntry = makeEntry({
  multiInstance: true,
  instances: {
    alice: { userId: "alice", port: 18790, createdAt: "2026-01-01T00:00:00.000Z" },
    bob: { userId: "bob", port: 18791, createdAt: "2026-01-01T00:00:00.000Z" },
  },
});
const emptyMultiEntry = makeEntry({
  multiInstance: true,
  instances: {},
});

describe("projectKindOf", () => {
  it("returns 'single' kind for non-multiInstance entry", () => {
    expect(projectKindOf(singleEntry).name).toBe("single");
  });

  it("returns 'multi' kind for multiInstance entry", () => {
    expect(projectKindOf(multiEntry).name).toBe("multi");
  });
});

describe("single — listUserIds", () => {
  it("returns empty array", () => {
    expect(projectKindOf(singleEntry).listUserIds(singleEntry)).toEqual([]);
  });
});

describe("multi — listUserIds", () => {
  it("returns all user IDs", () => {
    const ids = projectKindOf(multiEntry).listUserIds(multiEntry);
    expect(ids.sort()).toEqual(["alice", "bob"]);
  });

  it("returns empty array when no instances", () => {
    expect(projectKindOf(emptyMultiEntry).listUserIds(emptyMultiEntry)).toEqual([]);
  });
});

describe("single — forEachUserId", () => {
  it("calls fn once with null and returns single-element array", async () => {
    const received: (string | null)[] = [];
    const results = await projectKindOf(singleEntry).forEachUserId(singleEntry, async (uid) => {
      received.push(uid);
      return uid;
    });
    expect(received).toEqual([null]);
    expect(results).toEqual([null]);
  });
});

describe("multi — forEachUserId", () => {
  it("calls fn for each user and collects results", async () => {
    const received: (string | null)[] = [];
    const results = await projectKindOf(multiEntry).forEachUserId(multiEntry, async (uid) => {
      received.push(uid);
      return uid;
    });
    expect(received.sort()).toEqual(["alice", "bob"]);
    expect((results as (string | null)[]).sort()).toEqual(["alice", "bob"]);
  });

  it("returns empty array when no instances", async () => {
    const results = await projectKindOf(emptyMultiEntry).forEachUserId(emptyMultiEntry, async (uid) => uid);
    expect(results).toEqual([]);
  });
});

describe("single — composePath", () => {
  it("returns <projectPath>/docker-compose.openclaw.yml", () => {
    const kind = projectKindOf(singleEntry);
    expect(kind.composePath("/proj", "openclaw", null)).toBe(join("/proj", COMPOSE_FILENAME));
  });

  it("ignores userId (always null for single)", () => {
    const kind = projectKindOf(singleEntry);
    // runtimeDirName is irrelevant for single
    expect(kind.composePath("/proj", "picoclaw", null)).toBe(join("/proj", COMPOSE_FILENAME));
  });
});

describe("multi — composePath", () => {
  it("returns <instanceDir>/docker-compose.openclaw.yml for a given user", () => {
    const kind = projectKindOf(multiEntry);
    const instancesBase = resolve("/proj", "instances");
    const expected = join(resolve(instancesBase, "alice"), COMPOSE_FILENAME);
    expect(kind.composePath("/proj", "openclaw", "alice")).toBe(expected);
  });

  it("produces distinct paths per user", () => {
    const kind = projectKindOf(multiEntry);
    const pathAlice = kind.composePath("/proj", "openclaw", "alice");
    const pathBob = kind.composePath("/proj", "openclaw", "bob");
    expect(pathAlice).not.toBe(pathBob);
  });
});

describe("single — composeProjectName", () => {
  it("returns projectName unchanged", () => {
    expect(projectKindOf(singleEntry).composeProjectName("myapp", null)).toBe("myapp");
  });
});

describe("multi — composeProjectName", () => {
  it("returns <projectName>-<userId>", () => {
    expect(projectKindOf(multiEntry).composeProjectName("myapp", "alice")).toBe("myapp-alice");
  });

  it("returns projectName unchanged when userId is null (fallback)", () => {
    expect(projectKindOf(multiEntry).composeProjectName("myapp", null)).toBe("myapp");
  });
});
