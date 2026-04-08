# Agent Integration Guide

> This guide is for AI agents (Claude Code, Cursor, Copilot, etc.) working inside a project managed by claw-farm. Read this before touching any files.

---

## Detecting a claw-farm Project

Look for `.claw-farm.json` in the project root. If it exists, this project is managed by claw-farm and these rules apply.

```json
{
  "name": "project-name",
  "runtime": "openclaw",
  "proxyMode": "per-instance",
  "processor": "builtin",
  "port": 18789,
  "createdAt": "2026-03-20T...",
  "multiInstance": true
}
```

Parse every field before acting:

| Field | Values | What it controls |
|-------|--------|-----------------|
| `runtime` | `"openclaw"` \| `"picoclaw"` | Which directory tree to use, which config format |
| `proxyMode` | `"per-instance"` \| `"shared"` \| `"none"` | Whether an api-proxy container exists and how secrets are scoped |
| `processor` | `"builtin"` \| `"mem0"` | Memory backend; mem0 adds Qdrant containers |
| `multiInstance` | `true` \| absent | Whether a `template/` + `instances/` layout is used |
| `port` | integer | The host port OpenClaw/picoclaw is exposed on |

---

## Project Layouts

### Single-Instance — openclaw

```
my-agent/
├── .claw-farm.json
├── .env.example
├── docker-compose.openclaw.yml
├── api-proxy/                        ← absent when proxyMode=none
│   ├── api_proxy.py
│   ├── Dockerfile
│   └── requirements.txt
├── openclaw/
│   ├── openclaw.json                 ← LLM config (no API keys)
│   ├── policy.yaml                   ← Tool access restrictions
│   ├── workspace/
│   │   ├── SOUL.md                   ← Agent personality
│   │   ├── MEMORY.md                 ← Accumulated memory
│   │   └── skills/                   ← Custom skills
│   ├── sessions/                     ← NEVER TOUCH
│   └── logs/
├── raw/                              ← NEVER TOUCH
│   └── workspace-snapshots/
└── processed/                        ← Safe to delete; rebuilt with memory:rebuild
```

### Single-Instance — picoclaw

```
my-agent/
├── .claw-farm.json
├── .env.example
├── docker-compose.picoclaw.yml
├── api-proxy/                        ← absent when proxyMode=none
│   ├── api_proxy.py
│   ├── Dockerfile
│   └── requirements.txt
└── picoclaw/
    ├── config.json                   ← All config in one file (LLM + tools + policy)
    └── workspace/
        ├── SOUL.md                   ← Agent personality
        ├── AGENTS.md                 ← Behavior rules
        ├── skills/                   ← Custom skills
        ├── memory/
        │   └── MEMORY.md             ← Accumulated memory
        └── sessions/                 ← NEVER TOUCH
```

### Multi-Instance — openclaw

Shared template files apply to every user. Per-user files are isolated under `instances/<user-id>/`.

```
my-agent/
├── .claw-farm.json                   ← multiInstance: true
├── template/
│   ├── SOUL.md                       ← Shared personality (affects ALL users)
│   ├── AGENTS.md                     ← Shared behavior rules (affects ALL users)
│   ├── skills/                       ← Shared skills (affects ALL users)
│   └── USER.template.md              ← Template with placeholders for per-user context
├── instances/
│   └── <user-id>/
│       ├── .env
│       ├── docker-compose.openclaw.yml
│       ├── api-proxy/                ← per-instance only; absent if proxyMode=shared or none
│       └── openclaw/
│           ├── openclaw.json
│           ├── policy.yaml
│           ├── workspace/
│           │   ├── SOUL.md           ← Symlinked or copied from template/SOUL.md
│           │   ├── USER.md           ← Filled from USER.template.md
│           │   ├── MEMORY.md         ← Isolated per user
│           │   └── skills/           ← Symlinked or copied from template/skills/
│           └── sessions/             ← NEVER TOUCH
└── api-proxy/                        ← proxyMode=shared only; one proxy for all instances
```

### Multi-Instance — picoclaw

```
my-agent/
├── .claw-farm.json                   ← multiInstance: true, runtime: picoclaw
├── template/
│   ├── SOUL.md
│   ├── AGENTS.md
│   ├── skills/
│   ├── USER.template.md
│   └── config/
│       └── config.json               ← Shared picoclaw config
├── instances/
│   └── <user-id>/
│       ├── .env
│       ├── docker-compose.picoclaw.yml
│       ├── api-proxy/                ← per-instance only
│       └── picoclaw/
│           ├── config.json
│           └── workspace/
│               ├── SOUL.md
│               ├── USER.md
│               ├── skills/
│               ├── memory/
│               │   └── MEMORY.md     ← Isolated per user
│               └── sessions/         ← NEVER TOUCH
└── api-proxy/                        ← proxyMode=shared only
```

---

## File Editability Rules

### Never touch — data loss or audit failure results

| Path | Why it is off-limits |
|------|---------------------|
| `openclaw/sessions/` | Layer 0: immutable append-only conversation logs. Deleting breaks the audit trail and makes memory:rebuild impossible. |
| `instances/<user>/openclaw/sessions/` | Same — per-user Layer 0 logs. |
| `picoclaw/workspace/sessions/` | Same — picoclaw session logs. |
| `instances/<user>/picoclaw/workspace/sessions/` | Same. |
| `raw/workspace-snapshots/` | Auto-snapshots taken by `up`/`down`. Deleting breaks memory recovery. |

### Safe to edit — these are yours

| Path | Notes |
|------|-------|
| `openclaw/workspace/SOUL.md` | Defines agent personality. Edit freely. |
| `picoclaw/workspace/SOUL.md` | Same for picoclaw. |
| `template/SOUL.md` | Multi-instance: editing this affects ALL users. |
| `openclaw/workspace/MEMORY.md` | The agent updates this automatically. You may add context or correct errors. |
| `picoclaw/workspace/memory/MEMORY.md` | Same for picoclaw. |
| `instances/<user>/openclaw/workspace/MEMORY.md` | Per-user memory. Safe to edit for that user only. |
| `instances/<user>/picoclaw/workspace/memory/MEMORY.md` | Same. |
| `openclaw/workspace/skills/` | Add new skills here. See "Adding a new skill" below. |
| `picoclaw/workspace/skills/` | Same for picoclaw. |
| `template/skills/` | Multi-instance shared skills. |
| `template/AGENTS.md` | Shared behavior rules. Affects all users in multi-instance. |
| `instances/<user>/openclaw/workspace/USER.md` | Per-user context. Safe to edit for that user. |
| `instances/<user>/picoclaw/workspace/USER.md` | Same. |
| `template/USER.template.md` | Defines placeholders. Editing changes what is generated for new users on spawn. |
| `processed/` | Layer 1 processed memory. Disposable — `claw-farm memory:rebuild` recreates it. |

### Ask the user before touching — wrong changes break the stack

| Path | Risk if changed without care |
|------|------------------------------|
| `openclaw/openclaw.json` | Changes model, endpoint, or plugins for all conversations. |
| `openclaw/policy.yaml` | Enables/disables tool access (filesystem, HTTP, shell). Overly permissive = security risk. |
| `picoclaw/config.json` | Single file controls everything — LLM, tools, policy. One typo breaks the agent. |
| `template/config/config.json` | Affects all picoclaw instances. |
| `docker-compose.openclaw.yml` | Container wiring. Wrong edits = agent fails to start. |
| `docker-compose.picoclaw.yml` | Same for picoclaw. |
| `api-proxy/api_proxy.py` | Security-critical. Incorrect edits can leak API keys or disable PII protection. |
| `.env` / `.env.example` | API keys live here. Never commit real values. |

### Generated files — overwritten on `claw-farm upgrade`

| Path | What overwrites it |
|------|-------------------|
| `api-proxy/` | `claw-farm upgrade` regenerates the entire directory |
| `docker-compose.*.yml` | `claw-farm upgrade` regenerates these |
| `openclaw/openclaw.json` | `claw-farm upgrade` (unless user has manually customized it post-init) |
| `openclaw/policy.yaml` | `claw-farm upgrade --force-policy` regenerates this |

Do not store important customizations in generated files. Use SOUL.md, AGENTS.md, and skills/ instead — those are preserved across upgrades.

---

## Runtime Guide

### openclaw

- **Config files:** `openclaw/openclaw.json` (model, endpoint, plugins) + `openclaw/policy.yaml` (tool ACLs)
- **Memory path:** `openclaw/workspace/MEMORY.md`
- **Sessions path:** `openclaw/sessions/` — `.jsonl` files, one per conversation
- **Skills path:** `openclaw/workspace/skills/`
- **Mounted at container path:** `/home/node/.openclaw`
- **API key location:** NOT in the filesystem. Stored only in the `api-proxy` container's environment. OpenClaw never sees the raw key.
- **Config format example:**

```json
{
  "model": "gemini-2.0-flash",
  "endpoint": "http://api-proxy:8080/v1",
  "plugins": ["memory"]
}
```

### picoclaw

- **Config file:** `picoclaw/config.json` — single file covers LLM provider, tools, policy, and model
- **Memory path:** `picoclaw/workspace/memory/MEMORY.md`
- **Sessions path:** `picoclaw/workspace/sessions/`
- **Skills path:** `picoclaw/workspace/skills/`
- **Footprint:** ~20MB Go binary vs openclaw's ~1.5GB Node image
- **Config format example:**

```json
{
  "model": "gemini-2.0-flash",
  "endpoint": "http://api-proxy:8080/v1",
  "tools": {
    "fs": true,
    "http": false,
    "shell": false
  }
}
```

---

## Proxy Mode Guide

### per-instance (default)

Each user's instance has its own `api-proxy` container. API keys are scoped per instance. Use this when users have different API keys, or when per-user secret isolation is required.

```
instances/alice/api-proxy/   ← alice's proxy, alice's API key
instances/bob/api-proxy/     ← bob's proxy, bob's API key
```

### shared

All instances share one `api-proxy` at the project root. One API key is used for all users. The `api-proxy/` directory is at the project root, not inside `instances/`.

- Do NOT store per-user secrets in the proxy configuration — they are visible to all users.
- Suitable for internal tools or single-tenant deployments where key isolation is not needed.

```
api-proxy/     ← one proxy for everyone
instances/alice/   ← no api-proxy here
instances/bob/     ← no api-proxy here
```

### none

No `api-proxy` container is deployed. The project handles proxying internally — typically via a TypeScript/Node server that injects the API key and forwards requests.

- `claw-farm init` and `claw-farm upgrade` skip `api-proxy/` file generation entirely.
- `claw-farm up` and `claw-farm down` skip proxy container lifecycle.
- The agent container routes LLM requests to the project's own server, not to an api-proxy sidecar.
- Check the project's server code (usually `src/` or `server/`) for how the API key is injected.

---

## Security Rules

These are non-negotiable. Violating them can leak secrets or corrupt audit data.

**1. API keys are not in your environment.**
The API key is stored only inside the `api-proxy` container. Do not search for it in `.env`, config files, or environment variables. If you need to make an LLM call, route through the proxy endpoint (`http://api-proxy:8080`), not directly to the LLM provider.

**2. Outbound requests are PII-filtered.**
The api-proxy automatically redacts sensitive patterns (SSN, phone numbers, email addresses, credit card numbers) from requests before they reach the LLM. This happens transparently — you do not need to implement it yourself. Do not disable or bypass it.

**3. LLM responses are secret-scanned.**
The api-proxy scans all LLM responses for API keys and tokens before returning them to the agent. If a secret appears in a response, it is stripped. Do not attempt to elicit or reconstruct stripped content.

**4. `sessions/` is sacred — append-only, never delete.**
Session `.jsonl` files are Layer 0 data. They are the source of truth for `memory:rebuild`. Deleting them makes memory recovery impossible and breaks the audit trail. Treat them as write-once logs.

**5. `processed/` is disposable.**
Layer 1 memory in `processed/` is derived from `raw/` and `sessions/`. It can always be wiped and rebuilt:
```bash
claw-farm memory:rebuild my-agent
```
Do not treat `processed/` as authoritative. If in doubt, rebuild it.

---

## SDK Integration (proxyMode: none)

When `proxyMode` is `"none"`, the project is responsible for its own API key injection. This is typically done inside a TypeScript server using the Anthropic SDK or a compatible client.

The agent container (OpenClaw or picoclaw) is configured to send requests to the project's own server endpoint instead of the api-proxy sidecar.

Check `openclaw/openclaw.json` (or `picoclaw/config.json`) for the `endpoint` field to see where requests are routed:

```json
{
  "endpoint": "http://host.docker.internal:3000/llm"
}
```

The project's server at that endpoint is expected to:
1. Accept OpenAI-compatible `/v1/chat/completions` requests
2. Inject the API key
3. Forward to the upstream LLM provider
4. Return the response

If you are adding SDK integration code, follow the project's existing server patterns. Do not hardcode API keys in source files.

---

## Common Tasks

### Adding a new skill

Skills are Markdown files that define a capability or behavior for the agent.

| Layout | Where to add the skill file |
|--------|-----------------------------|
| Single-instance (openclaw) | `openclaw/workspace/skills/<skill-name>.md` |
| Single-instance (picoclaw) | `picoclaw/workspace/skills/<skill-name>.md` |
| Multi-instance (shared) | `template/skills/<skill-name>.md` — available to all users |
| Multi-instance (per-user) | `instances/<user>/openclaw/workspace/skills/<skill-name>.md` |

Skill file format:

```markdown
# Skill Name

Brief description of what this skill does.

## Trigger

When to use this skill.

## Instructions

Step-by-step instructions for the agent.
```

### Modifying agent personality

Edit `SOUL.md`. This file defines the agent's tone, goals, constraints, and identity.

| Layout | File to edit | Scope |
|--------|-------------|-------|
| Single-instance (openclaw) | `openclaw/workspace/SOUL.md` | This instance only |
| Single-instance (picoclaw) | `picoclaw/workspace/SOUL.md` | This instance only |
| Multi-instance | `template/SOUL.md` | All users — changes take effect on next container restart |
| Multi-instance (per-user override) | `instances/<user>/openclaw/workspace/SOUL.md` | That user only |

### Modifying agent behavior rules

Edit `AGENTS.md`. This file defines rules, constraints, and operational policies separate from personality.

| Layout | File to edit |
|--------|-------------|
| Multi-instance | `template/AGENTS.md` |
| Single-instance (picoclaw) | `picoclaw/workspace/AGENTS.md` |

### Adding per-user context

In multi-instance projects, per-user context is populated from `template/USER.template.md` when a new instance is spawned.

**To add a new placeholder:**

1. Edit `template/USER.template.md` and add `{{field_name}}` where the value should appear.
2. When spawning: `claw-farm spawn my-agent --user alice`
3. Fill in the generated `instances/alice/openclaw/workspace/USER.md` with the real value.

**To update an existing user's context:**

Edit `instances/<user>/openclaw/workspace/USER.md` (or `instances/<user>/picoclaw/workspace/USER.md`) directly.

### Changing the LLM model or provider

Do not change endpoints or provider URLs without understanding the proxy routing.

| Runtime | File | Field |
|---------|------|-------|
| openclaw | `openclaw/openclaw.json` | `"model"` |
| picoclaw | `picoclaw/config.json` | `"model"` |
| multi-instance picoclaw | `template/config/config.json` | `"model"` |

Supported LLM providers are set at `init` time via `--llm gemini|anthropic|openai-compat`. Switching providers after init requires updating both the config file and the `.env` API key variable. The `endpoint` field in the config must point to the api-proxy (or the project's own server for `proxyMode: none`), never directly to the LLM provider.

### Running the agent stack

```bash
# Start all containers
claw-farm up my-agent

# Start a specific user instance (multi-instance only)
claw-farm up my-agent --user alice

# Stop all containers
claw-farm down my-agent

# Stop a specific user instance
claw-farm down my-agent --user alice

# Spawn a new user instance from template
claw-farm spawn my-agent --user bob

# Remove a user instance
claw-farm despawn my-agent --user bob
```

### Upgrading claw-farm templates

```bash
claw-farm upgrade my-agent
```

This regenerates all claw-farm-owned files: `api-proxy/`, `docker-compose.*.yml`, and base configs. Your edits to the following are preserved:

- `SOUL.md`
- `AGENTS.md`
- `skills/`
- `USER.md` (per-user context)
- `MEMORY.md`

The following are overwritten:

- `api-proxy/api_proxy.py` and related files
- `docker-compose.*.yml`

To also overwrite `policy.yaml`:

```bash
claw-farm upgrade my-agent --force-policy
```

---

## Troubleshooting

### Agent cannot reach the LLM

1. Confirm the stack is running: `docker ps` — look for the `api-proxy` container (unless `proxyMode: none`).
2. Check `.env` — the API key variable must be set (e.g., `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`).
3. Verify `openclaw/openclaw.json` or `picoclaw/config.json` — the `endpoint` field must point to `http://api-proxy:8080`, not directly to the LLM provider.
4. For `proxyMode: none` — confirm the project's own server is running and accessible at the configured endpoint.
5. Check proxy logs: `docker logs <project-name>-api-proxy-1`.

### Memory is not persisting between sessions

1. Confirm Docker volumes are mounted. Check `docker-compose.*.yml` — `openclaw/workspace` or `picoclaw/workspace` must be a bind mount, not an anonymous volume.
2. Check that `MEMORY.md` exists at the correct path for the runtime (see Runtime Guide above).
3. If using `processor: mem0`, confirm both `mem0-api` and `qdrant` containers are running.

### PII is being blocked unexpectedly

The api-proxy redacts patterns matching SSN, phone, email, and credit card formats. If legitimate data is being stripped:

1. Check `api-proxy/.env` or the proxy container's environment for `PII_MODE`.
2. `PII_MODE=strict` — maximum redaction.
3. `PII_MODE=permissive` — only high-confidence patterns are redacted.
4. Changing this requires user approval — do not modify it autonomously.

### `memory:rebuild` fails

Requires `raw/workspace-snapshots/` to contain at least one snapshot. Snapshots are taken automatically on `claw-farm up` and `claw-farm down`. If the directory is empty, there is no Layer 0 data to rebuild from. This is unrecoverable — the agent must accumulate new memory through conversations.

### Container fails to start after upgrade

1. Run `docker compose -f docker-compose.<runtime>.yml config` to validate the compose file syntax.
2. Check for `.env` variables referenced in the compose file that are missing from `.env`.
3. If `api-proxy/Dockerfile` changed in the upgrade, rebuild the image: `docker compose build api-proxy`.

---

## Quick Reference

| Task | Safe to do autonomously | File |
|------|------------------------|------|
| Edit agent personality | Yes | `SOUL.md` |
| Edit behavior rules | Yes | `AGENTS.md` |
| Add a skill | Yes | `skills/<name>.md` |
| Update per-user context | Yes | `USER.md` |
| Edit memory | Yes, with care | `MEMORY.md` |
| Change LLM model | Ask user first | `openclaw.json` / `config.json` |
| Change tool access policy | Ask user first | `policy.yaml` / `config.json` |
| Modify docker-compose | Ask user first | `docker-compose.*.yml` |
| Modify api-proxy | Ask user first | `api-proxy/api_proxy.py` |
| Delete sessions | Never | `sessions/` |
| Delete raw snapshots | Never | `raw/workspace-snapshots/` |
