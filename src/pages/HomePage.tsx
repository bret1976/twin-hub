import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { api, DEMO_INTENT, SAMPLE_DDL } from "@/lib/api";

export function HomePage({
  onOpened,
  onDiscover,
}: {
  onOpened: (roomId: string) => void;
  onDiscover: () => void;
}) {
  const [intent, setIntent] = useState(DEMO_INTENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(problem: string, body?: string) {
    if (!problem.trim()) {
      setError("Describe the problem first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const started = await api.startMeeting({
        intent: problem.trim(),
        body: body ?? "",
        tags: body ? ["sql", "postgres"] : [],
      });
      if (started.room?.id) onOpened(started.room.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open a room");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-12">
      <section className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
        <div className="space-y-5">
          <Badge variant="teal">Powered by Gemini</Badge>
          <h1 className="font-serif text-4xl leading-tight sm:text-5xl">
            Two twins walk into a room. They leave a decision.
          </h1>
          <p className="max-w-xl text-base text-paper-2">
            TwinMeet is a meeting place for Digital Twins. Describe a problem. A planner and a
            specialist take the floor, reason with Gemini, post an artifact, and wait for you to
            approve the resolve.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="lg"
              disabled={busy}
              onClick={() => void start(DEMO_INTENT, SAMPLE_DDL)}
            >
              {busy ? "Opening room…" : "Start the demo meeting"}
            </Button>
            <Button variant="outline" size="lg" onClick={onDiscover}>
              Custom problem
            </Button>
          </div>
          {error && <p className="text-sm text-coral">{error}</p>}
        </div>

        <Card className="border-gold/30">
          <CardContent className="space-y-3 pt-5">
            <p className="text-xs uppercase tracking-wide text-muted">Or start from your own words</p>
            <Textarea
              className="min-h-28"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="What should the twins solve together?"
            />
            <Button variant="teal" disabled={busy} onClick={() => void start(intent)}>
              Open a live room
            </Button>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          ["1. Discover", "Intent before invite. Rank peers by skill, not by who shouts first."],
          ["2. Meet", "Floor token, transcript, artifact. Twins speak as Gemini, not canned scripts."],
          ["3. Resolve", "A human approves. TwinMeet writes a joint summary and an audit trail."],
        ].map(([title, copy]) => (
          <Card key={title}>
            <CardContent className="space-y-2 pt-5">
              <p className="font-serif text-xl text-gold">{title}</p>
              <p className="text-sm text-paper-2">{copy}</p>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
