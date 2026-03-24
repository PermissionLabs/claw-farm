import { join } from "node:path";

export interface ClawFarmConfig {
  name: string;
  processor: "builtin" | "mem0";
  port: number;
  createdAt: string;
  multiInstance?: boolean;
}

export async function writeProjectConfig(
  projectDir: string,
  config: ClawFarmConfig,
): Promise<void> {
  const configPath = join(projectDir, ".claw-farm.json");
  await Bun.write(configPath, JSON.stringify(config, null, 2) + "\n");
}

export async function readProjectConfig(
  projectDir: string,
): Promise<ClawFarmConfig | null> {
  try {
    const raw = await Bun.file(join(projectDir, ".claw-farm.json")).text();
    return JSON.parse(raw) as ClawFarmConfig;
  } catch {
    return null;
  }
}
