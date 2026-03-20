import { resolveProjectName, loadRegistry } from "../lib/registry.ts";
import { runCompose } from "../lib/compose.ts";
import { snapshotWorkspace } from "../lib/raw-collector.ts";

export async function downCommand(args: string[]): Promise<void> {
  const all = args.includes("--all");

  if (all) {
    const reg = await loadRegistry();
    const names = Object.keys(reg.projects);
    if (names.length === 0) {
      console.log("No projects registered.");
      return;
    }
    for (const name of names) {
      console.log(`\n■ Stopping ${name}...`);
      // Snapshot before stopping
      try {
        await snapshotWorkspace(reg.projects[name].path);
      } catch {}
      await runCompose(reg.projects[name].path, "down");
    }
    console.log(`\n✅ All ${names.length} project(s) stopped.`);
    return;
  }

  const name = args.find((a) => !a.startsWith("-"));
  const { name: projectName, entry } = await resolveProjectName(name);

  // Snapshot workspace before stopping (Layer 0 preservation)
  try {
    await snapshotWorkspace(entry.path);
    console.log("✓ Workspace snapshot saved");
  } catch {}

  console.log(`\n■ Stopping ${projectName}...`);
  await runCompose(entry.path, "down");
  console.log(`\n✅ ${projectName} stopped.`);
}
