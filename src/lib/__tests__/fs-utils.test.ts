import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileExists, copyIfExists, dirExists, copyDirContents, moveFile, moveDirContents, rmIfEmpty } from "../fs-utils.ts";

let tmp: string;

beforeEach(async () => {
  tmp = join(tmpdir(), `claw-farm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmp, { recursive: true });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("fileExists", () => {
  it("returns true for an existing file", async () => {
    const p = join(tmp, "hello.txt");
    await writeFile(p, "hi");
    expect(await fileExists(p)).toBe(true);
  });

  it("returns false for a missing file", async () => {
    expect(await fileExists(join(tmp, "no-such-file.txt"))).toBe(false);
  });
});

describe("copyIfExists", () => {
  it("copies file when source exists", async () => {
    const src = join(tmp, "src.txt");
    const dest = join(tmp, "dest.txt");
    await writeFile(src, "content");
    await copyIfExists(src, dest);
    expect(await fileExists(dest)).toBe(true);
    expect(await Bun.file(dest).text()).toBe("content");
  });

  it("silently no-ops when source does not exist", async () => {
    const src = join(tmp, "nonexistent.txt");
    const dest = join(tmp, "dest.txt");
    await copyIfExists(src, dest);
    expect(await fileExists(dest)).toBe(false);
  });
});

describe("dirExists", () => {
  it("returns true for an existing directory", async () => {
    const dir = join(tmp, "subdir");
    await mkdir(dir);
    expect(await dirExists(dir)).toBe(true);
  });

  it("returns false when path is a file, not a directory", async () => {
    const p = join(tmp, "file.txt");
    await writeFile(p, "x");
    expect(await dirExists(p)).toBe(false);
  });

  it("returns false for a missing path", async () => {
    expect(await dirExists(join(tmp, "no-such-dir"))).toBe(false);
  });
});

describe("copyDirContents", () => {
  it("copies all files from src to dest", async () => {
    const src = join(tmp, "src");
    const dest = join(tmp, "dest");
    await mkdir(src);
    await writeFile(join(src, "a.txt"), "aaa");
    await writeFile(join(src, "b.txt"), "bbb");
    await copyDirContents(src, dest);
    expect(await fileExists(join(dest, "a.txt"))).toBe(true);
    expect(await fileExists(join(dest, "b.txt"))).toBe(true);
    // source untouched
    expect(await fileExists(join(src, "a.txt"))).toBe(true);
  });

  it("copies nested directories recursively", async () => {
    const src = join(tmp, "src2");
    const dest = join(tmp, "dest2");
    await mkdir(join(src, "sub"), { recursive: true });
    await writeFile(join(src, "sub", "nested.txt"), "nested");
    await copyDirContents(src, dest);
    expect(await fileExists(join(dest, "sub", "nested.txt"))).toBe(true);
  });

  it("no-ops when src does not exist", async () => {
    const dest = join(tmp, "dest3");
    await copyDirContents(join(tmp, "no-such-src"), dest);
    expect(await dirExists(dest)).toBe(false);
  });

  it("no-ops when src is empty", async () => {
    const src = join(tmp, "empty-src");
    const dest = join(tmp, "empty-dest");
    await mkdir(src);
    await copyDirContents(src, dest);
    expect(await dirExists(dest)).toBe(false);
  });

  it("copies into pre-existing dest without error", async () => {
    const src = join(tmp, "src4");
    const dest = join(tmp, "dest4");
    await mkdir(src);
    await mkdir(dest);
    await writeFile(join(src, "x.txt"), "x");
    await copyDirContents(src, dest);
    expect(await fileExists(join(dest, "x.txt"))).toBe(true);
  });
});

describe("moveFile", () => {
  it("moves a file and removes the source", async () => {
    const src = join(tmp, "move-src.txt");
    const dest = join(tmp, "move-dest.txt");
    await writeFile(src, "hello");
    await moveFile(src, dest);
    expect(await fileExists(dest)).toBe(true);
    expect(await Bun.file(dest).text()).toBe("hello");
    expect(await fileExists(src)).toBe(false);
  });

  it("no-ops when src does not exist", async () => {
    const dest = join(tmp, "no-dest.txt");
    await moveFile(join(tmp, "no-src.txt"), dest);
    expect(await fileExists(dest)).toBe(false);
  });
});

describe("moveDirContents", () => {
  it("moves files from src to dest and removes sources", async () => {
    const src = join(tmp, "mv-src");
    const dest = join(tmp, "mv-dest");
    await mkdir(src);
    await writeFile(join(src, "file.txt"), "data");
    await moveDirContents(src, dest);
    expect(await fileExists(join(dest, "file.txt"))).toBe(true);
    expect(await fileExists(join(src, "file.txt"))).toBe(false);
  });

  it("no-ops when src does not exist", async () => {
    const dest = join(tmp, "mv-dest2");
    await moveDirContents(join(tmp, "mv-no-src"), dest);
    expect(await dirExists(dest)).toBe(false);
  });
});

describe("rmIfEmpty", () => {
  it("removes an empty directory", async () => {
    const dir = join(tmp, "empty-dir");
    await mkdir(dir);
    await rmIfEmpty(dir);
    expect(await dirExists(dir)).toBe(false);
  });

  it("does not remove a non-empty directory", async () => {
    const dir = join(tmp, "non-empty-dir");
    await mkdir(dir);
    await writeFile(join(dir, "file.txt"), "x");
    await rmIfEmpty(dir);
    expect(await dirExists(dir)).toBe(true);
  });

  it("no-ops when directory does not exist", async () => {
    await rmIfEmpty(join(tmp, "ghost-dir")); // should not throw
  });
});
