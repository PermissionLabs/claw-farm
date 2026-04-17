# OpenClaw Security Hardening Guide

> 2026-03-20 기준 리서치. claw-farm 보안 설계의 근거 문서.
>
> 영문 버전: [security.md](../security.md)

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

## 1. API 키 / 크레덴셜 관리

### 핵심 원칙
- **에이전트는 API 키를 절대 볼 수 없어야 함**
- 키를 env var로 직접 전달하면 에이전트가 `env` 명령이나 `/proc/self/environ`으로 읽을 수 있음
- Snyk 연구: ClawHub 스킬 7.1% (283/3,984개)에서 크리티컬 크레덴셜 유출 발견

### 권장 아키텍처: API Proxy Sidecar
```
OpenClaw ──(키 없음)──→ API Proxy ──(키 주입)──→ LLM API
```
- OpenClaw은 `apiBaseUrl: "http://api-proxy:8080"` 사용
- 프록시만 API 키 보유, 외부 포트 노출 없음
- 프록시에서 키 주입 후 upstream 포워딩

### 추가 권장사항
- Secret Manager (Vault, AWS SM, 1Password CLI) 사용 — .env 대신
- 프로젝트별 별도 API 키 + spending limit 설정
- 90일 주기 키 로테이션
- `openclaw security audit` 정기 실행

### claw-farm 구현
- `api-proxy/` 사이드카: FastAPI, 키 주입, 감사 로그
- OpenClaw 컨테이너에 `GEMINI_API_KEY` 없음
- `openclaw.json`에서 `apiKey: "proxied"` 설정

---

## 2. 데이터 유출 방지 (PII / 개인정보)

### 위협 모델
1. **아웃바운드 유출**: 유저의 개인정보(동영상, 사진, 문서)가 LLM 프롬프트에 포함되어 외부 전송
2. **스킬 통한 유출**: 악성/취약 스킬이 MEMORY.md에 키 저장 → 유출
3. **로그 유출**: 세션 트랜스크립트에 민감 데이터 잔류
4. **LLM 응답 유출**: 에이전트가 이전에 본 시크릿을 응답에 포함

### Snyk 발견 4대 유출 패턴
1. **Verbatim Output**: 스킬이 API 키를 채팅에 직접 출력
2. **Financial Exfil**: 카드번호를 curl 명령에 임베딩
3. **Log Leakage**: 세션 파일을 리댁션 없이 export
4. **Plaintext Storage**: MEMORY.md에 키를 평문 저장

### openclaw-shield 5-Layer 방어
1. **Prompt Guard**: 에이전트 컨텍스트에 보안 정책 주입
2. **Output Scanner**: 툴 출력에서 시크릿/PII 리댁션
3. **Tool Blocker**: 위험한 툴 콜 호스트 레벨 차단
4. **Input Audit**: 인바운드 메시지 로깅 + 시크릿 탐지
5. **Security Gate**: exec/file-read 전 ALLOWED/DENIED 판정

### claw-farm 구현
- `api-proxy`에서 아웃바운드 PII 패턴 탐지 (SSN, 카드, 전화번호, 한국 주민번호)
- `MAX_PROMPT_SIZE_MB=5` 제한 (대용량 파일 통째 전송 차단)
- PII 자동 리댁션 (탐지 → [REDACTED] 마스킹)
- LLM 응답 시크릿 스캐닝 (AWS 키, GitHub 토큰, 카드번호 등)
- 감사 로그에 content hash + PII 탐지 플래그 기록

---

## 3. 컨테이너 / 인프라 격리

### Docker 하드닝 체크리스트
- [x] `read_only: true` — 컨테이너 파일시스템 읽기 전용
- [x] `tmpfs` — /tmp, .cache만 임시 쓰기 (크기 제한)
- [x] `cap_drop: ALL` — 모든 Linux capabilities 제거
- [x] `security_opt: no-new-privileges` — 권한 상승 방지
- [x] `deploy.resources.limits` — 메모리/CPU 제한
- [x] non-root 유저 (OpenClaw: node, mem0/proxy: appuser)
- [x] 볼륨 마운트 `:ro` (config 디렉토리)

### 네트워크 토폴로지
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
- `proxy-net`: api-proxy만 외부 접근 가능
- `frontend`: OpenClaw ↔ Mem0 only (internal)
- `backend`: Mem0 ↔ Qdrant only (internal)

---

## 4. 네트워크 접근 제어

### 로컬 개발
- `127.0.0.1` 바인딩 (외부 접근 불가)
- `gateway.bind: "loopback"` 기본값

### 클라우드 배포
- `gateway.auth.mode: "token"` 필수
- Nginx 리버스 프록시 + TLS + Basic Auth
- IP allowlist 또는 Tailscale VPN
- `dmPolicy: "pairing"` (알 수 없는 sender 차단)

### 절대 하지 말 것
- `0.0.0.0` 바인딩 without auth token
- `dmPolicy: "open"` (무제한 인바운드)
- 대시보드 공개 노출

---

## 5. 툴 접근 제어

### 원칙: Allowlist-first
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

### 위험한 툴 (명시적 제어 필요)
- `exec` / `process`: 명령 실행
- `browser`: 브라우저 자동화
- `web_fetch` / `web_search`: 외부 콘텐츠
- `gateway`: 설정 변경
- `cron`: 스케줄 작업

### ClawHub 스킬 보안
- 설치 전 소스 코드 리뷰 필수
- `mcp-scan`으로 스킬 감사
- 샌드박스에서 먼저 테스트
- 2026-01 ClawHavoc 캠페인: 수백 개 악성 스킬 발견 (키로거, API 키 탈취)

---

## 6. 감사 / 모니터링

### 필수 감사 항목
- 모든 tool call (타임스탬프 + 유저 + 액션)
- LLM API 요청 (content hash, 크기, 응답 코드, 소요 시간)
- PII 탐지 이벤트
- 실패한 인증 시도

### 명령어
```bash
openclaw security audit              # 기본 감사
openclaw security audit --deep       # 라이브 게이트웨이 프로브 포함
openclaw security audit --fix        # 자동 교정
openclaw security audit --json       # 머신 리더블 출력
```

### 로그 관리
- JSON/JSONL 포맷
- 100MB 단위 로테이션, 최대 10개 보관
- 민감 데이터 리댁션 후 보관
- 30일 이상 로그 자동 삭제 정책

---

## 7. 인시던트 대응

### 즉시 격리
1. 게이트웨이 프로세스 중지
2. `gateway.bind: "loopback"` 설정
3. Tailscale Funnel/Serve 비활성화
4. 위험 채널 `dmPolicy: "disabled"`

### 키 로테이션 (시크릿 노출 시)
1. `gateway.auth.token`
2. LLM API 키 (Gemini, OpenAI 등)
3. 채널 크레덴셜 (Slack, Discord 등)
4. `secrets.json` 내 암호화된 시크릿

### 사후 분석
1. `/tmp/openclaw/openclaw-YYYY-MM-DD.log` 검토
2. 세션 트랜스크립트 검사
3. 설정 변경 이력 확인
4. `openclaw security audit --deep` 재실행

---

## 8. 보안 하드닝 — Review 4.7

아래 항목들은 2026년 4월 보안 스윕에서 추가된 제어 사항입니다. 각 항목은 출시된 코드와 연결된 백로그 항목(BKLG-NNN)을 참조합니다.

### SSRF 하드닝 (BKLG-003)

`src/sdk/lib/url-safety.ts`가 `validateUpstreamUrl(url, opts?)` 함수를 export합니다. 모든 LLM 프로바이더 팩토리(`gemini`, `openaiCompat`)와 `llm-proxy.ts`는 업스트림 요청 전에 이 함수를 호출합니다. 검증기는:

- 프로덕션 환경에서 HTTPS를 요구합니다 (`ALLOW_PRIVATE_BASE_URL=1` 설정 시 HTTP 허용).
- 호스트명을 DNS로 확인한 후 사설/예약 대역을 차단합니다: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (IMDS), `::1`, `fc00::/7`, `fd00::/8`.
- AWS EC2 메타데이터 엔드포인트(`169.254.169.254`)를 명시적으로 차단합니다.
- Python api-proxy에서도 `ipaddress` + `socket.gethostbyname`으로 동일한 검사를 수행합니다.

**이스케이프 해치:** `.env`에 `ALLOW_PRIVATE_BASE_URL=1`을 설정하면 루프백/사설 대상을 허용합니다 (로컬 개발 전용 — 프로덕션에서는 절대 사용 금지).

**이유:** 이 검사 없이는 잘못 설정되거나 악의적인 `OPENAI_COMPAT_BASE_URL`이 프록시를 IMDS 크레덴셜 탈취 또는 내부 네트워크 정찰에 활용될 수 있습니다.

### PII 리댁션 — 유니코드 처리 (BKLG-002)

모든 PII 및 시크릿 스캔 경로는 패턴 매칭 전 정규화 단계를 수행합니다:

1. **NFKC 정규화** — TS에서 `text.normalize("NFKC")`, Python에서 `unicodedata.normalize("NFKC", text)` — 전각 숫자(예: `９１０１０１`)와 전각 하이픈(`\uFF0D`)을 ASCII로 변환합니다.
2. **제로폭 및 RTL 오버라이드 제거** — 매칭 복사본에서 `\u200B \u200C \u200D \uFEFF \u202E` 문자를 제거합니다. 주민번호나 카드번호 안에 보이지 않는 문자를 삽입한 우회를 방지합니다.
3. **이중 패스 스캔 전략** — 정규화는 복사본에서 수행하고 매칭 위치를 원본 문자열에 매핑하여 치환합니다.

**알려진 한계:** 숫자 시퀀스 내부에 제로폭 문자가 삽입된 경우(예: 숫자 그룹 중간에 ZWJ), 해당 숫자 시퀀스를 연속적으로 요구하는 패턴에서 매칭이 실패할 수 있습니다. 이는 문서화된 한계이며 이번 스윕에서는 수정되지 않았습니다.

### 시크릿 스캐닝 — 단일 소스 오브 트루스 (BKLG-001)

이전에는 시크릿 패턴이 두 곳에 독립적으로 존재했습니다: `src/sdk/secret-scanner.ts`(TypeScript)와 `src/templates/api-proxy.ts`(Python 문자열 리터럴). 두 세트는 이미 분기되어 있었고 Python 프록시에는 SSE/스트리밍 폴백이 없었습니다.

**현재 상태:**

- `src/sdk/patterns/secrets.ts`가 표준 패턴 소스입니다 (TypeScript).
- `src/sdk/patterns/python-emitter.ts`가 해당 패턴을 빌드 시 Python 호환 정규식 리터럴로 직렬화하여 Python 프록시와 동기화합니다.
- Python api-proxy에 raw-text 폴백이 추가되었습니다: `json.loads` 실패 시(SSE `text/event-stream`, 비-JSON 에러 페이지) 본문을 raw text로 스캔합니다.
- TS SDK `llm-proxy.ts`는 JSON 파싱 성공 여부와 무관하게 항상 raw-text 스캔을 수행합니다.

**AWS STS 패턴** (BKLG-020): `AWS_SESSION_TOKEN` 및 임시 액세스 키(`ASIA…` 접두사)가 공유 패턴 세트에 포함되었습니다.

### 파일 권한 — `writeSecret` 헬퍼 (BKLG-010)

시크릿을 포함하는 파일(`.env`, 레지스트리 항목, 인스턴스별 설정)은 이제 `src/lib/fs-utils.ts`의 `writeSecret(path, content)`를 통해 작성됩니다. 이 헬퍼는:

- 먼저 임시 파일(`path + ".tmp"`)에 쓴 후 원자적으로 대상 파일로 이름을 변경합니다.
- 이름 변경 전 권한을 `0o600`(소유자 읽기/쓰기 전용)으로 설정합니다.
- 부분 작성된 파일이 전체 읽기 가능한 TOCTOU 창을 방지합니다.

### TLS 검증 (BKLG-021)

Python api-proxy는 `httpx.AsyncClient(verify=True, trust_env=False, follow_redirects=False)`를 사용합니다. `trust_env=False`는 `HTTPS_PROXY`, `SSL_CERT_FILE` 등의 환경 변수가 TLS 검증을 자동으로 다운그레이드하는 것을 방지합니다. 시작 시 `certifi` import 단언이 실행되어 이미지에 CA 번들이 없으면 즉시 실패합니다.

### 컨테이너 하드닝 (BKLG-024)

- **UID/GID 10001 고정:** `api-proxy`와 `mem0` Dockerfile이 `useradd -u 10001 -g 10001 appuser`로 non-root 사용자를 생성합니다. 고정을 통해 호스트 사용자와의 UID 충돌을 방지합니다.
- **api-proxy 및 mem0에 `init: true`:** 최소 init 프로세스(PID 1)를 추가하여 SIGTERM이 Python 프로세스에 올바르게 전파됩니다. 없으면 `docker stop`이 타임아웃되어 SIGKILL을 보내 진행 중인 감사 로그 쓰기가 손상될 수 있습니다.
- `uvicorn`은 nginx 뒤에서 `X-Forwarded-For`를 올바르게 읽기 위해 `--proxy-headers`로 시작합니다.

### 헤더 및 쿼리 스머글링 (BKLG-011)

- **아웃바운드 쿼리 스트링:** Python 프록시는 수동 문자열 연결 대신 `urllib.parse.urlencode(params, doseq=True)`(다중값 지원)를 사용합니다.
- **응답 헤더 제거:** `Set-Cookie`, `Server`, `X-Powered-By`, `X-Forwarded-*`가 LLM 응답에서 제거된 후 에이전트에 전달됩니다.
- **인바운드 홉-바이-홉 헤더**(`Connection`, `Upgrade`, `Keep-Alive`, `Transfer-Encoding`)는 전달 요청에서 제거됩니다.
- TS SDK `llm-proxy.ts`도 동일한 아웃바운드 제거 목록을 적용합니다.

### 속도 제한 — 테넌트별 nginx 존 (BKLG-026)

`cloud:compose`가 생성하는 nginx 설정은 속도 제한 존 키로 `$binary_remote_addr` 대신 `$binary_remote_addr$host`를 사용합니다. 이를 통해 각 테넌트(호스트)가 자체 예산을 가지며, 한 테넌트의 트래픽이 공유 존을 소진하여 다른 테넌트를 제한하는 상황을 방지합니다.

---

## 9. proxyMode 보안 영향

claw-farm은 `--proxy-mode` 플래그로 두 가지 api-proxy 배포 모드를 지원합니다. 선택은 직접적인 보안 영향을 미칩니다.

### per-instance (기본값)

각 사용자 인스턴스는 자체 api-proxy 컨테이너를 가집니다.

- **시크릿 격리:** 각 프록시는 다른 API 키를 보유할 수 있습니다. 사용자 A의 키는 사용자 B의 에이전트 컨테이너에서 접근할 수 없습니다.
- **감사 격리:** 각 프록시는 자체 감사 로그를 작성합니다. 사용자별 포렌식이 간단합니다.
- **블래스트 반경:** 손상된 프록시는 한 사용자의 크레덴셜만 노출합니다.
- **OpenClaw 기본 아키텍처와 동일한 보안 모델.**

### shared

모든 사용자 인스턴스가 프로젝트 레벨의 단일 api-proxy 컨테이너를 공유합니다.

- **사용자별 시크릿 격리 없음:** 모든 인스턴스가 동일한 API 키를 사용합니다. 에이전트 하나가 손상되면 공유 키가 모두에게 노출됩니다.
- **공유 감사 로그:** 모든 사용자의 요청이 같은 로그에 기록됩니다. 사용자별 추적을 위해서는 요청 메타데이터를 파싱해야 합니다.
- **더 큰 블래스트 반경:** 손상된 공유 프록시는 모든 인스턴스가 사용하는 키를 노출합니다.
- **사용 시기:** 모든 인스턴스가 동등하게 신뢰되고(예: 동일 조직, 동일 신뢰 수준) 리소스 효율이 사용자별 키 격리보다 중요한 경우.

### 컨테이너 격리 (proxyMode에 무관)

proxyMode에 관계없이 각 사용자 인스턴스는 자체 컨테이너에서 실행됩니다:
- 별도 파일시스템 (read_only, tmpfs)
- 별도 네트워크 네임스페이스
- 별도 메모리/CPU 제한
- 크로스 인스턴스 볼륨 공유 없음

OpenClaw와 picoclaw 런타임 모두에 적용됩니다. picoclaw 런타임은 더 작은 풋프린트(~20MB vs ~1.5GB)에도 불구하고 OpenClaw와 동일한 격리 패턴을 사용합니다.
