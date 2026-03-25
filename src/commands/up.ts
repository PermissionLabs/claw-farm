import { join } from "node:path";
import { resolveProjectName, loadRegistry, getInstance, findPositionalArg } from "../lib/registry.ts";
import { runCompose } from "../lib/compose.ts";
import { snapshotWorkspace } from "../lib/raw-collector.ts";
import { instanceDir } from "../lib/instance.ts";

export async function upCommand(args: string[]): Promise<void> {
  const all = args.includes("--all");
  const userIdx = args.indexOf("--user");
  const userId = userIdx !== -1 ? args[userIdx + 1] : undefined;

  if (all) {
    const reg = await loadRegistry();
    const names = Object.keys(reg.projects);
    if (names.length === 0) {
      console.log("No projects registered. Run: claw-farm init <name>");
      return;
    }
    for (const name of names) {
      const project = reg.projects[name];
      if (project.multiInstance) {
        // Start all instances
        const userIds = Object.keys(project.instances ?? {});
        for (const uid of userIds) {
          console.log(`\n▶ Starting ${name}/${uid}...`);
          const instDir = instanceDir(project.path, uid);
          const composePath = join(instDir, "docker-compose.openclaw.yml");
          await runCompose(project.path, "up", {
            composePath,
            projectName: `${name}-${uid}`,
          });
        }
      } else {
        console.log(`\n▶ Starting ${name}...`);
        await runCompose(project.path, "up");
      }
    }
    console.log(`\n✅ All ${names.length} project(s) started.`);
    return;
  }

  const name = findPositionalArg(args);
  const { name: projectName, entry } = await resolveProjectName(name);

  if (entry.multiInstance && userId) {
    // Start specific instance
    const instance = await getInstance(projectName, userId);
    if (!instance) throw new Error(`Instance "${userId}" not found in "${projectName}"`);

    const instDir = instanceDir(entry.path, userId);
    const composePath = join(instDir, "docker-compose.openclaw.yml");

    console.log(`\n▶ Starting ${projectName}/${userId}...`);
    await runCompose(entry.path, "up", {
      composePath,
      projectName: `${projectName}-${userId}`,
    });
    console.log(`\n✅ ${projectName}/${userId} is running at http://localhost:${instance.port}`);
    return;
  }

  if (entry.multiInstance && !userId) {
    // Start all instances for this project
    const userIds = Object.keys(entry.instances ?? {});
    if (userIds.length === 0) {
      console.log(`No instances for "${projectName}". Run: claw-farm spawn ${projectName} --user <id>`);
      return;
    }
    for (const uid of userIds) {
      console.log(`\n▶ Starting ${projectName}/${uid}...`);
      const instDir = instanceDir(entry.path, uid);
      const composePath = join(instDir, "docker-compose.openclaw.yml");
      await runCompose(entry.path, "up", {
        composePath,
        projectName: `${projectName}-${uid}`,
      });
    }
    console.log(`\n✅ All ${userIds.length} instance(s) of ${projectName} started.`);
    return;
  }

  // Single-instance mode
  try {
    await snapshotWorkspace(entry.path);
  } catch {
    // Not critical
  }

  console.log(`\n▶ Starting ${projectName}...`);
  await runCompose(entry.path, "up");
  console.log(`\n✅ ${projectName} is running at http://localhost:${entry.port}`);
}
