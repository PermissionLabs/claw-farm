/**
 * Programmatic API for claw-farm.
 * Import from "@permissionlabs/claw-farm" to spawn/despawn instances from code.
 *
 * Both CLI commands and external callers use these functions.
 */

import { join } from "node:path";
import {
  resolveProjectName,
  addInstance,
  removeInstance,
  listInstances as registryListInstances,
  getInstance,
  validateName,
  type InstanceEntry,
} from "./registry.ts";
import { readProjectConfig } from "./config.ts";
import { ensureInstanceDirs, instanceDir, templateDir } from "./instance.ts";
import { instanceComposeTemplate } from "../templates/docker-compose.instance.yml.ts";
import { fillContext } from "../templates/CONTEXT.template.md.ts";
import { runCompose } from "./compose.ts";
import { migrateToMulti } from "./migrate.ts";

export type { InstanceEntry };

export async function spawn(options: {
  project: string;
  userId: string;
  context?: Record<string, string>;
  autoStart?: boolean;
}): Promise<{ userId: string; port: number }> {
  const { project, userId, context, autoStart = true } = options;

  // Validate userId (security: prevents path traversal via programmatic API)
  validateName(userId, "user ID");

  const { name: projectName, entry } = await resolveProjectName(project);
  const projectDir = entry.path;
  const config = await readProjectConfig(projectDir);

  // Auto-migrate if needed
  if (!entry.multiInstance && !config?.multiInstance) {
    await migrateToMulti(projectName, projectDir);
  }

  // Register instance (validates userId again, acquires lock)
  const { port } = await addInstance(projectName, userId);

  // From here, if anything fails, we must roll back the registry entry
  try {
    // Create instance dirs
    const instDir = await ensureInstanceDirs(projectDir, userId);

    // Fill CONTEXT.md — only write if file doesn't already exist (preserve on re-spawn with --keep-data)
    const contextPath = join(instDir, "CONTEXT.md");
    if (!await fileExists(contextPath)) {
      const tmplDir = templateDir(projectDir);
      let contextContent: string;
      try {
        const template = await Bun.file(join(tmplDir, "CONTEXT.template.md")).text();
        contextContent = fillContext(template, userId, context);
      } catch {
        contextContent = `# ${projectName} — Context\n\n- User ID: ${userId}\n`;
        if (context && Object.keys(context).length > 0) {
          contextContent += "\n## Details\n";
          for (const [k, v] of Object.entries(context)) {
            contextContent += `- ${k}: ${v}\n`;
          }
        }
      }
      await Bun.write(contextPath, contextContent);
    }

    // Initial MEMORY.md — only write if file doesn't already exist
    const memoryPath = join(instDir, "MEMORY.md");
    if (!await fileExists(memoryPath)) {
      await Bun.write(
        memoryPath,
        `# ${projectName} — Memory (${userId})\n\n> This file is updated automatically as the agent learns from conversations.\n`,
      );
    }

    // Write compose (always regenerate)
    const composeContent = instanceComposeTemplate(projectName, userId, port);
    const composePath = join(instDir, "docker-compose.openclaw.yml");
    await Bun.write(composePath, composeContent);

    // Start if requested
    if (autoStart) {
      await runCompose(projectDir, "up", {
        composePath,
        projectName: `${projectName}-${userId}`,
      });
    }

    return { userId, port };
  } catch (err) {
    // Rollback: remove from registry on failure
    try {
      await removeInstance(projectName, userId);
    } catch {
      // Best effort rollback
    }
    throw err;
  }
}

export async function despawn(
  project: string,
  userId: string,
  options?: { keepData?: boolean },
): Promise<void> {
  validateName(userId, "user ID");

  const { name: projectName, entry } = await resolveProjectName(project);
  const projectDir = entry.path;

  const instance = await getInstance(projectName, userId);
  if (!instance) {
    throw new Error(`Instance for user "${userId}" not found in "${projectName}"`);
  }

  // Stop containers first
  const instDir = instanceDir(projectDir, userId);
  const composePath = join(instDir, "docker-compose.openclaw.yml");
  try {
    await runCompose(projectDir, "down", {
      composePath,
      projectName: `${projectName}-${userId}`,
    });
  } catch (err) {
    console.warn(`⚠ Could not stop containers: ${(err as Error).message}`);
  }

  // Remove data before registry (if data removal fails, registry still has the entry for retry)
  if (!options?.keepData) {
    const { rm } = await import("node:fs/promises");
    await rm(instDir, { recursive: true, force: true });
  }

  // Remove from registry last (after cleanup is done)
  await removeInstance(projectName, userId);
}

export async function listInstances(
  project: string,
): Promise<InstanceEntry[]> {
  const { name: projectName } = await resolveProjectName(project);
  return registryListInstances(projectName);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Bun.file(path).text();
    return true;
  } catch {
    return false;
  }
}
