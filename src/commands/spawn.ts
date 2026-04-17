import { resolveProjectName, findPositionalArg } from "../lib/registry.ts";
import { readProjectConfig } from "../lib/config.ts";
import { migrateToMulti } from "../lib/migrate.ts";
import { spawn } from "../lib/api.ts";
import { SAFE_NAME_REGEX } from "../lib/registry.ts";

export async function spawnCommand(args: string[]): Promise<void> {
  const projectArg = findPositionalArg(args);
  if (!projectArg) {
    console.error("Usage: claw-farm spawn <project> --user <id> [--context k=v k2=v2 ...]");
    process.exit(1);
  }

  const userIdx = args.indexOf("--user");
  const userIdRaw = userIdx !== -1 ? args[userIdx + 1] : undefined;
  if (!userIdRaw) {
    console.error("Missing --user <id>");
    process.exit(1);
  }
  const userId = userIdRaw;

  // Validate userId early for better CLI error messages
  if (!SAFE_NAME_REGEX.test(userId)) {
    console.error(`Invalid user ID: "${userId}". Use lowercase letters, numbers, hyphens, and underscores.`);
    process.exit(1);
  }

  // Parse --context key=value key2=value2 (space-separated, not comma)
  const contextMap: Record<string, string> = {};
  const ctxIdx = args.indexOf("--context");
  if (ctxIdx !== -1) {
    // Consume all following args until the next flag or end
    for (let i = ctxIdx + 1; i < args.length; i++) {
      const arg = args[i];
      if (arg === undefined) continue;
      if (arg.startsWith("--")) break;
      const eqIdx = arg.indexOf("=");
      if (eqIdx === -1) {
        console.error(`Invalid context pair: "${arg}". Use key=value format.`);
        process.exit(1);
      }
      contextMap[arg.slice(0, eqIdx)] = arg.slice(eqIdx + 1);
    }
  }

  const noStart = args.includes("--no-start");

  // Check if migration needed (for logging)
  const { name: projectName, entry } = await resolveProjectName(projectArg);
  const config = await readProjectConfig(entry.path);
  if (!entry.multiInstance && !config?.multiInstance) {
    console.log(`\n🔄 Migrating "${projectName}" to multi-instance mode...`);
    await migrateToMulti(projectName, entry.path);
    console.log(`✓ Migration complete\n`);
  }

  console.log(`\n🐾 Spawning instance for user "${userId}" in ${projectName}...`);

  const { port } = await spawn({
    project: projectArg,
    userId,
    context: Object.keys(contextMap).length > 0 ? contextMap : undefined,
    autoStart: !noStart,
  });

  if (!noStart) {
    console.log(`\n✅ Instance "${userId}" running at http://localhost:${port}`);
  } else {
    console.log(`\n✅ Instance "${userId}" created (not started). Run: claw-farm up ${projectName} --user ${userId}`);
  }
}
