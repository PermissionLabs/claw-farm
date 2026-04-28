import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  resolveProjectName,
  loadRegistry,
  saveRegistry,
  findPositionalArg,
} from "../lib/registry.ts";
import { readProjectConfig, resolveRuntimeConfig, writeProjectConfig } from "../lib/config.ts";
import { runCompose } from "../lib/compose.ts";
import { templateDir } from "../lib/instance.ts";
import { projectKindOf } from "../lib/project-kind.ts";
import { getRuntime, type RuntimeType, type ProxyMode } from "../runtimes/index.ts";
import { policyTemplate } from "../templates/policy.yaml.ts";
import { fileExists } from "../lib/fs-utils.ts";
import { parseEnumFlag } from "../lib/cli-parser.ts";
import {
  migrateSingleInstance,
  migrateInstance,
  migrateOverrideFile,
} from "../lib/migrate-runtime.ts";

export async function migrateRuntimeCommand(args: string[]): Promise<void> {
  const projectArg = findPositionalArg(args);
  if (!projectArg) {
    console.error("Usage: claw-farm migrate-runtime <project> --to <runtime> [--proxy-mode shared|per-instance]");
    process.exit(1);
  }

  // Parse --to flag (required)
  const VALID_RUNTIMES = ["openclaw", "picoclaw"] as const;
  if (!args.includes("--to")) {
    console.error("Missing --to <runtime>. Must be one of: openclaw, picoclaw");
    process.exit(1);
  }
  const targetRuntimeType = parseEnumFlag(args, "--to", VALID_RUNTIMES, "openclaw") as RuntimeType;

  // Parse --proxy-mode flag (optional)
  const VALID_PROXY_MODES = ["shared", "per-instance", "none"] as const;
  const proxyModeArg = args.includes("--proxy-mode")
    ? parseEnumFlag(args, "--proxy-mode", VALID_PROXY_MODES, "per-instance")
    : undefined;

  // Resolve project
  const { name: projectName, entry } = await resolveProjectName(projectArg);
  const projectDir = entry.path;
  const config = await readProjectConfig(projectDir);

  if (!config) {
    console.error(`Cannot read .claw-farm.json in ${projectDir}. Is this a claw-farm project?`);
    process.exit(1);
  }

  const { runtimeType: sourceRuntimeType } = resolveRuntimeConfig(config, entry);
  const processor = config.processor ?? entry.processor;
  const llm = config.llm ?? "gemini";

  // Validate: source !== target
  if (sourceRuntimeType === targetRuntimeType) {
    console.error(`Project "${projectName}" is already using the "${targetRuntimeType}" runtime.`);
    process.exit(1);
  }

  // Validate: processor compatibility
  if (processor === "mem0" && targetRuntimeType === "picoclaw") {
    console.error("Error: mem0 processor is not yet supported with picoclaw runtime.");
    console.error("Migrate to builtin processor first, or use openclaw runtime.");
    process.exit(1);
  }

  const sourceRuntime = getRuntime(sourceRuntimeType);
  const targetRuntime = getRuntime(targetRuntimeType);
  const proxyMode: ProxyMode = (proxyModeArg as ProxyMode) ?? targetRuntime.defaultProxyMode;

  console.log(`\n🔄 Migrating "${projectName}" runtime: ${sourceRuntimeType} → ${targetRuntimeType}`);
  console.log(`   Processor: ${processor}`);
  console.log(`   LLM provider: ${llm}`);
  console.log(`   Proxy mode: ${proxyMode}`);
  console.log(`   Multi-instance: ${entry.multiInstance ? "yes" : "no"}`);
  console.log(`   Path: ${projectDir}\n`);

  const kind = projectKindOf(entry);

  // Step 1: Stop running containers
  console.log("■ Stopping running containers...");
  try {
    if (kind.name === "multi") {
      const userIds = kind.listUserIds(entry);
      for (const uid of userIds) {
        try {
          await runCompose(projectDir, "down", {
            composePath: kind.composePath(projectDir, "", uid),
            projectName: kind.composeProjectName(projectName, uid),
          });
        } catch {
          // intentional: best-effort container stop before migration
        }
      }
    } else {
      try {
        await runCompose(projectDir, "down");
      } catch {
        // intentional: best-effort container stop (compose file may not exist)
      }
    }
    console.log("✓ Containers stopped\n");
  } catch {
    // intentional: best-effort container stop — migration proceeds regardless
    console.log("✓ No containers running (or already stopped)\n");
  }

  // Step 2: Migrate files
  if (kind.name === "multi") {
    // Update template/config/
    const tmplDir = templateDir(projectDir);
    const tmplConfigDir = join(tmplDir, "config");

    // Generate new config in template
    await mkdir(tmplConfigDir, { recursive: true });
    await Bun.write(
      join(tmplConfigDir, targetRuntime.configFileName),
      targetRuntime.configTemplate(projectName, processor, llm),
    );
    console.log(`✓ Generated template/config/${targetRuntime.configFileName}`);

    // Write additional config files for target runtime
    for (const configFile of targetRuntime.additionalConfigFiles) {
      if (configFile === "policy.yaml") {
        // Keep existing policy.yaml if present
        const existingPolicy = join(tmplConfigDir, "policy.yaml");
        if (!await fileExists(existingPolicy)) {
          await Bun.write(existingPolicy, policyTemplate(projectName));
          console.log(`✓ Generated template/config/${configFile}`);
        } else {
          console.log(`✓ template/config/${configFile} already exists — kept`);
        }
      }
    }

    // Write shared proxy compose if needed
    if (proxyMode === "shared" && targetRuntime.proxyComposeTemplate) {
      const proxyComposePath = join(projectDir, "docker-compose.proxy.yml");
      await Bun.write(proxyComposePath, targetRuntime.proxyComposeTemplate(projectName));
      console.log("✓ Generated docker-compose.proxy.yml (shared api-proxy)");
    }

    // Migrate each instance
    const instances = entry.instances ?? {};
    const instanceIds = Object.keys(instances);
    for (const userId of instanceIds) {
      const inst = instances[userId];
      if (!inst) continue;
      console.log(`\n  ■ Migrating instance "${userId}"...`);
      await migrateInstance(
        projectDir,
        userId,
        projectName,
        inst.port,
        sourceRuntime,
        targetRuntime,
        processor,
        llm,
        proxyMode,
      );
      console.log(`  ✓ Instance "${userId}" migrated`);
    }

    if (instanceIds.length > 0) {
      console.log(`\n✓ Migrated ${instanceIds.length} instance(s)`);
    }
  } else {
    // Single-instance migration
    const migrated = await migrateSingleInstance(
      projectDir,
      projectName,
      sourceRuntime,
      targetRuntime,
      processor,
      llm,
      proxyMode,
    );
    // Migrate override file service names
    if (await migrateOverrideFile(projectDir, sourceRuntimeType, targetRuntimeType)) {
      migrated.push("docker-compose.openclaw.override.yml (service names updated)");
    }
    console.log(`✓ Migrated files: ${migrated.join(", ")}`);
  }

  // Step 3: Update .claw-farm.json
  config.runtime = targetRuntimeType;
  if (proxyMode !== targetRuntime.defaultProxyMode) {
    config.proxyMode = proxyMode;
  } else {
    delete config.proxyMode;
  }
  await writeProjectConfig(projectDir, config);
  console.log("✓ Updated .claw-farm.json");

  // Step 4: Update registry
  const reg = await loadRegistry();
  const project = reg.projects[projectName];
  if (project) {
    project.runtime = targetRuntimeType;
    await saveRegistry(reg);
  }
  console.log("✓ Updated global registry");

  // Step 5: Print summary
  console.log(`\n✅ Runtime migration complete: ${sourceRuntimeType} → ${targetRuntimeType}`);
  console.log(`\n   Migrated:`);
  console.log(`     - Workspace files (SOUL.md, MEMORY.md, USER.md, skills/)`);
  console.log(`     - Config (regenerated for ${targetRuntimeType})`);
  console.log(`     - Docker Compose (regenerated)`);
  console.log(`\n   NOT migrated (format differs between runtimes):`);
  console.log(`     - Session logs (${sourceRuntime.runtimeDirName}/sessions/)`);
  console.log(`\n   Backup:`);
  console.log(`     - Old ${sourceRuntime.runtimeDirName}/ directory preserved (not deleted)`);
  console.log(`     - Delete manually after verifying the migration: rm -rf ${sourceRuntime.runtimeDirName}/`);
  console.log(`\n   Next steps:`);
  console.log(`     1. Review the new ${targetRuntime.runtimeDirName}/ directory`);
  console.log(`     2. Run: claw-farm up ${projectName}\n`);
}
