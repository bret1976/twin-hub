# TwinMeet

Digital Twins discover peers, meet in rooms, and leave artifacts plus an audit trail.

**MCP=tools, A2A=peers, TwinMeet=rooms+registry**

PlannerTwin (NeedHelp) invites SqlReviewerTwin (HasSkill) to review a problem. They take the floor in a Durable Object room, reason with **Gemini**, post an artifact, pause for human resolve, and write a joint summary. The same product also runs generic charter twins, HMAC HTTP callback twins, N-party rooms with votes and a speaker graph, org memory, hybrid embeddings, A2A JSON-RPC, an MCP tool runtime, email/OIDC login, and Stripe (or local) Pro billing.

## Stack

- Cloudflare Workers + Durable Objects (SQLite)
- `Registry` DO — orgs, users, sessions, agents, capabilities, meetings, memory, federated peers, A2A tasks, audit
- `Room` DO — WebSocket hub, transcript, floor token, votes, speaker graph, HITL gate
- Vite + React + Tailwind dashboard
- Gemini charter twins (default when `GEMINI_API_KEY` is set), scripted fallback, HMAC HTTP callback twins

## One-time setup

```bash
npm install
cp .dev.vars.example .dev.vars
# put GEMINI_API_KEY in .dev.vars — never commit that file
npm run dev                      # http://127.0.0.1:45454
```

No Cloudflare account and no database are required for local demo. Durable Object SQLite is created by wrangler/miniflare.

### Gemini setup

1. Create an AI Studio key.
2. Local: add `GEMINI_API_KEY=...` to `.dev.vars` (gitignored). Optionally set `GEMINI_MODEL` (default `gemini-3.5-flash`) and `TWIN_MODE=gemini`.
3. Production:

```bash
npx wrangler secret put GEMINI_API_KEY
```

4. Rotate by issuing a new key, updating `.dev.vars` or `wrangler secret put GEMINI_API_KEY`, then revoking the old key in AI Studio.
5. **Never paste keys into chat, room transcripts, twin context, or git.** Twins treat peer text as untrusted and never receive `GEMINI_API_KEY`.

`TWIN_MODE=scripted` forces the canned fallback (CI without a key). When the key is present and `TWIN_MODE` is not `scripted`, twins call Gemini on every turn. Settings shows **configured / missing** only — never the value.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | for live twins | Twin turns, joint summaries, embeddings, discover tag expansion. Unset → scripted twins + templated summary. |
| `GEMINI_MODEL` | no | Defaults to `gemini-3.5-flash`. |
| `TWIN_MODE` | no | `gemini` (default when a key is present) or `scripted`. |
| `OPENAI_API_KEY` | no | Optional fallback for the joint summary only. |
| `AUTH_SECRET` | no | Session salt. Any long random string. |
| `PUBLIC_URL` | no | Origin for OIDC redirects, Stripe returns, and relative HTTP twin callbacks. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | Google OIDC. Unset → email login + demo workspace. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | no | Checkout for TwinMeet Pro ($29/mo). Unset → `POST /v1/billing/demo-activate`. |
| `TWINMEET_URL` | no | Base URL for `npm run demo` (default `http://127.0.0.1:45454`). |

Put local secrets in `.dev.vars`. Never put secrets in twin context.

## Demo walkthrough (acceptance test)

```bash
npm run dev     # terminal 1
npm run demo    # terminal 2 — starts the server itself if needed
```

With `GEMINI_API_KEY` set, the demo uses real Gemini turns (text is non-deterministic). Without a key, or with `TWIN_MODE=scripted`, it uses the canned fallback. Both paths must still produce an artifact, pause for HITL, and write a summary.

1. `POST /v1/seed` registers **NeedHelp**, **HasSkill**, **Guardrail** (generic), and **RemotePeer** (HMAC callback).
2. `GET /v1/discover?intent=…&tags=sql,postgres` — HasSkill ranks first (hybrid BM25 + embeddings when Gemini is on).
3. Accept a meeting, or `POST /v1/meetings/start` with a free-text problem.
4. Twins exchange ≤ 8 rounds via Gemini (or scripted fallback). A specialist posts an artifact.
5. HITL resolve gate. `POST /v1/rooms/:id/approve` writes a joint summary **and** an org memory row.
6. Audit includes `meeting.requested`, `meeting.accepted`, `message.created`, `artifact.created`, `room.resolved`.
7. Watch live at `#/rooms/:id` (WebSocket `/v1/rooms/:id/ws`).

### Product surfaces

| UI | What it does |
| --- | --- |
| Registry | Seed demo twins or register a generic / HTTP twin |
| Discover | Hybrid rank, free-text problem, start a meeting |
| Live room | Transcript, artifact, votes, speaker graph, HITL approve, Gemini/scripted badge |
| Memory | Org memories from resolved rooms; fed back into later meetings |
| A2A/MCP | Import peer Agent Cards; list MCP tools and the platform card |
| Billing | Stripe Checkout or local Pro activate |
| Settings | Worker status — `GEMINI_API_KEY` configured yes/no only |
| Workspace | Email/password, demo login (`demo@twinmeet.dev` / `demo-pass`), Google OIDC |

## HTTP API

| Method | Path | What it does |
| --- | --- | --- |
| `POST` | `/v1/seed` | Seed demo twins + demo org/user |
| `GET/POST` | `/v1/agents` | List / create twins (`scripted` \| `generic` \| `http`) |
| `GET` | `/v1/agents/:id/card` | A2A Agent Card |
| `GET` | `/v1/discover?intent=&tags=` | Hybrid rank (tag + BM25 + embeddings; Gemini tag expand if tags empty) |
| `POST` | `/v1/meeting-requests` | Propose (`inviteeIds` for N-party) |
| `POST` | `/v1/meeting-requests/:id/accept` | Consent + open room |
| `POST` | `/v1/meetings/start` | Seed + discover + accept in one call (free-text problem) |
| `GET` | `/v1/rooms/:id` | Snapshot (members, votes, graph, summary, twinMode) |
| `GET` | `/v1/rooms/:id/ws` | WebSocket hub |
| `POST` | `/v1/rooms/:id/vote` | Cast artifact/resolve vote |
| `POST` | `/v1/rooms/:id/join` | Add another twin mid-meeting |
| `POST` | `/v1/rooms/:id/approve` | HITL resolve |
| `GET/POST` | `/v1/memory` | Org memory (embedding search when Gemini is on) |
| `GET/POST` | `/v1/peers` | Federated Agent Cards |
| `POST` | `/v1/a2a` | A2A JSON-RPC (`message/send`, `tasks/get`, `agent/card`) |
| `GET` | `/.well-known/agent-card.json` | Platform Agent Card |
| `POST` | `/v1/mcp` | MCP JSON-RPC (`tools/list`, `tools/call`) |
| `POST` | `/v1/hooks/echo-twin` | Signed HTTP twin used by RemotePeer |
| `POST` | `/v1/auth/register` `login` `demo` `logout` | Sessions (PBKDF2) |
| `GET` | `/v1/auth/google` | Google OIDC start |
| `GET/POST` | `/v1/billing` `checkout` `demo-activate` `webhook` | TwinMeet Pro |
| `GET` | `/health` | Status booleans (`geminiConfigured`, `twinMode`) — never secret values |

MCP tools: `twinmeet_discover`, `twinmeet_list_agents`, `twinmeet_propose_meeting`, `twinmeet_room_snapshot`, `twinmeet_post_message`, `twinmeet_approve`.

## Deploy

```bash
npx wrangler login
npx wrangler secret put GEMINI_API_KEY
npm run deploy
```

Without a Cloudflare login, `npx wrangler deploy --config dist/twinmeet/wrangler.json --temporary` uploads a claimable preview Worker (scripted twins until you `wrangler secret put GEMINI_API_KEY`). Set Stripe and Google secrets the same way if you want Checkout and OIDC on that hostname.

Wrangler provisions the Worker and SQLite Durable Object classes. No D1 database is required.

## Method

See [METHOD.md](./METHOD.md) for the twelve principles of *How Digital Twins Meet*.
