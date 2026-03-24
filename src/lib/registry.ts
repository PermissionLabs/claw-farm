import { homedir } from "node:os";
import { join } from "node:path";

const REGISTRY_DIR = join(homedir(), ".claw-farm");
const REGISTRY_PATH = join(REGISTRY_DIR, "registry.json");

export interface ProjectEntry {
  path: string;
  port: number;
  processor: "builtin" | "mem0";
  createdAt: string;
}

export interface Registry {
  projects: Record<string, ProjectEntry>;
  nextPort: number;
}

const DEFAULT_START_PORT = 18789;

function defaultRegistry(): Registry {
  return { projects: {}, nextPort: DEFAULT_START_PORT };
}

export async function loadRegistry(): Promise<Registry> {
  try {
    const raw = await Bun.file(REGISTRY_PATH).text();
    return JSON.parse(raw) as Registry;
  } catch {
    return defaultRegistry();
  }
}

export async function saveRegistry(reg: Registry): Promise<void> {
  const { mkdir, chmod } = await import("node:fs/promises");
  await mkdir(REGISTRY_DIR, { recursive: true, mode: 0o700 });
  await Bun.write(REGISTRY_PATH, JSON.stringify(reg, null, 2) + "\n");
  await chmod(REGISTRY_PATH, 0o600);
}

export async function addProject(
  name: string,
  path: string,
  processor: "builtin" | "mem0",
): Promise<ProjectEntry> {
  const reg = await loadRegistry();
  if (reg.projects[name]) {
    throw new Error(`Project "${name}" already exists in registry`);
  }
  const port = reg.nextPort;
  const entry: ProjectEntry = {
    path,
    port,
    processor,
    createdAt: new Date().toISOString(),
  };
  reg.projects[name] = entry;
  reg.nextPort = port + 1;
  await saveRegistry(reg);
  return entry;
}

export async function getProject(name: string): Promise<ProjectEntry | null> {
  const reg = await loadRegistry();
  return reg.projects[name] ?? null;
}

export async function resolveProjectName(nameOrNull: string | undefined): Promise<{
  name: string;
  entry: ProjectEntry;
}> {
  if (nameOrNull) {
    const entry = await getProject(nameOrNull);
    if (!entry) throw new Error(`Project "${nameOrNull}" not found in registry`);
    return { name: nameOrNull, entry };
  }
  // Try to find by current directory
  const cwd = process.cwd();
  const reg = await loadRegistry();
  for (const [name, entry] of Object.entries(reg.projects)) {
    if (entry.path === cwd) return { name, entry };
  }
  throw new Error("No project name given and current directory is not a registered project");
}
