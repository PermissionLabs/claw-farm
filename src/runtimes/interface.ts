/**
 * Agent runtime abstraction.
 * Runtimes determine the container image, config format, workspace structure,
 * and compose templates — orthogonal to the memory processor (builtin/mem0).
 */

export type LlmProvider = "gemini" | "anthropic" | "openai-compat";

export type RuntimeType = "openclaw" | "picoclaw";
export type ProxyMode = "shared" | "per-instance" | "none";

export interface ConnectContainerOpts {
  proxyMode: ProxyMode;
  projectName: string;
  userId: string;
}

export interface AgentRuntime {
  /** Runtime identifier */
  name: RuntimeType;

  /** Config file name inside the runtime directory (e.g., "openclaw.json", "config.json") */
  configFileName: string;

  /** Additional config files to copy during spawn (e.g., ["policy.yaml"]) */
  additionalConfigFiles: string[];

  /** Mount path inside the container (e.g., "/home/node/.openclaw") */
  containerMountPath: string;

  /** Template files shared across instances (e.g., ["SOUL.md", "AGENTS.md"]) */
  sharedTemplateFiles: string[];

  /** Internal gateway port inside the container */
  gatewayPort: number;

  /** Directory name under project/instance root (e.g., "openclaw", "picoclaw") */
  runtimeDirName: string;

  /** Default proxy mode for this runtime */
  defaultProxyMode: ProxyMode;

  /**
   * Whether this runtime can participate in shared-proxy topology.
   * openclaw embeds api-proxy per-instance, so this is false.
   * picoclaw supports a shared api-proxy, so this is true.
   */
  supportsSharedProxy: boolean;

  /**
   * Return the container + network to connect for shared-proxy topology,
   * or null when not applicable (runtime doesn't support it, or proxyMode != "shared").
   * Encapsulates the former `proxyMode === "shared" && runtimeType !== "openclaw"` check.
   */
  connectContainerFor(opts: ConnectContainerOpts): { container: string; network: string } | null;

  /** Generate base docker-compose for single-instance projects */
  composeTemplate(name: string, port: number, proxyMode?: ProxyMode): string;

  /** Generate per-instance docker-compose for multi-instance projects */
  instanceComposeTemplate(
    projectName: string,
    userId: string,
    port: number,
    proxyMode: ProxyMode,
  ): string;

  /** Generate shared proxy compose (only used when proxyMode=shared) */
  proxyComposeTemplate?(name: string): string;

  /** Generate runtime config file content */
  configTemplate(
    name: string,
    processor: "builtin" | "mem0",
    llm: LlmProvider,
  ): string;

  /** Merge existing config with template (preserves user settings) */
  mergeConfig(templateJson: string, existingJson: string): string;
}
