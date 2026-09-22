export type MessageType = "chat" | "proposal" | "artifact" | "handoff" | "system" | "audit";

export type RoomStatus = "open" | "paused" | "resolved" | "escalated" | "declined";

export type MeetingStatus = "proposed" | "accepted" | "declined";

export type AgentRuntime = "scripted" | "http";

export type ScriptKind = "planner" | "sql-reviewer";

export type TwinRole = "twin" | "human";

export interface Env {
  REGISTRY: DurableObjectNamespace;
  ROOM: DurableObjectNamespace;
  OPENAI_API_KEY?: string;
  LLM_MODEL?: string;
}

export interface AgentRecord {
  id: string;
  name: string;
  description: string;
  purpose: string;
  nonGoals: string;
  boundaries: string;
  tags: string[];
  version: string;
  runtime: AgentRuntime;
  script: ScriptKind | null;
  callbackUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityRecord {
  id: string;
  agentId: string;
  skillId: string;
  name: string;
  description: string;
  tags: string[];
  examples: string[];
  createdAt: string;
}

export interface MeetingRequestRecord {
  id: string;
  requesterId: string;
  inviteeId: string;
  intent: string;
  body: string;
  tags: string[];
  status: MeetingStatus;
  roomId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoomIndexRecord {
  id: string;
  meetingRequestId: string;
  status: RoomStatus;
  createdAt: string;
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

export interface RoomMember {
  id: string;
  name: string;
  role: TwinRole;
  runtime: AgentRuntime | null;
  script: ScriptKind | null;
  joinedAt: string;
}

export interface RoomMessage {
  id: string;
  seq: number;
  type: MessageType;
  authorId: string;
  authorName: string;
  body: string;
  payload: unknown;
  createdAt: string;
}

export interface ArtifactRecord {
  id: string;
  messageId: string | null;
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
  status: RoomStatus;
  intent: string;
  body: string;
  maxRounds: number;
  roundCount: number;
  floorHolderId: string | null;
  pendingGate: "resolve" | "tool" | null;
  members: RoomMember[];
  messages: RoomMessage[];
  artifacts: ArtifactRecord[];
  summary: JointSummary | null;
  createdAt: string;
}

export interface DiscoverHit {
  agent: AgentRecord;
  capabilities: CapabilityRecord[];
  score: number;
  tagScore: number;
  keywordScore: number;
  matchedTags: string[];
}

export interface TwinContext {
  selfId: string;
  selfName: string;
  intent: string;
  body: string;
  members: RoomMember[];
  transcript: RoomMessage[];
}

export type TwinAction =
  | { type: "chat"; body: string }
  | { type: "proposal"; body: string }
  | { type: "artifact"; body: string; payload: Record<string, unknown> }
  | { type: "handoff"; body: string; toId: string }
  | { type: "request_resolve"; body: string };

export interface OpenRoomInput {
  roomId: string;
  meetingRequestId: string;
  intent: string;
  body: string;
  maxRounds: number;
  members: RoomMember[];
  floorHolderId: string;
}

export interface PostMessageInput {
  authorId: string;
  authorName: string;
  type: MessageType;
  body: string;
  payload?: unknown;
}

export interface A2AAgentCard {
  name: string;
  description: string;
  supportedInterfaces: Array<{
    url: string;
    protocolBinding: string;
    protocolVersion: string;
    tenant?: string;
  }>;
  provider?: { organization: string; url: string };
  version: string;
  documentationUrl?: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    extendedAgentCard: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
    examples?: string[];
    inputModes?: string[];
    outputModes?: string[];
  }>;
}

export const SAMPLE_ORDERS_DDL = `CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  total_cents INTEGER NOT NULL
);`;

export const DEMO_INTENT = "Review this toy DDL for a orders table and suggest one index.";

export const PLANNER_ID = "planner-twin";
export const REVIEWER_ID = "sql-reviewer-twin";
