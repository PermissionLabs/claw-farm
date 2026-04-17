# OpenClaw Security Hardening Guide

> Research as of 2026-03-20. Rationale document for claw-farm's security design.
>
> Korean version: [ko/security.md](ko/security.md)

## Sources

- [OpenClaw Official Security Docs](https://docs.openclaw.ai/gateway/security)
- [Nebius: OpenClaw Security Architecture Guide](https://nebius.com/blog/posts/openclaw-security)
- [Snyk: 280+ Leaky Skills — Credential Leak Research](https://snyk.io/blog/openclaw-skills-credential-leaks-research/)
- [Knostic: openclaw-shield (PII/Secret Prevention)](https://www.knostic.ai/blog/openclaw-shield-preventing-secret-leaks-pii-exposure-and-destructive-commands)
- [DEV.to: Complete Privacy & Security Guide 2026](https://dev.to/apilover/how-to-secure-your-openclaw-installation-complete-privacy-security-guide-2026-750)
- [Docker Blog: Run OpenClaw Securely in Docker Sandboxes](https://www.docker.com/blog/run-openclaw-securely-in-docker-sandboxes/)
- [Microsoft Security Blog: Running OpenClaw Safely (2026-02)](https://www.microsoft.com/en-us/security/blog/2026/02/19/running-openclaw-safely-identity-isolation-runtime-risk/)
- [HN Discussion on Docker Security](https://news.ycombinator.com/item?id=46884143)

---

## 1. API Key / Credential Management

### Core Principle
- **The agent must never see the API key**
- Passing keys as env vars allows the agent to read them via `env` or `/proc/self/environ`
- Snyk research: 7.1% of ClawHub skills (283/3,984) have critical credential exposure flaws

### Recommended Architecture: API Proxy Sidecar
```
OpenClaw ──(no key)──→ API Proxy ──(key injection)──→ LLM API
```
- OpenClaw uses `apiBaseUrl: "http://api-proxy:8080"`
- Only the proxy holds API keys, with no external port exposure
- Proxy injects keys and forwards upstream

### Additional Recommendations
- Use a Secret Manager (Vault, AWS SM, 1Password CLI) instead of .env files
- Separate API keys per project with spending limits
- Rotate keys every 90 days
- Run `openclaw security audit` regularly

### claw-farm Implementation
- `api-proxy/` sidecar: FastAPI, key injection, audit logging
- OpenClaw container has NO `GEMINI_API_KEY`
- `openclaw.json` uses `apiKey: "proxied"`

---

## 2. Data Leakage Prevention (PII / Personal Data)

### Threat Model
1. **Outbound leakage**: User personal data (videos, photos, documents) included in LLM prompts
2. **Skill-based leakage**: Malicious/vulnerable skills store keys in MEMORY.md → exfiltration
3. **Log leakage**: Sensitive data persists in session transcripts
4. **LLM response leakage**: Agent includes previously-seen secrets in responses

### Snyk's 4 Leak Patterns
1. **Verbatim Output**: Skill outputs API key directly to chat
2. **Financial Exfil**: Card numbers embedded in curl commands
3. **Log Leakage**: Session files exported without redaction
4. **Plaintext Storage**: Keys stored as plaintext in MEMORY.md

### openclaw-shield 5-Layer Defense
1. **Prompt Guard**: Injects security policies into agent context
2. **Output Scanner**: Redacts secrets/PII from tool output
3. **Tool Blocker**: Blocks dangerous tool calls at host level
4. **Input Audit**: Logs inbound messages + detects secrets
5. **Security Gate**: ALLOWED/DENIED judgment before exec/file-read

### claw-farm Implementation
- `api-proxy` detects outbound PII patterns (SSN, cards, phones, Korean RRN)
- `MAX_PROMPT_SIZE_MB=5` limit (blocks bulk file exfiltration)
- PII auto-redaction (detect → mask as `[REDACTED_TYPE]`)
- LLM response secret scanning (AWS keys, GitHub tokens, card numbers, etc.)
- Audit log records content hash + PII detection flags

---

## 3. Container / Infrastructure Isolation

### Docker Hardening Checklist
- [x] `read_only: true` — read-only container filesystem
- [x] `tmpfs` — /tmp, .cache only as writable (size-limited)
- [x] `cap_drop: ALL` — drop all Linux capabilities
- [x] `security_opt: no-new-privileges` — prevent privilege escalation
- [x] `deploy.resources.limits` — memory/CPU limits
- [x] Non-root user (OpenClaw: node, mem0/proxy: appuser)
- [x] Volume mounts `:ro` (config directory)

### Network Topology
```
                    ┌─ proxy-net (outbound OK) ─┐
  openclaw ────────→│ api-proxy ───────────→ Gemini API
     │              └───────────────────────────┘
     │
     ├─ frontend (internal, no outbound)
     └────────────→ mem0-api
                      │
                    backend (internal)
                      │
                    qdrant
```
- `proxy-net`: Only api-proxy has external access
- `frontend`: OpenClaw ↔ Mem0 only (internal)
- `backend`: Mem0 ↔ Qdrant only (internal)

---

## 4. Network Access Control

### Local Development
- `127.0.0.1` binding (no external access)
- `gateway.bind: "loopback"` default

### Cloud Deployment
- `gateway.auth.mode: "token"` required
- Nginx reverse proxy + TLS + Basic Auth
- IP allowlist or Tailscale VPN
- `dmPolicy: "pairing"` (blocks unknown senders)

### Never Do This
- Bind to `0.0.0.0` without auth token
- Set `dmPolicy: "open"` (unlimited inbound)
- Expose dashboard publicly

---

## 5. Tool Access Control

### Principle: Allowlist-first
```yaml
tools:
  filesystem:
    allow: [/home/node/.openclaw/workspace/**]
    deny: [/etc/**, /proc/**, /sys/**]
  http:
    deny: ["*"]  # deny all by default
  shell:
    enabled: false
  code_execution:
    sandbox: true
    timeout_seconds: 30
```

### Dangerous Tools (require explicit control)
- `exec` / `process`: Command execution
- `browser`: Browser automation
- `web_fetch` / `web_search`: External content
- `gateway`: Config changes
- `cron`: Scheduled jobs

### ClawHub Skill Security
- Review source code before installing any skill
- Audit with `mcp-scan`
- Test in sandbox first
- 2026-01 ClawHavoc campaign: hundreds of malicious skills discovered (keyloggers, API key theft)

---

## 6. Auditing / Monitoring

### Required Audit Items
- All tool calls (timestamp + user + action)
- LLM API requests (content hash, size, response code, elapsed time)
- PII detection events
- Failed authentication attempts

### Commands
```bash
openclaw security audit              # Basic audit
openclaw security audit --deep       # Includes live gateway probe
openclaw security audit --fix        # Auto-correct some issues
openclaw security audit --json       # Machine-readable output
```

### Log Management
- JSON/JSONL format
- Rotate at 100MB, retain max 10 files
- Redact sensitive data before retention
- Auto-delete logs older than 30 days

---

## 7. Incident Response

### Immediate Containment
1. Stop gateway process
2. Set `gateway.bind: "loopback"`
3. Disable Tailscale Funnel/Serve
4. Set risky channels to `dmPolicy: "disabled"`

### Key Rotation (on secret exposure)
1. `gateway.auth.token`
2. LLM API keys (Gemini, OpenAI, etc.)
3. Channel credentials (Slack, Discord, etc.)
4. Encrypted secrets in `secrets.json`

### Post-Incident Analysis
1. Review `/tmp/openclaw/openclaw-YYYY-MM-DD.log`
2. Examine session transcripts
3. Check config change history
4. Re-run `openclaw security audit --deep`

---

## 8. Security Hardening — Review 4.7

The following sections document controls added in the April 2026 security sweep. Each item is tied to a specific backlog item (BKLG-NNN) and corresponds to shipped code.

### SSRF hardening (BKLG-003)

`src/sdk/lib/url-safety.ts` exports `validateUpstreamUrl(url, opts?)`. Every LLM provider factory (`gemini`, `openaiCompat`) and `llm-proxy.ts` call this before issuing upstream requests. The validator:

- Requires HTTPS in production (HTTP is allowed only when `ALLOW_PRIVATE_BASE_URL=1` is set).
- Resolves the hostname via DNS and rejects any address in private/reserved ranges: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (IMDS), `::1`, `fc00::/7`, `fd00::/8`.
- Blocks the AWS EC2 metadata endpoint (`169.254.169.254`) explicitly.
- Mirrors the same check in the Python api-proxy using `ipaddress` + `socket.gethostbyname`.

**Escape hatch:** Set `ALLOW_PRIVATE_BASE_URL=1` in the `.env` to allow loopback/private targets (local dev only — never in production).

**Why:** Without this check, a misconfigured or malicious `OPENAI_COMPAT_BASE_URL` can pivot the proxy into IMDS credential theft or internal-network reconnaissance. The egress-net container has outbound access, so the exposure is real in cloud deployments.

### PII redaction — Unicode handling (BKLG-002)

All PII and secret-scan paths now run a normalization step before pattern matching:

1. **NFKC normalization** — `text.normalize("NFKC")` in TS, `unicodedata.normalize("NFKC", text)` in Python — maps fullwidth digits (e.g. `９１０１０１`) and fullwidth hyphens (`\uFF0D`) to their ASCII equivalents before the regex runs.
2. **Zero-width and RTL override strip** — Characters `\u200B \u200C \u200D \uFEFF \u202E` are stripped from the matching copy. This prevents evasion by inserting invisible characters inside a Korean RRN or credit card number.
3. **Double-pass scan strategy** — Normalization runs on a copy; the match positions are mapped back to the original string for replacement, so the output text is not modified beyond redaction.

**Known limitation:** If a zero-width character falls at a regex boundary (e.g., between the digit group and the separator), the strip removes it and the pattern matches correctly. However, if zero-width characters split a digit sequence that a pattern requires to be contiguous (e.g., `880101\u200B-1234567`), the normalization copy strips the ZWJ but the separator `-` is still ASCII, so the match succeeds. Prefix-breaking ZWCs (one inside the digit run itself) will defeat matching on the copy as well — this is a documented limitation and not fixed in this sweep.

### Secret scanning — single source of truth (BKLG-001)

Previously, secret patterns existed in two independent places: `src/sdk/secret-scanner.ts` (TypeScript) and inline inside `src/templates/api-proxy.ts` (Python string literals). The two sets had diverged: the Python proxy had no SSE/streaming fallback, and the TS SDK had no AWS STS session-token patterns.

**Current state:**

- `src/sdk/patterns/secrets.ts` is the canonical pattern source (TypeScript).
- `src/sdk/patterns/python-emitter.ts` serializes those patterns to Python-compatible regex literals at build time, keeping the Python proxy in sync from a single definition.
- The Python api-proxy now has a raw-text fallback: when `json.loads` fails (SSE `text/event-stream`, non-JSON error pages), the body is scanned as raw text rather than silently passed through.
- The TS SDK `llm-proxy.ts` always runs a raw-text scan after the JSON parse attempt, regardless of whether JSON parse succeeded.

**AWS STS patterns** (BKLG-020): `AWS_SESSION_TOKEN` and temporary access keys (`ASIA…` prefix) are now included in the shared pattern set.

### File permissions — `writeSecret` helper (BKLG-010)

Any file that contains secrets (`.env`, registry entries, per-instance config) is now written through `writeSecret(path, content)` in `src/lib/fs-utils.ts`. This helper:

- Writes to a temp file first (`path + ".tmp"`), then atomically renames to the target.
- Sets permissions to `0o600` (owner read/write only) before the rename.
- Prevents a TOCTOU window where a partially written file is world-readable.

Previously, `init` and `--multi` paths wrote `.env.example` and `.env` without setting permissions.

### TLS verification (BKLG-021)

The Python api-proxy uses `httpx.AsyncClient` with explicit `verify=True, trust_env=False, follow_redirects=False`. `trust_env=False` prevents `HTTPS_PROXY`, `SSL_CERT_FILE`, and similar environment variables from silently downgrading TLS verification. A `certifi` import assertion runs at startup to fail fast if the CA bundle is missing from the image.

### Container hardening (BKLG-024)

- **Pinned UID/GID 10001:** `api-proxy` and `mem0` Dockerfiles create a non-root user with `useradd -u 10001 -g 10001 appuser`. Pinning prevents accidental UID collisions with host users.
- **`init: true` on api-proxy and mem0:** Adds a minimal init process (PID 1) so SIGTERM propagates correctly to the Python process. Without it, `docker stop` times out and sends SIGKILL, which can corrupt in-flight audit log writes.
- `uvicorn` is started with `--proxy-headers` to correctly read `X-Forwarded-For` when behind nginx.

### Header and query smuggling (BKLG-011)

- **Outbound query string:** The Python proxy now uses `urllib.parse.urlencode(params, doseq=True)` (multi-value aware) instead of manual string concatenation, preventing `%0A`-injection that could add extra query parameters.
- **Response header strip:** `Set-Cookie`, `Server`, `X-Powered-By`, and `X-Forwarded-*` are stripped from upstream LLM responses before they reach the agent. The agent should never receive session cookies or server fingerprinting headers from the LLM provider.
- **Inbound hop-by-hop headers** (`Connection`, `Upgrade`, `Keep-Alive`, `Transfer-Encoding`) are removed from the forwarded request.
- The TS SDK `llm-proxy.ts` applies the same outbound strip list.

### Rate limiting — per-tenant nginx zones (BKLG-026)

The nginx config generated by `cloud:compose` uses `$binary_remote_addr$host` as the rate-limit zone key instead of `$binary_remote_addr` alone. This gives each tenant (host) its own budget, preventing one tenant's traffic from exhausting the shared zone and rate-limiting other tenants. The zone size and rate remain configurable via the `NGINX_RATE_LIMIT` env var.

---

## 9. proxyMode Security Implications

claw-farm supports two api-proxy deployment modes via the `--proxy-mode` flag. The choice has direct security implications.

### per-instance (default)

Each user instance has its own api-proxy container.

- **Secret isolation:** Each proxy can hold different API keys. User A's key is never accessible to User B's agent container.
- **Audit isolation:** Each proxy writes its own audit log. Per-user forensics are straightforward.
- **Blast radius:** A compromised proxy only exposes one user's credentials.
- **Same security model as OpenClaw's default architecture.**

### shared

All user instances share a single api-proxy container at the project level.

- **No per-user secret isolation:** All instances use the same API key. If one agent is compromised, the shared key is exposed to all.
- **Shared audit log:** All users' requests appear in the same log. Per-user attribution requires parsing request metadata.
- **Larger blast radius:** A compromised shared proxy exposes the key used by all instances.
- **Use only when:** All instances are trusted equally (e.g., same organization, same trust level) and resource efficiency is more important than per-user key isolation.

### Container Isolation (unchanged by proxyMode)

Regardless of proxyMode, each user instance runs in its own container with:
- Separate filesystem (read_only, tmpfs)
- Separate network namespace
- Separate memory/CPU limits
- No cross-instance volume sharing

This applies to both OpenClaw and picoclaw runtimes. The picoclaw runtime uses per-user containers in the same isolation pattern as OpenClaw, despite picoclaw's smaller footprint (~20MB vs ~1.5GB).
