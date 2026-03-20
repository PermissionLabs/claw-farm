import { loadRegistry } from "../lib/registry.ts";
import { getComposeStatus } from "../lib/compose.ts";

export async function listCommand(): Promise<void> {
  const reg = await loadRegistry();
  const names = Object.keys(reg.projects);

  if (names.length === 0) {
    console.log("No projects registered. Run: claw-farm init <name>");
    return;
  }

  console.log("\n┌─────────────────────────────────────────────────────────────────────────┐");
  console.log("│ claw-farm projects                                                      │");
  console.log("├──────────────┬─────────┬───────────┬────────────────────────────────────┤");
  console.log("│ Name         │ Port    │ Status    │ Path                               │");
  console.log("├──────────────┼─────────┼───────────┼────────────────────────────────────┤");

  for (const name of names) {
    const entry = reg.projects[name];
    const status = await getComposeStatus(entry.path);
    const statusIcon = status === "running" ? "🟢" : status === "stopped" ? "⚪" : "❓";

    const nameCol = name.padEnd(12).slice(0, 12);
    const portCol = String(entry.port).padEnd(7);
    const statusCol = `${statusIcon} ${status}`.padEnd(9);
    const pathCol = entry.path.length > 34 ? "..." + entry.path.slice(-31) : entry.path.padEnd(34);

    console.log(`│ ${nameCol} │ ${portCol} │ ${statusCol} │ ${pathCol} │`);
  }

  console.log("└──────────────┴─────────┴───────────┴────────────────────────────────────┘");
  console.log(`\n  Total: ${names.length} project(s) | Next port: ${reg.nextPort}\n`);
}
