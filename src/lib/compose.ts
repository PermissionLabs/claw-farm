import { join } from "node:path";

export async function runCompose(
  projectDir: string,
  action: "up" | "down",
): Promise<void> {
  const composePath = join(projectDir, "docker-compose.openclaw.yml");
  const args =
    action === "up"
      ? ["docker", "compose", "-f", composePath, "up", "-d"]
      : ["docker", "compose", "-f", composePath, "down"];

  const proc = Bun.spawn(args, {
    cwd: projectDir,
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
): Promise<string> {
  const composePath = join(projectDir, "docker-compose.openclaw.yml");
  try {
    const proc = Bun.spawn(
      ["docker", "compose", "-f", composePath, "ps", "--format", "json"],
      { cwd: projectDir, stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    if (!output.trim()) return "stopped";
    return "running";
  } catch {
    return "unknown";
  }
}
