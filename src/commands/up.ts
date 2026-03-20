import { resolveProjectName, loadRegistry } from "../lib/registry.ts";
import { runCompose } from "../lib/compose.ts";
import { snapshotWorkspace } from "../lib/raw-collector.ts";

export async function upCommand(args: string[]): Promise<void> {
  const all = args.includes("--all");

  if (all) {
    const reg = await loadRegistry();
    const names = Object.keys(reg.projects);
    if (names.length === 0) {
      console.log("No projects registered. Run: claw-farm init <name>");
      return;
    }
    for (const name of names) {
      console.log(`\n▶ Starting ${name}...`);
      await runCompose(reg.projects[name].path, "up");
    }
    console.log(`\n✅ All ${names.length} project(s) started.`);
    return;
  }

  const name = args.find((a) => !a.startsWith("-"));
  const { name: projectName, entry } = await resolveProjectName(name);

  // Snapshot workspace before starting (Layer 0 preservation)
  try {
    await snapshotWorkspace(entry.path);
  } catch {
    // Not critical — workspace might not exist yet
  }

  console.log(`\n▶ Starting ${projectName}...`);
  await runCompose(entry.path, "up");
  console.log(`\n✅ ${projectName} is running at http://localhost:${entry.port}`);
}
