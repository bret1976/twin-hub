import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { api, type AuditEvent, type RoomSnapshot } from "@/lib/api";
import { formatTime } from "@/lib/utils";

export function RoomPage({ roomId }: { roomId: string }) {
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [live, setLive] = useState<"connecting" | "live" | "polling">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    const [r, a] = await Promise.all([api.room(roomId), api.audit(roomId)]);
    setRoom(r.room);
    setAudit(a.events);
    return r.room;
  }

  useEffect(() => {
    let ws: WebSocket | null = null;
    let poll: number | undefined;
    let cancelled = false;

    void refresh().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Room load failed");
    });

    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/v1/rooms/${roomId}/ws`);
    ws.onopen = () => setLive("live");
    ws.onmessage = () => {
      void refresh();
    };
    ws.onerror = () => {
      setLive("polling");
    };
    ws.onclose = () => {
      if (!cancelled) setLive("polling");
    };

    poll = window.setInterval(() => {
      void (async () => {
        const snap = await refresh();
        if (snap.status === "open" && !snap.pendingGate && snap.roundCount < snap.maxRounds) {
          await api.tick(roomId).catch(() => undefined);
          await refresh();
        }
      })();
    }, 900);

    return () => {
      cancelled = true;
      ws?.close();
      if (poll) window.clearInterval(poll);
    };
  }, [roomId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [room?.messages.length]);

  const floorName = useMemo(() => {
    if (!room?.floorHolderId) return "none";
    return room.members.find((m) => m.id === room.floorHolderId)?.name ?? room.floorHolderId;
  }, [room]);

  async function onApprove(decision: "approve" | "reject") {
    setBusy(true);
    try {
      const res = await api.approve(roomId, decision);
      setRoom(res.room);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await api.postChat(roomId, draft.trim());
      setDraft("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  if (!room && error) {
    return <p className="text-coral">{error}</p>;
  }
  if (!room) {
    return <p className="text-muted">Opening room…</p>;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-serif text-3xl">Live room</h1>
            <p className="mt-1 text-sm text-muted">{room.intent}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={live === "live" ? "teal" : "gold"}>{live}</Badge>
            <Badge variant="mute">
              round {room.roundCount}/{room.maxRounds}
            </Badge>
            <Badge variant="gold">floor {floorName}</Badge>
            <Badge variant={room.status === "resolved" ? "teal" : room.status === "paused" ? "coral" : "mute"}>
              {room.status}
            </Badge>
          </div>
        </div>

        {error && <p className="text-sm text-coral">{error}</p>}

        {room.pendingGate === "resolve" && (
          <Card className="border-coral/50">
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-coral">Human approval required</p>
                <p className="text-sm text-muted">The room is paused. Approve to publish the joint summary.</p>
              </div>
              <div className="flex gap-2">
                <Button disabled={busy} onClick={() => void onApprove("approve")}>
                  Approve resolve
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => void onApprove("reject")}>
                  Keep talking
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Transcript</CardTitle>
          </CardHeader>
          <CardContent>
            <div ref={logRef} className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
              {room.messages.length === 0 && <p className="text-sm text-muted">Waiting for the twins to take the floor…</p>}
              {room.messages.map((m) => (
                <article key={m.id} className="rounded-md border border-rule/80 bg-ink px-3 py-2">
                  <header className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant={toneFor(m.type)}>{m.type}</Badge>
                    <span className="text-paper">{m.authorName}</span>
                    <span className="text-muted">{formatTime(m.createdAt)}</span>
                  </header>
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-paper-2">{m.body}</pre>
                  {m.payload != null && m.type === "artifact" && (
                    <pre className="mt-2 overflow-x-auto font-mono text-xs text-gold">
                      {JSON.stringify(m.payload, null, 2)}
                    </pre>
                  )}
                </article>
              ))}
            </div>
            {room.status !== "resolved" && room.pendingGate !== "resolve" && (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Textarea
                  className="min-h-16"
                  placeholder="Watch-only humans can still leave a note…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <Button variant="outline" disabled={busy} onClick={() => void send()}>
                  Send
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <aside className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Artifact</CardTitle>
          </CardHeader>
          <CardContent>
            {room.artifacts[0] ? (
              <pre className="overflow-x-auto font-mono text-xs text-teal">
                {JSON.stringify(room.artifacts[0].body, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-muted">No artifact yet. HasSkill will post a CREATE INDEX.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Joint summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {room.summary ? (
              <>
                <p>
                  <span className="text-muted">Problem. </span>
                  {room.summary.problem}
                </p>
                <p>
                  <span className="text-muted">Participants. </span>
                  {room.summary.participants.join(", ")}
                </p>
                <p>
                  <span className="text-muted">Resolved. </span>
                  {String(room.summary.resolved)}
                </p>
                <p className="text-paper-2">{room.summary.narrative}</p>
              </>
            ) : (
              <p className="text-muted">Summary appears after human-approved resolve.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Audit</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 font-mono text-[11px] text-muted">
              {audit.map((e) => (
                <li key={e.id}>
                  <span className="text-gold">{e.type}</span> {e.actorId ?? "—"} {formatTime(e.createdAt)}
                </li>
              ))}
              {audit.length === 0 && <li>No events yet.</li>}
            </ol>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function toneFor(type: string): "gold" | "teal" | "coral" | "mute" {
  if (type === "artifact") return "teal";
  if (type === "proposal") return "gold";
  if (type === "system") return "coral";
  return "mute";
}
