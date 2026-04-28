import { join } from "node:path";
import { resolveProjectName, loadRegistry, getInstance, findPositionalArg } from "../lib/registry.ts";
import { readProjectConfig, resolveRuntimeConfig } from "../lib/config.ts";
import { runCompose, sharedProxyConnect } from "../lib/compose.ts";
import { snapshotWorkspace } from "../lib/raw-collector.ts";
import { projectKindOf } from "../lib/project-kind.ts";
import { isNotFoundError } from "../lib/errors.ts";
import type { AgentRuntime, ProxyMode } from "../runtimes/interface.ts";

/** Stop shared proxy compose if no instances remain running. */
async function stopSharedProxy(
  projectDir: string,
  projectName: string,
  runtime: AgentRuntime,
  proxyMode: ProxyMode,
): Promise<void> {
  if (proxyMode !== "shared" || !runtime.supportsSharedProxy) return;
  const proxyComposePath = join(projectDir, "docker-compose.proxy.yml");
  if (!await Bun.file(proxyComposePath).exists()) {
    return;
  }
  console.log(`\n■ Stopping shared api-proxy...`);
  try {
    await runCompose(projectDir, "down", {
      composePath: proxyComposePath,
      projectName: `${projectName}-proxy`,
    });
  } catch {
    // intentional: best-effort teardown of shared proxy
  }
}

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
      if (!project) continue;
      const config = await readProjectConfig(project.path);
      const { runtime, runtimeType, proxyMode } = resolveRuntimeConfig(config, project);
      const kind = projectKindOf(project);

      if (kind.name === "multi") {
        await kind.forEachUserId(project, async (uid) => {
          console.log(`\n■ Stopping ${name}/${uid}...`);
          try {
            await runCompose(project.path, "down", {
              composePath: kind.composePath(project.path, "", uid),
              projectName: kind.composeProjectName(name, uid),
              connectContainer: sharedProxyConnect(name, uid!, runtime, proxyMode),
            });
          } catch {
            // intentional: best-effort per-instance teardown
          }
        });
        await stopSharedProxy(project.path, name, runtime, proxyMode);
      } else {
        console.log(`\n■ Stopping ${name}...`);
        try {
          await snapshotWorkspace(project.path, runtimeType);
        } catch (err) {
          if (!isNotFoundError(err)) throw err;
          // workspace dir not yet created — skip snapshot
        }
        await runCompose(project.path, "down");
      }
    }
    console.log(`\n✅ All ${names.length} project(s) stopped.`);
    return;
  }

  const name = findPositionalArg(args);
  const { name: projectName, entry } = await resolveProjectName(name);
  const config = await readProjectConfig(entry.path);
  const { runtime, runtimeType, proxyMode } = resolveRuntimeConfig(config, entry);
  const kind = projectKindOf(entry);

  if (kind.name === "multi" && userId) {
    const instance = await getInstance(projectName, userId);
    if (!instance) throw new Error(`Instance "${userId}" not found in "${projectName}"`);

    console.log(`\n■ Stopping ${projectName}/${userId}...`);
    await runCompose(entry.path, "down", {
      composePath: kind.composePath(entry.path, "", userId),
      projectName: kind.composeProjectName(projectName, userId),
      connectContainer: sharedProxyConnect(projectName, userId, runtime, proxyMode),
    });
    console.log(`\n✅ ${projectName}/${userId} stopped.`);
    return;
  }

  if (kind.name === "multi" && !userId) {
    const userIds = kind.listUserIds(entry);
    if (userIds.length === 0) {
      console.log(`No instances for "${projectName}".`);
      return;
    }
    await kind.forEachUserId(entry, async (uid) => {
      console.log(`\n■ Stopping ${projectName}/${uid}...`);
      try {
        await runCompose(entry.path, "down", {
          composePath: kind.composePath(entry.path, "", uid),
          projectName: kind.composeProjectName(projectName, uid),
          connectContainer: sharedProxyConnect(projectName, uid!, runtime, proxyMode),
        });
      } catch {
        // intentional: best-effort per-instance teardown
      }
    });
    await stopSharedProxy(entry.path, projectName, runtime, proxyMode);
    console.log(`\n✅ All ${userIds.length} instance(s) of ${projectName} stopped.`);
    return;
  }

  // Single-instance mode
  try {
    await snapshotWorkspace(entry.path, runtimeType);
    console.log("✓ Workspace snapshot saved");
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
    // workspace dir not yet created — skip snapshot
  }

  console.log(`\n■ Stopping ${projectName}...`);
  await runCompose(entry.path, "down");
  console.log(`\n✅ ${projectName} stopped.`);
}
