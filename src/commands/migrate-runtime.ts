import { join } from "node:path";
import { mkdir, readdir } from "node:fs/promises";
import {
  resolveProjectName,
  loadRegistry,
  saveRegistry,
  findPositionalArg,
} from "../lib/registry.ts";
import { readProjectConfig, resolveRuntimeConfig, writeProjectConfig } from "../lib/config.ts";
import { runCompose, COMPOSE_FILENAME } from "../lib/compose.ts";
import { instanceDir, templateDir, ensureInstanceDirs } from "../lib/instance.ts";
import { projectKindOf } from "../lib/project-kind.ts";
import { getRuntime, type RuntimeType, type ProxyMode } from "../runtimes/index.ts";
import { policyTemplate } from "../templates/policy.yaml.ts";
import { fileExists, copyIfExists, copyDirContents } from "../lib/fs-utils.ts";
import { parseEnumFlag } from "../lib/cli-parser.ts";

/**
 * Migrate a single-instance project's workspace files from one runtime to another.
 * Returns list of migrated files for summary.
 */
async function migrateSingleInstance(
  projectDir: string,
  projectName: string,
  sourceRuntime: ReturnType<typeof getRuntime>,
  targetRuntime: ReturnType<typeof getRuntime>,
  processor: "builtin" | "mem0",
  llm: "gemini" | "anthropic" | "openai-compat",
  proxyMode: ProxyMode,
): Promise<string[]> {
  const srcDir = sourceRuntime.runtimeDirName;
  const destDir = targetRuntime.runtimeDirName;
  const migrated: string[] = [];

  // Create new runtime directory structure
  await mkdir(join(projectDir, destDir, "workspace", "skills"), { recursive: true });
  if (targetRuntime.name === "picoclaw") {
    await mkdir(join(projectDir, destDir, "workspace", "sessions"), { recursive: true });
    await mkdir(join(projectDir, destDir, "workspace", "state"), { recursive: true });
    await mkdir(join(projectDir, destDir, "workspace", "memory"), { recursive: true });
  } else {
    await mkdir(join(projectDir, destDir, "workspace", "memory"), { recursive: true });
    await mkdir(join(projectDir, destDir, "sessions"), { recursive: true });
    await mkdir(join(projectDir, destDir, "logs"), { recursive: true });
  }

  // Copy SOUL.md
  const soulSrc = join(projectDir, srcDir, "workspace", "SOUL.md");
  const soulDest = join(projectDir, destDir, "workspace", "SOUL.md");
  if (await fileExists(soulSrc)) {
    await copyIfExists(soulSrc, soulDest);
    migrated.push("SOUL.md");
  }

  // Copy USER.md
  const userSrc = join(projectDir, srcDir, "workspace", "USER.md");
  const userDest = join(projectDir, destDir, "workspace", "USER.md");
  if (await fileExists(userSrc)) {
    await copyIfExists(userSrc, userDest);
    migrated.push("USER.md");
  }

  // Copy MEMORY.md (path differs between runtimes)
  const memorySrcPaths = sourceRuntime.name === "picoclaw"
    ? [join(projectDir, srcDir, "workspace", "memory", "MEMORY.md")]
    : [join(projectDir, srcDir, "workspace", "MEMORY.md")];
  const memoryDest = targetRuntime.name === "picoclaw"
    ? join(projectDir, destDir, "workspace", "memory", "MEMORY.md")
    : join(projectDir, destDir, "workspace", "MEMORY.md");
  for (const memSrc of memorySrcPaths) {
    if (await fileExists(memSrc)) {
      await copyIfExists(memSrc, memoryDest);
      migrated.push("MEMORY.md");
      break;
    }
  }

  // Copy skills/
  const skillsSrc = join(projectDir, srcDir, "workspace", "skills");
  const skillsDest = join(projectDir, destDir, "workspace", "skills");
  try {
    const skills = await readdir(skillsSrc);
    if (skills.length > 0) {
      await copyDirContents(skillsSrc, skillsDest);
      migrated.push(`skills/ (${skills.length} file(s))`);
    }
  } catch {
    // No skills directory
  }

  // Generate new runtime config (do NOT copy old config — format differs)
  await Bun.write(
    join(projectDir, destDir, targetRuntime.configFileName),
    targetRuntime.configTemplate(projectName, processor, llm),
  );
  migrated.push(targetRuntime.configFileName);

  // Write additional config files for target runtime
  for (const configFile of targetRuntime.additionalConfigFiles) {
    if (configFile === "policy.yaml") {
      await Bun.write(
        join(projectDir, destDir, configFile),
        policyTemplate(projectName),
      );
      migrated.push(configFile);
    }
  }

  // Regenerate docker-compose
  const composeContent = targetRuntime.composeTemplate(projectName,
    (await readProjectConfig(projectDir))?.port ?? 18789, proxyMode);
  await Bun.write(join(projectDir, COMPOSE_FILENAME), composeContent);
  migrated.push(COMPOSE_FILENAME);

  return migrated;
}

/**
 * Migrate a multi-instance project's workspace files for a single instance.
 */
async function migrateInstance(
  projectDir: string,
  userId: string,
  projectName: string,
  port: number,
  sourceRuntime: ReturnType<typeof getRuntime>,
  targetRuntime: ReturnType<typeof getRuntime>,
  processor: "builtin" | "mem0",
  llm: "gemini" | "anthropic" | "openai-compat",
  proxyMode: ProxyMode,
): Promise<void> {
  const instDir = instanceDir(projectDir, userId);
  const srcRtDir = sourceRuntime.runtimeDirName;
  const destRtDir = targetRuntime.runtimeDirName;

  // Ensure target instance directory structure
  await ensureInstanceDirs(projectDir, userId, targetRuntime.name);

  const srcWs = join(instDir, srcRtDir, "workspace");
  const destWs = join(instDir, destRtDir, "workspace");

  // Copy workspace files (SOUL.md, USER.md, AGENTS.md, skills/)
  await copyIfExists(join(srcWs, "SOUL.md"), join(destWs, "SOUL.md"));
  await copyIfExists(join(srcWs, "USER.md"), join(destWs, "USER.md"));
  await copyIfExists(join(srcWs, "AGENTS.md"), join(destWs, "AGENTS.md"));
  await copyDirContents(join(srcWs, "skills"), join(destWs, "skills"));

  // Copy MEMORY.md (adjusting path for runtime differences)
  const memorySrcPaths = sourceRuntime.name === "picoclaw"
    ? [join(srcWs, "memory", "MEMORY.md")]
    : [join(srcWs, "MEMORY.md")];
  const memoryDest = targetRuntime.name === "picoclaw"
    ? join(destWs, "memory", "MEMORY.md")
    : join(destWs, "MEMORY.md");
  for (const memSrc of memorySrcPaths) {
    if (await fileExists(memSrc)) {
      await copyIfExists(memSrc, memoryDest);
      break;
    }
  }

  // Generate new config for instance
  await Bun.write(
    join(instDir, destRtDir, targetRuntime.configFileName),
    targetRuntime.configTemplate(projectName, processor, llm),
  );

  // Write additional config files
  for (const configFile of targetRuntime.additionalConfigFiles) {
    if (configFile === "policy.yaml") {
      await Bun.write(
        join(instDir, destRtDir, configFile),
        policyTemplate(projectName),
      );
    }
  }

  // Regenerate instance compose
  const composeContent = targetRuntime.instanceComposeTemplate(
    projectName,
    userId,
    port,
    proxyMode,
  );
  await Bun.write(join(instDir, COMPOSE_FILENAME), composeContent);

  // Migrate override file service names (e.g., openclaw-gateway → picoclaw-gateway)
  await migrateOverrideFile(instDir, sourceRuntime.name, targetRuntime.name);
}

/**
 * Migrate docker-compose override file: rename service names to match new runtime.
 * e.g., "openclaw-gateway" → "picoclaw-gateway"
 */
async function migrateOverrideFile(
  dir: string,
  sourceRuntimeType: RuntimeType,
  targetRuntimeType: RuntimeType,
): Promise<boolean> {
  const overridePath = join(dir, "docker-compose.openclaw.override.yml");
  try {
    let content = await Bun.file(overridePath).text();
    const sourceService = sourceRuntimeType === "picoclaw" ? "picoclaw-gateway" : "openclaw-gateway";
    const targetService = targetRuntimeType === "picoclaw" ? "picoclaw-gateway" : "openclaw-gateway";
    if (content.includes(sourceService)) {
      content = content.replaceAll(sourceService, targetService);
      await Bun.write(overridePath, content);
      return true;
    }
  } catch {
    // No override file — nothing to migrate
  }
  return false;
}

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
