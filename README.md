# TwinMeet

A TypeScript MVP where Digital Twins discover each other, meet in rooms, and leave auditable artifacts.

**MCP=tools, A2A=peers, TwinMeet=rooms+registry**

PlannerTwin (NeedHelp, tags: `planning`) invites SqlReviewerTwin (HasSkill, tags: `sql`, `postgres`) to review a toy `orders` table. They exchange at most eight rounds in a Durable Object room, post a `CREATE INDEX` artifact, pause for a human resolve approval, and write a joint summary plus an audit trail. Humans watch live over WebSocket.

## Stack

- Cloudflare Workers + Durable Objects (SQLite)
- `Registry` DO — agents, capabilities, meeting requests, queryable audit
- `Room` DO — one room per meeting: WebSocket hub, transcript, floor token, HITL gate
- Vite + React + Tailwind dashboard (served as Worker static assets)
- Scripted in-process twins (no paid LLM required)

A Node + Postgres port is conceivable later: the room verbs are `open`, `postMessage`, `requestResolve`, `approve`, `escalate`, `getSnapshot`.

## One-time setup

```bash
npm install
cp .dev.vars.example .dev.vars   # optional
npm run dev                      # http://127.0.0.1:45454
```

No Cloudflare account and no database are required for local demo. Durable Object SQLite is created by wrangler/miniflare.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | no | If set, resolve may ask an LLM to polish the joint summary. Unset → templated summary from the transcript. |
| `LLM_MODEL` | no | Defaults to `gpt-4o-mini`. |
| `TWINMEET_URL` | no | Base URL for `npm run demo` (default `http://127.0.0.1:45454`). |
| `TWINMEET_NO_START` | no | Set to `1` to make the demo fail instead of spawning `npm run dev`. |

Put local secrets in `.dev.vars`. Never put secrets in twin context.

## Demo walkthrough (acceptance test)

In one terminal:

```bash
npm run dev
```

In another:

```bash
npm run demo
```

`npm run demo` will start the dev server itself if nothing is listening. The script is the acceptance test:

1. `POST /v1/seed` registers **NeedHelp** (`planner-twin`, tags `planning`) and **HasSkill** (`sql-reviewer-twin`, tags `sql`, `postgres`).
2. `GET /v1/discover?intent=Review this toy DDL for a orders table and suggest one index.&tags=sql,postgres` — HasSkill is ranked first.
3. `POST /v1/meeting-requests` with that intent and the sample `orders` DDL, then `POST /v1/meeting-requests/:id/accept` — a Room Durable Object opens.
4. The scripted twins exchange messages (≤ 8 rounds). HasSkill posts an artifact:
   ```json
   {
     "index": "CREATE INDEX idx_orders_customer_created ON orders (customer_id, created_at);",
     "rationale": "…"
   }
   ```
5. The room pauses on a HITL resolve gate. `POST /v1/rooms/:id/approve` publishes a joint summary with `problem`, `participants`, `artifact`, and `resolved`.
6. `GET /v1/rooms/:id/audit` includes `meeting.requested`, `meeting.accepted`, `message.created`, `artifact.created`, and `room.resolved`.
7. Open the printed `#/rooms/:id` URL to watch the same room live (WebSocket `/v1/rooms/:id/ws`).

### UI path (same story)

1. Registry → **Seed demo twins**
2. Discover → keep the prefilled intent/DDL → **Discover peers** → **Request meeting & accept** on HasSkill
3. Live room: watch the transcript, then **Approve resolve**
4. Read the artifact, joint summary, and audit sidebar

## HTTP API

| Method | Path | What it does |
| --- | --- | --- |
| `POST` | `/v1/seed` | Create the two demo twins |
| `GET/POST` | `/v1/agents` | List / create twins |
| `GET/PATCH/DELETE` | `/v1/agents/:id` | Twin CRUD |
| `GET` | `/v1/agents/:id/card` | A2A-shaped Agent Card JSON |
| `GET/POST` | `/v1/agents/:id/capabilities` | Skill CRUD |
| `GET` | `/v1/discover?intent=&tags=` | Tag overlap + BM25-style ranking (top 3) |
| `POST` | `/v1/meeting-requests` | Propose a meeting |
| `POST` | `/v1/meeting-requests/:id/accept` | Consent + open room |
| `POST` | `/v1/meeting-requests/:id/decline` | Consent refused |
| `GET` | `/v1/rooms/:id` | Transcript snapshot |
| `GET` | `/v1/rooms/:id/ws` | WebSocket hub |
| `POST` | `/v1/rooms/:id/messages` | Human or twin message |
| `POST` | `/v1/rooms/:id/tick` | Advance a scripted turn (demo helper) |
| `POST` | `/v1/rooms/:id/resolve` | Request resolve (pauses for HITL) |
| `POST` | `/v1/rooms/:id/approve` | `{ "decision": "approve" \| "reject" }` |
| `GET` | `/v1/rooms/:id/summary` | Joint summary |
| `GET` | `/v1/rooms/:id/audit` | Audit events for the room |

WebSocket event types: `room.joined`, `message.created`, `floor.granted`, `handoff.*`, `room.paused`, `human.approval_required`, `room.resolved`, `artifact.created`, `audit.appended`.

Message types: `chat` | `proposal` | `artifact` | `handoff` | `system` | `audit`.

## Deploy

```bash
npx wrangler login
npm run deploy
```

Wrangler will provision the Worker and SQLite Durable Object classes. No D1 database is required.

## Method

See [METHOD.md](./METHOD.md) for the twelve principles of *How Digital Twins Meet*.

## Constraints honored in v0

- No secrets in twin context; peer messages treated as untrusted
- Round / floor caps are product features (`maxRounds = 8`)
- Agent Cards are A2A-shaped; a full A2A server is out of scope
- Works offline without an LLM key (scripted twin replies + templated summary)
