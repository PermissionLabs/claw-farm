# 에이전트 통합 가이드

> English version: [agent-integration.md](../agent-integration.md)

> 이 가이드는 claw-farm으로 관리되는 프로젝트 내에서 작업하는 AI 에이전트(Claude Code, Cursor, Copilot 등)를 위한 것입니다. 파일을 수정하기 전에 반드시 읽어주세요.

---

## claw-farm 프로젝트 감지

프로젝트 루트에서 `.claw-farm.json` 파일을 찾으세요. 해당 파일이 존재하면 이 프로젝트는 claw-farm으로 관리되며 아래 규칙이 적용됩니다.

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

각 필드를 파악한 후 작업을 진행하세요:

| 필드 | 값 | 제어 대상 |
|------|--------|-----------------|
| `runtime` | `"openclaw"` \| `"picoclaw"` | 사용할 디렉터리 구조 및 설정 파일 형식 |
| `proxyMode` | `"per-instance"` \| `"shared"` \| `"none"` | api-proxy 컨테이너 존재 여부 및 시크릿 범위 |
| `processor` | `"builtin"` \| `"mem0"` | 메모리 백엔드; mem0은 Qdrant 컨테이너를 추가함 |
| `multiInstance` | `true` \| 없음 | `template/` + `instances/` 레이아웃 사용 여부 |
| `port` | 정수 | OpenClaw/picoclaw가 노출되는 호스트 포트 |

---

## 프로젝트 레이아웃

### 단일 인스턴스 — openclaw

```
my-agent/
├── .claw-farm.json
├── .env.example
├── docker-compose.openclaw.yml
├── api-proxy/                        ← proxyMode=none이면 없음
│   ├── api_proxy.py
│   ├── Dockerfile
│   └── requirements.txt
├── openclaw/
│   ├── openclaw.json                 ← LLM 설정 (API 키 없음)
│   ├── policy.yaml                   ← 도구 접근 제한
│   ├── workspace/
│   │   ├── SOUL.md                   ← 에이전트 퍼스널리티
│   │   ├── MEMORY.md                 ← 누적 메모리
│   │   └── skills/                   ← 커스텀 스킬
│   ├── sessions/                     ← 절대 수정 금지
│   └── logs/
├── raw/                              ← 절대 수정 금지
│   └── workspace-snapshots/
└── processed/                        ← 삭제 가능; memory:rebuild로 재생성
```

### 단일 인스턴스 — picoclaw

```
my-agent/
├── .claw-farm.json
├── .env.example
├── docker-compose.picoclaw.yml
├── api-proxy/                        ← proxyMode=none이면 없음
│   ├── api_proxy.py
│   ├── Dockerfile
│   └── requirements.txt
└── picoclaw/
    ├── config.json                   ← 모든 설정을 하나의 파일로 (LLM + tools + policy)
    └── workspace/
        ├── SOUL.md                   ← 에이전트 퍼스널리티
        ├── AGENTS.md                 ← 동작 규칙
        ├── skills/                   ← 커스텀 스킬
        ├── memory/
        │   └── MEMORY.md             ← 누적 메모리
        └── sessions/                 ← 절대 수정 금지
```

### 멀티 인스턴스 — openclaw

공유 템플릿 파일은 모든 사용자에게 적용됩니다. 사용자별 파일은 `instances/<user-id>/` 아래에 격리됩니다.

```
my-agent/
├── .claw-farm.json                   ← multiInstance: true
├── template/
│   ├── SOUL.md                       ← 공유 퍼스널리티 (모든 사용자에게 영향)
│   ├── AGENTS.md                     ← 공유 동작 규칙 (모든 사용자에게 영향)
│   ├── skills/                       ← 공유 스킬 (모든 사용자에게 영향)
│   └── USER.template.md              ← 사용자별 컨텍스트 플레이스홀더 템플릿
├── instances/
│   └── <user-id>/
│       ├── .env
│       ├── docker-compose.openclaw.yml
│       ├── api-proxy/                ← per-instance 전용; proxyMode=shared 또는 none이면 없음
│       └── openclaw/
│           ├── openclaw.json
│           ├── policy.yaml
│           ├── workspace/
│           │   ├── SOUL.md           ← template/SOUL.md에서 심볼릭 링크 또는 복사
│           │   ├── USER.md           ← USER.template.md에서 생성
│           │   ├── MEMORY.md         ← 사용자별 격리 메모리
│           │   └── skills/           ← template/skills/에서 심볼릭 링크 또는 복사
│           └── sessions/             ← 절대 수정 금지
└── api-proxy/                        ← proxyMode=shared 전용; 모든 인스턴스가 공유하는 프록시
```

### 멀티 인스턴스 — picoclaw

```
my-agent/
├── .claw-farm.json                   ← multiInstance: true, runtime: picoclaw
├── template/
│   ├── SOUL.md
│   ├── AGENTS.md
│   ├── skills/
│   ├── USER.template.md
│   └── config/
│       └── config.json               ← 공유 picoclaw 설정
├── instances/
│   └── <user-id>/
│       ├── .env
│       ├── docker-compose.picoclaw.yml
│       ├── api-proxy/                ← per-instance 전용
│       └── picoclaw/
│           ├── config.json
│           └── workspace/
│               ├── SOUL.md
│               ├── USER.md
│               ├── skills/
│               ├── memory/
│               │   └── MEMORY.md     ← 사용자별 격리 메모리
│               └── sessions/         ← 절대 수정 금지
└── api-proxy/                        ← proxyMode=shared 전용
```

---

## 파일 편집 가능 여부 규칙

### 절대 수정 금지 — 데이터 손실 또는 감사 실패 발생

| 경로 | 수정 금지 이유 |
|------|---------------------|
| `openclaw/sessions/` | Layer 0: 불변 추가 전용 대화 로그. 삭제 시 감사 추적이 끊기고 memory:rebuild가 불가능해짐. |
| `instances/<user>/openclaw/sessions/` | 동일 — 사용자별 Layer 0 로그. |
| `picoclaw/workspace/sessions/` | 동일 — picoclaw 세션 로그. |
| `instances/<user>/picoclaw/workspace/sessions/` | 동일. |
| `raw/workspace-snapshots/` | `up`/`down` 시 자동 생성되는 스냅샷. 삭제 시 메모리 복구 불가. |

### 자유롭게 편집 가능 — 이 파일들은 당신의 것

| 경로 | 참고 사항 |
|------|-------|
| `openclaw/workspace/SOUL.md` | 에이전트 퍼스널리티 정의. 자유롭게 편집. |
| `picoclaw/workspace/SOUL.md` | picoclaw의 경우 동일. |
| `template/SOUL.md` | 멀티 인스턴스: 편집 시 모든 사용자에게 영향. |
| `openclaw/workspace/MEMORY.md` | 에이전트가 자동으로 업데이트. 컨텍스트 추가 또는 오류 수정 가능. |
| `picoclaw/workspace/memory/MEMORY.md` | picoclaw의 경우 동일. |
| `instances/<user>/openclaw/workspace/MEMORY.md` | 사용자별 메모리. 해당 사용자에 한해 편집 가능. |
| `instances/<user>/picoclaw/workspace/memory/MEMORY.md` | 동일. |
| `openclaw/workspace/skills/` | 새 스킬 추가. 하단 "새 스킬 추가" 참고. |
| `picoclaw/workspace/skills/` | picoclaw의 경우 동일. |
| `template/skills/` | 멀티 인스턴스 공유 스킬. |
| `template/AGENTS.md` | 공유 동작 규칙. 멀티 인스턴스의 모든 사용자에게 영향. |
| `instances/<user>/openclaw/workspace/USER.md` | 사용자별 컨텍스트. 해당 사용자에 한해 편집 가능. |
| `instances/<user>/picoclaw/workspace/USER.md` | 동일. |
| `template/USER.template.md` | 플레이스홀더 정의. 편집 시 spawn 시 새 사용자에게 생성되는 내용이 변경됨. |
| `processed/` | Layer 1 처리된 메모리. 삭제 가능 — `claw-farm memory:rebuild`로 재생성. |

### 사용자 확인 후 수정 — 잘못된 변경 시 스택이 손상될 수 있음

| 경로 | 주의 없이 변경 시 위험 |
|------|------------------------------|
| `openclaw/openclaw.json` | 모든 대화의 모델, 엔드포인트, 플러그인 변경. |
| `openclaw/policy.yaml` | 도구 접근 활성화/비활성화 (파일시스템, HTTP, 쉘). 과도한 허용 = 보안 위험. |
| `picoclaw/config.json` | 단일 파일로 모든 것을 제어 — LLM, 도구, 정책. 오타 하나로 에이전트가 중단됨. |
| `template/config/config.json` | 모든 picoclaw 인스턴스에 영향. |
| `docker-compose.openclaw.yml` | 컨테이너 배선. 잘못된 편집 = 에이전트 시작 실패. |
| `docker-compose.picoclaw.yml` | picoclaw의 경우 동일. |
| `api-proxy/api_proxy.py` | 보안상 중요. 잘못된 편집 시 API 키 유출 또는 PII 보호 비활성화 가능. |
| `.env` / `.env.example` | API 키가 여기에 있음. 실제 값은 절대 커밋하지 말 것. |

### 생성된 파일 — `claw-farm upgrade` 시 덮어쓰기됨

| 경로 | 덮어쓰는 항목 |
|------|-------------------|
| `api-proxy/` | `claw-farm upgrade`로 전체 디렉터리 재생성 |
| `docker-compose.*.yml` | `claw-farm upgrade`로 재생성 |
| `openclaw/openclaw.json` | `claw-farm upgrade` (init 이후 사용자가 수동으로 커스터마이징하지 않은 경우) |
| `openclaw/policy.yaml` | `claw-farm upgrade --force-policy`로 재생성 |

생성된 파일에 중요한 커스터마이징을 저장하지 마세요. 업그레이드 후에도 보존되는 SOUL.md, AGENTS.md, skills/를 사용하세요.

---

## 런타임 가이드

### openclaw

- **설정 파일:** `openclaw/openclaw.json` (모델, 엔드포인트, 플러그인) + `openclaw/policy.yaml` (도구 ACL)
- **메모리 경로:** `openclaw/workspace/MEMORY.md`
- **세션 경로:** `openclaw/sessions/` — `.jsonl` 파일, 대화당 하나
- **스킬 경로:** `openclaw/workspace/skills/`
- **컨테이너 마운트 경로:** `/home/node/.openclaw`
- **API 키 위치:** 파일시스템에 없음. `api-proxy` 컨테이너 환경에만 저장됨. OpenClaw는 원시 키를 볼 수 없음.
- **설정 형식 예시:**

```json
{
  "model": "gemini-2.0-flash",
  "endpoint": "http://api-proxy:8080/v1",
  "plugins": ["memory"]
}
```

### picoclaw

- **설정 파일:** `picoclaw/config.json` — LLM 프로바이더, 도구, 정책, 모델을 하나의 파일로 관리
- **메모리 경로:** `picoclaw/workspace/memory/MEMORY.md`
- **세션 경로:** `picoclaw/workspace/sessions/`
- **스킬 경로:** `picoclaw/workspace/skills/`
- **용량:** ~20MB Go 바이너리 vs openclaw의 ~1.5GB Node 이미지
- **설정 형식 예시:**

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

## 프록시 모드 가이드

### per-instance (기본값)

각 사용자 인스턴스는 자체 `api-proxy` 컨테이너를 가집니다. API 키는 인스턴스별로 범위가 지정됩니다. 사용자마다 API 키가 다르거나 사용자별 시크릿 격리가 필요한 경우 사용하세요.

```
instances/alice/api-proxy/   ← alice의 프록시, alice의 API 키
instances/bob/api-proxy/     ← bob의 프록시, bob의 API 키
```

### shared

모든 인스턴스가 프로젝트 루트의 단일 `api-proxy`를 공유합니다. 모든 사용자에게 하나의 API 키가 사용됩니다. `api-proxy/` 디렉터리는 `instances/` 내부가 아닌 프로젝트 루트에 있습니다.

- 프록시 설정에 사용자별 시크릿을 저장하지 마세요 — 모든 사용자에게 노출됩니다.
- 키 격리가 필요 없는 내부 도구 또는 단일 테넌트 배포에 적합합니다.

```
api-proxy/     ← 모든 사용자를 위한 단일 프록시
instances/alice/   ← api-proxy 없음
instances/bob/     ← api-proxy 없음
```

### none

`api-proxy` 컨테이너가 배포되지 않습니다. 프로젝트가 자체적으로 프록시를 처리합니다 — 일반적으로 API 키를 주입하고 요청을 전달하는 TypeScript/Node 서버를 통해 처리됩니다.

- `claw-farm init`과 `claw-farm upgrade`는 `api-proxy/` 파일 생성을 완전히 건너뜁니다.
- `claw-farm up`과 `claw-farm down`은 프록시 컨테이너 라이프사이클을 건너뜁니다.
- 에이전트 컨테이너는 api-proxy 사이드카가 아닌 프로젝트 자체 서버로 LLM 요청을 라우팅합니다.
- API 키가 어떻게 주입되는지는 프로젝트의 서버 코드(보통 `src/` 또는 `server/`)를 확인하세요.

---

## 보안 규칙

다음은 협상 불가 사항입니다. 위반 시 시크릿 유출 또는 감사 데이터 손상이 발생할 수 있습니다.

**1. API 키는 당신의 환경에 없습니다.**
API 키는 `api-proxy` 컨테이너 내부에만 저장됩니다. `.env`, 설정 파일, 환경 변수에서 찾으려 하지 마세요. LLM 호출이 필요하다면 LLM 프로바이더에 직접 연결하지 말고 프록시 엔드포인트(`http://api-proxy:8080`)를 통해 라우팅하세요.

**2. 아웃바운드 요청은 PII 필터링됩니다.**
api-proxy는 요청이 LLM에 전달되기 전에 민감한 패턴(SSN, 전화번호, 이메일 주소, 신용카드 번호)을 자동으로 삭제합니다. 이는 투명하게 처리되므로 직접 구현할 필요가 없습니다. 비활성화하거나 우회하지 마세요.

**3. LLM 응답은 시크릿 스캔됩니다.**
api-proxy는 에이전트에 반환하기 전에 모든 LLM 응답에서 API 키와 토큰을 스캔합니다. 응답에 시크릿이 나타나면 제거됩니다. 제거된 콘텐츠를 유도하거나 재구성하려 하지 마세요.

**4. `sessions/`는 신성합니다 — 추가 전용, 절대 삭제 금지.**
세션 `.jsonl` 파일은 Layer 0 데이터입니다. `memory:rebuild`의 진실의 원천입니다. 삭제 시 메모리 복구가 불가능해지고 감사 추적이 끊깁니다. 쓰기 전용 로그로 취급하세요.

**5. `processed/`는 삭제 가능합니다.**
`processed/`의 Layer 1 메모리는 `raw/`와 `sessions/`에서 파생됩니다. 언제든지 삭제하고 재생성할 수 있습니다:
```bash
claw-farm memory:rebuild my-agent
```
`processed/`를 권위 있는 데이터로 취급하지 마세요. 의심스러우면 재생성하세요.

---

## SDK 통합 (proxyMode: none)

`proxyMode`가 `"none"`인 경우 프로젝트가 자체적으로 API 키 주입을 담당합니다. 이는 일반적으로 Anthropic SDK 또는 호환 클라이언트를 사용하는 TypeScript 서버 내부에서 처리됩니다.

에이전트 컨테이너(OpenClaw 또는 picoclaw)는 api-proxy 사이드카 대신 프로젝트 자체 서버 엔드포인트로 요청을 보내도록 설정됩니다.

요청이 어디로 라우팅되는지 확인하려면 `openclaw/openclaw.json` (또는 `picoclaw/config.json`)의 `endpoint` 필드를 확인하세요:

```json
{
  "endpoint": "http://host.docker.internal:3000/llm"
}
```

해당 엔드포인트의 프로젝트 서버는 다음을 수행해야 합니다:
1. OpenAI 호환 `/v1/chat/completions` 요청 수락
2. API 키 주입
3. 업스트림 LLM 프로바이더로 전달
4. 응답 반환

SDK 통합 코드를 추가하는 경우 프로젝트의 기존 서버 패턴을 따르세요. 소스 파일에 API 키를 하드코딩하지 마세요.

---

## 일반 작업

### 새 스킬 추가

스킬은 에이전트의 기능 또는 동작을 정의하는 Markdown 파일입니다.

| 레이아웃 | 스킬 파일 추가 위치 |
|--------|-----------------------------|
| 단일 인스턴스 (openclaw) | `openclaw/workspace/skills/<skill-name>.md` |
| 단일 인스턴스 (picoclaw) | `picoclaw/workspace/skills/<skill-name>.md` |
| 멀티 인스턴스 (공유) | `template/skills/<skill-name>.md` — 모든 사용자에게 제공 |
| 멀티 인스턴스 (사용자별) | `instances/<user>/openclaw/workspace/skills/<skill-name>.md` |

스킬 파일 형식:

```markdown
# Skill Name

Brief description of what this skill does.

## Trigger

When to use this skill.

## Instructions

Step-by-step instructions for the agent.
```

### 에이전트 퍼스널리티 수정

`SOUL.md`를 편집하세요. 이 파일은 에이전트의 어조, 목표, 제약 조건, 정체성을 정의합니다.

| 레이아웃 | 편집할 파일 | 범위 |
|--------|-------------|-------|
| 단일 인스턴스 (openclaw) | `openclaw/workspace/SOUL.md` | 이 인스턴스만 |
| 단일 인스턴스 (picoclaw) | `picoclaw/workspace/SOUL.md` | 이 인스턴스만 |
| 멀티 인스턴스 | `template/SOUL.md` | 모든 사용자 — 다음 컨테이너 재시작 시 적용 |
| 멀티 인스턴스 (사용자별 재정의) | `instances/<user>/openclaw/workspace/SOUL.md` | 해당 사용자만 |

### 에이전트 동작 규칙 수정

`AGENTS.md`를 편집하세요. 이 파일은 퍼스널리티와 별개로 규칙, 제약 조건, 운영 정책을 정의합니다.

| 레이아웃 | 편집할 파일 |
|--------|-------------|
| 멀티 인스턴스 | `template/AGENTS.md` |
| 단일 인스턴스 (picoclaw) | `picoclaw/workspace/AGENTS.md` |

### 사용자별 컨텍스트 추가

멀티 인스턴스 프로젝트에서 사용자별 컨텍스트는 새 인스턴스가 spawn될 때 `template/USER.template.md`에서 생성됩니다.

**새 플레이스홀더 추가:**

1. `template/USER.template.md`를 편집하고 값이 표시될 위치에 `{{field_name}}`을 추가합니다.
2. spawn 시: `claw-farm spawn my-agent --user alice`
3. 생성된 `instances/alice/openclaw/workspace/USER.md`에 실제 값을 입력합니다.

**기존 사용자 컨텍스트 업데이트:**

`instances/<user>/openclaw/workspace/USER.md` (또는 `instances/<user>/picoclaw/workspace/USER.md`)를 직접 편집하세요.

### LLM 모델 또는 프로바이더 변경

프록시 라우팅을 이해하지 않고 엔드포인트 또는 프로바이더 URL을 변경하지 마세요.

| 런타임 | 파일 | 필드 |
|---------|------|-------|
| openclaw | `openclaw/openclaw.json` | `"model"` |
| picoclaw | `picoclaw/config.json` | `"model"` |
| 멀티 인스턴스 picoclaw | `template/config/config.json` | `"model"` |

지원되는 LLM 프로바이더는 `init` 시 `--llm gemini|anthropic|openai-compat`으로 설정됩니다. init 이후 프로바이더를 전환하려면 설정 파일과 `.env` API 키 변수를 모두 업데이트해야 합니다. 설정의 `endpoint` 필드는 LLM 프로바이더에 직접 연결하지 않고 api-proxy(또는 `proxyMode: none`인 경우 프로젝트 자체 서버)를 가리켜야 합니다.

### 에이전트 스택 실행

```bash
# 모든 컨테이너 시작
claw-farm up my-agent

# 특정 사용자 인스턴스 시작 (멀티 인스턴스 전용)
claw-farm up my-agent --user alice

# 모든 컨테이너 중지
claw-farm down my-agent

# 특정 사용자 인스턴스 중지
claw-farm down my-agent --user alice

# 템플릿에서 새 사용자 인스턴스 spawn
claw-farm spawn my-agent --user bob

# 사용자 인스턴스 제거
claw-farm despawn my-agent --user bob
```

### claw-farm 템플릿 업그레이드

```bash
claw-farm upgrade my-agent
```

이 명령은 claw-farm이 소유한 모든 파일을 재생성합니다: `api-proxy/`, `docker-compose.*.yml`, 기본 설정. 다음 항목에 대한 편집 내용은 보존됩니다:

- `SOUL.md`
- `AGENTS.md`
- `skills/`
- `USER.md` (사용자별 컨텍스트)
- `MEMORY.md`

다음 항목은 덮어쓰기됩니다:

- `api-proxy/api_proxy.py` 및 관련 파일
- `docker-compose.*.yml`

`policy.yaml`도 함께 덮어쓰려면:

```bash
claw-farm upgrade my-agent --force-policy
```

---

## 트러블슈팅

### 에이전트가 LLM에 연결할 수 없음

1. 스택이 실행 중인지 확인: `docker ps` — `api-proxy` 컨테이너를 찾으세요(`proxyMode: none`이 아닌 경우).
2. `.env` 확인 — API 키 변수가 설정되어 있어야 합니다(예: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`).
3. `openclaw/openclaw.json` 또는 `picoclaw/config.json` 확인 — `endpoint` 필드가 LLM 프로바이더가 아닌 `http://api-proxy:8080`을 가리켜야 합니다.
4. `proxyMode: none`의 경우 — 프로젝트 자체 서버가 설정된 엔드포인트에서 실행 중이고 접근 가능한지 확인하세요.
5. 프록시 로그 확인: `docker logs <project-name>-api-proxy-1`.

### 세션 간 메모리가 유지되지 않음

1. Docker 볼륨이 마운트되어 있는지 확인. `docker-compose.*.yml` 확인 — `openclaw/workspace` 또는 `picoclaw/workspace`가 익명 볼륨이 아닌 바인드 마운트여야 합니다.
2. 런타임에 맞는 올바른 경로에 `MEMORY.md`가 존재하는지 확인(위의 런타임 가이드 참고).
3. `processor: mem0`를 사용하는 경우 `mem0-api`와 `qdrant` 컨테이너가 모두 실행 중인지 확인.

### PII가 예기치 않게 차단됨

api-proxy는 SSN, 전화번호, 이메일, 신용카드 형식과 일치하는 패턴을 삭제합니다. 정당한 데이터가 제거되는 경우:

1. `api-proxy/.env` 또는 프록시 컨테이너 환경에서 `PII_MODE`를 확인하세요.
2. `PII_MODE=strict` — 최대 삭제.
3. `PII_MODE=permissive` — 높은 신뢰도 패턴만 삭제.
4. 변경에는 사용자 승인이 필요합니다 — 자율적으로 수정하지 마세요.

### `memory:rebuild`가 실패함

`raw/workspace-snapshots/`에 최소 하나의 스냅샷이 있어야 합니다. 스냅샷은 `claw-farm up` 및 `claw-farm down` 시 자동으로 생성됩니다. 디렉터리가 비어 있으면 재생성할 Layer 0 데이터가 없습니다. 이는 복구 불가능합니다 — 에이전트는 대화를 통해 새 메모리를 축적해야 합니다.

### 업그레이드 후 컨테이너가 시작되지 않음

1. `docker compose -f docker-compose.<runtime>.yml config` 실행으로 compose 파일 문법을 검증하세요.
2. `.env`에 compose 파일에서 참조하는 변수가 누락되어 있는지 확인하세요.
3. 업그레이드에서 `api-proxy/Dockerfile`이 변경된 경우 이미지를 재빌드하세요: `docker compose build api-proxy`.

---

## 빠른 참조

| 작업 | 자율 수행 가능 여부 | 파일 |
|------|------------------------|------|
| 에이전트 퍼스널리티 편집 | 예 | `SOUL.md` |
| 동작 규칙 편집 | 예 | `AGENTS.md` |
| 스킬 추가 | 예 | `skills/<name>.md` |
| 사용자별 컨텍스트 업데이트 | 예 | `USER.md` |
| 메모리 편집 | 예, 주의 필요 | `MEMORY.md` |
| LLM 모델 변경 | 사용자에게 먼저 확인 | `openclaw.json` / `config.json` |
| 도구 접근 정책 변경 | 사용자에게 먼저 확인 | `policy.yaml` / `config.json` |
| docker-compose 수정 | 사용자에게 먼저 확인 | `docker-compose.*.yml` |
| api-proxy 수정 | 사용자에게 먼저 확인 | `api-proxy/api_proxy.py` |
| 세션 삭제 | 절대 안 됨 | `sessions/` |
| 원시 스냅샷 삭제 | 절대 안 됨 | `raw/workspace-snapshots/` |
