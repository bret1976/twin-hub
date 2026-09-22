import { DurableObject } from "cloudflare:workers";
import { newId, nowIso } from "../lib/http";
import { hashPassword, verifyPassword } from "../lib/auth";
import {
  CALLBACK_ID,
  COMPLIANCE_ID,
  DEMO_INTENT,
  DEMO_ORG_ID,
  PLANNER_ID,
  REVIEWER_ID,
  SAMPLE_ORDERS_DDL,
  type A2AAgentCard,
  type AgentRecord,
  type AuditEvent,
  type CapabilityRecord,
  type Env,
  type FederatedPeer,
  type MeetingRequestRecord,
  type MeetingStatus,
  type MemoryRecord,
  type OrgRecord,
  type RoomIndexRecord,
  type SessionRecord,
  type UserRecord,
} from "../types";

type SqlValue = string | number | null;

interface AgentRow {
  [key: string]: SqlValue;
  id: string;
  org_id: string | null;
  name: string;
  description: string;
  purpose: string;
  non_goals: string;
  boundaries: string;
  tags_json: string;
  version: string;
  runtime: string;
  script: string | null;
  callback_url: string | null;
  callback_secret: string | null;
  embedding_json: string | null;
  federated_card_url: string | null;
  created_at: string;
  updated_at: string;
}

interface CapRow {
  [key: string]: SqlValue;
  id: string;
  agent_id: string;
  skill_id: string;
  name: string;
  description: string;
  tags_json: string;
  examples_json: string;
  created_at: string;
}

interface MeetingRow {
  [key: string]: SqlValue;
  id: string;
  org_id: string | null;
  requester_id: string;
  invitee_id: string;
  invitee_ids_json: string | null;
  intent: string;
  body: string;
  tags_json: string;
  status: string;
  room_id: string | null;
  created_at: string;
  updated_at: string;
}

interface RoomRow {
  [key: string]: SqlValue;
  id: string;
  meeting_request_id: string;
  status: string;
  created_at: string;
}

interface AuditRow {
  [key: string]: SqlValue;
  id: string;
  room_id: string | null;
  meeting_request_id: string | null;
  type: string;
  actor_id: string | null;
  payload_json: string;
  created_at: string;
}

export class Registry extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        purpose TEXT NOT NULL,
        non_goals TEXT NOT NULL,
        boundaries TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        version TEXT NOT NULL,
        runtime TEXT NOT NULL,
        script TEXT,
        callback_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS capabilities (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        examples_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meeting_requests (
        id TEXT PRIMARY KEY,
        requester_id TEXT NOT NULL,
        invitee_id TEXT NOT NULL,
        intent TEXT NOT NULL,
        body TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        status TEXT NOT NULL,
        room_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        meeting_request_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        room_id TEXT,
        meeting_request_id TEXT,
        type TEXT NOT NULL,
        actor_id TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS orgs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        plan TEXT NOT NULL,
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        org_id TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        room_id TEXT,
        problem TEXT NOT NULL,
        artifact_json TEXT,
        tags_json TEXT NOT NULL,
        embedding_json TEXT,
        narrative TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS peers (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        card_url TEXT NOT NULL,
        name TEXT NOT NULL,
        card_json TEXT NOT NULL,
        last_fetched TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_states (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS a2a_tasks (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        agent_id TEXT,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    this.ensureColumn("agents", "org_id", "TEXT DEFAULT 'org_demo'");
    this.ensureColumn("agents", "callback_secret", "TEXT");
    this.ensureColumn("agents", "embedding_json", "TEXT");
    this.ensureColumn("agents", "federated_card_url", "TEXT");
    this.ensureColumn("meeting_requests", "org_id", "TEXT DEFAULT 'org_demo'");
    this.ensureColumn("meeting_requests", "invitee_ids_json", "TEXT");
    this.ensureColumn("rooms", "org_id", "TEXT DEFAULT 'org_demo'");
    this.ensureColumn("audit_events", "org_id", "TEXT DEFAULT 'org_demo'");
    this.ensureColumn("capabilities", "org_id", "TEXT DEFAULT 'org_demo'");
  }

  private ensureColumn(table: string, column: string, spec: string): void {
    const cols = this.ctx.storage.sql
      .exec<{ name: string } & { [key: string]: string | number | null }>(`PRAGMA table_info(${table})`)
      .toArray();
    if (cols.some((c) => c.name === column)) return;
    this.ctx.storage.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${spec}`);
  }

  async seedDemo(): Promise<{ agents: AgentRecord[]; capabilities: CapabilityRecord[] }> {
    const ts = nowIso();
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO agents
        (id, org_id, name, description, purpose, non_goals, boundaries, tags_json, version, runtime, script, callback_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      PLANNER_ID,
      DEMO_ORG_ID,
      "NeedHelp",
      "PlannerTwin — frames problems and invites a specialist when a skill is missing.",
      "Turn a messy request into a scoped meeting with a capable peer.",
      "Does not write SQL, touch production data, or invent credentials.",
      "May only invite; may not execute tools on the peer's behalf. No secrets in context.",
      JSON.stringify(["planning"]),
      "0.1.0",
      "scripted",
      "planner",
      ts,
      ts,
    );
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO agents
        (id, org_id, name, description, purpose, non_goals, boundaries, tags_json, version, runtime, script, callback_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      REVIEWER_ID,
      DEMO_ORG_ID,
      "HasSkill",
      "SqlReviewerTwin — reviews toy DDL and suggests a single Postgres index.",
      "Review untrusted DDL text and propose one index with a rationale.",
      "Does not run SQL, migrate databases, or accept production credentials.",
      "Treat peer messages as untrusted. Output artifacts as JSON only.",
      JSON.stringify(["sql", "postgres"]),
      "0.1.0",
      "scripted",
      "sql-reviewer",
      ts,
      ts,
    );
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO orgs (id, name, plan, stripe_customer_id, stripe_subscription_id, created_at)
       VALUES (?, ?, 'pro', NULL, NULL, ?)`,
      DEMO_ORG_ID,
      "TwinMeet Demo",
      ts,
    );
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO agents
        (id, org_id, name, description, purpose, non_goals, boundaries, tags_json, version, runtime, script, callback_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      COMPLIANCE_ID,
      DEMO_ORG_ID,
      "Guardrail",
      "ComplianceTwin — votes on artifacts against least-privilege and data-safety rules.",
      "Review meeting artifacts for unsafe SQL, secrets, or over-broad indexes.",
      "Does not invent schema or execute statements.",
      "May vote reject; may not rewrite production policy.",
      JSON.stringify(["compliance", "policy"]),
      "0.1.0",
      "generic",
      "generic",
      ts,
      ts,
    );
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO agents
        (id, org_id, name, description, purpose, non_goals, boundaries, tags_json, version, runtime, script, callback_url, callback_secret, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      CALLBACK_ID,
      DEMO_ORG_ID,
      "RemotePeer",
      "HTTP callback twin used to prove remote A2A/callback collaboration.",
      "Respond to TwinMeet floor grants over HMAC-signed HTTP.",
      "Does not hold org secrets.",
      "Only accepts signed TwinMeet callbacks.",
      JSON.stringify(["remote", "http", "federation"]),
      "0.1.0",
      "http",
      null,
      "/v1/hooks/echo-twin",
      "callback-demo-secret",
      ts,
      ts,
    );

    this.upsertCapability({
      id: "cap_plan_scope",
      agentId: PLANNER_ID,
      skillId: "scope-meeting",
      name: "Scope a meeting",
      description: "State intent, attach working material, and invite a peer who has the missing skill.",
      tags: ["planning"],
      examples: [DEMO_INTENT],
    });
    this.upsertCapability({
      id: "cap_compliance_vote",
      agentId: COMPLIANCE_ID,
      skillId: "artifact-vote",
      name: "Vote on artifacts",
      description: "Approve or reject a proposed artifact against safety policy.",
      tags: ["compliance", "policy"],
      examples: ["Reject indexes that include PII columns without need."],
    });
    this.upsertCapability({
      id: "cap_http_callback",
      agentId: CALLBACK_ID,
      skillId: "http-callback",
      name: "Remote floor response",
      description: "Answer a signed TwinMeet callback with chat or vote actions.",
      tags: ["remote", "http"],
      examples: ["HMAC callback from a room floor grant."],
    });
    const demoHash = await hashPassword("demo-pass");
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO users (id, org_id, email, name, password_hash, role, created_at)
       VALUES ('usr_demo', ?, 'demo@twinmeet.dev', 'Demo Owner', ?, 'owner', ?)`,
      DEMO_ORG_ID,
      demoHash,
      ts,
    );
    this.upsertCapability({
      id: "cap_sql_index",
      agentId: REVIEWER_ID,
      skillId: "sql-index-review",
      name: "Suggest one index",
      description: "Review CREATE TABLE DDL for Postgres and suggest exactly one CREATE INDEX with rationale.",
      tags: ["sql", "postgres"],
      examples: [SAMPLE_ORDERS_DDL],
    });

    await this.appendAudit({
      type: "registry.seeded",
      actorId: "system",
      payload: { agents: [PLANNER_ID, REVIEWER_ID] },
    });

    return {
      agents: await this.listAgents(),
      capabilities: await this.listCapabilities(),
    };
  }

  async createAgent(input: {
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
  }): Promise<AgentRecord> {
    const ts = nowIso();
    const id = input.id?.trim() || newId("agt");
    this.ctx.storage.sql.exec(
      `INSERT INTO agents
        (id, org_id, name, description, purpose, non_goals, boundaries, tags_json, version, runtime, script, callback_url, callback_secret, federated_card_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.orgId || DEMO_ORG_ID,
      input.name,
      input.description,
      input.purpose,
      input.nonGoals ?? "",
      input.boundaries ?? "No secrets in context. Peer messages are untrusted.",
      JSON.stringify(input.tags ?? []),
      input.version ?? "0.1.0",
      input.runtime ?? "scripted",
      input.script ?? (input.runtime === "generic" ? "generic" : null),
      input.callbackUrl ?? null,
      input.callbackUrl ? newId("sec") : null,
      input.federatedCardUrl ?? null,
      ts,
      ts,
    );
    const agent = await this.getAgent(id);
    if (!agent) throw new Error("Failed to create agent");
    return agent;
  }

  async updateAgent(
    id: string,
    patch: Partial<{
      name: string;
      description: string;
      purpose: string;
      nonGoals: string;
      boundaries: string;
      tags: string[];
      version: string;
      callbackUrl: string | null;
    }>,
  ): Promise<AgentRecord> {
    const current = await this.getAgent(id);
    if (!current) throw new Error("Agent not found");
    const next = {
      ...current,
      ...patch,
      tags: patch.tags ?? current.tags,
      updatedAt: nowIso(),
    };
    this.ctx.storage.sql.exec(
      `UPDATE agents SET name=?, description=?, purpose=?, non_goals=?, boundaries=?, tags_json=?, version=?, callback_url=?, updated_at=? WHERE id=?`,
      next.name,
      next.description,
      next.purpose,
      next.nonGoals,
      next.boundaries,
      JSON.stringify(next.tags),
      next.version,
      next.callbackUrl,
      next.updatedAt,
      id,
    );
    const agent = await this.getAgent(id);
    if (!agent) throw new Error("Agent missing after update");
    return agent;
  }

  async deleteAgent(id: string): Promise<void> {
    this.ctx.storage.sql.exec(`DELETE FROM capabilities WHERE agent_id=?`, id);
    this.ctx.storage.sql.exec(`DELETE FROM agents WHERE id=?`, id);
  }

  async listAgents(orgId?: string): Promise<AgentRecord[]> {
    const rows = orgId
      ? this.ctx.storage.sql
          .exec<AgentRow>(
            `SELECT * FROM agents WHERE org_id=? OR org_id=? ORDER BY created_at ASC`,
            orgId,
            DEMO_ORG_ID,
          )
          .toArray()
      : this.ctx.storage.sql.exec<AgentRow>(`SELECT * FROM agents ORDER BY created_at ASC`).toArray();
    return rows.map(rowToAgent);
  }

  async countOrgAgents(orgId: string): Promise<number> {
    const row = this.ctx.storage.sql
      .exec<{ n: number } & { [key: string]: SqlValue }>(`SELECT COUNT(*) as n FROM agents WHERE org_id=?`, orgId)
      .toArray()[0];
    return Number(row?.n ?? 0);
  }

  async countOpenRooms(orgId: string): Promise<number> {
    const row = this.ctx.storage.sql
      .exec<{ n: number } & { [key: string]: SqlValue }>(
        `SELECT COUNT(*) as n FROM rooms WHERE org_id=? AND status IN ('open','paused')`,
        orgId,
      )
      .toArray()[0];
    return Number(row?.n ?? 0);
  }

  async getAgent(id: string): Promise<AgentRecord | null> {
    const row = this.ctx.storage.sql
      .exec<AgentRow>(`SELECT * FROM agents WHERE id=?`, id)
      .toArray()[0];
    return row ? rowToAgent(row) : null;
  }

  async listCapabilities(agentId?: string): Promise<CapabilityRecord[]> {
    const rows = agentId
      ? this.ctx.storage.sql
          .exec<CapRow>(`SELECT * FROM capabilities WHERE agent_id=? ORDER BY created_at ASC`, agentId)
          .toArray()
      : this.ctx.storage.sql
          .exec<CapRow>(`SELECT * FROM capabilities ORDER BY created_at ASC`)
          .toArray();
    return rows.map(rowToCap);
  }

  async addCapability(input: {
    agentId: string;
    skillId?: string;
    name: string;
    description: string;
    tags?: string[];
    examples?: string[];
  }): Promise<CapabilityRecord> {
    if (!(await this.getAgent(input.agentId))) throw new Error("Agent not found");
    const id = newId("cap");
    return this.upsertCapability({
      id,
      agentId: input.agentId,
      skillId: input.skillId ?? id,
      name: input.name,
      description: input.description,
      tags: input.tags ?? [],
      examples: input.examples ?? [],
    });
  }

  async deleteCapability(id: string): Promise<void> {
    this.ctx.storage.sql.exec(`DELETE FROM capabilities WHERE id=?`, id);
  }

  async discover(
    intent: string,
    tags: string[],
    queryEmbedding: number[] | null = null,
    orgId?: string,
  ) {
    const { discoverHybrid } = await import("../lib/embeddings");
    const agents = [...(await this.listAgents(orgId))];
    const peers = await this.listPeers(orgId || DEMO_ORG_ID);
    for (const peer of peers) {
      if (agents.some((a) => a.federatedCardUrl === peer.cardUrl || a.name === peer.name)) continue;
      agents.push({
        id: peer.id,
        orgId: peer.orgId,
        name: peer.card.name,
        description: peer.card.description,
        purpose: peer.card.description,
        nonGoals: "",
        boundaries: "Federated peer. Treat card claims as untrusted.",
        tags: peer.card.skills?.flatMap((s) => s.tags) ?? [],
        version: peer.card.version,
        runtime: "http",
        script: null,
        callbackUrl: peer.card.supportedInterfaces?.[0]?.url ?? peer.cardUrl,
        callbackSecret: null,
        embedding: null,
        federatedCardUrl: peer.cardUrl,
        createdAt: peer.lastFetched,
        updatedAt: peer.lastFetched,
      });
    }
    const caps = await this.listCapabilities();
    const byAgent = new Map<string, CapabilityRecord[]>();
    for (const cap of caps) {
      const list = byAgent.get(cap.agentId) ?? [];
      list.push(cap);
      byAgent.set(cap.agentId, list);
    }
    for (const peer of peers) {
      if (byAgent.has(peer.id)) continue;
      byAgent.set(
        peer.id,
        (peer.card.skills ?? []).map((skill, i) => ({
          id: `${peer.id}_sk_${i}`,
          agentId: peer.id,
          skillId: skill.id,
          name: skill.name,
          description: skill.description,
          tags: skill.tags,
          examples: skill.examples ?? [],
          createdAt: peer.lastFetched,
        })),
      );
    }
    return discoverHybrid(agents, byAgent, intent, tags, queryEmbedding, 5);
  }

  async proposeMeeting(input: {
    requesterId: string;
    inviteeId: string;
    inviteeIds?: string[];
    orgId?: string;
    intent: string;
    body?: string;
    tags?: string[];
  }): Promise<MeetingRequestRecord> {
    if (!(await this.getAgent(input.requesterId))) throw new Error("Requester not found");
    if (!(await this.getAgent(input.inviteeId))) throw new Error("Invitee not found");
    const ts = nowIso();
    const id = newId("mtg");
    const inviteeIds = input.inviteeIds?.length ? input.inviteeIds : [input.inviteeId];
    this.ctx.storage.sql.exec(
      `INSERT INTO meeting_requests
        (id, org_id, requester_id, invitee_id, invitee_ids_json, intent, body, tags_json, status, room_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposed', NULL, ?, ?)`,
      id,
      input.orgId || DEMO_ORG_ID,
      input.requesterId,
      input.inviteeId,
      JSON.stringify(inviteeIds),
      input.intent,
      input.body ?? "",
      JSON.stringify(input.tags ?? []),
      ts,
      ts,
    );
    await this.appendAudit({
      type: "meeting.requested",
      actorId: input.requesterId,
      meetingRequestId: id,
      payload: {
        requesterId: input.requesterId,
        inviteeId: input.inviteeId,
        intent: input.intent,
      },
    });
    const rec = await this.getMeeting(id);
    if (!rec) throw new Error("Failed to create meeting request");
    return rec;
  }

  async decideMeeting(
    id: string,
    decision: "accepted" | "declined",
    actorId?: string,
  ): Promise<MeetingRequestRecord> {
    const current = await this.getMeeting(id);
    if (!current) throw new Error("Meeting request not found");
    if (current.status !== "proposed") throw new Error(`Meeting already ${current.status}`);
    const ts = nowIso();
    const roomId = decision === "accepted" ? newId("room") : null;
    this.ctx.storage.sql.exec(
      `UPDATE meeting_requests SET status=?, room_id=?, updated_at=? WHERE id=?`,
      decision,
      roomId,
      ts,
      id,
    );
    if (roomId) {
      this.ctx.storage.sql.exec(
        `INSERT INTO rooms (id, meeting_request_id, status, created_at, org_id) VALUES (?, ?, 'open', ?, ?)`,
        roomId,
        id,
        ts,
        current.orgId || DEMO_ORG_ID,
      );
    }
    await this.appendAudit({
      type: decision === "accepted" ? "meeting.accepted" : "meeting.declined",
      actorId: actorId ?? current.inviteeId,
      meetingRequestId: id,
      roomId,
      payload: { decision, roomId },
    });
    const rec = await this.getMeeting(id);
    if (!rec) throw new Error("Meeting missing after decide");
    return rec;
  }

  async updateRoomStatus(roomId: string, status: string): Promise<void> {
    this.ctx.storage.sql.exec(`UPDATE rooms SET status=? WHERE id=?`, status, roomId);
  }

  async listMeetings(orgId?: string): Promise<MeetingRequestRecord[]> {
    const rows = orgId
      ? this.ctx.storage.sql
          .exec<MeetingRow>(`SELECT * FROM meeting_requests WHERE org_id=? ORDER BY created_at DESC`, orgId)
          .toArray()
      : this.ctx.storage.sql.exec<MeetingRow>(`SELECT * FROM meeting_requests ORDER BY created_at DESC`).toArray();
    return rows.map(rowToMeeting);
  }

  async getMeeting(id: string): Promise<MeetingRequestRecord | null> {
    const row = this.ctx.storage.sql
      .exec<MeetingRow>(`SELECT * FROM meeting_requests WHERE id=?`, id)
      .toArray()[0];
    return row ? rowToMeeting(row) : null;
  }

  async listRooms(orgId?: string): Promise<RoomIndexRecord[]> {
    const rows = orgId
      ? this.ctx.storage.sql
          .exec<RoomRow>(`SELECT * FROM rooms WHERE org_id=? ORDER BY created_at DESC`, orgId)
          .toArray()
      : this.ctx.storage.sql.exec<RoomRow>(`SELECT * FROM rooms ORDER BY created_at DESC`).toArray();
    return rows.map((r) => ({
      id: r.id,
      meetingRequestId: r.meeting_request_id,
      status: r.status as RoomIndexRecord["status"],
      createdAt: r.created_at,
    }));
  }

  async appendAudit(input: {
    type: string;
    actorId?: string | null;
    payload?: unknown;
    roomId?: string | null;
    meetingRequestId?: string | null;
  }): Promise<AuditEvent> {
    const event: AuditEvent = {
      id: newId("aud"),
      roomId: input.roomId ?? null,
      meetingRequestId: input.meetingRequestId ?? null,
      type: input.type,
      actorId: input.actorId ?? null,
      payload: input.payload ?? {},
      createdAt: nowIso(),
    };
    this.ctx.storage.sql.exec(
      `INSERT INTO audit_events (id, room_id, meeting_request_id, type, actor_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      event.id,
      event.roomId,
      event.meetingRequestId,
      event.type,
      event.actorId,
      JSON.stringify(event.payload),
      event.createdAt,
    );
    return event;
  }

  async listAudit(filter?: { roomId?: string; meetingRequestId?: string }): Promise<AuditEvent[]> {
    let rows: AuditRow[];
    if (filter?.roomId) {
      rows = this.ctx.storage.sql
        .exec<AuditRow>(
          `SELECT * FROM audit_events
           WHERE room_id = ?
              OR meeting_request_id = (SELECT meeting_request_id FROM rooms WHERE id = ?)
           ORDER BY created_at ASC`,
          filter.roomId,
          filter.roomId,
        )
        .toArray();
    } else if (filter?.meetingRequestId) {
      rows = this.ctx.storage.sql
        .exec<AuditRow>(
          `SELECT * FROM audit_events WHERE meeting_request_id=? ORDER BY created_at ASC`,
          filter.meetingRequestId,
        )
        .toArray();
    } else {
      rows = this.ctx.storage.sql
        .exec<AuditRow>(`SELECT * FROM audit_events ORDER BY created_at ASC`)
        .toArray();
    }
    return rows.map((r) => ({
      id: r.id,
      roomId: r.room_id,
      meetingRequestId: r.meeting_request_id,
      type: r.type,
      actorId: r.actor_id,
      payload: JSON.parse(r.payload_json) as unknown,
      createdAt: r.created_at,
    }));
  }

  async registerUser(input: {
    email: string;
    name: string;
    password: string;
    orgName?: string;
  }): Promise<{ user: UserRecord; org: OrgRecord; session: SessionRecord }> {
    const existing = this.ctx.storage.sql
      .exec<{ id: string } & { [key: string]: SqlValue }>(`SELECT id FROM users WHERE email=?`, input.email.toLowerCase())
      .toArray()[0];
    if (existing) throw new Error("Email already registered");
    const ts = nowIso();
    const orgId = newId("org");
    const userId = newId("usr");
    const sessionId = newId("ses");
    this.ctx.storage.sql.exec(
      `INSERT INTO orgs (id, name, plan, stripe_customer_id, stripe_subscription_id, created_at) VALUES (?, ?, 'free', NULL, NULL, ?)`,
      orgId,
      input.orgName || `${input.name}'s workspace`,
      ts,
    );
    this.ctx.storage.sql.exec(
      `INSERT INTO users (id, org_id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, 'owner', ?)`,
      userId,
      orgId,
      input.email.toLowerCase(),
      input.name,
      await hashPassword(input.password),
      ts,
    );
    const expires = new Date(Date.now() + 14 * 86400000).toISOString();
    this.ctx.storage.sql.exec(
      `INSERT INTO sessions (id, user_id, org_id, expires_at) VALUES (?, ?, ?, ?)`,
      sessionId,
      userId,
      orgId,
      expires,
    );
    return {
      user: { id: userId, orgId, email: input.email.toLowerCase(), name: input.name, role: "owner", createdAt: ts },
      org: { id: orgId, name: input.orgName || `${input.name}'s workspace`, plan: "free", stripeCustomerId: null, stripeSubscriptionId: null, createdAt: ts },
      session: { id: sessionId, userId, orgId, expiresAt: expires },
    };
  }

  async login(email: string, password: string): Promise<{ user: UserRecord; org: OrgRecord; session: SessionRecord }> {
    const row = this.ctx.storage.sql
      .exec<{ id: string; org_id: string; email: string; name: string; password_hash: string; role: string; created_at: string } & { [key: string]: SqlValue }>(
        `SELECT * FROM users WHERE email=?`,
        email.toLowerCase(),
      )
      .toArray()[0];
    if (!row || !(await verifyPassword(password, row.password_hash))) throw new Error("Invalid credentials");
    const org = await this.getOrg(row.org_id);
    if (!org) throw new Error("Org not found");
    const sessionId = newId("ses");
    const expires = new Date(Date.now() + 14 * 86400000).toISOString();
    this.ctx.storage.sql.exec(
      `INSERT INTO sessions (id, user_id, org_id, expires_at) VALUES (?, ?, ?, ?)`,
      sessionId,
      row.id,
      row.org_id,
      expires,
    );
    return {
      user: { id: row.id, orgId: row.org_id, email: row.email, name: row.name, role: row.role as UserRecord["role"], createdAt: row.created_at },
      org,
      session: { id: sessionId, userId: row.id, orgId: row.org_id, expiresAt: expires },
    };
  }

  async loginDemo(): Promise<{ user: UserRecord; org: OrgRecord; session: SessionRecord }> {
    await this.seedDemo();
    return this.login("demo@twinmeet.dev", "demo-pass");
  }

  async getSession(sessionId: string): Promise<{ user: UserRecord; org: OrgRecord } | null> {
    const row = this.ctx.storage.sql
      .exec<{ user_id: string; org_id: string; expires_at: string } & { [key: string]: SqlValue }>(
        `SELECT * FROM sessions WHERE id=?`,
        sessionId,
      )
      .toArray()[0];
    if (!row || row.expires_at < nowIso()) return null;
    const user = this.ctx.storage.sql
      .exec<{ id: string; org_id: string; email: string; name: string; role: string; created_at: string } & { [key: string]: SqlValue }>(
        `SELECT * FROM users WHERE id=?`,
        row.user_id,
      )
      .toArray()[0];
    const org = await this.getOrg(row.org_id);
    if (!user || !org) return null;
    return {
      user: { id: user.id, orgId: user.org_id, email: user.email, name: user.name, role: user.role as UserRecord["role"], createdAt: user.created_at },
      org,
    };
  }

  async getOrg(id: string): Promise<OrgRecord | null> {
    const row = this.ctx.storage.sql
      .exec<{ id: string; name: string; plan: string; stripe_customer_id: string | null; stripe_subscription_id: string | null; created_at: string } & { [key: string]: SqlValue }>(
        `SELECT * FROM orgs WHERE id=?`,
        id,
      )
      .toArray()[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      plan: row.plan as OrgRecord["plan"],
      stripeCustomerId: row.stripe_customer_id,
      stripeSubscriptionId: row.stripe_subscription_id,
      createdAt: row.created_at,
    };
  }

  async setOrgPlan(orgId: string, plan: "free" | "pro", stripe?: { customerId?: string; subscriptionId?: string }): Promise<OrgRecord> {
    this.ctx.storage.sql.exec(
      `UPDATE orgs SET plan=?, stripe_customer_id=COALESCE(?, stripe_customer_id), stripe_subscription_id=COALESCE(?, stripe_subscription_id) WHERE id=?`,
      plan,
      stripe?.customerId ?? null,
      stripe?.subscriptionId ?? null,
      orgId,
    );
    const org = await this.getOrg(orgId);
    if (!org) throw new Error("Org not found");
    return org;
  }

  async addMemory(input: Omit<MemoryRecord, "id" | "createdAt">): Promise<MemoryRecord> {
    const rec: MemoryRecord = { ...input, id: newId("mem"), createdAt: nowIso() };
    this.ctx.storage.sql.exec(
      `INSERT INTO memories (id, org_id, room_id, problem, artifact_json, tags_json, embedding_json, narrative, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      rec.id,
      rec.orgId,
      rec.roomId,
      rec.problem,
      rec.artifact ? JSON.stringify(rec.artifact) : null,
      JSON.stringify(rec.tags),
      rec.embedding ? JSON.stringify(rec.embedding) : null,
      rec.narrative,
      rec.createdAt,
    );
    return rec;
  }

  async listMemory(orgId: string, queryEmbedding?: number[] | null): Promise<MemoryRecord[]> {
    const rows = this.ctx.storage.sql
      .exec<{ id: string; org_id: string; room_id: string | null; problem: string; artifact_json: string | null; tags_json: string; embedding_json: string | null; narrative: string; created_at: string } & { [key: string]: SqlValue }>(
        `SELECT * FROM memories WHERE org_id=? ORDER BY created_at DESC`,
        orgId,
      )
      .toArray()
      .map((r) => ({
        id: r.id,
        orgId: r.org_id,
        roomId: r.room_id,
        problem: r.problem,
        artifact: r.artifact_json ? (JSON.parse(r.artifact_json) as Record<string, unknown>) : null,
        tags: JSON.parse(r.tags_json) as string[],
        embedding: r.embedding_json ? (JSON.parse(r.embedding_json) as number[]) : null,
        narrative: r.narrative,
        createdAt: r.created_at,
      }));
    if (!queryEmbedding) return rows.slice(0, 20);
    const { cosine } = await import("../lib/embeddings");
    return rows
      .map((m) => ({ m, s: m.embedding ? cosine(queryEmbedding, m.embedding) : 0 }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.m)
      .slice(0, 12);
  }

  async upsertPeer(orgId: string, cardUrl: string, card: A2AAgentCard): Promise<FederatedPeer> {
    const ts = nowIso();
    const existing = this.ctx.storage.sql
      .exec<{ id: string } & { [key: string]: SqlValue }>(
        `SELECT id FROM peers WHERE org_id=? AND card_url=?`,
        orgId,
        cardUrl,
      )
      .toArray()[0];
    if (existing) {
      this.ctx.storage.sql.exec(
        `UPDATE peers SET name=?, card_json=?, last_fetched=? WHERE id=?`,
        card.name,
        JSON.stringify(card),
        ts,
        existing.id,
      );
      return { id: existing.id, orgId, cardUrl, name: card.name, card, lastFetched: ts };
    }
    const id = newId("peer");
    this.ctx.storage.sql.exec(
      `INSERT INTO peers (id, org_id, card_url, name, card_json, last_fetched) VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      orgId,
      cardUrl,
      card.name,
      JSON.stringify(card),
      ts,
    );
    return { id, orgId, cardUrl, name: card.name, card, lastFetched: ts };
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.ctx.storage.sql.exec(`DELETE FROM sessions WHERE id=?`, sessionId);
  }

  async loginOrRegisterOidc(
    email: string,
    name: string,
  ): Promise<{ user: UserRecord; org: OrgRecord; session: SessionRecord }> {
    const existing = this.ctx.storage.sql
      .exec<{ email: string } & { [key: string]: SqlValue }>(`SELECT email FROM users WHERE email=?`, email.toLowerCase())
      .toArray()[0];
    if (existing) return this.loginWithoutPassword(email);
    const password = newId("oidc");
    return this.registerUser({ email, name: name || email.split("@")[0], password });
  }

  async loginWithoutPassword(email: string): Promise<{ user: UserRecord; org: OrgRecord; session: SessionRecord }> {
    const row = this.ctx.storage.sql
      .exec<{ id: string; org_id: string; email: string; name: string; role: string; created_at: string } & { [key: string]: SqlValue }>(
        `SELECT * FROM users WHERE email=?`,
        email.toLowerCase(),
      )
      .toArray()[0];
    if (!row) throw new Error("User not found");
    const org = await this.getOrg(row.org_id);
    if (!org) throw new Error("Org not found");
    const sessionId = newId("ses");
    const expires = new Date(Date.now() + 14 * 86400000).toISOString();
    this.ctx.storage.sql.exec(
      `INSERT INTO sessions (id, user_id, org_id, expires_at) VALUES (?, ?, ?, ?)`,
      sessionId,
      row.id,
      row.org_id,
      expires,
    );
    return {
      user: {
        id: row.id,
        orgId: row.org_id,
        email: row.email,
        name: row.name,
        role: row.role as UserRecord["role"],
        createdAt: row.created_at,
      },
      org,
      session: { id: sessionId, userId: row.id, orgId: row.org_id, expiresAt: expires },
    };
  }

  async listPeers(orgId: string): Promise<FederatedPeer[]> {
    return this.ctx.storage.sql
      .exec<{ id: string; org_id: string; card_url: string; name: string; card_json: string; last_fetched: string } & { [key: string]: SqlValue }>(
        `SELECT * FROM peers WHERE org_id=? ORDER BY last_fetched DESC`,
        orgId,
      )
      .toArray()
      .map((r) => ({
        id: r.id,
        orgId: r.org_id,
        cardUrl: r.card_url,
        name: r.name,
        card: JSON.parse(r.card_json) as A2AAgentCard,
        lastFetched: r.last_fetched,
      }));
  }

  async saveTask(orgId: string, agentId: string | null, payload: unknown): Promise<string> {
    const id = newId("task");
    this.ctx.storage.sql.exec(
      `INSERT INTO a2a_tasks (id, org_id, agent_id, status, payload_json, created_at) VALUES (?, ?, ?, 'submitted', ?, ?)`,
      id,
      orgId,
      agentId,
      JSON.stringify(payload),
      nowIso(),
    );
    return id;
  }

  async getTask(id: string): Promise<{ id: string; status: string; payload: unknown } | null> {
    const row = this.ctx.storage.sql
      .exec<{ id: string; status: string; payload_json: string } & { [key: string]: SqlValue }>(
        `SELECT * FROM a2a_tasks WHERE id=?`,
        id,
      )
      .toArray()[0];
    if (!row) return null;
    return { id: row.id, status: row.status, payload: JSON.parse(row.payload_json) };
  }

  async listTasks(orgId: string) {
    return this.ctx.storage.sql
      .exec<{ id: string; status: string; payload_json: string; created_at: string } & { [key: string]: SqlValue }>(
        `SELECT * FROM a2a_tasks WHERE org_id=? ORDER BY created_at DESC`,
        orgId,
      )
      .toArray()
      .map((r) => ({ id: r.id, status: r.status, payload: JSON.parse(r.payload_json), createdAt: r.created_at }));
  }

  async setAgentEmbedding(id: string, embedding: number[]): Promise<void> {
    this.ctx.storage.sql.exec(`UPDATE agents SET embedding_json=? WHERE id=?`, JSON.stringify(embedding), id);
  }

  async updateTask(id: string, status: string, payload?: unknown): Promise<void> {
    if (payload === undefined) {
      this.ctx.storage.sql.exec(`UPDATE a2a_tasks SET status=? WHERE id=?`, status, id);
      return;
    }
    this.ctx.storage.sql.exec(
      `UPDATE a2a_tasks SET status=?, payload_json=? WHERE id=?`,
      status,
      JSON.stringify(payload),
      id,
    );
  }

  async saveOauthState(state: string): Promise<void> {
    this.ctx.storage.sql.exec(`INSERT INTO oauth_states (id, created_at) VALUES (?, ?)`, state, nowIso());
  }

  async consumeOauthState(state: string): Promise<boolean> {
    if (!state) return false;
    const row = this.ctx.storage.sql
      .exec<{ id: string; created_at: string } & { [key: string]: SqlValue }>(`SELECT * FROM oauth_states WHERE id=?`, state)
      .toArray()[0];
    if (!row) return false;
    this.ctx.storage.sql.exec(`DELETE FROM oauth_states WHERE id=?`, state);
    const age = Date.now() - Date.parse(row.created_at);
    return Number.isFinite(age) && age < 15 * 60 * 1000;
  }

  private upsertCapability(input: {
    id: string;
    agentId: string;
    skillId: string;
    name: string;
    description: string;
    tags: string[];
    examples: string[];
  }): CapabilityRecord {
    const ts = nowIso();
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO capabilities
        (id, agent_id, skill_id, name, description, tags_json, examples_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      input.id,
      input.agentId,
      input.skillId,
      input.name,
      input.description,
      JSON.stringify(input.tags),
      JSON.stringify(input.examples),
      ts,
    );
    return {
      id: input.id,
      agentId: input.agentId,
      skillId: input.skillId,
      name: input.name,
      description: input.description,
      tags: input.tags,
      examples: input.examples,
      createdAt: ts,
    };
  }
}

function rowToAgent(row: AgentRow): AgentRecord {
  return {
    id: row.id,
    orgId: row.org_id || "org_demo",
    name: row.name,
    description: row.description,
    purpose: row.purpose,
    nonGoals: row.non_goals,
    boundaries: row.boundaries,
    tags: JSON.parse(row.tags_json) as string[],
    version: row.version,
    runtime: row.runtime as AgentRecord["runtime"],
    script: (row.script as AgentRecord["script"]) ?? null,
    callbackUrl: row.callback_url,
    callbackSecret: row.callback_secret,
    embedding: row.embedding_json ? (JSON.parse(row.embedding_json) as number[]) : null,
    federatedCardUrl: row.federated_card_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToCap(row: CapRow): CapabilityRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    skillId: row.skill_id,
    name: row.name,
    description: row.description,
    tags: JSON.parse(row.tags_json) as string[],
    examples: JSON.parse(row.examples_json) as string[],
    createdAt: row.created_at,
  };
}

function rowToMeeting(row: MeetingRow): MeetingRequestRecord {
  const inviteeIds = row.invitee_ids_json
    ? (JSON.parse(row.invitee_ids_json) as string[])
    : [row.invitee_id];
  return {
    id: row.id,
    orgId: row.org_id || "org_demo",
    requesterId: row.requester_id,
    inviteeId: row.invitee_id,
    inviteeIds,
    intent: row.intent,
    body: row.body,
    tags: JSON.parse(row.tags_json) as string[],
    status: row.status as MeetingStatus,
    roomId: row.room_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
