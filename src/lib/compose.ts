import { join, dirname } from "node:path";
import { access } from "node:fs/promises";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface ComposeOptions {
  /** Override compose file path (default: docker-compose.openclaw.yml in projectDir) */
  composePath?: string;
  /** Docker compose project name (-p flag) for container isolation */
  projectName?: string;
}

export async function runCompose(
  projectDir: string,
  action: "up" | "down",
  options?: ComposeOptions,
): Promise<void> {
  const composePath = options?.composePath ?? join(projectDir, "docker-compose.openclaw.yml");
  const cwd = options?.composePath ? dirname(composePath) : projectDir;

  const args = ["docker", "compose", "-f", composePath];

  // Auto-load override file if it exists (user customizations survive upgrade)
  const overridePath = composePath.replace(".yml", ".override.yml");
  if (await fileExists(overridePath)) {
    args.push("-f", overridePath);
  }

  if (options?.projectName) {
    args.push("-p", options.projectName);
  }

  if (action === "up") {
    args.push("up", "-d");
  } else {
    args.push("down");
  }

  const proc = Bun.spawn(args, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`docker compose ${action} failed with exit code ${exitCode}`);
  }
}

export async function getComposeStatus(
  projectDir: string,
  options?: ComposeOptions,
): Promise<"running" | "stopped" | "unknown"> {
  const composePath = options?.composePath ?? join(projectDir, "docker-compose.openclaw.yml");
  const cwd = options?.composePath ? dirname(composePath) : projectDir;

  const args = ["docker", "compose", "-f", composePath];
  if (options?.projectName) {
    args.push("-p", options.projectName);
  }
  args.push("ps", "--format", "json");

  try {
    const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) return "unknown";
    if (!output.trim()) return "stopped";
    return "running";
  } catch {
    return "unknown";
  }
}
