# claw-farm

Multi OpenClaw instance manager — scaffold, run, and deploy AI agents with persistent memory.

## Project Overview

- **Runtime:** Bun (zero npm dependencies, Bun built-ins only)
- **Language:** TypeScript (strict, allowImportingTsExtensions)
- **Package:** `@permissionlabs/claw-farm`
- **Repo:** github.com/PermissionLabs/claw-farm (public, MIT)

## Architecture

```
claw-farm CLI
  ├── commands/        # init, up, down, list, memory:rebuild, cloud:compose
  ├── lib/             # registry, compose, config, ports, raw-collector
  ├── processors/      # interface, builtin (MEMORY.md), mem0 (Qdrant)
  └── templates/       # docker-compose, openclaw.json5, SOUL.md, policy.yaml, api-proxy, nginx
```

### 2-Layer Memory Architecture
- **Layer 0 (raw/):** Immutable, append-only. Session logs + workspace snapshots. NEVER delete.
- **Layer 1 (processed/):** Swappable processors. Can be wiped and rebuilt from Layer 0.

### Security Architecture (API Proxy Pattern)
```
OpenClaw ──(internal net, no API key)──→ api-proxy ──(key injection + PII redaction)──→ Gemini API
                                        ← (secret scanning) ←
```
- OpenClaw container has NO API keys and NO direct internet access
- api-proxy sidecar: key injection, PII auto-redaction, response secret scanning, audit logging
- PII detected: Korean RRN/phone, US SSN/phone, credit cards, emails → auto-masked as [REDACTED_TYPE]
- Secrets detected: Google/OpenAI/Anthropic/GitHub/AWS/Stripe keys, JWTs, private keys → stripped from responses
- All containers: read-only rootfs, cap_drop ALL, resource limits, tmpfs

## Commands

```bash
bun run src/index.ts init <name>                  # Scaffold project
bun run src/index.ts init <name> --processor mem0  # With Mem0+Qdrant
bun run src/index.ts init <name> --existing        # Register existing + add security layer
bun run src/index.ts up [name|--all]               # Start containers
bun run src/index.ts down [name|--all]             # Stop containers
bun run src/index.ts list                          # Show all projects
bun run src/index.ts memory:rebuild [name]         # Rebuild Layer 1 from raw
bun run src/index.ts cloud:compose [outfile]       # Generate cloud compose
```

## Development

```bash
bun install              # Install dev deps (bun-types, typescript)
bun run typecheck        # tsc --noEmit
bun run src/index.ts     # Run CLI
```

## Global Registry

`~/.claw-farm/registry.json` — tracks all projects, auto-assigns ports starting from 18789.

## Conventions

- Korean as default language for user-facing templates (SOUL.md, etc.)
- GitHub org: PermissionLabs (always)
- Squash merge only, branch protection on main
- Commit messages: English, concise, "why" not "what"

## Security Reference

See `docs/SECURITY.md` for comprehensive OpenClaw security hardening guide based on 2026-03-20 research.

---

## For AI Agents: How to Use claw-farm in Other Projects

If you're an AI agent working in a project that uses claw-farm (e.g., dog-agent, tamagochi), here's what you need to know:

### Check if this project is managed by claw-farm
Look for `.claw-farm.json` in the project root. It contains:
```json
{
  "name": "project-name",
  "processor": "builtin" or "mem0",
  "port": 18789,
  "createdAt": "2026-03-20T..."
}
```

### Key files you should know about

| File | Purpose | Can you edit? |
|------|---------|---------------|
| `openclaw/workspace/SOUL.md` | Agent personality & behavior rules | Yes — this defines who you are |
| `openclaw/workspace/MEMORY.md` | Accumulated agent memory | Yes — OpenClaw updates this automatically |
| `openclaw/workspace/skills/` | Custom skills directory | Yes — add new skills here |
| `openclaw/config/openclaw.json5` | LLM model & plugin config | Only if user asks |
| `openclaw/config/policy.yaml` | Tool access restrictions | Only if user asks |
| `openclaw/raw/` | Immutable session logs | **NEVER delete or modify** |
| `api-proxy/api_proxy.py` | Security proxy | Only if user asks |
| `docker-compose.openclaw.yml` | Container orchestration | Only if user asks |

### Important security rules
1. **API keys are NOT in your environment.** They're in the api-proxy container. Don't look for them.
2. **Your outbound requests are PII-filtered.** If you send user data to the LLM, sensitive patterns (SSN, phone numbers, etc.) are automatically redacted.
3. **Your LLM responses are secret-scanned.** If the LLM accidentally outputs API keys or tokens, they're stripped before reaching you.
4. **raw/ is sacred.** Layer 0 data is append-only and never deleted. This is how memory survives processor changes.
5. **processed/ is disposable.** Layer 1 can be wiped and rebuilt with `claw-farm memory:rebuild`.

### Registering this project with claw-farm
If the project isn't registered yet:
```bash
cd /path/to/project
bun run /path/to/claw-farm/src/index.ts init project-name --existing --processor mem0
```

### Starting/stopping
```bash
bun run /path/to/claw-farm/src/index.ts up project-name
bun run /path/to/claw-farm/src/index.ts down project-name
```
