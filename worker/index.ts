import { toAgentCard } from "./lib/card";
import { error, json, parseTags, readJson, withCors, nowIso } from "./lib/http";
import { Registry } from "./durable-objects/registry";
import { Room } from "./durable-objects/room";
import {
  DEMO_INTENT,
  SAMPLE_ORDERS_DDL,
  type Env,
  type OpenRoomInput,
  type PostMessageInput,
  type RoomMember,
  type RoomMessage,
  type RoomSnapshot,
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
}

export { Registry, Room };

interface AgentBody {
  id?: string;
  name: string;
  description: string;
  purpose: string;
  nonGoals?: string;
  boundaries?: string;
  tags?: string[];
  version?: string;
  runtime?: "scripted" | "http";
  script?: "planner" | "sql-reviewer" | null;
  callbackUrl?: string | null;
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }
    try {
      return withCors(await route(request, env));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      const status = /not found/i.test(message) ? 404 : /already|floor|paused|resolved/i.test(message) ? 409 : 500;
      return withCors(error(status, message));
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const registry = env.REGISTRY.getByName("global") as DurableObjectStub<Registry>;

  if (request.method === "GET" && path === "/health") {
    return json({ ok: true, service: "twinmeet" });
  }

  if (request.method === "POST" && path === "/v1/seed") {
    const seeded = await registry.seedDemo();
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
    const agent = await registry.createAgent(body);
    return json({ agent }, 201);
  }

  const agentCard = match(path, /^\/v1\/agents\/([^/]+)\/card$/);
  if (agentCard && request.method === "GET") {
    const agent = await registry.getAgent(agentCard[1]);
    if (!agent) return error(404, "Agent not found");
    const capabilities = await registry.listCapabilities(agent.id);
    const card = toAgentCard(agent, capabilities, url.origin);
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
    const results = await registry.discover(intent, tags);
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
    const meeting = await registry.proposeMeeting(body);
    return json({ meetingRequest: meeting }, 201);
  }

  const accept = match(path, /^\/v1\/meeting-requests\/([^/]+)\/accept$/);
  if (accept && request.method === "POST") {
    const meeting = await registry.decideMeeting(accept[1], "accepted");
    if (!meeting.roomId) return error(500, "Accept did not create a room");
    const snapshot = await openRoom(env, registry, meeting);
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
      authorId: body.authorId || request.headers.get("X-Actor-Id") || "human",
      authorName: body.authorName || request.headers.get("X-Actor-Name") || "Human",
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

  const roomResolve = match(path, /^\/v1\/rooms\/([^/]+)\/resolve$/);
  if (roomResolve && request.method === "POST") {
    const actor = request.headers.get("X-Actor-Id") || "human";
    const room = await roomStub(env, roomResolve[1]).requestResolve(actor);
    return json({ room });
  }

  const roomApprove = match(path, /^\/v1\/rooms\/([^/]+)\/approve$/);
  if (roomApprove && request.method === "POST") {
    const body = await readJson<{ decision?: "approve" | "reject"; actorId?: string }>(request);
    const room = await roomStub(env, roomApprove[1]).approve(body.actorId || "human", body.decision ?? "approve");
    return json({ room });
  }

  const roomEscalate = match(path, /^\/v1\/rooms\/([^/]+)\/escalate$/);
  if (roomEscalate && request.method === "POST") {
    const body = await readJson<{ reason?: string; actorId?: string }>(request);
    const room = await roomStub(env, roomEscalate[1]).escalate(body.actorId || "human", body.reason || "Human escalated");
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

async function openRoom(
  env: Env,
  registry: DurableObjectStub<Registry>,
  meeting: {
    id: string;
    roomId: string | null;
    requesterId: string;
    inviteeId: string;
    intent: string;
    body: string;
  },
) {
  if (!meeting.roomId) throw new Error("Missing room id");
  const requester = await registry.getAgent(meeting.requesterId);
  const invitee = await registry.getAgent(meeting.inviteeId);
  if (!requester || !invitee) throw new Error("Meeting agents not found");
  const joinedAt = nowIso();
  const members: RoomMember[] = [
    {
      id: requester.id,
      name: requester.name,
      role: "twin",
      runtime: requester.runtime,
      script: requester.script,
      joinedAt,
    },
    {
      id: invitee.id,
      name: invitee.name,
      role: "twin",
      runtime: invitee.runtime,
      script: invitee.script,
      joinedAt,
    },
  ];
  const stub = roomStub(env, meeting.roomId);
  return stub.open({
    roomId: meeting.roomId,
    meetingRequestId: meeting.id,
    intent: meeting.intent,
    body: meeting.body,
    maxRounds: 8,
    members,
    floorHolderId: requester.id,
  });
}

function match(path: string, re: RegExp): RegExpMatchArray | null {
  return path.match(re);
}

function roomStub(env: Env, roomId: string): RoomRpc {
  return env.ROOM.getByName(roomId) as unknown as RoomRpc;
}
