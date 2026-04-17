import { SAFE_NAME_REGEX, findPositionalArg } from "../lib/registry.ts";
import { despawn } from "../lib/api.ts";

export async function despawnCommand(args: string[]): Promise<void> {
  const projectArg = findPositionalArg(args);
  if (!projectArg) {
    console.error("Usage: claw-farm despawn <project> --user <id> [--keep-data]");
    process.exit(1);
  }

  const userIdx = args.indexOf("--user");
  const userIdRaw = userIdx !== -1 ? args[userIdx + 1] : undefined;
  if (!userIdRaw) {
    console.error("Missing --user <id>");
    process.exit(1);
  }
  const userId = userIdRaw;
  const keepData = args.includes("--keep-data");

  // Validate userId early for better CLI error messages
  if (!SAFE_NAME_REGEX.test(userId)) {
    console.error(`Invalid user ID: "${userId}". Use lowercase letters, numbers, hyphens, and underscores.`);
    process.exit(1);
  }

  console.log(`\n■ Despawning instance "${userId}" from ${projectArg}...`);

  await despawn(projectArg, userId, { keepData });

  if (keepData) {
    console.log(`✓ Instance data preserved at: instances/${userId}/`);
  }
  console.log(`\n✅ Instance "${userId}" despawned from ${projectArg}.`);
}
