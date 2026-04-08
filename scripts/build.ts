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
console.log("Cleaning dist/...");
await rm(DIST, { recursive: true, force: true });

// 2. Build JS bundles (one per entry point, externalize node built-ins & packages)
console.log("Building JS bundles...");
for (const { entry, outdir } of ENTRY_POINTS) {
  const result = await Bun.build({
    entrypoints: [entry],
    outdir,
    target: "node",
    format: "esm",
    packages: "external",
    naming: "[name].js",
  });
  if (!result.success) {
    console.error(`Build failed for ${entry}:`, result.logs);
    process.exit(1);
  }
}

// 3. Generate .d.ts declarations via tsc
console.log("Generating declarations...");
const tsc = await $`bunx tsc -p tsconfig.build.json`.quiet().nothrow();
if (tsc.exitCode !== 0) {
  console.error("tsc declaration generation failed:");
  console.error(tsc.stderr.toString());
  process.exit(1);
}

// 4. Post-process .d.ts files: rewrite .ts import extensions to .js
//    so consumers without allowImportingTsExtensions can resolve them.
console.log("Fixing .d.ts import extensions...");
await fixDtsExtensions(DIST);

console.log("Build complete.");

async function fixDtsExtensions(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await fixDtsExtensions(fullPath);
    } else if (entry.name.endsWith(".d.ts")) {
      const content = await readFile(fullPath, "utf8");
      // Replace: from "./foo.ts" → from "./foo.js"
      //          import("./foo.ts") → import("./foo.js")
      const fixed = content.replace(
        /(from\s+["']\..*?)\.ts(["'])/g,
        "$1.js$2",
      );
      if (fixed !== content) {
        await writeFile(fullPath, fixed);
      }
    }
  }
}
