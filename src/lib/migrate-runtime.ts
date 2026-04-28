import { join } from "node:path";
import { mkdir, readdir } from "node:fs/promises";
import { COMPOSE_FILENAME } from "./compose.ts";
import { instanceDir, ensureInstanceDirs } from "./instance.ts";
import { readProjectConfig } from "./config.ts";
import { getRuntime, type RuntimeType, type ProxyMode } from "../runtimes/index.ts";
import { policyTemplate } from "../templates/policy.yaml.ts";
import { fileExists, copyIfExists, copyDirContents } from "./fs-utils.ts";

/**
 * Migrate a single-instance project's workspace files from one runtime to another.
 * Returns list of migrated files for summary.
 */
export async function migrateSingleInstance(
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
export async function migrateInstance(
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
export async function migrateOverrideFile(
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
