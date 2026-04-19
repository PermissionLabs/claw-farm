/**
 * Programmatic API for claw-farm.
 * Import from "@permissionlabs/claw-farm" to spawn/despawn instances from code.
 *
 * Both CLI commands and external callers use these functions.
 */

import { join } from "node:path";
import { mkdir, readdir, cp, rm } from "node:fs/promises";
import { isNotFoundError } from "./errors.ts";
import {
  resolveProjectName,
  addInstance,
  removeInstance,
  listInstances as registryListInstances,
  getInstance,
  getProject,
  validateName,
  type InstanceEntry,
  type ProjectEntry,
} from "./registry.ts";
import { readProjectConfig, resolveRuntimeConfig } from "./config.ts";
import { fileExists } from "./fs-utils.ts";
import { writeSecret } from "./secret-file.ts";
import { ensureInstanceDirs, instanceDir, templateDir } from "./instance.ts";
import { fillUserTemplate } from "../templates/USER.template.md.ts";
import { runCompose, COMPOSE_FILENAME } from "./compose.ts";
import { migrateToMulti } from "./migrate.ts";

export type { InstanceEntry, ProjectEntry };
export { getInstance, getProject };

const ENV_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Characters that are forbidden in .env file values (BKLG-012)
const FORBIDDEN_VALUE_CHARS: Array<{ char: string; display: string }> = [
  { char: '"', display: '"' },
  { char: "'", display: "'" },
  { char: "`", display: "`" },
  { char: "\\", display: "\\" },
  { char: "\0", display: "\\0 (null byte)" },
  { char: "$(", display: "$(" },
  { char: "$`", display: "$`" },
];

function validateEnvEntry(key: string, value: string): string {
  if (!ENV_KEY_REGEX.test(key)) {
    throw new Error(`Invalid env var key: "${key}"`);
  }
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error(`Env var "${key}" contains newline characters`);
  }
  for (const { char, display } of FORBIDDEN_VALUE_CHARS) {
    if (value.includes(char)) {
      throw new Error(
        `Env var "${key}" contains forbidden character '${display}' (values cannot contain quotes, backslashes, null bytes, or command substitution sequences)`,
      );
    }
  }
  return `${key}=${value}`;
}

async function resolveInstance(project: string, userId: string) {
  validateName(userId, "user ID");
  const { name: projectName, entry } = await resolveProjectName(project);
  const projectDir = entry.path;
  const instance = await getInstance(projectName, userId);
  if (!instance) {
    throw new Error(`Instance for user "${userId}" not found in "${projectName}"`);
  }
  const instDir = instanceDir(projectDir, userId);
  return {
    projectName, projectDir, entry, instance, instDir,
    composePath: join(instDir, COMPOSE_FILENAME),
    composeProject: `${projectName}-${userId}`,
  };
}

/**
 * Spawn a new instance from a project template.
 *
 * On failure, the registry entry, instance directory, and any partially-started
 * containers are rolled back automatically (unless `rollbackOnFailure` is false).
 */
export async function spawn(options: {
  project: string;
  userId: string;
  context?: Record<string, string>;
  env?: Record<string, string>;
  autoStart?: boolean;
  /** Set to false to skip automatic rollback on failure. Default: true. */
  rollbackOnFailure?: boolean;
}): Promise<{ userId: string; port: number }> {
  const { project, userId, context, env, autoStart = true, rollbackOnFailure = true } = options;

  // Validate userId (security: prevents path traversal via programmatic API)
  validateName(userId, "user ID");

  const { name: projectName, entry } = await resolveProjectName(project);
  const projectDir = entry.path;
  const config = await readProjectConfig(projectDir);

  // Determine runtime
  const { runtimeType, runtime, proxyMode } = resolveRuntimeConfig(config, entry);

  // Auto-migrate if needed
  if (!entry.multiInstance && !config?.multiInstance) {
    await migrateToMulti(projectName, projectDir);
  }

  // Register instance (validates userId again, acquires lock)
  const { port } = await addInstance(projectName, userId);

  // From here, if anything fails, we must roll back the registry entry
  try {
    // Create instance dirs (runtime-aware)
    const instDir = await ensureInstanceDirs(projectDir, userId, runtimeType);
    const rtDir = runtime.runtimeDirName;

    // Copy config files from template to instance
    const tmplDir = templateDir(projectDir);

    // Copy main config file + additional config files in parallel
    const configFilesToCopy = [
      { src: join(tmplDir, "config", runtime.configFileName), dest: join(instDir, rtDir, runtime.configFileName) },
      ...runtime.additionalConfigFiles.map((f) => ({
        src: join(tmplDir, "config", f),
        dest: join(instDir, rtDir, f),
      })),
    ];
    await Promise.all(configFilesToCopy.map(async ({ src, dest }) => {
      const file = Bun.file(src);
      if (await file.exists()) {
        await Bun.write(dest, await file.arrayBuffer());
      }
    }));

    // Copy shared template files (SOUL.md, AGENTS.md, skills/) into instance workspace
    const workspaceDir = join(instDir, rtDir, "workspace");
    await copyTemplateFiles(tmplDir, workspaceDir);

    // Fill USER.md — only write if file doesn't already exist (preserve on re-spawn with --keep-data)
    const userPath = join(instDir, rtDir, "workspace", "USER.md");
    if (!await fileExists(userPath)) {
      let userContent: string;
      try {
        const template = await Bun.file(join(tmplDir, "USER.template.md")).text();
        userContent = fillUserTemplate(template, userId, context);
      } catch (err) {
        if (!isNotFoundError(err)) throw err;
        userContent = `# ${projectName} — User Profile\n\n- User ID: ${userId}\n`;
        if (context && Object.keys(context).length > 0) {
          userContent += "\n## Details\n";
          for (const [k, v] of Object.entries(context)) {
            userContent += `- ${k}: ${v}\n`;
          }
        }
      }
      await Bun.write(userPath, userContent);
    }

    // Initial MEMORY.md — only write if file doesn't already exist
    // picoclaw uses workspace/memory/MEMORY.md, openclaw uses workspace/MEMORY.md
    const memoryPath = runtimeType === "picoclaw"
      ? join(instDir, rtDir, "workspace", "memory", "MEMORY.md")
      : join(instDir, rtDir, "workspace", "MEMORY.md");
    if (!await fileExists(memoryPath)) {
      await Bun.write(
        memoryPath,
        `# ${projectName} — Memory (${userId})\n\n> This file is updated automatically as the agent learns from conversations.\n`,
      );
    }

    const envContent = env
      ? Object.entries(env).map(([k, v]) => validateEnvEntry(k, v)).join("\n") + "\n"
      : "";
    await writeSecret(join(instDir, "instance.env"), envContent);

    // Write compose (always regenerate)
    const composeContent = runtime.instanceComposeTemplate(projectName, userId, port, proxyMode);
    const composePath = join(instDir, COMPOSE_FILENAME);
    await Bun.write(composePath, composeContent);

    // Start if requested
    if (autoStart) {
      // Ensure shared proxy is running (generates compose if needed, starts it)
      if (proxyMode === "shared" && runtime.supportsSharedProxy) {
        const proxyComposePath = join(projectDir, "docker-compose.proxy.yml");
        if (!await Bun.file(proxyComposePath).exists()) {
          // Generate proxy compose if missing
          if (runtime.proxyComposeTemplate) {
            await Bun.write(proxyComposePath, runtime.proxyComposeTemplate(projectName));
          }
        }
        await runCompose(projectDir, "up", {
          composePath: proxyComposePath,
          projectName: `${projectName}-proxy`,
        });
      }

      // For shared proxy mode: after compose up, connect the shared api-proxy
      // container to this instance's isolated network (hub-and-spoke topology).
      // Docker Compose v2 names networks as: {project}_{network}
      const composeProject = `${projectName}-${userId}`;
      const connectContainer = runtime.connectContainerFor({ proxyMode, projectName, userId }) ?? undefined;

      await runCompose(projectDir, "up", {
        composePath,
        projectName: composeProject,
        connectContainer,
      });
    }

    return { userId, port };
  } catch (err) {
    if (rollbackOnFailure) {
      // Rollback registry entry
      try {
        await removeInstance(projectName, userId);
      } catch {
        // Best effort rollback
      }
      // Rollback instance directory
      const instDir = instanceDir(projectDir, userId);
      try {
        await rm(instDir, { recursive: true, force: true });
      } catch {
        // Best effort rollback
      }
      // Rollback any partially-started containers
      const composeProject = `${projectName}-${userId}`;
      try {
        // intentional: best-effort teardown after spawn failure
        const proc = Bun.spawn(
          ["docker", "compose", "-p", composeProject, "down", "-v"],
          { stderr: "pipe", stdout: "pipe" },
        );
        await proc.exited;
      } catch {
        // intentional: best-effort teardown after spawn failure
      }
    }
    throw err;
  }
}

export async function despawn(
  project: string,
  userId: string,
  options?: { keepData?: boolean },
): Promise<void> {
  const { projectName, projectDir, entry, instDir, composePath, composeProject } =
    await resolveInstance(project, userId);

  const config = await readProjectConfig(projectDir);
  const { runtime, proxyMode } = resolveRuntimeConfig(config, entry);
  const connectContainer = runtime.connectContainerFor({ proxyMode, projectName, userId }) ?? undefined;

  try {
    await runCompose(projectDir, "down", {
      composePath,
      projectName: composeProject,
      connectContainer,
    });
  } catch (err) {
    console.warn(`⚠ Could not stop containers: ${(err as Error).message}`);
  }

  if (!options?.keepData) {
    await rm(instDir, { recursive: true, force: true });
  }

  await removeInstance(projectName, userId);
}

/**
 * Stop a running instance's containers without destroying them.
 * Data, volumes, and registry entry are preserved.
 */
export async function stopInstance(
  project: string,
  userId: string,
): Promise<void> {
  const { projectDir, composePath, composeProject } =
    await resolveInstance(project, userId);

  await runCompose(projectDir, "stop", { composePath, projectName: composeProject });
}

/**
 * Start a previously stopped instance's containers.
 * Containers must already exist (created by spawn).
 */
export async function startInstance(
  project: string,
  userId: string,
): Promise<{ port: number }> {
  const { projectDir, instance, composePath, composeProject } =
    await resolveInstance(project, userId);

  await runCompose(projectDir, "start", { composePath, projectName: composeProject });

  return { port: instance.port };
}

export async function listInstances(
  project: string,
): Promise<InstanceEntry[]> {
  const { name: projectName } = await resolveProjectName(project);
  return registryListInstances(projectName);
}

/**
 * Copy shared template files (SOUL.md, AGENTS.md, skills/) into instance workspace.
 * Always overwrites — template changes should propagate to all instances.
 */
export async function copyTemplateFiles(
  tmplDir: string,
  workspaceDir: string,
  sharedFiles: string[] = ["SOUL.md", "AGENTS.md"],
): Promise<void> {
  await mkdir(workspaceDir, { recursive: true });
  // Copy individual shared files
  for (const file of sharedFiles) {
    const src = Bun.file(join(tmplDir, file));
    if (await src.exists()) {
      await Bun.write(join(workspaceDir, file), await src.arrayBuffer());
    }
  }
  // Copy skills/ directory
  const skillsSrc = join(tmplDir, "skills");
  const skillsDest = join(workspaceDir, "skills");
  try {
    const files = await readdir(skillsSrc);
    await mkdir(skillsDest, { recursive: true });
    for (const file of files) {
      await cp(join(skillsSrc, file), join(skillsDest, file), { recursive: true });
    }
  } catch {
    // No skills directory in template
  }
}
