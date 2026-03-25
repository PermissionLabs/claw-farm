import { join } from "node:path";
import { mkdir, cp, readdir } from "node:fs/promises";
import { loadRegistry, saveRegistry } from "./registry.ts";
import { readProjectConfig, writeProjectConfig } from "./config.ts";
import { ensureTemplateDirs, templateDir } from "./instance.ts";
import { userTemplateContent } from "../templates/USER.template.md.ts";

/**
 * Migrate a single-instance project to multi-instance mode.
 *
 * 1. Create template/ from existing workspace files (SOUL.md, AGENTS.md, skills/, config/)
 * 2. Create instances/default/ from existing user data (MEMORY.md, raw/, processed/)
 * 3. Set multiInstance: true in registry and config
 * 4. Update .gitignore
 */
export async function migrateToMulti(
  projectName: string,
  projectDir: string,
): Promise<void> {
  // Idempotency: check if already migrated
  const config = await readProjectConfig(projectDir);
  if (config?.multiInstance) return;

  const wsDir = join(projectDir, "openclaw", "workspace");
  const tmplDir = templateDir(projectDir);

  // Step 1: Create template/ from existing shared files
  await ensureTemplateDirs(projectDir);

  await copyIfExists(join(wsDir, "SOUL.md"), join(tmplDir, "SOUL.md"));
  await copyIfExists(join(wsDir, "AGENTS.md"), join(tmplDir, "AGENTS.md"));

  // Ensure AGENTS.md exists in template (even if source didn't have one)
  if (!await fileExists(join(tmplDir, "AGENTS.md"))) {
    await Bun.write(join(tmplDir, "AGENTS.md"), `# ${projectName} — Agents\n\n> Shared behavior rules for all instances.\n`);
  }

  // Copy skills/ → template/skills/
  try {
    const skillsDir = join(wsDir, "skills");
    const files = await readdir(skillsDir);
    await mkdir(join(tmplDir, "skills"), { recursive: true });
    for (const file of files) {
      await cp(join(skillsDir, file), join(tmplDir, "skills", file), { recursive: true });
    }
  } catch {
    // No skills directory
  }

  // Copy config/ → template/config/
  const configSrcDir = join(projectDir, "openclaw", "config");
  try {
    const files = await readdir(configSrcDir);
    await mkdir(join(tmplDir, "config"), { recursive: true });
    for (const file of files) {
      await cp(join(configSrcDir, file), join(tmplDir, "config", file), { recursive: true });
    }
  } catch {
    // No config files
  }

  // Create USER.template.md
  await Bun.write(
    join(tmplDir, "USER.template.md"),
    userTemplateContent(projectName),
  );

  // Step 2: Migrate existing user data to instances/default/
  const defaultInstDir = join(projectDir, "instances", "default");
  await mkdir(join(defaultInstDir, "raw", "sessions"), { recursive: true, mode: 0o700 });
  await mkdir(join(defaultInstDir, "raw", "workspace-snapshots"), { recursive: true, mode: 0o700 });
  await mkdir(join(defaultInstDir, "processed"), { recursive: true, mode: 0o700 });
  await mkdir(join(defaultInstDir, "logs"), { recursive: true, mode: 0o700 });

  // Move MEMORY.md to default instance
  await copyIfExists(join(wsDir, "MEMORY.md"), join(defaultInstDir, "MEMORY.md"));

  // Create a USER.md for the default instance
  if (!await fileExists(join(defaultInstDir, "USER.md"))) {
    await Bun.write(
      join(defaultInstDir, "USER.md"),
      `# ${projectName} — User Profile (default)\n\n- User ID: default\n- Migrated from single-instance mode\n`,
    );
  }

  // Copy raw session logs
  const rawSessionsSrc = join(projectDir, "openclaw", "raw", "sessions");
  try {
    const files = await readdir(rawSessionsSrc);
    for (const file of files) {
      await cp(
        join(rawSessionsSrc, file),
        join(defaultInstDir, "raw", "sessions", file),
        { recursive: true },
      );
    }
  } catch {
    // No session logs
  }

  // Copy workspace snapshots
  const snapshotsSrc = join(projectDir, "openclaw", "raw", "workspace-snapshots");
  try {
    const files = await readdir(snapshotsSrc);
    for (const file of files) {
      await cp(
        join(snapshotsSrc, file),
        join(defaultInstDir, "raw", "workspace-snapshots", file),
        { recursive: true },
      );
    }
  } catch {
    // No snapshots
  }

  // Copy processed/
  const processedSrc = join(projectDir, "openclaw", "processed");
  try {
    const files = await readdir(processedSrc);
    for (const file of files) {
      await cp(
        join(processedSrc, file),
        join(defaultInstDir, "processed", file),
        { recursive: true },
      );
    }
  } catch {
    // No processed data
  }

  // Step 3: Update .gitignore (single write, no double-write bug)
  const gitignorePath = join(projectDir, ".gitignore");
  let gitignoreContent = "";
  try {
    gitignoreContent = await Bun.file(gitignorePath).text();
  } catch {
    // No .gitignore yet
  }

  let modified = false;
  if (!gitignoreContent.includes("instances/")) {
    gitignoreContent += "\n# Per-user instance data (claw-farm multi-instance)\ninstances/\n";
    modified = true;
  }
  if (!gitignoreContent.includes("*.env")) {
    gitignoreContent += "*.env\n";
    modified = true;
  }
  if (modified) {
    await Bun.write(gitignorePath, gitignoreContent);
  }

  // Step 4: Set multiInstance in registry and config
  const reg = await loadRegistry();
  const project = reg.projects[projectName];
  if (project) {
    project.multiInstance = true;
    if (!project.instances) project.instances = {};
    await saveRegistry(reg);
  }

  if (config) {
    config.multiInstance = true;
    await writeProjectConfig(projectDir, config);
  }
}

async function copyIfExists(src: string, dest: string): Promise<void> {
  try {
    const content = await Bun.file(src).text();
    await Bun.write(dest, content);
  } catch {
    // Source doesn't exist — skip
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Bun.file(path).text();
    return true;
  } catch {
    return false;
  }
}
