import { resolve, relative } from "node:path";
import { loadRegistry } from "../lib/registry.ts";
import { readProjectConfig } from "../lib/config.ts";
import { portRange } from "../lib/ports.ts";

export async function cloudComposeCommand(args: string[]): Promise<void> {
  const reg = await loadRegistry();
  const names = Object.keys(reg.projects);

  if (names.length === 0) {
    console.log("No projects registered. Run: claw-farm init <name>");
    return;
  }

  const outFile = args.find((a) => !a.startsWith("-")) ?? "docker-compose.cloud.yml";

  // Output path validation — must stay within cwd
  const resolved = resolve(process.cwd(), outFile);
  const rel = relative(process.cwd(), resolved);
  if (rel.startsWith("..")) {
    console.error("Output file must be within current directory");
    process.exit(1);
  }

  let services = "";
  let networks = "networks:\n";
  let volumes = "volumes:\n";
  const usedNetworks = new Set<string>();
  const usedVolumes = new Set<string>();

  for (const name of names) {
    const entry = reg.projects[name];
    const config = await readProjectConfig(entry.path);
    const processor = config?.processor ?? entry.processor;
    const ports = portRange(entry.port);
    const proxyNet = `${name}-proxy-net`;
    usedNetworks.add(proxyNet);
    const openclawLogsVol = `${name}-openclaw-logs`;
    usedVolumes.add(openclawLogsVol);

    // API Proxy service (per project — holds the API key)
    services += `  ${name}-api-proxy:
    build: ./${name}/api-proxy
    expose:
      - "8080"
    environment:
      GEMINI_API_KEY: \${GEMINI_API_KEY}
      AUDIT_LOG_PATH: /logs/api-proxy-audit.jsonl
      MAX_PROMPT_SIZE_MB: 5
      PII_MODE: redact
    volumes:
      - ./${name}/logs:/logs
    networks:
      - ${proxyNet}
    read_only: true
    tmpfs:
      - /tmp:size=50M
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: "0.5"
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped

`;

    // OpenClaw service (no API key — routes through api-proxy)
    services += `  ${name}-openclaw:
    image: ghcr.io/openclaw/openclaw:latest
    ports:
      - "${ports.openclaw}:18789"
    volumes:
      - ./${name}/openclaw/config:/home/node/.openclaw:ro
      - ./${name}/openclaw/workspace:/home/node/.openclaw/workspace
      - ./${name}/openclaw/raw/sessions:/home/node/.openclaw/sessions
      - ${openclawLogsVol}:/home/node/.openclaw/logs
    environment:
      OPENCLAW_API_PROXY: http://${name}-api-proxy:8080
      OPENCLAW_SANDBOX: 1
      OPENCLAW_AUDIT_LOG: /home/node/.openclaw/logs/audit.jsonl
    networks:
      - ${proxyNet}
    read_only: true
    tmpfs:
      - /tmp:size=100M
      - /home/node/.cache:size=200M
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: "1.0"
        reservations:
          memory: 128M
    depends_on:
      ${name}-api-proxy:
        condition: service_healthy
    restart: unless-stopped
`;

    if (processor === "mem0") {
      const netName = `${name}-net`;
      usedNetworks.add(netName);

      services += `    networks:
      - ${netName}
    depends_on:
      ${name}-mem0:
        condition: service_healthy

  ${name}-qdrant:
    image: qdrant/qdrant:v1.13.0
    expose:
      - "6333"
    volumes:
      - ./${name}/data/qdrant:/qdrant/storage
    networks:
      - ${netName}
    read_only: true
    tmpfs:
      - /tmp:size=50M
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: "1.0"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:6333/healthz"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped

  ${name}-mem0:
    build: ./${name}/mem0
    ports:
      - "${ports.mem0}:8050"
    environment:
      GEMINI_API_KEY: \${GEMINI_API_KEY}
      MEM0_API_KEY: \${MEM0_API_KEY}
      QDRANT_HOST: ${name}-qdrant
      QDRANT_PORT: 6333
    networks:
      - ${netName}
    read_only: true
    tmpfs:
      - /tmp:size=100M
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: "0.5"
    depends_on:
      ${name}-qdrant:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8050/health')"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped

`;
    } else {
      services += "\n";
    }
  }

  for (const net of usedNetworks) {
    networks += `  ${net}:\n    internal: true\n`;
  }

  for (const vol of usedVolumes) {
    volumes += `  ${vol}:\n`;
  }

  const compose = `# Generated by claw-farm cloud:compose
# Deploy this with Coolify or any Docker Compose host
services:
${services}${usedNetworks.size > 0 ? networks + "\n" : ""}${usedVolumes.size > 0 ? volumes : ""}`;

  await Bun.write(resolved, compose);
  console.log(`\n✅ Cloud compose written to: ${outFile}`);
  console.log(`   Includes ${names.length} project(s): ${names.join(", ")}\n`);
}
