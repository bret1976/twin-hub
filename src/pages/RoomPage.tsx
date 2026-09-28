import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { api, type Health, type RoomMessage, type RoomSnapshot } from "@/lib/api";

export function RoomPage({ roomId, onHome }: { roomId: string; onHome?: () => void }) {
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    const res = await api.room(roomId);
    setRoom(res.room);
    return res.room;
  }

  useEffect(() => {
    let ws: WebSocket | null = null;
    let poll: number | undefined;
    void refresh().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Chat failed to open");
    });
    void api.health().then(setHealth).catch(() => undefined);

    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/v1/rooms/${roomId}/ws`);
    ws.onmessage = () => {
      void refresh();
    };

    poll = window.setInterval(() => {
      void refresh();
    }, 1100);

    return () => {
      ws?.close();
      if (poll) window.clearInterval(poll);
    };
  }, [roomId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [room?.messages.length]);

  const twins = useMemo(() => (room?.members ?? []).filter((m) => m.role === "twin"), [room]);
  const speaker = twins.find((m) => m.id === room?.floorHolderId);
  const talking =
    room?.status === "open" && !room.pendingGate && Boolean(speaker);

  async function onApprove(decision: "approve" | "reject") {
    setBusy(true);
    try {
      const res = await api.approve(roomId, decision);
      setRoom(res.room);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finish");
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

  if (!room && error) return <p className="px-4 text-coral">{error}</p>;
  if (!room) {
    return <p className="px-4 pt-16 text-center text-muted">The bots are sitting down…</p>;
  }

  const visible = room.messages.filter((m) => m.type !== "audit");
  const gemini = (room.twinMode ?? health?.twinMode) !== "scripted";

  return (
    <div className="mx-auto flex h-[calc(100vh-4.5rem)] max-w-2xl flex-col px-3 sm:px-4">
      <header className="flex items-start justify-between gap-3 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-paper-2">{room.intent}</p>
          <p className="mt-1 text-xs text-muted">
            {twins.map((t) => t.name).join("  ·  ") || "Two twins"}
            {gemini ? "  ·  Gemini" : "  ·  practice mode"}
          </p>
        </div>
        <button type="button" className="text-xs text-muted hover:text-paper" onClick={onHome}>
          New chat
        </button>
      </header>

      <div ref={logRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-4">
        {visible.length === 0 && (
          <p className="pt-10 text-center text-sm text-muted">Waiting for the first line…</p>
        )}
        {visible.map((m) => (
          <Bubble key={m.id} message={m} twins={twins.map((t) => t.id)} />
        ))}
        {talking && (
          <p className="pl-12 text-xs text-muted">{speaker?.name ?? "A twin"} is typing…</p>
        )}
        {room.summary && (
          <div className="rounded-2xl border border-teal/30 bg-teal/10 px-4 py-3 text-sm leading-relaxed text-paper-2">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-teal">They agreed</p>
            {room.summary.narrative}
          </div>
        )}
      </div>

      {error && <p className="pb-2 text-sm text-coral">{error}</p>}

      {room.pendingGate === "resolve" && (
        <div className="mb-3 rounded-2xl border border-rule bg-ink-2 px-4 py-3">
          <p className="text-sm text-paper">They think they’re done. Good with that?</p>
          <div className="mt-3 flex gap-2">
            <Button disabled={busy} onClick={() => void onApprove("approve")}>
              Yes, wrap it up
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void onApprove("reject")}>
              Keep talking
            </Button>
          </div>
        </div>
      )}

      {room.status !== "resolved" && room.pendingGate !== "resolve" && (
        <form
          className="mb-4 flex items-end gap-2 rounded-3xl border border-rule bg-ink-2 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Textarea
            className="min-h-12 flex-1 border-0 bg-transparent py-2"
            placeholder="Jump into the conversation…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <Button type="submit" disabled={busy || !draft.trim()}>
            Send
          </Button>
        </form>
      )}
    </div>
  );
}

function Bubble({ message, twins }: { message: RoomMessage; twins: string[] }) {
  const isYou = message.authorId === "human" || message.authorName.toLowerCase() === "human";
  const isSystem = message.type === "system" || message.authorId === "system";
  const tone = isYou ? "you" : isSystem ? "system" : twins.indexOf(message.authorId) % 2 === 0 ? "gold" : "teal";

  if (isSystem) {
    return <p className="text-center text-xs text-muted">{message.body}</p>;
  }

  return (
    <article className={`flex gap-3 ${isYou ? "flex-row-reverse" : ""}`}>
      <div
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          tone === "you"
            ? "bg-paper text-ink"
            : tone === "gold"
              ? "bg-gold/20 text-gold"
              : "bg-teal/20 text-teal"
        }`}
      >
        {isYou ? "You" : message.authorName.slice(0, 1)}
      </div>
      <div className={`min-w-0 max-w-[85%] ${isYou ? "text-right" : ""}`}>
        <p className="mb-1 text-xs text-muted">{isYou ? "You" : message.authorName}</p>
        <div
          className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
            isYou ? "bg-paper text-ink" : "bg-ink-2 text-paper-2"
          }`}
        >
          <p className="whitespace-pre-wrap text-left">{message.body}</p>
          {message.type === "artifact" && message.payload != null && (
            <pre className="mt-2 overflow-x-auto rounded-xl bg-ink/60 p-2 text-left font-mono text-[11px] text-teal">
              {typeof message.payload === "string"
                ? message.payload
                : prettyPayload(message.payload)}
            </pre>
          )}
        </div>
      </div>
    </article>
  );
}

function prettyPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return String(payload);
  const rec = payload as Record<string, unknown>;
  const preferred = ["index", "ddl", "rationale", "summary", "kind"];
  const lines: string[] = [];
  for (const key of preferred) {
    if (typeof rec[key] === "string") lines.push(String(rec[key]));
  }
  if (lines.length) return lines.join("\n\n");
  return JSON.stringify(payload, null, 2);
}
