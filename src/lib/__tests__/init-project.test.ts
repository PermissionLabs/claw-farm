import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initProject } from "../api.ts";
import { loadRegistry, saveRegistry, withLock } from "../registry.ts";

let createdDirs: string[] = [];
let registeredProjects: string[] = [];

afterEach(async () => {
  // Clean up temp directories
  for (const dir of createdDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  createdDirs = [];

  // Clean up global registry entries created by tests
  if (registeredProjects.length > 0) {
    try {
      await withLock(async () => {
        const reg = await loadRegistry();
        for (const name of registeredProjects) {
          delete reg.projects[name];
        }
        await saveRegistry(reg);
      });
    } catch {
      // best effort — if registry doesn't exist yet that's fine
    }
    registeredProjects = [];
  }
});

describe("initProject", () => {
  it("scaffolds a valid openclaw project directory", async () => {
    const base = await mkdtemp(join(tmpdir(), "init-test-"));
    createdDirs.push(base);
    const projectPath = join(base, "test-proj-a");
    registeredProjects.push("test-proj-a");

    const result = await initProject({ name: "test-proj-a", path: projectPath });

    expect(result.path).toBe(projectPath);
    expect(typeof result.port).toBe("number");
    expect(result.port).toBeGreaterThan(0);

    // Directory structure exists
    const clawFarmJson = Bun.file(join(projectPath, ".claw-farm.json"));
    expect(await clawFarmJson.exists()).toBe(true);

    const soulMd = Bun.file(join(projectPath, "openclaw", "workspace", "SOUL.md"));
    expect(await soulMd.exists()).toBe(true);

    const memoryMd = Bun.file(join(projectPath, "openclaw", "workspace", "MEMORY.md"));
    expect(await memoryMd.exists()).toBe(true);
  });

  it("rejects mem0 + picoclaw combination before touching registry", async () => {
    const base = await mkdtemp(join(tmpdir(), "init-test-"));
    createdDirs.push(base);
    const projectPath = join(base, "test-invalid");
    // No registry entry expected — validateProcessorRuntimeCombo throws before addProject

    await expect(
      initProject({ name: "test-invalid", path: projectPath, processor: "mem0", runtime: "picoclaw" }),
    ).rejects.toThrow(/does not support runtime/);
  });

  it("written .claw-farm.json contains expected fields", async () => {
    const base = await mkdtemp(join(tmpdir(), "init-test-"));
    createdDirs.push(base);
    const projectPath = join(base, "test-cfg-b");
    registeredProjects.push("test-cfg-b");

    await initProject({ name: "test-cfg-b", path: projectPath, llm: "anthropic" });

    const raw = await Bun.file(join(projectPath, ".claw-farm.json")).text();
    const cfg = JSON.parse(raw) as Record<string, unknown>;

    expect(cfg["name"]).toBe("test-cfg-b");
    expect(cfg["llm"]).toBe("anthropic");
    expect(cfg["runtime"]).toBe("openclaw");
    expect(cfg["processor"]).toBe("builtin");
  });

  it("scaffolds a picoclaw project with correct workspace layout", async () => {
    const base = await mkdtemp(join(tmpdir(), "init-test-"));
    createdDirs.push(base);
    const projectPath = join(base, "test-pico-b");
    registeredProjects.push("test-pico-b");

    await initProject({ name: "test-pico-b", path: projectPath, runtime: "picoclaw" });

    const memoryDir = join(projectPath, "picoclaw", "workspace", "memory");
    const s = await stat(memoryDir);
    expect(s.isDirectory()).toBe(true);

    const memoryMd = Bun.file(join(memoryDir, "MEMORY.md"));
    expect(await memoryMd.exists()).toBe(true);
  });
});
