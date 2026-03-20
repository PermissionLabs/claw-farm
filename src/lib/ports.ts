import { loadRegistry } from "./registry.ts";

export async function getNextPort(): Promise<number> {
  const reg = await loadRegistry();
  return reg.nextPort;
}

export function portRange(basePort: number) {
  return {
    openclaw: basePort,
    mem0: basePort + 1000, // e.g. 18789 → 19789
    qdrant: basePort + 2000, // e.g. 18789 → 20789
  };
}
