# Tomcat Core

Central AI server for Tomcat. The Core owns identity, permissions, source access,
business normalization, audit logs, and the agentic tool layer used by future
interfaces such as Society, the team MCP, investor MCP clients, and a Chrome
extension.

## Principles

- No production code contains invented business data.
- Missing connectors fail explicitly with `503 CONNECTOR_NOT_CONFIGURED`.
- Interfaces never decide what they can see. Tomcat Core recalculates access on
  each request.
- LLMs do not access Tomcat memory directly. They can only request approved Core
  tools, then those tools apply permissions before reading data.
- Connectors read external systems. Services turn those reads into Tomcat domain
  objects and enforce permissions.

## Structure

```text
src/
  agent/          Provider-neutral tool planning and execution
  api/            Fastify routes and error handling
  audit/          Structured audit logger
  auth/           Google human auth, service tokens, dev mock, role resolver
  config/         Startup env validation
  connectors/     HubSpot, Drive, Monday, investors connector boundaries
  domain/         Tomcat entities, identity and agent tool schemas
  errors/         Typed errors
  llm/            Anthropic, OpenAI and Google provider registry
  permissions/    Central policies and response redaction
  services/       Business services used by API and agent tools
```

## Identity

Humans authenticate through Google OAuth. The current local role resolver maps
`@tomcat.eu` users to `internal_team` and logs a warning in development. Replace
it before a production auth rollout.

Machine clients authenticate with signed service JWTs (`HS256` for this V1).
Tokens carry `iss`, `aud`, `sub`, `scope`, `iat`, `nbf` when needed, `exp`, and
optionally a signed `act_as` identity. Do not pass a free form `userEmail` from
a third-party app.

For Society endpoints, service calls must include delegated external investor
identity with `act_as.investorId`. Calls without delegation are rejected.

## Connectors

Connector interfaces exist for HubSpot, Drive, Monday and investors. Real HTTP
clients are not implemented yet. Until they are configured, dependent endpoints
return `503 CONNECTOR_NOT_CONFIGURED`; they do not return fixtures or empty data.

Tests create minimal inline data inside `tests/`. That data is only for behavior
verification and never ships in `src/`.

## LLM Layer

The LLM layer is provider-neutral:

- OpenAI (`OPENAI_API_KEY`), default model example: `gpt-5.5`
- Anthropic (`ANTHROPIC_API_KEY`), default model example: `claude-sonnet-4-6`
- Google Gemini (`GOOGLE_GENERATIVE_AI_API_KEY`), default model example:
  `gemini-3.1-pro`

`/ai/query` asks the selected provider for an `AgentPlan`: a validated JSON list
of approved tool calls. The Core then executes those tools itself. The LLM never
decides permissions and never receives unrestricted source data.

Current approved tools:

- `search_startups`
- `read_startup_notes`
- `list_portfolio_signals`
- `build_board_prep_context`

Add tools by extending `src/domain/agent.ts`, `src/agent/toolPlanner.ts`, and
`src/agent/tools.ts`.

## Endpoints

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| `GET` | `/health` | none | Liveness |
| `GET` | `/me` | authenticated | Resolved human or machine identity |
| `POST` | `/ai/query` | `ai.query` | Agentic tool planning and execution |
| `GET` | `/society/investors/:id/home` | `society.read` | Requires configured connectors |
| `GET` | `/society/portfolio/:id/signals` | `society.read` | Requires configured connectors |
| `POST` | `/internal/briefs/board-prep` | `briefs.write` | Requires configured connectors |

## Quick Start

```bash
cp .env.example .env
npm install
npm run dev
```

In production, configure `CORS_ALLOWED_ORIGINS` with an explicit allowlist.

Minimal health check:

```bash
curl -s http://localhost:4000/health
```

Local identity check:

```bash
curl -s \
  -H 'X-Mock-Identity: {"kind":"human","email":"team@tomcat.eu","role":"internal_team"}' \
  http://localhost:4000/me
```

Calling a connector-backed endpoint without real connector config should return
`503 CONNECTOR_NOT_CONFIGURED`. That is intentional.

## Tests

```bash
npm test
npm run typecheck
```

The tests cover:

- config validation, including provider selection
- service token signing, expiry and scope filtering
- production boot guards for CORS and placeholder role resolver
- permission and redaction policies
- unconfigured connector failures
- provider-neutral agent tool plan validation
- Society filtering using inline generic test data

## Next Work

1. Implement the real HubSpot connector first, likely including investor lookup.
2. Add Drive and Monday HTTP clients.
3. Replace the placeholder role resolver with the real Tomcat role source.
4. Expand the agent tool catalog only when a real use case needs it.
5. Persist audit logs to an external sink.
