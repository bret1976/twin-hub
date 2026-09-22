export type MessageType = "chat" | "proposal" | "artifact" | "handoff" | "system" | "audit";

export type RoomStatus = "open" | "paused" | "resolved" | "escalated" | "declined";

export type MeetingStatus = "proposed" | "accepted" | "declined";

export type AgentRuntime = "scripted" | "http" | "generic";

export type ScriptKind = "planner" | "sql-reviewer" | "generic";

export type TwinRole = "twin" | "human";

export interface Env {
  REGISTRY: DurableObjectNamespace;
  ROOM: DurableObjectNamespace;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  LLM_MODEL?: string;
  AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  PUBLIC_URL?: string;
}

export interface AgentRecord {
  id: string;
  orgId: string;
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
  callbackSecret: string | null;
  embedding: number[] | null;
  federatedCardUrl: string | null;
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
  orgId: string;
  requesterId: string;
  inviteeId: string;
  inviteeIds: string[];
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
  callbackUrl: string | null;
  callbackSecret: string | null;
  purpose: string | null;
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
  generatedBy: "template" | "llm" | "gemini";
}

export interface RoomSnapshot {
  id: string;
  orgId: string;
  meetingRequestId: string;
  status: RoomStatus;
  intent: string;
  body: string;
  maxRounds: number;
  roundCount: number;
  floorHolderId: string | null;
  pendingGate: "resolve" | "tool" | "vote" | null;
  members: RoomMember[];
  messages: RoomMessage[];
  artifacts: ArtifactRecord[];
  summary: JointSummary | null;
  votes: VoteRecord[];
  graph: GraphEdge[];
  createdAt: string;
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

export interface OrgRecord {
  id: string;
  name: string;
  plan: "free" | "pro";
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: string;
}

export interface UserRecord {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: "owner" | "member";
  createdAt: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  orgId: string;
  expiresAt: string;
}

export interface MemoryRecord {
  id: string;
  orgId: string;
  roomId: string | null;
  problem: string;
  artifact: Record<string, unknown> | null;
  tags: string[];
  embedding: number[] | null;
  narrative: string;
  createdAt: string;
}

export interface FederatedPeer {
  id: string;
  orgId: string;
  cardUrl: string;
  name: string;
  card: A2AAgentCard;
  lastFetched: string;
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
  purpose?: string;
  memories?: string[];
}

export type TwinAction =
  | { type: "chat"; body: string }
  | { type: "proposal"; body: string }
  | { type: "artifact"; body: string; payload: Record<string, unknown> }
  | { type: "handoff"; body: string; toId: string }
  | { type: "request_resolve"; body: string }
  | { type: "vote"; body: string; subject: "artifact" | "resolve"; decision: "approve" | "reject" };

export interface OpenRoomInput {
  roomId: string;
  orgId: string;
  meetingRequestId: string;
  intent: string;
  body: string;
  maxRounds: number;
  members: RoomMember[];
  floorHolderId: string;
  publicBase?: string;
  memories?: string[];
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
export const COMPLIANCE_ID = "compliance-twin";
export const CALLBACK_ID = "callback-twin";
export const DEMO_ORG_ID = "org_demo";
