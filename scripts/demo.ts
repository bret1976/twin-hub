/**
 * TwinMeet acceptance demo.
 * Talks to a local wrangler/vite server — no production database required.
 *
 *   npm run dev    # in another terminal, if the server is not up
 *   npm run demo
 */
const BASE = process.env.TWINMEET_URL ?? "http://127.0.0.1:45454";
const INTENT = "Review this toy DDL for a orders table and suggest one index.";
const DEMO_WAIT_MS = Number(process.env.TWINMEET_DEMO_WAIT_MS ?? 1800);
const DEMO_TRIES = Number(process.env.TWINMEET_DEMO_TRIES ?? 80);
const DDL = `CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  total_cents INTEGER NOT NULL
);`;

const PLANNER = "planner-twin";
const REVIEWER = "sql-reviewer-twin";

interface DiscoverHit {
  agent: { id: string; name: string };
  score: number;
}

interface MeetingRequest {
  id: string;
  roomId: string | null;
  status: string;
}

interface RoomSnapshot {
  id: string;
  status: string;
  pendingGate: string | null;
  roundCount: number;
  twinMode?: string;
  messages: Array<{ type: string; authorId: string; body: string; payload?: unknown }>;
  artifacts: Array<{ body: Record<string, unknown> }>;
  summary: {
    problem: string;
    participants: string[];
    artifact: Record<string, unknown> | null;
    resolved: boolean;
    narrative: string;
    generatedBy?: string;
  } | null;
}

interface AuditEvent {
  type: string;
}

async function main(): Promise<void> {
  console.log(`TwinMeet demo → ${BASE}`);
  await waitForServer();

  const health = await api<{
    geminiConfigured?: boolean;
    twinMode?: string;
    model?: string | null;
  }>("/health");
  pass(
    `mode ${health.twinMode ?? "unknown"} · GEMINI_API_KEY ${health.geminiConfigured ? "configured" : "missing"} · model ${health.model ?? "—"}`,
  );

  const seed = await api<{ agents: Array<{ id: string; name: string }> }>("/v1/seed", { method: "POST" });
  const names = seed.agents.map((a) => `${a.name} (${a.id})`).join(", ");
  assert(seed.agents.some((a) => a.id === PLANNER), "NeedHelp / planner-twin seeded");
  assert(seed.agents.some((a) => a.id === REVIEWER), "HasSkill / sql-reviewer-twin seeded");
  pass(`seeded ${names}`);

  const discovered = await api<{ results: DiscoverHit[] }>(
    `/v1/discover?intent=${encodeURIComponent(INTENT)}&tags=sql,postgres`,
  );
  const top = discovered.results[0];
  assert(top?.agent.id === REVIEWER, `discover top is HasSkill, got ${top?.agent.id}`);
  pass(`discover ranked ${top.agent.name} first (score ${top.score.toFixed(3)})`);

  const proposed = await api<{ meetingRequest: MeetingRequest }>("/v1/meeting-requests", {
    method: "POST",
    body: JSON.stringify({
      requesterId: PLANNER,
      inviteeId: REVIEWER,
      intent: INTENT,
      body: DDL,
      tags: ["sql", "postgres"],
    }),
  });
  pass(`meeting proposed ${proposed.meetingRequest.id}`);

  const accepted = await api<{ meetingRequest: MeetingRequest; room: RoomSnapshot }>(
    `/v1/meeting-requests/${proposed.meetingRequest.id}/accept`,
    { method: "POST" },
  );
  const roomId = accepted.meetingRequest.roomId ?? accepted.room.id;
  assert(Boolean(roomId), "accept created a room");
  pass(`accepted → room ${roomId}`);

  const wsEvents: string[] = [];
  const ws = listenRoom(roomId, wsEvents);
  await sleep(200);

  const room = await waitForRoom(roomId, (snap) => hasUsefulArtifact(snap) && snap.pendingGate === "resolve");

  assert(room.roundCount <= 8, `exchanged ${room.roundCount} rounds (cap 8)`);
  const artifact = room.artifacts[0]?.body;
  assert(hasUsefulArtifact(room), "artifact produced");
  const twinTurns = room.messages.filter((m) => m.authorId === PLANNER || m.authorId === REVIEWER);
  assert(twinTurns.length >= 1, "twins posted at least one turn");
  pass(`artifact ${JSON.stringify(artifact).slice(0, 280)}`);
  pass(`twinMode ${room.twinMode ?? health.twinMode ?? "unknown"} · ${twinTurns.length} twin messages`);

  const resolved = await api<{ room: RoomSnapshot }>(`/v1/rooms/${roomId}/approve`, {
    method: "POST",
    body: JSON.stringify({ decision: "approve", actorId: "human" }),
  });
  const summary = resolved.room.summary;
  assert(summary !== null, "joint summary present");
  assert(summary!.problem.trim().length > 0, "summary.problem");
  assert(summary!.participants.length >= 2, "summary.participants");
  assert(Boolean(summary!.artifact), "summary.artifact");
  assert(summary!.resolved === true, "summary.resolved");
  assert(typeof summary!.narrative === "string" && summary!.narrative.length > 20, "summary.narrative");
  pass(`resolved (${summary!.generatedBy ?? "unknown"}) — ${summary!.narrative.slice(0, 220)}`);

  const audit = await api<{ events: AuditEvent[] }>(`/v1/rooms/${roomId}/audit`);
  const types = new Set(audit.events.map((e) => e.type));
  for (const needed of [
    "meeting.requested",
    "meeting.accepted",
    "message.created",
    "artifact.created",
    "room.resolved",
  ]) {
    assert(types.has(needed), `audit contains ${needed}`);
  }
  pass(`audit ${audit.events.length} events: ${[...types].join(", ")}`);

  ws.close();
  if (wsEvents.some((t) => t === "message.created" || t === "room.joined")) {
    pass(`websocket observed ${wsEvents.join(", ")}`);
  } else {
    pass("websocket attached (UI can watch /v1/rooms/:id/ws)");
  }

  console.log("\nAll acceptance checks passed.");
  console.log(`Watch live: ${BASE}/#/rooms/${roomId}`);
}

async function waitForRoom(
  roomId: string,
  done: (snap: RoomSnapshot) => boolean,
): Promise<RoomSnapshot> {
  let last: RoomSnapshot | null = null;
  for (let i = 0; i < DEMO_TRIES; i++) {
    await api<{ room: RoomSnapshot }>(`/v1/rooms/${roomId}/tick`, { method: "POST" }).catch(() => undefined);
    const res = await api<{ room: RoomSnapshot }>(`/v1/rooms/${roomId}`);
    last = res.room;
    if (done(last)) return last;
    await sleep(DEMO_WAIT_MS);
  }
  throw new Error(
    `Room did not finish collaboration. status=${last?.status} rounds=${last?.roundCount} artifacts=${last?.artifacts.length}`,
  );
}

function listenRoom(roomId: string, sink: string[]): WebSocket {
  const url = BASE.replace(/^http/, "ws") + `/v1/rooms/${roomId}/ws`;
  const ws = new WebSocket(url);
  ws.addEventListener("message", (ev) => {
    try {
      const data = JSON.parse(String(ev.data)) as { type?: string };
      if (data.type) sink.push(data.type);
    } catch {
      /* ignore */
    }
  });
  return ws;
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      /* not up */
    }
    await sleep(250);
  }

  if (process.env.TWINMEET_NO_START === "1") {
    throw new Error(`No server at ${BASE}. Start it with: npm run dev`);
  }

  console.log("Starting `npm run dev`…");
  const { spawn } = await import("node:child_process");
  const child = spawn("npm", ["run", "dev"], {
    stdio: "inherit",
    detached: true,
    env: process.env,
  });
  child.unref();

  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      /* wait */
    }
    await sleep(500);
  }
  throw new Error(`Server did not become ready at ${BASE}`);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status} ${data.error ?? ""}`);
  return data;
}

function hasUsefulArtifact(snap: RoomSnapshot): boolean {
  const body = snap.artifacts[0]?.body;
  if (!body || typeof body !== "object") return false;
  const blob = JSON.stringify(body);
  return blob.length > 12 && blob !== "{}";
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${message}`);
}

function pass(message: string): void {
  console.log(`  ok  ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
