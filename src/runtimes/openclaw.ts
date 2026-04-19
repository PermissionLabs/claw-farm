/**
 * OpenClaw runtime implementation.
 * Delegates to existing template functions — no behavior change.
 */

import type { AgentRuntime, ProxyMode, ConnectContainerOpts } from "./interface.ts";
import type { LlmProvider } from "../lib/config.ts";
import { deepMerge } from "../lib/deep-merge.ts";
import { stripJsonComments } from "../lib/config.ts";
import { baseComposeTemplate } from "../templates/docker-compose.yml.ts";
import { instanceComposeTemplate } from "../templates/docker-compose.instance.yml.ts";
import { openclawConfigTemplate } from "../templates/openclaw.json.ts";

/**
 * Merge claw-farm template config with existing user config.
 * Template provides the base, user's existing config overrides on top.
 * This preserves user-specific settings (gateway.auth, controlUi, etc.)
 * while updating claw-farm managed fields (agents, models, env).
 */
export function mergeOpenclawConfig(
  templateJson: string,
  existingJson: string,
): string {
  try {
    const template = JSON.parse(stripJsonComments(templateJson)) as Record<string, unknown>;
    const existing = JSON.parse(stripJsonComments(existingJson)) as Record<string, unknown>;
    // Base merge: template as base, existing overrides (preserves user keys)
    const merged = deepMerge(template, existing);
    // Re-apply template fields that claw-farm must control
    // (user should not accidentally keep stale model/provider config)
    merged.agents = deepMerge(
      (existing.agents ?? {}) as Record<string, unknown>,
      (template.agents ?? {}) as Record<string, unknown>,
    );
    merged.models = deepMerge(
      (existing.models ?? {}) as Record<string, unknown>,
      (template.models ?? {}) as Record<string, unknown>,
    );
    // Merge env: template as base, user additions preserved,
    // but force-apply API key sentinels from template (security: must route through proxy)
    const mergedEnv = deepMerge(
      (template.env ?? {}) as Record<string, unknown>,
      (existing.env ?? {}) as Record<string, unknown>,
    );
    const templateEnv = (template.env ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(templateEnv)) {
      if (key.endsWith("_API_KEY")) {
        mergedEnv[key] = templateEnv[key]; // force "proxied" sentinel
      }
    }
    merged.env = mergedEnv;
    // Ensure every provider has a models array (OpenClaw requires it)
    const providers = (merged.models as Record<string, unknown>)?.providers as Record<string, Record<string, unknown>> | undefined;
    if (providers) {
      for (const key of Object.keys(providers)) {
        if (providers[key] && !Array.isArray(providers[key].models)) {
          providers[key].models = [];
        }
      }
    }
    // Ensure controlUi.enabled from template is applied, but preserve user's
    // other controlUi settings (allowedOrigins, dangerouslyDisableDeviceAuth, etc.)
    const mergedGateway = (merged.gateway ?? {}) as Record<string, unknown>;
    const templateControlUi = ((template.gateway ?? {}) as Record<string, unknown>).controlUi as Record<string, unknown> | undefined;
    if (templateControlUi) {
      const userControlUi = (mergedGateway.controlUi ?? {}) as Record<string, unknown>;
      mergedGateway.controlUi = { ...userControlUi, enabled: templateControlUi.enabled };
    }
    // Remove root-level controlUi if present (OpenClaw reads gateway.controlUi)
    delete merged.controlUi;
    return JSON.stringify(merged, null, 2) + "\n";
  } catch {
    // If existing config is unparseable, just use template
    return templateJson;
  }
}

export const openclawRuntime: AgentRuntime = {
  name: "openclaw",
  configFileName: "openclaw.json",
  additionalConfigFiles: ["policy.yaml"],
  containerMountPath: "/home/node/.openclaw",
  sharedTemplateFiles: ["SOUL.md", "AGENTS.md"],
  gatewayPort: 18789,
  runtimeDirName: "openclaw",
  defaultProxyMode: "per-instance",
  supportsSharedProxy: false,

  connectContainerFor(_opts: ConnectContainerOpts): { container: string; network: string } | null {
    // openclaw embeds api-proxy per-instance; shared-proxy topology is not supported
    return null;
  },

  composeTemplate(name: string, port: number, proxyMode?: ProxyMode): string {
    return baseComposeTemplate(name, port, proxyMode ?? this.defaultProxyMode);
  },

  instanceComposeTemplate(
    projectName: string,
    userId: string,
    port: number,
    proxyMode: ProxyMode,
  ): string {
    return instanceComposeTemplate(projectName, userId, port, proxyMode);
  },

  configTemplate(
    name: string,
    processor: "builtin" | "mem0",
    llm: LlmProvider,
  ): string {
    return openclawConfigTemplate(name, processor, llm);
  },

  mergeConfig(templateJson: string, existingJson: string): string {
    return mergeOpenclawConfig(templateJson, existingJson);
  },
};
