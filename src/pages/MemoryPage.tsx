import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { api, type MemoryRecord } from "@/lib/api";

export function MemoryPage() {
  const [items, setItems] = useState<MemoryRecord[]>([]);
  const [q, setQ] = useState("");
  const [problem, setProblem] = useState("");
  const [narrative, setNarrative] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(query = q) {
    try {
      const res = await api.memories(query);
      setItems(res.memories);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Memory load failed");
    }
  }

  useEffect(() => {
    void load("");
  }, []);

  async function add() {
    if (!problem.trim() || !narrative.trim()) return;
    setBusy(true);
    try {
      await api.addMemory({ problem: problem.trim(), narrative: narrative.trim() });
      setProblem("");
      setNarrative("");
      await load("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">Org memory</h1>
        <p className="mt-1 text-sm text-muted">
          Resolved rooms persist a problem + narrative (and embedding when Gemini is on). Later
          meetings receive the top memories in twin context.
        </p>
      </div>
      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input placeholder="Search memories" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button variant="outline" onClick={() => void load(q)}>
              Search
            </Button>
          </div>
          <Input placeholder="Problem" value={problem} onChange={(e) => setProblem(e.target.value)} />
          <Textarea placeholder="What the twins learned" value={narrative} onChange={(e) => setNarrative(e.target.value)} />
          <Button disabled={busy} onClick={() => void add()}>
            Store memory
          </Button>
          {error && <p className="text-sm text-coral">{error}</p>}
        </CardContent>
      </Card>
      {items.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted">
            No memories yet. Resolve a room or store one here.
          </CardContent>
        </Card>
      )}
      <div className="space-y-3">
        {items.map((m) => (
          <Card key={m.id}>
            <CardHeader>
              <CardTitle>{m.problem}</CardTitle>
              <CardDescription>
                {m.roomId ? `room ${m.roomId}` : "manual"} · {new Date(m.createdAt).toLocaleString()}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-paper-2">{m.narrative}</CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
