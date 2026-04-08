> English version: [getting-started.md](../getting-started.md)

# claw-farm 시작하기

claw-farm은 **사용자별 에이전트 서비스**를 구축하기 위한 인프라 툴킷입니다. 각 사용자는 독립된 메모리, 세션, API 키 격리를 갖춘 자신만의 AI 에이전트를 갖게 됩니다. 이 가이드는 처음부터 멀티 유저 에이전트 서비스를 실행하는 것까지 단계별로 안내합니다.

---

## 사전 요구사항

- **[Bun](https://bun.sh)** — 런타임 및 패키지 매니저 (`curl -fsSL https://bun.sh/install | bash`)
- **Docker** + **Docker Compose** — 에이전트 컨테이너 실행용
- LLM API 키 (Gemini, Anthropic, 또는 OpenAI 호환)

확인:
```bash
bun --version       # >= 1.0
docker --version
docker compose version
```

---

## 1. claw-farm 설치

```bash
git clone https://github.com/PermissionLabs/claw-farm.git ~/claw-farm
cd ~/claw-farm && bun install

# 셸 프로파일에 alias 추가
echo 'alias claw-farm="bun run ~/claw-farm/src/index.ts"' >> ~/.zshrc
source ~/.zshrc
```

> **npm publish 예정** — 릴리즈 후 `bun install -g @permissionlabs/claw-farm` 으로 설치할 수 있습니다.

정상 동작 확인:
```bash
claw-farm list
# → (첫 실행 시 빈 테이블, 오류 없음)
```

---

## 2. 첫 번째 에이전트 만들기 (단일 사용자)

멀티 유저로 확장하기 전에 먼저 구조를 파악하기 위해 단일 사용자부터 시작합니다.

```bash
mkdir my-agent && cd my-agent
claw-farm init my-agent
```

이 명령은 프로젝트를 `~/.claw-farm/registry.json` (전역 포트 레지스트리, 18789부터 자동 포트 할당)에 등록하고 다음 구조를 생성합니다:

```
my-agent/
  .claw-farm.json               # 프로젝트 설정 (name, port, runtime, proxyMode)
  .env.example                  # API 키 템플릿
  docker-compose.openclaw.yml   # 풀 스택 (에이전트 + 보안 프록시)
  api-proxy/                    # 보안 사이드카 — 절대 생략하지 마세요
    api_proxy.py                #   키 주입 + PII 제거 + 시크릿 스캔
    Dockerfile
    requirements.txt
  openclaw/
    openclaw.json               # LLM 설정 (raw 키 없음 — 프록시를 통해 라우팅)
    policy.yaml                 # 툴 접근 제한 (fs, http, shell)
    workspace/
      SOUL.md                   # 에이전트 성격 — 자유롭게 편집 가능
      MEMORY.md                 # 대화에서 축적된 메모리
      skills/                   # 커스텀 스킬 디렉터리
    sessions/                   # Layer 0: 불변 세션 로그 — 절대 삭제 금지
    logs/
  raw/workspace-snapshots/      # 주기적인 워크스페이스 스냅샷
  processed/                    # Layer 1: 재구성 가능한 인덱스
  logs/                         # API 프록시 감사 로그
```

**API 키 설정:**
```bash
cp .env.example .env
# .env 파일을 편집하고 키를 설정하세요, 예:
# GEMINI_API_KEY=AIza...
```

**에이전트 시작:**
```bash
claw-farm up my-agent
```

대시보드 열기: `http://localhost:18789`

**에이전트 성격 커스터마이징** — `openclaw/workspace/SOUL.md`를 편집하세요. 이 파일은 에이전트의 정체성, 말투, 제약 조건, 행동 규칙을 정의합니다. 변경 사항은 다음 대화부터 적용됩니다.

---

## 3. 멀티 유저로 확장 (사용자별 에이전트)

위의 단일 사용자 설정은 하나의 컨테이너입니다. 각 사용자가 자신만의 격리된 에이전트를 갖는 실제 서비스를 위해:

```bash
mkdir dog-agent && cd dog-agent
claw-farm init dog-agent --multi
```

`--multi`는 **템플릿 + 인스턴스** 구조를 생성합니다:

```
dog-agent/
  template/                     # 모든 사용자에게 공유
    SOUL.md                     #   공유 성격
    AGENTS.md                   #   공유 행동 규칙
    skills/                     #   공유 커스텀 스킬
    USER.template.md            #   사용자별 컨텍스트 템플릿 ({{placeholders}} 포함)
  instances/                    # 사용자별 하위 디렉터리 (spawn으로 생성)
  .claw-farm.json
  .env.example
```

이렇게 분리하는 이유는? 모든 사용자의 에이전트는 동일한 성격과 스킬을 공유하지만 (한 곳에서 관리), 각 사용자는 격리된 메모리, 세션, API 라우팅을 갖습니다. `template/SOUL.md`를 한 번 수정하면 모든 사용자에게 업데이트가 반영됩니다.

**각 사용자에 대한 인스턴스 생성:**
```bash
claw-farm spawn dog-agent --user alice --context name=Poppy breed=Maltese age=3
claw-farm spawn dog-agent --user bob   --context name=Max   breed=Golden  age=5
```

`spawn`은 템플릿을 복사하고, `USER.template.md`의 플레이스홀더를 `--context` 값으로 채우고, 포트를 할당한 뒤 컨테이너를 시작합니다. 각 사용자는 다음을 갖게 됩니다:

- 자신만의 `instances/alice/openclaw/workspace/MEMORY.md`
- 자신만의 `instances/alice/openclaw/sessions/` (불변 로그)
- 자신만의 포트와 컨테이너

사용자 간 공유: `template/SOUL.md`, `template/AGENTS.md`, `template/skills/`.

**활성 인스턴스 목록:**
```bash
claw-farm instances dog-agent
```

**프로그래매틱 API** (서버의 가입 플로우에서 사용):
```typescript
import { spawn } from "@permissionlabs/claw-farm";

await spawn("dog-agent", {
  user: newUser.id,
  context: { name: newUser.dogName, breed: newUser.dogBreed },
});
```

---

## 4. 런타임 선택

claw-farm은 두 가지 에이전트 런타임을 지원합니다. 리소스 제약에 따라 선택하세요.

| | OpenClaw | picoclaw |
|---|---|---|
| **이미지 크기** | ~1.5 GB | ~20 MB |
| **언어** | Node.js | Go |
| **설정** | `openclaw.json` + `policy.yaml` | 단일 `config.json` |
| **메모리 경로** | `workspace/MEMORY.md` | `workspace/memory/MEMORY.md` |
| **세션 경로** | `sessions/` | `workspace/sessions/` |
| **적합한 경우** | 풀 기능, 복잡한 에이전트 | 다수의 경량 인스턴스, 엣지 배포 |

```bash
# picoclaw로 스캐폴드
claw-farm init my-agent --runtime picoclaw

# 기존 프로젝트 전환
claw-farm migrate-runtime my-agent --to picoclaw
```

---

## 5. 프록시 모드 선택

프록시 모드는 인스턴스 전반에 걸쳐 API 키 보안이 배포되는 방식을 제어합니다.

| 모드 | 동작 | 사용 시점 |
|------|------|----------|
| `per-instance` (기본값) | 각 인스턴스가 자체 `api-proxy` 컨테이너를 가짐 | 최대 격리; 사용자별 다른 API 키 |
| `shared` | 모든 인스턴스가 하나의 `api-proxy` 컨테이너를 공유 | 모든 사용자가 동일한 API 키를 사용할 때 리소스 절약 |
| `none` | 프록시 컨테이너 생성 안 함 | 보안 SDK를 자체 서버에 직접 통합할 때 |

```bash
claw-farm init my-agent --proxy-mode shared
claw-farm init my-agent --proxy-mode none
```

**선택 가이드:**
- API 키를 직접 관리하는 소비자 앱을 만드는 경우? `shared` 사용.
- 사용자가 자신의 키를 가져오는 엔터프라이즈 환경? `per-instance` 사용.
- TypeScript 서버가 이미 있고 미들웨어로 보안을 내장하려는 경우? `none`을 사용하고 SDK에서 임포트하세요 (섹션 6 참고).

---

## 6. 보안 개요

모든 claw-farm 프로젝트는 기본적으로 보안 프록시와 함께 제공됩니다 (`proxyMode: none` 제외). 자동으로 보호되는 내용은 다음과 같습니다.

**흐름:**
```
Agent  →  api-proxy (내부 전용)  →  LLM API  →  api-proxy  →  Agent
```

**아웃바운드 (에이전트 → LLM):**
- 요청이 전송되기 전에 PII가 자동 제거됩니다. 예:
  ```
  "My SSN is 900101-1234567"  →  "My SSN is [REDACTED_KR_RRN]"
  ```
- raw API 키는 에이전트에 노출되지 않으며 프록시가 주입합니다.

**인바운드 (LLM → 에이전트):**
- 응답에 포함된 API 키와 시크릿이 제거됩니다. 예:
  ```
  "Here is the key: sk-ant-abc123..."  →  "Here is the key: [REDACTED_ANTHROPIC_KEY]"
  ```

**감지되는 PII 패턴:** 한국 주민등록번호/전화번호, 미국 SSN/전화번호, 신용카드, 이메일.
**감지되는 시크릿 패턴:** Gemini, OpenAI, Anthropic, GitHub, AWS, Stripe 키, JWT, 개인 키.

**감사 로그:** 프록시를 통한 모든 요청이 `logs/api-proxy-audit.jsonl`에 기록됩니다.

**SDK 통합** (`proxyMode: none`의 경우):
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

전체 보안 강화 가이드와 위협 모델은 [docs/ko/security.md](security.md)를 참고하세요.

---

## 7. 메모리 아키텍처

claw-farm은 2계층 메모리 모델을 사용합니다. 이를 이해하면 데이터 손실을 방지할 수 있습니다.

```
Layer 0: Raw Storage  (불변, 추가 전용 — 절대 삭제 금지)
  openclaw/sessions/*.jsonl       ← 세션 트랜스크립트
  raw/workspace-snapshots/        ← MEMORY.md, SOUL.md의 주기적 스냅샷

Layer 1: Processing  (일회용, Layer 0에서 재구성 가능)
  processed/                      ← 임베딩, 인덱스, 요약
```

**왜 2계층인가요?** Layer 0이 진실의 원천입니다. Layer 1은 파생된 캐시입니다. 메모리 프로세서를 교체하거나 인덱스가 손상된 경우 언제든지 재구성할 수 있습니다:

```bash
claw-farm memory:rebuild my-agent
```

**선택 사항: Mem0 + Qdrant** — 대화 간 시맨틱 메모리 검색을 위해:
```bash
claw-farm init my-agent --processor mem0
```

이렇게 하면 compose 스택에 `mem0/` 서비스와 `data/qdrant/` 볼륨이 추가됩니다. Mem0은 벡터 기반 메모리 리콜을 제공하며, raw 세션 로그는 Layer 0에 계속 존재합니다.

---

## 8. 프로덕션 배포

```bash
# 등록된 모든 프로젝트를 위한 통합 Docker Compose 생성
claw-farm cloud:compose
# → docker-compose.cloud.yml 파일 생성
```

이 명령은 모든 프로젝트를 nginx 리버스 프록시(라우팅, TLS 종료, 속도 제한 포함)가 포함된 단일 compose 파일로 병합합니다.

**Hetzner에서 Coolify로 배포 (권장 설정):**

1. Hetzner CX22 (~€4.35/월) 프로비저닝
2. 서버에 [Coolify](https://coolify.io) 설치
3. git 저장소를 Coolify에 연결
4. `docker-compose.cloud.yml`을 저장소에 푸시:
   ```bash
   git add docker-compose.cloud.yml
   git push origin main
   ```
5. Coolify는 푸시 시 자동 배포 — SSH 불필요.

멀티 인스턴스 프로젝트의 경우, 각 `spawn`이 새 서비스 항목을 생성합니다. 새 사용자를 spawn한 후 `docker-compose.cloud.yml`을 재생성하고 푸시하세요.

---

## 9. 업그레이드 및 유지보수

claw-farm이 새 템플릿(업데이트된 보안 프록시, 새 설정 기본값)을 릴리즈하면 기존 프로젝트에 적용하세요:

```bash
# 모든 claw-farm 관리 파일 재생성 (커스터마이징 유지)
claw-farm upgrade my-agent

# policy.yaml도 덮어쓰기 (최신 툴 제한을 원할 때)
claw-farm upgrade my-agent --force-policy
```

`upgrade`는 `api-proxy/api_proxy.py`, `docker-compose.openclaw.yml`, `openclaw.json` 같은 파일을 재작성하지만, `SOUL.md`, `MEMORY.md`, `policy.yaml`은 **덮어쓰지 않습니다** (`--force-policy` 제외).

**사용자 인스턴스 중지 및 제거:**
```bash
claw-farm despawn dog-agent --user alice
```

**모든 프로젝트 중지:**
```bash
claw-farm down --all
```

---

## 다음 단계

| 문서 | 내용 |
|------|------|
| [docs/ko/architecture.md](architecture.md) | 전체 파일 구조 다이어그램, 컨테이너 토폴로지, 데이터 플로우, 멀티 인스턴스 아키텍처 |
| [docs/ko/security.md](security.md) | 보안 강화 가이드, 위협 모델, PII/시크릿 패턴 레퍼런스 |
| [docs/sdk-guide.md](../sdk-guide.md) | `proxyMode: none`을 위한 SDK 통합 — 자체 TypeScript 서버에 보안 내장 |
| [docs/ko/](.) | 모든 문서의 한국어 번역 |

**이 문서를 읽는 AI 에이전트에게:** 프로젝트 부트스트랩 후 `.claw-farm.json`을 읽어 사용 중인 `runtime`과 `proxyMode`를 확인하고, `docs/ko/architecture.md`의 파일 맵을 참고하여 `SOUL.md`, `MEMORY.md`, `config`의 올바른 경로를 찾으세요. `.claude/skills/`에 있는 `/claw-farm-code` Claude Code 스킬은 관리되는 프로젝트 내에서 작업하기 위한 간결한 레퍼런스를 제공합니다.
