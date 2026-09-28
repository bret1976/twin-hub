import { getStoredSessionId } from "./session";

export interface Agent {
  id: string;
  orgId?: string;
  name: string;
  description: string;
  purpose: string;
  nonGoals: string;
  boundaries: string;
  tags: string[];
  version: string;
  runtime: "scripted" | "http" | "generic";
  script: "planner" | "sql-reviewer" | "generic" | null;
  callbackUrl: string | null;
  federatedCardUrl?: string | null;
}

export interface Capability {
  id: string;
  agentId: string;
  skillId: string;
  name: string;
  description: string;
  tags: string[];
  examples: string[];
}

export interface MeetingRequest {
  id: string;
  requesterId: string;
  inviteeId: string;
  inviteeIds?: string[];
  intent: string;
  body: string;
  tags: string[];
  status: "proposed" | "accepted" | "declined";
  roomId: string | null;
}

export interface RoomMessage {
  id: string;
  seq: number;
  type: string;
  authorId: string;
  authorName: string;
  body: string;
  payload: unknown;
  createdAt: string;
}

export interface Artifact {
  id: string;
  kind: string;
  body: Record<string, unknown>;
  authorId: string;
  createdAt: string;
}

export interface JointSummary {
  problem: string;
  participants: string[];
  artifact: Record<string, unknown> | null;
  resolved: boolean;
  rounds: number;
  narrative: string;
  generatedBy: "template" | "llm" | "gemini";
}

export interface VoteRecord {
  voterId: string;
  voterName: string;
  subject: "artifact" | "resolve";
  decision: "approve" | "reject";
  createdAt: string;
}

export interface GraphEdge {
  fromId: string;
  toId: string;
  kind: "handoff" | "mention" | "follow";
  weight: number;
}

export interface RoomSnapshot {
  id: string;
  orgId?: string;
  meetingRequestId: string;
  status: string;
  intent: string;
  body: string;
  maxRounds: number;
  roundCount: number;
  floorHolderId: string | null;
  pendingGate: "resolve" | "tool" | "vote" | null;
  members: Array<{ id: string; name: string; role: string; script: string | null; runtime?: string | null }>;
  messages: RoomMessage[];
  artifacts: Artifact[];
  summary: JointSummary | null;
  votes?: VoteRecord[];
  graph?: GraphEdge[];
  twinMode?: "gemini" | "scripted";
  createdAt: string;
}

export interface DiscoverHit {
  agent: Agent;
  capabilities: Capability[];
  score: number;
  tagScore: number;
  keywordScore: number;
  matchedTags: string[];
}

export interface AuditEvent {
  id: string;
  roomId: string | null;
  meetingRequestId: string | null;
  type: string;
  actorId: string | null;
  payload: unknown;
  createdAt: string;
}

export interface MemoryRecord {
  id: string;
  orgId: string;
  roomId: string | null;
  problem: string;
  artifact: Record<string, unknown> | null;
  tags: string[];
  narrative: string;
  createdAt: string;
}

export interface FederatedPeer {
  id: string;
  orgId: string;
  cardUrl: string;
  name: string;
  card: Record<string, unknown>;
  lastFetched: string;
}

export interface Health {
  ok: boolean;
  gemini?: boolean;
  geminiConfigured?: boolean;
  twinMode?: "gemini" | "scripted";
  model?: string | null;
  embeddings?: boolean;
  a2a?: boolean;
  mcp?: boolean;
  oidc?: boolean;
  stripe?: boolean;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const session = getStoredSessionId();
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(session ? { "x-session-id": session } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export const api = {
  health: () => req<Health>("/health"),
  seed: () =>
    req<{ agents: Agent[]; capabilities: Capability[]; demoIntent: string; sampleDdl: string }>("/v1/seed", {
      method: "POST",
    }),
  agents: () => req<{ agents: Agent[] }>("/v1/agents"),
  agent: (id: string) => req<{ agent: Agent; capabilities: Capability[] }>(`/v1/agents/${id}`),
  createAgent: (body: {
    name: string;
    description: string;
    purpose: string;
    nonGoals?: string;
    boundaries?: string;
    tags?: string[];
    runtime?: Agent["runtime"];
    script?: Agent["script"];
    callbackUrl?: string | null;
  }) => req<{ agent: Agent }>("/v1/agents", { method: "POST", body: JSON.stringify(body) }),
  card: (id: string) => req<Record<string, unknown>>(`/v1/agents/${id}/card`),
  discover: (intent: string, tags: string) =>
    req<{ results: DiscoverHit[] }>(`/v1/discover?intent=${encodeURIComponent(intent)}&tags=${encodeURIComponent(tags)}`),
  meetings: () => req<{ meetingRequests: MeetingRequest[] }>("/v1/meeting-requests"),
  propose: (body: {
    requesterId: string;
    inviteeId: string;
    inviteeIds?: string[];
    intent: string;
    body?: string;
    tags?: string[];
  }) =>
    req<{ meetingRequest: MeetingRequest }>("/v1/meeting-requests", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  accept: (id: string) =>
    req<{ meetingRequest: MeetingRequest; room: RoomSnapshot }>(`/v1/meeting-requests/${id}/accept`, {
      method: "POST",
    }),
  startMeeting: (body: {
    intent: string;
    body?: string;
    tags?: string[];
    requesterId?: string;
    inviteeId?: string;
    inviteeIds?: string[];
  }) =>
    req<{ meetingRequest: MeetingRequest; room: RoomSnapshot }>("/v1/meetings/start", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  decline: (id: string) =>
    req<{ meetingRequest: MeetingRequest }>(`/v1/meeting-requests/${id}/decline`, { method: "POST" }),
  rooms: () => req<{ rooms: Array<{ id: string; meetingRequestId: string; status: string }> }>("/v1/rooms"),
  room: (id: string) => req<{ room: RoomSnapshot }>(`/v1/rooms/${id}`),
  tick: (id: string) => req<{ room: RoomSnapshot }>(`/v1/rooms/${id}/tick`, { method: "POST" }),
  approve: (id: string, decision: "approve" | "reject" = "approve") =>
    req<{ room: RoomSnapshot }>(`/v1/rooms/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ decision, actorId: "human" }),
    }),
  resolve: (id: string) => req<{ room: RoomSnapshot }>(`/v1/rooms/${id}/resolve`, { method: "POST" }),
  vote: (id: string, subject: VoteRecord["subject"], decision: VoteRecord["decision"]) =>
    req<{ room: RoomSnapshot }>(`/v1/rooms/${id}/vote`, {
      method: "POST",
      body: JSON.stringify({ voterId: "human", subject, decision }),
    }),
  join: (roomId: string, agentId: string) =>
    req<{ room: RoomSnapshot }>(`/v1/rooms/${roomId}/join`, {
      method: "POST",
      body: JSON.stringify({ agentId }),
    }),
  audit: (roomId: string) => req<{ events: AuditEvent[] }>(`/v1/rooms/${roomId}/audit`),
  postChat: (roomId: string, body: string) =>
    req<{ message: RoomMessage }>(`/v1/rooms/${roomId}/messages`, {
      method: "POST",
      body: JSON.stringify({ authorId: "human", authorName: "Human", type: "chat", body }),
    }),
  me: () => req<{ user: import("./session").SessionUser | null; org: import("./session").SessionOrg | null }>("/v1/auth/me"),
  login: (email: string, password: string) =>
    req<{ user: import("./session").SessionUser; org: import("./session").SessionOrg; session: { id: string } }>(
      "/v1/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
    ),
  register: (body: { email: string; name: string; password: string; orgName?: string }) =>
    req<{ user: import("./session").SessionUser; org: import("./session").SessionOrg; session: { id: string } }>(
      "/v1/auth/register",
      { method: "POST", body: JSON.stringify(body) },
    ),
  demoLogin: () =>
    req<{ user: import("./session").SessionUser; org: import("./session").SessionOrg; session: { id: string } }>(
      "/v1/auth/demo",
      { method: "POST" },
    ),
  logout: () => req<{ ok: boolean }>("/v1/auth/logout", { method: "POST" }),
  billing: () =>
    req<{
      org: import("./session").SessionOrg | null;
      plan: "free" | "pro";
      stripeConfigured: boolean;
      price: { amount: number; currency: string; interval: string; name: string };
    }>("/v1/billing"),
  checkout: () => req<{ url?: string; demo?: boolean; message?: string }>("/v1/billing/checkout", { method: "POST" }),
  activatePro: () => req<{ org: import("./session").SessionOrg; plan: "pro" }>("/v1/billing/demo-activate", { method: "POST" }),
  memories: (q = "") => req<{ memories: MemoryRecord[] }>(`/v1/memory${q ? `?q=${encodeURIContent(q)}` : ""}`),
  addMemory: (body: { problem: string; narrative: string; tags?: string[] }) =>
    req<{ memory: MemoryRecord }>("/v1/memory", { method: "POST", body: JSON.stringify(body) }),
  peers: () => req<{ peers: FederatedPeer[] }>("/v1/peers"),
  addPeer: (cardUrl: string) =>
    req<{ peer: FederatedPeer }>("/v1/peers", { method: "POST", body: JSON.stringify({ cardUrl }) }),
  a2aCard: () => req<Record<string, unknown>>("/.well-known/agent-card.json"),
  mcpTools: () => req<{ tools: Array<{ name: string; description: string }> }>("/v1/mcp"),
};

function encodeURIContent(q: string): string {
  return encodeURIComponent(q);
}

export const DEMO_INTENT = "Review this toy DDL for a orders table and suggest one index.";
export const SAMPLE_DDL = `CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  total_cents INTEGER NOT NULL
);`;
