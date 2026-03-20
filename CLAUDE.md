# claw-farm

Multi OpenClaw instance manager — scaffold, run, and deploy AI agents with persistent memory.

## MANDATORY: Documentation Sync Rule

> **아키텍처, 파일 구조, 보안 구조, 컨테이너 토폴로지, 데이터 흐름을 변경하면 반드시 아래 문서를 함께 업데이트하라.**
>
> | 문서 | 역할 | 언제 업데이트 |
> |------|------|-------------|
> | `docs/ARCHITECTURE.md` | **아키텍처 소스 오브 트루스.** 다이어그램, 파일 구조, 토폴로지, 데이터 흐름 | 구조 변경 시 **가장 먼저** 업데이트 |
> | `docs/SECURITY.md` | 보안 설계 근거, 위협 모델, 체크리스트 | 보안 관련 변경 시 |
> | `README.md` | 외부 사용자용 가이드 | 커맨드/설치 방법/구조 변경 시 |
> | `CLAUDE.md` (이 파일) | AI 에이전트 + 개발자 인스트럭션 | 컨벤션/규칙 변경 시 |
>
> **docs/ARCHITECTURE.md가 최신 아키텍처의 단일 출처(single source of truth)다.** 다른 문서의 아키텍처 설명은 이 문서를 따른다. 충돌 시 ARCHITECTURE.md가 우선.

## Project Overview

- **Runtime:** Bun (zero npm dependencies, Bun built-ins only)
- **Language:** TypeScript (strict, allowImportingTsExtensions)
- **Package:** `@permissionlabs/claw-farm`
- **Repo:** github.com/PermissionLabs/claw-farm (public, MIT)

## Architecture (요약)

> 전체 다이어그램은 `docs/ARCHITECTURE.md` 참조.

```
claw-farm CLI
  ├── commands/        # init, up, down, list, memory:rebuild, cloud:compose
  ├── lib/             # registry, compose, config, ports, raw-collector
  ├── processors/      # interface, builtin (MEMORY.md), mem0 (Qdrant)
  └── templates/       # docker-compose, openclaw.json5, SOUL.md, policy.yaml, api-proxy, nginx
```

**보안:** `OpenClaw ──(키 없음)──→ api-proxy ──(PII 리댁션 + 키 주입)──→ Gemini API ──→ (시크릿 스캔) ──→ 에이전트`

**메모리:** Layer 0 (raw/, 불변) → Layer 1 (processed/, 교체 가능)

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

## Key Documentation

| 문서 | 내용 |
|------|------|
| `docs/ARCHITECTURE.md` | 전체 아키텍처 다이어그램 (파일 구조, 컨테이너 토폴로지, 데이터 흐름, 메모리 구조, 온보딩) |
| `docs/SECURITY.md` | OpenClaw 보안 하드닝 가이드 (2026-03-20 리서치 기반, 8개 소스) |
| `README.md` | 사용자 가이드 (설치, 퀵스타트, 커맨드 레퍼런스) |

---

## For AI Agents: How to Use claw-farm in Other Projects

If you're an AI agent working in a project that uses claw-farm (e.g., dog-agent, tamagochi), here's what you need to know.

**먼저 `docs/ARCHITECTURE.md`를 읽어서 전체 구조를 파악하라.**

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

### If you change the architecture
**You MUST update `docs/ARCHITECTURE.md` first**, then sync other docs as needed. See the "Documentation Sync Rule" at the top of this file.
