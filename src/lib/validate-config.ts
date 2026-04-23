/**
 * Processor + runtime compatibility checks (BKLG-015).
 * Centralises the `processor × runtime` compat check that was inline in init.ts.
 */

import type { RuntimeType } from "../runtimes/interface.ts";
import type { MemoryProcessor } from "../processors/interface.ts";
import { builtinProcessor } from "../processors/builtin.ts";
import { mem0Processor } from "../processors/mem0.ts";

const PROCESSORS: Record<string, MemoryProcessor> = {
  builtin: builtinProcessor,
  mem0: mem0Processor,
};

/**
 * Throw a clear error if processor + runtime combination is unsupported.
 *
 * Lookups go through `MemoryProcessor.supportedRuntimes`.
 * An empty `supportedRuntimes` list means the processor supports all runtimes.
 */
export function validateProcessorRuntimeCombo(
  processor: "builtin" | "mem0",
  runtimeType: RuntimeType,
): void {
  const p = PROCESSORS[processor];
  if (!p) {
    throw new Error(`Unknown processor: "${processor}"`);
  }
  const supported = p.supportedRuntimes;
  // Empty list → supports all runtimes
  if (supported.length === 0) return;
  if (!supported.includes(runtimeType)) {
    throw new Error(
      `Processor "${processor}" does not support runtime "${runtimeType}". ` +
        `Supported runtimes: ${supported.join(", ")}.`,
    );
  }
}
