# Getting Started with claw-farm

claw-farm is an infrastructure toolkit for building **agent-per-user services** — where each user gets their own isolated AI agent with independent memory, sessions, and API key isolation. This guide takes you from zero to a running multi-user agent service.

---

## Prerequisites

- **[Bun](https://bun.sh)** — runtime and package manager (`curl -fsSL https://bun.sh/install | bash`)
- **Docker** + **Docker Compose** — for running agent containers
- An LLM API key (Gemini, Anthropic, or OpenAI-compatible)

Verify:
```bash
bun --version       # >= 1.0
docker --version
docker compose version
```

---

## 1. Install claw-farm

```bash
git clone https://github.com/PermissionLabs/claw-farm.git ~/claw-farm
cd ~/claw-farm && bun install

# Add alias to your shell profile
echo 'alias claw-farm="bun run ~/claw-farm/src/index.ts"' >> ~/.zshrc
source ~/.zshrc
```

> **npm publish is planned** — `bun install -g @permissionlabs/claw-farm` will work once released.

Confirm it works:
```bash
claw-farm list
# → (empty table on first run, no errors)
```

---

## 2. Create Your First Agent (Single User)

Start here to understand the structure before scaling to multiple users.

```bash
mkdir my-agent && cd my-agent
claw-farm init my-agent
```

This registers the project in `~/.claw-farm/registry.json` (global port registry, auto-assigns port starting at 18789) and generates the following structure:

```
my-agent/
  .claw-farm.json               # Project settings (name, port, runtime, proxyMode)
  .env.example                  # API key template
  docker-compose.openclaw.yml   # Full stack (agent + security proxy)
  api-proxy/                    # Security sidecar — never skip this
    api_proxy.py                #   Key injection + PII redaction + secret scanning
    Dockerfile
    requirements.txt
  openclaw/
    openclaw.json               # LLM config (no raw keys — routes through proxy)
    policy.yaml                 # Tool access restrictions (fs, http, shell)
    workspace/
      SOUL.md                   # Agent personality — edit this freely
      MEMORY.md                 # Accumulated memory from conversations
      skills/                   # Custom skills directory
    sessions/                   # Layer 0: immutable session logs — never delete
    logs/
  raw/workspace-snapshots/      # Periodic workspace snapshots
  processed/                    # Layer 1: rebuildable index
  logs/                         # API proxy audit logs
```

**Configure your API key:**
```bash
cp .env.example .env
# Edit .env and set your key, e.g.:
# GEMINI_API_KEY=AIza...
```

**Start the agent:**
```bash
claw-farm up my-agent
```

Open the dashboard: `http://localhost:18789`

**Customize the agent personality** by editing `openclaw/workspace/SOUL.md`. This file defines who the agent is — its tone, constraints, and behavior rules. Changes take effect on the next conversation.

---

## 3. Scale to Multi-User (Agent Per User)

The single-user setup above is one container. For a real service where each user has their own isolated agent:

```bash
mkdir dog-agent && cd dog-agent
claw-farm init dog-agent --multi
```

`--multi` creates a **template + instances** structure:

```
dog-agent/
  template/                     # Shared across all users
    SOUL.md                     #   Shared personality
    AGENTS.md                   #   Shared behavior rules
    skills/                     #   Shared custom skills
    USER.template.md            #   Per-user context template (with {{placeholders}})
  instances/                    # One subdirectory per user (created by spawn)
  .claw-farm.json
  .env.example
```

Why this split? Every user's agent shares the same personality and skills (maintained in one place), but each user has isolated memory, sessions, and API routing. You change `template/SOUL.md` once and all users get the update.

**Spawn instances for each user:**
```bash
claw-farm spawn dog-agent --user alice --context name=Poppy breed=Maltese age=3
claw-farm spawn dog-agent --user bob   --context name=Max   breed=Golden  age=5
```

`spawn` copies the template, fills `USER.template.md` placeholders with the `--context` values, assigns a port, and starts the container. Each user gets:

- Their own `instances/alice/openclaw/workspace/MEMORY.md`
- Their own `instances/alice/openclaw/sessions/` (immutable logs)
- Their own port and container

Shared across users: `template/SOUL.md`, `template/AGENTS.md`, `template/skills/`.

**List active instances:**
```bash
claw-farm instances dog-agent
```

**Programmatic API** (for signup flows in your server):
```typescript
import { spawn } from "@permissionlabs/claw-farm";

await spawn("dog-agent", {
  user: newUser.id,
  context: { name: newUser.dogName, breed: newUser.dogBreed },
});
```

---

## 4. Choose Your Runtime

claw-farm supports two agent runtimes. Choose based on your resource constraints.

| | OpenClaw | picoclaw |
|---|---|---|
| **Image size** | ~1.5 GB | ~20 MB |
| **Language** | Node.js | Go |
| **Config** | `openclaw.json` + `policy.yaml` | Single `config.json` |
| **Memory path** | `workspace/MEMORY.md` | `workspace/memory/MEMORY.md` |
| **Sessions path** | `sessions/` | `workspace/sessions/` |
| **Best for** | Full-featured, complex agents | Many lightweight instances, edge deploys |

```bash
# Scaffold with picoclaw
claw-farm init my-agent --runtime picoclaw

# Switch an existing project
claw-farm migrate-runtime my-agent --to picoclaw
```

---

## 5. Choose Your Proxy Mode

The proxy mode controls how API key security is deployed across instances.

| Mode | What it does | When to use |
|------|-------------|-------------|
| `per-instance` (default) | Each instance has its own `api-proxy` container | Maximum isolation; different API keys per user |
| `shared` | All instances share one `api-proxy` container | Save resources when all users share the same API key |
| `none` | No proxy container generated | You integrate the security SDK directly into your own server |

```bash
claw-farm init my-agent --proxy-mode shared
claw-farm init my-agent --proxy-mode none
```

**Decision guide:**
- Building a consumer app where you control the API key? Use `shared`.
- Letting users bring their own keys (enterprise)? Use `per-instance`.
- Already have a TypeScript server and want to embed security as middleware? Use `none` and import from the SDK (see Section 6).

---

## 6. Security Overview

Every claw-farm project ships with a security proxy by default (unless `proxyMode: none`). Here is what it protects automatically.

**The flow:**
```
Agent  →  api-proxy (internal only)  →  LLM API  →  api-proxy  →  Agent
```

**Outbound (agent → LLM):**
- PII is auto-redacted before the request leaves. Example:
  ```
  "My SSN is 900101-1234567"  →  "My SSN is [REDACTED_KR_RRN]"
  ```
- The raw API key is never visible to the agent — it is injected by the proxy.

**Inbound (LLM → agent):**
- API keys and secrets in responses are stripped. Example:
  ```
  "Here is the key: sk-ant-abc123..."  →  "Here is the key: [REDACTED_ANTHROPIC_KEY]"
  ```

**PII patterns detected:** Korean RRN/phone, US SSN/phone, credit cards, emails.
**Secret patterns detected:** Gemini, OpenAI, Anthropic, GitHub, AWS, Stripe keys, JWTs, private keys.

**Audit log:** every proxied request is written to `logs/api-proxy-audit.jsonl`.

**SDK integration** (for `proxyMode: none`):
```typescript
import { createLlmProxy, gemini, piiRedactor, secretScanner, auditLogger, defaultPatterns } from "@permissionlabs/claw-farm/security";

const { proxy } = createLlmProxy({
  provider: gemini({ apiKey: process.env.GEMINI_API_KEY! }),
  pipeline: [
    piiRedactor({ mode: "redact", patterns: defaultPatterns }),
    secretScanner(),
    auditLogger({ path: "/logs/audit.jsonl" }),
  ],
});
```

See [docs/SECURITY.md](SECURITY.md) for the full security hardening guide and threat model.

---

## 7. Memory Architecture

claw-farm uses a two-layer memory model. Understanding it helps you avoid data loss.

```
Layer 0: Raw Storage  (immutable, append-only — NEVER delete)
  openclaw/sessions/*.jsonl       ← Session transcripts
  raw/workspace-snapshots/        ← Periodic snapshots of MEMORY.md, SOUL.md

Layer 1: Processing  (disposable, rebuildable from Layer 0)
  processed/                      ← Embeddings, indexes, summaries
```

**Why two layers?** Layer 0 is the source of truth. Layer 1 is a derived cache. If you switch memory processors or the index gets corrupted, you can always rebuild:

```bash
claw-farm memory:rebuild my-agent
```

**Optional: Mem0 + Qdrant** — for semantic memory search across conversations:
```bash
claw-farm init my-agent --processor mem0
```

This adds a `mem0/` service and `data/qdrant/` volume to the compose stack. Mem0 provides vector-based memory recall; the raw session logs still exist in Layer 0.

---

## 8. Deploy to Production

```bash
# Generate a unified Docker Compose for all registered projects
claw-farm cloud:compose
# → writes docker-compose.cloud.yml
```

This merges all your projects into a single compose file with an nginx reverse proxy for routing, TLS termination, and rate limiting.

**Deploy with Coolify on Hetzner (recommended setup):**

1. Provision a Hetzner CX22 (~€4.35/mo)
2. Install [Coolify](https://coolify.io) on the server
3. Connect your git repository to Coolify
4. Push `docker-compose.cloud.yml` to your repo:
   ```bash
   git add docker-compose.cloud.yml
   git push origin main
   ```
5. Coolify auto-deploys on push — no SSH required.

For multi-instance projects, each `spawn` creates a new service entry. Regenerate and push `docker-compose.cloud.yml` after spawning new users.

---

## 9. Upgrade and Maintain

When claw-farm releases new templates (updated security proxy, new config defaults), apply them to existing projects:

```bash
# Re-generate all claw-farm-managed files (preserves your customizations)
claw-farm upgrade my-agent

# Also overwrite policy.yaml (use when you want the latest tool restrictions)
claw-farm upgrade my-agent --force-policy
```

`upgrade` rewrites files like `api-proxy/api_proxy.py`, `docker-compose.openclaw.yml`, and `openclaw.json`, but does **not** overwrite `SOUL.md`, `MEMORY.md`, or `policy.yaml` (unless `--force-policy`).

**Stop and remove a user's instance:**
```bash
claw-farm despawn dog-agent --user alice
```

**Stop all projects:**
```bash
claw-farm down --all
```

---

## Next Steps

| Document | What is in it |
|----------|--------------|
| [docs/ARCHITECTURE.md](ARCHITECTURE.md) | Full file structure diagrams, container topology, data flow, multi-instance architecture |
| [docs/SECURITY.md](SECURITY.md) | Security hardening guide, threat model, PII/secret pattern reference |
| [docs/sdk-guide.md](sdk-guide.md) | SDK integration for `proxyMode: none` — embedding security into your own TypeScript server |
| [docs/ko/](ko/) | Korean translations of all docs |

**For AI agents reading this doc:** after bootstrapping a project, read `.claw-farm.json` to determine the `runtime` and `proxyMode` in use, then refer to the file map in `docs/ARCHITECTURE.md` to find the correct paths for `SOUL.md`, `MEMORY.md`, and `config`. The `/claw-farm-code` Claude Code skill (in `.claude/skills/`) provides a compact reference for working inside managed projects.
