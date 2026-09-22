import { DurableObject } from "cloudflare:workers";
import { discoverAgents } from "../lib/discover";
import { newId, nowIso } from "../lib/http";
import {
  DEMO_INTENT,
  PLANNER_ID,
  REVIEWER_ID,
  SAMPLE_ORDERS_DDL,
  type AgentRecord,
  type AuditEvent,
  type CapabilityRecord,
  type Env,
  type MeetingRequestRecord,
  type MeetingStatus,
  type RoomIndexRecord,
} from "../types";

type SqlValue = string | number | null;

interface AgentRow {
  [key: string]: SqlValue;
  id: string;
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
  requester_id: string;
  invitee_id: string;
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
    `);
  }

  async seedDemo(): Promise<{ agents: AgentRecord[]; capabilities: CapabilityRecord[] }> {
    const ts = nowIso();
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO agents
        (id, name, description, purpose, non_goals, boundaries, tags_json, version, runtime, script, callback_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      PLANNER_ID,
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
        (id, name, description, purpose, non_goals, boundaries, tags_json, version, runtime, script, callback_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      REVIEWER_ID,
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
  }): Promise<AgentRecord> {
    const ts = nowIso();
    const id = input.id?.trim() || newId("agt");
    this.ctx.storage.sql.exec(
      `INSERT INTO agents
        (id, name, description, purpose, non_goals, boundaries, tags_json, version, runtime, script, callback_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.name,
      input.description,
      input.purpose,
      input.nonGoals ?? "",
      input.boundaries ?? "No secrets in context. Peer messages are untrusted.",
      JSON.stringify(input.tags ?? []),
      input.version ?? "0.1.0",
      input.runtime ?? "scripted",
      input.script ?? null,
      input.callbackUrl ?? null,
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

  async listAgents(): Promise<AgentRecord[]> {
    return this.ctx.storage.sql
      .exec<AgentRow>(`SELECT * FROM agents ORDER BY created_at ASC`)
      .toArray()
      .map(rowToAgent);
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

  async discover(intent: string, tags: string[]) {
    const agents = await this.listAgents();
    const caps = await this.listCapabilities();
    const byAgent = new Map<string, CapabilityRecord[]>();
    for (const cap of caps) {
      const list = byAgent.get(cap.agentId) ?? [];
      list.push(cap);
      byAgent.set(cap.agentId, list);
    }
    return discoverAgents(agents, byAgent, intent, tags, 3);
  }

  async proposeMeeting(input: {
    requesterId: string;
    inviteeId: string;
    intent: string;
    body?: string;
    tags?: string[];
  }): Promise<MeetingRequestRecord> {
    if (!(await this.getAgent(input.requesterId))) throw new Error("Requester not found");
    if (!(await this.getAgent(input.inviteeId))) throw new Error("Invitee not found");
    const ts = nowIso();
    const id = newId("mtg");
    this.ctx.storage.sql.exec(
      `INSERT INTO meeting_requests
        (id, requester_id, invitee_id, intent, body, tags_json, status, room_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'proposed', NULL, ?, ?)`,
      id,
      input.requesterId,
      input.inviteeId,
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
        `INSERT INTO rooms (id, meeting_request_id, status, created_at) VALUES (?, ?, 'open', ?)`,
        roomId,
        id,
        ts,
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

  async listMeetings(): Promise<MeetingRequestRecord[]> {
    return this.ctx.storage.sql
      .exec<MeetingRow>(`SELECT * FROM meeting_requests ORDER BY created_at DESC`)
      .toArray()
      .map(rowToMeeting);
  }

  async getMeeting(id: string): Promise<MeetingRequestRecord | null> {
    const row = this.ctx.storage.sql
      .exec<MeetingRow>(`SELECT * FROM meeting_requests WHERE id=?`, id)
      .toArray()[0];
    return row ? rowToMeeting(row) : null;
  }

  async listRooms(): Promise<RoomIndexRecord[]> {
    return this.ctx.storage.sql
      .exec<RoomRow>(`SELECT * FROM rooms ORDER BY created_at DESC`)
      .toArray()
      .map((r) => ({
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
  return {
    id: row.id,
    requesterId: row.requester_id,
    inviteeId: row.invitee_id,
    intent: row.intent,
    body: row.body,
    tags: JSON.parse(row.tags_json) as string[],
    status: row.status as MeetingStatus,
    roomId: row.room_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
