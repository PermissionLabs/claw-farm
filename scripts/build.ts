#!/usr/bin/env bun
/**
 * Build script for claw-farm package distribution.
 *
 * Generates JS bundles (via bun build) and .d.ts declarations (via tsc)
 * so that tsc-based consumers can import without allowImportingTsExtensions.
 *
 * Bun consumers still use raw .ts via conditional exports ("bun" condition).
 */

import { rm, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";

const DIST = "dist";
const ENTRY_POINTS = [
  { entry: "src/lib/api.ts", outdir: "dist/lib" },
  { entry: "src/sdk/index.ts", outdir: "dist/sdk" },
  { entry: "src/sdk/patterns/index.ts", outdir: "dist/sdk/patterns" },
  { entry: "src/sdk/providers/index.ts", outdir: "dist/sdk/providers" },
];

// 1. Clean dist/
await rm(DIST, { recursive: true, force: true });

// 2. Build JS bundles in parallel
const results = await Promise.all(
  ENTRY_POINTS.map(({ entry, outdir }) =>
    Bun.build({
      entrypoints: [entry],
      outdir,
      target: "node",
      format: "esm",
      packages: "external",
      naming: "[name].js",
    }),
  ),
);
for (let i = 0; i < results.length; i++) {
  if (!results[i].success) {
    console.error(`Build failed for ${ENTRY_POINTS[i].entry}:`, results[i].logs);
    process.exit(1);
  }
}

// 3. Generate .d.ts declarations via tsc
const tsc = await $`bunx tsc -p tsconfig.build.json`.quiet().nothrow();
if (tsc.exitCode !== 0) {
  console.error("tsc declaration generation failed:");
  console.error(tsc.stderr.toString());
  process.exit(1);
}

// 4. Post-process .d.ts files: rewrite .ts import extensions to .js
//    so consumers without allowImportingTsExtensions can resolve them.
await fixDtsExtensions(DIST);

console.log("Build complete.");

async function fixDtsExtensions(dir: string): Promise<void> {
  const files = await readdir(dir, { recursive: true });
  await Promise.all(
    files
      .filter((f) => f.endsWith(".d.ts"))
      .map(async (rel) => {
        const fullPath = join(dir, rel);
        const content = await readFile(fullPath, "utf8");
        const fixed = content.replace(
          /((?:from|import\()\s*["']\..*?)\.ts(["'])/g,
          "$1.js$2",
        );
        if (fixed !== content) {
          await writeFile(fullPath, fixed);
        }
      }),
  );
}
