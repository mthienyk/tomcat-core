# Tomcat Core

Central server and data platform for Tomcat. Core owns identity, permissions,
data synchronisation, audit logs, business normalisation, and the agentic tool
layer used by the Society platform, the team MCP, investor MCP clients, and a
Chrome extension.

## Principles

- No production code contains invented business data.
- Missing connectors fail explicitly with `503 CONNECTOR_NOT_CONFIGURED`.
- Interfaces never decide what they can see. Tomcat Core recalculates access on
  each request.
- LLMs do not access Tomcat memory directly. They can only request approved Core
  tools, then those tools apply permissions before reading data.
- Connectors read external systems. Services turn those reads into Tomcat domain
  objects and enforce permissions.
- The database is the read model. Services read from Postgres; sync workers keep
  it fresh. Connector APIs are only called when the local copy is absent or stale.

## Structure

```text
src/
  agent/          Provider-neutral tool planning and execution
  api/            Fastify routes and error handling
  audit/          Structured audit logger
  auth/           Google human auth, service tokens, dev mock, DB role resolver
  config/         Startup env validation (Zod)
  connectors/     HubSpot, Drive, Monday, investors + store-backed adapters
  domain/         Tomcat entities, identity and agent tool schemas
  errors/         Typed errors
  llm/            Anthropic, OpenAI and Google provider registry
  mcp/            MCP server exposing the agent tool registry
  permissions/    Central policies and response redaction
  services/       Business services used by API and agent tools
  storage/        CoreStore interface, Postgres implementations, migrations
  sync/           Idempotent sync workers and scheduler
```

## Identity

Humans authenticate through Google OAuth. When `DATABASE_URL` is set, roles are
resolved from the `users` table — managed via `POST /internal/users`. In
development without a database, a placeholder resolver grants `internal_team` to
any `@tomcat.eu` address and logs a warning.

Machine clients authenticate with signed service JWTs (`HS256` for this V1).
Tokens carry `iss`, `aud`, `sub`, `scope`, `iat`, `nbf` when needed, `exp`, and
optionally a signed `act_as` identity. Do not pass a free form `userEmail` from
a third-party app.

For Society endpoints, service calls must include delegated external investor
identity with `act_as.investorId`. Calls without delegation are rejected.

## Database — Core Store

When `DATABASE_URL` is set, the server instantiates a **Postgres read model**
(`CoreStore`) that stores all external data locally. This eliminates direct
connector API calls on hot paths and makes the platform safe to query at Society
scale.

**Migrations** (`src/storage/migrations/`) run idempotently at startup:

| File | Contents |
| --- | --- |
| `pg_001_signal_hub.sql` | Signal Hub tables (watched entities, events, Unipile accounts) |
| `pg_002_core.sql` | Startups, portfolio companies, deals, notes, meetings, board packs, signals, events, sync runs, dataset freshness |
| `pg_003_identity.sql` | Internal users and investor records |

**Sync workers** (`src/sync/`) synchronise each dataset independently on a 15-minute cycle (10 s startup delay). Workers are idempotent — they can be re-run without side effects. Available datasets:

| Worker | Dataset | Source |
| --- | --- | --- |
| `hubspotStartupsWorker` | `hubspot.startups` | HubSpot companies |
| `hubspotActivityWorker` | `hubspot.deals`, `hubspot.notes`, `hubspot.meetings` | HubSpot deals, engagements |
| `mondayPortfolioWorker` | `monday.portfolio` | Monday.com portfolio board |
| `mondaySignalsWorker` | `monday.signals` | Monday.com signal board |
| `mondayEventsWorker` | `monday.events` | Monday.com events board |
| `driveBoardPacksWorker` | `drive.boardPacks` | Google Drive board packs |

**Data freshness** is tracked per dataset in the `dataset_freshness` table and exposed via `GET /health/readiness`. A dataset is `healthy` when it has been synced at least once successfully.

**Store-backed connectors** (`src/connectors/storeBacked.ts`) wrap the `CoreStore` to satisfy the existing `Connectors` interface. On each call they check freshness (TTL-cached for 5 s); if the dataset is not yet healthy they fall back to the live HTTP connector transparently.

Without `DATABASE_URL`, the server operates in live-only mode: all connector calls go directly to external APIs.

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
| `GET` | `/health` | none | Liveness — always 200 |
| `GET` | `/health/connectors` | none | Parallel probes: HubSpot, Monday, Drive. Status `ok` or `degraded` |
| `GET` | `/health/readiness` | none | Dataset freshness from CoreStore. 503 when no database |
| `GET` | `/me` | authenticated | Resolved human or machine identity |
| `GET` | `/connectors/hubspot/startups` | `society.read` | Query: `q`, `sector`, `limit` |
| `POST` | `/ai/query` | `ai.query` | Agentic tool planning and execution |
| `GET` | `/society/investors/:id/home` | `society.read` | Requires connectors |
| `GET` | `/society/portfolio/:id/signals` | `society.read` | Requires connectors |
| `POST` | `/internal/briefs/board-prep` | `briefs.write` | Requires connectors |
| `GET` | `/internal/investors` | `internal.read` | List all investor records |
| `POST` | `/internal/investors` | `admin.write` | Upsert investor record |
| `GET` | `/internal/users` | `internal.read` | List internal users and roles |
| `POST` | `/internal/users` | `admin.write` | Upsert internal user with role |
| `GET` | `/internal/sync/freshness` | `internal.read` | Per-dataset sync status |

## Quick Start

```bash
cp .env.example .env
npm install
npm run dev
```

For full data sync capability, set `DATABASE_URL` to a Postgres connection string.
The server runs without it, falling back to live connector calls on every request.

Liveness:

```bash
curl -s http://localhost:4000/health
```

Readiness (requires `DATABASE_URL`):

```bash
curl -s http://localhost:4000/health/readiness
```

Local identity check:

```bash
curl -s \
  -H 'X-Mock-Identity: {"kind":"human","email":"team@tomcat.eu","role":"internal_team"}' \
  http://localhost:4000/me
```

## Deployment

The `Dockerfile` builds a multi-stage Node 22 Alpine image. The runtime stage
includes native build tools needed to compile `better-sqlite3`.

```bash
docker build -t tomcat-core .
docker run -p 4000:4000 --env-file .env tomcat-core
```

Required environment variables in production:

```
NODE_ENV=production
DATABASE_URL=postgres://user:pass@host:5432/tomcat
CORS_ALLOWED_ORIGINS=https://society.example.com
GOOGLE_OAUTH_CLIENT_ID=...
SERVICE_TOKEN_SECRET=...
```

See `.env.example` for the full list with descriptions.

## Tests

```bash
npm test
npm run typecheck
```

The tests cover:

- config validation, including provider selection and `DATABASE_URL` guards
- service token signing, expiry and scope filtering
- production boot guards for CORS and placeholder role resolver
- permission and redaction policies (including `admin.write`)
- unconfigured connector failures
- connector HTTP client (timeouts, retries, error paths)
- HubSpot, Monday and Drive connector mapping (with mocked HTTP)
- Serper connector mapping, headers, error paths
- agent loop tool execution, repair on unknown tools, and JSON Schema export
- OpenAI Responses API request/response shape (function_call / output)
- Gemini functionDeclarations request shape and functionCall/functionResponse turns
- MCP server tool listing and execution through an in-memory transport
- Society filtering using inline generic test data
- Signal Hub: ingest deduplication (Serper and Unipile), content hash stability
- AccountGuardian: quota exhaustion, Paris operating window, Sunday block, jitter delay, circuit breaker on 429, freeze auto-expiry, kill permanence
- Unipile webhook: HMAC verification, CREDENTIALS→freeze, DELETED→kill dispatch

## Signal Hub

The Signal Hub captures public and private LinkedIn activity for tracked
founders and companies, normalises it into a local append-only event log, and
exposes it to the AI agent and MCP tools. No LinkedIn account is touched by the
public channel. The private channel (Unipile) is wrapped by a strict safety
layer before any call reaches LinkedIn.

### Data flow

```
Watched entities (watchlist)
       │
       ▼
Signal queue (in-process, two lanes)
   ├── Public lane  → Serper.dev → Google SERP → ingest → signal_events
   └── Unipile lane → AccountGuardian → Unipile API → ingest → signal_events
                             │
                    webhook account_status ←── Unipile platform
```

Every event lands in `signal_events`, a single append-only table. `source`
distinguishes the channel. No event is ever updated or deleted.

### Sources

**Serper public** (`SERPER_API_KEY`)

Sends `site:linkedin.com/posts "{name}"` queries to Google via [Serper.dev](https://serper.dev). No LinkedIn account required. Captures any post indexed by Google within the past 24–72 hours. Cost: ~1€/1000 queries.

**Unipile private** (`UNIPILE_DSN` + `UNIPILE_API_KEY`)

Reads the private LinkedIn feed of a VC account connected in read-only mode via [Unipile](https://developer.unipile.com). Gives access to posts not indexed by Google (connection-visibility posts, reactions). Every call goes through `AccountGuardian` — see below.

### AccountGuardian

One `AccountGuardian` instance per connected Unipile account, held in memory and snapshotted to the database on every state change.

**Invariants enforced before every API call:**

| Rule | Detail |
| --- | --- |
| Daily quota | 60 calls/day (configurable, hard max 100). Resets at midnight Paris. |
| Operating window | 08:00–22:00 Europe/Paris, Sundays excluded. No calls at night or on Sundays regardless of quota remaining. |
| Jitter delay | 60–300 s random delay between consecutive calls on the same account. No fixed schedule. |
| State gate | `active` → calls allowed subject to rules above. `frozen` → all calls blocked until `frozenUntil`. `killed` → permanent block. |

**Circuit breaker triggers:**

- HTTP 429 from Unipile → immediate `freeze(24h)`, persisted to DB
- Unipile webhook `account_status = CREDENTIALS | ERROR` → immediate `freeze(24h)`
- Unipile webhook `account_status = DELETED` → `kill()` (permanent)
- Webhook `RECONNECTED | OK` after a credentials freeze → automatic `unfreeze()`

**Kill-switch:** `POST /signals/unipile/accounts/:id/freeze` or `/kill` (requires `internal_team`). Also available as MCP tool `signal_hub_freeze_account` (approval-required — blocked on MCP, only executable via the HTTP API).

**Code-level write protection:** `src/connectors/unipile.ts` exports a `UnipileReadOnlyClient` with exactly 6 methods: `listUserPosts`, `getPost`, `listPostReactions`, `listPostComments`, `getUserProfile`, `getAccountStatus`. Methods for `like`, `comment`, `invite`, `sendMessage`, `createPost` do not exist in this module. No policy enforcement needed — there is nothing to call.

### Signal deduplication

At ingest, a SHA-256 hash is computed from the signal's identifying content (URL + snippet for Serper, `socialId` + text for Unipile). A `(source, signal_type, content_hash)` unique constraint prevents duplicates at the database level. The ingest function checks before insert to return a fast `{ status: "duplicate" }` without a write.

### Entity resolver

`src/services/signalHub/resolver.ts` maps free-text queries to `WatchedEntity` records. Resolution order:

1. LinkedIn URL → extract `public_identifier`, look up by `linkedin_identifier`
2. Exact display name match in watchlist
3. Substring display name match (returns `needsClarification` if multiple)
4. HubSpot startup name cross-reference (for entities known in CRM but not yet watched)

### Queue

Two in-process FIFO lanes — not persisted (jobs lost on restart, acceptable for V1):

- **Public lane**: one Serper query every 3.5 seconds (~17/min, under the 20/min cap)
- **Unipile lane**: polled every 15 seconds; each dequeue first calls `guardian.canRun()`, re-enqueues with the guardian's `retryAfterMs` if refused

No MCP tool can trigger a synchronous external call. `signal_hub_request_refresh` returns `{ accepted: true, jobId }` immediately; the actual query happens later in the queue.

### Storage

`SIGNAL_STORE_DRIVER` selects the store implementation:

- **`sqlite`** (default): `better-sqlite3` at `.data/signal-hub.db` (override with `SIGNAL_STORE_PATH`). WAL mode + foreign keys enabled.
- **`postgres`**: uses the shared `DATABASE_URL` pool. Requires `DATABASE_URL` to be set.

Migration DDL runs at startup for both drivers. The `SignalStore` interface is the only layer services touch.

### MCP Tools

| Tool | Access | Notes |
| --- | --- | --- |
| `signal_hub_list_watched` | confidential | List watchlist, optional priority filter |
| `signal_hub_add_watched` | confidential | Requires `internal_team`. Deduplicates on `linkedinIdentifier`. |
| `signal_hub_set_priority` | confidential | `hot / warm / cold` |
| `signal_hub_recent_signals` | confidential | Filter by entity, source, type, date window, text |
| `signal_hub_search_signals` | confidential | Cross-entity search |
| `signal_hub_resolve_entity` | confidential | Free text → `watchedId` + `startupId` |
| `signal_hub_list_accounts` | internal | Guardian snapshots: quota, state, last error |
| `signal_hub_request_refresh` | confidential | **Always async** — returns `{ accepted, jobId }` |
| `signal_hub_freeze_account` | internal | Approval-required — blocked on MCP, only via HTTP API |

### Webhook

`POST /signals/unipile/webhook` — receives `account_status` events from Unipile. Verified via HMAC-SHA256 (`UNIPILE_WEBHOOK_SECRET`). Feeds the guardian state machine and persists every event to `unipile_account_status_events` for audit.

### Environment variables

```
SERPER_API_KEY=           # Serper.dev key — public LinkedIn search via Google SERP
UNIPILE_DSN=              # https://apiX.unipile.com:PORT (from Unipile dashboard)
UNIPILE_API_KEY=          # Unipile API key
UNIPILE_WEBHOOK_SECRET=   # HMAC-SHA256 secret set in Unipile dashboard
SIGNAL_STORE_DRIVER=      # sqlite (default) or postgres (requires DATABASE_URL)
SIGNAL_STORE_PATH=        # SQLite file path (default: .data/signal-hub.db)
UNIPILE_DAILY_QUOTA=      # Per-account daily call quota (default: 60, max: 100)
```

## Next Work

1. Zod validation of raw connector payloads before mapping to domain entities.
2. Stable cross-system identifiers (Monday board id, HubSpot company id, Drive
   folder id) instead of name-only joins where precision matters.
3. Wire the MCP server through Tomcat identity once we have a real per-client
   auth story (today it runs as a single local operator).
4. Expand the agent tool catalog only when a real use case needs it.
5. Persist audit logs to an external sink (Datadog, Postgres, etc.).
6. Durable Signal Hub queue (Redis or Postgres-backed) to survive restarts.
