/**
 * Tests for BKLG-018: runtime reconciliation in upgradeCommand.
 * We test the reconcile logic by setting up a minimal registry entry +
 * .claw-farm.json with mismatched runtimes, then calling upgradeCommand.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRegistry, saveRegistry, withLock } from "../registry.ts";
import { writeProjectConfig } from "../config.ts";

let createdDirs: string[] = [];
let registeredProjects: string[] = [];

afterEach(async () => {
  for (const dir of createdDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  createdDirs = [];

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
      // best effort
    }
    registeredProjects = [];
  }
});

async function makeFixture(
  projectName: string,
  configRuntime: "openclaw" | "picoclaw",
  registryRuntime: "openclaw" | "picoclaw",
): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "upgrade-reconcile-"));
  createdDirs.push(base);
  const projectDir = join(base, projectName);
  await mkdir(projectDir, { recursive: true });

  // Write .claw-farm.json with configRuntime
  await writeProjectConfig(projectDir, {
    name: projectName,
    processor: "builtin",
    port: 19999,
    createdAt: new Date().toISOString(),
    runtime: configRuntime,
  });

  // Register project with registryRuntime
  registeredProjects.push(projectName);
  await withLock(async () => {
    const reg = await loadRegistry();
    reg.projects[projectName] = {
      path: projectDir,
      port: 19999,
      processor: "builtin",
      createdAt: new Date().toISOString(),
      runtime: registryRuntime,
    };
    await saveRegistry(reg);
  });

  return projectDir;
}

describe("upgradeCommand runtime reconciliation (BKLG-018)", () => {
  it("errors on runtime mismatch without a resolution flag", async () => {
    const projectName = "reconcile-test-err";
    await makeFixture(projectName, "openclaw", "picoclaw");

    const { upgradeCommand } = await import("../../commands/upgrade.ts");
    await expect(upgradeCommand([projectName])).rejects.toThrow(/Runtime mismatch/);
  });

  it("--prefer-config resolves mismatch and updates registry", async () => {
    const projectName = "reconcile-test-cfg";
    const projectDir = await makeFixture(projectName, "picoclaw", "openclaw");

    // Create minimal picoclaw workspace so upgrade doesn't fail on missing dirs
    await mkdir(join(projectDir, "picoclaw", "workspace", "skills"), { recursive: true });

    const { upgradeCommand } = await import("../../commands/upgrade.ts");
    // Should not throw — uses picoclaw (from config), updates registry
    await expect(upgradeCommand([projectName, "--prefer-config"])).resolves.toBeUndefined();

    // Registry should now reflect picoclaw
    const reg = await loadRegistry();
    const entry = reg.projects[projectName];
    expect(entry?.runtime).toBe("picoclaw");
  });
});
