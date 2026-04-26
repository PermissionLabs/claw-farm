import { join } from "node:path";
import type { ProjectEntry } from "./registry.ts";
import { instanceDir } from "./instance.ts";
import { COMPOSE_FILENAME } from "./compose.ts";

/**
 * ProjectKind abstracts single-instance vs multi-instance branching.
 * Call projectKindOf(entry) to get the right implementation.
 */
export interface ProjectKind {
  readonly name: "single" | "multi";

  /** Returns user IDs for multi; [null] for single (one iteration). */
  listUserIds(entry: ProjectEntry): string[];

  /** Iterate over all users (null for single-instance). */
  forEachUserId<T>(
    entry: ProjectEntry,
    fn: (userId: string | null) => Promise<T>,
  ): Promise<T[]>;

  /** Absolute path to the docker-compose file for this (project, user) pair. */
  composePath(projectPath: string, runtimeDirName: string, userId: string | null): string;

  /** Docker compose -p project name for this (project, user) pair. */
  composeProjectName(projectName: string, userId: string | null): string;
}

const singleInstance: ProjectKind = {
  name: "single",

  listUserIds(_entry: ProjectEntry): string[] {
    return [];
  },

  async forEachUserId<T>(
    _entry: ProjectEntry,
    fn: (userId: string | null) => Promise<T>,
  ): Promise<T[]> {
    return [await fn(null)];
  },

  composePath(projectPath: string, _runtimeDirName: string, _userId: string | null): string {
    return join(projectPath, COMPOSE_FILENAME);
  },

  composeProjectName(projectName: string, _userId: string | null): string {
    return projectName;
  },
};

const multiInstance: ProjectKind = {
  name: "multi",

  listUserIds(entry: ProjectEntry): string[] {
    return Object.keys(entry.instances ?? {});
  },

  async forEachUserId<T>(
    entry: ProjectEntry,
    fn: (userId: string | null) => Promise<T>,
  ): Promise<T[]> {
    const userIds = Object.keys(entry.instances ?? {});
    return Promise.all(userIds.map((uid) => fn(uid)));
  },

  composePath(projectPath: string, _runtimeDirName: string, userId: string | null): string {
    if (userId === null) {
      // Fallback: should not be called with null for multi, but be safe
      return join(projectPath, COMPOSE_FILENAME);
    }
    return join(instanceDir(projectPath, userId), COMPOSE_FILENAME);
  },

  composeProjectName(projectName: string, userId: string | null): string {
    if (userId === null) return projectName;
    return `${projectName}-${userId}`;
  },
};

/** Return the correct ProjectKind for this registry entry. */
export function projectKindOf(entry: ProjectEntry): ProjectKind {
  return entry.multiInstance ? multiInstance : singleInstance;
}
