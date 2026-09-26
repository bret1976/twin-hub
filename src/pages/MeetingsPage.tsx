import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, type MeetingRequest, type TranscriptHit } from "@/lib/api";

export function MeetingsPage({ onOpened }: { onOpened: (roomId: string) => void }) {
  const [items, setItems] = useState<MeetingRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<TranscriptHit[]>([]);
  const [roomsSearched, setRoomsSearched] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  async function load() {
    try {
      const res = await api.meetings();
      setItems(res.meetingRequests);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load meetings");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function runSearch() {
    const query = q.trim();
    if (!query) {
      setHits([]);
      setSearched(false);
      return;
    }
    setSearching(true);
    try {
      const res = await api.transcriptsSearch(query, 40);
      setHits(res.hits);
      setRoomsSearched(res.roomsSearched);
      setSearched(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcript search failed");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-medium">Past chats</h1>
      <p className="text-sm text-muted">Open one to keep watching, or search every room transcript.</p>
      <Card>
        <CardContent className="flex flex-col gap-2 py-4 sm:flex-row">
          <Input
            placeholder="Search transcripts across rooms…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void runSearch();
              }
            }}
          />
          <Button variant="outline" disabled={searching || !q.trim()} onClick={() => void runSearch()}>
            {searching ? "Searching…" : "Search"}
          </Button>
        </CardContent>
      </Card>
      {error && <p className="text-sm text-coral">{error}</p>}
      {searched && (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            {hits.length} hit{hits.length === 1 ? "" : "s"} across {roomsSearched} room
            {roomsSearched === 1 ? "" : "s"}
          </p>
          {hits.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted">No transcript matches.</CardContent>
            </Card>
          )}
          {hits.map((h) => (
            <Card key={`${h.roomId}-${h.messageId}`}>
              <CardContent className="space-y-2 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="teal">{h.authorName}</Badge>
                  <span className="font-mono text-xs text-muted">score {h.score.toFixed(1)}</span>
                  {h.roomStatus && <Badge variant="gold">{h.roomStatus}</Badge>}
                </div>
                <p className="text-sm text-paper-2">{h.snippet}</p>
                <p className="text-xs text-muted">{h.intent || "Room"} · {new Date(h.createdAt).toLocaleString()}</p>
                {h.roomId && (
                  <Button variant="outline" size="sm" onClick={() => onOpened(h.roomId!)}>
                    Open room
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {items.length === 0 && !searched && (
        <Card>
          <CardContent className="py-10 text-center text-muted">No meeting requests yet.</CardContent>
        </Card>
      )}
      <div className="space-y-3">
        {items.map((m) => (
          <Card key={m.id}>
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={m.status === "accepted" ? "teal" : m.status === "declined" ? "coral" : "gold"}>
                    {m.status}
                  </Badge>
                  <span className="font-mono text-xs text-muted">{m.id}</span>
                </div>
                <p className="text-sm">{m.intent}</p>
                <p className="text-xs text-muted">
                  {m.requesterId} → {m.inviteeId}
                  {m.roomId ? ` · room ${m.roomId}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                {m.status === "proposed" && (
                  <>
                    <Button
                      size="sm"
                      onClick={() =>
                        void api.accept(m.id).then((r) => {
                          if (r.room?.id) onOpened(r.room.id);
                          void load();
                        })
                      }
                    >
                      Accept
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void api.decline(m.id).then(() => load())}>
                      Decline
                    </Button>
                  </>
                )}
                {m.roomId && (
                  <Button variant="outline" size="sm" onClick={() => onOpened(m.roomId!)}>
                    Open room
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
