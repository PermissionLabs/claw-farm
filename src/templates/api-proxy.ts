/**
 * API Proxy sidecar — sits between OpenClaw and external LLM APIs.
 *
 * Purpose:
 * 1. API key isolation: agent never sees the real key
 * 2. Egress filtering: scans & REDACTS PII in outbound prompts
 * 3. Response scanning: strips secrets from LLM responses before they reach the agent
 * 4. Request logging: audit trail of all LLM calls
 *
 * OpenClaw talks to http://api-proxy:8080, proxy injects real API key
 * and forwards to the actual LLM endpoint.
 */

import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { defaultSecretPatterns } from "../sdk/secret-scanner.ts";
import { emitPythonSecretPatterns } from "../sdk/patterns/python-emitter.ts";
import { emitPythonPiiPatterns } from "./api-proxy-patterns.ts";

export function apiProxyServerTemplate(): string {
  const secretPatternLines = emitPythonSecretPatterns(defaultSecretPatterns);
  return `"""
API Proxy — key injection + PII redaction + response secret scanning.
Sits between OpenClaw and external LLM APIs.

Supports multiple providers:
  - gemini (default): Google Gemini API
  - anthropic: Anthropic Claude API
  - openai-compat: Any OpenAI-compatible endpoint (e.g. claude-max-api-proxy)

Egress (outbound):  PII detected → auto-redacted before sending to LLM
Ingress (response): Secrets detected → stripped before returning to agent

OpenClaw → http://api-proxy:8080/... → (redact + key inject) → LLM API
                                      ← (secret scan) ←
"""

import hashlib
import hmac as hmac_mod
import ipaddress
import json
import logging
import logging.handlers
import os
import posixpath
import re
import socket
import stat
import time
import unicodedata
from datetime import datetime, timezone
from urllib.parse import urlparse, urlencode

try:
    import certifi
except ImportError:
    raise RuntimeError("certifi is required for TLS verification — add certifi to requirements.txt")

import httpx
from fastapi import FastAPI, Request, Response

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("api-proxy")

app = FastAPI(title="API Proxy")

# --- Config ---
# Provider: gemini (default) | anthropic | openai-compat
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "").strip().lower()

# Provider-specific keys
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

# OpenAI-compatible base URL (for proxies like claude-max-api-proxy)
OPENAI_COMPAT_BASE_URL = os.environ.get("OPENAI_COMPAT_BASE_URL", "")

# Auto-detect provider if not explicitly set
if not LLM_PROVIDER:
    if ANTHROPIC_API_KEY:
        LLM_PROVIDER = "anthropic"
    elif OPENAI_COMPAT_BASE_URL or OPENAI_API_KEY:
        LLM_PROVIDER = "openai-compat"
    else:
        LLM_PROVIDER = "gemini"

# Upstream configuration per provider
PROVIDER_CONFIG = {
    "gemini": {
        "base_url": os.environ.get("UPSTREAM_BASE", "https://generativelanguage.googleapis.com"),
        "auth_header": "x-goog-api-key",
        "auth_key": GEMINI_API_KEY,
        "path_prefixes": ("v1beta/", "v1/", "v1alpha/", "v1beta1/"),
        "query_allowlist": {"alt"},
        "disable_thinking": True,
    },
    "anthropic": {
        "base_url": "https://api.anthropic.com",
        "auth_header": "x-api-key",
        "auth_key": ANTHROPIC_API_KEY,
        "path_prefixes": ("v1/",),
        "query_allowlist": set(),
        "disable_thinking": False,
    },
    "openai-compat": {
        "base_url": OPENAI_COMPAT_BASE_URL.rstrip("/") if OPENAI_COMPAT_BASE_URL else "http://host.docker.internal:3456",
        "auth_header": "authorization",
        "auth_key": f"Bearer {OPENAI_API_KEY}" if OPENAI_API_KEY else "",
        "path_prefixes": ("v1/",),
        "query_allowlist": set(),
        "disable_thinking": False,
    },
}

ACTIVE_PROVIDER = PROVIDER_CONFIG.get(LLM_PROVIDER, PROVIDER_CONFIG["gemini"])
UPSTREAM_BASE = ACTIVE_PROVIDER["base_url"]

# --- SSRF startup check ---
# Reject private/link-local/loopback upstream URLs unless ALLOW_PRIVATE_BASE_URL=1.
# This blocks IMDS theft (169.254.169.254), internal network scanning, etc.
_SSRF_ALLOW_PRIVATE = os.environ.get("ALLOW_PRIVATE_BASE_URL", "").strip() == "1"
_FORBIDDEN_HOSTNAMES = {"metadata.google.internal", "metadata.goog", "metadata"}

def _check_upstream_ssrf(base_url: str) -> None:
    """Raise RuntimeError if base_url resolves to a private/reserved address."""
    if _SSRF_ALLOW_PRIVATE:
        return
    try:
        parsed = urlparse(base_url)
        hostname = parsed.hostname or ""
    except Exception as exc:
        raise RuntimeError(f"SSRF check: cannot parse UPSTREAM_BASE {base_url!r}: {exc}") from exc

    if not hostname:
        raise RuntimeError(f"SSRF check: UPSTREAM_BASE {base_url!r} has no hostname")

    # Reject known metadata hostnames by name
    if hostname.lower() in _FORBIDDEN_HOSTNAMES:
        raise RuntimeError(
            f"SSRF check: UPSTREAM_BASE hostname {hostname!r} is a forbidden metadata endpoint. "
            "Set ALLOW_PRIVATE_BASE_URL=1 to override (local dev only)."
        )

    # Resolve hostname → IP and check address category
    try:
        resolved_ip = socket.gethostbyname(hostname)
    except socket.gaierror:
        # DNS failure at startup is allowed (DNS may not be ready); check is best-effort.
        logger.warning(f"SSRF check: could not resolve {hostname!r} at startup — skipping IP check")
        return

    try:
        addr = ipaddress.ip_address(resolved_ip)
    except ValueError:
        return  # Not a valid IP string, skip

    if addr.is_private or addr.is_link_local or addr.is_loopback or addr.is_reserved or addr.is_unspecified:
        raise RuntimeError(
            f"SSRF check: UPSTREAM_BASE {base_url!r} resolves to private/reserved address {resolved_ip}. "
            "Set ALLOW_PRIVATE_BASE_URL=1 to override (local dev only)."
        )

_check_upstream_ssrf(UPSTREAM_BASE)

logger.info(f"Provider: {LLM_PROVIDER} | Upstream: {UPSTREAM_BASE}")

AUDIT_LOG_PATH = os.environ.get("AUDIT_LOG_PATH", "/logs/api-proxy-audit.jsonl")
MAX_PROMPT_SIZE_MB = int(os.environ.get("MAX_PROMPT_SIZE_MB", "5"))

# --- Audit log setup (BKLG-007): rotating handler + HMAC chain + 0o600 permissions ---
AUDIT_LOG_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
AUDIT_LOG_BACKUP_COUNT = 5
AUDIT_HMAC_KEY = os.environ.get("AUDIT_LOG_HMAC_KEY", "")
if not AUDIT_HMAC_KEY:
    logger.warning("AUDIT_LOG_HMAC_KEY is not set — HMAC integrity chain is disabled")

# Ensure parent directory exists with 0o700
_audit_log_dir = os.path.dirname(AUDIT_LOG_PATH)
if _audit_log_dir:
    os.makedirs(_audit_log_dir, mode=0o700, exist_ok=True)

_audit_handler = logging.handlers.RotatingFileHandler(
    AUDIT_LOG_PATH,
    maxBytes=AUDIT_LOG_MAX_BYTES,
    backupCount=AUDIT_LOG_BACKUP_COUNT,
    encoding="utf-8",
)
_audit_logger = logging.getLogger("audit")
_audit_logger.addHandler(_audit_handler)
_audit_logger.setLevel(logging.INFO)
_audit_logger.propagate = False

# Rolling HMAC chain state
_audit_prev_hmac: str = ""

def _set_audit_log_perms() -> None:
    """Set audit log file to mode 0o600 if it exists."""
    try:
        os.chmod(AUDIT_LOG_PATH, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass

# PII_MODE: "redact" (default) | "block" | "warn"
PII_MODE = os.environ.get("PII_MODE", "redact")

# --- PII Patterns (outbound — redact user data before it reaches the LLM) ---
${emitPythonPiiPatterns()}

# --- Secret Patterns (response — strip secrets before they reach the agent) ---
# Generated from src/sdk/secret-scanner.ts via python-emitter — single source of truth.
SECRET_PATTERNS = [
${secretPatternLines}
]

COMPILED_SECRETS = [(pattern, label) for pattern, label in SECRET_PATTERNS]


_ZERO_WIDTH_RE = re.compile(r"[\\u200B\\u200C\\u200D\\uFEFF\\u202E]")


def normalize_for_scan(text: str) -> str:
    """NFKC-normalize text and strip zero-width/RTL-override chars for pattern matching.

    Maps fullwidth digits (０-９→0-9), Arabic-Indic digits, fullwidth hyphens, etc.
    to their ASCII equivalents, and removes invisible evasion characters.
    The normalized form is used for scanning only; see callers for replacement strategy.
    """
    normalized = unicodedata.normalize("NFKC", text)
    return _ZERO_WIDTH_RE.sub("", normalized)


def redact_pii(text: str) -> tuple[str, list[dict]]:
    """Scan text for PII and replace with [REDACTED_TYPE]. Returns (redacted_text, findings).

    Runs each pattern twice: first on the working string (ASCII input), then on
    the NFKC-normalized form to catch fullwidth digits, Arabic-Indic digits, and
    zero-width evasion characters.
    """
    findings = []
    working = text
    for pattern, label in COMPILED_PII:
        count = len(pattern.findall(working))
        if count:
            findings.append({"type": label, "count": count})
            working = pattern.sub(f"[REDACTED_{label}]", working)
        # Second pass on normalized form to catch Unicode evasion
        norm = normalize_for_scan(working)
        if norm != working:
            norm_count = len(pattern.findall(norm))
            if norm_count:
                findings.append({"type": label, "count": norm_count})
                working = pattern.sub(f"[REDACTED_{label}]", norm)
    return working, findings


def scan_secrets(text: str) -> tuple[str, list[dict]]:
    """Scan text for secrets and replace with [REDACTED_<label>]. Returns (cleaned_text, findings).

    Runs each pattern twice: first on the working string, then on the NFKC-normalized
    form to catch fullwidth/Arabic-Indic digit evasion and zero-width chars.
    """
    findings = []
    working = text
    for pattern, label in COMPILED_SECRETS:
        matches = pattern.findall(working)
        if matches:
            count = len(matches) if not matches or isinstance(matches[0], str) else len(matches)
            findings.append({"type": label, "count": count})
            working = pattern.sub(f"[REDACTED_{label}]", working)
        # Second pass on normalized form
        norm = normalize_for_scan(working)
        if norm != working:
            norm_matches = pattern.findall(norm)
            if norm_matches:
                norm_count = len(norm_matches) if not norm_matches or isinstance(norm_matches[0], str) else len(norm_matches)
                findings.append({"type": label, "count": norm_count})
                working = pattern.sub(f"[REDACTED_{label}]", norm)
    return working, findings


def redact_request_body(body: bytes) -> tuple[bytes, list[dict]]:
    """Parse JSON body, redact PII from all text fields, return modified body."""
    try:
        data = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return body, []

    all_findings = []

    def walk_and_redact(obj):
        if isinstance(obj, str):
            redacted, findings = redact_pii(obj)
            all_findings.extend(findings)
            return redacted
        elif isinstance(obj, dict):
            return {k: walk_and_redact(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [walk_and_redact(item) for item in obj]
        return obj

    redacted_data = walk_and_redact(data)

    if all_findings:
        return json.dumps(redacted_data).encode(), all_findings
    return body, []


def scan_response_body(body: bytes) -> tuple[bytes, list[dict]]:
    """Parse JSON response, strip secrets from all text fields, return cleaned body.

    For non-JSON bodies (SSE streams, plain text, HTML), raw-text scanning is applied
    so that streaming responses are never bypassed.
    """
    try:
        data = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        # Non-JSON (SSE, plain text, HTML): scan raw text so secrets are never bypassed.
        text = body.decode("utf-8", errors="replace")
        cleaned, secret_findings = scan_secrets(text)
        cleaned2, pii_findings = redact_pii(cleaned)
        all_findings = secret_findings + pii_findings
        if all_findings:
            return cleaned2.encode("utf-8", errors="replace"), all_findings
        return body, []

    all_findings = []

    def walk_and_clean(obj):
        if isinstance(obj, str):
            cleaned, findings = scan_secrets(obj)
            # Also check for PII in responses (agent might echo back user data)
            cleaned2, pii_findings = redact_pii(cleaned)
            all_findings.extend(findings)
            all_findings.extend(pii_findings)
            return cleaned2
        elif isinstance(obj, dict):
            return {k: walk_and_clean(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [walk_and_clean(item) for item in obj]
        return obj

    cleaned_data = walk_and_clean(data)

    if all_findings:
        return json.dumps(cleaned_data).encode(), all_findings
    return body, []


def check_content_size(body: bytes) -> bool:
    """Reject requests larger than MAX_PROMPT_SIZE_MB."""
    return len(body) <= MAX_PROMPT_SIZE_MB * 1024 * 1024


def audit_log(entry: dict):
    """Append audit entry to JSONL log with HMAC chain and 0o600 permissions."""
    global _audit_prev_hmac
    try:
        entry["timestamp"] = datetime.now(timezone.utc).isoformat()
        base_json = json.dumps(entry)
        if AUDIT_HMAC_KEY:
            mac = hmac_mod.new(
                AUDIT_HMAC_KEY.encode("utf-8"),
                (_audit_prev_hmac + base_json).encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()
            _audit_prev_hmac = mac
            entry_with_hmac = {**entry, "hmac": mac}
            line = json.dumps(entry_with_hmac)
        else:
            line = base_json
        _audit_handler.emit(logging.makeLogRecord({"msg": line, "levelno": logging.INFO, "levelname": "INFO"}))
        _set_audit_log_perms()
    except Exception:
        logger.exception("Failed to write audit log")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy(request: Request, path: str):
    body = await request.body()

    # --- Guard 0: Path validation (SSRF prevention) ---
    # Reject non-canonical forms (.// a/./b a/../b) that survive simple prefix checks.
    ALLOWED_PATH_PREFIXES = ACTIVE_PROVIDER["path_prefixes"]
    if posixpath.normpath(path) != path or not any(path.startswith(p) for p in ALLOWED_PATH_PREFIXES):
        audit_log({"event": "blocked", "reason": "invalid_path", "path": path})
        return Response(
            content=json.dumps({"error": "Path not allowed"}),
            status_code=403,
            media_type="application/json",
        )

    # --- Guard 1: Content size ---
    if not check_content_size(body):
        audit_log({
            "event": "blocked",
            "reason": "content_too_large",
            "size_bytes": len(body),
            "path": path,
        })
        return Response(
            content=json.dumps({"error": "Request too large"}),
            status_code=413,
            media_type="application/json",
        )

    # --- Guard 2: PII redaction on outbound request ---
    pii_findings = []
    if PII_MODE == "redact":
        body, pii_findings = redact_request_body(body)
        if pii_findings:
            audit_log({
                "event": "pii_redacted",
                "findings": pii_findings,
                "path": path,
                "action": "redacted",
            })
            logger.warning(f"PII redacted in request to {path}: {pii_findings}")
    elif PII_MODE == "block":
        # Check without redacting
        try:
            text = json.dumps(json.loads(body)) if body else ""
        except Exception:
            text = ""
        _, pii_findings = redact_pii(text)
        if pii_findings:
            audit_log({
                "event": "pii_blocked",
                "findings": pii_findings,
                "path": path,
                "action": "blocked",
            })
            return Response(
                content=json.dumps({"error": "Request blocked: PII detected", "types": [f["type"] for f in pii_findings]}),
                status_code=422,
                media_type="application/json",
            )
    elif PII_MODE == "warn":
        try:
            text = json.dumps(json.loads(body)) if body else ""
        except Exception:
            text = ""
        _, pii_findings = redact_pii(text)
        if pii_findings:
            audit_log({
                "event": "pii_detected",
                "findings": pii_findings,
                "path": path,
                "action": "warn",
            })
            logger.warning(f"PII detected (warn mode) in request to {path}: {pii_findings}")

    # --- Guard 3: Content hash for audit trail ---
    content_hash = hashlib.sha256(body).hexdigest()[:16] if body else "empty"

    # --- Guard 5: Disable Gemini thinking tokens (Gemini only) ---
    # OpenClaw may inject thinking/reasoning params that Gemini can't handle properly,
    # causing empty responses (known OpenClaw bugs: #33272, #14456, #14071).
    if ACTIVE_PROVIDER.get("disable_thinking"):
        try:
            data = json.loads(body)
            if isinstance(data, dict):
                generation_config = data.get("generationConfig", {})
                if not isinstance(generation_config, dict):
                    generation_config = {}
                generation_config["thinkingConfig"] = {"thinkingBudget": 0}
                data["generationConfig"] = generation_config
                body = json.dumps(data).encode()
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass  # Non-JSON body, forward as-is

    # --- Forward with key injection ---
    upstream_url = f"{UPSTREAM_BASE}/{path}"

    # Query string allowlist (security: only forward known-safe params, never forward "key")
    # Use urlencode with multi_items() to handle repeated params and prevent value injection.
    allowed_qs = ACTIVE_PROVIDER.get("query_allowlist", set())
    filtered_qs = urlencode(
        [(k, v) for k, v in request.query_params.multi_items() if k in allowed_qs]
    )
    if filtered_qs:
        upstream_url += f"?{filtered_qs}"

    # Forward only safe headers (allowlist, not blocklist)
    FORWARD_HEADERS = {"content-type", "accept", "accept-encoding", "user-agent"}
    headers = {k: v for k, v in request.headers.items() if k.lower() in FORWARD_HEADERS}

    # Inject API key via provider-specific header
    auth_header = ACTIVE_PROVIDER["auth_header"]
    auth_key = ACTIVE_PROVIDER["auth_key"]
    if auth_key:
        headers[auth_header] = auth_key

    # Anthropic requires anthropic-version header
    if LLM_PROVIDER == "anthropic":
        headers["anthropic-version"] = "2023-06-01"

    start = time.monotonic()

    async with httpx.AsyncClient(verify=True, trust_env=False, timeout=120.0, follow_redirects=False) as client:
        upstream_resp = await client.request(
            method=request.method,
            url=upstream_url,
            content=body,
            headers=headers,
        )

    elapsed_ms = int((time.monotonic() - start) * 1000)

    # --- Guard 4: Secret scanning on LLM response ---
    response_body = upstream_resp.content
    secret_findings = []

    if upstream_resp.status_code == 200:
        response_body, secret_findings = scan_response_body(response_body)
        if secret_findings:
            audit_log({
                "event": "secrets_redacted_response",
                "findings": secret_findings,
                "path": path,
            })
            logger.warning(f"Secrets stripped from LLM response: {secret_findings}")

    # --- Audit log ---
    audit_log({
        "event": "request",
        "method": request.method,
        "path": path,
        "content_hash": content_hash,
        "request_size": len(body),
        "response_status": upstream_resp.status_code,
        "response_size": len(response_body),
        "elapsed_ms": elapsed_ms,
        "pii_redacted": bool(pii_findings),
        "secrets_stripped": bool(secret_findings),
    })

    # Forward response headers (skip hop-by-hop and sensitive disclosure headers)
    SKIP_RESP_HEADERS = {
        "transfer-encoding", "content-encoding", "content-length",
        "set-cookie", "set-cookie2", "server", "x-powered-by",
        "strict-transport-security",
    }
    resp_headers = {}
    for k, v in upstream_resp.headers.items():
        if k.lower() not in SKIP_RESP_HEADERS:
            resp_headers[k] = v

    return Response(
        content=response_body,
        status_code=upstream_resp.status_code,
        headers=resp_headers,
    )
`;
}

export function apiProxyDockerfileTemplate(): string {
  return `FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN groupadd -g 10001 appuser && useradd -r -u 10001 -g 10001 -s /bin/false appuser && mkdir /logs && chown -R appuser:appuser /app /logs
USER appuser

COPY api_proxy.py .

EXPOSE 8080

CMD ["uvicorn", "api_proxy:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers", "--forwarded-allow-ips=127.0.0.1"]
`;
}

export function apiProxyRequirementsTemplate(): string {
  return `fastapi==0.115.12
uvicorn[standard]==0.34.2
httpx==0.28.1
certifi>=2024.2.2
`;
}

/** Write all api-proxy files (api_proxy.py, Dockerfile, requirements.txt) into projectDir/api-proxy/. */
export async function writeApiProxyFiles(projectDir: string): Promise<void> {
  const proxyDir = join(projectDir, "api-proxy");
  await mkdir(proxyDir, { recursive: true });
  await Promise.all([
    Bun.write(join(proxyDir, "api_proxy.py"), apiProxyServerTemplate()),
    Bun.write(join(proxyDir, "Dockerfile"), apiProxyDockerfileTemplate()),
    Bun.write(join(proxyDir, "requirements.txt"), apiProxyRequirementsTemplate()),
  ]);
}
