import { useEffect, useMemo, useRef, useState } from "react";
import { MicButton } from "@/components/MicButton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { api, type Health, type RoomMessage, type RoomSnapshot } from "@/lib/api";

export function RoomPage({ roomId, onHome }: { roomId: string; onHome?: () => void }) {
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [voiceReplies, setVoiceReplies] = useState(false);
  const [openDoc, setOpenDoc] = useState<RoomMessage | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const voiceOn = useRef(false);
  const heard = useRef<Set<string>>(new Set());

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

  useEffect(() => {
    if (!room) return;
    if (!voiceOn.current) {
      for (const message of room.messages) heard.current.add(message.id);
      return;
    }
    const newcomers = room.messages.filter(
      (message) =>
        !heard.current.has(message.id) &&
        message.authorId !== "human" &&
        message.type !== "system" &&
        message.type !== "audit" &&
        message.body.trim(),
    );
    for (const message of room.messages) heard.current.add(message.id);
    const last = newcomers.at(-1);
    if (!last || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(`${last.authorName}. ${last.body}`.slice(0, 500));
    utter.rate = 1.02;
    window.speechSynthesis.speak(utter);
  }, [room]);

  useEffect(() => {
    return () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

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

  function armVoice() {
    voiceOn.current = true;
    if (room) for (const message of room.messages) heard.current.add(message.id);
    setVoiceReplies(true);
  }

  function muteVoice() {
    voiceOn.current = false;
    setVoiceReplies(false);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  async function sendText(text: string) {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      await api.postChat(roomId, body);
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
    <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-2xl flex-col px-3 pb-[env(safe-area-inset-bottom)] sm:h-[calc(100dvh-5rem)] sm:px-4">
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
          <Bubble key={m.id} message={m} twins={twins.map((t) => t.id)} onOpen={setOpenDoc} />
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
        {room.status === "resolved" && (room.suggestions?.length ?? 0) > 0 && (
          <div className="rounded-2xl border border-rule bg-ink-2 px-4 py-3">
            <p className="text-sm text-paper">What should they do with this?</p>
            <div className="mt-3 grid gap-2">
              {room.suggestions!.map((suggestion) => (
                <button
                  key={suggestion.title}
                  type="button"
                  disabled={busy}
                  onClick={() => void sendText(suggestion.instruction)}
                  className="rounded-xl border border-rule px-3 py-2 text-left text-sm text-paper-2 hover:border-teal/50 disabled:opacity-40"
                >
                  {suggestion.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && <p className="pb-2 text-sm text-coral">{error}</p>}

      {room.pendingGate === "resolve" && (
        <div className="mb-3 rounded-2xl border border-rule bg-ink-2 px-4 py-3">
          <p className="text-sm text-paper">They think they’re done. Good with that?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void onApprove("approve")}>
              Yes, wrap it up
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void onApprove("reject")}>
              Keep talking
            </Button>
          </div>
        </div>
      )}

      <form
          className="mb-4 rounded-3xl border border-rule bg-ink-2 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            void sendText(draft);
          }}
        >
          <Textarea
            className="min-h-12 border-0 bg-transparent py-2"
            placeholder={
              room.status === "resolved"
                ? "Keep chatting — ask them to change the plan or draw a map…"
                : room.pendingGate === "resolve"
                  ? "Speak or type to keep them going…"
                  : "Ask a question or give an instruction…"
            }
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendText(draft);
              }
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-1">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <MicButton
                disabled={busy}
                value={draft}
                onChange={setDraft}
                onFinal={(text) => {
                  armVoice();
                  void sendText(text);
                }}
              />
              {voiceReplies ? (
                <button type="button" className="text-xs text-teal" onClick={muteVoice}>
                  Mute spoken replies
                </button>
              ) : (
                <p className="text-xs text-muted">Mic to speak</p>
              )}
            </div>
            <Button type="submit" disabled={busy || !draft.trim()}>
              Send
            </Button>
          </div>
        </form>
      {openDoc && (
        <DocumentReader
          message={openDoc}
          sources={room.sources ?? []}
          liveBrief={room.liveBrief}
          onClose={() => setOpenDoc(null)}
        />
      )}
    </div>
  );
}

function Bubble({
  message,
  twins,
  onOpen,
}: {
  message: RoomMessage;
  twins: string[];
  onOpen: (message: RoomMessage) => void;
}) {
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
          {imageSource(message.payload) && (
            <img
              src={imageSource(message.payload) ?? ""}
              alt="Map of the plan"
              className="mt-2 w-full rounded-xl"
            />
          )}
          {message.type === "artifact" && message.payload != null && !imageSource(message.payload) && (
            <button
              type="button"
              onClick={() => onOpen(message)}
              className="mt-2 w-full rounded-xl border border-rule bg-ink/60 px-3 py-2 text-left hover:border-teal/50"
            >
              <p className="text-sm text-paper">{documentTitle(message)}</p>
              <p className="mt-1 line-clamp-2 text-xs text-teal">{documentSummary(message)}</p>
              <p className="mt-2 text-xs text-muted">Open document</p>
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function DocumentReader({
  message,
  sources,
  liveBrief,
  onClose,
}: {
  message: RoomMessage;
  sources: Array<{ title: string; url: string }>;
  liveBrief?: string;
  onClose: () => void;
}) {
  const doc = readDocument(message.payload);
  const linked = doc.sources.length ? doc.sources : sources;
  const live = doc.live || linked.length > 0;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:items-center" onClick={onClose}>
      <article
        className="max-h-[86vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-rule bg-ink-2 p-5 text-left"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg text-paper">{doc.title || documentTitle(message)}</h2>
          <button type="button" className="text-sm text-muted hover:text-paper" onClick={onClose}>
            Close
          </button>
        </div>
        <p className={`mt-2 text-xs ${live ? "text-teal" : "text-gold"}`}>
          {live
            ? "Figures below are tied to the live sources at the bottom."
            : "Not a live feed. The bots wrote this. Numbers here were not pulled from a current source."}
        </p>
        {doc.summary && <p className="mt-4 text-sm leading-relaxed text-paper-2">{doc.summary}</p>}
        {liveBrief && !doc.summary && <p className="mt-4 text-sm leading-relaxed text-paper-2">{liveBrief}</p>}
        <div className="mt-4 space-y-4">
          {doc.sections.map((section) => (
            <section key={section.heading}>
              <h3 className="text-sm text-paper">{section.heading}</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-paper-2">{section.details}</p>
            </section>
          ))}
        </div>
        {linked.length > 0 && (
          <div className="mt-6">
            <h3 className="text-xs uppercase tracking-wide text-muted">Live sources</h3>
            <ul className="mt-2 space-y-2">
              {linked.map((source) => (
                <li key={source.url}>
                  <a className="text-sm text-teal underline" href={source.url} target="_blank" rel="noreferrer">
                    {source.title || source.url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </article>
    </div>
  );
}

function documentTitle(message: RoomMessage): string {
  return readDocument(message.payload).title || message.body || "Document";
}

function documentSummary(message: RoomMessage): string {
  const doc = readDocument(message.payload);
  return doc.summary || doc.sections[0]?.details || message.body;
}

function readDocument(payload: unknown): {
  title: string;
  summary: string;
  sections: Array<{ heading: string; details: string }>;
  sources: Array<{ title: string; url: string }>;
  live: boolean;
} {
  const empty = { title: "", summary: "", sections: [], sources: [], live: false };
  if (!payload || typeof payload !== "object") return empty;
  let rec = payload as Record<string, unknown>;
  if (typeof rec.summary === "string" && rec.summary.trim().startsWith("{")) {
    try {
      const inner = JSON.parse(rec.summary) as Record<string, unknown>;
      rec = { ...rec, ...inner, sources: rec.sources, live: rec.live };
    } catch {
      /* keep the outer document */
    }
  }
  const sections: Array<{ heading: string; details: string }> = [];
  if (Array.isArray(rec.sections)) {
    for (const item of rec.sections) {
      if (!item || typeof item !== "object") continue;
      const section = item as { heading?: unknown; details?: unknown };
      sections.push({
        heading: String(section.heading || "Section"),
        details: String(section.details || ""),
      });
    }
  }
  if (rec.details && typeof rec.details === "object") {
    for (const [key, value] of Object.entries(rec.details as Record<string, unknown>)) {
      sections.push({ heading: key.replaceAll("_", " "), details: String(value) });
    }
  }
  for (const key of ["index", "ddl", "rationale"]) {
    if (typeof rec[key] === "string") sections.push({ heading: key, details: String(rec[key]) });
  }
  const sources = Array.isArray(rec.sources)
    ? rec.sources
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const source = item as { title?: unknown; url?: unknown };
          const url = String(source.url || "");
          if (!url.startsWith("http")) return null;
          return { title: String(source.title || url), url };
        })
        .filter((item): item is { title: string; url: string } => Boolean(item))
    : [];
  return {
    title: String(rec.title || rec.summary || ""),
    summary: typeof rec.summary === "string" ? rec.summary : "",
    sections,
    sources,
    live: rec.live === true || sources.length > 0,
  };
}

function imageSource(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const rec = payload as { kind?: string; mimeType?: string; imageBase64?: string };
  if (rec.kind !== "image-map" || !rec.imageBase64) return null;
  return `data:${rec.mimeType || "image/png"};base64,${rec.imageBase64}`;
}
