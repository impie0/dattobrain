---
tags:
  - platform/service
  - voice
  - sip
  - asterisk
aliases:
  - voice-gateway
  - voice
type: Service
description: Self-contained voice interface — Asterisk PBX, Whisper STT, ElevenLabs TTS, calls DattoLLM as an external client
---

# Voice Gateway

> Part of the [[Datto RMM AI Platform|PLATFORM_BRAIN]] knowledge graph · **Service** node

**Purpose:** Self-contained voice interface for DattoLLM. Handles inbound phone calls via self-hosted Asterisk PBX, converts speech to text (Whisper), sends questions to the existing `/api/chat` endpoint through APISIX, and plays back responses via ElevenLabs TTS. Does NOT modify any existing services — acts as an external client.

> [!warning] Linux host required
> Docker Desktop for Mac cannot forward inbound UDP (RTP audio) through its VM NAT. SIP signaling works, calls connect, but caller audio is silence. Deploy voice services on a Linux host.

## Architecture

```
Phone (SIP app on WiFi) → Asterisk PBX (SIP:5060, Docker)
  → Drachtio (SIP:5070, static trunk from Asterisk)
  → FreeSWITCH (RTP:5080, Docker)
  → WebSocket PCM audio → voice-gateway (bridge network)
    → VAD → Whisper STT → text
    → POST /api/chat via APISIX (full JWT + RBAC)
    → Strip markdown + shorten → ElevenLabs TTS → audio
  → FreeSWITCH → caller hears response
```

## Service Stack

| Service | Port | Image | Role |
|---|---|---|---|
| Asterisk | 5060 (SIP), 10000-10100 (RTP) | `andrius/asterisk:latest` | Self-hosted PBX — manages extensions, routes calls |
| Drachtio | 5070 (SIP), 9022 (admin) | `drachtio/drachtio-server:latest` | SIP signaling middleware — static trunk from Asterisk |
| FreeSWITCH | 5080 (SIP), 30000-30100 (RTP) | `drachtio/drachtio-freeswitch-mrf:latest` | Media server — handles RTP audio, forks to WebSocket |
| voice-gateway | 8001 (HTTP), 8002 (WS) | `./voice` (custom build) | Orchestrator — STT/Chat/TTS pipeline |

## Asterisk Trunk (not SIP registration)

Asterisk routes calls to Drachtio via a **static trunk** — no SIP registration needed. `drachtio-srf` does not support client-side REGISTER (it's a B2BUA library).

```ini
; pjsip.conf — static contact, no auth needed (same Docker network)
[aor-drachtio]
type=aor
contact=sip:drachtio:5070
qualify_frequency=30

; extensions.conf — route AI extensions through the trunk
exten => 9000,1,Dial(PJSIP/drachtio-trunk/sip:9000@drachtio:5070,60)
```

## Default Extensions

| Extension | Device | Password |
|-----------|--------|----------|
| 1000 | Your phone (SIP app) | phone1234 |
| 9000 | DattoLLM AI (primary) | routed via Drachtio trunk |
| 9002 | DattoLLM AI (secondary) | routed via Drachtio trunk |

## Key Dependencies

- [[API Gateway]] — calls `POST /api/chat` with [[JWT Model|JWT]] auth (same path as browser)
- [[Auth Service]] — logs in via `POST /api/auth/login` using a dedicated service account
- [[PostgreSQL]] — reads `voice_device_mappings` table for SIP extension → user lookup
- [[AI Service]] — receives chat requests (via [[API Gateway]])

## Authentication

Voice-gateway authenticates as a ==service account user== via standard [[Authentication Flow|login]]:
- Gets JWT with `allowed_tools` baked in (same as browser)
- APISIX validates JWT, injects headers, enforces RBAC — identical path
- Permissions = whatever tools the service account's role grants

## Critical Deployment Notes

1. **FreeSWITCH `ext-rtp-ip`** must be the server's LAN IP, not the Docker bridge IP. Custom `mrf.xml` template in `services/freeswitch/` handles this.
2. **FreeSWITCH ESL password** is `JambonzR0ck$` — set via `FREESWITCH_SECRET` env var or `mrf.connect()` hangs.
3. **pjsip.conf AOR names** must match the SIP username (e.g., `[1000]` for all three sections: endpoint, auth, aor). Mismatched names cause 404 on REGISTER.
4. **WebSocket URL** must be `ws://voice-gateway:8002/...` not `ws://localhost:8002/...` — localhost resolves to FreeSWITCH, not voice-gateway.
5. **Bind-mounted configs** can't be `sed -i`'d — mount as `.template` (read-only) and generate the real file in the entrypoint.
6. **EXTERNAL_IP changes** require `docker compose up -d --force-recreate` for all voice services.

## Config Files

| File | Purpose |
|---|---|
| `services/asterisk/pjsip.conf` | Transport, phone extension (1000), Drachtio static trunk |
| `services/asterisk/extensions.conf` | 9000/9002 → Drachtio trunk, others → registered device |
| `services/asterisk/entrypoint.sh` | `EXTERNAL_IP` substitution + start |
| `services/freeswitch/mrf.xml` | SIP profile template with `ext-rtp-ip` placeholder |
| `services/freeswitch/entrypoint.sh` | `EXTERNAL_IP` substitution + original entrypoint |

## Config Templating

Both Asterisk and FreeSWITCH use config templates:
1. Config files are mounted as `.template` (read-only)
2. `entrypoint.sh` runs `sed` to replace `EXTERNAL_IP_PLACEHOLDER` with actual `$EXTERNAL_IP`
3. Generated config is written to the real path
4. Service starts with the generated config

This avoids the "Device or resource busy" error from `sed -i` on Docker bind mounts.

## Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `EXTERNAL_IP` | *(required)* | LAN IP of the Docker host — used in SIP/RTP config templates |
| `FREESWITCH_SECRET` | `JambonzR0ck$` | FreeSWITCH ESL password — `mrf.connect()` hangs without it |

## Database Tables

- `voice_device_mappings` (migration 019) — maps SIP extensions to DattoLLM users
- `llm_routing_config` row `synthesizer_voice` (migration 020) — reserved for voice-specific model routing

## Source Files

| File | Role |
|---|---|
| `voice/src/index.ts` | Entry point + Drachtio connection + unhandled rejection handler |
| `voice/src/sipHandler.ts` | SIP INVITE handling + conversation loop + cleanup guard |
| `voice/src/sipRegistrar.ts` | Validates active voice extensions on startup |
| `voice/src/audioProcessor.ts` | VAD + PCM-to-WAV conversion |
| `voice/src/sttClient.ts` | OpenAI Whisper STT |
| `voice/src/ttsClient.ts` | ElevenLabs TTS |
| `voice/src/chatClient.ts` | HTTP client for `/api/chat` |
| `voice/src/authClient.ts` | JWT acquisition |
| `voice/src/voiceFormatter.ts` | Markdown stripping + truncation for speech |
| `voice/src/sessionManager.ts` | Multi-turn call session state |
| `voice/src/deviceConfig.ts` | DB queries for `voice_device_mappings` |
| `voice/src/goodbyeDetector.ts` | Hang-up intent detection |
| `voice/src/wsServer.ts` | WebSocket server for FreeSWITCH audio fork |
| `voice/src/config.ts` | Config + env var validation |

## Connections

- [[connections/Gateway to AI|Gateway → AI]] — voice requests flow through [[API Gateway]] to [[AI Service]]

## Related Nodes

[[API Gateway]] · [[Auth Service]] · [[Network Isolation]] · [[RBAC System]] · [[PostgreSQL]] · [[AI Service]] · [[JWT Model]] · [[Authentication Flow]] · [[Users Table]] · [[Chat Request Flow]]
