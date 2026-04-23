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
  addProject,
  addInstance,
  removeInstance,
  listInstances as registryListInstances,
  getInstance,
  getProject,
  loadRegistry,
  saveRegistry,
  withLock,
  validateName,
  type InstanceEntry,
  type ProjectEntry,
} from "./registry.ts";
import { readProjectConfig, resolveRuntimeConfig, writeProjectConfig, envExampleTemplate, type LlmProvider } from "./config.ts";
import { fileExists } from "./fs-utils.ts";
import { writeSecret } from "./secret-file.ts";
import { ensureInstanceDirs, instanceDir, templateDir, ensureTemplateDirs } from "./instance.ts";
import { fillUserTemplate, userTemplateContent } from "../templates/USER.template.md.ts";
import { runCompose, COMPOSE_FILENAME } from "./compose.ts";
import { migrateToMulti } from "./migrate.ts";
import { ensureRawDirs } from "./raw-collector.ts";
import { getRuntime, type RuntimeType } from "../runtimes/index.ts";
import type { ProxyMode } from "../runtimes/interface.ts";
import { validateProcessorRuntimeCombo } from "./validate-config.ts";
import { builtinProcessor } from "../processors/builtin.ts";
import { mem0Processor } from "../processors/mem0.ts";
import { soulTemplate } from "../templates/SOUL.md.ts";
import { policyTemplate } from "../templates/policy.yaml.ts";
import { writeApiProxyFiles } from "../templates/api-proxy.ts";
import { mem0ComposeTemplate } from "../templates/docker-compose.mem0.yml.ts";

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
 * Scaffold a new claw-farm project programmatically (BKLG-015).
 *
 * Encapsulates all file-system writes performed by `claw-farm init`.
 * Returns the project path and assigned port.
 */
export async function initProject(options: {
  name: string;
  runtime?: RuntimeType;
  proxyMode?: ProxyMode;
  processor?: "builtin" | "mem0";
  llm?: LlmProvider;
  multi?: boolean;
  registerExisting?: boolean;
  path?: string;
}): Promise<{ path: string; port: number }> {
  const {
    name,
    processor = "builtin",
    llm = "gemini",
    multi = false,
    registerExisting = false,
  } = options;

  const runtimeType: RuntimeType = options.runtime ?? "openclaw";
  const runtime = getRuntime(runtimeType);
  const proxyMode: ProxyMode = options.proxyMode ?? runtime.defaultProxyMode;
  const projectDir = options.path ?? join(process.cwd(), name);

  // Fail fast if combination is unsupported
  validateProcessorRuntimeCombo(processor, runtimeType);

  if (multi) {
    return _initMulti({ name, projectDir, processor, llm, runtimeType, proxyMode, runtime });
  }

  // Register in global registry
  const entry = await addProject(name, projectDir, processor, runtimeType);

  if (registerExisting) {
    return _registerExisting({ name, projectDir, processor, llm, runtimeType, proxyMode, runtime, entry });
  }

  const rtDir = runtime.runtimeDirName;

  // Create directory structure
  await mkdir(join(projectDir, rtDir, "workspace", "skills"), { recursive: true });
  if (runtimeType === "picoclaw") {
    await mkdir(join(projectDir, rtDir, "workspace", "sessions"), { recursive: true });
    await mkdir(join(projectDir, rtDir, "workspace", "state"), { recursive: true });
  }
  await mkdir(join(projectDir, "processed"), { recursive: true });
  await mkdir(join(projectDir, "logs"), { recursive: true });
  await ensureRawDirs(projectDir, runtimeType);

  // Write docker-compose
  const composeContent =
    processor === "mem0"
      ? mem0ComposeTemplate(name, entry.port)
      : runtime.composeTemplate(name, entry.port, proxyMode);
  await Bun.write(join(projectDir, COMPOSE_FILENAME), composeContent);

  // Write runtime config
  await Bun.write(
    join(projectDir, rtDir, runtime.configFileName),
    runtime.configTemplate(name, processor, llm),
  );

  // Write additional config files
  for (const configFile of runtime.additionalConfigFiles) {
    if (configFile === "policy.yaml") {
      await Bun.write(join(projectDir, rtDir, configFile), policyTemplate(name));
    }
  }

  // Write API Proxy sidecar — skip if proxyMode=none
  if (proxyMode !== "none") {
    await writeApiProxyFiles(projectDir);
  }

  // Write SOUL.md
  await Bun.write(join(projectDir, rtDir, "workspace", "SOUL.md"), soulTemplate(name));

  // Write initial MEMORY.md
  const memoryDir = runtimeType === "picoclaw"
    ? join(projectDir, rtDir, "workspace", "memory")
    : join(projectDir, rtDir, "workspace");
  await mkdir(memoryDir, { recursive: true });
  await Bun.write(
    join(memoryDir, "MEMORY.md"),
    `# ${name} — Memory\n\n> This file is updated automatically as the agent learns from conversations.\n`,
  );

  // Write project config
  await writeProjectConfig(projectDir, {
    name,
    processor,
    port: entry.port,
    createdAt: entry.createdAt,
    llm,
    runtime: runtimeType,
    ...(proxyMode !== runtime.defaultProxyMode ? { proxyMode } : {}),
  });

  // Init processor-specific files
  if (processor === "mem0") {
    await mem0Processor.init(projectDir);
  } else {
    await builtinProcessor.init(projectDir);
  }

  // Write .env.example if not exists
  if (!await Bun.file(join(projectDir, ".env.example")).exists()) {
    await writeSecret(join(projectDir, ".env.example"), envExampleTemplate(llm, processor));
  }

  return { path: projectDir, port: entry.port };
}

async function _initMulti(opts: {
  name: string;
  projectDir: string;
  processor: "builtin" | "mem0";
  llm: LlmProvider;
  runtimeType: RuntimeType;
  proxyMode: ProxyMode;
  runtime: ReturnType<typeof getRuntime>;
}): Promise<{ path: string; port: number }> {
  const { name, projectDir, processor, llm, runtimeType, proxyMode, runtime } = opts;

  const entry = await addProject(name, projectDir, processor, runtimeType);

  await withLock(async () => {
    const reg = await loadRegistry();
    const proj = reg.projects[name];
    if (!proj) throw new Error(`Project "${name}" not found in registry after addProject`);
    proj.multiInstance = true;
    proj.instances = {};
    proj.runtime = runtimeType;
    await saveRegistry(reg);
  });

  const tmplDir = templateDir(projectDir);
  await ensureTemplateDirs(projectDir);
  await mkdir(join(projectDir, "logs"), { recursive: true });

  await Bun.write(join(tmplDir, "SOUL.md"), soulTemplate(name));
  await Bun.write(join(tmplDir, "AGENTS.md"), `# ${name} — Agents\n\n> Shared behavior rules for all instances.\n`);
  await Bun.write(join(tmplDir, "USER.template.md"), userTemplateContent(name));

  await Bun.write(
    join(tmplDir, "config", runtime.configFileName),
    runtime.configTemplate(name, processor, llm),
  );
  for (const configFile of runtime.additionalConfigFiles) {
    if (configFile === "policy.yaml") {
      await Bun.write(join(tmplDir, "config", configFile), policyTemplate(name));
    }
  }

  if (proxyMode !== "none") {
    await writeApiProxyFiles(projectDir);
  }

  await writeSecret(join(projectDir, ".env.example"), envExampleTemplate(llm, processor));

  await Bun.write(
    join(projectDir, ".gitignore"),
    `# Per-user instance data (claw-farm multi-instance)\ninstances/\n*.env\n`,
  );

  if (proxyMode === "shared" && runtime.proxyComposeTemplate) {
    await Bun.write(join(projectDir, "docker-compose.proxy.yml"), runtime.proxyComposeTemplate(name));
  }

  await writeProjectConfig(projectDir, {
    name,
    processor,
    port: entry.port,
    createdAt: entry.createdAt,
    multiInstance: true,
    llm,
    runtime: runtimeType,
    ...(proxyMode !== runtime.defaultProxyMode ? { proxyMode } : {}),
  });

  if (processor === "mem0") {
    await mem0Processor.init(projectDir);
  }

  return { path: projectDir, port: entry.port };
}

async function _registerExisting(opts: {
  name: string;
  projectDir: string;
  processor: "builtin" | "mem0";
  llm: LlmProvider;
  runtimeType: RuntimeType;
  proxyMode: ProxyMode;
  runtime: ReturnType<typeof getRuntime>;
  entry: { port: number; createdAt: string };
}): Promise<{ path: string; port: number }> {
  const { name, projectDir, processor, llm, runtimeType, proxyMode, runtime, entry } = opts;
  const rtDir = runtime.runtimeDirName;

  await mkdir(join(projectDir, rtDir, "workspace"), { recursive: true });
  await mkdir(join(projectDir, "processed"), { recursive: true });
  await mkdir(join(projectDir, "logs"), { recursive: true });
  await ensureRawDirs(projectDir, runtimeType);

  const composePath = join(projectDir, COMPOSE_FILENAME);
  const composeContent =
    processor === "mem0"
      ? mem0ComposeTemplate(name, entry.port)
      : runtime.composeTemplate(name, entry.port, proxyMode);
  await Bun.write(composePath, composeContent);

  const configPath = join(projectDir, rtDir, runtime.configFileName);
  try {
    const existingContent = await Bun.file(configPath).text();
    await Bun.write(configPath + ".backup", existingContent);
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
  }
  await Bun.write(configPath, runtime.configTemplate(name, processor, llm));

  for (const configFile of runtime.additionalConfigFiles) {
    const cfgPath = join(projectDir, rtDir, configFile);
    try {
      await Bun.file(cfgPath).text();
    } catch (err) {
      if (!isNotFoundError(err)) throw err;
      if (configFile === "policy.yaml") {
        await Bun.write(cfgPath, policyTemplate(name));
      }
    }
  }

  if (proxyMode !== "none") {
    if (!await Bun.file(join(projectDir, "api-proxy", "api_proxy.py")).exists()) {
      await writeApiProxyFiles(projectDir);
    }
  }

  const envExamplePath = join(projectDir, ".env.example");
  const envExampleFile = Bun.file(envExamplePath);
  if (!await envExampleFile.exists()) {
    await Bun.write(envExamplePath, envExampleTemplate(llm, processor));
  }

  await writeProjectConfig(projectDir, {
    name,
    processor,
    port: entry.port,
    createdAt: entry.createdAt,
    llm,
    runtime: runtimeType,
    ...(proxyMode !== runtime.defaultProxyMode ? { proxyMode } : {}),
  });

  return { path: projectDir, port: entry.port };
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
