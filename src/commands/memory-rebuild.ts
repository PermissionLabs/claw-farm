import { resolveProjectName } from "../lib/registry.ts";
import { readProjectConfig } from "../lib/config.ts";
import { builtinProcessor } from "../processors/builtin.ts";
import { mem0Processor } from "../processors/mem0.ts";

export async function memoryRebuildCommand(args: string[]): Promise<void> {
  const name = args.find((a) => !a.startsWith("-"));
  const { name: projectName, entry } = await resolveProjectName(name);

  console.log(`\n🔄 Rebuilding memory for ${projectName}...`);

  const config = await readProjectConfig(entry.path);
  const processor = config?.processor ?? entry.processor;

  if (processor === "mem0") {
    await mem0Processor.rebuild(entry.path);
  } else {
    await builtinProcessor.rebuild(entry.path);
  }

  console.log(`\n✅ Memory rebuild complete for ${projectName}.\n`);
}
