import { toAgentCard } from "./lib/card";
import { error, json, parseTags, readJson, withCors, nowIso } from "./lib/http";
import { clearSessionCookie, readSessionId, sessionCookie } from "./lib/auth";
import { embedText } from "./lib/embeddings";
import { handleA2A, platformCard } from "./lib/a2a";
import { handleMcp } from "./lib/mcp";
import { handleEchoTwin } from "./lib/hooks";
import { createCheckoutSession, verifyStripeSignature } from "./lib/stripe";
import { Registry } from "./durable-objects/registry";
import { Room } from "./durable-objects/room";
import {
  DEMO_INTENT,
  DEMO_ORG_ID,
  SAMPLE_ORDERS_DDL,
  type AgentRecord,
  type Env,
  type MeetingRequestRecord,
  type OpenRoomInput,
  type OrgRecord,
  type PostMessageInput,
  type RoomMember,
  type RoomMessage,
  type RoomSnapshot,
  type SessionRecord,
  type UserRecord,
  type VoteRecord,
} from "./types";

interface RoomRpc {
  fetch(request: Request): Promise<Response>;
  open(input: OpenRoomInput): Promise<RoomSnapshot>;
  getSnapshot(): Promise<RoomSnapshot>;
  tick(): Promise<RoomSnapshot>;
  postMessage(input: PostMessageInput): Promise<RoomMessage>;
  requestResolve(actorId: string, note?: string): Promise<RoomSnapshot>;
  approve(actorId: string, decision: "approve" | "reject"): Promise<RoomSnapshot>;
  escalate(actorId: string, reason: string): Promise<RoomSnapshot>;
  vote(voterId: string, subject: VoteRecord["subject"], decision: VoteRecord["decision"]): Promise<RoomSnapshot>;
  joinMember(member: RoomMember): Promise<RoomSnapshot>;
}

export { Registry, Room };

interface AgentBody {
  id?: string;
  orgId?: string;
  name: string;
  description: string;
  purpose: string;
  nonGoals?: string;
  boundaries?: string;
  tags?: string[];
  version?: string;
  runtime?: AgentRecord["runtime"];
  script?: AgentRecord["script"];
  callbackUrl?: string | null;
  federatedCardUrl?: string | null;
}

interface CapabilityBody {
  skillId?: string;
  name: string;
  description: string;
  tags?: string[];
  examples?: string[];
}

interface MeetingBody {
  requesterId: string;
  inviteeId: string;
  inviteeIds?: string[];
  orgId?: string;
  intent: string;
  body?: string;
  tags?: string[];
}

interface MessageBody {
  authorId?: string;
  authorName?: string;
  type?: "chat" | "proposal" | "artifact" | "handoff" | "system";
  body: string;
  payload?: unknown;
}

interface AuthBody {
  email?: string;
  name?: string;
  password?: string;
  orgName?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }
    try {
      return withCors(await route(request, env));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      const status = /not found/i.test(message)
        ? 404
        : /credentials/i.test(message)
          ? 401
          : /already|floor|paused|resolved|registered/i.test(message)
            ? 409
            : 500;
      return withCors(error(status, message));
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const registry = env.REGISTRY.getByName("global") as DurableObjectStub<Registry>;
  const origin = env.PUBLIC_URL || url.origin;
  const session = await optionalSession(request, registry);

  if (request.method === "GET" && (path === "/health" || path === "/v1/health")) {
    return json({
      ok: true,
      service: "twinmeet",
      gemini: Boolean(env.GEMINI_API_KEY),
      model: env.GEMINI_API_KEY ? env.GEMINI_MODEL || env.LLM_MODEL || "gemini-3.5-flash" : null,
      embeddings: Boolean(env.GEMINI_API_KEY),
      a2a: true,
      mcp: true,
      oidc: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      stripe: Boolean(env.STRIPE_SECRET_KEY),
      auth: true,
    });
  }

  if (request.method === "GET" && (path === "/.well-known/agent.json" || path === "/.well-known/agent-card.json")) {
    return json(platformCard(origin));
  }

  if (path === "/v1/a2a") {
    return handleA2A(request, env, registry, origin);
  }

  if (path === "/v1/mcp") {
    return handleMcp(request, env, registry);
  }

  if (request.method === "POST" && path === "/v1/hooks/echo-twin") {
    return handleEchoTwin(request);
  }

  const authRes = await routeAuth(request, env, registry, url, path);
  if (authRes) return authRes;

  const billingRes = await routeBilling(request, env, registry, session, origin, path);
  if (billingRes) return billingRes;

  if (request.method === "GET" && path === "/v1/memory") {
    const orgId = session?.org.id || url.searchParams.get("orgId") || DEMO_ORG_ID;
    const q = url.searchParams.get("q") ?? "";
    let queryEmbedding: number[] | null = null;
    if (q && env.GEMINI_API_KEY) queryEmbedding = await embedText(env.GEMINI_API_KEY, q);
    return json({ memories: await registry.listMemory(orgId, queryEmbedding) });
  }

  if (request.method === "POST" && path === "/v1/memory") {
    const body = await readJson<{
      orgId?: string;
      roomId?: string | null;
      problem: string;
      narrative: string;
      tags?: string[];
      artifact?: Record<string, unknown> | null;
    }>(request);
    if (!body.problem || !body.narrative) return error(400, "problem and narrative are required");
    const orgId = body.orgId || session?.org.id || DEMO_ORG_ID;
    const embedding = env.GEMINI_API_KEY
      ? await embedText(env.GEMINI_API_KEY, `${body.problem}\n${body.narrative}`)
      : null;
    const memory = await registry.addMemory({
      orgId,
      roomId: body.roomId ?? null,
      problem: body.problem,
      artifact: body.artifact ?? null,
      tags: body.tags ?? [],
      embedding,
      narrative: body.narrative,
    });
    return json({ memory }, 201);
  }

  if (request.method === "GET" && path === "/v1/peers") {
    const orgId = session?.org.id || url.searchParams.get("orgId") || DEMO_ORG_ID;
    return json({ peers: await registry.listPeers(orgId) });
  }

  if (request.method === "POST" && path === "/v1/peers") {
    const body = await readJson<{ cardUrl: string; orgId?: string }>(request);
    if (!body.cardUrl) return error(400, "cardUrl is required");
    const orgId = body.orgId || session?.org.id || DEMO_ORG_ID;
    const fetched = await fetch(body.cardUrl, { signal: AbortSignal.timeout(8000) });
    if (!fetched.ok) return error(502, `Peer card fetch failed (${fetched.status})`);
    const card = (await fetched.json()) as import("./types").A2AAgentCard;
    if (!card?.name) return error(400, "Peer card is missing name");
    const peer = await registry.upsertPeer(orgId, body.cardUrl, card);
    return json({ peer }, 201);
  }

  if (request.method === "GET" && path === "/v1/a2a/tasks") {
    const orgId = session?.org.id || DEMO_ORG_ID;
    return json({ tasks: await registry.listTasks(orgId) });
  }

  if (request.method === "POST" && path === "/v1/seed") {
    const seeded = await registry.seedDemo();
    await embedAgents(env, registry, seeded.agents);
    return json({ ok: true, ...seeded, demoIntent: DEMO_INTENT, sampleDdl: SAMPLE_ORDERS_DDL });
  }

  if (request.method === "GET" && path === "/v1/agents") {
    return json({ agents: await registry.listAgents() });
  }

  if (request.method === "POST" && path === "/v1/agents") {
    const body = await readJson<AgentBody>(request);
    if (!body.name || !body.description || !body.purpose) {
      return error(400, "name, description, and purpose are required");
    }
    const agent = await registry.createAgent({
      ...body,
      orgId: body.orgId || session?.org.id || DEMO_ORG_ID,
    });
    await embedAgents(env, registry, [agent]);
    return json({ agent }, 201);
  }

  const agentCard = match(path, /^\/v1\/agents\/([^/]+)\/card$/);
  if (agentCard && request.method === "GET") {
    const agent = await registry.getAgent(agentCard[1]);
    if (!agent) return error(404, "Agent not found");
    const capabilities = await registry.listCapabilities(agent.id);
    const card = toAgentCard(agent, capabilities, origin);
    return json(card);
  }

  const agentCaps = match(path, /^\/v1\/agents\/([^/]+)\/capabilities$/);
  if (agentCaps && request.method === "GET") {
    return json({ capabilities: await registry.listCapabilities(agentCaps[1]) });
  }
  if (agentCaps && request.method === "POST") {
    const body = await readJson<CapabilityBody>(request);
    if (!body.name || !body.description) return error(400, "name and description are required");
    const cap = await registry.addCapability({ agentId: agentCaps[1], ...body });
    return json({ capability: cap }, 201);
  }

  const agentOne = match(path, /^\/v1\/agents\/([^/]+)$/);
  if (agentOne && request.method === "GET") {
    const agent = await registry.getAgent(agentOne[1]);
    if (!agent) return error(404, "Agent not found");
    const capabilities = await registry.listCapabilities(agent.id);
    return json({ agent, capabilities });
  }
  if (agentOne && (request.method === "PATCH" || request.method === "PUT")) {
    const body = await readJson<Partial<AgentBody>>(request);
    const agent = await registry.updateAgent(agentOne[1], body);
    return json({ agent });
  }
  if (agentOne && request.method === "DELETE") {
    await registry.deleteAgent(agentOne[1]);
    return json({ ok: true });
  }

  const capOne = match(path, /^\/v1\/capabilities\/([^/]+)$/);
  if (capOne && request.method === "DELETE") {
    await registry.deleteCapability(capOne[1]);
    return json({ ok: true });
  }

  if (request.method === "GET" && path === "/v1/discover") {
    const intent = url.searchParams.get("intent") ?? "";
    const tags = parseTags(url.searchParams.get("tags"));
    if (!intent.trim() && tags.length === 0) {
      return error(400, "intent or tags is required");
    }
    let queryEmbedding: number[] | null = null;
    if (intent && env.GEMINI_API_KEY) {
      queryEmbedding = await embedText(env.GEMINI_API_KEY, intent);
    }
    const results = await registry.discover(intent, tags, queryEmbedding);
    return json({ results });
  }

  if (request.method === "GET" && path === "/v1/meeting-requests") {
    return json({ meetingRequests: await registry.listMeetings() });
  }

  if (request.method === "POST" && path === "/v1/meeting-requests") {
    const body = await readJson<MeetingBody>(request);
    if (!body.requesterId || !body.inviteeId || !body.intent) {
      return error(400, "requesterId, inviteeId, and intent are required");
    }
    const meeting = await registry.proposeMeeting({
      ...body,
      orgId: body.orgId || session?.org.id || DEMO_ORG_ID,
    });
    return json({ meetingRequest: meeting }, 201);
  }

  const accept = match(path, /^\/v1\/meeting-requests\/([^/]+)\/accept$/);
  if (accept && request.method === "POST") {
    const meeting = await registry.decideMeeting(accept[1], "accepted");
    if (!meeting.roomId) return error(500, "Accept did not create a room");
    const snapshot = await openRoom(env, registry, meeting, origin);
    return json({ meetingRequest: meeting, room: snapshot });
  }

  const decline = match(path, /^\/v1\/meeting-requests\/([^/]+)\/decline$/);
  if (decline && request.method === "POST") {
    const meeting = await registry.decideMeeting(decline[1], "declined");
    return json({ meetingRequest: meeting });
  }

  const meetingOne = match(path, /^\/v1\/meeting-requests\/([^/]+)$/);
  if (meetingOne && request.method === "GET") {
    const meeting = await registry.getMeeting(meetingOne[1]);
    if (!meeting) return error(404, "Meeting request not found");
    return json({ meetingRequest: meeting });
  }

  if (request.method === "GET" && path === "/v1/rooms") {
    return json({ rooms: await registry.listRooms() });
  }

  const roomWs = match(path, /^\/v1\/rooms\/([^/]+)\/ws$/);
  if (roomWs) {
    const stub = roomStub(env, roomWs[1]);
    return stub.fetch(request);
  }

  const roomTick = match(path, /^\/v1\/rooms\/([^/]+)\/tick$/);
  if (roomTick && request.method === "POST") {
    return json({ room: await roomStub(env, roomTick[1]).tick() });
  }

  const roomMessages = match(path, /^\/v1\/rooms\/([^/]+)\/messages$/);
  if (roomMessages && request.method === "GET") {
    const room = await roomStub(env, roomMessages[1]).getSnapshot();
    return json({ messages: room.messages });
  }
  if (roomMessages && request.method === "POST") {
    const stub = roomStub(env, roomMessages[1]);
    const body = await readJson<MessageBody>(request);
    if (!body.body) return error(400, "body is required");
    const message = await stub.postMessage({
      authorId: body.authorId || request.headers.get("X-Actor-Id") || session?.user.id || "human",
      authorName: body.authorName || request.headers.get("X-Actor-Name") || session?.user.name || "Human",
      type: body.type ?? "chat",
      body: body.body,
      payload: body.payload,
    });
    return json({ message }, 201);
  }

  const roomArtifacts = match(path, /^\/v1\/rooms\/([^/]+)\/artifacts$/);
  if (roomArtifacts && request.method === "GET") {
    const room = await roomStub(env, roomArtifacts[1]).getSnapshot();
    return json({ artifacts: room.artifacts });
  }

  const roomSummary = match(path, /^\/v1\/rooms\/([^/]+)\/summary$/);
  if (roomSummary && request.method === "GET") {
    const room = await roomStub(env, roomSummary[1]).getSnapshot();
    return json({ summary: room.summary, status: room.status });
  }

  const roomAudit = match(path, /^\/v1\/rooms\/([^/]+)\/audit$/);
  if (roomAudit && request.method === "GET") {
    const events = await registry.listAudit({ roomId: roomAudit[1] });
    return json({ events });
  }

  const roomVote = match(path, /^\/v1\/rooms\/([^/]+)\/vote$/);
  if (roomVote && request.method === "POST") {
    const body = await readJson<{
      voterId?: string;
      subject?: VoteRecord["subject"];
      decision?: VoteRecord["decision"];
    }>(request);
    const room = await roomStub(env, roomVote[1]).vote(
      body.voterId || session?.user.id || "human",
      body.subject ?? "resolve",
      body.decision ?? "approve",
    );
    return json({ room });
  }

  const roomJoin = match(path, /^\/v1\/rooms\/([^/]+)\/join$/);
  if (roomJoin && request.method === "POST") {
    const body = await readJson<{ agentId: string }>(request);
    if (!body.agentId) return error(400, "agentId is required");
    const agent = await registry.getAgent(body.agentId);
    if (!agent) return error(404, "Agent not found");
    const room = await roomStub(env, roomJoin[1]).joinMember(toMember(agent, nowIso()));
    return json({ room });
  }

  const roomResolve = match(path, /^\/v1\/rooms\/([^/]+)\/resolve$/);
  if (roomResolve && request.method === "POST") {
    const actor = request.headers.get("X-Actor-Id") || session?.user.id || "human";
    const room = await roomStub(env, roomResolve[1]).requestResolve(actor);
    return json({ room });
  }

  const roomApprove = match(path, /^\/v1\/rooms\/([^/]+)\/approve$/);
  if (roomApprove && request.method === "POST") {
    const body = await readJson<{ decision?: "approve" | "reject"; actorId?: string }>(request);
    const room = await roomStub(env, roomApprove[1]).approve(
      body.actorId || session?.user.id || "human",
      body.decision ?? "approve",
    );
    return json({ room });
  }

  const roomEscalate = match(path, /^\/v1\/rooms\/([^/]+)\/escalate$/);
  if (roomEscalate && request.method === "POST") {
    const body = await readJson<{ reason?: string; actorId?: string }>(request);
    const room = await roomStub(env, roomEscalate[1]).escalate(
      body.actorId || session?.user.id || "human",
      body.reason || "Human escalated",
    );
    return json({ room });
  }

  const roomOne = match(path, /^\/v1\/rooms\/([^/]+)$/);
  if (roomOne && request.method === "GET") {
    return json({ room: await roomStub(env, roomOne[1]).getSnapshot() });
  }

  if (request.method === "GET" && path === "/v1/audit") {
    const roomId = url.searchParams.get("roomId") ?? undefined;
    const meetingRequestId = url.searchParams.get("meetingRequestId") ?? undefined;
    return json({ events: await registry.listAudit({ roomId, meetingRequestId }) });
  }

  return error(404, "Not found");
}

async function routeAuth(
  request: Request,
  env: Env,
  registry: DurableObjectStub<Registry>,
  url: URL,
  path: string,
): Promise<Response | null> {
  if (request.method === "POST" && path === "/v1/auth/register") {
    const body = await readJson<AuthBody>(request);
    if (!body.email || !body.name || !body.password) return error(400, "email, name, and password are required");
    const out = await registry.registerUser({
      email: body.email,
      name: body.name,
      password: body.password,
      orgName: body.orgName,
    });
    return authResponse(out);
  }

  if (request.method === "POST" && path === "/v1/auth/login") {
    const body = await readJson<AuthBody>(request);
    if (!body.email || !body.password) return error(400, "email and password are required");
    return authResponse(await registry.login(body.email, body.password));
  }

  if (request.method === "POST" && path === "/v1/auth/demo") {
    return authResponse(await registry.loginDemo());
  }

  if (request.method === "POST" && path === "/v1/auth/logout") {
    const sid = readSessionId(request);
    if (sid) await registry.deleteSession(sid);
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  }

  if (request.method === "GET" && path === "/v1/auth/me") {
    const sid = readSessionId(request);
    if (!sid) return json({ user: null, org: null });
    const sess = await registry.getSession(sid);
    return json(sess ?? { user: null, org: null });
  }

  if (request.method === "GET" && path === "/v1/auth/google") {
    if (!env.GOOGLE_CLIENT_ID) {
      return error(501, "Google OIDC is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or use email login / demo workspace.");
    }
    const redirect = `${env.PUBLIC_URL || url.origin}/v1/auth/google/callback`;
    const dest = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    dest.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
    dest.searchParams.set("redirect_uri", redirect);
    dest.searchParams.set("response_type", "code");
    dest.searchParams.set("scope", "openid email profile");
    dest.searchParams.set("state", crypto.randomUUID());
    dest.searchParams.set("access_type", "online");
    return Response.redirect(dest.toString(), 302);
  }

  if (request.method === "GET" && path === "/v1/auth/google/callback") {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      return error(501, "Google OIDC is not configured");
    }
    const code = url.searchParams.get("code");
    if (!code) return error(400, "Missing OIDC code");
    const redirect = `${env.PUBLIC_URL || url.origin}/v1/auth/google/callback`;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirect,
        grant_type: "authorization_code",
      }),
    });
    const token = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!token.access_token) return error(401, token.error || "OIDC token exchange failed");
    const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    const info = (await infoRes.json()) as { email?: string; name?: string };
    if (!info.email) return error(401, "OIDC profile missing email");
    const out = await registry.loginOrRegisterOidc(info.email, info.name || info.email);
    const site = env.PUBLIC_URL || url.origin;
    return new Response(null, {
      status: 302,
      headers: {
        location: `${site}/#/account`,
        "set-cookie": sessionCookie(out.session.id),
      },
    });
  }

  return null;
}

async function routeBilling(
  request: Request,
  env: Env,
  registry: DurableObjectStub<Registry>,
  session: { user: UserRecord; org: OrgRecord } | null,
  origin: string,
  path: string,
): Promise<Response | null> {
  if (request.method === "GET" && path === "/v1/billing") {
    const orgId = session?.org.id || DEMO_ORG_ID;
    const org = (await registry.getOrg(orgId)) ?? session?.org ?? null;
    return json({
      org,
      plan: org?.plan ?? "free",
      stripeConfigured: Boolean(env.STRIPE_SECRET_KEY),
      price: { amount: 2900, currency: "usd", interval: "month", name: "TwinMeet Pro" },
    });
  }

  if (request.method === "POST" && path === "/v1/billing/checkout") {
    const orgId = session?.org.id || DEMO_ORG_ID;
    const org = await registry.getOrg(orgId);
    if (!org) return error(404, "Org not found. Enter the demo workspace or register first.");
    if (!env.STRIPE_SECRET_KEY) {
      return json({
        demo: true,
        message: "Stripe is not configured. Use POST /v1/billing/demo-activate to enable TwinMeet Pro locally.",
      });
    }
    const created = await createCheckoutSession({
      secretKey: env.STRIPE_SECRET_KEY,
      org,
      successUrl: `${origin}/#/billing?checkout=success`,
      cancelUrl: `${origin}/#/billing?checkout=cancel`,
    });
    if ("error" in created) return error(502, created.error);
    return json({ url: created.url });
  }

  if (request.method === "POST" && path === "/v1/billing/demo-activate") {
    const orgId = session?.org.id || DEMO_ORG_ID;
    const org = await registry.setOrgPlan(orgId, "pro");
    return json({ org, plan: "pro", demo: true });
  }

  if (request.method === "POST" && path === "/v1/billing/webhook") {
    const payload = await request.text();
    if (env.STRIPE_WEBHOOK_SECRET) {
      const ok = await verifyStripeSignature(payload, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET);
      if (!ok) return error(400, "Invalid Stripe signature");
    }
    const event = JSON.parse(payload || "{}") as {
      type?: string;
      data?: { object?: { client_reference_id?: string; customer?: string; subscription?: string; metadata?: { orgId?: string } } };
    };
    const obj = event.data?.object;
    const orgId = obj?.metadata?.orgId || obj?.client_reference_id;
    if (orgId && (event.type === "checkout.session.completed" || event.type === "customer.subscription.updated")) {
      await registry.setOrgPlan(orgId, "pro", {
        customerId: obj?.customer,
        subscriptionId: obj?.subscription,
      });
    }
    if (orgId && event.type === "customer.subscription.deleted") {
      await registry.setOrgPlan(orgId, "free");
    }
    return json({ received: true });
  }

  return null;
}

function authResponse(out: { user: UserRecord; org: OrgRecord; session: SessionRecord }): Response {
  return json(out, 200, { "set-cookie": sessionCookie(out.session.id) });
}

async function optionalSession(
  request: Request,
  registry: DurableObjectStub<Registry>,
): Promise<{ user: UserRecord; org: OrgRecord } | null> {
  const sid = readSessionId(request);
  if (!sid) return null;
  return registry.getSession(sid);
}

async function embedAgents(
  env: Env,
  registry: DurableObjectStub<Registry>,
  agents: AgentRecord[],
): Promise<void> {
  if (!env.GEMINI_API_KEY) return;
  await Promise.all(
    agents.slice(0, 8).map(async (agent) => {
      if (agent.embedding?.length) return;
      const vec = await embedText(
        env.GEMINI_API_KEY!,
        `${agent.name} ${agent.description} ${agent.purpose} ${agent.tags.join(" ")}`,
      );
      if (vec) await registry.setAgentEmbedding(agent.id, vec);
    }),
  );
}

async function openRoom(
  env: Env,
  registry: DurableObjectStub<Registry>,
  meeting: MeetingRequestRecord,
  origin: string,
) {
  if (!meeting.roomId) throw new Error("Missing room id");
  const ids = [meeting.requesterId, meeting.inviteeId, ...(meeting.inviteeIds ?? [])];
  const unique = [...new Set(ids.filter(Boolean))];
  const joinedAt = nowIso();
  const members: RoomMember[] = [];
  for (const id of unique) {
    const agent = await registry.getAgent(id);
    if (agent) members.push(toMember(agent, joinedAt));
  }
  if (members.length < 2) throw new Error("Meeting agents not found");
  const memories = (await registry.listMemory(meeting.orgId || DEMO_ORG_ID)) as Array<{ narrative: string }>;
  const stub = roomStub(env, meeting.roomId);
  return stub.open({
    roomId: meeting.roomId,
    orgId: meeting.orgId || DEMO_ORG_ID,
    meetingRequestId: meeting.id,
    intent: meeting.intent,
    body: meeting.body,
    maxRounds: 8,
    members,
    floorHolderId: meeting.requesterId,
    publicBase: origin,
    memories: memories.slice(0, 6).map((m) => m.narrative),
  });
}

function toMember(agent: AgentRecord, joinedAt: string): RoomMember {
  return {
    id: agent.id,
    name: agent.name,
    role: "twin",
    runtime: agent.runtime,
    script: agent.script,
    callbackUrl: agent.callbackUrl,
    callbackSecret: agent.callbackSecret,
    purpose: agent.purpose,
    joinedAt,
  };
}

function match(path: string, re: RegExp): RegExpMatchArray | null {
  return path.match(re);
}

function roomStub(env: Env, roomId: string): RoomRpc {
  return env.ROOM.getByName(roomId) as unknown as RoomRpc;
}
