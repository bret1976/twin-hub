import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { api, DEMO_INTENT, SAMPLE_DDL, type DiscoverHit } from "@/lib/api";

export function DiscoverPage({ onOpened }: { onOpened: (roomId: string) => void }) {
  const [intent, setIntent] = useState(DEMO_INTENT);
  const [tags, setTags] = useState("sql,postgres");
  const [body, setBody] = useState(SAMPLE_DDL);
  const [requesterId, setRequesterId] = useState("planner-twin");
  const [hits, setHits] = useState<DiscoverHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search() {
    setBusy(true);
    try {
      await api.seed();
      const res = await api.discover(intent, tags);
      setHits(res.results);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discover failed");
    } finally {
      setBusy(false);
    }
  }

  async function requestMeeting(inviteeId: string) {
    setBusy(true);
    try {
      const proposed = await api.propose({
        requesterId,
        inviteeId,
        intent,
        body,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      const accepted = await api.accept(proposed.meetingRequest.id);
      if (accepted.room?.id) onOpened(accepted.room.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Meeting failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-4">
        <div>
          <h1 className="font-serif text-3xl">Discover & invite</h1>
          <p className="mt-1 text-sm text-muted">
            Intent before invite. Tag overlap plus BM25-style keyword scoring ranks peers. Top
            result for the demo should be HasSkill.
          </p>
        </div>
        <Card>
          <CardContent className="space-y-3 pt-4">
            <label className="block text-xs uppercase tracking-wide text-muted">Intent</label>
            <Textarea value={intent} onChange={(e) => setIntent(e.target.value)} />
            <label className="block text-xs uppercase tracking-wide text-muted">Working material</label>
            <Textarea className="font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-muted">Tags</label>
                <Input value={tags} onChange={(e) => setTags(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-muted">Requester</label>
                <Input value={requesterId} onChange={(e) => setRequesterId(e.target.value)} />
              </div>
            </div>
            <Button onClick={() => void search()} disabled={busy}>
              {busy ? "Searching…" : "Discover peers"}
            </Button>
            {error && <p className="text-sm text-coral">{error}</p>}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        {hits.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted">
              No ranking yet. Run discover to see who should take the meeting.
            </CardContent>
          </Card>
        )}
        {hits.map((hit, i) => (
          <Card key={hit.agent.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>
                  {i === 0 ? "Top match — " : ""}
                  {hit.agent.name}
                </CardTitle>
                <Badge variant={i === 0 ? "teal" : "mute"}>score {hit.score.toFixed(2)}</Badge>
              </div>
              <CardDescription>{hit.agent.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted">
                tag {hit.tagScore.toFixed(2)} · keyword {hit.keywordScore.toFixed(2)}
                {hit.matchedTags.length ? ` · ${hit.matchedTags.join(", ")}` : ""}
              </p>
              <Button
                variant={i === 0 ? "teal" : "outline"}
                disabled={busy || hit.agent.id === requesterId}
                onClick={() => void requestMeeting(hit.agent.id)}
              >
                Request meeting & accept
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
