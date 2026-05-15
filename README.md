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
  connectors/     HubSpot, Drive, Monday, investors + shared http client (timeouts, retries)
  domain/         Tomcat entities, identity and agent tool schemas
  errors/         Typed errors
  llm/            Anthropic, OpenAI and Google provider registry
  mcp/            MCP server exposing the agent tool registry
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

Interfaces exist for HubSpot, Drive, Monday and investors. When credentials are
set, **HubSpot**, **Google Drive** and **Monday** use real HTTP clients.

Shared behavior (`src/connectors/http.ts`): request timeouts, retries on
transient HTTP errors (`429`, `5xx`, etc.) with exponential backoff, and support
for `Retry-After`.

**Drive** reads a service account JSON from `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`
or from `GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE`. Optional
`GOOGLE_DRIVE_SHARED_DRIVE_ID` scopes listing to one Shared Drive. Board-pack
search is recursive across that drive (not only the root folder), paginates past
100 hits, exports Google Docs and Slides as plain text, Google Sheets as CSV,
and returns a placeholder line for binary types such as PDF until a dedicated
extractor exists.

**Monday** lists portfolio boards via GraphQL pagination. `listSignals` and
`listUpcomingEvents` return empty arrays until dedicated boards exist.

If a connector is not configured, dependent operations return
`503 CONNECTOR_NOT_CONFIGURED`.

Tests create minimal inline data inside `tests/`. That data is only for behavior
verification and never ships in `src/`.

## LLM Layer

The LLM layer is provider-neutral. All three providers run the agent loop on
`/ai/query` through native tool calling:

- Anthropic (`ANTHROPIC_API_KEY`), default model: `claude-sonnet-4-6`. Uses
  `client.messages.create` with `tools` and `tool_use` / `tool_result` blocks.
- OpenAI (`OPENAI_API_KEY`), default model: `gpt-5.5`. Uses the Responses API
  (`client.responses.create`) with `function_call` and `function_call_output`
  input items.
- Google Gemini (`GOOGLE_GENERATIVE_AI_API_KEY`), default model:
  `gemini-3.1-pro-preview`. Uses `generateContent` with `functionDeclarations`,
  `functionCall` / `functionResponse` parts, and forwards the per-call
  `thoughtSignature` required by Gemini 3.

`/ai/query` runs a real agentic loop:

1. The single tool registry (`src/agent/toolRegistry.ts`) is exported as
   provider-native tool definitions (JSON Schema converted from Zod, sanitized
   per provider where needed).
2. The provider's native tool calling decides which tools to invoke.
3. The server validates each invocation, applies policy (approval-required
   tools are blocked and reported back to the model), executes through Tomcat
   services (with permissions, redaction and audit), and returns
   `tool_result` blocks until the model emits a final text answer.

The LLM never decides permissions and never receives unrestricted source data.
Conversation context (`currentStartupId`, `currentPortfolioCompanyId`, etc.)
can be passed in the `/ai/query` body so the model never has to invent ids.

Current approved tools:

- `search_startups`
- `read_startup_notes`
- `read_startup_deals`
- `read_startup_meetings`
- `list_portfolio_signals`
- `build_board_prep_context`

Add tools by extending the registry in `src/agent/toolRegistry.ts`. The Zod
schema, description, access level and handler all live next to each other and
are automatically exported to every LLM provider and to the MCP server.

## MCP Server

The same registry is exposed as a [Model Context Protocol](https://modelcontextprotocol.io/)
server (`src/mcp/server.ts`). It runs over stdio and can be plugged into Cursor,
Claude Desktop or any MCP-compatible client.

Run it locally:

```bash
npm run mcp:stdio
```

Each tool advertises its sources, access level and approval requirement in the
description. Approval-required tools refuse to execute over MCP and emit an
audit event. The local operator identity is `internal_team` and can be
overridden with `MCP_OPERATOR_EMAIL`.

Example Cursor / Claude Desktop config snippet:

```json
{
  "mcpServers": {
    "tomcat-core": {
      "command": "npx",
      "args": ["tsx", "scripts/mcpServer.ts"],
      "cwd": "/absolute/path/to/tomcat-core"
    }
  }
}
```

## Endpoints

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| `GET` | `/health` | none | Liveness |
| `GET` | `/health/connectors` | none | Parallel probes: HubSpot `listStartups`, Monday `listPortfolio`, Drive `listBoardPacksForCompany("Tomcat")`. Status `ok` or `degraded` |
| `GET` | `/me` | authenticated | Resolved human or machine identity |
| `GET` | `/connectors/hubspot/startups` | `society.read` | Query: `q` (name substring), `sector`, `limit`. Returns visible startups for Society-style browsing |
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

Connector smoke check (no auth; hits real APIs if configured):

```bash
curl -s http://localhost:4000/health/connectors
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
- connector HTTP client (timeouts, retries, error paths)
- HubSpot, Monday and Drive connector mapping (with mocked HTTP)
- agent loop tool execution, repair on unknown tools, and JSON Schema export
- OpenAI Responses API request/response shape (function_call / output)
- Gemini functionDeclarations request shape and functionCall/functionResponse turns
- MCP server tool listing and execution through an in-memory transport
- Society filtering using inline generic test data

## Next Work

1. Replace the placeholder role resolver with the real Tomcat role source.
2. Short-lived cache for expensive reads such as `listStartups` to protect HubSpot
   rate limits when the agent or Society issues many sequential calls.
3. Zod validation of raw connector payloads before mapping to domain entities.
4. Stable cross-system identifiers (Monday board id, HubSpot company id, Drive
   folder id) instead of name-only joins where precision matters.
5. Wire the MCP server through Tomcat identity once we have a real per-client
   auth story (today it runs as a single local operator).
6. Expand the agent tool catalog only when a real use case needs it; consider
   provider-native tool search once the registry grows past roughly 10–15 tools.
7. Persist audit logs to an external sink.
