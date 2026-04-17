import { join } from "node:path";

import type { RuntimeType, ProxyMode, AgentRuntime } from "../runtimes/interface.ts";
import { getRuntime } from "../runtimes/index.ts";
import type { ProjectEntry } from "./registry.ts";
import { writeSecret } from "./secret-file.ts";

// Re-export deepMerge from its canonical location.
// picoclaw.ts imports deepMerge from this module — keep the re-export for compat.
export { deepMerge } from "./deep-merge.ts";

export type LlmProvider = "gemini" | "anthropic" | "openai-compat";

export interface ClawFarmConfig {
  name: string;
  processor: "builtin" | "mem0";
  port: number;
  createdAt: string;
  multiInstance?: boolean;
  llm?: LlmProvider;
  runtime?: RuntimeType;
  proxyMode?: ProxyMode;
}

/**
 * Resolve runtime type, runtime instance, and proxy mode from config + registry entry.
 * Centralises the repeated `config?.runtime ?? entry.runtime ?? "openclaw"` pattern.
 */
export function resolveRuntimeConfig(
  config: ClawFarmConfig | null,
  entry: Pick<ProjectEntry, "runtime">,
): { runtimeType: RuntimeType; runtime: AgentRuntime; proxyMode: ProxyMode } {
  const runtimeType: RuntimeType = config?.runtime ?? entry.runtime ?? "openclaw";
  const runtime = getRuntime(runtimeType);
  const proxyMode: ProxyMode = config?.proxyMode ?? runtime.defaultProxyMode;
  return { runtimeType, runtime, proxyMode };
}

/**
 * Generate .env.example content based on LLM provider and processor.
 * The selected provider's keys are uncommented; others are commented out.
 */
export function envExampleTemplate(
  llm: LlmProvider = "gemini",
  processor: "builtin" | "mem0" = "builtin",
): string {
  const lines: string[] = [
    `# LLM Provider: gemini | anthropic | openai-compat`,
    `LLM_PROVIDER=${llm}`,
    ``,
  ];

  if (llm === "gemini") {
    lines.push(`GEMINI_API_KEY=`);
    lines.push(`# ANTHROPIC_API_KEY=`);
    lines.push(`# OPENAI_API_KEY=`);
    lines.push(`# OPENAI_COMPAT_BASE_URL=`);
  } else if (llm === "anthropic") {
    lines.push(`# GEMINI_API_KEY=`);
    lines.push(`ANTHROPIC_API_KEY=`);
    lines.push(`# OPENAI_API_KEY=`);
    lines.push(`# OPENAI_COMPAT_BASE_URL=`);
  } else {
    lines.push(`# GEMINI_API_KEY=`);
    lines.push(`# ANTHROPIC_API_KEY=`);
    lines.push(`OPENAI_API_KEY=`);
    lines.push(`OPENAI_COMPAT_BASE_URL=`);
  }

  if (processor === "mem0") {
    lines.push(``);
    lines.push(`MEM0_API_KEY=`);
  }

  lines.push(``);
  return lines.join("\n");
}

export async function writeProjectConfig(
  projectDir: string,
  config: ClawFarmConfig,
): Promise<void> {
  const configPath = join(projectDir, ".claw-farm.json");
  await writeSecret(configPath, JSON.stringify(config, null, 2) + "\n");
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

/**
 * Strip JS-style comments from a JSON-like string so JSON.parse can handle it.
 *
 * Supported syntax subset:
 *   - `//` line comments (stripped to end of line)
 *   - `/* ... *\/` block comments (stripped, may span lines)
 *   - String literals are passed through unchanged (including `"// inside string"`)
 *   - Escape sequences inside strings (`\"`, `\\`) are handled correctly
 *
 * Not supported: regex literals, template strings, nested block comments.
 */
export function stripJsonComments(text: string): string {
  let result = "";
  let i = 0;
  while (i < text.length) {
    // String literal — pass through unchanged
    if (text[i] === '"') {
      result += '"';
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\") {
          result += text[i] + (text[i + 1] ?? "");
          i += 2;
        } else {
          result += text[i];
          i++;
        }
      }
      if (i < text.length) {
        result += '"';
        i++;
      }
    } else if (text[i] === "/" && text[i + 1] === "/") {
      // Line comment — skip to end of line
      while (i < text.length && text[i] !== "\n") i++;
    } else if (text[i] === "/" && text[i + 1] === "*") {
      // Block comment — skip to */
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
    } else {
      result += text[i];
      i++;
    }
  }
  return result;
}

