import { resolveProjectName, loadRegistry, getInstance, findPositionalArg } from "../lib/registry.ts";
import { readProjectConfig, resolveRuntimeConfig } from "../lib/config.ts";
import { runCompose, sharedProxyConnect } from "../lib/compose.ts";
import { snapshotWorkspace } from "../lib/raw-collector.ts";
import { projectKindOf } from "../lib/project-kind.ts";
import { isNotFoundError } from "../lib/errors.ts";
import type { AgentRuntime, ProxyMode } from "../runtimes/interface.ts";
import { join } from "node:path";

/** Start shared proxy compose if needed. */
async function ensureSharedProxy(
  projectDir: string,
  projectName: string,
  runtime: AgentRuntime,
  proxyMode: ProxyMode,
): Promise<void> {
  if (proxyMode !== "shared" || !runtime.supportsSharedProxy) return;
  const proxyComposePath = join(projectDir, "docker-compose.proxy.yml");
  if (!await Bun.file(proxyComposePath).exists()) {
    if (runtime.proxyComposeTemplate) {
      await Bun.write(proxyComposePath, runtime.proxyComposeTemplate(projectName));
    }
  }
  console.log(`\n▶ Starting shared api-proxy...`);
  await runCompose(projectDir, "up", {
    composePath: proxyComposePath,
    projectName: `${projectName}-proxy`,
  });
}

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
      const project = reg.projects[name]!;
      const config = await readProjectConfig(project.path);
      const { runtime, proxyMode } = resolveRuntimeConfig(config, project);
      const kind = projectKindOf(project);

      if (kind.name === "multi") {
        await ensureSharedProxy(project.path, name, runtime, proxyMode);
        await kind.forEachUserId(project, async (uid) => {
          console.log(`\n▶ Starting ${name}/${uid}...`);
          await runCompose(project.path, "up", {
            composePath: kind.composePath(project.path, "", uid),
            projectName: kind.composeProjectName(name, uid),
            connectContainer: sharedProxyConnect(name, uid!, runtime, proxyMode),
          });
        });
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
  const config = await readProjectConfig(entry.path);
  const { runtime, runtimeType, proxyMode } = resolveRuntimeConfig(config, entry);
  const kind = projectKindOf(entry);

  if (kind.name === "multi" && userId) {
    const instance = await getInstance(projectName, userId);
    if (!instance) throw new Error(`Instance "${userId}" not found in "${projectName}"`);

    await ensureSharedProxy(entry.path, projectName, runtime, proxyMode);

    console.log(`\n▶ Starting ${projectName}/${userId}...`);
    await runCompose(entry.path, "up", {
      composePath: kind.composePath(entry.path, "", userId),
      projectName: kind.composeProjectName(projectName, userId),
      connectContainer: sharedProxyConnect(projectName, userId, runtime, proxyMode),
    });
    console.log(`\n✅ ${projectName}/${userId} is running at http://localhost:${instance.port}`);
    return;
  }

  if (kind.name === "multi" && !userId) {
    const userIds = kind.listUserIds(entry);
    if (userIds.length === 0) {
      console.log(`No instances for "${projectName}". Run: claw-farm spawn ${projectName} --user <id>`);
      return;
    }

    await ensureSharedProxy(entry.path, projectName, runtime, proxyMode);

    await kind.forEachUserId(entry, async (uid) => {
      console.log(`\n▶ Starting ${projectName}/${uid}...`);
      await runCompose(entry.path, "up", {
        composePath: kind.composePath(entry.path, "", uid),
        projectName: kind.composeProjectName(projectName, uid),
        connectContainer: sharedProxyConnect(projectName, uid!, runtime, proxyMode),
      });
    });
    console.log(`\n✅ All ${userIds.length} instance(s) of ${projectName} started.`);
    return;
  }

  // Single-instance mode
  try {
    await snapshotWorkspace(entry.path, runtimeType);
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
    // workspace dir not yet created — skip snapshot
  }

  console.log(`\n▶ Starting ${projectName}...`);
  await runCompose(entry.path, "up");
  console.log(`\n✅ ${projectName} is running at http://localhost:${entry.port}`);
}
