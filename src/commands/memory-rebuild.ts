import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { isNotFoundError } from "../lib/errors.ts";
import { resolveProjectName, findPositionalArg } from "../lib/registry.ts";
import { readProjectConfig, resolveRuntimeConfig } from "../lib/config.ts";
import { instanceDir } from "../lib/instance.ts";
import { projectKindOf } from "../lib/project-kind.ts";
import { builtinProcessor } from "../processors/builtin.ts";
import { mem0Processor } from "../processors/mem0.ts";
import type { RuntimeType } from "../runtimes/interface.ts";
import { getRuntimePaths } from "../runtimes/paths.ts";

export async function memoryRebuildCommand(args: string[]): Promise<void> {
  const userIdx = args.indexOf("--user");
  const userId = userIdx !== -1 ? args[userIdx + 1] : undefined;
  const name = findPositionalArg(args);
  const { name: projectName, entry } = await resolveProjectName(name);

  const config = await readProjectConfig(entry.path);
  const processor = config?.processor ?? entry.processor;
  const { runtimeType } = resolveRuntimeConfig(config, entry);
  const kind = projectKindOf(entry);

  if (kind.name === "multi" && userId) {
    // Rebuild specific instance memory
    console.log(`\n🔄 Rebuilding memory for ${projectName}/${userId}...`);
    await rebuildInstanceMemory(entry.path, userId, processor, runtimeType);
    console.log(`\n✅ Memory rebuild complete for ${projectName}/${userId}.\n`);
    return;
  }

  if (kind.name === "multi" && !userId) {
    // Rebuild all instance memories
    const userIds = kind.listUserIds(entry);
    console.log(`\n🔄 Rebuilding memory for all ${userIds.length} instance(s) of ${projectName}...`);
    for (const uid of userIds) {
      console.log(`\n  → ${uid}`);
      await rebuildInstanceMemory(entry.path, uid, processor, runtimeType);
    }
    console.log(`\n✅ Memory rebuild complete for ${projectName}.\n`);
    return;
  }

  // Single-instance mode
  console.log(`\n🔄 Rebuilding memory for ${projectName}...`);

  if (processor === "mem0") {
    await mem0Processor.rebuild(entry.path, runtimeType);
  } else {
    await builtinProcessor.rebuild(entry.path, runtimeType);
  }

  console.log(`\n✅ Memory rebuild complete for ${projectName}.\n`);
}

async function rebuildInstanceMemory(
  projectDir: string,
  userId: string,
  processor: "builtin" | "mem0" = "builtin",
  runtimeType: RuntimeType = "openclaw",
): Promise<void> {
  const instDir = instanceDir(projectDir, userId);
  const paths = getRuntimePaths(runtimeType);

  // Determine session and memory paths based on runtime
  const sessionsDir = paths.sessions(instDir);
  const wsDir = paths.workspace(instDir);
  const memoryPath = paths.memory(wsDir);

  if (processor === "mem0") {
    // Re-index sessions from instance into Qdrant
    console.log("    Mem0 processor: re-indexing from instance sessions...");
    try {
      const files = await readdir(sessionsDir);
      const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
      if (jsonlFiles.length === 0) {
        console.log("    No session logs found — nothing to rebuild");
        return;
      }
      console.log(`    Found ${jsonlFiles.length} session log(s) to process`);
      // TODO: Parse JSONL and POST to Mem0 /memories/add
      console.log("    (Full re-indexing not yet implemented — raw data preserved)");
    } catch (err) {
      if (!isNotFoundError(err)) throw err;
      console.log("    Sessions directory not found — nothing to rebuild");
    }
    return;
  }

  // Builtin processor: rebuild MEMORY.md from latest snapshot
  const snapshotsDir = join(instDir, "raw", "workspace-snapshots");
  try {
    const snapshots = await readdir(snapshotsDir);
    if (snapshots.length === 0) {
      console.log("    No snapshots found — nothing to rebuild");
      return;
    }
    const latest = snapshots.sort().at(-1)!;
    const memoryContent = await Bun.file(join(snapshotsDir, latest, "MEMORY.md")).text();
    await Bun.write(memoryPath, memoryContent);
    console.log(`    Rebuilt MEMORY.md from snapshot: ${latest}`);
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
    console.log("    No snapshots available — skipping rebuild");
  }
}
