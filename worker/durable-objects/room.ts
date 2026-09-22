import { DurableObject } from "cloudflare:workers";
import { newId, nowIso } from "../lib/http";
import { sanitizePeerText } from "../lib/sanitize";
import { generateSummary } from "../lib/summary";
import { runTwin } from "../twins/dispatch";
import type { Registry } from "./registry";
import type {
  ArtifactRecord,
  Env,
  JointSummary,
  MessageType,
  OpenRoomInput,
  PostMessageInput,
  RoomMember,
  RoomMessage,
  RoomSnapshot,
  RoomStatus,
  ScriptKind,
  TwinAction,
} from "../types";

type SqlValue = string | number | null;

interface MetaRow {
  [key: string]: SqlValue;
  key: string;
  value: string;
}

interface MemberRow {
  [key: string]: SqlValue;
  id: string;
  name: string;
  role: string;
  runtime: string | null;
  script: string | null;
  joined_at: string;
}

interface MessageRow {
  [key: string]: SqlValue;
  id: string;
  seq: number;
  type: string;
  author_id: string;
  author_name: string;
  body: string;
  payload_json: string | null;
  created_at: string;
}

interface ArtifactRow {
  [key: string]: SqlValue;
  id: string;
  message_id: string | null;
  kind: string;
  body_json: string;
  author_id: string;
  created_at: string;
}

interface AuditRow {
  [key: string]: SqlValue;
  id: string;
  type: string;
  actor_id: string | null;
  payload_json: string;
  created_at: string;
}

export class Room extends DurableObject<Env> {
  private turnLock = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        runtime TEXT,
        script TEXT,
        joined_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        body TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        message_id TEXT,
        kind TEXT NOT NULL,
        body_json TEXT NOT NULL,
        author_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        actor_id TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get("Upgrade");
    if (upgrade?.toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      this.send(pair[1], {
        type: "room.joined",
        room: this.snapshot(),
      });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return new Response("Expected WebSocket", { status: 426 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    let parsed: { type?: string; body?: string; authorId?: string; authorName?: string };
    try {
      parsed = JSON.parse(message) as typeof parsed;
    } catch {
      this.send(ws, { type: "error", error: "Invalid JSON" });
      return;
    }
    if (parsed.type === "ping") {
      this.send(ws, { type: "pong" });
      return;
    }
    if (parsed.type === "chat" && parsed.body) {
      try {
        await this.postMessage({
          authorId: parsed.authorId || "human",
          authorName: parsed.authorName || "Human",
          type: "chat",
          body: parsed.body,
        });
      } catch (err) {
        this.send(ws, { type: "error", error: err instanceof Error ? err.message : "post failed" });
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    ws.close();
  }

  async open(input: OpenRoomInput): Promise<RoomSnapshot> {
    if (this.getMeta("id")) return this.snapshot();

    this.setMeta("id", input.roomId);
    this.setMeta("meetingRequestId", input.meetingRequestId);
    this.setMeta("status", "open");
    this.setMeta("intent", input.intent);
    this.setMeta("body", input.body);
    this.setMeta("maxRounds", String(input.maxRounds));
    this.setMeta("roundCount", "0");
    this.setMeta("floorHolderId", input.floorHolderId);
    this.setMeta("pendingGate", "");
    this.setMeta("createdAt", nowIso());
    this.setMeta("lastTurnAt", "0");
    this.setMeta("summaryJson", "");

    for (const member of input.members) {
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO members (id, name, role, runtime, script, joined_at) VALUES (?, ?, ?, ?, ?, ?)`,
        member.id,
        member.name,
        member.role,
        member.runtime,
        member.script,
        member.joinedAt,
      );
    }

    await this.audit("room.opened", "system", {
      meetingRequestId: input.meetingRequestId,
      members: input.members.map((m) => m.id),
      intent: input.intent,
    });
    this.appendMessage({
      authorId: "system",
      authorName: "TwinMeet",
      type: "system",
      body: `Room opened. Floor granted to ${this.memberName(input.floorHolderId)}. Max ${input.maxRounds} rounds. Human approval required to resolve.`,
    }, { countRound: false, skipFloor: true });
    this.broadcast({ type: "floor.granted", floorHolderId: input.floorHolderId });

    await this.ctx.storage.setAlarm(Date.now() + 250);
    return this.snapshot();
  }

  async getSnapshot(): Promise<RoomSnapshot> {
    await this.maybeAdvance();
    return this.snapshot();
  }

  async tick(): Promise<RoomSnapshot> {
    await this.runScriptedTurn();
    return this.snapshot();
  }

  async alarm(): Promise<void> {
    await this.runScriptedTurn();
    const status = this.getMeta("status");
    if (status === "open" && !this.getMeta("pendingGate")) {
      await this.ctx.storage.setAlarm(Date.now() + 450);
    }
  }

  async postMessage(input: PostMessageInput): Promise<RoomMessage> {
    await this.maybeAdvance();
    const status = this.getMeta("status");
    if (status === "resolved") throw new Error("Room already resolved");
    if (status === "paused" && input.type !== "system") {
      throw new Error("Room is paused pending human approval");
    }

    const author = this.getMember(input.authorId);
    const isHuman = !author || author.role === "human";
    if (!isHuman) {
      this.assertFloor(input.authorId, input.body);
    }

    const body = sanitizePeerText(input.body);
    const message = this.appendMessage(
      { ...input, body },
      { countRound: input.type !== "system" && input.type !== "audit" },
    );

    if (input.type === "artifact" && isRecord(input.payload)) {
      this.storeArtifact(message, input.payload);
    }

    if (input.type === "handoff") {
      const toId = isRecord(input.payload) ? String(input.payload.toId ?? "") : mentionTarget(body);
      if (toId && this.getMember(toId)) {
        this.setMeta("floorHolderId", toId);
        this.broadcast({ type: "floor.granted", floorHolderId: toId });
        this.broadcast({ type: "handoff.accepted", fromId: input.authorId, toId });
      }
    } else if (!isHuman) {
      this.passFloor(input.authorId, body);
    }

    return message;
  }

  async requestResolve(actorId: string, note?: string): Promise<RoomSnapshot> {
    const status = this.getMeta("status");
    if (status === "resolved") return this.snapshot();
    this.setMeta("status", "paused");
    this.setMeta("pendingGate", "resolve");
    this.appendMessage(
      {
        authorId: actorId,
        authorName: this.memberName(actorId),
        type: "system",
        body: note || "Resolve requested. Waiting for human approval.",
      },
      { countRound: false, skipFloor: true },
    );
    await this.audit("human.approval_required", actorId, { gate: "resolve" });
    this.broadcast({ type: "room.paused", reason: "resolve" });
    this.broadcast({ type: "human.approval_required", gate: "resolve" });
    await this.ctx.storage.deleteAlarm();
    await this.forwardRoomStatus("paused");
    return this.snapshot();
  }

  async approve(actorId: string, decision: "approve" | "reject"): Promise<RoomSnapshot> {
    const gate = this.getMeta("pendingGate");
    if (gate !== "resolve") throw new Error("No pending resolve approval");

    if (decision === "reject") {
      this.setMeta("status", "open");
      this.setMeta("pendingGate", "");
      this.appendMessage(
        {
          authorId: actorId,
          authorName: this.memberName(actorId) || "Human",
          type: "system",
          body: "Human rejected resolve. Collaboration may continue until max rounds.",
        },
        { countRound: false, skipFloor: true },
      );
      await this.audit("human.rejected", actorId, { gate: "resolve" });
      await this.ctx.storage.setAlarm(Date.now() + 250);
      await this.forwardRoomStatus("open");
      return this.snapshot();
    }

    return this.finalizeResolve(actorId);
  }

  async escalate(actorId: string, reason: string): Promise<RoomSnapshot> {
    this.setMeta("status", "escalated");
    this.setMeta("pendingGate", "resolve");
    this.appendMessage(
      {
        authorId: actorId,
        authorName: this.memberName(actorId),
        type: "system",
        body: `Escalated to human: ${sanitizePeerText(reason)}`,
      },
      { countRound: false, skipFloor: true },
    );
    await this.audit("room.escalated", actorId, { reason });
    this.broadcast({ type: "human.approval_required", gate: "resolve" });
    await this.forwardRoomStatus("escalated");
    return this.snapshot();
  }

  async listAudit(): Promise<Array<{ id: string; type: string; actorId: string | null; payload: unknown; createdAt: string }>> {
    return this.ctx.storage.sql
      .exec<AuditRow>(`SELECT * FROM audit_events ORDER BY created_at ASC`)
      .toArray()
      .map((r) => ({
        id: r.id,
        type: r.type,
        actorId: r.actor_id,
        payload: JSON.parse(r.payload_json) as unknown,
        createdAt: r.created_at,
      }));
  }

  private async finalizeResolve(actorId: string): Promise<RoomSnapshot> {
    const snap = this.snapshot();
    const summary = await generateSummary(
      {
        intent: snap.intent,
        members: snap.members,
        messages: snap.messages,
        artifacts: snap.artifacts,
        resolved: true,
        rounds: snap.roundCount,
      },
      {
        geminiKey: this.env.GEMINI_API_KEY,
        openaiKey: this.env.OPENAI_API_KEY,
        model: this.env.GEMINI_MODEL || this.env.LLM_MODEL,
      },
    );
    this.setMeta("summaryJson", JSON.stringify(summary));
    this.setMeta("status", "resolved");
    this.setMeta("pendingGate", "");
    this.appendMessage(
      {
        authorId: actorId,
        authorName: this.memberName(actorId) || "Human",
        type: "system",
        body: `Resolved. ${summary.narrative}`,
      },
      { countRound: false, skipFloor: true },
    );
    await this.audit("room.resolved", actorId, { summary });
    this.broadcast({ type: "room.resolved", summary });
    await this.ctx.storage.deleteAlarm();
    await this.forwardRoomStatus("resolved");
    return this.snapshot();
  }

  private async maybeAdvance(): Promise<void> {
    const status = this.getMeta("status");
    if (status !== "open") return;
    if (this.getMeta("pendingGate")) return;
    const last = Number(this.getMeta("lastTurnAt") || "0");
    if (Date.now() - last > 700) {
      await this.runScriptedTurn();
    }
  }

  private async runScriptedTurn(): Promise<void> {
    if (this.turnLock) return;
    const status = this.getMeta("status");
    if (status !== "open") return;
    if (this.getMeta("pendingGate")) return;
    this.turnLock = true;
    this.setMeta("lastTurnAt", String(Date.now()));
    try {
      await this.runScriptedTurnLocked();
    } finally {
      this.turnLock = false;
      this.setMeta("lastTurnAt", String(Date.now()));
    }
  }

  private async runScriptedTurnLocked(): Promise<void> {
    const status = this.getMeta("status");
    if (status !== "open") return;
    if (this.getMeta("pendingGate")) return;

    const maxRounds = Number(this.getMeta("maxRounds") || "8");
    const rounds = Number(this.getMeta("roundCount") || "0");
    if (rounds >= maxRounds) {
      await this.requestResolve("system", "Max rounds reached. Resolve requires human approval.");
      return;
    }

    const floorId = this.getMeta("floorHolderId");
    const member = floorId ? this.getMember(floorId) : null;
    if (!member || member.role !== "twin" || member.runtime !== "scripted" || !member.script) {
      return;
    }

    const ctx = {
      selfId: member.id,
      selfName: member.name,
      intent: this.getMeta("intent"),
      body: this.getMeta("body"),
      members: this.listMembers(),
      transcript: this.listMessages(),
    };
    const actions = await runTwin(member.script as ScriptKind, ctx, geminiOptions(this.env));
    if (actions.length === 0) {
      this.setMeta("lastTurnAt", String(Date.now()));
      this.passFloor(member.id);
      return;
    }

    for (const action of actions) {
      if (Number(this.getMeta("roundCount") || "0") >= maxRounds) break;
      if (this.getMeta("pendingGate")) break;
      await this.applyAction(member, action);
    }

    if (this.getMeta("status") === "open" && !this.getMeta("pendingGate")) {
      this.passFloor(member.id);
    }
    this.setMeta("lastTurnAt", String(Date.now()));
  }

  private async applyAction(member: RoomMember, action: TwinAction): Promise<void> {
    if (action.type === "request_resolve") {
      await this.requestResolve(member.id, action.body);
      return;
    }
    if (action.type === "artifact") {
      this.appendMessage(
        {
          authorId: member.id,
          authorName: member.name,
          type: "artifact",
          body: action.body,
          payload: action.payload,
        },
        { countRound: true },
      );
      this.storeArtifact(
        this.listMessages().at(-1)!,
        action.payload,
      );
      return;
    }
    if (action.type === "handoff") {
      this.appendMessage(
        {
          authorId: member.id,
          authorName: member.name,
          type: "handoff",
          body: action.body,
          payload: { toId: action.toId },
        },
        { countRound: true },
      );
      this.setMeta("floorHolderId", action.toId);
      this.broadcast({ type: "handoff.requested", fromId: member.id, toId: action.toId });
      this.broadcast({ type: "floor.granted", floorHolderId: action.toId });
      return;
    }
    this.appendMessage(
      {
        authorId: member.id,
        authorName: member.name,
        type: action.type,
        body: action.body,
      },
      { countRound: true },
    );
  }

  private storeArtifact(message: RoomMessage, payload: Record<string, unknown>): ArtifactRecord {
    const artifact: ArtifactRecord = {
      id: newId("art"),
      messageId: message.id,
      kind: String(payload.kind ?? "sql.index"),
      body: payload,
      authorId: message.authorId,
      createdAt: nowIso(),
    };
    this.ctx.storage.sql.exec(
      `INSERT INTO artifacts (id, message_id, kind, body_json, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      artifact.id,
      artifact.messageId,
      artifact.kind,
      JSON.stringify(artifact.body),
      artifact.authorId,
      artifact.createdAt,
    );
    void this.audit("artifact.created", message.authorId, artifact);
    this.broadcast({ type: "artifact.created", artifact });
    return artifact;
  }

  private assertFloor(authorId: string, body: string): void {
    const floor = this.getMeta("floorHolderId");
    if (!floor || floor === authorId) return;
    const mentioned = mentionTarget(body);
    if (mentioned === authorId) return;
    throw new Error(`Floor is held by ${this.memberName(floor)}. @mention them or wait for handoff.`);
  }

  private passFloor(fromId: string, body?: string): void {
    const mentioned = body ? mentionTarget(body) : null;
    if (mentioned && this.getMember(mentioned)) {
      this.setMeta("floorHolderId", mentioned);
      this.broadcast({ type: "floor.granted", floorHolderId: mentioned });
      return;
    }
    const twins = this.listMembers().filter((m) => m.role === "twin");
    const next = twins.find((m) => m.id !== fromId) ?? twins[0];
    if (next) {
      this.setMeta("floorHolderId", next.id);
      this.broadcast({ type: "floor.granted", floorHolderId: next.id });
    }
  }

  private appendMessage(
    input: PostMessageInput,
    opts: { countRound?: boolean; skipFloor?: boolean } = {},
  ): RoomMessage {
    const seqRow = this.ctx.storage.sql
      .exec<{ n: number }>(`SELECT COALESCE(MAX(seq), 0) as n FROM messages`)
      .toArray()[0];
    const seq = (seqRow?.n ?? 0) + 1;
    const message: RoomMessage = {
      id: newId("msg"),
      seq,
      type: input.type,
      authorId: input.authorId,
      authorName: input.authorName,
      body: input.body,
      payload: input.payload ?? null,
      createdAt: nowIso(),
    };
    this.ctx.storage.sql.exec(
      `INSERT INTO messages (id, seq, type, author_id, author_name, body, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      message.id,
      message.seq,
      message.type,
      message.authorId,
      message.authorName,
      message.body,
      message.payload == null ? null : JSON.stringify(message.payload),
      message.createdAt,
    );
    if (opts.countRound) {
      const next = Number(this.getMeta("roundCount") || "0") + 1;
      this.setMeta("roundCount", String(next));
    }
    void this.audit("message.created", input.authorId, {
      messageId: message.id,
      type: message.type,
      seq: message.seq,
    });
    this.broadcast({ type: "message.created", message });
    return message;
  }

  private snapshot(): RoomSnapshot {
    const summaryRaw = this.getMeta("summaryJson");
    let summary: JointSummary | null = null;
    if (summaryRaw) {
      try {
        summary = JSON.parse(summaryRaw) as JointSummary;
      } catch {
        summary = null;
      }
    }
    const pending = this.getMeta("pendingGate");
    return {
      id: this.getMeta("id"),
      meetingRequestId: this.getMeta("meetingRequestId"),
      status: (this.getMeta("status") || "open") as RoomStatus,
      intent: this.getMeta("intent"),
      body: this.getMeta("body"),
      maxRounds: Number(this.getMeta("maxRounds") || "8"),
      roundCount: Number(this.getMeta("roundCount") || "0"),
      floorHolderId: this.getMeta("floorHolderId") || null,
      pendingGate: pending === "resolve" || pending === "tool" ? pending : null,
      members: this.listMembers(),
      messages: this.listMessages(),
      artifacts: this.listArtifacts(),
      summary,
      createdAt: this.getMeta("createdAt"),
    };
  }

  private listMembers(): RoomMember[] {
    return this.ctx.storage.sql
      .exec<MemberRow>(`SELECT * FROM members`)
      .toArray()
      .map((r) => ({
        id: r.id,
        name: r.name,
        role: r.role as RoomMember["role"],
        runtime: r.runtime as RoomMember["runtime"],
        script: r.script as RoomMember["script"],
        joinedAt: r.joined_at,
      }));
  }

  private listMessages(): RoomMessage[] {
    return this.ctx.storage.sql
      .exec<MessageRow>(`SELECT * FROM messages ORDER BY seq ASC`)
      .toArray()
      .map((r) => ({
        id: r.id,
        seq: r.seq,
        type: r.type as MessageType,
        authorId: r.author_id,
        authorName: r.author_name,
        body: r.body,
        payload: r.payload_json ? (JSON.parse(r.payload_json) as unknown) : null,
        createdAt: r.created_at,
      }));
  }

  private listArtifacts(): ArtifactRecord[] {
    return this.ctx.storage.sql
      .exec<ArtifactRow>(`SELECT * FROM artifacts ORDER BY created_at ASC`)
      .toArray()
      .map((r) => ({
        id: r.id,
        messageId: r.message_id,
        kind: r.kind,
        body: JSON.parse(r.body_json) as Record<string, unknown>,
        authorId: r.author_id,
        createdAt: r.created_at,
      }));
  }

  private getMember(id: string): RoomMember | null {
    return this.listMembers().find((m) => m.id === id) ?? null;
  }

  private memberName(id: string): string {
    return this.getMember(id)?.name ?? id;
  }

  private getMeta(key: string): string {
    const row = this.ctx.storage.sql
      .exec<MetaRow>(`SELECT value FROM meta WHERE key=?`, key)
      .toArray()[0];
    return row?.value ?? "";
  }

  private setMeta(key: string, value: string): void {
    this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, key, value);
  }

  private async audit(type: string, actorId: string | null, payload: unknown): Promise<void> {
    const event = {
      id: newId("aud"),
      type,
      actorId,
      payload,
      createdAt: nowIso(),
    };
    this.ctx.storage.sql.exec(
      `INSERT INTO audit_events (id, type, actor_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`,
      event.id,
      event.type,
      event.actorId,
      JSON.stringify(event.payload),
      event.createdAt,
    );
    this.broadcast({ type: "audit.appended", event });
    const roomId = this.getMeta("id");
    const meetingRequestId = this.getMeta("meetingRequestId") || null;
    if (roomId) {
      const registry = this.env.REGISTRY.getByName("global") as DurableObjectStub<Registry>;
      await registry.appendAudit({
        type,
        actorId,
        payload,
        roomId,
        meetingRequestId,
      });
    }
  }

  private async forwardRoomStatus(status: string): Promise<void> {
    const roomId = this.getMeta("id");
    if (!roomId) return;
    const registry = this.env.REGISTRY.getByName("global") as DurableObjectStub<Registry>;
    await registry.updateRoomStatus(roomId, status);
  }

  private send(ws: WebSocket, event: unknown): void {
    try {
      ws.send(JSON.stringify(event));
    } catch {
      /* socket already closing */
    }
  }

  private broadcast(event: unknown): void {
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, event);
    }
  }
}

function geminiOptions(env: Env) {
  if (!env.GEMINI_API_KEY) return undefined;
  return { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || env.LLM_MODEL };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function mentionTarget(body: string): string | null {
  const match = body.match(/@([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}
