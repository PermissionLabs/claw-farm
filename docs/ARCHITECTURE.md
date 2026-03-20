# claw-farm Architecture

> **This document is the single source of truth for the project's architecture.**
> When the structure changes, update this document **first**.
> CLAUDE.md and README.md reference this document.
>
> Korean version: [ko/ARCHITECTURE.md](ko/ARCHITECTURE.md)

## 1. What the CLI Does

```
┌─────────────────────────────────────────────────────────────────┐
│                        Developer                                 │
│                                                                 │
│  $ claw-farm init dog-agent --processor mem0                    │
│  $ claw-farm init tamagochi                                     │
│  $ claw-farm init tutor-bot --processor mem0                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     claw-farm CLI                                │
│                   (Bun script, zero deps)                       │
│                                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │   init   │ │  up/down │ │   list   │ │ memory:rebuild   │   │
│  │          │ │          │ │          │ │                   │   │
│  │ scaffold │ │ docker   │ │ status   │ │ raw→processed    │   │
│  │ register │ │ compose  │ │ table    │ │ rebuild          │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Global Registry  ~/.claw-farm/registry.json              │   │
│  │                                                          │   │
│  │  dog-agent  → /Users/.../dog-agent    port 18789         │   │
│  │  tamagochi  → /Users/.../tamagochi    port 18790         │   │
│  │  tutor-bot  → /Users/.../tutor-bot    port 18791         │   │
│  │                                                          │   │
│  │  nextPort: 18792                                         │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Generated File Structure

```
my-agent/
│
├── .claw-farm.json                 ← Project meta (name, port, processor)
├── .env.example                    ← GEMINI_API_KEY= (fill this in)
├── docker-compose.openclaw.yml     ← Full stack definition
│
├── api-proxy/                      ← ★ Security sidecar (auto-generated)
│   ├── api_proxy.py                    PII redaction + key injection + secret scan
│   ├── Dockerfile
│   └── requirements.txt
│
├── openclaw/
│   ├── config/
│   │   ├── openclaw.json5          ← LLM config (no keys! routes through proxy)
│   │   └── policy.yaml             ← Tool access restrictions (fs, http, shell)
│   │
│   ├── workspace/                  ← ★ Agent read/write space
│   │   ├── SOUL.md                     Personality & behavior rules
│   │   ├── MEMORY.md                   Accumulated via conversations
│   │   └── skills/                     Custom skills
│   │
│   ├── raw/                        ← ★ Layer 0: NEVER delete
│   │   ├── sessions/                   Session log originals (.jsonl)
│   │   └── workspace-snapshots/        Auto-snapshot on up/down
│   │
│   └── processed/                  ← Layer 1: disposable, rebuildable
│
├── logs/                           ← Audit logs
│
├── mem0/                           ← (--processor mem0 only)
│   ├── mem0_server.py
│   ├── Dockerfile
│   └── requirements.txt
│
└── data/qdrant/                    ← (--processor mem0 only)
```

## 3. Container Topology

### Builtin Processor (default)

```
┌─────────────────────────────────────────────────────┐
│                    Docker                            │
│                                                     │
│   ┌─ proxy-net (internal: true) ──────────────┐     │
│   │                                            │     │
│   │  ┌──────────────┐    ┌──────────────────┐ │     │
│   │  │  api-proxy   │    │    openclaw      │ │     │
│   │  │              │◄───│                  │ │     │
│   │  │ Holds        │    │ NO API keys     │ │     │
│   │  │ GEMINI_API_  │    │ Loads SOUL.md   │ │     │
│   │  │ KEY          │    │ R/W MEMORY.md   │ │     │
│   │  │ :8080        │    │ :18789 → host   │ │     │
│   │  └──────┬───────┘    └──────────────────┘ │     │
│   │         │                                  │     │
│   └─────────┼──────────────────────────────────┘     │
│             │                                        │
│             ▼  External network                      │
│     generativelanguage.googleapis.com                │
└─────────────────────────────────────────────────────┘
      │
      ▼
  localhost:18789 ──→ Browser dashboard
```

### Mem0 Processor (4-tier)

```
┌──────────────────────────────────────────────────────────────┐
│                         Docker                                │
│                                                              │
│  ┌─ proxy-net (outbound OK) ────────────────────────┐        │
│  │                                                   │        │
│  │  ┌──────────────┐        ┌──────────────────┐    │        │
│  │  │  api-proxy   │◄───────│    openclaw      │    │        │
│  │  │  Key inject  │        │    NO keys       │    │        │
│  │  │  PII redact  │        │    :18789 → host │    │        │
│  │  │  Secret scan │        │                  │    │        │
│  │  │  :8080       │        └────────┬─────────┘    │        │
│  │  └──────┬───────┘                 │              │        │
│  └─────────┼─────────────────────────┼──────────────┘        │
│            │                         │                       │
│            ▼  External               │                       │
│    googleapis.com                    │                       │
│                                      │                       │
│  ┌─ frontend (internal: true) ───────┼──────────────┐        │
│  │                                   │              │        │
│  │                           ┌───────▼────────┐     │        │
│  │                           │   mem0-api     │     │        │
│  │                           │   FastAPI      │     │        │
│  │                           │   :8050        │     │        │
│  │                           └───────┬────────┘     │        │
│  └───────────────────────────────────┼──────────────┘        │
│                                      │                       │
│  ┌─ backend (internal: true) ────────┼──────────────┐        │
│  │                           ┌───────▼────────┐     │        │
│  │                           │    qdrant      │     │        │
│  │                           │  Vector DB     │     │        │
│  │                           │  :6333         │     │        │
│  │                           └────────────────┘     │        │
│  └──────────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────┘
```

**Network isolation rules:**
- `proxy-net`: Only api-proxy has outbound access. OpenClaw exits only through the proxy.
- `frontend`: OpenClaw ↔ Mem0 only. No external access.
- `backend`: Mem0 ↔ Qdrant only. No external access.

## 4. Security Data Flow

```
User: "My dog's phone is 010-1234-5678 and SSN 880101-1234567..."
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ OpenClaw (agent)                                             │
│                                                             │
│  1. Loads SOUL.md → "I am a dog specialist AI"              │
│  2. Loads MEMORY.md → "Poppy is a 3-year-old Maltese"       │
│  3. Sends user message + context to LLM                     │
│     → http://api-proxy:8080                                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ api-proxy (security layer)                                   │
│                                                             │
│  ★ OUTBOUND (agent → LLM)                                  │
│                                                             │
│  Original: "phone 010-1234-5678, SSN 880101-1234567"        │
│                    ↓ PII redaction                           │
│  Sent:     "phone [REDACTED_KR_PHONE],                      │
│             SSN [REDACTED_KR_RRN]"                          │
│                                                             │
│  + API key injected (agent never sees it)                   │
│  + Audit log written (logs/api-proxy-audit.jsonl)           │
│                                                             │
│  ──────────────────→ Gemini API ────────────────→           │
│                                                             │
│  ★ INBOUND (LLM → agent)                                   │
│                                                             │
│  Original: "Found key from session: sk-ant-abc123def456..."  │
│                    ↓ Secret scan                             │
│  Returned: "Found key from session: [REDACTED_ANTHROPIC_KEY]"│
│                                                             │
│  + Audit log written                                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ OpenClaw (agent)                                             │
│                                                             │
│  4. Receives clean LLM response                             │
│  5. Updates MEMORY.md: "Poppy's owner has contact info"     │
│  6. Responds to user                                        │
│  7. Session log → raw/sessions/ (auto-saved)                │
└─────────────────────────────────────────────────────────────┘
```

**PII redaction targets:** Korean RRN, mobile, landline / US SSN, phone / Credit cards / Email
**Secret scan targets:** Google/OpenAI/Anthropic/GitHub/GitLab/AWS/Stripe keys, JWT, Private Key
**PII mode:** `PII_MODE=redact` (default, auto-mask) | `block` (reject) | `warn` (log only)

## 5. 2-Layer Memory

```
              ┌─────────────────────────────────┐
              │         Layer 0: raw/            │
              │       Immutable — never delete    │
              │                                 │
              │  sessions/                      │
              │    2026-03-20-session1.jsonl     │  ← Conversation originals
              │    2026-03-21-session2.jsonl     │
              │                                 │
              │  workspace-snapshots/            │
              │    2026-03-20T11-34-46/          │  ← Auto on up/down
              │      MEMORY.md                  │
              │      SOUL.md                    │
              └──────────────┬──────────────────┘
                             │
                             │  claw-farm memory:rebuild
                             │  (rebuild anytime)
                             ▼
              ┌─────────────────────────────────┐
              │       Layer 1: processed/       │
              │     Swappable — safe to wipe     │
              │                                 │
              │  Current: builtin (MEMORY.md)    │
              │       or: mem0 (Qdrant vectors)  │
              │                                 │
              │  New approach available?          │
              │   → Delete processed/            │
              │   → Swap processor               │
              │   → memory:rebuild               │
              │   → Rebuilt from raw!             │
              └─────────────────────────────────┘
```

**Principles:**
- Raw data is never deleted (prevents hallucination, enables audit trails)
- Processing layer is swappable (test new approaches instantly)
- `claw-farm memory:rebuild` re-indexes from originals in one command

## 6. Multi-Instance Operation

```
localhost
    │
    ├── :18789  dog-agent    (mem0)    /permissionlabs/dog-agent
    ├── :18790  tamagochi    (builtin) /permissionlabs/tamagochi
    ├── :18791  tutor-bot    (mem0)    /permissionlabs/tutor-bot
    │
    │   $ claw-farm list
    │   ┌──────────────┬───────┬───────────┐
    │   │ dog-agent    │ 18789 │ 🟢 running │
    │   │ tamagochi    │ 18790 │ ⚪ stopped │
    │   │ tutor-bot    │ 18791 │ 🟢 running │
    │   └──────────────┴───────┴───────────┘
    │
    │   $ claw-farm up --all     # Start all
    │   $ claw-farm down --all   # Stop all
    │
    ▼
  cloud:compose → Merge into single docker-compose.cloud.yml
    │
    ▼
  Hetzner VPS + Coolify → Deploy with git push
```

## 7. Existing Project Onboarding

```
my-project (before)                 my-project (after claw-farm init --existing)
├── docker-compose.yml  ← untouched ├── docker-compose.yml    (untouched)
├── .env                            ├── .env                  (untouched)
├── openclaw/                       ├── openclaw/
│   ├── config/                     │   ├── config/
│   │   └── openclaw.json5          │   │   ├── openclaw.json5 (untouched)
│   └── workspace/                  │   │   └── policy.yaml    ★ added
│       ├── SOUL.md                 │   ├── workspace/         (untouched)
│       ├── MEMORY.md               │   ├── raw/               ★ added
│       └── skills/                 │   │   ├── sessions/
├── mem0/                           │   │   └── workspace-snapshots/
│   ├── Dockerfile                  │   └── processed/         ★ added
│   └── mem0_server.py              ├── mem0/                  (untouched)
└── data/qdrant/                    ├── api-proxy/             ★ added
                                    │   ├── api_proxy.py
                                    │   ├── Dockerfile
                                    │   └── requirements.txt
                                    ├── logs/                  ★ added
                                    └── .claw-farm.json        ★ added

★ = Added by claw-farm init --existing. Existing files are NEVER modified.
```

**Onboarding command:**
```bash
cd /path/to/existing-project
claw-farm init <name> --existing [--processor mem0]
```
