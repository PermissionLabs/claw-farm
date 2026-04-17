/**
 * RuntimePaths: pure path helpers, one object per runtime.
 * Centralises all runtime-specific directory/file naming so call sites
 * never branch on `=== "openclaw"` / `=== "picoclaw"` for path logic.
 *
 * Conventions:
 *   workspaceRoot — the runtime's workspace/ directory
 *                   (e.g. <project>/openclaw/workspace  or  <instance>/picoclaw/workspace)
 *   instanceRoot  — the per-project or per-instance root directory
 *                   (e.g. <project>  or  instances/<userId>)
 */

import { join } from "node:path";
import type { RuntimeType } from "./interface.ts";

export interface RuntimePaths {
  /**
   * Absolute path to MEMORY.md given the runtime's workspace root.
   * openclaw: <workspaceRoot>/MEMORY.md
   * picoclaw: <workspaceRoot>/memory/MEMORY.md
   */
  memory(workspaceRoot: string): string;

  /**
   * Absolute path to the sessions directory given the instance root.
   * openclaw: <instanceRoot>/openclaw/sessions
   * picoclaw: <instanceRoot>/picoclaw/workspace/sessions
   */
  sessions(instanceRoot: string): string;

  /**
   * Absolute path to the workspace directory given the instance root.
   * openclaw: <instanceRoot>/openclaw/workspace
   * picoclaw: <instanceRoot>/picoclaw/workspace
   */
  workspace(instanceRoot: string): string;

  /**
   * Alias for sessions — kept for call sites that read "raw session" data.
   * Same value as sessions(instanceRoot).
   */
  rawSessions(instanceRoot: string): string;
}

export const openclawPaths: RuntimePaths = {
  memory(workspaceRoot: string): string {
    return join(workspaceRoot, "MEMORY.md");
  },
  sessions(instanceRoot: string): string {
    return join(instanceRoot, "openclaw", "sessions");
  },
  workspace(instanceRoot: string): string {
    return join(instanceRoot, "openclaw", "workspace");
  },
  rawSessions(instanceRoot: string): string {
    return join(instanceRoot, "openclaw", "sessions");
  },
};

export const picoclawPaths: RuntimePaths = {
  memory(workspaceRoot: string): string {
    return join(workspaceRoot, "memory", "MEMORY.md");
  },
  sessions(instanceRoot: string): string {
    return join(instanceRoot, "picoclaw", "workspace", "sessions");
  },
  workspace(instanceRoot: string): string {
    return join(instanceRoot, "picoclaw", "workspace");
  },
  rawSessions(instanceRoot: string): string {
    return join(instanceRoot, "picoclaw", "workspace", "sessions");
  },
};

export function getRuntimePaths(runtime: RuntimeType): RuntimePaths {
  return runtime === "picoclaw" ? picoclawPaths : openclawPaths;
}
