export interface Agent {
  id: string;
  name: string;
  description: string;
  purpose: string;
  nonGoals: string;
  boundaries: string;
  tags: string[];
  version: string;
  runtime: "scripted" | "http";
  script: "planner" | "sql-reviewer" | null;
  callbackUrl: string | null;
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
  generatedBy: "template" | "llm";
}

export interface RoomSnapshot {
  id: string;
  meetingRequestId: string;
  status: string;
  intent: string;
  body: string;
  maxRounds: number;
  roundCount: number;
  floorHolderId: string | null;
  pendingGate: "resolve" | "tool" | null;
  members: Array<{ id: string; name: string; role: string; script: string | null }>;
  messages: RoomMessage[];
  artifacts: Artifact[];
  summary: JointSummary | null;
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

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export const api = {
  seed: () =>
    req<{ agents: Agent[]; capabilities: Capability[]; demoIntent: string; sampleDdl: string }>("/v1/seed", {
      method: "POST",
    }),
  agents: () => req<{ agents: Agent[] }>("/v1/agents"),
  agent: (id: string) => req<{ agent: Agent; capabilities: Capability[] }>(`/v1/agents/${id}`),
  card: (id: string) => req<Record<string, unknown>>(`/v1/agents/${id}/card`),
  discover: (intent: string, tags: string) =>
    req<{ results: DiscoverHit[] }>(`/v1/discover?intent=${encodeURIComponent(intent)}&tags=${encodeURIComponent(tags)}`),
  meetings: () => req<{ meetingRequests: MeetingRequest[] }>("/v1/meeting-requests"),
  propose: (body: { requesterId: string; inviteeId: string; intent: string; body?: string; tags?: string[] }) =>
    req<{ meetingRequest: MeetingRequest }>("/v1/meeting-requests", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  accept: (id: string) =>
    req<{ meetingRequest: MeetingRequest; room: RoomSnapshot }>(`/v1/meeting-requests/${id}/accept`, {
      method: "POST",
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
  audit: (roomId: string) => req<{ events: AuditEvent[] }>(`/v1/rooms/${roomId}/audit`),
  postChat: (roomId: string, body: string) =>
    req<{ message: RoomMessage }>(`/v1/rooms/${roomId}/messages`, {
      method: "POST",
      body: JSON.stringify({ authorId: "human", authorName: "Human", type: "chat", body }),
    }),
};

export const DEMO_INTENT = "Review this toy DDL for a orders table and suggest one index.";
export const SAMPLE_DDL = `CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  total_cents INTEGER NOT NULL
);`;
