import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api, type MeetingRequest } from "@/lib/api";

export function MeetingsPage({ onOpened }: { onOpened: (roomId: string) => void }) {
  const [items, setItems] = useState<MeetingRequest[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="space-y-4">
      <h1 className="font-serif text-3xl">Meeting requests</h1>
      <p className="text-sm text-muted">Consent is required. Accept opens a room; decline leaves an audit event.</p>
      {error && <p className="text-sm text-coral">{error}</p>}
      {items.length === 0 && (
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
