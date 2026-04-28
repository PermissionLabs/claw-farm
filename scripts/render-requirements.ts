/**
 * Render api-proxy requirements.txt to a temp directory for pip-audit.
 * Usage: bun run scripts/render-requirements.ts <outdir>
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { apiProxyRequirementsTemplate } from "../src/templates/api-proxy.ts";

const outDir = process.argv[2];
if (!outDir) {
  console.error("Usage: bun run scripts/render-requirements.ts <outdir>");
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
await Bun.write(join(outDir, "requirements.txt"), apiProxyRequirementsTemplate());
console.log(`Wrote requirements.txt to ${outDir}`);
