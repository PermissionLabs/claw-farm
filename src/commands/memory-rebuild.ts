import { join } from "node:path";
import { mkdir, readdir, rm } from "node:fs/promises";
import { resolveProjectName } from "../lib/registry.ts";
import { readProjectConfig } from "../lib/config.ts";
import { instanceDir } from "../lib/instance.ts";
import { builtinProcessor } from "../processors/builtin.ts";
import { mem0Processor } from "../processors/mem0.ts";

export async function memoryRebuildCommand(args: string[]): Promise<void> {
  const userIdx = args.indexOf("--user");
  const userId = userIdx !== -1 ? args[userIdx + 1] : undefined;
  const name = args.find((a) => !a.startsWith("-") && a !== userId);
  const { name: projectName, entry } = await resolveProjectName(name);

  const config = await readProjectConfig(entry.path);
  const processor = config?.processor ?? entry.processor;

  if (entry.multiInstance && userId) {
    // Rebuild specific instance memory
    console.log(`\n🔄 Rebuilding memory for ${projectName}/${userId}...`);
    await rebuildInstanceMemory(entry.path, userId);
    console.log(`\n✅ Memory rebuild complete for ${projectName}/${userId}.\n`);
    return;
  }

  if (entry.multiInstance && !userId) {
    // Rebuild all instance memories
    const instances = entry.instances ?? {};
    const userIds = Object.keys(instances);
    console.log(`\n🔄 Rebuilding memory for all ${userIds.length} instance(s) of ${projectName}...`);
    for (const uid of userIds) {
      console.log(`\n  → ${uid}`);
      await rebuildInstanceMemory(entry.path, uid);
    }
    console.log(`\n✅ Memory rebuild complete for ${projectName}.\n`);
    return;
  }

  // Single-instance mode
  console.log(`\n🔄 Rebuilding memory for ${projectName}...`);

  if (processor === "mem0") {
    await mem0Processor.rebuild(entry.path);
  } else {
    await builtinProcessor.rebuild(entry.path);
  }

  console.log(`\n✅ Memory rebuild complete for ${projectName}.\n`);
}

async function rebuildInstanceMemory(projectDir: string, userId: string): Promise<void> {
  const instDir = instanceDir(projectDir, userId);
  const snapshotsDir = join(instDir, "raw", "workspace-snapshots");

  try {
    const snapshots = await readdir(snapshotsDir);
    if (snapshots.length === 0) {
      console.log("    No snapshots found — nothing to rebuild");
      return;
    }
    const latest = snapshots.sort().at(-1)!;
    const memoryContent = await Bun.file(join(snapshotsDir, latest, "MEMORY.md")).text();
    await Bun.write(join(instDir, "MEMORY.md"), memoryContent);
    console.log(`    Rebuilt MEMORY.md from snapshot: ${latest}`);
  } catch {
    console.log("    No snapshots available — skipping rebuild");
  }
}
