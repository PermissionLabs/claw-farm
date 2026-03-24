import { join } from "node:path";
import { resolveProjectName, loadRegistry, getInstance } from "../lib/registry.ts";
import { runCompose } from "../lib/compose.ts";
import { snapshotWorkspace } from "../lib/raw-collector.ts";
import { instanceDir } from "../lib/instance.ts";

export async function downCommand(args: string[]): Promise<void> {
  const all = args.includes("--all");
  const userIdx = args.indexOf("--user");
  const userId = userIdx !== -1 ? args[userIdx + 1] : undefined;

  if (all) {
    const reg = await loadRegistry();
    const names = Object.keys(reg.projects);
    if (names.length === 0) {
      console.log("No projects registered.");
      return;
    }
    for (const name of names) {
      const project = reg.projects[name];
      if (project.multiInstance) {
        const userIds = Object.keys(project.instances ?? {});
        for (const uid of userIds) {
          console.log(`\n■ Stopping ${name}/${uid}...`);
          const instDir = instanceDir(project.path, uid);
          const composePath = join(instDir, "docker-compose.openclaw.yml");
          try {
            await runCompose(project.path, "down", {
              composePath,
              projectName: `${name}-${uid}`,
            });
          } catch {}
        }
      } else {
        console.log(`\n■ Stopping ${name}...`);
        try {
          await snapshotWorkspace(project.path);
        } catch {}
        await runCompose(project.path, "down");
      }
    }
    console.log(`\n✅ All ${names.length} project(s) stopped.`);
    return;
  }

  const name = args.find((a) => !a.startsWith("-") && a !== userId);
  const { name: projectName, entry } = await resolveProjectName(name);

  if (entry.multiInstance && userId) {
    const instance = await getInstance(projectName, userId);
    if (!instance) throw new Error(`Instance "${userId}" not found in "${projectName}"`);

    const instDir = instanceDir(entry.path, userId);
    const composePath = join(instDir, "docker-compose.openclaw.yml");

    console.log(`\n■ Stopping ${projectName}/${userId}...`);
    await runCompose(entry.path, "down", {
      composePath,
      projectName: `${projectName}-${userId}`,
    });
    console.log(`\n✅ ${projectName}/${userId} stopped.`);
    return;
  }

  if (entry.multiInstance && !userId) {
    const userIds = Object.keys(entry.instances ?? {});
    if (userIds.length === 0) {
      console.log(`No instances for "${projectName}".`);
      return;
    }
    for (const uid of userIds) {
      console.log(`\n■ Stopping ${projectName}/${uid}...`);
      const instDir = instanceDir(entry.path, uid);
      const composePath = join(instDir, "docker-compose.openclaw.yml");
      try {
        await runCompose(entry.path, "down", {
          composePath,
          projectName: `${projectName}-${uid}`,
        });
      } catch {}
    }
    console.log(`\n✅ All ${userIds.length} instance(s) of ${projectName} stopped.`);
    return;
  }

  // Single-instance mode
  try {
    await snapshotWorkspace(entry.path);
    console.log("✓ Workspace snapshot saved");
  } catch {}

  console.log(`\n■ Stopping ${projectName}...`);
  await runCompose(entry.path, "down");
  console.log(`\n✅ ${projectName} stopped.`);
}
