import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { isNotFoundError } from "../lib/errors.ts";
import { resolveProjectName, findPositionalArg, loadRegistry, saveRegistry, withLock, type ProjectEntry } from "../lib/registry.ts";
import { projectKindOf } from "../lib/project-kind.ts";
import { copyTemplateFiles } from "../lib/api.ts";
import { readProjectConfig, resolveRuntimeConfig, envExampleTemplate, writeProjectConfig } from "../lib/config.ts";
import { ensureRawDirs } from "../lib/raw-collector.ts";
import { ensureTemplateDirs, ensureInstanceDirs, templateDir, instanceDir } from "../lib/instance.ts";
import { mem0ComposeTemplate } from "../templates/docker-compose.mem0.yml.ts";
import { policyTemplate } from "../templates/policy.yaml.ts";
import { writeApiProxyFiles } from "../templates/api-proxy.ts";
import { getRuntime, type RuntimeType, type ProxyMode } from "../runtimes/index.ts";
import { fileExists, moveFile, moveDirContents, rmIfEmpty } from "../lib/fs-utils.ts";
import { COMPOSE_FILENAME } from "../lib/compose.ts";

/** Copy file without deleting source. */
async function copyFile(src: string, dest: string): Promise<void> {
  const file = Bun.file(src);
  if (!await file.exists()) return;
  const content = await file.arrayBuffer();
  await Bun.write(dest, content);
}

/**
 * Migrate single-instance project from old layout (openclaw/config/, openclaw/raw/)
 * to new directory mount layout (openclaw/ = /home/node/.openclaw).
 */
async function migrateSingleInstanceLayout(projectDir: string): Promise<boolean> {
  const oldConfigDir = join(projectDir, "openclaw", "config");
  const hasOldLayout = await fileExists(join(oldConfigDir, "openclaw.json"));
  const hasNewLayout = await fileExists(join(projectDir, "openclaw", "openclaw.json"));

  if (!hasOldLayout || hasNewLayout) return false;

  console.log("  📦 Migrating to directory mount layout...");

  // 1. Move config files: openclaw/config/ → openclaw/
  await moveFile(
    join(oldConfigDir, "openclaw.json"),
    join(projectDir, "openclaw", "openclaw.json"),
  );
  await moveFile(
    join(oldConfigDir, "policy.yaml"),
    join(projectDir, "openclaw", "policy.yaml"),
  );
  // Also move backup if exists
  await moveFile(
    join(oldConfigDir, "openclaw.json.backup"),
    join(projectDir, "openclaw", "openclaw.json.backup"),
  );
  await rmIfEmpty(oldConfigDir);

  // 2. Move sessions: openclaw/raw/sessions/ → openclaw/sessions/
  await moveDirContents(
    join(projectDir, "openclaw", "raw", "sessions"),
    join(projectDir, "openclaw", "sessions"),
  );

  // 3. Move workspace-snapshots: openclaw/raw/workspace-snapshots/ → raw/workspace-snapshots/
  await moveDirContents(
    join(projectDir, "openclaw", "raw", "workspace-snapshots"),
    join(projectDir, "raw", "workspace-snapshots"),
  );

  // Clean up old raw dir
  await rmIfEmpty(join(projectDir, "openclaw", "raw", "sessions"));
  await rmIfEmpty(join(projectDir, "openclaw", "raw", "workspace-snapshots"));
  await rmIfEmpty(join(projectDir, "openclaw", "raw"));

  // 4. Move processed: openclaw/processed/ → processed/
  await moveDirContents(
    join(projectDir, "openclaw", "processed"),
    join(projectDir, "processed"),
  );
  await rmIfEmpty(join(projectDir, "openclaw", "processed"));

  // 5. Ensure openclaw/logs/ exists
  await mkdir(join(projectDir, "openclaw", "logs"), { recursive: true });

  console.log("  ✓ Migrated directory structure (config, sessions, snapshots, processed)");
  return true;
}

/**
 * Migrate a multi-instance's per-user directory from old layout
 * (USER.md, MEMORY.md at root) to new layout (openclaw/ subdirectory).
 */
async function migrateInstanceLayout(
  instDir: string,
  tmplConfigDir: string,
): Promise<boolean> {
  const hasOldLayout = await fileExists(join(instDir, "USER.md")) ||
    await fileExists(join(instDir, "MEMORY.md"));

  // Skip only if no old-layout files remain (fully migrated or fresh instance)
  if (!hasOldLayout) return false;

  // Create new structure
  await mkdir(join(instDir, "openclaw", "workspace", "memory"), { recursive: true });
  await mkdir(join(instDir, "openclaw", "sessions"), { recursive: true });
  await mkdir(join(instDir, "openclaw", "logs"), { recursive: true });

  // Move files into openclaw/workspace/
  await moveFile(join(instDir, "USER.md"), join(instDir, "openclaw", "workspace", "USER.md"));
  await moveFile(join(instDir, "MEMORY.md"), join(instDir, "openclaw", "workspace", "MEMORY.md"));

  // Move memory/ → openclaw/workspace/memory/
  await moveDirContents(join(instDir, "memory"), join(instDir, "openclaw", "workspace", "memory"));
  await rmIfEmpty(join(instDir, "memory"));

  // Move raw/sessions/ → openclaw/sessions/
  await moveDirContents(join(instDir, "raw", "sessions"), join(instDir, "openclaw", "sessions"));
  await rmIfEmpty(join(instDir, "raw", "sessions"));

  // Move logs/ → openclaw/logs/
  await moveDirContents(join(instDir, "logs"), join(instDir, "openclaw", "logs"));

  // Clean up old directories
  await rmIfEmpty(join(instDir, "raw"));
  await rmIfEmpty(join(instDir, "logs"));

  // Copy config files from template (copy, not move — template is shared)
  await copyFile(join(tmplConfigDir, "openclaw.json"), join(instDir, "openclaw", "openclaw.json"));
  await copyFile(join(tmplConfigDir, "policy.yaml"), join(instDir, "openclaw", "policy.yaml"));

  return true;
}

export async function upgradeCommand(args: string[]): Promise<void> {
  const name = findPositionalArg(args);
  const { name: projectName, entry } = await resolveProjectName(name);
  const projectDir = entry.path;
  const config = await readProjectConfig(projectDir);
  const processor = config?.processor ?? entry.processor;
  const llm = config?.llm ?? "gemini";
  const preferConfig = args.includes("--prefer-config");
  const preferRegistry = args.includes("--prefer-registry");

  // Runtime reconciliation: detect mismatch between .claw-farm.json and registry
  if (config?.runtime && entry.runtime && config.runtime !== entry.runtime) {
    if (!preferConfig && !preferRegistry) {
      throw new Error(
        `Runtime mismatch for "${projectName}":\n` +
        `  .claw-farm.json says: ${config.runtime}\n` +
        `  registry says:        ${entry.runtime}\n` +
        `\n` +
        `  To resolve, either:\n` +
        `    claw-farm upgrade ${projectName} --prefer-config    (use ${config.runtime}, update registry)\n` +
        `    claw-farm upgrade ${projectName} --prefer-registry  (use ${entry.runtime}, update config)\n` +
        `  Or run: claw-farm migrate-runtime ${projectName} --to <runtime>`,
      );
    }
    if (preferConfig) {
      // Use config.runtime — persist it back to registry
      entry.runtime = config.runtime;
      await withLock(async () => {
        const reg = await loadRegistry();
        const regEntry = reg.projects[projectName];
        if (regEntry) regEntry.runtime = config.runtime;
        await saveRegistry(reg);
      });
      console.log(`   Resolved: using ${config.runtime} (--prefer-config, registry updated)`);
    } else {
      // preferRegistry: use entry.runtime — persist it to config
      const updatedConfig = { ...config, runtime: entry.runtime };
      await writeProjectConfig(projectDir, updatedConfig);
      console.log(`   Resolved: using ${entry.runtime} (--prefer-registry, config updated)`);
    }
  }

  const { runtimeType, runtime, proxyMode: resolvedProxyMode } = resolveRuntimeConfig(config, entry);
  const rtDir = runtime.runtimeDirName;

  console.log(`\n🔄 Upgrading ${projectName} to latest claw-farm templates...`);
  console.log(`   Runtime: ${runtimeType}`);
  console.log(`   Processor: ${processor}`);
  console.log(`   LLM provider: ${llm}`);
  console.log(`   Port: ${entry.port}`);
  console.log(`   Multi-instance: ${entry.multiInstance ? "yes" : "no"}`);
  console.log(`   Path: ${projectDir}\n`);

  if (projectKindOf(entry).name === "multi") {
    return upgradeMultiInstance(args, projectName, entry, projectDir, processor, llm, runtimeType);
  }

  // --- Single-instance upgrade ---

  // Migrate old directory layout if needed (OpenClaw only)
  if (runtimeType === "openclaw") {
    await migrateSingleInstanceLayout(projectDir);
  }

  const proxyMode = resolvedProxyMode;

  await mkdir(join(projectDir, rtDir, "workspace", "skills"), { recursive: true });
  await mkdir(join(projectDir, "processed"), { recursive: true });
  await mkdir(join(projectDir, "logs"), { recursive: true });
  await ensureRawDirs(projectDir, runtimeType);

  const composeContent =
    processor === "mem0"
      ? mem0ComposeTemplate(projectName, entry.port)
      : runtime.composeTemplate(projectName, entry.port, proxyMode);
  await Bun.write(join(projectDir, COMPOSE_FILENAME), composeContent);
  console.log("✓ Updated docker-compose.openclaw.yml");

  const configPath = join(projectDir, rtDir, runtime.configFileName);
  const forcePolicy = args.includes("--force-policy");
  const templateConfig = runtime.configTemplate(projectName, processor, llm);
  let existingConfig: string | null = null;
  try {
    existingConfig = await Bun.file(configPath).text();
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
    // No existing config
  }
  if (existingConfig) {
    await Bun.write(configPath + ".backup", existingConfig);
    await Bun.write(configPath, runtime.mergeConfig(templateConfig, existingConfig));
    console.log(`✓ Merged ${rtDir}/${runtime.configFileName} (user settings preserved, backup → .backup)`);
  } else {
    await Bun.write(configPath, templateConfig);
    console.log(`✓ Created ${rtDir}/${runtime.configFileName}`);
  }

  // Additional config files (e.g., policy.yaml for openclaw)
  for (const configFile of runtime.additionalConfigFiles) {
    const cfgPath = join(projectDir, rtDir, configFile);
    if (configFile === "policy.yaml") {
      if (forcePolicy) {
        await Bun.write(cfgPath, policyTemplate(projectName));
        console.log(`✓ Overwritten ${rtDir}/${configFile} (--force-policy)`);
      } else {
        try {
          await Bun.file(cfgPath).text();
          console.log(`✓ ${rtDir}/${configFile} already exists — skipped (use --force-policy to overwrite)`);
        } catch (err) {
          if (!isNotFoundError(err)) throw err;
          await Bun.write(cfgPath, policyTemplate(projectName));
          console.log(`✓ Created ${rtDir}/${configFile}`);
        }
      }
    }
  }

  // Update api-proxy — skip if proxyMode=none
  if (proxyMode !== "none") {
    await writeApiProxyFiles(projectDir);
    console.log("✓ Updated api-proxy/ (key isolation + PII filter + secret scan)");
  } else {
    console.log("✓ Skipped api-proxy/ (proxyMode: none)");
  }

  await Bun.write(join(projectDir, ".env.example"), envExampleTemplate(llm, processor));
  console.log("✓ Updated .env.example");

  console.log(`\n✅ ${projectName} upgraded!`);
  console.log(`\n   Not touched: .env, SOUL.md, MEMORY.md, skills/`);
  console.log(`   💡 Custom compose settings? Put them in docker-compose.openclaw.override.yml`);
  console.log(`      (auto-merged on up/down, survives upgrade)`);
  console.log(`   Run: claw-farm up ${projectName}\n`);
}

async function upgradeMultiInstance(
  args: string[],
  projectName: string,
  entry: ProjectEntry,
  projectDir: string,
  processor: "builtin" | "mem0",
  llm: "gemini" | "anthropic" | "openai-compat" = "gemini",
  runtimeType: RuntimeType = "openclaw",
): Promise<void> {
  const runtime = getRuntime(runtimeType);
  const rtDir = runtime.runtimeDirName;
  const config = await readProjectConfig(projectDir);
  const proxyMode: ProxyMode = config?.proxyMode ?? runtime.defaultProxyMode; // upgradeMultiInstance uses passed runtimeType, not entry

  // Upgrade shared template files
  const tmplDir = templateDir(projectDir);
  await ensureTemplateDirs(projectDir);

  const configPath = join(tmplDir, "config", runtime.configFileName);
  const forcePolicy = args.includes("--force-policy");
  const templateConfig = runtime.configTemplate(projectName, processor, llm);
  let existingConfig: string | null = null;
  try {
    existingConfig = await Bun.file(configPath).text();
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
    // No existing config
  }
  if (existingConfig) {
    await Bun.write(configPath + ".backup", existingConfig);
    await Bun.write(configPath, runtime.mergeConfig(templateConfig, existingConfig));
    console.log(`✓ Merged template/config/${runtime.configFileName} (user settings preserved, backup → .backup)`);
  } else {
    await Bun.write(configPath, templateConfig);
    console.log(`✓ Created template/config/${runtime.configFileName}`);
  }

  // Additional config files (e.g., policy.yaml for openclaw)
  for (const configFile of runtime.additionalConfigFiles) {
    const cfgPath = join(tmplDir, "config", configFile);
    if (configFile === "policy.yaml") {
      if (forcePolicy) {
        await Bun.write(cfgPath, policyTemplate(projectName));
        console.log(`✓ Overwritten template/config/${configFile} (--force-policy)`);
      } else {
        try {
          await Bun.file(cfgPath).text();
          console.log(`✓ template/config/${configFile} already exists — skipped (use --force-policy to overwrite)`);
        } catch (err) {
          if (!isNotFoundError(err)) throw err;
          await Bun.write(cfgPath, policyTemplate(projectName));
          console.log(`✓ Created template/config/${configFile}`);
        }
      }
    }
  }

  // Update api-proxy — skip if proxyMode=none
  if (proxyMode !== "none") {
    await writeApiProxyFiles(projectDir);
    console.log("✓ Updated api-proxy/ (key isolation + PII filter + secret scan)");
  } else {
    console.log("✓ Skipped api-proxy/ (proxyMode: none)");
  }

  await Bun.write(join(projectDir, ".env.example"), envExampleTemplate(llm, processor));
  console.log("✓ Updated .env.example");

  // Regenerate per-instance compose files + migrate layout + copy config
  const instances = entry.instances ?? {};
  const instanceIds = Object.keys(instances);
  if (instanceIds.length > 0) {
    let migratedCount = 0;
    for (const userId of instanceIds) {
      // userId comes from Object.keys(instances) so inst is always defined
      const inst = instances[userId]!;
      const instDir = instanceDir(projectDir, userId);

      // Migrate old layout → new layout if needed (OpenClaw only)
      if (runtimeType === "openclaw") {
        const migrated = await migrateInstanceLayout(instDir, join(tmplDir, "config"));
        if (migrated) migratedCount++;
      }

      // Ensure all required directories exist
      await ensureInstanceDirs(projectDir, userId, runtimeType);

      // Merge template config into instance (preserves per-instance customizations)
      const instConfigPath = join(instDir, rtDir, runtime.configFileName);
      const tmplConfigContent = await Bun.file(join(tmplDir, "config", runtime.configFileName)).text().catch(() => "");
      if (tmplConfigContent) {
        const instConfigContent = await Bun.file(instConfigPath).text().catch(() => "");
        if (instConfigContent) {
          await Bun.write(instConfigPath, runtime.mergeConfig(tmplConfigContent, instConfigContent));
        } else {
          await Bun.write(instConfigPath, tmplConfigContent);
        }
      }

      // Additional config files: only copy if instance doesn't have one yet
      for (const configFile of runtime.additionalConfigFiles) {
        const instCfgPath = join(instDir, rtDir, configFile);
        if (!await fileExists(instCfgPath)) {
          await copyFile(join(tmplDir, "config", configFile), instCfgPath);
        }
      }

      // Copy shared template files (SOUL.md, AGENTS.md, skills/) into instance workspace
      await copyTemplateFiles(tmplDir, join(instDir, rtDir, "workspace"));

      // Regenerate compose
      const composeContent = runtime.instanceComposeTemplate(projectName, userId, inst.port, proxyMode);
      await Bun.write(join(instDir, COMPOSE_FILENAME), composeContent);
    }
    console.log(`✓ Updated ${instanceIds.length} instance(s) (compose + template files + directories)`);
    if (migratedCount > 0) {
      console.log(`  📦 Migrated ${migratedCount} instance(s) to directory mount layout`);
    }
  }

  console.log(`\n✅ ${projectName} upgraded!`);
  console.log(`\n   Not touched: .env, SOUL.md, AGENTS.md, skills/, USER.md, MEMORY.md`);
  console.log(`   💡 Custom compose settings? Put them in docker-compose.openclaw.override.yml`);
  console.log(`      (auto-merged on up/down, survives upgrade)`);
  console.log(`   Run: claw-farm up ${projectName}\n`);
}
